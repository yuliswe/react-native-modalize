# Migration Guide: customRenderer to renderChildren

## Overview

The `customRenderer` prop has been replaced with a more flexible `renderChildren` function. This change provides better type safety and more explicit control over the custom content rendering.

## What Changed

### Before (customRenderer)

```jsx
import { Modalize } from 'react-native-modalize';

const CustomComponent = () => (
  <ScrollView>
    <Text>Custom content</Text>
  </ScrollView>
);

<Modalize ref={modalizeRef} customRenderer={<CustomComponent />} />;
```

### After (renderChildren)

```jsx
import { Modalize } from 'react-native-modalize';

<Modalize
  ref={modalizeRef}
  renderChildren={props => (
    <ScrollView {...props}>
      <Text>Custom content</Text>
    </ScrollView>
  )}
/>;
```

## Benefits of the New Approach

1. **Better Type Safety**: The `renderChildren` function receives properly typed props
2. **Explicit Props**: You can see exactly what props are available for your custom component
3. **More Flexible**: You have full control over how the props are applied to your component
4. **Better Performance**: No need for React.cloneElement or renderElement helper

## Available Props

The `renderChildren` function receives an object with the following props:

- `ref`: Reference to the scrollable component
- `bounces`: Whether the content bounces when scrolling
- `scrollEventThrottle`: Throttle for scroll events
- `onLayout`: Layout change handler
- `scrollEnabled`: Whether scrolling is enabled
- `keyboardDismissMode`: Keyboard dismiss mode
- `onScroll`: Scroll event handler
- `waitFor`: Gesture handler to wait for
- `simultaneousHandlers`: Array of simultaneous gesture handlers

## Migration Steps

1. Replace `customRenderer` prop with `renderChildren`
2. Convert your custom component to a function that receives props
3. Spread the props onto your scrollable component
4. Remove any manual prop passing that was previously needed

## Example Migration

### Before

```jsx
const MyCustomComponent = () => (
  <Animated.ScrollView>
    <Text>My content</Text>
  </Animated.ScrollView>
);

<Modalize ref={modalizeRef} customRenderer={<MyCustomComponent />} />;
```

### After

```jsx
<Modalize
  ref={modalizeRef}
  renderChildren={props => (
    <Animated.ScrollView {...props}>
      <Text>My content</Text>
    </Animated.ScrollView>
  )}
/>
```

## Breaking Changes

- The `customRenderer` prop has been removed
- The `renderElement` helper function has been removed
- Custom components must now be functions that receive props

## TypeScript Support

The new `renderChildren` function is fully typed, providing better IntelliSense and compile-time error checking.
