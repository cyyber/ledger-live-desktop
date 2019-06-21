// @flow
/* eslint-disable no-param-reassign */

import invariant from 'invariant'
import { BigNumber } from 'bignumber.js'
import { Observable } from 'rxjs'
import { QrlAPI, QrlAddressValidator, TransferTransaction } from '@theqrl/js-api-bridge'
import {
  NotEnoughBalance,
  InvalidAddress,
  InvalidAddressBecauseDestinationIsAlsoSource,
} from '@ledgerhq/errors'
import type { Account, Operation } from '@ledgerhq/live-common/lib/types'
import type { CurrencyBridge, AccountBridge } from '@ledgerhq/live-common/lib/bridge/types'
import {
  getDerivationModesForCurrency,
  getDerivationScheme,
  runDerivationScheme,
  derivationModeSupportsIndex,
} from '@ledgerhq/live-common/lib/derivation'
import {
  getAccountPlaceholderName,
  getNewAccountPlaceholderName,
} from '@ledgerhq/live-common/lib/account'
import {
  apiForEndpointConfig,
  parseAPIValue,
} from '@ledgerhq/live-common/lib/api/Qrl'
import getAddress from 'commands/getAddress'
import signTransaction from 'commands/signTransaction'

export type Transaction = {
  amounts: Array<BigNumber>,
  addressesTo: Array<string>,
  fee: ?BigNumber,
}

async function signAndBroadcast({ a, t, deviceId, isCancelled, onSigned, onOperationBroadcasted }) {
  const api = apiForEndpointConfig(QrlAPI)
  // Disabled as QRL could have 0 fee
  // if (!fee) throw new FeeNotLoaded()
  try {
    let transferTx = new TransferTransaction([t.recipient], [t.amount.toString()], t.fee.toString(), "", "", "", "");
    // Get Transaction From hw-app-qrl
    const signedInfo = await signTransaction
      .send({
        currencyId: a.currency.id,
        devicePath: deviceId,
        path: a.freshAddressPath,
        transaction: {transferTx: transferTx, sourceAddress: a.freshAddress},
      })
      .toPromise()
    if (!isCancelled()) {
      onSigned()
      transferTx.publicKey = signedInfo.publicKey;
      transferTx.signature = signedInfo.signature;
      const response = await api.BroadcastTransferTx(transferTx);
      if (response.error !== 0) {
        throw new Error(response.errorMessage)
      }

      const hash = response.data.transactionHash;

      const op: $Exact<Operation> = {
        id: `${a.id}-${hash}-OUT`,
        hash,
        accountId: a.id,
        type: 'OUT',
        value: t.amount,
        fee: t.fee,
        blockHash: null,
        blockHeight: null,
        senders: [a.freshAddress],
        recipients: [t.recipient],
        date: new Date(),
        // we probably can't get it so it's a predictive value
        transactionSequenceNumber:
          (a.operations.length > 0 ? a.operations[0].transactionSequenceNumber : 0) +
          a.pendingOperations.length,
        extra: {},
      };

      onOperationBroadcasted(op)
    }
  } finally {
  }
}

function isRecipientValid(recipient) {
  try {
    return QrlAddressValidator(recipient);
  } catch (e) {
    return false
  }
}

function checkValidRecipient(account, recipient) {
  if (account.freshAddress === recipient) {
    return Promise.reject(new InvalidAddressBecauseDestinationIsAlsoSource())
  }
  try {
    if(QrlAddressValidator(recipient)) {
      return Promise.resolve(null)
    }
  } catch (e) {
    return Promise.reject(new InvalidAddress('', { currencyName: account.currency.name }))
  }
}

function mergeOps(existing: Operation[], newFetched: Operation[]) {
  const ids = existing.map(o => o.id)
  const all = existing.concat(newFetched.filter(o => !ids.includes(o.id)))
  return all.sort((a, b) => b.date - a.date)
}

type Tx = {
  addressFrom: string,
  signerAddress: string,
  fee: string,
  nonce: string,
  transactionHash: string,
  addressesTo: Array<string>,
  amounts: Array<string>,
  block?: {
    headerHash: string,
    blockNumber: number,
    timestamp: string,
  }
};

const txToOperation = (account: Account) => (tx: Tx): ?Operation => {
  const type = tx.addressFrom === account.freshAddress ? 'OUT' : 'IN'
  let value = tx.totalAmount ? parseAPIValue(tx.totalAmount) : BigNumber(0)
  const feeValue = parseAPIValue(tx.fee)
  if (type === 'OUT') {
    if (!isNaN(feeValue)) {
      value = value.plus(feeValue)
    }
  }

  const id = tx.transactionHash;
  const op: $Exact<Operation> = {
    id: `${account.id}-${id}-${type}`,
    hash: tx.transactionHash,
    accountId: account.id,
    type: type,
    value: value,
    fee: feeValue,
    blockHash: tx.block && tx.block.headerHash,
    blockHeight: tx.block && tx.block.blockNumber,
    senders: [tx.addressFrom],
    recipients: tx.addressesTo,
    date: new Date(tx.block.timestamp),
    transactionSequenceNumber: tx.nonce,
    extra: {},
  }
  return op
};

export const currencyBridge: CurrencyBridge = {
  scanAccountsOnDevice: (currency, deviceId) =>
    Observable.create(o => {
      let finished = false
      const unsubscribe = () => {
        finished = true
      }

      async function main() {
        const api = apiForEndpointConfig(QrlAPI)
        try {
          const response = await api.GetHeight()
          const derivationModes = getDerivationModesForCurrency(currency)
          for (const derivationMode of derivationModes) {
            const derivationScheme = getDerivationScheme({derivationMode, currency})
            // const stopAt = isIterableDerivationMode(derivationMode) ? 255 : 1
            const stopAt = 1;
            for (let index = 0; index < stopAt; index++) {
              if (!derivationModeSupportsIndex(derivationMode, index)) continue
              const freshAddressPath = runDerivationScheme(derivationScheme, currency, {
                account: index,
              })
              const {address} = await getAddress
                .send({
                  derivationMode,
                  currencyId: currency.id,
                  devicePath: deviceId,
                  path: freshAddressPath,
                })
                .toPromise()
              if (finished) return

              const accountId = `qrljs:2:${currency.id}:${address}:${derivationMode}`
              let info
              try {
                info = await api.GetAddressState(address)
              } catch (e) {
                throw e
              }

              const freshAddress = address
              if (!info) {
                if (derivationMode === '') {
                  o.next({
                    type: 'Account',
                    id: accountId,
                    seedIdentifier: freshAddress,
                    derivationMode,
                    name: getNewAccountPlaceholderName({currency, index, derivationMode}),
                    freshAddress,
                    freshAddressPath,
                    balance: BigNumber(0),
                    blockHeight: response.data.height,
                    index,
                    currency,
                    operations: [],
                    pendingOperations: [],
                    unit: currency.units[0],
                    archived: false,
                    lastSyncDate: new Date(),
                  })
                }
                break
              }
              if (finished) return
              const balance = parseAPIValue(info.data.balance)
              invariant(
                !balance.isNaN() && balance.isFinite(),
                `Qrl: invalid balance=${balance.toString()} for address ${address}`,
              )

              if (finished) return
              const account: $Exact<Account> = {
                type: 'Account',
                id: accountId,
                seedIdentifier: freshAddress,
                derivationMode,
                name: getAccountPlaceholderName({currency, index, derivationMode}),
                freshAddress,
                freshAddressPath,
                balance,
                blockHeight: response.data.height,
                index,
                currency,
                operations: [],
                pendingOperations: [],
                unit: currency.units[0],
                lastSyncDate: new Date(),
              }
              account.operations = info.data.transactions.map(txToOperation(account)).filter(Boolean)
              o.next(account)
            }
          }
          o.complete()
        } catch (e) {
          o.error(e)
        } finally {
        }
      }

      main()

      return unsubscribe
    }),
};

export const accountBridge: AccountBridge<Transaction> = {
  startSync: ({
                endpointConfig,
                freshAddress,
                blockHeight,
                operations: { length: currentOpsLength },
              }) =>
    Observable.create(o => {
      let finished = false
      const unsubscribe = () => {
        finished = true
      }

      async function main() {
        const api = apiForEndpointConfig(QrlAPI)
        try {
          const heightResponse = await api.GetHeight()
          if (heightResponse.data.height === blockHeight) {
            o.complete()
            return
          }
          const addressState = await api.GetAddressState(freshAddress);
          let strBalance
          try {
            strBalance = addressState.data.balance;
          } catch (e) {
            throw e
          }
          if (finished) return

          const balance = parseAPIValue(strBalance)
          invariant(
            !balance.isNaN() && balance.isFinite(),
            `QRL: invalid balance=${balance.toString()} for address ${freshAddress}`,
          )

          o.next(a => ({ ...a, balance }))

          const transactions = addressState.data.transactions;
          if (finished) return
          o.next(a => {
            const newOps = transactions.map(txToOperation(a))
            const operations = mergeOps(a.operations, newOps)
            const [last] = operations
            const pendingOperations = a.pendingOperations.filter(
              o =>
                !operations.some(op => o.hash === op.hash) &&
                last &&
                last.transactionSequenceNumber &&
                o.transactionSequenceNumber &&
                o.transactionSequenceNumber > last.transactionSequenceNumber,
            )
            return {
              ...a,
              pendingOperations,
              operations,
              blockHeight: heightResponse.data.height,
              lastSyncDate: new Date(),
            }
          })

          o.complete()
        } catch (e) {
          o.error(e)
        } finally {
        }
      }

      main()

      return unsubscribe
    }),

  pullMoreOperations: () => Promise.resolve(a => a), // FIXME not implemented

  checkValidRecipient,

  getRecipientWarning: () => Promise.resolve(null),

  createTransaction: () => ({
    amount: BigNumber(0),
    recipient: '',
    fee: null,
  }),

  fetchTransactionNetworkInfo: async account => {
    const api = apiForEndpointConfig(QrlAPI)
    const serverData = await api.GetEstimatedNetworkFee()
    const serverFee = parseAPIValue(serverData.data.fee)
    return {
      serverFee,
    }
  },

  getTransactionNetworkInfo: (account, transaction) => transaction.networkInfo,

  applyTransactionNetworkInfo: (account, transaction, networkInfo) => ({
    ...transaction,
    networkInfo,
    fee: transaction.fee || networkInfo.serverFee,
  }),

  editTransactionAmount: (account, t, amount) => ({
    ...t,
    amount,
  }),

  getTransactionAmount: (a, t) => t.amount,

  editTransactionRecipient: (account, t, recipient) => ({
    ...t,
    recipient,
  }),

  getTransactionRecipient: (a, t) => t.recipient,

  editTransactionExtra: (a, t, field, value) => {
    switch (field) {
      case 'fee':
        invariant(
          !value || BigNumber.isBigNumber(value),
          "editTransactionExtra(a,t,'fee',value): BigNumber value expected",
        )
        return {...t, fee: value}

      default:
        return t
    }
  },

  getTransactionExtra: (a, t, field) => {
    switch (field) {
      case 'fee':
        return t.fee

      default:
        return undefined
    }
  },

  checkValidTransaction: async (a, t) => {
    if (
      t.amount
        .plus(t.fee || 0)
        .isLessThanOrEqualTo(a.balance)
    ) {
      return true
    }
    throw new NotEnoughBalance()
  },

  getTotalSpent: (a, t) => Promise.resolve(t.amount.plus(t.fee || 0)),

  getMaxAmount: (a, t) => Promise.resolve(a.balance.minus(t.fee || 0)),

  signAndBroadcast: (a, t, deviceId) =>
    Observable.create(o => {
      let cancelled = false
      const isCancelled = () => cancelled
      const onSigned = () => {
        o.next({ type: 'signed' })
      }
      const onOperationBroadcasted = operation => {
        o.next({ type: 'broadcasted', operation })
      }
      signAndBroadcast({ a, t, deviceId, isCancelled, onSigned, onOperationBroadcasted }).then(
        () => {
          o.complete()
        },
        e => {
          o.error(e)
        },
      )
      return () => {
        cancelled = true
      }
    }),

  prepareTransaction: (a, t) => Promise.resolve(t),
}
