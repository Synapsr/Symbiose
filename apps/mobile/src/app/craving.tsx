import { toLocalDate, toLocalDateTime, type Craving } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Lightbulb, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Chip, Field, Row, Segmented, Txt } from '@/components/ui';
import { Celebration } from '@/components/ui/celebration';
import { dismiss } from '@/lib/nav';
import { useI18n, type TranslationKey } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { useApi } from '@/lib/session';
import { Space, useTheme } from '@/theme';

const QUICK = ['sweet', 'chocolate', 'snack', 'soda', 'salty'] as const;

export default function CravingSheet() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const queryClient = useQueryClient();
  const [what, setWhat] = useState('');
  const [intensity, setIntensity] = useState<'1' | '2' | '3'>('2');
  const [result, setResult] = useState<{ craving: Craving; alternative: string } | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  const today = toLocalDate();
  const create = useMutation({
    mutationFn: () => api.createCraving({ at: toLocalDateTime(), localDate: today, what: what.trim(), intensity: Number(intensity) }),
    onSuccess: (res) => {
      haptics.success();
      setResult(res);
      void queryClient.invalidateQueries({ queryKey: ['day', today] });
    },
  });
  const settle = useMutation({
    mutationFn: (outcome: 'resisted' | 'gave_in') => api.updateCraving(result!.craving.id, outcome),
    onSuccess: (craving) => {
      void queryClient.invalidateQueries({ queryKey: ['day', today] });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      if (craving.outcome === 'resisted') {
        haptics.success();
        setCelebrating(true);
        setTimeout(() => dismiss(), 1900);
      } else {
        router.replace({ pathname: '/capture', params: { mode: 'text' } });
      }
    },
  });

  if (celebrating) return <Celebration emoji="💪" title={t('craving.celebrate')} subtitle={t('craving.celebrateBody')} />;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: Space.xl, paddingTop: Space.xxl, paddingBottom: insets.bottom + Space.xxl, gap: Space.xl }}>
      <View style={{ gap: Space.sm }}>
        <Txt variant="title">{t('craving.title')}</Txt>
        <Txt tone="secondary">{t('craving.subtitle')}</Txt>
      </View>

      {!result ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
            {QUICK.map((key) => {
              const label = t(`craving.${key}` as TranslationKey);
              return <Chip key={key} label={label} selected={what === label} onPress={() => setWhat(label)} />;
            })}
          </View>
          <Field value={what} onChangeText={setWhat} placeholder={t('craving.what')} />
          <View style={{ gap: Space.sm }}>
            <Txt variant="caption" tone="secondary">
              {t('craving.intensity')}
            </Txt>
            <Segmented
              value={intensity}
              onChange={setIntensity}
              options={[
                { value: '1', label: t('craving.low') },
                { value: '2', label: t('craving.mid') },
                { value: '3', label: t('craving.high') },
              ]}
            />
          </View>
          {create.error ? (
            <Txt variant="caption" tone="warning">
              {errorMessage(create.error, t('common.error'), t('common.offline'))}
            </Txt>
          ) : null}
          <Button title={t('craving.help')} icon={<Sparkles size={18} color={colors.onInverted} />} onPress={() => create.mutate()} loading={create.isPending} disabled={!what.trim()} />
        </>
      ) : (
        <Animated.View entering={FadeInDown.duration(250)} style={{ gap: Space.lg }}>
          <Card style={{ gap: Space.sm, backgroundColor: colors.accentSoft, borderColor: 'transparent' }}>
            <Row gap={Space.sm}>
              <Sparkles size={18} color={colors.accent} />
              <Txt variant="overline" tone="accent">
                {t('craving.help')}
              </Txt>
            </Row>
            <Txt style={{ fontSize: 18, lineHeight: 25 }}>{result.craving.tip}</Txt>
          </Card>
          <Card style={{ gap: Space.sm }}>
            <Row gap={Space.sm}>
              <Lightbulb size={18} color={colors.warning} />
              <Txt variant="overline" tone="secondary">
                {t('craving.alternative')}
              </Txt>
            </Row>
            <Txt style={{ fontSize: 17 }}>{result.alternative}</Txt>
          </Card>
          <Button title={t('craving.resisted')} variant="accent" onPress={() => settle.mutate('resisted')} loading={settle.isPending && settle.variables === 'resisted'} />
          <Button title={t('craving.gaveIn')} variant="secondary" onPress={() => settle.mutate('gave_in')} loading={settle.isPending && settle.variables === 'gave_in'} />
          <Txt variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
            {t('craving.gaveInHint')}
          </Txt>
        </Animated.View>
      )}
    </ScrollView>
  );
}
