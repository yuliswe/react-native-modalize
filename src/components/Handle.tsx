import * as React from 'react';
import { Animated, View } from 'react-native';
// Handle component no longer needs gesture handling - main component handles all gestures

import { TStyle } from '../options';
import s from '../styles';
// import { PanGestureEvent, PanGestureStateEvent } from '../types'; // Removed as unused

export interface HandleProps {
  withHandle: boolean;
  handlePosition: 'inside' | 'outside';
  handleStyle?: TStyle;
}

function _Handle({ withHandle, handlePosition, handleStyle }: HandleProps) {
  const handleStyles: (TStyle | undefined)[] = [s.handle];
  const shapeStyles: (TStyle | undefined)[] = [s.handle__shape, handleStyle];
  const isHandleOutside = handlePosition === 'outside';

  if (!withHandle) {
    return null;
  }

  if (!isHandleOutside) {
    handleStyles.push(s.handleBottom);
    shapeStyles.push(s.handle__shapeBottom, handleStyle);
  }

  return (
    <Animated.View style={handleStyles} testID="Modalize.Handle">
      <View style={shapeStyles} />
    </Animated.View>
  );
}

export const Handle = React.memo(_Handle);
