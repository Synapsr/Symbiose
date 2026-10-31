import { ageFromBirthYear, everydayWaterGoalMl, hydrationGoalMl, WATER_SIZES, type Locale, type Profile } from '@symbiose/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  ChevronDown,
  ChevronRight,
  CodeXml,
  Download,
  EyeOff,
  FaceSlightlySmiling,
  Gauge,
  GlassWater,
  Hand,
  HeartPulse,
  Languages,
  LogOut,
  Minus,
  Moon,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  Volume2,
  Watch,
  Activity,
} from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signed } from '@/components/insights/adaptive-energy-card';
import { CoachSettings } from '@/components/settings/coach-settings';
import { Card, Dot, IconButton, Pressy, Row, SectionTitle, Segmented, Toggle, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { formatAmount, formatLiters, formatNumber } from '@/lib/format';
import { feedback } from '@/lib/feedback';
import { haptics } from '@/lib/haptics';
import { grantedScopes, health, HEALTH_SCOPES, healthModules, type HealthModules } from '@/lib/health';
import { useHealthSync, useToday } from '@/lib/hooks';
import { clearOutbox, useOutbox } from '@/lib/outbox';
import { useApi, useSession, useSetUser, useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { LIFE_COLORS, NUTRIENT_COLORS, Radius, Space, useTheme } from '@/theme';

/** The opt-in modules: a profile switch each, and the health-store types it needs (mood needs none). */
type ModuleKey = 'trackHydration' | 'trackSleep' | 'trackMood' | 'trackBloodPressure';
const HEALTH_MODULE: Record<ModuleKey, keyof HealthModules | null> = {
  trackHydration: 'hydration',
  trackSleep: 'sleep',
  trackMood: null,
  trackBloodPressure: 'bloodPressure',
};
/** Turning a module on (again) re-reads its history from the store, asking for its types first if needed. */
const RESYNC = { hydration: { lastWaterSync: 0 }, sleep: { lastSleepSync: 0 }, bloodPressure: { lastBpSync: 0 }, vitals: { lastVitalsSync: 0 } } as const;

/** Me is settings only: who I am, my goals, what I track, the coach, devices, preferences, account. */
export default function Me() {
  const { t, plural, locale, nutrient } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useUser();
  const api = useApi();
  const { signOut } = useSession();
  const settings = useSettings();
  const today = useToday();
  const syncHealth = useHealthSync(today);
  const [healthAvailable, setHealthAvailable] = useState(false);
  useEffect(() => {
    void health.isAvailable().then(setHealthAvailable).catch(() => setHealthAvailable(false));
  }, []);

  const profile = user.profile!;
  const plan = user.plan!;
  const setUser = useSetUser();
  const queryClient = useQueryClient();
  const modules = healthModules(profile);
  const refreshData = () => {
    void queryClient.invalidateQueries({ queryKey: ['day'] });
    void queryClient.invalidateQueries({ queryKey: ['insights'] });
    void queryClient.invalidateQueries({ queryKey: ['weekly-review'] });
    void queryClient.invalidateQueries({ queryKey: ['goals'] });
  };

  const toggleHealth = async (on: boolean) => {
    if (on) {
      const granted = await health.connect(modules).catch(() => false);
      settings.set(granted ? { healthEnabled: true, healthScopes: HEALTH_SCOPES, ...grantedScopes(modules) } : { healthEnabled: false });
      if (granted) {
        haptics.success();
        void syncHealth(true);
      }
    } else {
      settings.set({ healthEnabled: false });
    }
  };

  // Every profile setting saves on its own: the server and the coach read the profile.
  const saveProfile = useMutation({
    mutationFn: (patch: Partial<Profile>) => api.saveProfile({ ...profile, ...patch } satisfies Profile),
    onSuccess: (saved, patch) => {
      // Turning a module on imports its history: the health sync asks for its types once (see `grantedScopes`).
      for (const key of Object.keys(HEALTH_MODULE) as ModuleKey[]) {
        const module = HEALTH_MODULE[key];
        if (patch[key] === true && module) settings.set(RESYNC[module]);
      }
      setUser(saved);
      refreshData();
    },
    onError: () => haptics.warning(),
  });
  const moduleSwitch = (key: ModuleKey) => {
    const pending = saveProfile.isPending && saveProfile.variables[key] !== undefined;
    return (
      <Toggle
        value={pending ? saveProfile.variables[key] === true : profile[key] === true}
        disabled={saveProfile.isPending}
        onValueChange={(on) => {
          haptics.soft();
          saveProfile.mutate({ [key]: on });
        }}
      />
    );
  };
  const store = healthAvailable ? health.storeName[locale] : null;

  // The measured expenditure as of today, to say what the automatic budget does.
  const goals = useQuery({ queryKey: ['goals', today], queryFn: () => api.goals(today), enabled: !settings.hideCalories });
  const adaptive = goals.data?.adaptiveEnergy ?? null;
  const toggleAdaptive = useMutation({
    // Opting in starts a gradual ramp from today; the server keeps the date.
    mutationFn: async (on: boolean) => {
      await api.saveGoals({ ...plan, adaptiveEnergy: on ? { since: today } : null });
      return api.me();
    },
    onSuccess: (saved) => {
      haptics.soft();
      setUser(saved);
      refreshData();
    },
    onError: () => haptics.warning(),
  });
  const adaptiveOn = toggleAdaptive.isPending ? toggleAdaptive.variables : Boolean(plan.adaptiveEnergy);
  const adaptiveHint =
    adaptiveOn && adaptive?.enabled && adaptive.appliedKcal
      ? t('energy.autoApplied', { kcal: signed(adaptive.appliedKcal, formatNumber(Math.abs(adaptive.appliedKcal), locale)) })
      : adaptiveOn
        ? t('energy.autoWaiting')
        : t('energy.autoHint');

  // The waiting meals belong to this account on this server: signing out forgets them, after a warning.
  const waiting = useOutbox((s) => s.items.length);
  const confirmSignOut = () => {
    const run = async () => {
      await clearOutbox();
      await signOut();
    };
    if (!waiting) return void run();
    const body = waiting === 1 ? t('outbox.signOutOne') : t('outbox.signOutMany', { count: waiting });
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(`${t('outbox.signOutTitle')}\n\n${body}`)) void run();
      return;
    }
    Alert.alert(t('outbox.signOutTitle'), body, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('me.signOut'), style: 'destructive', onPress: () => void run() },
    ]);
  };

  const confirmDelete = () => {
    const run = async () => {
      await api.deleteAccount();
      await clearOutbox();
      await signOut();
    };
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(t('me.deleteConfirm'))) void run();
      return;
    }
    Alert.alert(t('me.deleteAccount'), t('me.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void run() },
    ]);
  };

  const pendingLocale = saveProfile.isPending ? saveProfile.variables.locale : undefined;

  // Admins see how many people wait to get in (sign-up on request), right on the row.
  const requests = useQuery({ queryKey: ['admin-requests'], queryFn: () => api.adminRequests(), enabled: user.isAdmin });
  const waitingRequests = requests.data?.requests.length ?? 0;
  // A server from before the admin view flags its first account as admin: no row there.
  const showAdmin = user.isAdmin && !(requests.error instanceof ApiError && requests.error.status === 404);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.md, paddingHorizontal: Space.lg, paddingBottom: insets.bottom + 120, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      <Pressy onPress={() => router.push('/profile')} accessibilityRole="button" accessibilityLabel={profile.name || user.email}>
        <Row gap={Space.lg} style={{ paddingHorizontal: 4 }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.inverted, alignItems: 'center', justifyContent: 'center' }}>
            <Txt variant="title" color={colors.onInverted} style={{ fontSize: 24 }}>
              {(profile.name || user.email).slice(0, 1).toUpperCase()}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="title" numberOfLines={1} style={{ fontSize: 26 }}>
              {profile.name || user.email}
            </Txt>
            <Txt tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
              {t('me.age', { age: ageFromBirthYear(profile.birthYear) })} · {profile.heightCm} cm · {formatNumber(profile.weightKg, locale, 1)} kg
            </Txt>
          </View>
          <ChevronRight size={20} color={colors.text3} />
        </Row>
      </Pressy>

      <SectionTitle>{t('me.goals')}</SectionTitle>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <Pressy onPress={() => router.push('/goals')} accessibilityRole="button" accessibilityLabel={plan.title}>
          <View style={{ paddingHorizontal: Space.xl, paddingVertical: Space.lg, gap: Space.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt variant="label" style={{ fontSize: 16, flex: 1 }} numberOfLines={2}>
                {plan.title}
              </Txt>
              <ChevronRight size={18} color={colors.text3} />
            </Row>
            {plan.rules.length ? (
              <Row gap={Space.sm} style={{ flexWrap: 'wrap' }}>
                {plan.rules.map((rule) => (
                  <Row key={rule.nutrient} gap={6} style={{ backgroundColor: colors.surface2, borderRadius: Radius.pill, paddingHorizontal: 12, height: 28 }}>
                    <Dot color={NUTRIENT_COLORS[rule.nutrient]} size={6} />
                    <Txt variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
                      {nutrient(rule.nutrient)} {rule.kind === 'max' ? '≤' : '≥'} {formatAmount(rule.nutrient, rule.value, locale)}
                    </Txt>
                  </Row>
                ))}
              </Row>
            ) : null}
          </View>
        </Pressy>
        {!settings.hideCalories ? (
          <>
            <Divider />
            <Item
              icon={<Gauge size={20} color={colors.text} />}
              title={t('energy.auto')}
              subtitle={adaptiveHint}
              right={<Toggle value={adaptiveOn} disabled={toggleAdaptive.isPending} onValueChange={(on) => toggleAdaptive.mutate(on)} accessibilityLabel={t('energy.auto')} />}
            />
          </>
        ) : null}
        <Divider />
        <Item
          icon={<EyeOff size={20} color={colors.text} />}
          title={t('me.hideCalories')}
          subtitle={t('me.hideCaloriesHint')}
          right={<Toggle value={settings.hideCalories} onValueChange={(v) => settings.set({ hideCalories: v })} />}
        />
      </Card>

      {/* What Symbiose follows besides meals and movement: each module is off until switched on. */}
      <SectionTitle>{t('me.tracking')}</SectionTitle>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <HydrationItem profile={profile} right={moduleSwitch('trackHydration')} onGoal={(waterGoalMl) => saveProfile.mutate({ waterGoalMl })} />
        <Divider />
        {/* The why of a module helps to switch it on; once it's on, the row stays short. */}
        <Item icon={<Moon size={20} color={colors.text} />} title={t('me.trackSleep')} subtitle={profile.trackSleep ? undefined : store ? t('me.trackSleepHint', { store }) : t('me.trackSleepHintNoStore')} right={moduleSwitch('trackSleep')} />
        <Divider />
        <Item icon={<FaceSlightlySmiling size={20} color={colors.text} />} title={t('me.trackMood')} subtitle={profile.trackMood ? undefined : t('me.trackMoodHint')} right={moduleSwitch('trackMood')} />
        <Divider />
        <Item icon={<HeartPulse size={20} color={colors.text} />} title={t('me.trackBp')} subtitle={profile.trackBloodPressure ? undefined : t('me.trackBpHint')} right={moduleSwitch('trackBloodPressure')} />
      </Card>

      <SectionTitle>{t('me.coach')}</SectionTitle>
      <CoachSettings />

      <SectionTitle>{t('me.devices')}</SectionTitle>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <Item
          icon={<Activity size={20} color={colors.accent} />}
          title={healthAvailable ? health.storeName[locale] : t('me.healthStores')}
          subtitle={healthAvailable ? (settings.healthEnabled ? t('me.healthOn', { store: health.storeName[locale] }) : t('me.healthOff')) : t('me.healthUnavailable')}
          right={healthAvailable ? <Toggle value={settings.healthEnabled} onValueChange={(v) => void toggleHealth(v)} /> : null}
        />
        {Platform.OS === 'ios' ? (
          <>
            <Divider />
            <Item icon={<Watch size={20} color={colors.text} />} title={t('me.watch')} subtitle={t('me.watchHint')} />
          </>
        ) : null}
      </Card>

      <SectionTitle>{t('me.preferences')}</SectionTitle>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <Item
          icon={<Hand size={20} color={colors.text} style={{ transform: [{ scaleX: -1 }] }} />}
          title={t('me.leftHanded')}
          subtitle={t('me.leftHandedHint')}
          right={<Toggle value={settings.leftHanded} onValueChange={(v) => settings.set({ leftHanded: v })} />}
        />
        <Divider />
        <Item
          icon={<Volume2 size={20} color={colors.text} />}
          title={t('me.sounds')}
          subtitle={t('me.soundsHint')}
          right={
            <Switch
              value={settings.sounds}
              onValueChange={(on) => {
                settings.set({ sounds: on });
                // Switched on: a taste of what they sound like.
                if (on) feedback.preview();
              }}
            />
          }
        />
        <Divider />
        <Item
          icon={<Languages size={20} color={colors.text} />}
          title={t('me.language')}
          right={
            <Segmented<Locale>
              value={pendingLocale ?? profile.locale}
              onChange={(value) => value !== profile.locale && saveProfile.mutate({ locale: value })}
              options={[
                { value: 'fr', label: 'FR' },
                { value: 'en', label: 'EN' },
              ]}
            />
          }
        />
      </Card>

      <SectionTitle>{t('me.account')}</SectionTitle>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <Item icon={<Server size={20} color={colors.text} />} title={api.baseUrl.replace(/^https?:\/\//, '')} subtitle={user.email} />
        {/* Only for the emails listed in ADMIN_EMAILS on the server. */}
        {showAdmin ? (
          <>
            <Divider />
            <Item
              icon={<ShieldCheck size={20} color={colors.text} />}
              title={t('admin.title')}
              subtitle={t('admin.row')}
              onPress={() => router.push('/admin')}
              right={waitingRequests ? <CountBadge count={waitingRequests} label={plural('admin.waiting', waitingRequests)} /> : null}
              chevron
            />
          </>
        ) : null}
        <Divider />
        <Item
          icon={<Download size={20} color={colors.text} />}
          title={t('me.export')}
          onPress={() => void WebBrowser.openBrowserAsync(`${api.exportUrl()}?token=${encodeURIComponent(api.token)}`)}
          chevron
        />
        <Divider />
        <Item icon={<LogOut size={20} color={colors.text} />} title={t('me.signOut')} onPress={confirmSignOut} />
        <Divider />
        <Item icon={<Trash2 size={20} color={colors.danger} />} title={t('me.deleteAccount')} danger onPress={confirmDelete} />
      </Card>

      <Pressy onPress={() => void WebBrowser.openBrowserAsync('https://github.com/Synapsr/Symbiose')} style={{ marginTop: Space.xxl, alignItems: 'center', gap: 6 }}>
        <CodeXml size={18} color={colors.text3} />
        <Txt variant="caption" tone="tertiary">
          {t('me.about')}
        </Txt>
      </Pressy>
    </ScrollView>
  );
}

/**
 * Hydration: the switch, and once it's on, the everyday goal and what one tap pours (the glass
 * size, kept on this phone). A tap on the row opens both; the goal saves a moment after the last step.
 */
function HydrationItem({ profile, right, onGoal }: { profile: Profile; right: ReactNode; onGoal: (ml: number | null) => void }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const glassMl = useSettings((s) => s.glassMl);
  const setSettings = useSettings((s) => s.set);
  const on = profile.trackHydration === true;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const recommended = hydrationGoalMl(profile.sex);
  const goal = draft ?? everydayWaterGoalMl(profile);
  const chosen = draft !== null ? draft !== recommended : (profile.waterGoalMl ?? null) !== null;

  const turn = useSharedValue(0);
  useEffect(() => {
    turn.set(withTiming(open && on ? 1 : 0, { duration: 240, easing: Easing.bezier(0.2, 0, 0, 1) }));
  }, [open, on, turn]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 180}deg` }] }));

  const step = (delta: number) => {
    const next = Math.min(5000, Math.max(1000, goal + delta));
    if (next === goal) return haptics.warning();
    haptics.tap();
    setDraft(next);
    clearTimeout(timer.current);
    // The draft stays on screen: it is what was saved.
    timer.current = setTimeout(() => onGoal(next === recommended ? null : next), 700);
  };
  const reset = () => {
    haptics.tap();
    clearTimeout(timer.current);
    setDraft(recommended);
    onGoal(null);
  };

  return (
    <View>
      <Pressy haptic={on} onPress={() => on && setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open && on }}>
        <Row gap={Space.lg} style={{ paddingHorizontal: Space.xl, paddingVertical: Space.lg, minHeight: 60 }}>
          <View style={{ width: 24, alignItems: 'center' }}>
            <GlassWater size={20} color={colors.text} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="label" style={{ fontSize: 16 }}>
              {t('me.trackHydration')}
            </Txt>
            <Row gap={4}>
              <Txt variant="caption" tone="secondary" style={{ flexShrink: 1, fontVariant: ['tabular-nums'] }}>
                {on ? t('me.hydrationSummary', { goal: formatLiters(goal, locale), glass: glassMl }) : t('me.trackHydrationHint')}
              </Txt>
              {on ? (
                <Animated.View style={chevron}>
                  <ChevronDown size={14} color={colors.text3} />
                </Animated.View>
              ) : null}
            </Row>
          </View>
          {right}
        </Row>
      </Pressy>

      {open && on ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)} style={{ paddingLeft: 64, paddingRight: Space.xl, paddingBottom: Space.lg, gap: Space.lg }}>
          <View style={{ gap: Space.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ gap: 2, flex: 1 }}>
                <Txt variant="caption" tone="secondary">
                  {t('me.waterGoal')}
                </Txt>
                {chosen ? (
                  <Pressy onPress={reset} haptic={false} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
                    <Txt variant="caption" tone="accent">
                      {t('me.waterGoalChosen', { goal: formatLiters(recommended, locale) })}
                    </Txt>
                  </Pressy>
                ) : (
                  <Txt variant="caption" tone="tertiary">
                    {t('me.waterGoalDefault')}
                  </Txt>
                )}
              </View>
              <Row gap={Space.sm}>
                <IconButton label={t('me.waterLess')} size={36} icon={<Minus size={16} color={colors.text} />} onPress={() => step(-100)} />
                <Txt variant="label" style={{ minWidth: 52, textAlign: 'center', fontSize: 16, fontVariant: ['tabular-nums'] }}>
                  {formatLiters(goal, locale)}
                </Txt>
                <IconButton label={t('me.waterMore')} size={36} icon={<Plus size={16} color={colors.text} />} onPress={() => step(100)} />
              </Row>
            </Row>
          </View>
          <View style={{ gap: Space.sm }}>
            <Txt variant="caption" tone="secondary">
              {t('me.glass')}
            </Txt>
            <Row gap={Space.sm}>
              {WATER_SIZES.map((ml) => {
                const selected = ml === glassMl;
                return (
                  <Pressy
                    key={ml}
                    onPress={() => setSettings({ glassMl: ml })}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={{ flex: 1, height: 34, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? LIFE_COLORS.water : colors.surface2 }}>
                    <Txt variant="label" color={selected ? '#FFFFFF' : colors.text} style={{ fontSize: 13, fontVariant: ['tabular-nums'] }}>
                      {ml} ml
                    </Txt>
                  </Pressy>
                );
              })}
            </Row>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function Item({
  icon,
  title,
  subtitle,
  right,
  onPress,
  chevron,
  danger,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  danger?: boolean;
}) {
  const { colors } = useTheme();
  const content = (
    <Row gap={Space.lg} style={{ paddingHorizontal: Space.xl, paddingVertical: Space.lg, minHeight: 60 }}>
      <View style={{ width: 24, alignItems: 'center' }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label" style={{ fontSize: 16 }} tone={danger ? 'danger' : 'primary'} numberOfLines={2}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="secondary">
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
      {chevron ? <ChevronRight size={18} color={colors.text3} /> : null}
    </Row>
  );
  return onPress ? <Pressy onPress={onPress}>{content}</Pressy> : content;
}

function CountBadge({ count, label }: { count: number; label: string }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={label} style={{ minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Txt variant="caption" color={colors.onAccent} style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
        {count}
      </Txt>
    </View>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 64 }} />;
}
