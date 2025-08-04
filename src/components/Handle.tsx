import * as React from 'react';
import { Animated, View } from 'react-native';
import { PanGestureHandler, PanGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';

import { TStyle } from '../options';
import s from '../styles';

interface HandleProps {
  withHandle: boolean;
  handlePosition: 'inside' | 'outside';
  handleStyle?: TStyle;
  panGestureEnabled: boolean;
  tapGestureModalizeRef: React.RefObject<any>;
  handleGestureEvent: any;
  handlePanStateChange: (event: PanGestureHandlerStateChangeEvent) => void;
}

function _Handle({
  withHandle,
  handlePosition,
  handleStyle,
  panGestureEnabled,
  tapGestureModalizeRef,
  handleGestureEvent,
  handlePanStateChange,
}: HandleProps) {
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
    <PanGestureHandler
      enabled={panGestureEnabled}
      simultaneousHandlers={tapGestureModalizeRef}
      shouldCancelWhenOutside={false}
      onGestureEvent={handleGestureEvent}
      onHandlerStateChange={handlePanStateChange}
    >
      <Animated.View style={handleStyles}>
        <View style={shapeStyles} />
      </Animated.View>
    </PanGestureHandler>
  );
}

export const Handle = React.memo(_Handle);
