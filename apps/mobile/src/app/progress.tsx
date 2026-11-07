import { MAX_REST_DAYS, type FamilyProgress, type Milestone, type ProgressSummary } from '@symbiose/shared';
import { router } from 'expo-router';
import { Bell, ChevronRight, Flame, Shield, X } from 'lucide-react-native';
import { Fragment } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DayDot } from '@/components/progress/day-dot';
import { familyColor, FamilyIcon } from '@/components/progress/family';
import { Bar, Card, IconButton, Pressy, Reveal, Row, SectionTitle, Skeleton, Toggle, Txt } from '@/components/ui';
import { useI18n, type PluralKey, type TranslationKey } from '@/i18n';
import { weekdayInitial } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { dismiss } from '@/lib/nav';
import { askNotificationPermission, notificationsSupported } from '@/lib/notify';
import { useProgress } from '@/lib/progress';
import { familyRatio } from '@/lib/progress-logic';
import { useSettings, useToast } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

/**
 * « Ta progression », opened from the flame on Today: the streak and its
 * week, the rest days in reserve, the next milestones, the ones reached
 * (each one shareable again), and the evening reminder. Read-only but for
 * the reminder: everything here is earned by logging, never set by hand.
 */
export default function Progress() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const query = useProgress();
  const data = query.data;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Space.lg, paddingTop: Space.xl, paddingBottom: insets.bottom + Space.xxxl, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: Space.lg }}>
        <Txt variant="title">{t('progress.title')}</Txt>
        <IconButton label={t('common.close')} icon={<X size={20} color={colors.text} />} onPress={dismiss} />
      </Row>

      {data ? (
        <Body data={data} />
      ) : query.error ? (
        <Card>
          <Txt tone="secondary">{t('progress.unavailable')}</Txt>
        </Card>
      ) : (
        <View style={{ gap: Space.lg }}>
          <Skeleton width="100%" height={260} radius={Radius.xl} />
          <Skeleton width="100%" height={120} radius={Radius.xl} />
        </View>
      )}
    </ScrollView>
  );
}

function Body({ data }: { data: ProgressSummary }) {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const { streak } = data;

  return (
    <>
      <Reveal index={0}>
        <StreakCard data={data} />
      </Reveal>

      <Reveal index={1} style={{ marginTop: Space.lg }}>
        <Card style={{ flexDirection: 'row', gap: Space.lg, alignItems: 'flex-start' }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={20} color={colors.accentText} fill={streak.restDays ? colors.accentText : 'transparent'} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="label" style={{ fontSize: 16 }}>
              {streak.restDays ? plural('progress.rest', streak.restDays) : t('progress.restNone')}
            </Txt>
            <Txt variant="caption" tone="secondary">
              {t('progress.restBody')}
            </Txt>
            <Txt variant="caption" tone="accent" style={{ fontWeight: '600' }}>
              {streak.restDays >= MAX_REST_DAYS ? t('progress.restFull') : plural('progress.restNext', streak.nextRestIn)}
            </Txt>
          </View>
        </Card>
      </Reveal>

      <Reveal index={2}>
        <SectionTitle>{t('progress.next')}</SectionTitle>
        <Card style={{ gap: Space.xl }}>
          {data.families.map((family) => (
            <FamilyRow key={family.family} family={family} />
          ))}
        </Card>
      </Reveal>

      <Reveal index={3}>
        <SectionTitle>{t('progress.reached')}</SectionTitle>
        {data.reached.length ? (
          <Card padded={false}>
            {data.reached.map((milestone, i) => (
              <Fragment key={milestone.id}>
                {i ? <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 64 }} /> : null}
                <ReachedRow milestone={milestone} locale={locale} />
              </Fragment>
            ))}
          </Card>
        ) : (
          <Card>
            <Txt tone="secondary">{t('progress.none')}</Txt>
          </Card>
        )}
      </Reveal>

      {notificationsSupported ? (
        <Reveal index={4} style={{ marginTop: Space.xxl }}>
          <ReminderRow />
        </Reveal>
      ) : null}

      <Txt variant="caption" tone="tertiary" style={{ textAlign: 'center', marginTop: Space.xxl, paddingHorizontal: Space.lg }}>
        {t('progress.footer')}
      </Txt>
    </>
  );
}

/** The flame and its number, the record, the week in seven dots, and what today needs. */
function StreakCard({ data }: { data: ProgressSummary }) {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const { streak } = data;
  const lit = streak.todayLogged;
  const status = streak.current === 0 ? t('progress.start') : lit ? t('progress.todayDone') : t('progress.todayOpen');
  const record = streak.best > 0 && streak.current === streak.best ? t('progress.bestNow') : streak.best > 0 ? plural('progress.best', streak.best) : null;

  return (
    <Card style={{ alignItems: 'center', gap: Space.md, paddingVertical: Space.xxl }}>
      <Row gap={Space.sm} style={{ alignItems: 'center' }}>
        <Flame size={40} color={colors.warning} fill={lit ? colors.warning : 'transparent'} />
        <Txt variant="display" style={{ fontSize: 64, lineHeight: 72 }}>
          {streak.current}
        </Txt>
      </Row>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Txt variant="label" style={{ fontSize: 17 }}>
          {plural('progress.unit.streak', streak.current)}
        </Txt>
        {record ? (
          <Txt variant="caption" tone="secondary">
            {record}
          </Txt>
        ) : null}
      </View>

      <Row style={{ justifyContent: 'space-between', alignSelf: 'stretch', marginTop: Space.sm, paddingHorizontal: Space.xs }}>
        {streak.week.map((day) => (
          <View key={day.date} style={{ alignItems: 'center', gap: 6 }} accessible accessibilityLabel={`${weekdayInitial(day.date, locale)} : ${t(`progress.day.${day.state}` as TranslationKey)}`}>
            <Txt variant="caption" tone="tertiary" style={{ fontWeight: '600' }}>
              {weekdayInitial(day.date, locale)}
            </Txt>
            <DayDot state={day.state} />
          </View>
        ))}
      </Row>

      <Txt tone="secondary" style={{ textAlign: 'center', marginTop: Space.xs }}>
        {status}
      </Txt>
    </Card>
  );
}

/** A family on its way to its next step: where it stands, the bar, and what is left. */
function FamilyRow({ family }: { family: FamilyProgress }) {
  const { t, plural } = useI18n();
  const { colors } = useTheme();
  const color = familyColor(family.family, colors);
  const left = family.next === null ? t('progress.allDone') : plural(`progress.left.${family.family}` as PluralKey, family.next - family.count);
  return (
    <View style={{ gap: Space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={Space.sm}>
          <FamilyIcon family={family.family} color={color} />
          <Txt variant="label" style={{ fontSize: 15 }}>
            {t(`progress.family.${family.family}`)}
          </Txt>
        </Row>
        <Txt variant="label" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
          {family.next === null ? family.count : `${family.count} / ${family.next}`}
        </Txt>
      </Row>
      <Bar progress={familyRatio(family)} color={color} />
      <Txt variant="caption" tone="secondary">
        {left}
      </Txt>
    </View>
  );
}

/** A milestone reached: a tap shows its card again, to share it. */
function ReachedRow({ milestone, locale }: { milestone: Milestone; locale: string }) {
  const { t, plural } = useI18n();
  const { colors } = useTheme();
  const color = familyColor(milestone.family, colors);
  const date = new Date(`${milestone.reachedAt}T12:00:00`).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <Pressy
      onPress={() => router.push({ pathname: '/milestone', params: { id: milestone.id } })}
      accessibilityRole="button"
      style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.lg, paddingVertical: Space.md }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <FamilyIcon family={milestone.family} color={color} filled />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label" style={{ fontSize: 15 }}>
          {plural(`milestone.title.${milestone.family}` as PluralKey, milestone.value)}
        </Txt>
        <Txt variant="caption" tone="secondary">
          {t('milestone.reachedOn', { date })}
        </Txt>
      </View>
      <ChevronRight size={18} color={colors.text3} />
    </Pressy>
  );
}

/** « Rappel du soir »: asks for notifications when switched on, in context. */
function ReminderRow() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const on = useSettings((s) => s.streakReminder);
  const set = useSettings((s) => s.set);
  const showToast = useToast((s) => s.show);
  const toggle = async (value: boolean) => {
    haptics.soft();
    if (!value) return set({ streakReminder: false });
    const granted = await askNotificationPermission().catch(() => false);
    if (granted) set({ streakReminder: true });
    else showToast({ message: t('progress.reminderDenied') });
  };
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Space.lg }}>
      <Bell size={20} color={colors.text} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label" style={{ fontSize: 16 }}>
          {t('progress.reminder')}
        </Txt>
        <Txt variant="caption" tone="secondary">
          {t('progress.reminderHint')}
        </Txt>
      </View>
      <Toggle value={on} onValueChange={(value) => void toggle(value)} />
    </Card>
  );
}
