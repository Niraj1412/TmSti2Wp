import { Platform } from 'react-native';

export const colors = {
  // WhatsApp x Telegram inspired palette
  background: '#071920',
  backgroundAlt: '#0c2533',
  surface: '#0f2b3a',
  surfaceElevated: '#12364a',
  surfaceSubtle: 'rgba(42, 171, 238, 0.08)',
  primary: '#1ebe6b', // WhatsApp green
  primaryAccent: '#2aabee', // Telegram blue
  primarySoft: 'rgba(30, 190, 107, 0.14)',
  accent: '#8ddafc',
  success: '#1ebe6b',
  warning: '#f5c542',
  error: '#f97070',
  textPrimary: '#e8f4f7',
  textSecondary: '#c0d5df',
  textMuted: 'rgba(192, 213, 223, 0.78)',
  textOnPrimary: '#e8f4f7',
  divider: 'rgba(255, 255, 255, 0.08)',
};

export const spacing = value => value * 8;

export const radius = {
  sm: 8,
  md: 14,
  lg: 24,
  pill: 999,
};

export const typography = {
  hero: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subheading: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  body: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  caption: {
    fontSize: 12,
    color: colors.textMuted,
  },
};

const withWebShadow = (nativeShadow, boxShadow) => (
  Platform.OS === 'web' ? { boxShadow } : nativeShadow
);

export const shadows = {
  floating: withWebShadow(
    {
      shadowColor: '#031720',
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 0.24,
      shadowRadius: 36,
      elevation: 12,
    },
    '0px 26px 56px rgba(7, 25, 32, 0.48)',
  ),
  card: withWebShadow(
    {
      shadowColor: '#041f2c',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.22,
      shadowRadius: 26,
      elevation: 8,
    },
    '0px 14px 36px rgba(6, 27, 36, 0.36)',
  ),
};
