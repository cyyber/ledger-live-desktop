// @flow
import invariant from 'invariant'
import { BigNumber } from 'bignumber.js'
import { Observable } from 'rxjs'
import React from 'react'
import { QrlAPI, QrlAddressValidator, TransferTransaction } from '@theqrl/js-api-bridge'
import type { Account, Operation } from '@ledgerhq/live-common/lib/types'
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
import getAddress from 'commands/getAddress'
import signTransaction from 'commands/signTransaction'
import {
  apiForEndpointConfig,
  parseAPIValue,
} from '@ledgerhq/live-common/lib/api/QRL'
import FeesQrlKind from 'components/FeesField/QrlKind'
import AdvancedOptionsQrlKind from 'components/AdvancedOptions/QrlKind'
import {
  NotEnoughBalance,
  FeeNotLoaded,
  NotEnoughBalanceBecauseDestinationNotCreated,
  InvalidAddressBecauseDestinationIsAlsoSource,
} from '@ledgerhq/errors'
import type { WalletBridge, EditProps } from './types'

type Transaction = {
  amounts: Array<BigNumber>,
  addressesTo: Array<string>,
  fee: ?BigNumber,
  otsIndex: ?number,
}

const EditFees = ({ account, onChange, value }: EditProps<Transaction>) => (
  <FeesQrlKind
    onChange={fee => {
      onChange({ ...value, fee })
    }}
    fee={value.fee}
    account={account}
  />
)

const EditAdvancedOptions = ({ onChange, value }: EditProps<Transaction>) => (
  <AdvancedOptionsQrlKind
    otsIndex={value.otsIndex}
    onChangeOtsIndex={otsIndex => {
      onChange({ ...value, otsIndex })
    }}
  />
)

async function signAndBroadcast({ a, t, deviceId, isCancelled, onSigned, onOperationBroadcasted }) {
  const api = apiForEndpointConfig(QrlAPI)
  const { fee } = t.fee
  if (!fee) throw new FeeNotLoaded()
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

function isRecipientValid(account, recipient) {
  try {
    if(!QrlAddressValidator(recipient)) {
      return false;
    }
    return !(account && account.freshAddress === recipient)
  } catch (e) {
    console.log(e);
    return false
  }
}

function getRecipientWarning(account, recipient) {
  if (account.freshAddress === recipient) {
    return new InvalidAddressBecauseDestinationIsAlsoSource()
  }
  return null
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
}

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
    fee: tx.fee,
    blockHash: tx.block && tx.block.headerHash,
    blockHeight: tx.block && tx.block.blockNumber,
    senders: [tx.addressFrom],
    recipients: tx.addressesTo,
    date: new Date(tx.block.timestamp),
    transactionSequenceNumber: tx.nonce,
    extra: {},
  }
  op.extra.otsIndex = tx.otsIndex
  return op
}

const QrlJSBridge: WalletBridge<Transaction> = {
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
            const derivationScheme = getDerivationScheme({ derivationMode, currency })
            // const stopAt = isIterableDerivationMode(derivationMode) ? 255 : 1
            const stopAt = 1;
            for (let index = 0; index < stopAt; index++) {
              if (!derivationModeSupportsIndex(derivationMode, index)) continue
              const freshAddressPath = runDerivationScheme(derivationScheme, currency, {
                account: index,
              })
              const { address } = await getAddress
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
                if (e.message !== 'actNotFound') {
                  throw e
                }
              }

              const freshAddress = address

              if (!info) {
                if (derivationMode === '') {
                  o.next({
                    id: accountId,
                    seedIdentifier: freshAddress,
                    derivationMode,
                    name: getNewAccountPlaceholderName({ currency, index, derivationMode }),
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
                `Ripple: invalid balance=${balance.toString()} for address ${address}`,
              )

              if (finished) return

              const account: $Exact<Account> = {
                id: accountId,
                seedIdentifier: freshAddress,
                derivationMode,
                name: getAccountPlaceholderName({ currency, index, derivationMode }),
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

  synchronize: ({
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

          const response = await api.GetAddressState(freshAddress);
          let strBalance
          try {
            strBalance = response.data.balance;
          } catch (e) {
            if (e.message !== 'actNotFound') {
              throw e
            }
          }
          if (finished) return

          const balance = parseAPIValue(strBalance)
          invariant(
            !balance.isNaN() && balance.isFinite(),
            `Ripple: invalid balance=${balance.toString()} for address ${freshAddress}`,
          )

          o.next(a => ({ ...a, balance }))

          const transactions = response.data.transactions;
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
              blockHeight: 10000,
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

  isRecipientValid: (account, recipient) => Promise.resolve(isRecipientValid(account, recipient)),
  getRecipientWarning: (account, recipient) =>
    Promise.resolve(getRecipientWarning(account, recipient)),

  createTransaction: () => ({
    amount: BigNumber(0),
    recipient: '',
    fee: null,
    tag: undefined,
  }),

  editTransactionAmount: (account, t, amount) => ({
    ...t,
    amount,
  }),

  getTransactionAmount: (a, t) => t.amount,

  editTransactionRecipient: (account, t, recipient) => {
    const parts = recipient.split('?')
    const params = new URLSearchParams(parts[1])
    recipient = parts[0]

    // Extract parameters we may need
    for (const [key, value] of params.entries()) {
      switch (key) {
        case 'dt':
          t.tag = parseInt(value, 10) || 0
          break
        case 'amount':
          t.amount = parseAPIValue(value || '0')
          break
        default:
        // do nothing
      }
    }

    return {
      ...t,
      recipient,
    }
  },

  EditFees,

  EditAdvancedOptions,

  getTransactionRecipient: (a, t) => t.recipient,

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
      delete cacheRecipientsNew[t.recipient]
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

  addPendingOperation: (account, operation) => ({
    ...account,
    pendingOperations: [operation].concat(
      account.pendingOperations.filter(
        o => o.transactionSequenceNumber === operation.transactionSequenceNumber,
      ),
    ),
  }),
}

export default QrlJSBridge
