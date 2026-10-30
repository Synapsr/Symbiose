import { router } from 'expo-router';
import { NotebookPen } from 'lucide-react-native';
import { View } from 'react-native';

import { Pressy, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { Radius, Space, useTheme } from '@/theme';

/**
 * Today's way into the journal. Next to « J'ai une envie » it's a small tile;
 * on its own, a slim row that says what it's for. Neutral, so meals stay first.
 */
export function NoteAction({ date, compact }: { date: string; compact: boolean }) {
  const { t } = useI18n();
  const { colors, elevation } = useTheme();
  const icon = (
    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
      <NotebookPen size={18} color={colors.text} />
    </View>
  );
  return (
    <Pressy
      onPress={() => router.push({ pathname: '/note', params: { date } })}
      accessibilityRole="button"
      accessibilityLabel={t('journal.note')}
      accessibilityHint={t('journal.noteHint')}
      style={[
        { borderRadius: Radius.lg, borderCurve: 'continuous', backgroundColor: colors.surface },
        compact
          ? { width: 84, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Space.md }
          : { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.lg, paddingVertical: Space.md },
        elevation,
      ]}>
      {icon}
      {compact ? (
        <Txt variant="label">{t('journal.note')}</Txt>
      ) : (
        <View style={{ flex: 1 }}>
          <Txt variant="label" style={{ fontSize: 16 }}>
            {t('journal.note')}
          </Txt>
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            {t('journal.noteHint')}
          </Txt>
        </View>
      )}
    </Pressy>
  );
}
