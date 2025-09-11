/**
 * esModuleInterop: true looks to work everywhere except
 * on snack.expo for some reason. Will revisit this later.
 */
import React, { useCallback } from 'react';
import {
  BackHandler,
  Easing,
  EmitterSubscription,
  Keyboard,
  KeyboardAvoidingView,
  KeyboardAvoidingViewProps,
  KeyboardEvent,
  LayoutChangeEvent,
  Modal,
  type NativeEventSubscription,
  Platform,
  SectionList,
  StatusBar,
  View,
} from 'react-native';
import { FlatList, Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  Easing as ReanimatedEasing,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Handle } from './components/Handle';
import { HeaderAndFooter } from './components/HeaderAndFooter';
import { ModalizeContent } from './components/ModalizeContent';
import { Overlay } from './components/Overlay';
import { IHandles, IProps, TClose, TOpen, TPosition } from './options';
import s from './styles';
import { LayoutEvent, PanGestureEvent, PanGestureStateEvent } from './types';
import { invariant } from './utils/invariant';
import { isBelowRN65 } from './utils/libraries';
import { useDimensions } from './utils/use-dimensions';

const AnimatedKeyboardAvoidingView = Animated.createAnimatedComponent(KeyboardAvoidingView);
// Removed SCROLL_THRESHOLD as it's no longer needed with the new snap logic
const USE_NATIVE_DRIVER = true;
const PAN_DURATION = 150;

// Animation constants
const DEFAULT_OPEN_ANIMATION_CONFIG = {
  timing: { duration: 280, easing: Easing.ease },
};

const DEFAULT_CLOSE_ANIMATION_CONFIG = {
  timing: { duration: 280, easing: Easing.linear },
};

const DEFAULT_MODAL_TOP_OFFSET = Platform.select({
  ios: 0,
  android: StatusBar.currentHeight || 0,
  default: 0,
});

const DEFAULT_AVOID_KEYBOARD_LIKE_IOS = Platform.select({
  ios: true,
  android: false,
  default: true,
});

const _ModalizeBase = (props: IProps, ref: React.Ref<React.ReactNode>): JSX.Element | null => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const {
    testID,
    // Refs
    contentRef,

    // Renderers
    children,
    renderChildren,

    // Styles
    rootStyle,
    modalStyle,
    handleStyle,
    overlayStyle,
    childrenStyle,

    // Layout
    snapPoints,
    modalHeight,
    modalTopOffset = DEFAULT_MODAL_TOP_OFFSET,
    alwaysOpen,
    adjustToContentHeight = false,

    // Options
    handlePosition = 'outside',
    disableScrollIfPossible = true,
    avoidKeyboardLikeIOS = DEFAULT_AVOID_KEYBOARD_LIKE_IOS,
    keyboardAvoidingBehavior = 'padding',
    keyboardAvoidingOffset,
    panGestureEnabled = true,
    panGestureComponentEnabled = false,
    tapGestureEnabled = true,
    closeOnOverlayTap = true,
    closeSnapPointStraightEnabled = true,

    // Animations
    openAnimationConfig = DEFAULT_OPEN_ANIMATION_CONFIG,
    closeAnimationConfig = DEFAULT_CLOSE_ANIMATION_CONFIG,
    dragToss = 0.18,
    threshold = 120,
    velocity = 2800,
    panGestureAnimatedValue,
    translateY: externalTranslateY,
    panGesture: externalPanGesture,
    useNativeDriver = true,

    // Elements visibilities
    withReactModal = false,
    reactModalProps,
    withHandle = true,
    withOverlay = true,

    // Additional components
    HeaderComponent,
    FooterComponent,
    FloatingComponent,

    // Callbacks
    onWillOpen,
    onOpened,
    onWillClose,
    onClosed,
    onBackButtonPress,
    onPositionChange,
    onOverlayPress,
    onLayout,
  } = props;

  const { height: screenHeight } = useDimensions();

  /** Height available for the modal after accounting for top offset (status bar, etc.) */
  const availableScreenHeight = screenHeight - modalTopOffset;

  /** Maximum height the modal can be (either user-specified or full available height) */
  const maxModalHeight = modalHeight || availableScreenHeight;

  /** Initial height when modal opens (undefined if adjusting to content height) */
  const initialModalHeight = adjustToContentHeight ? undefined : maxModalHeight;

  /** Snap points: [closed, snapPoints..., fullOpen] or [closed, fullOpen] */
  const snaps = React.useMemo(() => {
    if (!snapPoints || snapPoints.length === 0) {
      return [0, maxModalHeight];
    }

    // Pre-allocate array with known size to avoid dynamic resizing
    const snapDistances = new Array(snapPoints.length);
    for (let i = 0; i < snapPoints.length; i++) {
      snapDistances[i] = maxModalHeight - snapPoints[i];
    }

    // Use Set for deduplication, then convert back to sorted array
    const uniqueSnaps = new Set([0, ...snapDistances, maxModalHeight]);
    return Array.from(uniqueSnaps).sort((a, b) => a - b);
  }, [snapPoints, maxModalHeight]);

  const [_actualModalHeight, setActualModalHeight] = React.useState(initialModalHeight);

  /** Current actual height of the modal (can change based on content) */
  const actualModalHeight = _actualModalHeight;

  // UI thread only states - moved to shared values
  const enableBounces = useSharedValue(true);
  const beginScrollYValue = useSharedValue(0);
  const isScrollAtTop = useSharedValue(true);
  const lastSnap = useSharedValue(0);
  const modalPosition = useSharedValue<TPosition>('initial');

  // Initialize lastSnap based on snap points
  React.useEffect(() => {
    if (snapPoints && snapPoints.length > 0) {
      lastSnap.value = maxModalHeight - snapPoints[0];
    }
  }, [snapPoints, maxModalHeight, lastSnap]);

  // JS thread states - optimized with useMemo for initial values
  const [isVisible, setIsVisible] = React.useState(false);
  const [showContent, setShowContent] = React.useState(true);
  const [keyboardToggle, setKeyboardToggle] = React.useState(false);
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);

  // Memoize initial disableScroll value to prevent unnecessary re-calculations
  const initialDisableScroll = React.useMemo(
    () => (alwaysOpen || snapPoints ? true : undefined),
    [alwaysOpen, snapPoints],
  );
  const [disableScroll, setDisableScroll] = React.useState(initialDisableScroll);

  const [cancelClose, setCancelClose] = React.useState(false);

  // Use useRef for layouts to avoid unnecessary re-renders
  const layoutsRef = React.useRef<Map<string, number>>(new Map());

  const cancelTranslateY = useSharedValue(1); // 1 by default to have the translateY animation running
  const componentTranslateY = useSharedValue(0);
  const overlay = useSharedValue(0);
  const beginScrollY = useSharedValue(0);
  const dragY = useSharedValue(0);

  // Always create internal translateY
  const internalTranslateY = useSharedValue(screenHeight);

  // Use external if provided, otherwise use internal
  const translateY = externalTranslateY || internalTranslateY;

  const reverseBeginScrollY = useDerivedValue(() => -beginScrollY.value);

  const contentViewRef = React.useRef<ScrollView | FlatList<any> | SectionList<any>>(null);

  const componentDragEnabled = useDerivedValue(() => componentTranslateY.value === 1);

  // Optimized calculation with minimal type conversions and cached values
  const value = useDerivedValue(() => {
    const multiplier = componentDragEnabled.value ? 1 : cancelTranslateY.value;
    const clampedDiff = clamp(reverseBeginScrollY.value, -screenHeight, 0);
    const baseValue = translateY.value + dragY.value;
    return baseValue * multiplier + clampedDiff;
  });

  let willCloseModalize = false;

  const handleAnimateClose = useCallback(
    (dest: TClose = 'default'): void => {
      'worklet';

      if (onWillClose) {
        runOnJS(onWillClose)();
      }

      const { timing } = closeAnimationConfig as any;
      const toInitialAlwaysOpen = dest === 'alwaysOpen' && Boolean(alwaysOpen);
      const toValue =
        toInitialAlwaysOpen && alwaysOpen ? (actualModalHeight || 0) - alwaysOpen : screenHeight;

      cancelTranslateY.value = 1;
      beginScrollYValue.value = 0;
      beginScrollY.value = 0;

      // Calculate current visual position and update translateY to start from there
      const currentVisualPosition = translateY.value + dragY.value;
      translateY.value = currentVisualPosition;
      dragY.value = 0;

      // Animate overlay
      overlay.value = withTiming(0, {
        duration: timing.duration,
        easing: ReanimatedEasing.ease,
      });

      // Animate pan gesture value
      if (panGestureAnimatedValue) {
        panGestureAnimatedValue.value = withTiming(0, {
          duration: PAN_DURATION,
          easing: ReanimatedEasing.ease,
        });
      }

      // Reset dragY on UI thread
      dragY.value = 0;

      // Animate translateY from current position to destination
      translateY.value = withTiming(
        toValue,
        {
          duration: timing.duration,
          easing: ReanimatedEasing.linear,
        },
        finished => {
          'worklet';
          if (finished) {
            // Run these only after animation finishes
            runOnJS(setShowContent)(toInitialAlwaysOpen);
            lastSnap.value = snapPoints ? snaps[1] : 80;
            runOnJS(setIsVisible)(toInitialAlwaysOpen);

            if (onClosed) {
              runOnJS(onClosed)();
            }

            if (alwaysOpen && dest === 'alwaysOpen' && onPositionChange) {
              runOnJS(onPositionChange)('initial');
            }

            if (alwaysOpen && dest === 'alwaysOpen') {
              modalPosition.value = 'initial';
            }

            willCloseModalize = false;
          }
        },
      );
    },
    [
      closeAnimationConfig,
      snapPoints,
      snaps,
      alwaysOpen,
      actualModalHeight,
      screenHeight,
      panGestureAnimatedValue,
      onClosed,
      onPositionChange,
    ],
  );

  const handleBackPress = useCallback((): boolean => {
    if (alwaysOpen) {
      return false;
    }

    if (onBackButtonPress) {
      return onBackButtonPress();
    } else {
      runOnUI(handleAnimateClose)();
    }

    return true;
  }, [alwaysOpen, onBackButtonPress, handleAnimateClose]);

  const handleKeyboardShow = useCallback((event: KeyboardEvent): void => {
    const { height } = event.endCoordinates;

    setKeyboardToggle(true);
    setKeyboardHeight(height);
  }, []);

  const handleKeyboardHide = useCallback((): void => {
    setKeyboardToggle(false);
    setKeyboardHeight(0);
  }, []);

  const handleAnimateOpen = (
    alwaysOpenValue: number | undefined,
    dest: TOpen = 'default',
  ): void => {
    'worklet';

    const { timing } = openAnimationConfig;

    let toValue = 0;
    let toPanValue = 0;
    let newPosition: TPosition;

    if (dest === 'top') {
      toValue = 0;
    } else if (alwaysOpenValue) {
      toValue = (actualModalHeight || 0) - alwaysOpenValue;
    } else if (snapPoints && snapPoints.length > 0) {
      toValue = maxModalHeight - snapPoints[0]; // Use first snap point for initial open
    }

    if (panGestureAnimatedValue && (alwaysOpenValue || snapPoints)) {
      toPanValue = 0;
    } else if (
      panGestureAnimatedValue &&
      !alwaysOpenValue &&
      (dest === 'top' || dest === 'default')
    ) {
      toPanValue = 1;
    }

    runOnJS(setIsVisible)(true);
    runOnJS(setShowContent)(true);

    if ((alwaysOpenValue && dest !== 'top') || (snapPoints && dest === 'default')) {
      newPosition = 'initial';
    } else {
      newPosition = 'top';
    }

    // Animate overlay
    overlay.value = withTiming(alwaysOpenValue && dest === 'default' ? 0 : 1, {
      duration: timing.duration,
      easing: ReanimatedEasing.ease,
    });

    // Animate pan gesture value
    if (panGestureAnimatedValue) {
      panGestureAnimatedValue.value = withTiming(toPanValue, {
        duration: PAN_DURATION,
        easing: ReanimatedEasing.ease,
      });
    }

    // Animate translateY
    const translateYAnimation = withTiming(toValue, {
      duration: timing.duration,
      easing: ReanimatedEasing.out(ReanimatedEasing.ease),
    });

    translateY.value = translateYAnimation;

    // Use runOnJS to handle the completion callback
    if (onOpened) {
      runOnJS(onOpened)();
    }

    modalPosition.value = newPosition;

    if (onPositionChange) {
      runOnJS(onPositionChange)(newPosition);
    }
  };

  const handleModalizeContentLayout = useCallback(
    (event: LayoutEvent): void => {
      const { layout } = event.nativeEvent;
      const value = Math.min(
        layout.height + (!adjustToContentHeight || keyboardHeight ? layout.y : 0),
        maxModalHeight -
          Platform.select({
            ios: 0,
            android: keyboardHeight,
            default: 0,
          }),
      );

      setActualModalHeight(value);
    },
    [adjustToContentHeight, keyboardHeight, maxModalHeight],
  );

  const handleBaseLayout = useCallback(
    (component: 'content' | 'header' | 'footer' | 'floating', height: number): void => {
      // Update ref directly to avoid state updates
      layoutsRef.current.set(component, height);

      // Layouts are now managed via ref only to avoid unnecessary re-renders

      const max = Array.from(layoutsRef.current).reduce((acc, cur) => acc + cur?.[1], 0);
      const maxFixed = +max.toFixed(3);
      const maxModalHeightFixed = +maxModalHeight.toFixed(3);
      const shorterHeight = maxFixed < maxModalHeightFixed;

      setDisableScroll(shorterHeight && disableScrollIfPossible);
    },
    [maxModalHeight, disableScrollIfPossible],
  );

  const handleContentLayout = useCallback(
    (event: LayoutEvent): void => {
      if (onLayout) {
        onLayout(event);
      }

      if (alwaysOpen && adjustToContentHeight) {
        const { height } = event.nativeEvent.layout;

        return setActualModalHeight(height);
      }

      // We don't want to disable the scroll if we are not using adjustToContentHeight props
      if (!adjustToContentHeight) {
        return;
      }

      handleBaseLayout('content', event.nativeEvent.layout.height);
    },
    [onLayout, alwaysOpen, adjustToContentHeight, handleBaseLayout],
  );

  const handleScroll = useCallback(
    (event: any) => {
      const { contentOffset } = event.nativeEvent;
      const isAtTop = contentOffset.y <= 0;
      // Only update if the value actually changed to prevent unnecessary worklet calls
      if (isAtTop !== isScrollAtTop.value) {
        isScrollAtTop.value = isAtTop;
      }
    },
    [isScrollAtTop],
  );

  const handleComponentLayout = useCallback(
    (event: LayoutChangeEvent, name: 'header' | 'footer' | 'floating', absolute: boolean): void => {
      /**
       * We don't want to disable the scroll if we are not using adjustToContentHeight props.
       * Also, if the component is in absolute positioning we don't want to take in
       * account its dimensions, so we just skip.
       */
      if (!adjustToContentHeight || absolute) {
        return;
      }

      handleBaseLayout(name, event.nativeEvent.layout.height);
    },
    [adjustToContentHeight, handleBaseLayout],
  );

  // V2 Gesture definitions with proper composition
  const panGestureModalize = React.useMemo(() => {
    // Start with external pan gesture if provided, otherwise create new one
    const baseGesture = externalPanGesture || Gesture.Pan();

    return baseGesture
      .enabled(panGestureEnabled)
      .shouldCancelWhenOutside(false)
      .onBegin(() => {
        'worklet';

        // Handle pan begin for main modalize
        runOnJS(setCancelClose)(false);

        // Reset animation values at the start of each gesture
        dragY.value = 0;
        // Don't reset translateY - it should maintain current position (snap point)
        cancelTranslateY.value = 1;

        if (!tapGestureEnabled) {
          runOnJS(setDisableScroll)(
            (Boolean(snapPoints) || Boolean(alwaysOpen)) && modalPosition.value === 'initial',
          );
        }
      })
      .onChange((event: PanGestureEvent) => {
        'worklet';
        const { translationY } = event;

        // Update dragY for animation
        dragY.value = translationY;

        // Optimize panGestureAnimatedValue calculation with early returns
        if (panGestureAnimatedValue) {
          const currentPosition = modalPosition.value;

          // Early return for edge cases to avoid unnecessary calculations
          if (currentPosition === 'initial' && translationY > 0) {
            panGestureAnimatedValue.value = 0;
            return;
          }

          if (currentPosition === 'top' && translationY <= 0) {
            panGestureAnimatedValue.value = 1;
            return;
          }

          // Cache offset calculation
          const offset = alwaysOpen ?? snapPoints?.[0] ?? 0;
          const maxHeight = maxModalHeight - offset;

          // Avoid division if possible
          if (maxHeight <= 0) {
            panGestureAnimatedValue.value = 0;
            return;
          }

          // Optimized calculation with single division and cached values
          const normalizedTranslation = translationY / maxHeight;
          const isUpward = translationY <= 0;
          const absNormalized = Math.abs(normalizedTranslation);

          panGestureAnimatedValue.value = Math.max(
            0,
            Math.min(1, isUpward ? absNormalized : 1 - absNormalized),
          );
        }
      })
      .onEnd((event: PanGestureStateEvent) => {
        'worklet';

        const { timing } = closeAnimationConfig;
        const { velocityY, translationY } = event;
        // Removed negativeReverseScroll as it's no longer needed with the new snap logic
        const thresholdProps = translationY > threshold && beginScrollYValue.value === 0;
        const closeThreshold = velocity
          ? (beginScrollYValue.value <= 20 && velocityY >= velocity) || thresholdProps
          : thresholdProps;

        const enableBouncesValue = alwaysOpen
          ? beginScrollYValue.value > 0 || translationY < 0
          : !isScrollAtTop.value;

        enableBounces.value = enableBouncesValue;

        const toValue = translationY - beginScrollYValue.value;
        let destSnapPoint = lastSnap.value; // Start with current position

        if (snapPoints || alwaysOpen) {
          const endOffsetY = lastSnap.value + toValue + dragToss * velocityY;

          // Find the nearest snap point with optimized search
          let nearestSnap = snaps[0];
          let minDistance = Math.abs(snaps[0] - endOffsetY);

          // Use for loop instead of forEach for better performance
          for (let i = 1; i < snaps.length; i++) {
            const snap = snaps[i];
            const distFromSnap = Math.abs(snap - endOffsetY);

            if (distFromSnap < minDistance) {
              minDistance = distFromSnap;
              nearestSnap = snap;
            }
          }

          destSnapPoint = nearestSnap;

          // Handle special cases
          if (!alwaysOpen) {
            if (nearestSnap === maxModalHeight) {
              // Snap to closed position - close the modal
              willCloseModalize = true;
              handleAnimateClose('default');
            } else {
              // Snap to snap point or full open - don't close
              willCloseModalize = false;
            }
          }

          // For alwaysOpen props
          if (alwaysOpen && beginScrollYValue.value <= 0) {
            destSnapPoint = (actualModalHeight || 0) - alwaysOpen;
            willCloseModalize = false;
          }
        } else if (closeThreshold && !alwaysOpen && !cancelClose) {
          willCloseModalize = true;
          handleAnimateClose('default');
        }

        if (willCloseModalize) {
          return;
        }

        // Calculate the current visual position (where the modal actually is visually)
        const currentVisualPosition = translateY.value + dragY.value;

        // Update translateY to the current visual position and reset drag offset
        translateY.value = currentVisualPosition;
        dragY.value = 0;

        // Update lastSnap to the destination snap point for next gesture
        lastSnap.value = destSnapPoint;

        if (alwaysOpen) {
          overlay.value = withTiming(destSnapPoint <= 0 ? 1 : 0, {
            duration: timing.duration,
            easing: ReanimatedEasing.ease,
          });
        }

        // Animate to destination snap point
        translateY.value = withTiming(destSnapPoint, {
          duration: 300,
          easing: ReanimatedEasing.out(ReanimatedEasing.ease),
        });

        if (beginScrollYValue.value <= 0) {
          const modalPositionValue = destSnapPoint <= 0 ? 'top' : 'initial';

          if (panGestureAnimatedValue) {
            panGestureAnimatedValue.value = withTiming(modalPositionValue === 'top' ? 1 : 0, {
              duration: PAN_DURATION,
              easing: ReanimatedEasing.ease,
            });
          }

          if (!adjustToContentHeight && modalPositionValue === 'top') {
            runOnJS(setDisableScroll)(false);
          }

          if (onPositionChange && modalPosition.value !== modalPositionValue) {
            runOnJS(onPositionChange)(modalPositionValue);
          }

          if (modalPosition.value !== modalPositionValue) {
            modalPosition.value = modalPositionValue;
          }
        }
      });
  }, [
    externalPanGesture,
    panGestureEnabled,
    snapPoints,
    closeSnapPointStraightEnabled,
    alwaysOpen,
    tapGestureEnabled,
    closeAnimationConfig,
    threshold,
    velocity,
    dragToss,
    maxModalHeight,
    panGestureAnimatedValue,
    useNativeDriver,
    onPositionChange,
    adjustToContentHeight,
    handleAnimateClose,
    actualModalHeight,
    snaps,
    overlay,
    translateY,
    dragY,
    beginScrollY,
    setCancelClose,
    setDisableScroll,
  ]);

  const tapGestureOverlay = React.useMemo(
    () =>
      Gesture.Tap()
        .enabled(closeOnOverlayTap !== undefined ? closeOnOverlayTap : panGestureEnabled)
        .onStart(() => {
          'worklet';

          if (onOverlayPress) {
            runOnJS(onOverlayPress)();
          }
          const dest = !!alwaysOpen ? 'alwaysOpen' : 'default';
          if (!willCloseModalize) {
            handleAnimateClose(dest);
          }
        }),
    [
      closeOnOverlayTap,
      panGestureEnabled,
      onOverlayPress,
      alwaysOpen,
      willCloseModalize,
      handleAnimateClose,
    ],
  );

  // Separate gesture detectors:
  // 1. Pan gesture for all swipe actions (modal content and overlay)
  // 2. Tap gesture only for overlay closing

  React.useImperativeHandle(ref, () => ({
    open(dest?: TOpen): void {
      if (onWillOpen) {
        onWillOpen();
      }

      handleAnimateOpen(alwaysOpen, dest);
    },

    close(dest?: TClose): void {
      runOnUI(handleAnimateClose)(dest);
    },
  }));

  React.useEffect(() => {
    if (alwaysOpen && (actualModalHeight || adjustToContentHeight)) {
      handleAnimateOpen(alwaysOpen);
    }
  }, [alwaysOpen, actualModalHeight]);

  // Manage back button listener based on visibility
  React.useEffect(() => {
    let backButtonListener: NativeEventSubscription | null = null;

    if (isVisible) {
      backButtonListener = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    }

    return () => {
      backButtonListener?.remove();
    };
  }, [isVisible, handleBackPress]);

  React.useEffect(() => {
    invariant(
      modalHeight && adjustToContentHeight,
      `You can't use both 'modalHeight' and 'adjustToContentHeight' props at the same time. Only choose one of the two.`,
    );
    // Note: Removed validation for scrollViewProps, flatListProps, sectionListProps
    // as we now only support renderChildren
  }, [modalHeight, adjustToContentHeight, children]);

  React.useEffect(() => {
    setActualModalHeight(initialModalHeight);
  }, [adjustToContentHeight, modalHeight, screenHeight]);

  React.useEffect(() => {
    let keyboardShowListener: EmitterSubscription | null = null;
    let keyboardHideListener: EmitterSubscription | null = null;

    // Note: In Reanimated v3, we don't need to manually add listeners for shared values
    // The beginScrollY value will be automatically tracked when used in derived values

    if (isBelowRN65) {
      Keyboard.addListener('keyboardDidShow', handleKeyboardShow);
      Keyboard.addListener('keyboardDidHide', handleKeyboardHide);
    } else {
      keyboardShowListener = Keyboard.addListener('keyboardDidShow', handleKeyboardShow);
      keyboardHideListener = Keyboard.addListener('keyboardDidHide', handleKeyboardHide);
    }

    return (): void => {
      if (isBelowRN65) {
        Keyboard.removeListener('keyboardDidShow', handleKeyboardShow);
        Keyboard.removeListener('keyboardDidHide', handleKeyboardHide);
      } else {
        keyboardShowListener?.remove();
        keyboardHideListener?.remove();
      }
    };
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const translateYValue = value.value;

    // Optimized calculation with early return and cached bounds
    if (translateYValue <= 0) {
      return { transform: [{ translateY: 0 }] };
    }

    // Cache the bounds to avoid repeated calculations
    const clampedValue = Math.max(-40, Math.min(maxModalHeight, translateYValue));
    return { transform: [{ translateY: clampedValue }] };
  });

  // Memoize keyboard avoiding view props to prevent unnecessary re-creation
  const keyboardAvoidingViewProps =
    React.useMemo((): Animated.AnimateProps<KeyboardAvoidingViewProps> => {
      const props: Animated.AnimateProps<KeyboardAvoidingViewProps> = {
        keyboardVerticalOffset: keyboardAvoidingOffset,
        behavior: keyboardAvoidingBehavior,
        enabled: avoidKeyboardLikeIOS,
        style: [
          s.modalize__content,
          modalStyle,
          {
            height: actualModalHeight,
            maxHeight: maxModalHeight,
          },
          animatedStyle,
        ],
      };

      if (!avoidKeyboardLikeIOS && !adjustToContentHeight) {
        props.onLayout = handleModalizeContentLayout;
      }

      return props;
    }, [
      keyboardAvoidingOffset,
      keyboardAvoidingBehavior,
      avoidKeyboardLikeIOS,
      modalStyle,
      actualModalHeight,
      maxModalHeight,
      animatedStyle,
      adjustToContentHeight,
      handleModalizeContentLayout,
    ]);

  const renderModalize = (
    <View
      style={[s.modalize, rootStyle]}
      pointerEvents={alwaysOpen || !withOverlay ? 'box-none' : 'auto'}
    >
      {/* GestureDetector for pan gestures - handles all swipe actions */}
      <GestureDetector gesture={panGestureModalize}>
        <View style={s.modalize__wrapper} pointerEvents="box-none">
          {showContent && (
            <AnimatedKeyboardAvoidingView
              {...keyboardAvoidingViewProps}
              testID="AnimatedKeyboardAvoidingView"
            >
              <Handle
                withHandle={withHandle}
                handlePosition={handlePosition}
                handleStyle={handleStyle}
              />
              <HeaderAndFooter
                component={HeaderComponent}
                name="header"
                panGestureComponentEnabled={panGestureComponentEnabled}
                handleComponentLayout={handleComponentLayout}
              />
              <ModalizeContent
                renderChildren={renderChildren}
                childrenStyle={childrenStyle}
                adjustToContentHeight={adjustToContentHeight}
                contentRef={contentRef}
                contentViewRef={contentViewRef}
                handleContentLayout={handleContentLayout}
                handleScroll={handleScroll}
                enableBounces={enableBounces.value}
                keyboardToggle={keyboardToggle}
                disableScroll={disableScroll}
              >
                {children}
              </ModalizeContent>
              <HeaderAndFooter
                component={FooterComponent}
                name="footer"
                panGestureComponentEnabled={panGestureComponentEnabled}
                handleComponentLayout={handleComponentLayout}
              />
            </AnimatedKeyboardAvoidingView>
          )}

          <HeaderAndFooter
            component={FloatingComponent}
            name="floating"
            panGestureComponentEnabled={panGestureComponentEnabled}
            handleComponentLayout={handleComponentLayout}
          />
          {/* Overlay with separate tap gesture detector */}
          <GestureDetector gesture={tapGestureOverlay}>
            <Overlay
              withOverlay={withOverlay}
              alwaysOpen={alwaysOpen}
              modalPosition={modalPosition}
              showContent={showContent}
              overlayStyle={{ ...(overlayStyle as Record<string, unknown>), zIndex: 1 }}
              overlay={overlay}
            />
          </GestureDetector>
        </View>
      </GestureDetector>
    </View>
  );

  const renderReactModal = useCallback(
    (child: JSX.Element): JSX.Element => (
      <Modal
        {...reactModalProps}
        testID={`${testID ?? 'Modalize'}.Modal`}
        supportedOrientations={['landscape', 'portrait', 'portrait-upside-down']}
        onRequestClose={handleBackPress}
        hardwareAccelerated={USE_NATIVE_DRIVER}
        visible={isVisible}
        transparent
      >
        {child}
      </Modal>
    ),
    [reactModalProps, handleBackPress, isVisible],
  );

  if (!isVisible) {
    return null;
  }

  if (withReactModal) {
    return renderReactModal(renderModalize);
  }

  return renderModalize;
};

export type ModalizeProps = IProps;
export type Modalize = IHandles;

export const Modalize = React.memo(React.forwardRef(_ModalizeBase));
export * from './utils/use-modalize';

export type { HandleProps } from './components/Handle';
export type { HeaderAndFooterProps } from './components/HeaderAndFooter';
export type { ModalizeContentProps } from './components/ModalizeContent';
export type { OverlayProps } from './components/Overlay';
