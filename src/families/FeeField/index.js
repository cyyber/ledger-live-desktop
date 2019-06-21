// @flow
import React from 'react'
import type { Account } from '@ledgerhq/live-common/lib/types'
import BitcoinKind from './BitcoinKind'
import EthereumKind from './EthereumKind'
import RippleKind from './RippleKind'
import QrlKind from './QrlKind'

const byFamily = {
  bitcoin: BitcoinKind,
  ethereum: EthereumKind,
  ripple: RippleKind,
  qrl: QrlKind,
}

type Props = {
  account: Account,
  transaction: *,
  onChange: (*) => void,
}

const FeeField = (props: Props) => {
  const Cmp = byFamily[props.account.currency.family]
  if (!Cmp) return null
  return <Cmp {...props} />
}

export default FeeField
