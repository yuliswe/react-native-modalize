import * as React from 'react';
import { Animated } from 'react-native';
// Overlay component no longer needs gesture handling - main component handles all gestures

import { TStyle } from '../options';
import s from '../styles';
// import { PanGestureEvent, PanGestureStateEvent } from '../types'; // Removed as unused

export interface OverlayProps {
  withOverlay: boolean;
  alwaysOpen: number | undefined;
  modalPosition: string;
  showContent: boolean;
  overlayStyle?: TStyle;
  overlay?: Animated.Value;
}

function _Overlay({
  withOverlay,
  alwaysOpen,
  modalPosition,
  showContent,
  overlayStyle,
  overlay,
}: OverlayProps) {
  const pointerEvents =
    alwaysOpen && (modalPosition === 'initial' || !modalPosition) ? 'box-none' : 'auto';

  if (!withOverlay) {
    return null;
  }

  return (
    <Animated.View style={s.overlay} pointerEvents={pointerEvents}>
      {showContent && (
        <Animated.View
          style={[
            s.overlay__background,
            overlayStyle,
            {
              opacity: overlay?.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1],
              }),
            },
          ]}
          pointerEvents={pointerEvents}
        />
      )}
    </Animated.View>
  );
}

export const Overlay = React.memo(_Overlay);
