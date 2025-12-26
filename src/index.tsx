/**
 * esModuleInterop: true looks to work everywhere except
 * on snack.expo for some reason. Will revisit this later.
 */
import React, { useCallback, useMemo } from 'react';
import { BackHandler, View, type NativeEventSubscription } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS as runOnJSThread,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { InitialSnapPointIndex, ModalizeProps, TStyle } from './options';
import { default as s } from './styles';
import { LayoutEvent, PanGestureEvent, PanGestureStateEvent } from './types';
import { useDimensions } from './utils/use-dimensions';
import type { ModalizeRef } from './utils/use-modalize';
import { useKeyboardHeight } from './utils/useKeyboardHeight';
import { useStateWithSharedValue } from './utils/useStateWithSharedValue';

// Animation constants
const DEFAULT_OPEN_ANIMATION_DURATION = 280;
const DEFAULT_CLOSE_ANIMATION_DURATION = 280;
const DEFAULT_SNAP_ANIMATION_DURATION = 300;
const DEFAULT_OVERDRAG_BOUNCE_DURATION = 100;
const DEFAULT_OPEN_ANIMATION_EASING = Easing.out(Easing.ease);
const DEFAULT_CLOSE_ANIMATION_EASING = Easing.ease;
const DEFAULT_SNAP_ANIMATION_EASING = Easing.out(Easing.ease);
const DEFAULT_OVERDRAG_BOUNCE_EASING = Easing.out(Easing.ease);

/**
 * Calculate overdrag resistance effect.
 * This function applies a resistance curve that becomes stronger the further you drag.
 * @param offset - The distance dragged beyond the normal bounds
 * @param resistance - The resistance factor (higher = more resistance)
 * @returns The adjusted offset with resistance applied
 */
const calculateOverdragResistance = (offset: number, resistance: number): number => {
  'worklet';
  if (offset === 0) return 0;

  // Use a logarithmic resistance curve for smooth, natural feeling
  const sign = Math.sign(offset);
  const absOffset = Math.abs(offset);

  // Apply resistance using a dampening formula
  // Higher resistance values = more resistance (less movement)
  // Invert resistance so higher values mean more resistance
  const actualResistance = 1 / resistance;
  const dampenedOffset = Math.log(1 + absOffset / actualResistance) * actualResistance;

  return sign * dampenedOffset;
};

interface HandleProps {
  handlePosition: 'inside' | 'outside';
  handleStyle?: TStyle;
}

function HandleComponent({ handlePosition, handleStyle }: HandleProps) {
  const handleStyles: (TStyle | undefined)[] = [s.handle];
  const shapeStyles: (TStyle | undefined)[] = [s.handle__shape, handleStyle];
  const isHandleOutside = handlePosition === 'outside';

  if (!isHandleOutside) {
    handleStyles.push(s.handleBottom);
    shapeStyles.push(s.handle__shapeBottom, handleStyle);
  }

  return (
    <Animated.View style={handleStyles} testID="Modalize.Handle">
      <View style={shapeStyles} />
    </Animated.View>
  );
}

const Handle = React.memo(HandleComponent);

interface OverlayProps {
  overlayStyle?: TStyle;
  overlay?: SharedValue<number>;
}

function OverlayComponent({ overlayStyle, overlay }: OverlayProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const opacity = overlay ? overlay.value : 0;

    return {
      opacity,
      pointerEvents: 'auto',
    };
  });

  return (
    <Animated.View style={s.overlay} testID="Modalize.Overlay">
      <Animated.View style={[s.overlay__background, overlayStyle, animatedStyle]} />
    </Animated.View>
  );
}

const Overlay = React.memo(OverlayComponent);

const ModalizeBase = (props: ModalizeProps, ref: React.Ref<ModalizeRef>) => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const {
    testID,

    // Renderers
    children,

    // Styles
    rootStyle,
    handleStyle,
    overlayStyle,

    // Layout
    initialSnapPointIndex = InitialSnapPointIndex.FullyOpen,
    modalTopOffset = 0,
    isOpen: externalIsOpen,

    // Options
    handlePosition = 'outside',
    closeOnOverlayTap = true,

    // Animations
    openAnimationDuration = DEFAULT_OPEN_ANIMATION_DURATION,
    openAnimationEasing = DEFAULT_OPEN_ANIMATION_EASING,
    openAnimationDelay,
    openAnimationIsInteraction,
    closeAnimationDuration = DEFAULT_CLOSE_ANIMATION_DURATION,
    closeAnimationEasing = DEFAULT_CLOSE_ANIMATION_EASING,
    closeAnimationDelay,
    closeAnimationIsInteraction,
    dragToss = 0.18,
    threshold = 120,
    velocity = 2800,
    translateY: externalTranslateY,
    panGesture: externalPanGesture,

    withHandle = true,
    withOverlay = true,
    avoidKeyboard = false,

    // Overdrag animation
    enableOverdrag = false,
    overdragResistance = 0.05,
    overdragBounceDuration = 400,
    overdragBounceEasing = DEFAULT_OVERDRAG_BOUNCE_EASING,

    // Callbacks
    onWillOpen,
    onDidOpen,
    onWillClose,
    onDidClose,
    onBackButtonPress,
    onOverlayPress,
    onLayout,
  } = props;

  const { height: screenHeight, width: screenWidth } = useDimensions();
  const { keyboardHeight: rawKeyboardHeight } = useKeyboardHeight();

  const avoidKeyboardShared = useSharedValue(avoidKeyboard);

  React.useEffect(() => {
    avoidKeyboardShared.value = avoidKeyboard;
  }, [avoidKeyboard, avoidKeyboardShared]);

  const keyboardHeight = useDerivedValue(() => {
    'worklet';
    return avoidKeyboardShared.value ? rawKeyboardHeight.value : 0;
  }, [avoidKeyboardShared, rawKeyboardHeight]);

  /** Height available for the modal after accounting for top offset (status bar, etc.) */
  const availableScreenHeight = useDerivedValue(() => {
    'worklet';
    return screenHeight - modalTopOffset - (avoidKeyboardShared.value ? keyboardHeight.value : 0);
  }, [screenHeight, modalTopOffset]);

  // UI thread only states - moved to shared values
  const lastSnapY = useSharedValue(-1);

  const childContentHeight = useSharedValue<number | null>(null);

  /** Snap points: [closed, snapPoints..., fullOpen] or [closed, fullOpen] */
  const processedSnapPointsY = useDerivedValue(() => {
    'worklet';

    const contentHeight = childContentHeight.value;

    if (contentHeight === null) {
      // While waiting for the content to be measured, render off screen
      return [availableScreenHeight.value];
    }

    if (!props.snapPoints || props.snapPoints.length === 0) {
      if (props.alwaysOpen) {
        return [0]; // Fully open
      }
      return [
        0, // Fully open
        contentHeight, // Closed
      ];
    }
    // Convert snap points (heights) to actual distances (translateY) and sort
    return Array.from(
      new Set(
        props.snapPoints
          .map(val => contentHeight - Math.min(contentHeight, Math.max(val, 0)))
          .concat([
            0, // Open
            props.alwaysOpen ? 0 : contentHeight, // Closed
          ]),
      ),
    )

      .sort((a, b) => a - b);
  }, [props.snapPoints, childContentHeight, availableScreenHeight]);

  // JS thread states - optimized with useMemo for initial values
  const [isVisible, setIsVisible, isVisibleShared] = useStateWithSharedValue(false);

  const [internalIsOpen, setInternalIsOpen, _internalIsOpenShared] = useStateWithSharedValue(true);
  const isOpen = externalIsOpen ?? internalIsOpen;

  const [cancelClose, setCancelClose, _cancelCloseShared] = useStateWithSharedValue(false);

  // Animation state tracking to prevent double animations
  const [isAnimating, setIsAnimating, isAnimatingShared] = useStateWithSharedValue(false);

  const cancelTranslateY = useSharedValue(1); // 1 by default to have the translateY animation running
  const overlay = useSharedValue(0);
  const dragY = useSharedValue(0);
  const overdragHeightIncr = useSharedValue(0); // Track height increase during overdrag
  const targetTranslateY = useSharedValue(screenHeight); // Where the modal is moving toward

  const handleWillCloseOnJSThread = useCallback(() => {
    onWillClose?.();
    setInternalIsOpen(false);
  }, [onWillClose, setInternalIsOpen]);

  const handleDidCloseOnJSThread = useCallback(() => {
    setIsVisible(false);
    setIsAnimating(false);
    onDidClose?.();
  }, [onDidClose, setIsVisible, setIsAnimating]);

  const startAnimateCloseOnUIThread = useCallback((): void => {
    'worklet';

    runOnJSThread(handleWillCloseOnJSThread)();

    // Set animation state to prevent double animations
    runOnJSThread(setIsAnimating)(true);

    cancelTranslateY.value = 1;

    // Calculate current visual position and update translateY to start from there
    targetTranslateY.value = targetTranslateY.value + dragY.value;
    dragY.value = 0;

    // Animate overlay
    overlay.value = withTiming(0, {
      duration: closeAnimationDuration,
      easing: closeAnimationEasing,
    });

    // Reset dragY on UI thread
    dragY.value = 0;

    // Animate translateY from current position to destination
    targetTranslateY.value = withTiming(
      screenHeight,
      {
        duration: closeAnimationDuration,
        easing: closeAnimationEasing,
      },
      finished => {
        'worklet';
        if (finished) {
          runOnJSThread(handleDidCloseOnJSThread)();
        }
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    closeAnimationDuration,
    closeAnimationEasing,
    closeAnimationDelay,
    closeAnimationIsInteraction,
    props.snapPoints,
    processedSnapPointsY,
    screenHeight,
    onDidClose,
    onWillClose,
  ]);

  const handleBackPress = useCallback((): boolean => {
    if (onBackButtonPress) {
      return onBackButtonPress();
    } else {
      startAnimateCloseOnUIThread();
    }

    return true;
  }, [onBackButtonPress, startAnimateCloseOnUIThread]);

  const handleWillOpenOnJSThread = useCallback(() => {
    onWillOpen?.();
    setInternalIsOpen(true);
    setIsAnimating(true);
    setIsVisible(true);
  }, [onWillOpen, setInternalIsOpen, setIsAnimating, setIsVisible]);

  const handleDidOpenOnJSThread = useCallback(() => {
    onDidOpen?.();
    setIsAnimating(false);
  }, [onDidOpen, setIsAnimating]);

  const startAnimateOpenOnUIThread = useCallback(
    () => {
      'worklet';

      // If we don't have the content height yet (first open), defer the animation
      if (childContentHeight.value === null) {
        console.error('Call startAnimateOpenJSThreadWrapper instead of startAnimateOpenOnUIThread');
        return;
      }

      let toValueY = 0;

      const snapsY = processedSnapPointsY.value;
      const shouldUseLastSnap = lastSnapY.value !== -1;

      if (shouldUseLastSnap) {
        toValueY = lastSnapY.value;
      } else if (snapsY && snapsY.length > 0) {
        const snapValueY =
          initialSnapPointIndex === InitialSnapPointIndex.FullyOpen
            ? 0
            : snapsY[initialSnapPointIndex % snapsY.length];

        toValueY = snapValueY; // Convert height to distance
      } else {
        toValueY = 0;
      }

      lastSnapY.value = toValueY;

      overlay.value = withTiming(1, {
        duration: openAnimationDuration,
        easing: openAnimationEasing,
      });

      targetTranslateY.value = withTiming(
        toValueY,
        {
          duration: openAnimationDuration,
          easing: openAnimationEasing,
        },
        finished => {
          'worklet';
          if (finished) {
            runOnJSThread(handleDidOpenOnJSThread)();
          }
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      openAnimationDuration,
      openAnimationEasing,
      openAnimationDelay,
      openAnimationIsInteraction,
      processedSnapPointsY.value,
      props.snapPoints?.length,
      initialSnapPointIndex,
      availableScreenHeight,
      onDidOpen,
    ],
  );

  const startAnimateOpenJSThreadWrapper = useCallback(async () => {
    if (isAnimating || isVisible) {
      return;
    }

    handleWillOpenOnJSThread();

    while (childContentHeight.value === null) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }

    startAnimateOpenOnUIThread();
  }, [
    childContentHeight,
    isAnimating,
    isVisible,
    handleWillOpenOnJSThread,
    startAnimateOpenOnUIThread,
  ]);

  const handleChildrenLayout = useCallback(
    (event: LayoutEvent): void => {
      const height = event.nativeEvent.layout.height;
      childContentHeight.value = height;

      onLayout?.(event);
    },
    [onLayout, childContentHeight],
  );

  // V2 Gesture definitions with proper composition
  const panGestureModalize = React.useMemo(() => {
    let willCloseModalize = false;

    // Start with external pan gesture if provided, otherwise create new one
    const baseGesture = externalPanGesture ?? Gesture.Pan();

    return baseGesture
      .shouldCancelWhenOutside(false)
      .onStart(() => {
        'worklet';

        // Handle pan begin for main modalize
        runOnJSThread(setCancelClose)(false);

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

        const { velocityY, translationY } = event;
        // Removed negativeReverseScroll as it's no longer needed with the new snap logic

        let destSnapPointY = lastSnapY.value; // Start with current position

        const endOffsetY = lastSnapY.value + translationY + dragToss * velocityY;

        // Get current snaps array (always available, defaults to [0, contentHeight] when no snapPoints)
        const snapsY = processedSnapPointsY.value;

        // Find the nearest snap point with optimized search
        let nearestSnapY = snapsY[0];
        let minDistance = Math.abs(snapsY[0] - endOffsetY);

        // Use for loop instead of forEach for better performance
        for (let i = 1; i < snapsY.length; i++) {
          const snap = snapsY[i];
          const distFromSnap = Math.abs(snap - endOffsetY);

          if (distFromSnap < minDistance) {
            minDistance = distFromSnap;
            nearestSnapY = snap;
          }
        }

        destSnapPointY = nearestSnapY;

        // Use childContentHeight if available, otherwise fall back to availableScreenHeight
        const contentHeight =
          childContentHeight.value !== null
            ? childContentHeight.value
            : availableScreenHeight.value;

        if (nearestSnapY >= contentHeight) {
          // User tossed below the lowest snap point
          if (props.alwaysOpen) {
            destSnapPointY = snapsY[snapsY.length - 1]; // Lowest snap point
            willCloseModalize = false;
          } else {
            // Uncontrolled component - close the modal
            willCloseModalize = true;
            startAnimateCloseOnUIThread();
          }
        } else {
          // Snap to snap point or full open - don't close
          willCloseModalize = false;
        }

        if (willCloseModalize) {
          return;
        }

        // Calculate the current visual position (where the modal actually is visually)
        const currentVisualPosition = targetTranslateY.value + dragY.value;
        targetTranslateY.value = currentVisualPosition;
        dragY.value = 0;

        // If we're in overdrag territory, bounce back to nearest valid position
        if (currentVisualPosition < 0) {
          // Overdragged upward - bounce to top bound or closest snap point
          const bounceTarget = Math.min(destSnapPointY, 0);

          // Use bounce animation with spring physics for natural feel
          targetTranslateY.value = withTiming(bounceTarget, {
            duration: DEFAULT_OVERDRAG_BOUNCE_DURATION,
            easing: DEFAULT_OVERDRAG_BOUNCE_EASING,
          });

          lastSnapY.value = bounceTarget;

          return;
        }
        // Update lastSnap to the destination snap point for next gesture
        lastSnapY.value = destSnapPointY;

        // Animate to destination snap point
        targetTranslateY.value = withTiming(destSnapPointY, {
          duration: DEFAULT_SNAP_ANIMATION_DURATION,
          easing: DEFAULT_SNAP_ANIMATION_EASING,
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    externalPanGesture,
    threshold,
    velocity,
    props.snapPoints,
    cancelClose,
    dragToss,
    processedSnapPointsY,
    startAnimateCloseOnUIThread,
    enableOverdrag,
    overdragResistance,
    overdragBounceDuration,
    overdragBounceEasing,
  ]);

  const tapGestureOverlay = React.useMemo(
    () =>
      Gesture.Tap()
        .enabled(closeOnOverlayTap)
        .onStart(() => {
          'worklet';

          if (onOverlayPress) {
            runOnJSThread(onOverlayPress)();
          }

          startAnimateCloseOnUIThread();
        })
        .requireExternalGestureToFail(panGestureModalize),
    [closeOnOverlayTap, onOverlayPress, startAnimateCloseOnUIThread, panGestureModalize],
  );

  // Separate gesture detectors:
  // 1. Pan gesture for all swipe actions (modal content and overlay)
  // 2. Tap gesture only for overlay closing

  React.useImperativeHandle(
    ref,
    () => ({
      open() {
        // Prevent opening if already animating
        if (isAnimating || isVisible) {
          return;
        }

        void startAnimateOpenJSThreadWrapper();
      },

      close() {
        // Prevent closing if already animating
        if (isAnimating || !isVisible) {
          return;
        }

        startAnimateCloseOnUIThread();
      },
    }),
    [isAnimating, isVisible, startAnimateOpenJSThreadWrapper, startAnimateCloseOnUIThread],
  );

  React.useEffect(() => {
    // Prevent animations if already animating to avoid double animations
    if (isAnimating) {
      return;
    }

    if (isOpen && !isVisible) {
      void startAnimateOpenJSThreadWrapper();
    } else if (!isOpen && isVisible) {
      startAnimateCloseOnUIThread();
    }
  }, [
    isOpen,
    isVisible,
    isAnimating,
    startAnimateOpenJSThreadWrapper,
    startAnimateCloseOnUIThread,
  ]);

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

  const animatedModalStyle = useAnimatedStyle(() => {
    'worklet';

    if (childContentHeight.value === null) {
      return {
        transform: [{ translateY: screenHeight }],
        height: 0,
        overflow: 'hidden',
      };
    }

    // Calculate the base translateY value
    const draggedAndAnimiatedY = (targetTranslateY.value + dragY.value) * cancelTranslateY.value;

    let finalTranslateY: number;
    let heightIncrease = 0;

    // Calculate overdrag bounds
    const topBound = -keyboardHeight.value;

    // Check if we're in overdrag territory
    if (draggedAndAnimiatedY < topBound) {
      // Overdrag upward (above top bound) - increase height instead of moving up
      const overdragOffset = draggedAndAnimiatedY - topBound;
      const resistedOffset = calculateOverdragResistance(overdragOffset, overdragResistance);
      finalTranslateY = topBound; // Keep modal at top bound
      heightIncrease = Math.abs(resistedOffset); // Convert to positive height increase
    } else {
      // Within normal bounds
      finalTranslateY = draggedAndAnimiatedY;
    }

    // Update the shared value for height increase
    overdragHeightIncr.value = heightIncrease;

    if (externalTranslateY) {
      externalTranslateY.value = 1 - finalTranslateY / availableScreenHeight.value;
    }

    console.log('finalTranslateY', finalTranslateY);

    return {
      transform: [{ translateY: finalTranslateY }],
      height:
        childContentHeight.value === null
          ? availableScreenHeight.value
          : Math.min(childContentHeight.value + keyboardHeight.value, screenHeight) +
            heightIncrease,
    };
  }, []);

  const modalStyle = useMemo(() => {
    return [s.modalStyle, props.modalStyle, animatedModalStyle];
  }, [props.modalStyle, animatedModalStyle]);

  const childrenStyle = useMemo(() => {
    return [
      s.childrenStyle,
      props.childrenStyle,
      {
        width: screenWidth,
        maxHeight: availableScreenHeight.value,
      },
    ];
  }, [props.childrenStyle, screenWidth, availableScreenHeight.value]);

  if (!isVisible) {
    return null;
  }

  console.log('isVisible', isVisible);
  console.log('modalStyle', modalStyle);
  console.log('animatedModalStyle.transform', animatedModalStyle.transform);

  // Make sure the children height is exactly the same as the modal height. Ie,
  // only use padding in the children. Do not use margin. This is the only way
  // to make the layout calculated correctly.
  return (
    <View style={[s.modalize, rootStyle]} pointerEvents={!withOverlay ? 'box-none' : 'auto'}>
      {/* GestureDetector for pan gestures - handles all swipe actions */}
      <GestureDetector gesture={panGestureModalize}>
        <View style={s.modalize__wrapper} pointerEvents="box-none">
          {withOverlay && (
            <GestureDetector gesture={tapGestureOverlay}>
              <Overlay overlayStyle={overlayStyle} overlay={overlay} />
            </GestureDetector>
          )}
          <Animated.View style={modalStyle} testID="Modalize.Content(Animated.View)">
            {withHandle && <Handle handlePosition={handlePosition} handleStyle={handleStyle} />}
            <View
              style={childrenStyle}
              onLayout={handleChildrenLayout}
              testID="Modalize.Content.View.Children"
            >
              {children}
            </View>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
};

export { ModalizeProps } from './options';
export * from './utils/use-modalize';

export const Modalize = React.memo(React.forwardRef(ModalizeBase));
