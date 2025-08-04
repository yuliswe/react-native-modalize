import { useRef } from 'react';

interface RenderDebugOptions {
  name?: string;
  enabled?: boolean;
  logToConsole?: boolean;
}

export const useRenderDebug = <T extends Record<string, any>>(
  values: T,
  options: RenderDebugOptions = {},
) => {
  const { name = 'Component', enabled = true, logToConsole = true } = options;
  const prevValuesRef = useRef<Partial<T>>({});

  if (!enabled) {
    return;
  }

  // Find changes
  const changes: Record<string, { from: any; to: any }> = {};
  Object.entries(values).forEach(([key, value]) => {
    if (prevValuesRef.current[key as keyof T] !== value) {
      changes[key] = {
        from: prevValuesRef.current[key as keyof T],
        to: value,
      };
    }
  });

  // Log only if there are changes
  if (Object.keys(changes).length > 0 && logToConsole) {
    console.log(`=== ${name} Rerender - Changes Detected ===`);
    Object.entries(changes).forEach(([key, { from, to }]) => {
      console.log(`🔄 ${key}:`, from, '→', to);
    });
    console.log('===========================================');
  }

  // Update previous values
  prevValuesRef.current = values;

  return changes;
};
