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
        {loading && <ActivityIndicator size="small" color={isOutline ? colors.primaryAccent : colors.textOnPrimary} style={{ marginRight: spacing(0.5) }} />}
        <Text style={[
          styles.title,
          isOutline && styles.titleOutline,
          isSecondary && styles.titleSecondary,
        ]}
        >
          {title}
        </Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(2.25),
    paddingVertical: spacing(1.1),
    borderWidth: 1,
    borderColor: 'rgba(42, 171, 238, 0.45)',
    shadowColor: colors.primaryAccent,
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
  },
  secondary: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    shadowOpacity: 0,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.25,
    borderColor: colors.primaryAccent,
    shadowOpacity: 0,
  },
  disabled: {
    opacity: 0.6,
  },
  pressed: {
    transform: [{ translateY: 1 }],
    opacity: 0.9,
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.body, color: colors.textOnPrimary, fontWeight: '700', letterSpacing: 0.2 },
  titleSecondary: { color: colors.textPrimary },
  titleOutline: { color: colors.primaryAccent },
});

export default ActionButton;
