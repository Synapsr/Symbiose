import { toLocalDate, toLocalDateTime } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Button, Row, Txt, webInput } from '@/components/ui';
import { useI18n } from '@/i18n';
import { momentOn } from '@/lib/day-logic';
import { haptics } from '@/lib/haptics';
import { health } from '@/lib/health';
import { errorMessage } from '@/lib/hooks';
import { useApi } from '@/lib/session';
import { useSettings, useToast } from '@/lib/stores';
import { Fonts, Radius, Space, useTheme } from '@/theme';

function parse(value: string): number | null {
  const n = Number(value.replace(',', '.'));
  return value.trim() && Number.isFinite(n) ? Math.round(n) : null;
}

type FieldKey = 'systolic' | 'diastolic' | 'pulse';

/** A blood pressure reading: the two numbers (and the pulse, if you like), checked as they're typed. */
export function BloodPressureForm({ date, onDone }: { date: string; onDone: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const api = useApi();
  const queryClient = useQueryClient();
  const showToast = useToast((s) => s.show);
  const healthEnabled = useSettings((s) => s.healthEnabled);
  const [form, setForm] = useState<Record<FieldKey, string>>({ systolic: '', diastolic: '', pulse: '' });

  const systolic = parse(form.systolic);
  const diastolic = parse(form.diastolic);
  const pulse = parse(form.pulse);
  const inRange = systolic !== null && diastolic !== null && systolic >= 60 && systolic <= 260 && diastolic >= 30 && diastolic <= 160;
  const pulseOk = !form.pulse.trim() || (pulse !== null && pulse >= 30 && pulse <= 220);
  const valid = inRange && diastolic < systolic && pulseOk;
  const problem = systolic === null || diastolic === null ? null : !inRange || !pulseOk ? t('bp.invalid') : diastolic >= systolic ? t('bp.swapped') : null;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['insights'] });
  const save = useMutation({
    mutationFn: () => {
      const at = momentOn(date);
      return api.createBloodPressure({ externalId: null, measuredAt: toLocalDateTime(at), localDate: toLocalDate(at), systolic: systolic!, diastolic: diastolic!, pulse: form.pulse.trim() ? pulse : null });
    },
    onSuccess: (reading) => {
      haptics.soft();
      refresh();
      // Both ways: a reading typed here also lands in the health store (and isn't imported back).
      if (healthEnabled && health.source) {
        void health.writeBloodPressure({ id: reading.id, measuredAt: new Date(reading.measuredAt), systolic: reading.systolic, diastolic: reading.diastolic }).catch(() => undefined);
      }
      showToast({
        message: t('bp.added', { value: `${reading.systolic}/${reading.diastolic}` }),
        action: { label: t('today.undo'), onPress: () => void api.deleteBloodPressure(reading.id).then(refresh, () => haptics.warning()) },
      });
      onDone();
    },
    onError: () => haptics.warning(),
  });

  const input = (key: FieldKey, placeholder: string, label: string, last = false) => (
    <View style={{ flex: 1, gap: 6 }}>
      <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ textAlign: 'center' }}>
        {label}
      </Txt>
      <TextInput
        value={form[key]}
        onChangeText={(value) => setForm((f) => ({ ...f, [key]: value }))}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        keyboardType="number-pad"
        returnKeyType={last ? 'done' : 'next'}
        maxLength={3}
        autoFocus={key === 'systolic'}
        accessibilityLabel={label}
        style={[
          { height: 64, borderRadius: Radius.lg, borderCurve: 'continuous', backgroundColor: colors.surface, textAlign: 'center', fontSize: 28, fontFamily: Fonts.title, color: colors.text, fontVariant: ['tabular-nums'] },
          webInput,
        ]}
      />
    </View>
  );

  return (
    <View style={{ gap: Space.lg }}>
      <Row gap={Space.sm} style={{ alignItems: 'flex-end' }}>
        {input('systolic', '120', t('bp.systolic'))}
        <Txt variant="title" tone="tertiary" style={{ marginBottom: 12 }}>
          /
        </Txt>
        {input('diastolic', '80', t('bp.diastolic'))}
        {input('pulse', '70', t('bp.pulse'), true)}
      </Row>
      {problem ? (
        <Txt variant="caption" tone="warning" style={{ textAlign: 'center' }}>
          {problem}
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
