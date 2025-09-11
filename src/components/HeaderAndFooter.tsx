import * as React from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, ViewStyle } from 'react-native';
// HeaderAndFooter component no longer needs gesture handling - main component handles all gestures

// import { PanGestureEvent, PanGestureStateEvent } from '../types'; // Removed as unused
import { isAndroid } from '../utils/devices';

export interface HeaderAndFooterProps {
  component: React.ReactNode;
  name: 'header' | 'footer' | 'floating';
  panGestureComponentEnabled: boolean;
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
  panGestureComponentEnabled,
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
    <Animated.View
      testID="Modalize.HeaderAndFooter"
      style={{ zIndex }}
      onLayout={(e: LayoutChangeEvent): void => handleComponentLayout(e, name, absolute)}
    >
      {tag}
    </Animated.View>
  );
}

export const HeaderAndFooter = React.memo(_HeaderAndFooter);
