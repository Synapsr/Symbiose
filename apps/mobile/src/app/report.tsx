import type { ReportData } from '@symbiose/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ChartColumn,
  Check,
  Cookie,
  FaceSlightlySmiling,
  FileText,
  Footprints,
  GlassWater,
  HeartPulse,
  Lock,
  Moon,
  NotebookPen,
  Scale,
  Utensils,
  Wheat,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { Fragment, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, IconButton, Pressy, Reveal, Row, SectionTitle, Skeleton, Toggle, Txt } from '@/components/ui';
import { useI18n, type PluralKey, type TranslationKey } from '@/i18n';
import { ApiError } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { errorMessage, useToday } from '@/lib/hooks';
import { dismiss } from '@/lib/nav';
import { buildReport } from '@/lib/report/build';
import { exportReport } from '@/lib/report/export';
import { availableSections, chosenSections, PRIVATE_SECTIONS, REPORT_RANGES, reportPeriod, sectionCounts, toggleAll, toggleSection, type ReportRange, type ReportSection } from '@/lib/report/sections';
import { useApi } from '@/lib/session';
import { useSettings, useToast } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

const ICONS: Record<ReportSection, LucideIcon> = {
  nutrition: ChartColumn,
  carbs: Wheat,
  foods: Utensils,
  weight: Scale,
  bloodPressure: HeartPulse,
  activity: Footprints,
  sleep: Moon,
  hydration: GlassWater,
  mood: FaceSlightlySmiling,
  cravings: Cookie,
  notes: NotebookPen,
  meals: CalendarDays,
};

/** What each part counts, in words: « 26 jours notés », « 14 pesées »… */
const COUNT_KEYS: Record<ReportSection, PluralKey> = {
  nutrition: 'report.count.days',
  carbs: 'report.count.days',
  foods: 'report.count.meals',
  weight: 'report.count.weighIns',
  bloodPressure: 'report.count.readings',
  activity: 'report.count.sessions',
  sleep: 'report.count.nights',
  hydration: 'report.count.days',
  mood: 'report.count.checkIns',
  cravings: 'report.count.cravings',
  notes: 'report.count.notes',
  meals: 'report.count.meals',
};

/**
 * « Rapport PDF », from Tendances: a period, the parts to include (each with
 * what it holds, « Tout sélectionner »), calories as in the app unless
 * changed, and one button. The PDF is laid out and printed on the phone, then
 * handed to the share sheet; the choices are remembered for next time.
 */
export default function ReportScreen() {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const today = useToday();
  const hideCalories = useSettings((s) => s.hideCalories);
  const choice = useSettings((s) => s.report);
  const set = useSettings((s) => s.set);
  const showToast = useToast((s) => s.show);
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<number | null>(null);

  const days: ReportRange = REPORT_RANGES.includes(choice.days) ? choice.days : 30;
  const { from, to } = reportPeriod(days, today);
  const query = useQuery({
    queryKey: ['report', from, to],
    queryFn: () => api.report(from, to),
    // Another period keeps the list on screen while it loads.
    placeholderData: keepPreviousData,
    // An older server has no report: say so at once.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });
  const data = query.data;
  const counts = data ? sectionCounts(data) : null;
  const available = counts ? availableSections(counts) : [];
  const chosen = chosenSections(available, choice.excluded);
  const calories = choice.calories ?? !hideCalories;
  const tooOld = query.error instanceof ApiError && query.error.status === 404;

  const update = (patch: Partial<typeof choice>) => {
    setPages(null);
    set({ report: { ...choice, ...patch } });
  };

  const create = async () => {
    if (!data || busy) return;
    haptics.tap();
    setBusy(true);
    try {
      // A frame for the spinner before the pages are laid out.
      await new Promise((resolve) => setTimeout(resolve, 32));
      const report = buildReport(data, { sections: chosen, calories }, { locale, t, plural });
      await exportReport(report, t('report.shareTitle'));
      setPages(report.pages);
    } catch {
      showToast({ message: t('report.failed') });
    } finally {
      setBusy(false);
    }
  };

  const range = (value: ReportRange) => t(`report.range.${value}` as TranslationKey);
  const longDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const canCreate = Boolean(data && available.length);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: Space.lg, paddingTop: Space.xl, paddingBottom: Space.xxl, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <Txt variant="title">{t('report.title')}</Txt>
          <IconButton label={t('common.close')} icon={<X size={20} color={colors.text} />} onPress={dismiss} />
        </Row>
        <Txt tone="secondary" style={{ paddingHorizontal: 4, marginTop: Space.xs }}>
          {t('report.subtitle')}
        </Txt>

        <Reveal index={0}>
          <SectionTitle>{t('report.period')}</SectionTitle>
          <PeriodPicker value={days} options={REPORT_RANGES} label={range} onChange={(value) => update({ days: value })} />
          <Txt variant="caption" tone="secondary" style={{ marginTop: Space.sm, paddingHorizontal: 4, fontVariant: ['tabular-nums'] }}>
            {t('report.dates', { from: longDate(from), to: longDate(to) })}
          </Txt>
        </Reveal>

        <Reveal index={1}>
          <SectionTitle
            right={
              available.length ? (
                <Pressy onPress={() => update({ excluded: toggleAll(available, choice.excluded) })} accessibilityRole="button" hitSlop={10} style={{ paddingVertical: 6, paddingHorizontal: 4 }}>
                  <Txt variant="label" tone="accent">
                    {chosen.length === available.length ? t('report.none') : t('report.all')}
                  </Txt>
                </Pressy>
              ) : null
            }>
            {t('report.content')}
          </SectionTitle>
          {tooOld ? (
            <Card>
              <Txt tone="secondary">{t('report.unavailable')}</Txt>
            </Card>
          ) : !data ? (
            query.error ? (
              <Card style={{ gap: Space.md, alignItems: 'flex-start' }}>
                <Txt tone="secondary">{errorMessage(query.error, t('common.error'), t('common.offline'))}</Txt>
                <Button title={t('common.retry')} variant="secondary" size="md" onPress={() => void query.refetch()} />
              </Card>
            ) : (
              <Skeleton width="100%" height={420} radius={Radius.xl} />
            )
          ) : !available.length ? (
            <Card>
              <Txt tone="secondary">{t('report.empty')}</Txt>
            </Card>
          ) : (
            <Sections data={data} available={available} chosen={chosen} onToggle={(section) => update({ excluded: toggleSection(choice.excluded, section) })} dimmed={query.isPlaceholderData} />
          )}
        </Reveal>

        {data && counts && counts.nutrition > 0 ? (
          <Reveal index={2} style={{ marginTop: Space.lg }}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Space.lg }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="label" style={{ fontSize: 16 }}>
                  {t('report.calories')}
                </Txt>
                <Txt variant="caption" tone="secondary">
                  {hideCalories ? t('report.caloriesHidden') : t('report.caloriesOn')}
                </Txt>
              </View>
              <Toggle value={calories} onValueChange={(value) => update({ calories: value === !hideCalories ? null : value })} />
            </Card>
          </Reveal>
        ) : null}

        {tooOld ? null : (
          <Txt variant="caption" tone="tertiary" style={{ textAlign: 'center', marginTop: Space.xl, paddingHorizontal: Space.lg }}>
            {Platform.OS === 'web' ? t('report.noteWeb') : t('report.note')}
          </Txt>
        )}
      </ScrollView>

      {tooOld ? null : (
        <View style={{ paddingHorizontal: Space.lg, paddingTop: Space.md, paddingBottom: insets.bottom + Space.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg }}>
          <View style={{ maxWidth: 640 - 2 * Space.lg, width: '100%', alignSelf: 'center', gap: Space.sm }}>
            <Button title={busy ? t('report.creating') : t('report.create')} icon={<FileText size={20} color={colors.onInverted} />} loading={busy} disabled={!canCreate} onPress={() => void create()} />
            {pages ? (
              <Txt variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
                {plural('report.pages', pages)}
              </Txt>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

/** The periods, each an equal share of the width. */
function PeriodPicker<T extends number>({ value, options, label, onChange }: { value: T; options: readonly T[]; label: (value: T) => string; onChange: (value: T) => void }) {
  const { colors, elevation } = useTheme();
  return (
    <Row gap={2} style={{ backgroundColor: colors.surface2, borderRadius: Radius.pill, padding: 3 }}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressy
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[{ flex: 1, height: 38, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.surface : 'transparent' }, active ? elevation : null]}>
            <Txt variant="label" tone={active ? 'primary' : 'secondary'} numberOfLines={1}>
              {label(option)}
            </Txt>
          </Pressy>
        );
      })}
    </Row>
  );
}

/** The synthesis, always first, then each part the period can fill, with what it holds and its tick. */
function Sections({ data, available, chosen, onToggle, dimmed }: { data: ReportData; available: ReportSection[]; chosen: ReportSection[]; onToggle: (section: ReportSection) => void; dimmed: boolean }) {
  const { t, plural } = useI18n();
  const { colors } = useTheme();
  const counts = sectionCounts(data);
  const hint = (section: ReportSection) => {
    // Activity without sessions: the days with steps.
    const key = section === 'activity' && !data.workouts.length ? 'report.count.stepDays' : COUNT_KEYS[section];
    // The count never splits from its word.
    return `${t(`report.about.${section}` as TranslationKey)} · ${plural(key, counts[section]).replaceAll(' ', '\u00A0')}`;
  };
  return (
    <Card padded={false} style={{ paddingVertical: Space.xs, opacity: dimmed ? 0.6 : 1 }}>
      <SectionRow icon={FileText} title={t('report.summary')} hint={t('report.summaryHint')} />
      {available.map((section) => (
        <Fragment key={section}>
          <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 56 }} />
          <SectionRow
            icon={ICONS[section]}
            title={t(`report.section.${section}` as TranslationKey)}
            hint={hint(section)}
            locked={PRIVATE_SECTIONS.includes(section)}
            on={chosen.includes(section)}
            onPress={() => onToggle(section)}
          />
        </Fragment>
      ))}
    </Card>
  );
}

/** One part: its icon, name and contents, and a tick; the synthesis has no tick to change, it is always there. */
function SectionRow({ icon: Icon, title, hint, on = true, locked, onPress }: { icon: LucideIcon; title: string; hint: string; on?: boolean; locked?: boolean; onPress?: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const content = (
    <Row gap={Space.md} style={{ paddingHorizontal: Space.lg, paddingVertical: Space.md, minHeight: 60 }}>
      <View style={{ width: 28, alignItems: 'center' }}>
        <Icon size={20} color={on ? colors.text : colors.text3} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Row gap={6}>
          <Txt variant="label" style={{ fontSize: 15 }}>
            {title}
          </Txt>
          {locked ? <Lock size={13} color={colors.text3} /> : null}
        </Row>
        <Txt variant="caption" tone="secondary">
          {hint}
        </Txt>
      </View>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: on ? (onPress ? colors.accent : colors.surface2) : 'transparent',
          borderWidth: on ? 0 : 1.5,
          borderColor: colors.text3,
        }}>
        {on ? <Check size={15} strokeWidth={3} color={onPress ? colors.onAccent : colors.text3} /> : null}
      </View>
    </Row>
  );
  if (!onPress) return <View accessible accessibilityLabel={`${title}, ${hint}`}>{content}</View>;
  return (
    <Pressy onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${locked ? `${title}, ${t('report.private')}` : title}, ${hint}`}>
      {content}
    </Pressy>
  );
}
