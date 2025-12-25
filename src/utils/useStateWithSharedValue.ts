import { useCallback, useState } from 'react';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

/**
 * Hook that combines useState and useSharedValue to keep a value in sync for both:
 * - React state (for re-renders, useEffect dependencies, etc.)
 * - Shared value (for worklet access on UI thread)
 *
 * This is useful when you need a value that:
 * 1. Triggers React re-renders when changed (state)
 * 2. Can be accessed in Reanimated worklets (shared value)
 *
 * @param initialValue - The initial value
 * @returns A tuple of [state, setter, sharedValue]
 *
 * @example
 * ```tsx
 * const [pageIdx, setPageIdx, pageIdxShared] = useStateWithRef(0);
 *
 * // Use state for React logic
 * useEffect(() => {
 *   console.log('Page changed:', pageIdx);
 * }, [pageIdx]);
 *
 * // Use shared value in worklets
 * const handler = useAnimatedScrollHandler({
 *   onScroll: () => {
 *     'worklet';
 *     const currentPage = pageIdxShared.value; // ✅ Works in worklet
 *   },
 * });
 * ```
 */
export function useStateWithSharedValue<T>(initialValue: T): [T, (value: T) => void, { value: T }] {
  const [state, setState] = useState<T>(initialValue);
  const sharedValue = useSharedValue<T>(initialValue);

  // Setter that updates both atomically
  const setValue = useCallback(
    (value: T) => {
      sharedValue.value = value; // Update shared value immediately for worklet access
      runOnJS(setState)(value); // Update state for React re-renders
    },
    [sharedValue],
  );

  return [state, setValue, sharedValue];
}
