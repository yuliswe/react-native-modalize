import React from 'react';
import { Animated } from 'react-native';

import { IProps } from '../options';
import s from '../styles';
import { LayoutEvent, ScrollEvent } from '../types';
import { composeRefs } from '../utils/compose-refs';
import { isIos } from '../utils/devices';

export interface ModalizeContentProps {
  // Only support renderChildren - let children provide their own scrollable components
  renderChildren?: IProps['renderChildren'];
  childrenStyle?: IProps['childrenStyle'];
  adjustToContentHeight?: boolean;
  contentRef?: IProps['contentRef'];

  // State and refs from the main component
  contentViewRef: React.RefObject<any>;

  // Handlers from the main component
  handleContentLayout: (event: LayoutEvent) => void;
  handleScroll: (event: ScrollEvent) => void;

  // State values from the main component
  enableBounces: boolean;
  keyboardToggle: boolean;
  disableScroll: boolean | undefined;

  children: React.ReactNode;
}

export function _ModalizeContent({
  children,
  renderChildren,
  childrenStyle,
  adjustToContentHeight,
  contentRef,
  contentViewRef,
  handleContentLayout,
  handleScroll,
  enableBounces,
  keyboardToggle,
  disableScroll,
}: ModalizeContentProps) {
  const style = adjustToContentHeight ? s.content__adjustHeight : s.content__container;

  // Content scrolling is now handled by the main component's gesture detector

  // Prepare common options for renderChildren
  const keyboardDismissMode:
    | Animated.Value
    | Animated.AnimatedInterpolation
    | 'interactive'
    | 'on-drag' = isIos ? 'interactive' : 'on-drag';

  const scrollEnabled = keyboardToggle || !disableScroll;
  const scrollEventThrottle = 16;

  const opts = {
    ref: composeRefs(contentViewRef, contentRef) as React.RefObject<any>,
    bounces: enableBounces,
    scrollEventThrottle,
    onLayout: handleContentLayout,
    scrollEnabled: scrollEnabled,
    keyboardDismissMode,
    onScroll: handleScroll,
  };

  // Use renderChildren if provided, otherwise render children directly
  const contentElement = renderChildren ? renderChildren({ ...opts, children }) : children;

  return <Animated.View style={[style, childrenStyle]}>{contentElement}</Animated.View>;
}

export const ModalizeContent = React.memo(_ModalizeContent);
