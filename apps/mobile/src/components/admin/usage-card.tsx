import { MEAL_SOURCES, type AdminOverview, type MealSource } from '@symbiose/shared';
import { View } from 'react-native';

import { CardTitle, Rule, Stats } from '@/components/admin/parts';
import { DayBars } from '@/components/insights/charts';
import { AnimatedNumber, Card, Dot, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatNumber, weekdayInitial } from '@/lib/format';
import { LIFE_COLORS, NUTRIENT_COLORS, Radius, Space, useTheme, type Palette } from '@/theme';

const SOURCE_LABELS: Record<MealSource, TranslationKey> = {
  photo: 'admin.source.photo',
  text: 'admin.source.text',
  barcode: 'admin.source.barcode',
  library: 'admin.source.library',
  manual: 'admin.source.manual',
  relog: 'admin.source.relog',
};

const sourceColor = (source: MealSource, colors: Palette): string =>
  ({ photo: colors.accent, text: NUTRIENT_COLORS.fat, barcode: NUTRIENT_COLORS.carbs, library: NUTRIENT_COLORS.sodium, manual: colors.text3, relog: NUTRIENT_COLORS.protein })[source];

/** How the server is used: accounts and who is active, then what gets logged, as counts. */
export function UsageCard({ people, usage }: { people: AdminOverview['people']; usage: AdminOverview['usage'] }) {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const n = (value: number) => formatNumber(value, locale);
  const sources = MEAL_SOURCES.filter((source) => usage.mealSources[source] > 0);
  const average = usage.meals / usage.daily.length;

  return (
    <Card style={{ gap: Space.lg }}>
      <View style={{ gap: 2 }}>
        <CardTitle color={LIFE_COLORS.water} label={t('admin.usage')} right={people.new.month ? t('admin.newAccounts', { week: n(people.new.week), month: n(people.new.month) }) : null} />
        <Row gap={Space.sm} style={{ alignItems: 'baseline' }}>
          <AnimatedNumber value={people.accounts} format={(v) => n(Math.round(v))} style={{ fontSize: 40 }} />
          <Txt tone="secondary">{plural('admin.accounts', people.accounts)}</Txt>
        </Row>
      </View>
      <Stats
        items={[
          { label: t('admin.active24h'), value: n(people.active.day) },
          { label: t('admin.active7d'), value: n(people.active.week) },
          { label: t('admin.active30d'), value: n(people.active.month) },
        ]}
      />

      <Rule />

      <View style={{ gap: Space.md }}>
        <Row gap={Space.sm} style={{ alignItems: 'baseline' }}>
          <Txt variant="number">{n(usage.meals)}</Txt>
          <Txt tone="secondary">{plural('admin.meals', usage.meals)}</Txt>
        </Row>
        {usage.meals ? (
          <>
            <DayBars values={usage.daily.map((day) => day.meals || null)} labels={usage.daily.map((day) => weekdayInitial(day.date, locale))} target={average} kind="target" color={LIFE_COLORS.water} />
            {/* How meals get in: one bar split by source, then the legend. */}
            <Row gap={2} style={{ height: 8, borderRadius: Radius.pill, overflow: 'hidden' }}>
              {sources.map((source) => (
                <View key={source} style={{ flex: usage.mealSources[source], height: '100%', backgroundColor: sourceColor(source, colors) }} />
              ))}
            </Row>
            <Row gap={Space.md} style={{ flexWrap: 'wrap', rowGap: 6 }}>
              {sources.map((source) => (
                <Row key={source} gap={6}>
                  <Dot color={sourceColor(source, colors)} size={7} />
                  <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                    {t(SOURCE_LABELS[source])} {n(usage.mealSources[source])}
                  </Txt>
                </Row>
              ))}
            </Row>
          </>
        ) : null}
      </View>

      <Rule />

      <Stats
        items={[
          { label: t('admin.cravings'), value: n(usage.cravings) },
          { label: t('admin.notes'), value: n(usage.notes) },
          { label: t('admin.coachMessages'), value: n(usage.coachMessages) },
        ]}
      />
    </Card>
  );
}
