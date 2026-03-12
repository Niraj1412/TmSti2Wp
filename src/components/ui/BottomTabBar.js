import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../styles/theme';

const TABS = [
  { id: 'myPacks', label: 'My Packs', icon: 'grid' },
  { id: 'discover', label: 'Discover', icon: 'compass' },
  { id: 'profile', label: 'Profile', icon: 'profile' },
];

const TabIcon = ({ type, active }) => {
  const tint = active ? colors.primaryAccent : colors.textMuted;
  if (type === 'grid') {
    return (
      <View style={styles.iconGrid}>
        {Array.from({ length: 4 }).map((_, index) => (
          <View key={`tile-${index}`} style={[styles.iconTile, { backgroundColor: tint }]} />
        ))}
      </View>
    );
  }
  if (type === 'compass') {
    return (
      <View style={[styles.iconCompass, { borderColor: tint }]}>
        <View style={[styles.iconCompassDot, { backgroundColor: tint }]} />
      </View>
    );
  }
  return (
    <View style={styles.iconProfile}>
      <View style={[styles.iconProfileHead, { backgroundColor: tint }]} />
      <View style={[styles.iconProfileBody, { backgroundColor: tint }]} />
    </View>
  );
};

const BottomTabBar = ({ activeTab, onTabChange }) => (
  <View style={styles.wrapper}>
    {TABS.map(tab => {
      const isActive = tab.id === activeTab;
      return (
        <Pressable
          key={tab.id}
          onPress={() => onTabChange?.(tab.id)}
          style={({ pressed }) => [styles.item, pressed && styles.pressed]}
        >
          <View style={styles.icon}>
            <TabIcon type={tab.icon} active={isActive} />
          </View>
          <Text style={[styles.label, isActive && styles.labelActive]}>
            {tab.label}
          </Text>
        </Pressable>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing(1.25),
    paddingHorizontal: spacing(1.5),
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.backgroundAlt,
  },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  icon: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing(0.35),
  },
  iconGrid: {
    width: 20,
    height: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'space-between',
  },
  iconTile: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  iconCompass: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCompassDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
  },
  iconProfile: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconProfileHead: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    marginBottom: 2,
  },
  iconProfileBody: {
    width: 14,
    height: 7,
    borderRadius: 6,
  },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.4,
  },
  labelActive: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.8,
  },
});

export default BottomTabBar;
