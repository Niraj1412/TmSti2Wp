import { Platform } from 'react-native';

export const colors = {
  background: '#0f172a',
  backgroundAlt: '#111c44',
  surface: '#1f2937',
  surfaceElevated: '#293347',
  surfaceSubtle: 'rgba(148, 163, 184, 0.08)',
  primary: '#4f46e5',
  primaryAccent: '#6366f1',
  primarySoft: 'rgba(99, 102, 241, 0.12)',
  accent: '#f59e0b',
  success: '#22c55e',
  warning: '#facc15',
  error: '#f87171',
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  textMuted: 'rgba(148, 163, 184, 0.72)',
  divider: 'rgba(148, 163, 184, 0.16)',
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
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.2,
      shadowRadius: 32,
      elevation: 12,
    },
    '0px 24px 48px rgba(15, 23, 42, 0.35)',
  ),
  card: withWebShadow(
    {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.18,
      shadowRadius: 24,
      elevation: 8,
    },
    '0px 12px 32px rgba(15, 23, 42, 0.24)',
  ),
};
