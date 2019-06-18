// @flow
import React, { Component } from 'react'
import { BigNumber } from 'bignumber.js'
import { translate } from 'react-i18next'

import Box from 'components/base/Box'
import Input from 'components/base/Input'
import Label from 'components/base/Label'

type Props = {
  otsIndex: ?number,
  onChangeOtsIndex: (?number) => void,
  t: *,
}

const uint32maxPlus1 = BigNumber(2).pow(32)

class QrlKind extends Component<Props> {
  onChange = str => {
    const { onChangeOtsIndex } = this.props
    const qrlOTSIndex = BigNumber(str.replace(/[^0-9]/g, ''))
    if (!qrlOTSIndex.isNaN() && qrlOTSIndex.isFinite()) {
      if (qrlOTSIndex.isInteger() && qrlOTSIndex.isPositive()) {
        onChangeOtsIndex(qrlOTSIndex.toNumber())
      }
    } else {
      onChangeOtsIndex(undefined)
    }
  }
  render() {
    const { otsIndex, t } = this.props
    return (
      <Box vertical flow={5}>
        <Box grow>
          <Label>
            <span>{t('send.steps.amount.qrlOTSIndex')}</span>
          </Label>
          <Input value={String(otsIndex || '')} onChange={this.onChange} />
        </Box>
      </Box>
    )
  }
}

export default translate()(QrlKind)
