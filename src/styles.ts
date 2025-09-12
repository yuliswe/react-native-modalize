/* eslint-disable react-native/no-color-literals */
import { StyleSheet, Dimensions } from 'react-native';

import { isWeb } from './utils/devices';

const { height } = Dimensions.get('window');

export default StyleSheet.create({
  content__adjustHeight: {
    flex: isWeb ? 1 : 0,
    flexGrow: isWeb ? undefined : 0,
    flexShrink: isWeb ? undefined : 1,
  },

  content__container: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
  },

  handle: {
    height: 20,
    left: 0,
    paddingBottom: 20,
    position: 'absolute',
    right: 0,

    top: -20,

    zIndex: 5,
  },

  handleBottom: {
    top: 0,
  },

  handle__shape: {
    alignSelf: 'center',

    backgroundColor: 'rgba(255, 255, 255, 0.8)',

    borderRadius: 5,
    height: 5,

    top: 8,
    width: 45,
  },

  handle__shapeBottom: {
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },

  modalize: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 9998,
  },

  modalize__content: {
    backgroundColor: '#fff',

    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    elevation: 4,
    marginTop: 'auto',

    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 12,

    zIndex: 5,
  },

  modalize__wrapper: {
    flex: 1,
  },

  overlay: {
    bottom: 0,
    height: isWeb ? height : undefined,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,

    zIndex: 0,
  },

  overlay__background: {
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,

    top: 0,
  },
});
