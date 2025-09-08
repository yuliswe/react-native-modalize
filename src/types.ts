// Shared type definitions for gesture events

export type PanGestureEvent = {
  translationX: number;
  translationY: number;
  velocityX: number;
  velocityY: number;
  x: number;
  y: number;
  absoluteX: number;
  absoluteY: number;
};

export type PanGestureStateEvent = PanGestureEvent & {
  state: number;
  oldState: number;
};

import { LayoutChangeEvent } from 'react-native';

export type LayoutEvent = LayoutChangeEvent;

export type ScrollEvent = {
  nativeEvent: {
    contentOffset: {
      y: number;
    };
  };
};
