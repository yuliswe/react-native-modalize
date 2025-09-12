/**
 * esModuleInterop: true looks to work everywhere except
 * on snack.expo for some reason. Will revisit this later.
 */
import React, { useCallback } from 'react';
import {
  BackHandler,
  Easing,
  Modal,
  Platform,
  StatusBar,
  View,
  type NativeEventSubscription,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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
import { Overlay } from './components/Overlay';
import { IHandles, IProps, TClose, TOpen, TPosition } from './options';
import s from './styles';
import { LayoutEvent, PanGestureEvent, PanGestureStateEvent } from './types';
import { useDimensions } from './utils/use-dimensions';

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

const ModalizeBase = (props: IProps, ref: React.Ref<React.ReactNode>) => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const {
    testID,

    // Renderers
    children,

    // Styles
    rootStyle,
    modalStyle,
    handleStyle,
    overlayStyle,
    childrenStyle,

    // Layout
    snapPoints,
    modalTopOffset = DEFAULT_MODAL_TOP_OFFSET,
    alwaysOpen,

    // Options
    handlePosition = 'outside',
    panGestureEnabled = true,
    tapGestureEnabled = true,
    closeOnOverlayTap = true,
    closeSnapPointStraightEnabled = true,

    // Animations
    openAnimationConfig = DEFAULT_OPEN_ANIMATION_CONFIG,
    closeAnimationConfig = DEFAULT_CLOSE_ANIMATION_CONFIG,
    dragToss = 0.18,
    threshold = 120,
    velocity = 2800,
    translateY: externalTranslateY,
    panGesture: externalPanGesture,
    useNativeDriver = true,

    // Elements visibilities
    withReactModal = false,
    reactModalProps,
    withHandle = true,
    withOverlay = true,

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

  /** Initial height when modal opens (undefined if adjusting to content height) */

  /** Snap points: [closed, snapPoints..., fullOpen] or [closed, fullOpen] */
  const snaps = React.useMemo(() => {
    if (!snapPoints || snapPoints.length === 0) {
      return [0, availableScreenHeight];
    }

    // Pre-allocate array with known size to avoid dynamic resizing
    const snapDistances = new Array(snapPoints.length);
    for (let i = 0; i < snapPoints.length; i++) {
      snapDistances[i] = availableScreenHeight - snapPoints[i];
    }

    // Use Set for deduplication, then convert back to sorted array
    const uniqueSnaps = new Set([0, ...snapDistances, availableScreenHeight]);
    return Array.from(uniqueSnaps).sort((a, b) => a - b);
  }, [snapPoints, availableScreenHeight]);

  const [_actualModalHeight, setActualModalHeight] = React.useState<number | undefined>(undefined);

  /** Current actual height of the modal (can change based on content) */
  const actualModalHeight = _actualModalHeight;

  // UI thread only states - moved to shared values
  const beginScrollYValue = useSharedValue(0);
  const lastSnap = useSharedValue(0);
  const modalPosition = useSharedValue<TPosition>('initial');

  // Initialize lastSnap based on snap points
  React.useEffect(() => {
    if (snapPoints && snapPoints.length > 0) {
      lastSnap.value = availableScreenHeight - snapPoints[0];
    }
  }, [snapPoints, availableScreenHeight, lastSnap]);

  // JS thread states - optimized with useMemo for initial values
  const [isVisible, setIsVisible] = React.useState(false);
  const [showContent, setShowContent] = React.useState(true);

  const [cancelClose, setCancelClose] = React.useState(false);

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

  const handleAnimateOpen = useCallback(
    (alwaysOpenValue: number | undefined, dest: TOpen = 'default'): void => {
      'worklet';

      const { timing } = openAnimationConfig;

      let toValue = 0;
      let newPosition: TPosition;

      if (dest === 'top') {
        toValue = 0;
      } else if (alwaysOpenValue) {
        toValue = (actualModalHeight || 0) - alwaysOpenValue;
      } else if (snapPoints && snapPoints.length > 0) {
        toValue = availableScreenHeight - snapPoints[0]; // Use first snap point for initial open
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
    },
    [
      openAnimationConfig,
      actualModalHeight,
      snapPoints,
      availableScreenHeight,
      onOpened,
      onPositionChange,
      modalPosition,
      translateY,
      overlay,
    ],
  );

  const handleContentLayout = useCallback(
    (event: LayoutEvent): void => {
      if (onLayout) {
        onLayout(event);
      }

      const { height } = event.nativeEvent.layout;

      return setActualModalHeight(height);
    },
    [onLayout],
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
      })
      .onChange((event: PanGestureEvent) => {
        'worklet';
        const { translationY } = event;

        // Update dragY for animation
        dragY.value = translationY;
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
            if (nearestSnap === availableScreenHeight) {
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
    availableScreenHeight,
    useNativeDriver,
    onPositionChange,
    handleAnimateClose,
    actualModalHeight,
    snaps,
    overlay,
    translateY,
    dragY,
    beginScrollY,
    setCancelClose,
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
    if (alwaysOpen) {
      handleAnimateOpen(alwaysOpen);
    }
  }, [alwaysOpen, handleAnimateOpen]);

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

  const animatedStyle = useAnimatedStyle(() => {
    const translateYValue = value.value;

    // Optimized calculation with early return and cached bounds
    if (translateYValue <= 0) {
      return { transform: [{ translateY: 0 }] };
    }

    // Cache the bounds to avoid repeated calculations
    const clampedValue = Math.max(-40, Math.min(availableScreenHeight, translateYValue));
    return { transform: [{ translateY: clampedValue }] };
  });

  const animatedViewStyle = React.useMemo(() => {
    return [
      s.modalize__content,
      {
        height: actualModalHeight,
        maxHeight: availableScreenHeight,
      },
      animatedStyle,
    ];
  }, [actualModalHeight, availableScreenHeight, animatedStyle]);

  const renderModalize = (
    <View
      style={[s.modalize, rootStyle]}
      pointerEvents={alwaysOpen || !withOverlay ? 'box-none' : 'auto'}
    >
      {/* GestureDetector for pan gestures - handles all swipe actions */}
      <GestureDetector gesture={panGestureModalize}>
        <View style={s.modalize__wrapper} pointerEvents="box-none">
          <GestureDetector gesture={tapGestureOverlay}>
            <Overlay
              withOverlay={withOverlay}
              alwaysOpen={alwaysOpen}
              modalPosition={modalPosition}
              showContent={showContent}
              overlayStyle={overlayStyle}
              overlay={overlay}
            />
          </GestureDetector>
          {showContent && (
            <Animated.View
              style={animatedViewStyle}
              testID="Modalize.ModalWrapper(Animated.View)"
              onLayout={handleContentLayout}
            >
              <View style={modalStyle}>
                <Handle
                  withHandle={withHandle}
                  handlePosition={handlePosition}
                  handleStyle={handleStyle}
                />
                <View style={[s.content__adjustHeight, childrenStyle]} testID="Modalize.Content">
                  {children}
                </View>
              </View>
            </Animated.View>
          )}
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
    [reactModalProps, handleBackPress, isVisible, testID],
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

export const Modalize = React.memo(React.forwardRef(ModalizeBase));
export * from './utils/use-modalize';

export type { HandleProps } from './components/Handle';
export type { HeaderAndFooterProps } from './components/HeaderAndFooter';
export type { OverlayProps } from './components/Overlay';
