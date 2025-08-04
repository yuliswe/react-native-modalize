import * as React from 'react';
import { Animated } from 'react-native';
import {
  PanGestureHandler,
  State,
  TapGestureHandler,
  TapGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';

import { TClose, TStyle } from '../options';
import s from '../styles';

interface OverlayProps {
  withOverlay: boolean;
  alwaysOpen: number | undefined;
  modalPosition: string;
  showContent: boolean;
  overlayStyle?: TStyle;
  panGestureEnabled: boolean;
  closeOnOverlayTap: boolean | undefined;
  tapGestureModalizeRef: React.RefObject<any>;
  tapGestureOverlayRef: React.RefObject<any>;
  handleGestureEvent: any;
  createGestureStateHandler: (
    handlerName: 'pan-children' | 'pan-component' | 'pan-overlay' | 'tap-overlay',
  ) => (event: any) => void;
  onOverlayPress?: () => void;
  handleClose: (dest?: TClose, callback?: () => void) => void;
  willCloseModalize: boolean;
  overlay: Animated.Value;
  activeGestureRef: React.MutableRefObject<
    Record<'pan-children' | 'pan-component' | 'pan-overlay' | 'tap-overlay', boolean>
  >;
}

export const Overlay: React.FC<OverlayProps> = ({
  withOverlay,
  alwaysOpen,
  modalPosition,
  showContent,
  overlayStyle,
  panGestureEnabled,
  closeOnOverlayTap,
  tapGestureModalizeRef,
  tapGestureOverlayRef,
  handleGestureEvent,
  createGestureStateHandler,
  onOverlayPress,
  handleClose,
  willCloseModalize,
  overlay,
  activeGestureRef,
}) => {
  const pointerEvents =
    alwaysOpen && (modalPosition === 'initial' || !modalPosition) ? 'box-none' : 'auto';

  const handleOverlayPanStateChange = createGestureStateHandler('pan-overlay');

  const handleOverlayStateChange = ({ nativeEvent }: TapGestureHandlerStateChangeEvent): void => {
    const { state } = nativeEvent;

    // Track active gesture handler
    if (state === State.ACTIVE) {
      activeGestureRef.current['tap-overlay'] = true;
      // console.log(`🔵 Gesture ACTIVE: tap-overlay`, activeGestureRef.current);
    } else if (state === State.END || state === State.CANCELLED || state === State.FAILED) {
      activeGestureRef.current['tap-overlay'] = false;
      // console.log(`🔴 Gesture ENDED: tap-overlay`, activeGestureRef.current);
    }

    if (nativeEvent.oldState === State.ACTIVE && !willCloseModalize) {
      if (onOverlayPress) {
        onOverlayPress();
      }

      const dest = !!alwaysOpen ? 'alwaysOpen' : 'default';

      handleClose(dest);
    }
  };

  if (!withOverlay) {
    return null;
  }

  return (
    <PanGestureHandler
      enabled={panGestureEnabled}
      simultaneousHandlers={tapGestureModalizeRef}
      shouldCancelWhenOutside={false}
      onGestureEvent={handleGestureEvent}
      onHandlerStateChange={handleOverlayPanStateChange}
    >
      <Animated.View style={s.overlay} pointerEvents={pointerEvents}>
        {showContent && (
          <TapGestureHandler
            ref={tapGestureOverlayRef}
            enabled={closeOnOverlayTap !== undefined ? closeOnOverlayTap : panGestureEnabled}
            onHandlerStateChange={handleOverlayStateChange}
          >
            <Animated.View
              style={[
                s.overlay__background,
                overlayStyle,
                {
                  opacity: overlay.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 1],
                  }),
                },
              ]}
              pointerEvents={pointerEvents}
            />
          </TapGestureHandler>
        )}
      </Animated.View>
    </PanGestureHandler>
  );
};
