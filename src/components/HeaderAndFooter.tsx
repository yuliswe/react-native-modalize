import * as React from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, ViewStyle } from 'react-native';
import { PanGestureHandler, PanGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';

import { isAndroid } from '../utils/devices';

interface HeaderAndFooterProps {
  component: React.ReactNode;
  name: 'header' | 'footer' | 'floating';
  panGestureEnabled: boolean;
  panGestureComponentEnabled: boolean;
  handleGestureEvent: any;
  handlePanStateChange: (event: PanGestureHandlerStateChangeEvent) => void;
  handleComponentLayout: (
    event: LayoutChangeEvent,
    name: 'header' | 'footer' | 'floating',
    absolute: boolean,
  ) => void;
}

const renderElement = (Element: React.ReactNode): JSX.Element =>
  typeof Element === 'function' ? Element() : (Element as JSX.Element);

function _HeaderAndFooter({
  component,
  name,
  panGestureEnabled,
  panGestureComponentEnabled,
  handleGestureEvent,
  handlePanStateChange,
  handleComponentLayout,
}: HeaderAndFooterProps) {
  if (!component) {
    return null;
  }

  const tag = renderElement(component);

  /**
   * Nesting Touchable/ScrollView components with RNGH PanGestureHandler cancels the inner events.
   * Until a better solution lands in RNGH, I will disable the PanGestureHandler for Android only,
   * so inner touchable/gestures are working from the custom components you can pass in.
   */
  if (isAndroid && !panGestureComponentEnabled) {
    return tag;
  }

  const obj: ViewStyle = StyleSheet.flatten(tag?.props?.style);
  const absolute: boolean = obj?.position === 'absolute';
  const zIndex: number | undefined = obj?.zIndex;

  return (
    <PanGestureHandler
      enabled={panGestureEnabled}
      shouldCancelWhenOutside={false}
      onGestureEvent={handleGestureEvent}
      onHandlerStateChange={handlePanStateChange}
    >
      <Animated.View
        style={{ zIndex }}
        onLayout={(e: LayoutChangeEvent): void => handleComponentLayout(e, name, absolute)}
      >
        {tag}
      </Animated.View>
    </PanGestureHandler>
  );
}

export const HeaderAndFooter = React.memo(_HeaderAndFooter);
