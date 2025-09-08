import { Platform } from 'react-native';

/**
 * Before React Native 65, event listeners were taking an `addEventListener` and a `removeEventListener` function.
 * After React Native 65, the `addEventListener` is a subscription that return a remove callback to unsubscribe to the listener.
 * We want to detect which version of React Native we are using to support both way to handle listeners.
 */
export const isBelowRN65 = Platform.constants?.reactNativeVersion?.minor < 65;

/**
 * Since RNGH version 2, the `minDist` property is not compatible with `activeOffsetX` and `activeOffsetY`.
 * We now always use v2 APIs, so this always returns true.
 */
export const isRNGH2 = (): boolean => {
  return true;
};
