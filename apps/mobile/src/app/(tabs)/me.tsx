import { ageFromBirthYear, type Profile } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ChevronRight, CodeXml, Download, EyeOff, FaceSlightlySmiling, GlassWater, Hand, HeartPulse, LogOut, Moon, Server, Target, Trash2, User, Watch } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Platform, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JournalLink } from '@/components/journal/journal-link';
import { CoachSettings } from '@/components/settings/coach-settings';
import { Card, Dot, Pressy, Row, SectionTitle, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmount } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { grantedScopes, health, HEALTH_SCOPES, healthModules, type HealthModules } from '@/lib/health';
import { useHealthSync, useToday } from '@/lib/hooks';
import { clearOutbox, useOutbox } from '@/lib/outbox';
import { useApi, useSession, useSetUser, useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { NUTRIENT_COLORS, Radius, Space, useTheme } from '@/theme';

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

export default function Me() {
  const { t, locale, nutrient } = useI18n();
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

  // Opt-in: saved on the profile (the server and the coach use it). With the new profile, the health sync
  // asks the store for the module's types once (see `grantedScopes`), then imports its history.
  const toggleModule = useMutation({
    mutationFn: ({ key, on }: { key: ModuleKey; on: boolean }) => api.saveProfile({ ...profile, [key]: on } satisfies Profile),
    onSuccess: (saved, { key, on }) => {
      const module = HEALTH_MODULE[key];
      if (on && module) settings.set(RESYNC[module]);
      if (on) haptics.success();
      setUser(saved);
      void queryClient.invalidateQueries({ queryKey: ['day'] });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
    },
    onError: () => haptics.warning(),
  });
  const moduleSwitch = (key: ModuleKey) => {
    const pending = toggleModule.isPending && toggleModule.variables.key === key;
    return <Switch value={pending ? toggleModule.variables.on : profile[key] === true} disabled={toggleModule.isPending} onValueChange={(on) => toggleModule.mutate({ key, on })} />;
  };
  const store = healthAvailable ? health.storeName[locale] : null;

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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.md, paddingHorizontal: Space.lg, paddingBottom: insets.bottom + 120, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      <Row gap={Space.lg} style={{ paddingHorizontal: 4 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.inverted, alignItems: 'center', justifyContent: 'center' }}>
          <Txt variant="title" color={colors.onInverted} style={{ fontSize: 26 }}>
            {(profile.name || user.email).slice(0, 1).toUpperCase()}
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="title" style={{ fontSize: 26 }}>
            {profile.name || user.email}
          </Txt>
          <Txt tone="secondary">
            {t('me.age', { age: ageFromBirthYear(profile.birthYear) })} · {profile.heightCm} cm · {profile.weightKg} kg
          </Txt>
        </View>
      </Row>

      <SectionTitle>{t('me.goals')}</SectionTitle>
      <Pressy onPress={() => router.push('/goals')}>
        <Card style={{ gap: Space.md, marginTop: -Space.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="heading" style={{ flex: 1 }}>
              {plan.title}
            </Txt>
            <ChevronRight size={20} color={colors.text3} />
          </Row>
          <Txt tone="secondary" numberOfLines={3}>
            {plan.summary}
          </Txt>
          <Row gap={Space.sm} style={{ flexWrap: 'wrap' }}>
            {plan.rules.map((rule) => (
              <Row key={rule.nutrient} gap={6} style={{ backgroundColor: colors.surface2, borderRadius: Radius.pill, paddingHorizontal: 12, height: 30 }}>
                <Dot color={NUTRIENT_COLORS[rule.nutrient]} size={6} />
                <Txt variant="caption">
                  {nutrient(rule.nutrient)} {rule.kind === 'max' ? '≤' : '≥'} {formatAmount(rule.nutrient, rule.value, locale)}
                </Txt>
              </Row>
            ))}
          </Row>
        </Card>
      </Pressy>

      <JournalLink />

      <SectionTitle>{t('proactive.section')}</SectionTitle>
      <CoachSettings />

      <SectionTitle>{t('me.health')}</SectionTitle>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <Item
          icon={<Watch size={20} color={colors.accent} />}
          title={healthAvailable ? health.storeName[locale] : t('me.health')}
          subtitle={healthAvailable ? (settings.healthEnabled ? t('me.healthOn', { store: health.storeName[locale] }) : t('me.healthOff')) : t('me.healthUnavailable')}
          right={healthAvailable ? <Switch value={settings.healthEnabled} onValueChange={(v) => void toggleHealth(v)} /> : null}
        />
      </Card>

      {/* What Symbiose follows besides meals and movement: each module is off until switched on. */}
      <SectionTitle>{t('me.modules')}</SectionTitle>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <Item icon={<GlassWater size={20} color={colors.text} />} title={t('me.trackHydration')} subtitle={t('me.trackHydrationHint')} right={moduleSwitch('trackHydration')} />
        <Divider />
        <Item
          icon={<Moon size={20} color={colors.text} />}
          title={t('me.trackSleep')}
          subtitle={store ? t('me.trackSleepHint', { store }) : t('me.trackSleepHintNoStore')}
          right={moduleSwitch('trackSleep')}
        />
        <Divider />
        <Item icon={<FaceSlightlySmiling size={20} color={colors.text} />} title={t('me.trackMood')} subtitle={t('me.trackMoodHint')} right={moduleSwitch('trackMood')} />
        <Divider />
        <Item icon={<HeartPulse size={20} color={colors.text} />} title={t('me.trackBp')} subtitle={t('me.trackBpHint')} right={moduleSwitch('trackBloodPressure')} />
      </Card>

      <SectionTitle>{t('me.profile')}</SectionTitle>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <Item icon={<User size={20} color={colors.text} />} title={t('me.editProfile')} onPress={() => router.push('/profile')} chevron />
        <Divider />
        <Item icon={<Target size={20} color={colors.text} />} title={t('me.editGoals')} onPress={() => router.push('/goals')} chevron />
        <Divider />
        <Item
          icon={<EyeOff size={20} color={colors.text} />}
          title={t('me.hideCalories')}
          subtitle={t('me.hideCaloriesHint')}
          right={<Switch value={settings.hideCalories} onValueChange={(v) => settings.set({ hideCalories: v })} />}
        />
        <Divider />
        <Item
          icon={<Hand size={20} color={colors.text} style={{ transform: [{ scaleX: -1 }] }} />}
          title={t('me.leftHanded')}
          subtitle={t('me.leftHandedHint')}
          right={<Switch value={settings.leftHanded} onValueChange={(v) => settings.set({ leftHanded: v })} />}
        />
      </Card>

      <SectionTitle>{t('me.server')}</SectionTitle>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <Item icon={<Server size={20} color={colors.text} />} title={api.baseUrl.replace(/^https?:\/\//, '')} subtitle={user.email} />
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
        <Txt variant="label" style={{ fontSize: 16 }} tone={danger ? 'danger' : 'primary'} numberOfLines={1}>
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

function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 64 }} />;
}
