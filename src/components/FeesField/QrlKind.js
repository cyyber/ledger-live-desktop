// @flow

import React, { Component } from 'react'
import { QrlAPI } from '@theqrl/js-api-bridge'
import type { BigNumber } from 'bignumber.js'
import type { Account } from '@ledgerhq/live-common/lib/types'
import { apiForEndpointConfig, parseAPIValue } from '@ledgerhq/live-common/lib/api/QRL'
import { FeeNotLoaded } from '@ledgerhq/errors'
import InputCurrency from 'components/base/InputCurrency'
import GenericContainer from './GenericContainer'

type Props = {
  account: Account,
  fee: ?BigNumber,
  onChange: BigNumber => void,
}

type State = {
  error: ?Error,
}

class FeesField extends Component<Props, State> {
  state = {
    error: null,
  }
  componentDidMount() {
    this.sync()
  }
  componentWillUnmount() {
    this.syncId++
  }
  syncId = 0
  async sync() {
    const api = apiForEndpointConfig(QrlAPI)
    const syncId = ++this.syncId
    try {
      const serverData = await api.GetEstimatedNetworkFee()
      if (syncId !== this.syncId) return
      const serverFee = parseAPIValue(serverData.data.fee)
      this.props.onChange(serverFee);
    } catch (error) {
      this.setState({ error })
    } finally {
    }
  }
  render() {
    const { account, fee, onChange } = this.props
    const { error } = this.state
    const { units } = account.currency
    return (
      <GenericContainer>
        <InputCurrency
          defaultUnit={units[0]}
          units={units}
          containerProps={{ grow: true }}
          loading={!error && !fee}
          error={!fee && error ? new FeeNotLoaded() : null}
          value={fee}
          onChange={onChange}
        />
      </GenericContainer>
    )
  }
}

export default FeesField
