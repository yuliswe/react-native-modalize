import { useCallback, useRef } from 'react';

export interface ModalizeRef {
  /**
   * Method to open Modalize.
   */
  open(): void;

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

  const open = useCallback(() => {
    ref.current?.open();
  }, []);

  return { ref, open, close };
};
