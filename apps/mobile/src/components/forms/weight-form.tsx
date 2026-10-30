import { toLocalDate, toLocalDateTime } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Button, Row, Txt, webInput } from '@/components/ui';
import { useI18n } from '@/i18n';
import { momentOn } from '@/lib/day-logic';
import { formatNumber } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { useApi, useUser } from '@/lib/session';
import { useToast } from '@/lib/stores';
import { Fonts, Radius, Space, useTheme } from '@/theme';

/** A weigh-in: one number, typed big. A second one the same day replaces the first. */
export function WeightForm({ date, onDone }: { date: string; onDone: () => void }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const api = useApi();
  const user = useUser();
  const queryClient = useQueryClient();
  const showToast = useToast((s) => s.show);
  const [value, setValue] = useState('');
  const latest = user.profile?.weightKg ?? null;

  const kg = Number(value.replace(',', '.'));
  const valid = kg >= 25 && kg <= 400;

  const save = useMutation({
    mutationFn: () => {
      const at = momentOn(date);
      return api.putWeights({ source: 'manual', samples: [{ measuredAt: toLocalDateTime(at), localDate: toLocalDate(at), kg }] });
    },
    onSuccess: () => {
      haptics.soft();
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['day', date] });
      showToast({ message: t('weight.added', { kg: formatNumber(kg, locale, 1) }) });
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
          maxLength={5}
          accessibilityLabel={t('weight.title')}
          style={[{ minWidth: 120, fontSize: 52, fontFamily: Fonts.display, color: colors.text, textAlign: 'right', fontVariant: ['tabular-nums'] }, webInput]}
        />
        <Txt variant="heading" tone="secondary">
          kg
        </Txt>
      </Row>
      {latest ? (
        <Txt variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          {t('weight.latest', { kg: formatNumber(latest, locale, 1) })}
        </Txt>
      ) : null}
      {save.error ? (
        <Txt variant="caption" tone="warning" style={{ textAlign: 'center' }}>
          {errorMessage(save.error, t('common.error'), t('common.offline'))}
        </Txt>
      ) : null}
      <Button title={t('log.add')} onPress={() => save.mutate()} disabled={!valid} loading={save.isPending} />
    </View>
  );
}
