import { toLocalDateTime } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Button, Row, Txt, webInput } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatKg, formatNumber } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { useApi, useUser } from '@/lib/session';
import { useToast } from '@/lib/stores';
import { useDeleteWeight } from '@/lib/weight';
import { Fonts, Radius, Space, useTheme } from '@/theme';

/**
 * A weigh-in: one number, typed big. A second one the same day replaces the first. With `initialKg`,
 * the day's reading is being corrected: it starts filled in, and can be deleted instead.
 */
export function WeightForm({ date, onDone, initialKg }: { date: string; onDone: () => void; initialKg?: number }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const api = useApi();
  const user = useUser();
  const queryClient = useQueryClient();
  const showToast = useToast((s) => s.show);
  const remove = useDeleteWeight();
  const editing = initialKg !== undefined;
  const [value, setValue] = useState(editing ? formatNumber(initialKg, locale, 1) : '');
  const latest = user.profile?.weightKg ?? null;

  const kg = Number(value.replace(',', '.'));
  const valid = kg >= 25 && kg <= 400;

  const save = useMutation({
    // Typed now, for that day: the newest word on it, over the scale's reading of the same day.
    mutationFn: () => api.putWeights({ source: 'manual', samples: [{ measuredAt: toLocalDateTime(), localDate: date, kg }] }),
    onSuccess: () => {
      haptics.soft();
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['day', date] });
      showToast({ message: t(editing ? 'weight.corrected' : 'weight.added', { kg: formatKg(kg, locale) }) });
      onDone();
    },
    onError: () => haptics.warning(),
  });

  return (
    <View style={{ gap: Space.lg }}>
      <Row gap={Space.sm} style={{ justifyContent: 'center', alignItems: 'baseline', backgroundColor: colors.surface, borderRadius: Radius.xl, borderCurve: 'continuous', paddingVertical: Space.lg }}>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder={latest ? formatNumber(latest, locale, 1) : '70'}
          placeholderTextColor={colors.text3}
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={() => valid && save.mutate()}
          autoFocus
          selectTextOnFocus={editing}
          maxLength={5}
          accessibilityLabel={t('weight.title')}
          style={[{ minWidth: 120, maxWidth: 180, flexShrink: 1, fontSize: 52, fontFamily: Fonts.display, color: colors.text, textAlign: 'right', fontVariant: ['tabular-nums'] }, webInput]}
        />
        <Txt variant="heading" tone="secondary">
          kg
        </Txt>
      </Row>
      {latest && !editing ? (
        <Txt variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          {t('weight.latest', { kg: formatNumber(latest, locale, 1) })}
        </Txt>
      ) : null}
      {save.error ? (
        <Txt variant="caption" tone="warning" style={{ textAlign: 'center' }}>
          {errorMessage(save.error, t('common.error'), t('common.offline'))}
        </Txt>
      ) : null}
      <Button title={editing ? t('common.save') : t('log.add')} onPress={() => save.mutate()} disabled={!valid || (editing && kg === initialKg)} loading={save.isPending} />
      {editing ? (
        <Button
          title={t('weight.delete')}
          variant="ghost"
          size="md"
          icon={<Trash2 size={16} color={colors.text2} />}
          onPress={() => {
            remove({ date, kg: initialKg });
            onDone();
          }}
        />
      ) : null}
    </View>
  );
}
