import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing, shadows } from '../../styles/theme';

const variants = {
  primary: {
    backgroundColor: colors.primary,
    textColor: '#ffffff',
  },
  secondary: {
    backgroundColor: 'transparent',
    borderColor: colors.textMuted,
    textColor: colors.textPrimary,
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: colors.primary,
    textColor: colors.primary,
  },
};

const ActionButton = ({
  title,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  style,
  textStyle,
  icon,
  compact,
  ...touchableProps
}) => {
  const config = variants[variant] ?? variants.primary;
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.base,
        { backgroundColor: config.backgroundColor },
        config.borderColor && { borderColor: config.borderColor, borderWidth: 1 },
        !compact && styles.expanded,
        variant === 'primary' && shadows.card,
        isDisabled && styles.disabled,
        style,
      ]}
      {...touchableProps}
    >
      {loading ? (
        <ActivityIndicator color={config.textColor} />
      ) : (
        <View style={styles.content}>
          {icon && <View style={styles.icon}>{icon}</View>}
          <Text style={[styles.text, { color: config.textColor }, textStyle]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
  },
  expanded: {
    paddingVertical: spacing(1.4),
    paddingHorizontal: spacing(2),
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing(0.75),
  },
  text: {
    fontWeight: '600',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  disabled: {
    opacity: 0.6,
  },
});

export default ActionButton;
