import * as React from 'react';
import { ViewStyle, SectionList, StyleProp } from 'react-native';
import {
  ScrollView as RNGHScrollView,
  FlatList as RNGHFlatList,
  type PanGesture,
} from 'react-native-gesture-handler';
import { EasingFunction } from 'react-native-reanimated';
import { LayoutEvent } from './types';

export type TStyle = StyleProp<ViewStyle>;

export interface ITimingProps {
  duration: number;
  easing?: EasingFunction;
  delay?: number;
  isInteraction?: boolean;
}

export interface ISpringProps {
  friction?: number;
  tension?: number;
  speed?: number;
  bounciness?: number;
  stiffness?: number;
  damping?: number;
  mass?: number;
}

export interface ModalizeProps<ListItem = any> {
  testID?: string;
  /**
   * A reference to the view (ScrollView, FlatList, SectionList) that provides the scroll behavior, where you will be able to access their owns methods.
   */
  contentRef?: React.RefObject<RNGHScrollView | RNGHFlatList<ListItem> | SectionList<ListItem>>;

  /**
   * A React node that will define the content of the modal.
   */
  children?: React.ReactNode;

  /**
   * Define the style of the root modal component.
   */
  rootStyle?: TStyle;

  /**
   * Define the style of the modal (includes handle/header/children/footer).
   */
  modalStyle?: TStyle;

  /**
   * Define the style of the handle on top of the modal.
   */
  handleStyle?: TStyle;

  /**
   * Define the style of the overlay.
   */
  overlayStyle?: TStyle;

  /**
   * Define the style of the children renderer (only the inside part).
   */
  childrenStyle?: TStyle;

  /**
   * An array of numbers that will enable the snapping feature and create intermediate points before opening the modal to full screen.
   * Each number represents the height of the modal in pixels.
   * For example, [300, 600] means the modal can snap to 300px or 600px height.
   * The snap points are calculated based on the actual height of the modal's content.
   */
  snapPoints?: number[];

  /**
   * Index of the snap point to use as the initial position when the modal opens.
   * If not provided, defaults to the first snap point (index 0).
   * @default 0
   */
  initialSnapPointIndex?: number;

  /**
   * A number to define the modal's top offset.
   */
  modalTopOffset?: number;

  /**
   * Controls whether the modal is open or closed. If provided, the modal becomes a controlled component.
   * If not provided, the modal uses internal state to manage its open/closed state.
   */
  isOpen?: boolean;

  /**
   * Controls whether the modal is always open or closed.
   */
  alwaysOpen?: boolean;

  /**
   * Define where the handle on top of the modal should be positioned.
   * @default 'outside'
   */
  handlePosition?: 'outside' | 'inside';

  /**
   * Disable the scroll when the content is shorter than screen's height.
   * @default true
   */
  disableScrollIfPossible?: boolean;

  /**
   * Define if HeaderComponent/FooterComponent/FloatingComponent should have pan gesture enable (Android specific). When enable it might break touchable inside the view.
   * @default false
   */
  panGestureComponentEnabled?: boolean;

  /**
   * Using this prop will enable/disable overlay tap gesture.
   * @default true
   */
  closeOnOverlayTap?: boolean;

  /**
   * Duration of the open animation.
   * @default 280
   */
  openAnimationDuration?: number;

  /**
   * Easing function for the open animation.
   */
  openAnimationEasing?: EasingFunction;

  /**
   * Delay before starting the open animation.
   */
  openAnimationDelay?: number;

  /**
   * Whether the open animation is an interaction.
   */
  openAnimationIsInteraction?: boolean;

  /**
   * Duration of the close animation.
   * @default 280
   */
  closeAnimationDuration?: number;

  /**
   * Easing function for the close animation.
   */
  closeAnimationEasing?: EasingFunction;

  /**
   * Delay before starting the close animation.
   */
  closeAnimationDelay?: number;

  /**
   * Whether the close animation is an interaction.
   */
  closeAnimationIsInteraction?: boolean;

  /**
   * A number that determines the momentum of the scroll required.
   * @default 0.05
   */
  dragToss?: number;

  /**
   * Number of pixels that the user must pass to be able to close the modal.
   * @default 120
   */
  threshold?: number;

  /**
   * Number of pixels the user has to pan down fast to close the modal.
   * @default 2800
   */
  velocity?: number | undefined;

  /**
   * Range: 0 (closed) to 1 (top)
   */
  translateY?: { value: number };

  /**
   * External Gesture.Pan() instance to add custom event handlers to the modal's pan gesture.
   * If provided, this will be composed with the internal pan gesture, preserving all default behavior
   * while allowing the parent to add additional custom handlers.
   */
  panGesture?: PanGesture; // Gesture.Pan() type from react-native-gesture-handler

  /**
   * Define if the handle on top of the modal is display or not.
   * @default true
   */
  withHandle?: boolean;

  /**
   * Define if the overlay is display or not.
   * @default true
   */
  withOverlay?: boolean;

  /**
   * Enable keyboard avoiding behavior for the modal.
   * When enabled, the modal will automatically adjust its position and snap points
   * to avoid being covered by the keyboard.
   * @default false
   */
  avoidKeyboard?: boolean;

  /**
   * Enable overdrag animation that allows the modal to be dragged beyond its normal bounds
   * with resistance, and then bounce back when released.
   * @default false
   */
  enableOverdrag?: boolean;

  /**
   * Controls the resistance when dragging beyond normal bounds.
   * Higher values mean more resistance (less movement).
   * @default 0.05
   */
  overdragResistance?: number;

  /**
   * Duration of the bounce back animation when releasing from overdrag.
   * @default 400
   */
  overdragBounceDuration?: number;

  /**
   * Easing curve for the bounce back animation when releasing from overdrag.
   */
  overdragBounceEasing?: EasingFunction;

  /**
   * A header component outside of the ScrollView, on top of the modal.
   */
  HeaderComponent?: React.ReactNode;

  /**
   * A footer component outside of the ScrollView, on top of the modal.
   */
  FooterComponent?: React.ReactNode;

  /**
   * A floating component inside the modal wrapper that will be independent of scrolling. It requires `zIndex` child with absolute positioning.
   */
  FloatingComponent?: React.ReactNode;

  /**
   * Callback function when the `open` method is triggered.
   */
  onWillOpen?(): void;

  /**
   * Callback function when the modal is opened.
   */
  onDidOpen?(): void;

  /**
   * Callback function when the `close` method is triggered.
   */
  onWillClose?(): void;

  /**
   * Callback function when the modal is closed.
   */
  onDidClose?(): void;

  /**
   * onBackButtonPress is called when the user taps the hardware back button on
   * Android or the menu button on Apple TV. You can any function you want,
   * but you will have to close the modal by yourself.
   */
  onBackButtonPress?(): boolean;

  /**
   * Callback used when you press the overlay.
   */
  onOverlayPress?(): void;

  /**
   * Callback used when you press the overlay.
   */
  onLayout?(event: LayoutEvent): void;
}
