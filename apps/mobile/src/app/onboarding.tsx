import type { ActivityLevel, GoalsResponse, Profile, Sex } from '@symbiose/shared';
import { useMutation } from '@tanstack/react-query';
import { ChevronLeft, Flame, HeartPulse, Ruler, Sparkles, Watch } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoalComposer } from '@/components/goal-composer';
import { PendingPanel } from '@/components/pending-panel';
import { PlanPreview } from '@/components/plan-preview';
import { ActivityPicker, BodyFields, parseBody, SexPicker, type BodyValues } from '@/components/profile-fields';
import { Button, Field, IconButton, Reveal, Row, Txt } from '@/components/ui';
import { Logo } from '@/components/ui/logo';
import { deviceLocale, useI18n } from '@/i18n';
import { feedback } from '@/lib/feedback';
import { haptics } from '@/lib/haptics';
import { health, HEALTH_SCOPES, type HealthProfile } from '@/lib/health';
import { errorMessage } from '@/lib/hooks';
import { useApi, useSetUser, useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

/** `waiting`: sign-up on request, after the goals, until an admin approves the account. */
type Step = 'name' | 'health' | 'sex' | 'body' | 'activity' | 'goals' | 'plan' | 'waiting';

const BENEFITS = [
  { icon: Ruler, key: 'onb.health.b1' },
  { icon: Flame, key: 'onb.health.b2' },
  { icon: HeartPulse, key: 'onb.health.b3' },
] as const;

export default function Onboarding() {
  const { t, locale } = useI18n();
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const user = useUser();
  const setUser = useSetUser();
  const setSettings = useSettings((s) => s.set);
  const waitingIntentions = useSettings((s) => s.waitingIntentions);

  const [healthAvailable, setHealthAvailable] = useState(false);
  useEffect(() => {
    void health.isAvailable().then(setHealthAvailable).catch(() => setHealthAvailable(false));
  }, []);
  // Sex already known from the health store: no need to ask.
  const [sexFromHealth, setSexFromHealth] = useState(false);
  const [bodyFromHealth, setBodyFromHealth] = useState(false);
  const steps: Step[] = ['name', ...(healthAvailable ? (['health'] as const) : []), ...(sexFromHealth ? [] : (['sex'] as const)), 'body', 'activity', 'goals', 'plan'];

  // Goals written while waiting: back at the plan step, approved or not yet.
  const [step, setStep] = useState<Step>(user.profile ? (waitingIntentions ? 'waiting' : 'goals') : 'name');
  const [name, setName] = useState(user.profile?.name ?? user.name);
  const [sex, setSex] = useState<Sex | null>(user.profile?.sex ?? null);
  const [body, setBody] = useState<BodyValues>({
    birthYear: user.profile ? String(user.profile.birthYear) : '',
    heightCm: user.profile ? String(user.profile.heightCm) : '',
    weightKg: user.profile ? String(user.profile.weightKg) : '',
  });
  const [activity, setActivity] = useState<ActivityLevel | null>(user.profile?.activityLevel ?? null);
  const [intentions, setIntentions] = useState(user.plan?.intentions ?? waitingIntentions);
  const [draft, setDraft] = useState<(GoalsResponse & { aiGenerated: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A waiting account goes through the whole onboarding, but the AI only writes its plan once approved.
  const pending = user.pending === true;
  const resuming = step === 'waiting' && !pending;
  const index = steps.indexOf(step === 'waiting' ? 'goals' : step);
  const go = (next: Step) => {
    haptics.tap();
    setError(null);
    setStep(next);
  };
  const afterName = healthAvailable ? 'health' : 'sex';

  // Health first: one permission sheet, then the profile fills itself.
  const connectHealth = useMutation({
    mutationFn: async (): Promise<HealthProfile> => {
      const granted = await health.connect().catch(() => false);
      if (!granted) return {};
      setSettings({ healthEnabled: true, healthScopes: HEALTH_SCOPES });
      return health.readProfile().catch(() => ({}));
    },
    onSuccess: (found) => {
      if (found.sex) setSex(found.sex);
      setSexFromHealth(Boolean(found.sex));
      setBody((current) => ({
        birthYear: found.birthYear ? String(found.birthYear) : current.birthYear,
        heightCm: found.heightCm ? String(found.heightCm) : current.heightCm,
        weightKg: found.weightKg ? String(found.weightKg).replace('.', locale === 'fr' ? ',' : '.') : current.weightKg,
      }));
      setBodyFromHealth(Boolean(found.birthYear || found.heightCm || found.weightKg));
      if (found.sex || found.birthYear || found.heightCm || found.weightKg) haptics.success();
      go(found.sex ? 'body' : 'sex');
    },
  });

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

  // Approved (just now, or since the last visit): the AI drafts the plan from the saved words, as usual.
  const draftPlan = makePlan.mutate;
  const draftIdle = makePlan.isIdle;
  useEffect(() => {
    if (resuming && draftIdle && intentions.trim().length >= 3) draftPlan();
  }, [resuming, draftIdle, draftPlan, intentions]);

  const finish = useMutation({
    mutationFn: async () => {
      await api.saveGoals(draft!.plan!);
      return api.me();
    },
    onSuccess: (saved) => {
      // The plan is made: the first milestone.
      feedback.milestone();
      setSettings({ waitingIntentions: '' });
      setUser(saved);
    },
    onError: (e) => setError(errorMessage(e, t('common.error'), t('common.offline'))),
  });

  const primary = (() => {
    switch (step) {
      case 'name':
        return { title: t('common.continue'), onPress: () => go(afterName), disabled: !name.trim() };
      case 'health':
        return {
          title: t('onb.health.connect'),
          onPress: () => connectHealth.mutate(),
          loading: connectHealth.isPending,
          icon: <Watch size={18} color={colors.onInverted} />,
        };
      case 'sex':
        return { title: t('common.continue'), onPress: () => go('body'), disabled: !sex };
      case 'body':
        return { title: t('common.continue'), onPress: () => go('activity'), disabled: !parseBody(body) };
      case 'activity':
        return { title: t('common.continue'), onPress: () => activity && saveProfile.mutate(activity), disabled: !activity, loading: saveProfile.isPending };
      case 'goals':
      case 'waiting':
        if (pending) {
          return {
            title: t('admin.pending.send'),
            onPress: () => {
              haptics.success();
              setSettings({ waitingIntentions: intentions.trim() });
              go('waiting');
            },
            disabled: intentions.trim().length < 3,
          };
        }
        return {
          title: makePlan.isPending ? t('onb.goals.generating') : t('onb.goals.generate'),
          onPress: () => makePlan.mutate(),
          disabled: intentions.trim().length < 3,
          loading: makePlan.isPending,
          icon: <Sparkles size={18} color={colors.onInverted} />,
        };
      case 'plan':
        return { title: t('onb.plan.start'), onPress: () => finish.mutate(), loading: finish.isPending };
    }
  })();

  const back = index > 0 ? () => go(steps[index - 1]!) : undefined;
  const thinking = makePlan.isPending || (resuming && draftIdle);

  if (step === 'waiting' && pending) return <PendingPanel />;

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
              <Field value={name} onChangeText={setName} placeholder={t('onb.name.placeholder')} autoFocus autoComplete="given-name" onSubmitEditing={() => name.trim() && go(afterName)} />
            </>
          ) : null}
          {step === 'health' ? (
            <View style={{ gap: Space.xxl }}>
              <View style={{ gap: Space.lg, alignItems: 'flex-start' }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Watch size={34} color={colors.accent} />
                </View>
                <Txt variant="title">{t('onb.health.title', { store: health.storeName[locale] })}</Txt>
              </View>
              <View style={{ gap: Space.lg }}>
                {BENEFITS.map(({ icon: Icon, key }, i) => (
                  <Reveal key={key} index={i + 1}>
                    <Row gap={Space.md}>
                      <View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, elevation]}>
                        <Icon size={18} color={colors.text} />
                      </View>
                      <Txt style={{ flex: 1 }}>{t(key, { store: health.storeName[locale] })}</Txt>
                    </Row>
                  </Reveal>
                ))}
              </View>
              <Txt variant="caption" tone="tertiary">
                {t('onb.health.note')}
              </Txt>
            </View>
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
              <View style={{ gap: Space.sm }}>
                <Txt variant="title">{t('onb.body.title')}</Txt>
                {bodyFromHealth ? (
                  <Row gap={6}>
                    <HeartPulse size={14} color={colors.accentText} />
                    <Txt variant="caption" tone="accent">
                      {t('onb.body.fromHealth', { store: health.storeName[locale] })}
                    </Txt>
                  </Row>
                ) : null}
              </View>
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
          {(step === 'goals' || step === 'waiting') && thinking ? (
            <Thinking />
          ) : step === 'goals' || step === 'waiting' ? (
            <>
              <Txt variant="title">{t('onb.goals.title')}</Txt>
              <GoalComposer value={intentions} onChange={setIntentions} />
            </>
          ) : null}
          {step === 'plan' && draft?.plan && draft.targets && draft.energy ? (
            <PlanPreview plan={draft.plan} targets={draft.targets} energy={draft.energy} aiGenerated={draft.aiGenerated} />
          ) : null}
        </Animated.View>
      </ScrollView>

      <View style={{ padding: Space.xl, paddingBottom: insets.bottom + Space.lg, gap: Space.sm, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        {error ? (
          <Txt variant="caption" tone="warning" style={{ textAlign: 'center' }}>
            {error}
          </Txt>
        ) : null}
        {step !== 'sex' && !((step === 'goals' || step === 'waiting') && thinking) ? <Button {...primary} /> : null}
        {step === 'plan' ? <Button title={t('onb.plan.adjust')} variant="ghost" onPress={() => go('goals')} /> : null}
        {step === 'health' ? <Button title={t('common.later')} variant="ghost" onPress={() => go(sexFromHealth ? 'body' : 'sex')} disabled={connectHealth.isPending} /> : null}
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
