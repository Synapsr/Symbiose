import type { ActivityLevel, GoalsResponse, Profile, Sex } from '@symbiose/shared';
import { useMutation } from '@tanstack/react-query';
import { ChevronLeft, Sparkles, Watch } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoalComposer } from '@/components/goal-composer';
import { PlanPreview } from '@/components/plan-preview';
import { ActivityPicker, BodyFields, parseBody, SexPicker, type BodyValues } from '@/components/profile-fields';
import { Button, Field, IconButton, Row, Txt } from '@/components/ui';
import { Logo } from '@/components/ui/logo';
import { deviceLocale, useI18n } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { health } from '@/lib/health';
import { errorMessage } from '@/lib/hooks';
import { useApi, useSetUser, useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

type Step = 'name' | 'sex' | 'body' | 'activity' | 'goals' | 'plan' | 'health';

export default function Onboarding() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const user = useUser();
  const setUser = useSetUser();
  const setSettings = useSettings((s) => s.set);

  const [healthAvailable, setHealthAvailable] = useState(false);
  useEffect(() => {
    void health.isAvailable().then(setHealthAvailable).catch(() => setHealthAvailable(false));
  }, []);
  const steps: Step[] = ['name', 'sex', 'body', 'activity', 'goals', 'plan', ...(healthAvailable ? (['health'] as const) : [])];

  const [step, setStep] = useState<Step>(user.profile ? 'goals' : 'name');
  const [name, setName] = useState(user.profile?.name ?? user.name);
  const [sex, setSex] = useState<Sex | null>(user.profile?.sex ?? null);
  const [body, setBody] = useState<BodyValues>({
    birthYear: user.profile ? String(user.profile.birthYear) : '',
    heightCm: user.profile ? String(user.profile.heightCm) : '',
    weightKg: user.profile ? String(user.profile.weightKg) : '',
  });
  const [activity, setActivity] = useState<ActivityLevel | null>(user.profile?.activityLevel ?? null);
  const [intentions, setIntentions] = useState(user.plan?.intentions ?? '');
  const [draft, setDraft] = useState<(GoalsResponse & { aiGenerated: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const index = steps.indexOf(step);
  const go = (next: Step) => {
    haptics.tap();
    setError(null);
    setStep(next);
  };

  const saveProfile = useMutation({
    mutationFn: (level: ActivityLevel) => {
      const parsed = parseBody(body)!;
      const profile: Profile = {
        name: name.trim(),
        sex: sex!,
        ...parsed,
        activityLevel: level,
        locale: user.profile?.locale ?? deviceLocale(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/Paris',
      };
      return api.saveProfile(profile);
    },
    // Keep the plan empty locally so the navigator stays on onboarding until the end.
    onSuccess: (saved) => {
      setUser({ ...saved, plan: null });
      go('goals');
    },
    onError: (e) => setError(errorMessage(e, t('common.error'), t('common.offline'))),
  });

  const makePlan = useMutation({
    mutationFn: () => api.draftGoals(intentions.trim()),
    onSuccess: (res) => {
      setDraft(res);
      haptics.success();
      go('plan');
    },
    onError: (e) => setError(errorMessage(e, t('common.error'), t('common.offline'))),
  });

  const finish = useMutation({
    mutationFn: async () => {
      await api.saveGoals(draft!.plan!);
      return api.me();
    },
    onSuccess: (saved) => {
      haptics.success();
      setUser(saved);
    },
    onError: (e) => setError(errorMessage(e, t('common.error'), t('common.offline'))),
  });

  const connectHealth = async () => {
    const granted = await health.connect().catch(() => false);
    if (granted) setSettings({ healthEnabled: true });
    finish.mutate();
  };

  const primary = (() => {
    switch (step) {
      case 'name':
        return { title: t('common.continue'), onPress: () => go('sex'), disabled: !name.trim() };
      case 'sex':
        return { title: t('common.continue'), onPress: () => go('body'), disabled: !sex };
      case 'body':
        return { title: t('common.continue'), onPress: () => go('activity'), disabled: !parseBody(body) };
      case 'activity':
        return { title: t('common.continue'), onPress: () => activity && saveProfile.mutate(activity), disabled: !activity, loading: saveProfile.isPending };
      case 'goals':
        return {
          title: makePlan.isPending ? t('onb.goals.generating') : t('onb.goals.generate'),
          onPress: () => makePlan.mutate(),
          disabled: intentions.trim().length < 3,
          loading: makePlan.isPending,
          icon: <Sparkles size={18} color={colors.onInverted} />,
        };
      case 'plan':
        return {
          title: t('onb.plan.start'),
          onPress: () => (healthAvailable ? go('health') : finish.mutate()),
          loading: finish.isPending,
        };
      case 'health':
        return { title: t('onb.health.connect'), onPress: connectHealth, loading: finish.isPending, icon: <Watch size={18} color={colors.onInverted} /> };
    }
  })();

  const back = index > 0 ? () => go(steps[index - 1]!) : undefined;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top + Space.sm, paddingHorizontal: Space.xl, gap: Space.md, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Row style={{ height: 44 }}>
          {back ? <IconButton label={t('common.back')} icon={<ChevronLeft size={22} color={colors.text} />} onPress={back} /> : <View style={{ width: 44 }} />}
          <Row gap={4} style={{ flex: 1, marginHorizontal: Space.md }}>
            {steps.map((s, i) => (
              <View key={s} style={{ flex: 1, height: 4, borderRadius: Radius.pill, backgroundColor: i <= index ? colors.text : colors.surface2 }} />
            ))}
          </Row>
          <View style={{ width: 44 }} />
        </Row>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: Space.xl, paddingTop: Space.xxl, gap: Space.xxl, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Animated.View key={step} entering={FadeIn.duration(250)} style={{ gap: Space.xxl }}>
          {step === 'name' ? (
            <>
              <Txt variant="title">{t('onb.name.title')}</Txt>
              <Field value={name} onChangeText={setName} placeholder={t('onb.name.placeholder')} autoFocus autoComplete="given-name" onSubmitEditing={() => name.trim() && go('sex')} />
            </>
          ) : null}
          {step === 'sex' ? (
            <>
              <Txt variant="title">{t('onb.sex.title')}</Txt>
              <SexPicker
                value={sex}
                onChange={(v) => {
                  setSex(v);
                  setTimeout(() => go('body'), 180);
                }}
              />
            </>
          ) : null}
          {step === 'body' ? (
            <>
              <Txt variant="title">{t('onb.body.title')}</Txt>
              <BodyFields value={body} onChange={setBody} />
            </>
          ) : null}
          {step === 'activity' ? (
            <>
              <Txt variant="title">{t('onb.activity.title')}</Txt>
              <ActivityPicker
                value={activity}
                onChange={(level) => {
                  setActivity(level);
                  setTimeout(() => saveProfile.mutate(level), 200);
                }}
              />
            </>
          ) : null}
          {step === 'goals' && makePlan.isPending ? (
            <Thinking />
          ) : step === 'goals' ? (
            <>
              <Txt variant="title">{t('onb.goals.title')}</Txt>
              <GoalComposer value={intentions} onChange={setIntentions} />
            </>
          ) : null}
          {step === 'plan' && draft?.plan && draft.targets && draft.energy ? (
            <PlanPreview plan={draft.plan} targets={draft.targets} energy={draft.energy} aiGenerated={draft.aiGenerated} />
          ) : null}
          {step === 'health' ? (
            <View style={{ gap: Space.lg, alignItems: 'flex-start' }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Watch size={34} color={colors.accent} />
              </View>
              <Txt variant="title">{t('onb.health.title')}</Txt>
              <Txt tone="secondary">{t('onb.health.subtitle', { store: health.storeName })}</Txt>
            </View>
          ) : null}
        </Animated.View>
      </ScrollView>

      <View style={{ padding: Space.xl, paddingBottom: insets.bottom + Space.lg, gap: Space.sm, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        {error ? (
          <Txt variant="caption" tone="warning" style={{ textAlign: 'center' }}>
            {error}
          </Txt>
        ) : null}
        {step !== 'sex' && !(step === 'goals' && makePlan.isPending) ? <Button {...primary} /> : null}
        {step === 'plan' ? <Button title={t('onb.plan.adjust')} variant="ghost" onPress={() => go('goals')} /> : null}
        {step === 'health' ? <Button title={t('common.later')} variant="ghost" onPress={() => finish.mutate()} /> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const THINKING = ['think.1', 'think.2', 'think.3'] as const;

/** The AI is building the plan: a breathing logo and what it's doing, in words. */
function Thinking() {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % THINKING.length), 1600);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={{ alignItems: 'center', gap: Space.xl, paddingTop: 120 }}>
      <Logo size={72} breathe />
      <Animated.View key={index} entering={FadeIn.duration(350)}>
        <Txt variant="accent" tone="secondary" style={{ fontSize: 22, textAlign: 'center' }}>
          {t(THINKING[index]!)}
        </Txt>
      </Animated.View>
    </View>
  );
}
