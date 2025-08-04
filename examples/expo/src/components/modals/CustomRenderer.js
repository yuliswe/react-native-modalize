import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Modalize } from 'react-native-modalize';

export const CustomRenderer = ({ modalizeRef }) => {
  const renderChildren = props => {
    return (
      <ScrollView {...props} style={styles.content}>
        <Text style={styles.title}>Custom Renderer Example</Text>
        <Text style={styles.description}>
          This example demonstrates how to use the new renderChildren function to create custom
          scrollable content with full gesture support.
        </Text>
        {Array.from({ length: 20 }, (_, i) => (
          <View key={i} style={styles.item}>
            <Text style={styles.itemText}>Item {i + 1}</Text>
            <Text style={styles.itemDescription}>
              This is a custom rendered item with full scroll and gesture support.
            </Text>
          </View>
        ))}
      </ScrollView>
    );
  };

  return <Modalize ref={modalizeRef} modalHeight={500} renderChildren={renderChildren} />;
};

const styles = StyleSheet.create({
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  description: {
    fontSize: 16,
    marginBottom: 20,
    color: '#666',
    lineHeight: 24,
  },
  item: {
    padding: 15,
    marginBottom: 10,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  itemText: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 5,
    color: '#333',
  },
  itemDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
});
