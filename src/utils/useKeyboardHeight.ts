import { Keyboard, KeyboardEvent, Platform } from 'react-native';
import { useEffect } from 'react';
import { useSharedValue, withTiming, Easing } from 'react-native-reanimated';

export interface UseKeyboardHeightReturn {
  keyboardHeight: Readonly<{ value: number }>;
  isKeyboardVisible: Readonly<{ value: boolean }>;
}

export function useKeyboardHeight(): UseKeyboardHeightReturn {
  const keyboardHeight = useSharedValue(0);
  const isKeyboardVisible = useSharedValue(false);

  useEffect(() => {
    const onKeyboardShow = (event: KeyboardEvent) => {
      'worklet';
      const height = event.endCoordinates.height;

      // Animate keyboard height change for smoother transitions
      keyboardHeight.value = withTiming(height, {
        duration: Platform.OS === 'ios' ? 250 : 200,
        easing: Easing.out(Easing.ease),
      });

      isKeyboardVisible.value = true;
    };

    const onKeyboardHide = () => {
      'worklet';

      // Animate keyboard height change for smoother transitions
      keyboardHeight.value = withTiming(0, {
        duration: Platform.OS === 'ios' ? 250 : 200,
        easing: Easing.out(Easing.ease),
      });

      isKeyboardVisible.value = false;
    };

    // Use different events for iOS vs Android for better performance
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, onKeyboardShow);
    const hideSub = Keyboard.addListener(hideEvent, onKeyboardHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardHeight, isKeyboardVisible]);

  return { keyboardHeight, isKeyboardVisible };
}
