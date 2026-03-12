import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import BottomTabBar from '../components/ui/BottomTabBar';
import { colors, radius, spacing } from '../styles/theme';

const ProfileScreen = ({ activeTab, onTabChange }) => (
  <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatar} />
        <View>
          <Text style={styles.title}>Sticker Creator</Text>
          <Text style={styles.subtitle}>@you</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Creator Tools</Text>
        {['Account', 'Uploads', 'Settings'].map(item => (
          <View key={item} style={styles.cardRow}>
            <View style={styles.cardIcon} />
            <Text style={styles.cardText}>{item}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your Stats</Text>
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statValue}>12</Text>
            <Text style={styles.statLabel}>Packs</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={styles.statValue}>328</Text>
            <Text style={styles.statLabel}>Stickers</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={styles.statValue}>4.2k</Text>
            <Text style={styles.statLabel}>Adds</Text>
          </View>
        </View>
      </View>
    </ScrollView>

    <BottomTabBar activeTab={activeTab} onTabChange={onTabChange} />
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(10),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing(2),
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.primaryAccent,
    marginRight: spacing(1.5),
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing(0.4),
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(1.75),
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing(2),
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: spacing(1),
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing(0.75),
  },
  cardIcon: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    marginRight: spacing(1),
  },
  cardText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statPill: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    paddingVertical: spacing(1),
    marginHorizontal: spacing(0.4),
    alignItems: 'center',
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing(0.4),
  },
});

export default ProfileScreen;
