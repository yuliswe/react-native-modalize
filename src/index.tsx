/**
 * esModuleInterop: true looks to work everywhere except
 * on snack.expo for some reason. Will revisit this later.
 */
import React, { useCallback } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  EmitterSubscription,
  Keyboard,
  KeyboardAvoidingView,
  KeyboardAvoidingViewProps,
  KeyboardEvent,
  LayoutChangeEvent,
  Modal,
  NativeEventSubscription,
  Platform,
  SectionList,
  StatusBar,
  View,
} from 'react-native';
import { FlatList, Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Handle } from './components/Handle';
import { HeaderAndFooter } from './components/HeaderAndFooter';
import { ModalizeContent } from './components/ModalizeContent';
import { Overlay } from './components/Overlay';
import { IHandles, IProps, TClose, TOpen, TPosition } from './options';
import s from './styles';
import { LayoutEvent, PanGestureEvent, PanGestureStateEvent } from './types';
import { getSpringConfig } from './utils/get-spring-config';
import { invariant } from './utils/invariant';
import { isBelowRN65 } from './utils/libraries';
import { useDimensions } from './utils/use-dimensions';

const AnimatedKeyboardAvoidingView = Animated.createAnimatedComponent(KeyboardAvoidingView);
// Removed SCROLL_THRESHOLD as it's no longer needed with the new snap logic
const USE_NATIVE_DRIVER = true;
const PAN_DURATION = 150;

// Memoized constants
const DEFAULT_OPEN_ANIMATION_CONFIG = {
  timing: { duration: 240, easing: Easing.ease },
  spring: { speed: 14, bounciness: 4 },
};

const DEFAULT_CLOSE_ANIMATION_CONFIG = {
  timing: { duration: 240, easing: Easing.ease },
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

    const snapDistances = snapPoints.map(point => maxModalHeight - point);

    // Sort snap points and ensure they're unique
    const sortedSnaps = [...new Set([0, ...snapDistances, maxModalHeight])].sort((a, b) => a - b);

    return sortedSnaps;
  }, [snapPoints, maxModalHeight]);

  const [_actualModalHeight, setActualModalHeight] = React.useState(initialModalHeight);

  /** Current actual height of the modal (can change based on content) */
  const actualModalHeight = _actualModalHeight;

  // Last snap position the modal was at
  const [lastSnap, setLastSnap] = React.useState(() => {
    if (!snapPoints || snapPoints.length === 0) return 0;
    return maxModalHeight - snapPoints[0]; // Use first snap point as initial position
  });
  const [isVisible, setIsVisible] = React.useState(false);
  const [showContent, setShowContent] = React.useState(true);
  const [enableBounces, setEnableBounces] = React.useState(true);
  const [keyboardToggle, setKeyboardToggle] = React.useState(false);
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);
  const [disableScroll, setDisableScroll] = React.useState(
    alwaysOpen || snapPoints ? true : undefined,
  );
  const [beginScrollYValue, setBeginScrollYValue] = React.useState(0);
  const [modalPosition, setModalPosition] = React.useState<TPosition>('initial');
  const [cancelClose, setCancelClose] = React.useState(false);
  const [layouts, setLayouts] = React.useState<Map<string, number>>(new Map());
  const [isScrollAtTop, setIsScrollAtTop] = React.useState(true);

  const cancelTranslateY = React.useRef(new Animated.Value(1)).current; // 1 by default to have the translateY animation running
  const componentTranslateY = React.useRef(new Animated.Value(0)).current;
  const overlay = React.useRef(new Animated.Value(0)).current;
  const beginScrollY = React.useRef(new Animated.Value(0)).current;
  const dragY = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(screenHeight)).current;
  const reverseBeginScrollY = React.useRef(Animated.multiply(new Animated.Value(-1), beginScrollY))
    .current;

  const contentViewRef = React.useRef<ScrollView | FlatList<any> | SectionList<any>>(null);
  const backButtonListenerRef = React.useRef<NativeEventSubscription>(null);

  // We diff and get the negative value only. It sometimes go above 0
  // (e.g. 1.5) and creates the flickering on Modalize for a ms
  const diffClamp = Animated.diffClamp(reverseBeginScrollY, -screenHeight, 0);
  const componentDragEnabled = (componentTranslateY as any)._value === 1;
  // When we have a scrolling happening in the ScrollView, we don't want to translate
  // the modal down. We either multiply by 0 to cancel the animation, or 1 to proceed.
  const dragValue = Animated.add(
    Animated.multiply(dragY, componentDragEnabled ? 1 : cancelTranslateY),
    diffClamp,
  );
  const value = Animated.add(
    Animated.multiply(translateY, componentDragEnabled ? 1 : cancelTranslateY),
    dragValue,
  );

  let willCloseModalize = false;

  const handleAnimateClose = useCallback(
    (dest: TClose = 'default', callback?: () => void): void => {
      const { timing, spring } = closeAnimationConfig as any;
      const lastSnapValue = snapPoints ? snaps[1] : 80;
      const toInitialAlwaysOpen = dest === 'alwaysOpen' && Boolean(alwaysOpen);
      const toValue =
        toInitialAlwaysOpen && alwaysOpen ? (actualModalHeight || 0) - alwaysOpen : screenHeight;

      backButtonListenerRef.current?.remove();
      cancelTranslateY.setValue(1);
      setBeginScrollYValue(0);
      beginScrollY.setValue(0);

      Animated.parallel([
        Animated.timing(overlay, {
          toValue: 0,
          duration: timing.duration,
          easing: Easing.ease,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),

        panGestureAnimatedValue
          ? Animated.timing(panGestureAnimatedValue, {
              toValue: 0,
              duration: PAN_DURATION,
              easing: Easing.ease,
              useNativeDriver,
            })
          : Animated.delay(0),

        spring
          ? Animated.spring(translateY, {
              ...getSpringConfig(spring),
              toValue,
              useNativeDriver: USE_NATIVE_DRIVER,
            })
          : Animated.timing(translateY, {
              duration: timing.duration,
              easing: Easing.out(Easing.ease),
              toValue,
              useNativeDriver: USE_NATIVE_DRIVER,
            }),
      ]).start(() => {
        if (onClosed) {
          onClosed();
        }

        if (callback) {
          callback();
        }

        if (alwaysOpen && dest === 'alwaysOpen' && onPositionChange) {
          onPositionChange('initial');
        }

        if (alwaysOpen && dest === 'alwaysOpen') {
          setModalPosition('initial');
        }

        setShowContent(toInitialAlwaysOpen);
        translateY.setValue(toValue);
        dragY.setValue(0);
        willCloseModalize = false;
        setLastSnap(lastSnapValue);
        setIsVisible(toInitialAlwaysOpen);
      });
    },
    [
      closeAnimationConfig,
      snapPoints,
      snaps,
      alwaysOpen,
      actualModalHeight,
      screenHeight,
      panGestureAnimatedValue,
      useNativeDriver,
      onClosed,
      onPositionChange,
    ],
  );

  const handleClose = useCallback(
    (dest?: TClose, callback?: () => void): void => {
      if (onWillClose) {
        onWillClose();
      }

      handleAnimateClose(dest, callback);
    },
    [onWillClose, handleAnimateClose],
  );

  const handleBackPress = useCallback((): boolean => {
    if (alwaysOpen) {
      return false;
    }

    if (onBackButtonPress) {
      return onBackButtonPress();
    } else {
      handleClose();
    }

    return true;
  }, [alwaysOpen, onBackButtonPress, handleClose]);

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
    const { timing, spring } = openAnimationConfig;

    (backButtonListenerRef as any).current = BackHandler.addEventListener(
      'hardwareBackPress',
      handleBackPress,
    );

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

    setIsVisible(true);
    setShowContent(true);

    if ((alwaysOpenValue && dest !== 'top') || (snapPoints && dest === 'default')) {
      newPosition = 'initial';
    } else {
      newPosition = 'top';
    }

    Animated.parallel([
      Animated.timing(overlay, {
        toValue: alwaysOpenValue && dest === 'default' ? 0 : 1,
        duration: timing.duration,
        easing: Easing.ease,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),

      panGestureAnimatedValue
        ? Animated.timing(panGestureAnimatedValue, {
            toValue: toPanValue,
            duration: PAN_DURATION,
            easing: Easing.ease,
            useNativeDriver,
          })
        : Animated.delay(0),

      spring
        ? Animated.spring(translateY, {
            ...getSpringConfig(spring),
            toValue,
            useNativeDriver: USE_NATIVE_DRIVER,
          })
        : Animated.timing(translateY, {
            toValue,
            duration: timing.duration,
            easing: timing.easing,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
    ]).start(() => {
      if (onOpened) {
        onOpened();
      }

      setModalPosition(newPosition);

      if (onPositionChange) {
        onPositionChange(newPosition);
      }
    });
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
      setLayouts(new Map(layouts.set(component, height)));

      const max = Array.from(layouts).reduce((acc, cur) => acc + cur?.[1], 0);
      const maxFixed = +max.toFixed(3);
      const maxModalHeightFixed = +maxModalHeight.toFixed(3);
      const shorterHeight = maxFixed < maxModalHeightFixed;

      setDisableScroll(shorterHeight && disableScrollIfPossible);
    },
    [layouts, maxModalHeight, disableScrollIfPossible],
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
      if (isAtTop !== isScrollAtTop) {
        setIsScrollAtTop(isAtTop);
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
  const panGestureModalize = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(panGestureEnabled)
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          console.log('🔴 panGestureModalize onBegin');

          // Handle pan begin for main modalize
          setCancelClose(false);

          // Reset animation values at the start of each gesture
          dragY.setValue(0);
          // Don't reset translateY - it should maintain current position (snap point)
          cancelTranslateY.setValue(1);

          console.log('beginScrollYValue', beginScrollYValue);

          cancelTranslateY.setValue(1);

          if (!tapGestureEnabled) {
            setDisableScroll(
              (Boolean(snapPoints) || Boolean(alwaysOpen)) && modalPosition === 'initial',
            );
          }
        })
        .onChange((event: PanGestureEvent) => {
          const { translationY } = event;

          // Update dragY for animation
          dragY.setValue(translationY);

          if (panGestureAnimatedValue) {
            const offset = alwaysOpen ?? snapPoints?.[0] ?? 0;
            const diff = Math.abs(translationY / (maxModalHeight - offset));
            const y = translationY <= 0 ? diff : 1 - diff;
            let value: number; // between 0 and 1

            // Prevent the modal from going below its initial position
            if (modalPosition === 'initial' && translationY > 0) {
              value = 0;
            }

            // Prevent the modal from going above the top position
            else if (modalPosition === 'top' && translationY <= 0) {
              value = 1;
            } else {
              value = y;
            }

            panGestureAnimatedValue.setValue(value);
          }
        })
        .onEnd((event: PanGestureStateEvent) => {
          console.log('🔴 panGestureModalize onEnd');

          const { timing } = closeAnimationConfig;
          const { velocityY, translationY } = event;
          // Removed negativeReverseScroll as it's no longer needed with the new snap logic
          const thresholdProps = translationY > threshold && beginScrollYValue === 0;
          const closeThreshold = velocity
            ? (beginScrollYValue <= 20 && velocityY >= velocity) || thresholdProps
            : thresholdProps;

          const enableBounces = alwaysOpen
            ? beginScrollYValue > 0 || translationY < 0
            : !isScrollAtTop;

          setEnableBounces(enableBounces);

          const toValue = translationY - beginScrollYValue;
          let destSnapPoint = lastSnap; // Start with current position

          if (snapPoints || alwaysOpen) {
            const endOffsetY = lastSnap + toValue + dragToss * velocityY;

            // Find the nearest snap point
            let nearestSnap = snaps[0]; // Start with first snap point
            let minDistance = Math.abs(snaps[0] - endOffsetY);

            snaps.forEach((snap: number) => {
              const distFromSnap = Math.abs(snap - endOffsetY);

              // Find the closest snap point
              if (distFromSnap < minDistance) {
                minDistance = distFromSnap;
                nearestSnap = snap;
              }
            });

            // Set destination to closest snap point
            destSnapPoint = nearestSnap;

            // Handle special cases
            if (!alwaysOpen) {
              if (nearestSnap === maxModalHeight) {
                // Snap to closed position - close the modal
                willCloseModalize = true;
                handleClose();
              } else {
                // Snap to snap point or full open - don't close
                willCloseModalize = false;
              }
            }

            // For alwaysOpen props
            if (alwaysOpen && beginScrollYValue <= 0) {
              destSnapPoint = (actualModalHeight || 0) - alwaysOpen;
              willCloseModalize = false;
            }
          } else if (closeThreshold && !alwaysOpen && !cancelClose) {
            willCloseModalize = true;
            handleClose();
          }

          if (willCloseModalize) {
            return;
          }

          setLastSnap(destSnapPoint);
          translateY.extractOffset();
          translateY.setValue(toValue);
          translateY.flattenOffset();
          dragY.setValue(0);

          if (alwaysOpen) {
            Animated.timing(overlay, {
              toValue: Number(destSnapPoint <= 0),
              duration: timing.duration,
              easing: Easing.ease,
              useNativeDriver: USE_NATIVE_DRIVER,
            }).start();
          }

          Animated.spring(translateY, {
            tension: 50,
            friction: 12,
            velocity: velocityY,
            toValue: destSnapPoint,
            useNativeDriver: USE_NATIVE_DRIVER,
          }).start();

          if (beginScrollYValue <= 0) {
            const modalPositionValue = destSnapPoint <= 0 ? 'top' : 'initial';

            if (panGestureAnimatedValue) {
              Animated.timing(panGestureAnimatedValue, {
                toValue: Number(modalPositionValue === 'top'),
                duration: PAN_DURATION,
                easing: Easing.ease,
                useNativeDriver,
              }).start();
            }

            if (!adjustToContentHeight && modalPositionValue === 'top') {
              setDisableScroll(false);
            }

            if (onPositionChange && modalPosition !== modalPositionValue) {
              onPositionChange(modalPositionValue);
            }

            if (modalPosition !== modalPositionValue) {
              setModalPosition(modalPositionValue);
            }
          }
        })
        .runOnJS(true),
    [
      panGestureEnabled,
      modalPosition,
      beginScrollYValue,
      snapPoints,
      closeSnapPointStraightEnabled,
      isScrollAtTop,
      alwaysOpen,
      tapGestureEnabled,
      closeAnimationConfig,
      threshold,
      velocity,
      dragToss,
      maxModalHeight,
      lastSnap,
      panGestureAnimatedValue,
      useNativeDriver,
      onPositionChange,
      adjustToContentHeight,
      handleClose,
      actualModalHeight,
      snaps,
      overlay,
      translateY,
      dragY,
      setEnableBounces,
      setLastSnap,
      setBeginScrollYValue,
      beginScrollY,
      setCancelClose,
      setDisableScroll,
      setModalPosition,
    ],
  );

  const tapGestureOverlay = React.useMemo(
    () =>
      Gesture.Tap()
        .enabled(closeOnOverlayTap !== undefined ? closeOnOverlayTap : panGestureEnabled)
        .onStart(() => {
          if (onOverlayPress) {
            onOverlayPress();
          }
          const dest = !!alwaysOpen ? 'alwaysOpen' : 'default';
          if (!willCloseModalize) {
            handleClose(dest);
          }
        })
        .runOnJS(true),
    [
      closeOnOverlayTap,
      panGestureEnabled,
      onOverlayPress,
      alwaysOpen,
      willCloseModalize,
      handleClose,
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

    close(dest?: TClose, callback?: () => void): void {
      handleClose(dest, callback);
    },
  }));

  React.useEffect(() => {
    if (alwaysOpen && (actualModalHeight || adjustToContentHeight)) {
      handleAnimateOpen(alwaysOpen);
    }
  }, [alwaysOpen, actualModalHeight]);

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

    const beginScrollYListener = beginScrollY.addListener(({ value }) =>
      setBeginScrollYValue(value),
    );

    if (isBelowRN65) {
      Keyboard.addListener('keyboardDidShow', handleKeyboardShow);
      Keyboard.addListener('keyboardDidHide', handleKeyboardHide);
    } else {
      keyboardShowListener = Keyboard.addListener('keyboardDidShow', handleKeyboardShow);
      keyboardHideListener = Keyboard.addListener('keyboardDidHide', handleKeyboardHide);
    }

    return (): void => {
      backButtonListenerRef.current?.remove();
      beginScrollY.removeListener(beginScrollYListener);

      if (isBelowRN65) {
        Keyboard.removeListener('keyboardDidShow', handleKeyboardShow);
        Keyboard.removeListener('keyboardDidHide', handleKeyboardHide);
      } else {
        keyboardShowListener?.remove();
        keyboardHideListener?.remove();
      }
    };
  }, []);

  const keyboardAvoidingViewProps: Animated.AnimatedProps<KeyboardAvoidingViewProps> = {
    keyboardVerticalOffset: keyboardAvoidingOffset,
    behavior: keyboardAvoidingBehavior,
    enabled: avoidKeyboardLikeIOS,
    style: [
      s.modalize__content,
      modalStyle,
      {
        height: actualModalHeight,
        maxHeight: maxModalHeight,
        transform: [
          {
            translateY: value.interpolate({
              inputRange: [-40, 0, maxModalHeight],
              outputRange: [0, 0, maxModalHeight],
              extrapolate: 'clamp',
            }),
          },
        ],
      },
    ],
  };

  if (!avoidKeyboardLikeIOS && !adjustToContentHeight) {
    keyboardAvoidingViewProps.onLayout = handleModalizeContentLayout;
  }

  const renderModalize = (
    <View
      style={[s.modalize, rootStyle]}
      pointerEvents={alwaysOpen || !withOverlay ? 'box-none' : 'auto'}
    >
      {/* GestureDetector for pan gestures - handles all swipe actions */}
      <GestureDetector gesture={panGestureModalize}>
        <View style={s.modalize__wrapper} pointerEvents="box-none">
          {showContent && (
            <AnimatedKeyboardAvoidingView {...keyboardAvoidingViewProps}>
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
                enableBounces={enableBounces}
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
              overlayStyle={overlayStyle}
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
