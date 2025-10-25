import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Alert, StyleSheet } from 'react-native';
import { normalizeFilePath, deriveStickerName } from '../utils/stickerUtils';
import ActionButton from './ui/ActionButton';
import { colors, spacing, typography, radius } from '../styles/theme';

const StickerList = ({ stickers, onEmojisAssigned, loading }) => {
  const items = useMemo(() => (Array.isArray(stickers) ? stickers : []), [stickers]);
  const [emojisMap, setEmojisMap] = useState({});

  const getKey = sticker =>
    sticker?.id ||
    sticker?.uri ||
    sticker?.image_file ||
    sticker?.originalUri ||
    deriveStickerName(normalizeFilePath(sticker?.uri || sticker?.image_file || ''));

  const updateEmojis = (key, emojis) => {
    setEmojisMap(prev => ({ ...prev, [key]: emojis }));
  };

  const handleAssign = () => {
    const prepared = items
      .map(sticker => {
        const key = getKey(sticker);
        const rawEmojis = (emojisMap[key] || '').split(/\s+/).filter(Boolean);
        return {
          image_file: normalizeFilePath(sticker?.uri || sticker?.image_file || sticker?.path),
          emojis: rawEmojis,
        };
      })
      .filter(sticker => sticker.image_file && sticker.emojis.length > 0);

    if (prepared.length < 3) {
      Alert.alert('Need at least 3 stickers with emojis!');
      return;
    }

    onEmojisAssigned?.(prepared);
  };

  const renderItem = ({ item }) => {
    const key = getKey(item);
    return (
      <View style={styles.item}>
        <View style={styles.itemHeader}>
          <View style={styles.itemBadge} />
          <Text style={styles.itemTitle}>
            {deriveStickerName(item?.uri || item?.image_file)}
          </Text>
        </View>
        <TextInput
          placeholder="Add emojis (space separated)"
          placeholderTextColor={colors.textMuted}
          value={emojisMap[key] || ''}
          onChangeText={text => updateEmojis(key, text)}
          style={styles.input}
          editable={!loading}
        />
        <Text style={styles.itemHint}>
          Separate each emoji with a space. WhatsApp shows the first three prominently.
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Assign emojis to bring your stickers to life</Text>
      <Text style={styles.headerCaption}>
        WhatsApp uses emojis to help users find stickers. Aim for at least three stickers with tags.
      </Text>
      <FlatList
        data={items}
        keyExtractor={(item, index) => `${getKey(item)}-${index}`}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyState}>No converted stickers yet.</Text>}
      />
      <ActionButton
        title="Assign Emojis & Create Pack"
        onPress={handleAssign}
        disabled={loading || items.length === 0}
        loading={loading}
        style={styles.cta}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: spacing(2),
  },
  headerTitle: {
    ...typography.subheading,
    color: colors.textPrimary,
  },
  headerCaption: {
    ...typography.caption,
    marginTop: spacing(0.75),
  },
  listContent: {
    marginTop: spacing(1.5),
    paddingBottom: spacing(2),
  },
  item: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    paddingVertical: spacing(1.25),
    paddingHorizontal: spacing(1.5),
    marginBottom: spacing(1.25),
    borderWidth: 1,
    borderColor: colors.divider,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing(1),
  },
  itemBadge: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    marginRight: spacing(1),
  },
  itemTitle: {
    ...typography.subheading,
    color: colors.textPrimary,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1.25),
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  itemHint: {
    ...typography.caption,
    marginTop: spacing(0.75),
  },
  emptyState: {
    ...typography.caption,
    textAlign: 'center',
    color: colors.textMuted,
    paddingVertical: spacing(2),
  },
  cta: {
    marginTop: spacing(0.5),
  },
});

export default StickerList;
