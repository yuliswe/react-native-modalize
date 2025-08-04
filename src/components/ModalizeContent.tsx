import React from 'react';
import { Animated, SectionList } from 'react-native';
import {
  FlatList,
  PanGestureHandler,
  PanGestureHandlerStateChangeEvent,
  ScrollView,
  TapGestureHandler,
} from 'react-native-gesture-handler';

import { IProps } from '../options';
import s from '../styles';
import { composeRefs } from '../utils/compose-refs';
import { isIos } from '../utils/devices';
import { isRNGH2 } from '../utils/libraries';

const ACTIVATED = 20;

interface ModalizeContentProps {
  // Props from IProps that are needed for renderChildren
  scrollViewProps?: IProps['scrollViewProps'];
  flatListProps?: IProps['flatListProps'];
  sectionListProps?: IProps['sectionListProps'];
  renderChildren?: IProps['renderChildren'];
  childrenStyle?: IProps['childrenStyle'];
  adjustToContentHeight?: boolean;
  contentRef?: IProps['contentRef'];

  // State and refs from the main component
  contentViewRef: React.RefObject<ScrollView | FlatList<any> | SectionList<any>>;
  panGestureChildrenRef: React.RefObject<PanGestureHandler>;
  tapGestureModalizeRef: React.RefObject<TapGestureHandler>;

  // Handlers from the main component
  handleContentLayout: (event: any) => void;
  handleScroll: (event: any) => void;
  handleGestureEvent: any;
  handlePanChildrenStateChange: (event: PanGestureHandlerStateChangeEvent) => void;

  // State values from the main component
  enableBounces: boolean;
  keyboardToggle: boolean;
  disableScroll: boolean | undefined;
  panGestureEnabled: boolean;

  children: React.ReactNode;
}

export function _ModalizeContent({
  children,
  scrollViewProps,
  flatListProps,
  sectionListProps,
  renderChildren,
  childrenStyle,
  adjustToContentHeight,
  contentRef,
  contentViewRef,
  panGestureChildrenRef,
  tapGestureModalizeRef,
  handleContentLayout,
  handleScroll,
  handleGestureEvent,
  handlePanChildrenStateChange,
  enableBounces,
  keyboardToggle,
  disableScroll,
  panGestureEnabled,
}: ModalizeContentProps) {
  const style = adjustToContentHeight ? s.content__adjustHeight : s.content__container;
  const minDist = isRNGH2() ? undefined : ACTIVATED;

  // Inlined renderContent logic
  const keyboardDismissMode:
    | Animated.Value
    | Animated.AnimatedInterpolation
    | 'interactive'
    | 'on-drag' = isIos ? 'interactive' : 'on-drag';
  const passedOnProps = flatListProps ?? sectionListProps ?? scrollViewProps;
  // We allow overwrites when the props (bounces, scrollEnabled) are set to false, when true we use Modalize's core behavior
  const scrollEnabled = passedOnProps?.scrollEnabled ?? (keyboardToggle || !disableScroll);
  const scrollEventThrottle = passedOnProps?.scrollEventThrottle || 16;

  const opts = {
    ref: composeRefs(contentViewRef, contentRef) as React.RefObject<any>,
    bounces: enableBounces,
    scrollEventThrottle,
    onLayout: handleContentLayout,
    scrollEnabled: scrollEnabled,
    keyboardDismissMode,
    onScroll: handleScroll,
    // Gesture handler props for scrollable components
    waitFor: tapGestureModalizeRef,
    simultaneousHandlers: [panGestureChildrenRef],
  };

  let contentElement: JSX.Element;

  if (flatListProps) {
    contentElement = <FlatList {...flatListProps} {...opts} />;
  } else if (sectionListProps) {
    contentElement = <SectionList {...sectionListProps} {...opts} />;
  } else if (renderChildren) {
    contentElement = renderChildren({ ...opts, children });
  } else {
    contentElement = (
      <ScrollView {...scrollViewProps} {...opts}>
        {children}
      </ScrollView>
    );
  }

  // useRenderDebug(
  //   {
  //     // Props that could cause rerenders
  //     scrollViewProps,
  //     flatListProps,
  //     sectionListProps,
  //     renderChildren,
  //     childrenStyle,
  //     adjustToContentHeight,
  //     contentRef,

  //     // State values that could cause rerenders
  //     isScrollAtTop,
  //     keyboardToggle,
  //     disableScroll,
  //     panGestureEnabled,

  //     // Computed values that depend on props/state
  //     enableBounces,
  //     scrollEnabled,
  //     scrollEventThrottle,
  //     keyboardDismissMode,

  //     // Children (React node that could change)
  //     children,
  //   },
  //   { name: 'ModalizeContent' },
  // );

  return (
    <PanGestureHandler
      ref={panGestureChildrenRef}
      enabled={panGestureEnabled}
      simultaneousHandlers={[contentViewRef, tapGestureModalizeRef]}
      shouldCancelWhenOutside={false}
      onGestureEvent={handleGestureEvent}
      minDist={minDist}
      activeOffsetY={ACTIVATED}
      activeOffsetX={ACTIVATED}
      onHandlerStateChange={handlePanChildrenStateChange}
    >
      <Animated.View style={[style, childrenStyle]}>{contentElement}</Animated.View>
    </PanGestureHandler>
  );
}

export const ModalizeContent = React.memo(_ModalizeContent);
