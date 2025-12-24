import { useCallback, useRef } from 'react';
import { TOpen } from '../options';

export interface ModalizeRef {
  /**
   * Method to open Modalize.
   *
   * If you are using `snapPoint` prop, you can supply a `dest` argument to the `open` method, to open it
   * to the top directly `open('top')`. You don't have to provide anything if you want the default behavior.
   */
  open(dest?: TOpen): void;

  /**
   * The method to close Modalize. You don't need to call it to dismiss the modal, since you can swipe down to dismiss.
   */
  close(): void;
}

export const useModalizeRef = () => {
  const ref = useRef<ModalizeRef>(null);

  const close = useCallback(() => {
    ref.current?.close();
  }, []);

  const open = useCallback((dest?: TOpen) => {
    ref.current?.open(dest);
  }, []);

  return { ref, open, close };
};
