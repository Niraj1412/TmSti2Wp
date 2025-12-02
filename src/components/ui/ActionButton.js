import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../styles/theme';

const ActionButton = ({ title, onPress, disabled, loading, variant = 'primary', style }) => {
  const isSecondary = variant === 'secondary';
  const isOutline = variant === 'outline';
  const baseStyle = [
    styles.button,
    isSecondary && styles.secondary,
    isOutline && styles.outline,
    disabled && styles.disabled,
    style,
  ];
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [ ...baseStyle, pressed && styles.pressed ]}>
      <View style={styles.content}>
        {loading && <ActivityIndicator size="small" color={colors.textPrimary} style={{ marginRight: spacing(0.5) }} />}
        <Text style={[styles.title, isOutline && { color: colors.textPrimary }]}>{title}</Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.primaryAccent,
    borderRadius: radius.md,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
  },
  secondary: {
    backgroundColor: colors.surfaceSubtle,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  disabled: {
    opacity: 0.6,
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.body, color: colors.background, fontWeight: '600' },
});

export default ActionButton;

