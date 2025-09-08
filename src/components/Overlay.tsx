import * as React from 'react';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
// Overlay component no longer needs gesture handling - main component handles all gestures

import { TStyle } from '../options';
import s from '../styles';
// import { PanGestureEvent, PanGestureStateEvent } from '../types'; // Removed as unused

export interface OverlayProps {
  withOverlay: boolean;
  alwaysOpen: number | undefined;
  modalPosition: SharedValue<'initial' | 'top'>;
  showContent: boolean;
  overlayStyle?: TStyle;
  overlay?: SharedValue<number>;
}

function _Overlay({
  withOverlay,
  alwaysOpen,
  modalPosition,
  showContent,
  overlayStyle,
  overlay,
}: OverlayProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const currentPosition = modalPosition.value;
    const pointerEvents =
      alwaysOpen && (currentPosition === 'initial' || !currentPosition) ? 'box-none' : 'auto';

    const opacity = overlay ? overlay.value : 0;

    return {
      opacity,
      pointerEvents,
    };
  });

  if (!withOverlay) {
    return null;
  }

  return (
    <Animated.View style={s.overlay}>
      {showContent && (
        <Animated.View style={[s.overlay__background, overlayStyle, animatedStyle]} />
      )}
    </Animated.View>
  );
}

export const Overlay = React.memo(_Overlay);
