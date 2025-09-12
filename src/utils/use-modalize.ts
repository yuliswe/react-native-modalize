import * as React from 'react';

import { Modalize } from '../index';
import { TOpen } from '../options';

export const useModalize = () => {
  const ref = React.useRef<Modalize>(null);

  const close = React.useCallback(() => {
    ref.current?.close();
  }, []);

  const open = React.useCallback((dest?: TOpen) => {
    ref.current?.open(dest);
  }, []);

  return { ref, open, close };
};
