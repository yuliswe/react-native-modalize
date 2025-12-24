/**
 * esModuleInterop: true looks to work everywhere except
 * on snack.expo for some reason. Will revisit this later.
 */
import React, { useCallback, useMemo } from 'react';
import { BackHandler, Modal, View, type NativeEventSubscription } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { ModalizeProps, TOpen, TPosition, TStyle } from './options';
import { default as s } from './styles';
import { LayoutEvent, PanGestureEvent, PanGestureStateEvent } from './types';
import { useDimensions } from './utils/use-dimensions';
import type { ModalizeRef } from './utils/use-modalize';
import { useKeyboardHeight } from './utils/useKeyboardHeight';

// Removed SCROLL_THRESHOLD as it's no longer needed with the new snap logic
const USE_NATIVE_DRIVER = true;

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
  withHandle: boolean;
  handlePosition: 'inside' | 'outside';
  handleStyle?: TStyle;
}

function HandleComponent({ withHandle, handlePosition, handleStyle }: HandleProps) {
  const handleStyles: (TStyle | undefined)[] = [s.handle];
  const shapeStyles: (TStyle | undefined)[] = [s.handle__shape, handleStyle];
  const isHandleOutside = handlePosition === 'outside';

  if (!withHandle) {
    return null;
  }

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
  withOverlay: boolean;
  showContent: boolean;
  overlayStyle?: TStyle;
  overlay?: SharedValue<number>;
}

function OverlayComponent({ withOverlay, showContent, overlayStyle, overlay }: OverlayProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const opacity = overlay ? overlay.value : 0;

    return {
      opacity,
      pointerEvents: 'auto',
    };
  });

  if (!withOverlay) {
    return null;
  }

  return (
    <Animated.View style={s.overlay} testID="Modalize.Overlay">
      {showContent && (
        <Animated.View style={[s.overlay__background, overlayStyle, animatedStyle]} />
      )}
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
    snapPoints = [1, 0],
    initialSnapPoint = 0,
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

    // Elements visibilities
    withReactModal = false,
    reactModalProps,
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
    onPositionChange,
    onOverlayPress,
    onLayout,
  } = props;

  const { height: screenHeight, width: screenWidth } = useDimensions();
  const { keyboardHeight: rawKeyboardHeight, isKeyboardVisible: rawIsKeyboardVisible } =
    useKeyboardHeight();

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
  const lastSnap = useSharedValue(0);
  const modalPosition = useSharedValue<TPosition>('initial');
  const childContentHeight = useSharedValue<number | null>(null);

  /** Snap points: [closed, snapPoints..., fullOpen] or [closed, fullOpen] */
  const snaps = useDerivedValue(() => {
    'worklet';

    if (!snapPoints || snapPoints.length === 0) {
      // Default to [1, 0] in percentage terms: 1 = open, 0 = closed
      // This translates to distances: [0, contentHeight]
      return [0, availableScreenHeight.value];
    }

    // Use childContentHeight if available, otherwise fall back to availableScreenHeight
    const contentHeight =
      childContentHeight.value !== null ? childContentHeight.value : availableScreenHeight.value;

    // Convert percentage-based snap points to actual distances
    // snapPoints are percentages: 0 = closed, 1 = fully open
    // actualDistance = contentHeight * (1 - percentage)
    const snapDistances = snapPoints.map(percentage => contentHeight * (1 - percentage));

    // Use Set for deduplication, then convert back to sorted array
    const uniqueSnaps = new Set(snapDistances);
    return Array.from(uniqueSnaps).sort((a, b) => a - b);
  }, [snapPoints, childContentHeight, availableScreenHeight]);

  /** Current actual height of the modal (can change based on content) */

  // Initialize lastSnap based on snap points
  React.useEffect(() => {
    if (snapPoints && snapPoints.length > 0) {
      runOnUI(() => {
        'worklet';
        const snapIndex = Math.min(initialSnapPoint, snapPoints.length - 1);
        const percentage = snapPoints[snapIndex];

        // Use childContentHeight if available, otherwise fall back to availableScreenHeight
        const contentHeight =
          childContentHeight.value !== null
            ? childContentHeight.value
            : availableScreenHeight.value;

        lastSnap.value = contentHeight * (1 - percentage);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapPoints, initialSnapPoint, availableScreenHeight, childContentHeight]);

  // JS thread states - optimized with useMemo for initial values
  const [isVisible, setIsVisible] = React.useState(false);
  const [showContent, setShowContent] = React.useState(true);

  const [internalIsOpen, setInternalIsOpen] = React.useState(true);
  const isOpen = externalIsOpen ?? internalIsOpen;

  const [cancelClose, setCancelClose] = React.useState(false);

  // Animation state tracking to prevent double animations
  const [isAnimating, setIsAnimating] = React.useState(false);

  const cancelTranslateY = useSharedValue(1); // 1 by default to have the translateY animation running
  const overlay = useSharedValue(0);
  const dragY = useSharedValue(0);
  const overdragHeightIncr = useSharedValue(0); // Track height increase during overdrag
  const animiatedTranslateY = useSharedValue(screenHeight);

  const handleWillCloseOnJS = useCallback(() => {
    onWillClose?.();
    setInternalIsOpen(false);
  }, [onWillClose]);

  const handleDidCloseOnJS = useCallback(() => {
    setShowContent(false);
    setIsVisible(false);
    setIsAnimating(false);
    onDidClose?.();
  }, [onDidClose]);

  const handleAnimateCloseOnUI = useCallback((): void => {
    'worklet';

    runOnJS(handleWillCloseOnJS)();

    // Set animation state to prevent double animations
    runOnJS(setIsAnimating)(true);

    cancelTranslateY.value = 1;

    // Calculate current visual position and update translateY to start from there
    animiatedTranslateY.value = animiatedTranslateY.value + dragY.value;
    dragY.value = 0;

    // Animate overlay
    overlay.value = withTiming(0, {
      duration: closeAnimationDuration,
      easing: closeAnimationEasing,
    });

    // Reset dragY on UI thread
    dragY.value = 0;

    // Animate translateY from current position to destination
    animiatedTranslateY.value = withTiming(
      screenHeight,
      {
        duration: closeAnimationDuration,
        easing: closeAnimationEasing,
      },
      finished => {
        'worklet';
        if (finished) {
          // Use childContentHeight if available, otherwise fall back to availableScreenHeight
          const contentHeight =
            childContentHeight.value !== null
              ? childContentHeight.value
              : availableScreenHeight.value;

          lastSnap.value = snapPoints ? contentHeight * (1 - snapPoints[0]) : 80;
          runOnJS(handleDidCloseOnJS)();
        }
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    closeAnimationDuration,
    closeAnimationEasing,
    closeAnimationDelay,
    closeAnimationIsInteraction,
    snapPoints,
    snaps,
    screenHeight,
    onDidClose,
    onWillClose,
  ]);

  const handleBackPress = useCallback((): boolean => {
    if (onBackButtonPress) {
      return onBackButtonPress();
    } else {
      handleAnimateCloseOnUI();
    }

    return true;
  }, [onBackButtonPress, handleAnimateCloseOnUI]);

  const handleWillOpenOnJS = useCallback(() => {
    onWillOpen?.();
    setInternalIsOpen(true);
    setIsAnimating(true);
    setIsVisible(true);
    setShowContent(true);
  }, [onWillOpen]);

  const handleDidOpenOnJS = useCallback(() => {
    onDidOpen?.();
    setIsAnimating(false);
  }, [onDidOpen]);

  const handleAnimateOpenOnUI = useCallback(
    (dest: TOpen = 'default'): void => {
      'worklet';

      let toValue = 0;

      if (dest === 'top') {
        toValue = 0;
        modalPosition.value = 'top';
      } else if (snapPoints && snapPoints.length > 0) {
        const snapIndex = Math.min(initialSnapPoint, snapPoints.length - 1);
        const percentage = snapPoints[snapIndex];

        // Use childContentHeight if available, otherwise fall back to availableScreenHeight
        const contentHeight =
          childContentHeight.value !== null
            ? childContentHeight.value
            : availableScreenHeight.value;

        toValue = contentHeight * (1 - percentage); // Convert percentage to actual distance
        modalPosition.value = 'initial';
      } else {
        toValue = 0;
        modalPosition.value = 'top';
      }

      runOnJS(handleWillOpenOnJS)();

      overlay.value = withTiming(1, {
        duration: openAnimationDuration,
        easing: openAnimationEasing,
      });

      animiatedTranslateY.value = withTiming(
        toValue,
        {
          duration: openAnimationDuration,
          easing: openAnimationEasing,
        },
        finished => {
          'worklet';
          if (finished) {
            runOnJS(handleDidOpenOnJS)();
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
      snapPoints,
      initialSnapPoint,
      availableScreenHeight,
      onDidOpen,
    ],
  );

  const handleChildrenLayout = useCallback(
    (event: LayoutEvent): void => {
      'worklet';
      childContentHeight.value = event.nativeEvent.layout.height;

      if (onLayout) {
        runOnJS(onLayout)(event);
      }
    },
    [onLayout],
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

        const { velocityY, translationY } = event;
        // Removed negativeReverseScroll as it's no longer needed with the new snap logic

        let destSnapPoint = lastSnap.value; // Start with current position

        const endOffsetY = lastSnap.value + translationY + dragToss * velocityY;

        // Get current snaps array (always available, defaults to [0, contentHeight] when no snapPoints)
        const currentSnaps = snaps.value;

        // Find the nearest snap point with optimized search
        let nearestSnap = currentSnaps[0];
        let minDistance = Math.abs(currentSnaps[0] - endOffsetY);

        // Use for loop instead of forEach for better performance
        for (let i = 1; i < currentSnaps.length; i++) {
          const snap = currentSnaps[i];
          const distFromSnap = Math.abs(snap - endOffsetY);

          if (distFromSnap < minDistance) {
            minDistance = distFromSnap;
            nearestSnap = snap;
          }
        }

        destSnapPoint = nearestSnap;

        // Use childContentHeight if available, otherwise fall back to availableScreenHeight
        const contentHeight =
          childContentHeight.value !== null
            ? childContentHeight.value
            : availableScreenHeight.value;

        if (nearestSnap >= contentHeight) {
          // User tossed below the lowest snap point
          if (props.alwaysOpen) {
            destSnapPoint = currentSnaps[currentSnaps.length - 1]; // Lowest snap point
            willCloseModalize = false;
          } else {
            // Uncontrolled component - close the modal
            willCloseModalize = true;
            handleAnimateCloseOnUI();
          }
        } else {
          // Snap to snap point or full open - don't close
          willCloseModalize = false;
        }

        if (willCloseModalize) {
          return;
        }

        // Calculate the current visual position (where the modal actually is visually)
        const currentVisualPosition = animiatedTranslateY.value + dragY.value;
        animiatedTranslateY.value = currentVisualPosition;
        dragY.value = 0;

        // If we're in overdrag territory, bounce back to nearest valid position
        if (currentVisualPosition < 0) {
          // Overdragged upward - bounce to top bound or closest snap point
          const bounceTarget = snapPoints && destSnapPoint < 0 ? destSnapPoint : 0;

          // Use bounce animation with spring physics for natural feel
          animiatedTranslateY.value = withTiming(bounceTarget, {
            duration: DEFAULT_OVERDRAG_BOUNCE_DURATION,
            easing: DEFAULT_OVERDRAG_BOUNCE_EASING,
          });

          lastSnap.value = bounceTarget;

          const modalPositionValue = bounceTarget <= 0 ? 'top' : 'initial';
          if (onPositionChange && modalPosition.value !== modalPositionValue) {
            runOnJS(onPositionChange)(modalPositionValue);
          }
          if (modalPosition.value !== modalPositionValue) {
            modalPosition.value = modalPositionValue;
          }

          return;
        }
        // Update lastSnap to the destination snap point for next gesture
        lastSnap.value = destSnapPoint;

        // Animate to destination snap point
        animiatedTranslateY.value = withTiming(destSnapPoint, {
          duration: DEFAULT_SNAP_ANIMATION_DURATION,
          easing: DEFAULT_SNAP_ANIMATION_EASING,
        });

        const modalPositionValue = destSnapPoint <= 0 ? 'top' : 'initial';

        if (onPositionChange && modalPosition.value !== modalPositionValue) {
          runOnJS(onPositionChange)(modalPositionValue);
        }

        if (modalPosition.value !== modalPositionValue) {
          modalPosition.value = modalPositionValue;
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    externalPanGesture,
    threshold,
    velocity,
    snapPoints,
    cancelClose,
    dragToss,
    snaps,
    handleAnimateCloseOnUI,
    onPositionChange,
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
            runOnJS(onOverlayPress)();
          }

          handleAnimateCloseOnUI();
        })
        .requireExternalGestureToFail(panGestureModalize),
    [closeOnOverlayTap, onOverlayPress, handleAnimateCloseOnUI, panGestureModalize],
  );

  // Separate gesture detectors:
  // 1. Pan gesture for all swipe actions (modal content and overlay)
  // 2. Tap gesture only for overlay closing

  React.useImperativeHandle(
    ref,
    () => ({
      open(dest?: TOpen) {
        // Prevent opening if already animating
        if (isAnimating) {
          return;
        }

        handleAnimateOpenOnUI(dest);
      },

      close() {
        // Prevent closing if already animating
        if (isAnimating) {
          return;
        }

        handleAnimateCloseOnUI();
      },
    }),
    [isAnimating, handleAnimateOpenOnUI, handleAnimateCloseOnUI],
  );

  React.useEffect(() => {
    // Prevent animations if already animating to avoid double animations
    if (isAnimating) {
      return;
    }

    if (isOpen && !isVisible) {
      handleAnimateOpenOnUI();
    } else if (!isOpen && isVisible) {
      handleAnimateCloseOnUI();
    }
  }, [isOpen, isVisible, isAnimating, handleAnimateOpenOnUI, handleAnimateCloseOnUI]);

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
    const draggedAndAnimiatedY = (animiatedTranslateY.value + dragY.value) * cancelTranslateY.value;

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

    return {
      transform: [{ translateY: finalTranslateY }],
      height:
        childContentHeight.value === null
          ? availableScreenHeight.value
          : Math.min(childContentHeight.value + keyboardHeight.value, screenHeight) +
            heightIncrease,
    };
  }, []);

  const modalStyle = useMemo(
    () => {
      return [s.modalStyle, props.modalStyle, animatedModalStyle];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.modalStyle],
  );

  const childrenStyle = useMemo(
    () => {
      return [
        s.childrenStyle,
        props.childrenStyle,
        {
          width: screenWidth,
          maxHeight: availableScreenHeight.value,
        },
      ];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.childrenStyle, screenWidth],
  );

  // Make sure the children height is exactly the same as the modal height. Ie,
  // only use padding in the children. Do not use margin. This is the only way
  // to make the layout calculated correctly.
  const renderModalize = (
    <View style={[s.modalize, rootStyle]} pointerEvents={!withOverlay ? 'box-none' : 'auto'}>
      {/* GestureDetector for pan gestures - handles all swipe actions */}
      <GestureDetector gesture={panGestureModalize}>
        <View style={s.modalize__wrapper} pointerEvents="box-none">
          {withOverlay && (
            <GestureDetector gesture={tapGestureOverlay}>
              <Overlay
                withOverlay={withOverlay}
                showContent={showContent}
                overlayStyle={overlayStyle}
                overlay={overlay}
              />
            </GestureDetector>
          )}
          {showContent && (
            <Animated.View style={modalStyle} testID="Modalize.Content(Animated.View)">
              <Handle
                withHandle={withHandle}
                handlePosition={handlePosition}
                handleStyle={handleStyle}
              />
              <View
                style={childrenStyle}
                onLayout={handleChildrenLayout}
                testID="Modalize.Content.View.Children"
              >
                {children}
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

export { ModalizeProps } from './options';
export * from './utils/use-modalize';

export const Modalize = React.memo(React.forwardRef(ModalizeBase));
