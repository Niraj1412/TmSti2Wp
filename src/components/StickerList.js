import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, radius } from '../styles/theme';

const StickerList = ({
  items = [],
  title = 'Selected stickers',
  selectable = false,
  selectedIds = [],
  onToggleSelect,
}) => {
  if (!Array.isArray(items) || items.length === 0) return null;

  const selectedSet = new Set(
    Array.isArray(selectedIds) ? selectedIds : selectedIds ? Array.from(selectedIds) : [],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {selectable && (
        <Text style={styles.helper}>Tap to include or exclude stickers before conversion.</Text>
      )}
      <View style={styles.grid}>
        {items.slice(0, 30).map(item => {
          const isSelected = selectable ? selectedSet.has(item.id) : true;
          const CellComponent = selectable ? Pressable : View;
          const animatedPreviewUri = item?.previewImageUri || null;
          return (
            <CellComponent
              key={item.id || item.uri}
              style={[styles.cell, selectable && isSelected && styles.cellSelected]}
              onPress={selectable ? () => onToggleSelect?.(item) : undefined}
            >
              {item?.animated ? (
                animatedPreviewUri ? (
                  <Image
                    source={{ uri: animatedPreviewUri }}
                    style={styles.thumb}
                    resizeMode="cover"
                    fadeDuration={0}
                  />
                ) : (
                  <View style={styles.animatedThumb}>
                    <Text style={styles.animatedLabel}> </Text>
                  </View>
                )
              ) : (
                <Image
                  source={{ uri: item.uri || item.originalUri }}
                  style={styles.thumb}
                  resizeMode="cover"
                  resizeMethod="resize"
                  fadeDuration={0}
                />
              )}
              {selectable && (
                <View style={[styles.check, isSelected ? styles.checkOn : styles.checkOff]}>
                  <Text style={[styles.checkLabel, isSelected ? styles.checkLabelOn : styles.checkLabelOff]}>
                    {isSelected ? 'OK' : '+'}
                  </Text>
                </View>
              )}
            </CellComponent>
          );
        })}
      </View>
      {items.length > 30 && (
        <Text style={styles.caption}>+{items.length - 30} more</Text>
      )}
    </View>
  );
};

const SIZE = 68;

const styles = StyleSheet.create({
  container: { marginTop: spacing(1.5), backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(1.5), borderWidth: 1, borderColor: colors.divider },
  title: { ...typography.subheading, color: colors.textPrimary, marginBottom: spacing(0.35) },
  helper: { ...typography.caption, color: colors.textMuted, marginBottom: spacing(0.75) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing(0.6) },
  cell: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.md,
    overflow: 'hidden',
    margin: spacing(0.6),
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  cellSelected: { borderColor: colors.primary },
  thumb: { width: '100%', height: '100%' },
  animatedThumb: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  animatedLabel: {
    ...typography.caption,
    color: colors.primaryAccent,
    fontWeight: '700',
    letterSpacing: 1,
  },
  caption: { ...typography.caption, marginTop: spacing(0.5), color: colors.textMuted },
  check: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.primary },
  checkOff: { backgroundColor: colors.surface },
  checkLabel: { ...typography.caption, fontWeight: '700' },
  checkLabelOn: { color: colors.textOnPrimary },
  checkLabelOff: { color: colors.textPrimary },
});

export default StickerList;
