import { ageFromBirthYear } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ChevronRight, CodeXml, Download, EyeOff, Hand, HeartPulse, LogOut, Server, Target, Trash2, User, Watch } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Platform, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JournalLink } from '@/components/journal/journal-link';
import { Card, Dot, Pressy, Row, SectionTitle, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmount } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { BP_SCOPES, health, HEALTH_SCOPES } from '@/lib/health';
import { useHealthSync, useToday } from '@/lib/hooks';
import { useApi, useSession, useSetUser, useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { NUTRIENT_COLORS, Radius, Space, useTheme } from '@/theme';

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
  const trackBp = profile.trackBloodPressure === true;

  const toggleHealth = async (on: boolean) => {
    if (on) {
      const granted = await health.connect({ bloodPressure: trackBp }).catch(() => false);
      settings.set(granted ? { healthEnabled: true, healthScopes: HEALTH_SCOPES, ...(trackBp ? { bpScopes: BP_SCOPES } : null) } : { healthEnabled: false });
      if (granted) {
        haptics.success();
        void syncHealth(true);
      }
    } else {
      settings.set({ healthEnabled: false });
    }
  };

  // Opt-in: saved on the profile (the server and the coach use it), then the health store is asked for the readings.
  const toggleBp = useMutation({
    mutationFn: (on: boolean) => api.saveProfile({ ...profile, trackBloodPressure: on }),
    onSuccess: async (saved, on) => {
      setUser(saved);
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      if (on && settings.healthEnabled && health.source) {
        const granted = await health.connect({ bloodPressure: true }).catch(() => false);
        if (granted) settings.set({ bpScopes: BP_SCOPES, lastBpSync: 0 });
      }
    },
    onError: () => haptics.warning(),
  });

  const confirmDelete = () => {
    const run = async () => {
      await api.deleteAccount();
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

      <SectionTitle>{t('me.health')}</SectionTitle>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <Item
          icon={<Watch size={20} color={colors.accent} />}
          title={healthAvailable ? health.storeName[locale] : t('me.health')}
          subtitle={healthAvailable ? (settings.healthEnabled ? t('me.healthOn', { store: health.storeName[locale] }) : t('me.healthOff')) : t('me.healthUnavailable')}
          right={healthAvailable ? <Switch value={settings.healthEnabled} onValueChange={(v) => void toggleHealth(v)} /> : null}
        />
        <Divider />
        <Item
          icon={<HeartPulse size={20} color={colors.text} />}
          title={t('me.trackBp')}
          subtitle={t('me.trackBpHint')}
          right={<Switch value={toggleBp.isPending ? toggleBp.variables : trackBp} disabled={toggleBp.isPending} onValueChange={(v) => toggleBp.mutate(v)} />}
        />
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
        <Item icon={<LogOut size={20} color={colors.text} />} title={t('me.signOut')} onPress={() => void signOut()} />
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
