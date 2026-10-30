import type { Locale, TransitSummary } from '@symbiose/shared';
import { Plus } from 'lucide-react-native';
import { View } from 'react-native';

import { AnimatedNumber, Card, IconButton, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { weekdayInitial } from '@/lib/format';
import { Radius, Space, useTheme } from '@/theme';

import { KIND_META, KindBubble } from './meta';

const CELL = 34;
const MAX_DOTS = 3;

/** « 1,0 », « 0,4 »: always one decimal, so the number doesn't jump around. */
const oneDecimal = (n: number, locale: Locale) => (Math.round(n * 10) / 10).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** « 1,2 / jour sur 14 jours » and the 14 days as small columns of dots, one per transit. */
export function TransitCard({ summary, onAdd }: { summary: TransitSummary; onAdd: () => void }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const color = KIND_META.transit.color(colors);
  const last =
    summary.daysSinceLast === null
      ? null
      : summary.daysSinceLast === 0
        ? t('journal.transit.lastToday')
        : summary.daysSinceLast === 1
          ? t('journal.transit.lastYesterday')
          : t('journal.transit.lastDays', { count: summary.daysSinceLast });

  return (
    <Card style={{ gap: Space.lg }}>
      <Row gap={Space.md}>
        <KindBubble entry={{ kind: 'transit', data: {} }} radius={Radius.xl - Space.xl} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="overline" tone="secondary">
            {t('journal.kind.transit')}
          </Txt>
          <Row gap={5} style={{ alignItems: 'baseline' }}>
            <AnimatedNumber value={summary.perDay} format={(n) => oneDecimal(n, locale)} variant="number" />
            <Txt variant="caption" tone="secondary">
              {t('journal.transit.perDay')}
            </Txt>
          </Row>
          <Txt variant="caption" tone="secondary">
            {t(summary.days === 1 ? 'journal.transit.days.one' : 'journal.transit.days.other', { count: summary.days })}
            {last ? ` · ${last}` : ''}
          </Txt>
        </View>
        <IconButton label={t('journal.transit.add')} size={40} icon={<Plus size={20} color={colors.text} />} onPress={onAdd} />
      </Row>

      <View style={{ gap: 6 }}>
        <Row gap={4}>
          {summary.counts.map(({ date, count }) => (
            <View
              key={date}
              accessible
              accessibilityLabel={`${date}: ${count ?? '–'}`}
              style={{
                flex: 1,
                height: CELL,
                borderRadius: 8,
                borderCurve: 'continuous',
                backgroundColor: count === null ? 'transparent' : colors.surface2,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
              }}>
              {count === null ? (
                <View style={{ width: 6, height: 1.5, borderRadius: 1, backgroundColor: colors.text3 }} />
              ) : (
                Array.from({ length: Math.min(count, MAX_DOTS) }, (_, i) => <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />)
              )}
            </View>
          ))}
        </Row>
        <Row gap={4}>
          {summary.counts.map(({ date }) => (
            <Txt
              key={date}
              variant="caption"
              tone={date === summary.to ? 'primary' : 'tertiary'}
              style={{ flex: 1, textAlign: 'center', fontSize: 10, fontWeight: date === summary.to ? '700' : '400' }}>
              {weekdayInitial(date, locale)}
            </Txt>
          ))}
        </Row>
      </View>
    </Card>
  );
}
