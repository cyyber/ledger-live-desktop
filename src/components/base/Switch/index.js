// @flow

import React from 'react'
import noop from 'lodash/noop'
import styled from 'styled-components'

import { Tabbable } from 'components/base/Box'

const Base = styled(Tabbable).attrs({
  bg: p => (p.isChecked ? 'wallet' : 'lightFog'),
  horizontal: true,
  align: 'center',
})`
  width: ${p => (p.small ? 25 : 50)}px;
  height: ${p => (p.small ? 13 : 26)}px;
  border-radius: 13px;
  opacity: ${p => (p.disabled ? 0.3 : 1)};
  transition: 250ms linear background-color;
  cursor: ${p => (p.disabled ? 'cursor' : 'pointer')};
  &:focus {
    outline: none;
  }
`

const Ball = styled.div`
  width: ${p => (p.small ? 9 : 20)}px;
  height: ${p => (p.small ? 9 : 20)}px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.2);
  transition: 250ms ease-in-out transform;
  transform: translate3d(
    ${p => (p.small ? (p.isChecked ? '14px' : '2px') : p.isChecked ? '27px' : '3px')},
    0,
    0
  );
`

type Props = {
  isChecked: boolean,
  onChange?: Function,
  small?: boolean,
}

function Switch(props: Props) {
  const { isChecked, onChange, small, ...p } = props
  return (
    <Base
      small={small}
      isChecked={isChecked}
      onClick={() => onChange && onChange(!isChecked)}
      {...p}
    >
      <Ball small={small} isChecked={isChecked} />
    </Base>
  )
}

Switch.defaultProps = {
  onChange: noop,
}

export default Switch
