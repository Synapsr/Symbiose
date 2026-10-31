import { clockMinutes, formatClock, type ProactiveSchedule, type ProactiveSettingsPatch } from '@symbiose/shared';
import { BellOff, BellRing, CalendarCheck, Candy, Minus, Moon, Plus, Sparkle, Sun } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { AppState, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Card, Pressy, Row, Segmented, Skeleton, Toggle, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatClockTime } from '@/lib/format';
import { notificationPermission, notificationsSupported, openNotificationSettings, type NotificationPermission } from '@/lib/notify';
import { useProactive, useSaveProactive } from '@/lib/proactive';
import { Radius, Space, useTheme } from '@/theme';

/** Whether the phone lets Symbiose notify, re-read when the app comes back (from the system prompt or Settings). */
function usePermission(): NotificationPermission | null {
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  useEffect(() => {
    const read = () => void notificationPermission().then(setPermission).catch(() => setPermission(null));
    read();
    const sub = AppState.addEventListener('change', (state) => state === 'active' && read());
    return () => sub.remove();
  }, []);
  return permission;
}

/**
 * Me → Coach: the proactive coach's few settings, in one card. Off until
 * switched on; inside, the three kinds of messages, their times in plain
 * words, one notification a day by default and quiet hours.
 */
export function CoachSettings() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const schedule = useProactive();
  const save = useSaveProactive();
  const permission = usePermission();
  const [timeOpen, setTimeOpen] = useState(false);
  const [quietOpen, setQuietOpen] = useState(false);
  const [example, setExample] = useState(false);

  const data = schedule.data;
  if (!data) {
    // An older server has no proactive coach: nothing to set.
    return schedule.isPending ? <Skeleton width="100%" height={84} radius={Radius.xl} /> : null;
  }
  const s = data.settings;
  const set = (patch: ProactiveSettingsPatch) => save.mutate(patch);
  const clock = (time: string) => formatClockTime(time, locale);
  const shift = (time: string, minutes: number) => formatClock(clockMinutes(time) + minutes);

  return (
    <>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <SettingRow
          icon={<Sparkle size={20} color={colors.accent} fill={colors.accent} />}
          title={t('proactive.title')}
          subtitle={s.enabled ? t(s.maxPerDay > 1 ? 'proactive.onHint.other' : 'proactive.onHint.one', { count: s.maxPerDay }) : t('proactive.offHint')}
          right={<Toggle value={s.enabled} onValueChange={(enabled) => set({ enabled })} />}
        />
        {s.enabled && notificationsSupported && permission === 'denied' ? (
          <SettingRow
            icon={<BellOff size={20} color={colors.warning} />}
            title={t('proactive.denied')}
            right={
              <Pressy onPress={openNotificationSettings} accessibilityRole="button" style={{ paddingHorizontal: Space.md, height: 34, justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: colors.surface2 }}>
                <Txt variant="label">{t('proactive.openSettings')}</Txt>
              </Pressy>
            }
          />
        ) : null}

        {s.enabled ? (
          <Animated.View entering={FadeIn.duration(240)} exiting={FadeOut.duration(160)}>
            <Divider />
            {/* Tapping the row sets the time by hand; the switch stays apart. */}
            <Row>
              <Pressy onPress={() => s.morning && setTimeOpen((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: timeOpen }} style={{ flex: 1 }}>
                <SettingRow icon={<Sun size={20} color={colors.text} />} title={t('proactive.morning')} subtitle={morningSubtitle(data, t, clock)} />
              </Pressy>
              <View style={{ paddingRight: Space.xl }}>
                <Toggle value={s.morning} onValueChange={(morning) => set({ morning })} />
              </View>
            </Row>
            {s.morning && timeOpen ? (
              <Stepper
                value={clock(data.morning.weekday)}
                onLess={() => set({ morningTime: shift(s.morningTime ?? data.morning.weekday, -15) })}
                onMore={() => set({ morningTime: shift(s.morningTime ?? data.morning.weekday, 15) })}
                lessLabel={t('proactive.earlier')}
                moreLabel={t('proactive.later')}
                extra={s.morningTime ? { label: t('proactive.auto'), onPress: () => set({ morningTime: null }) } : null}
              />
            ) : null}
            <Divider />
            <SettingRow
              icon={<Candy size={20} color={colors.text} />}
              title={t('proactive.cravings')}
              subtitle={data.cravings ? t('proactive.cravingsAt', { time: clock(data.cravings.notifyAt) }) : t('proactive.cravingsPending')}
              right={<Toggle value={s.cravings} onValueChange={(cravings) => set({ cravings })} />}
            />
            <Divider />
            <SettingRow icon={<CalendarCheck size={20} color={colors.text} />} title={t('proactive.weekly')} subtitle={t('proactive.weeklyHint')} right={<Toggle value={s.weekly} onValueChange={(weekly) => set({ weekly })} />} />
            <Divider />
            <SettingRow
              icon={<BellRing size={20} color={colors.text} />}
              title={t('proactive.perDay')}
              subtitle={t('proactive.perDayHint')}
              right={
                <Segmented
                  value={String(s.maxPerDay) as '1' | '2'}
                  onChange={(v) => set({ maxPerDay: Number(v) })}
                  options={[
                    { value: '1', label: '1' },
                    { value: '2', label: '2' },
                  ]}
                />
              }
            />
            <Divider />
            <Pressy onPress={() => setQuietOpen((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: quietOpen }}>
              <SettingRow
                icon={<Moon size={20} color={colors.text} />}
                title={t('proactive.quiet')}
                right={
                  <Txt tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                    {clock(s.quietStart)} – {clock(s.quietEnd)}
                  </Txt>
                }
              />
            </Pressy>
            {quietOpen ? (
              <Animated.View entering={FadeIn.duration(200)}>
                <Stepper label={t('proactive.quietStart')} value={clock(s.quietStart)} onLess={() => set({ quietStart: shift(s.quietStart, -60) })} onMore={() => set({ quietStart: shift(s.quietStart, 60) })} />
                <Stepper label={t('proactive.quietEnd')} value={clock(s.quietEnd)} onLess={() => set({ quietEnd: shift(s.quietEnd, -60) })} onMore={() => set({ quietEnd: shift(s.quietEnd, 60) })} />
              </Animated.View>
            ) : null}
          </Animated.View>
        ) : null}
      </Card>

      <Pressy onPress={() => setExample((open) => !open)} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingHorizontal: 4, paddingVertical: Space.md }}>
        <Txt variant="label" tone="accent">
          {example ? t('proactive.exampleHide') : t('proactive.example')}
        </Txt>
      </Pressy>
      {example ? <Example /> : null}
      <Txt variant="caption" tone="tertiary" style={{ paddingHorizontal: 4 }}>
        {t('proactive.footer')}
      </Txt>
    </>
  );
}

function morningSubtitle(data: ProactiveSchedule, t: ReturnType<typeof useI18n>['t'], clock: (time: string) => string): string {
  const { morning } = data;
  if (morning.source === 'manual') return t('proactive.morningManual', { time: clock(morning.weekday) });
  if (morning.source === 'default') return t('proactive.morningDefault', { time: clock(morning.weekday) });
  const weekday = t('proactive.morningWake', { time: clock(morning.weekday) });
  return morning.weekend === morning.weekday ? weekday : `${weekday} · ${t('proactive.morningWeekend', { time: clock(morning.weekend) })}`;
}

function SettingRow({ icon, title, subtitle, right }: { icon: ReactNode; title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <Row gap={Space.lg} style={{ paddingHorizontal: Space.xl, paddingVertical: Space.lg, minHeight: 60 }}>
      <View style={{ width: 24, alignItems: 'center' }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label" style={{ fontSize: 16 }}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="secondary">
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
    </Row>
  );
}

/** − value +, under the row it adjusts. */
function Stepper({
  label,
  value,
  onLess,
  onMore,
  lessLabel = '−',
  moreLabel = '+',
  extra,
}: {
  label?: string;
  value: string;
  onLess: () => void;
  onMore: () => void;
  lessLabel?: string;
  moreLabel?: string;
  extra?: { label: string; onPress: () => void } | null;
}) {
  const { colors } = useTheme();
  const round = { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <Row gap={Space.md} style={{ paddingLeft: 64, paddingRight: Space.xl, paddingBottom: Space.md }}>
      {label ? (
        <Txt variant="caption" tone="secondary" style={{ width: 44 }}>
          {label}
        </Txt>
      ) : null}
      <Pressy onPress={onLess} accessibilityRole="button" accessibilityLabel={lessLabel} style={round}>
        <Minus size={16} color={colors.text} />
      </Pressy>
      <Txt variant="label" style={{ minWidth: 64, textAlign: 'center', fontSize: 16, fontVariant: ['tabular-nums'] }}>
        {value}
      </Txt>
      <Pressy onPress={onMore} accessibilityRole="button" accessibilityLabel={moreLabel} style={round}>
        <Plus size={16} color={colors.text} />
      </Pressy>
      {extra ? (
        <Pressy onPress={extra.onPress} accessibilityRole="button" style={{ height: 34, paddingHorizontal: Space.md, borderRadius: Radius.pill, justifyContent: 'center' }}>
          <Txt variant="label" tone="accent">
            {extra.label}
          </Txt>
        </Pressy>
      ) : null}
    </Row>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 64 }} />;
}

/** What it looks like: the morning notification, the coach line it becomes, and the heads-up with its buttons. */
function Example() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const lines = t('proactive.exampleMorning').split('\n');
  // The line shows the tip; the notification, the first line.
  return (
    <Animated.View entering={FadeIn.duration(220)} style={{ gap: Space.md, marginBottom: Space.md }}>
      <NotificationMock title={t('proactive.notif.morningReadyTitle')} body={lines[0]!} />
      <Row gap={Space.sm} style={{ alignItems: 'flex-start', paddingHorizontal: Space.sm }}>
        <View style={{ paddingTop: 5 }}>
          <Sparkle size={15} color={colors.accentText} fill={colors.accentText} />
        </View>
        <Txt variant="accent" style={{ flex: 1, fontSize: 19, lineHeight: 26 }}>
          {lines.at(-1)}
        </Txt>
      </Row>
      <NotificationMock title={t('proactive.notif.cravingsTitle')} body={t('proactive.exampleNudge')} actions={[t('proactive.notif.cravingAction'), t('proactive.notif.fineAction')]} />
    </Animated.View>
  );
}

/** A lock-screen notification, drawn: what the person will see, before turning anything on. */
function NotificationMock({ title, body, actions }: { title: string; body: string; actions?: string[] }) {
  const { t } = useI18n();
  const { colors, elevation } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <View style={[{ backgroundColor: colors.surface, borderRadius: Radius.lg, borderCurve: 'continuous', padding: Space.md, flexDirection: 'row', gap: Space.md }, elevation]}>
        <Image source={require('@/assets/images/icon.png')} style={{ width: 34, height: 34, borderRadius: 8 }} />
        <View style={{ flex: 1, gap: 1 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
              {title}
            </Txt>
            <Txt variant="caption" tone="tertiary">
              {t('proactive.now')}
            </Txt>
          </Row>
          <Txt variant="caption" style={{ fontSize: 14, lineHeight: 19 }}>
            {body}
          </Txt>
        </View>
      </View>
      {actions ? (
        <View style={[{ backgroundColor: colors.surface, borderRadius: Radius.lg, borderCurve: 'continuous', overflow: 'hidden' }, elevation]}>
          {actions.map((action, i) => (
            <View key={action} style={{ paddingHorizontal: Space.lg, paddingVertical: Space.md, borderTopWidth: i ? 1 : 0, borderColor: colors.border }}>
              <Txt variant="label" style={{ fontSize: 15 }}>
                {action}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
