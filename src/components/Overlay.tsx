import * as React from 'react';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
// Overlay component no longer needs gesture handling - main component handles all gestures

import { TStyle } from '../options';
import s from '../styles';
// import { PanGestureEvent, PanGestureStateEvent } from '../types'; // Removed as unused

export interface OverlayProps {
  withOverlay: boolean;
  modalPosition: SharedValue<'initial' | 'top'>;
  showContent: boolean;
  overlayStyle?: TStyle;
  overlay?: SharedValue<number>;
}

function PrivateOverlay({ withOverlay, showContent, overlayStyle, overlay }: OverlayProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const opacity = overlay ? overlay.value : 0;

    return {
      opacity,
      pointerEvents: 'auto',
    };
  });

  if (!withOverlay) {
    return null;
  }

  return (
    <Animated.View style={s.overlay} testID="Modalize.Overlay">
      {showContent && (
        <Animated.View style={[s.overlay__background, overlayStyle, animatedStyle]} />
      )}
    </Animated.View>
  );
}

export const Overlay = React.memo(PrivateOverlay);
