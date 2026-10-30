import { addDays, JOURNAL_KINDS, toLocalDate, transitSummary, type JournalEntry, type JournalKind } from '@symbiose/shared';
import { router } from 'expo-router';
import { Lock, NotebookPen, X } from 'lucide-react-native';
import { Fragment, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JournalItem } from '@/components/journal/journal-row';
import { KIND_META, kindLabel } from '@/components/journal/meta';
import { TransitCard } from '@/components/journal/transit-card';
import { Button, Card, Chip, IconButton, Pressy, Reveal, Row, Skeleton, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDay } from '@/lib/format';
import { errorMessage, useToday } from '@/lib/hooks';
import { useJournal } from '@/lib/journal';
import { dismiss } from '@/lib/nav';
import { useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { useHiddenIds } from '@/lib/undo';
import { Radius, Space, useTheme } from '@/theme';

/** Days loaded at a time; « Voir plus ancien » adds as many. */
const PAGE_DAYS = 90;

type Filter = JournalKind | 'all';

const newNote = (kind?: JournalKind) => router.push({ pathname: '/note', params: kind ? { kind } : {} });

/** The whole journal, by day: filter by kind, tap to edit, long-press to delete. */
export default function Journal() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useUser();
  const today = useToday();
  const leftHanded = useSettings((s) => s.leftHanded);
  const [filter, setFilter] = useState<Filter>('all');
  const [pages, setPages] = useState(1);

  const from = addDays(today, -(PAGE_DAYS * pages - 1));
  const journal = useJournal({ from, to: today }, { keepPrevious: true });
  // A note just deleted stays out while « Annuler » is on screen.
  const hidden = useHiddenIds();
  const all = (journal.data ?? []).filter((e) => !hidden[e.id]);
  const entries = filter === 'all' ? all : all.filter((e) => e.kind === filter);
  // The frequency card belongs to the Transit filter: the Carnet opens on the notes themselves.
  const transit = filter === 'transit' ? transitSummary(all, today) : null;
  // Nothing can be older than the account.
  const hasOlder = from > toLocalDate(new Date(user.createdAt));

  const days: { date: string; entries: JournalEntry[] }[] = [];
  for (const entry of entries) {
    const last = days.at(-1);
    if (last?.date === entry.localDate) last.entries.push(entry);
    else days.push({ date: entry.localDate, entries: [entry] });
  }
  const dayLabel = (date: string) => {
    const label = formatDay(date, locale, { today: t('common.today'), yesterday: t('common.yesterday') });
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  const fabBottom = insets.bottom + (Platform.OS === 'web' ? Space.xl : Space.lg);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.lg,
          paddingHorizontal: Space.lg,
          paddingBottom: fabBottom + 56 + Space.xxl,
          gap: Space.lg,
          maxWidth: 640,
          width: '100%',
          alignSelf: 'center',
        }}>
        <Reveal index={0} style={{ gap: 4, paddingHorizontal: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="title">{t('journal.title')}</Txt>
            <IconButton label={t('common.close')} icon={<X size={20} color={colors.text} />} onPress={() => dismiss()} />
          </Row>
          <Row gap={5}>
            <Lock size={12} color={colors.text3} />
            <Txt variant="caption" tone="tertiary">
              {t('journal.privacy')}
            </Txt>
          </Row>
        </Reveal>

        {all.length ? (
          <Reveal index={1}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -Space.lg }} contentContainerStyle={{ gap: 6, paddingHorizontal: Space.lg, paddingVertical: 4 }}>
              <Chip label={t('journal.all')} selected={filter === 'all'} onPress={() => setFilter('all')} />
              {JOURNAL_KINDS.map((kind) => {
                const Icon = KIND_META[kind].icon;
                const selected = filter === kind;
                return (
                  <Chip
                    key={kind}
                    label={t(kindLabel(kind))}
                    selected={selected}
                    onPress={() => setFilter(selected ? 'all' : kind)}
                    icon={<Icon size={15} color={selected ? colors.onInverted : KIND_META[kind].color(colors)} />}
                  />
                );
              })}
            </ScrollView>
          </Reveal>
        ) : null}

        {transit ? (
          <Reveal index={2}>
            <TransitCard summary={transit} onAdd={() => newNote('transit')} />
          </Reveal>
        ) : null}

        {journal.isPending ? (
          <View style={{ gap: Space.md }}>
            <Skeleton width="40%" height={14} />
            <Skeleton width="100%" height={140} radius={Radius.xl} />
          </View>
        ) : journal.error && !all.length ? (
          <Card>
            <Txt tone="warning">{errorMessage(journal.error, t('common.error'), t('common.offline'))}</Txt>
          </Card>
        ) : !all.length ? (
          <Reveal index={1}>
            <EmptyJournal />
          </Reveal>
        ) : !entries.length ? (
          <Animated.View entering={FadeIn.duration(200)} style={{ alignItems: 'center', gap: Space.md, paddingVertical: Space.xxl }}>
            <Txt tone="secondary">{t('journal.empty.kind')}</Txt>
            {filter !== 'all' && filter !== 'transit' ? <Button title={t('journal.note')} variant="secondary" size="md" onPress={() => newNote(filter)} /> : null}
          </Animated.View>
        ) : (
          days.map((day, i) => (
            <Reveal key={day.date} index={Math.min(i + 3, 8)} style={{ gap: Space.sm }}>
              <Txt variant="overline" tone="secondary" style={{ marginLeft: 4 }}>
                {dayLabel(day.date)}
              </Txt>
              <Card padded={false}>
                {day.entries.map((entry, j) => (
                  <Fragment key={entry.id}>
                    {j > 0 ? <View style={{ height: 1, backgroundColor: colors.border, marginLeft: Space.lg + 36 + Space.md }} /> : null}
                    <JournalItem entry={entry} />
                  </Fragment>
                ))}
              </Card>
            </Reveal>
          ))
        )}

        {all.length && hasOlder ? <Button title={t('journal.older')} variant="ghost" size="md" loading={journal.isPlaceholderData} onPress={() => setPages((p) => p + 1)} /> : null}
      </ScrollView>

      {/* On the thumb's side, like the camera button on Today. */}
      <Pressy
        accessibilityRole="button"
        accessibilityLabel={t('journal.note')}
        onPress={() => newNote(filter === 'all' ? undefined : filter)}
        style={{
          position: 'absolute',
          [leftHanded ? 'left' : 'right']: Space.xl,
          bottom: fabBottom,
          height: 56,
          paddingHorizontal: Space.xl,
          borderRadius: Radius.pill,
          backgroundColor: colors.inverted,
          flexDirection: 'row',
          alignItems: 'center',
          gap: Space.sm,
          boxShadow: '0 10px 28px rgba(0,0,0,0.25)',
        }}>
        <NotebookPen size={20} color={colors.onInverted} />
        <Txt variant="label" color={colors.onInverted} style={{ fontSize: 16 }}>
          {t('journal.note')}
        </Txt>
      </Pressy>
    </View>
  );
}

/** First visit: what the journal is for, in one line, and a way in for each kind. */
function EmptyJournal() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: Space.xxl, paddingHorizontal: Space.lg, gap: Space.md, borderRadius: Radius.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.text3 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: Space.xs }}>
        <NotebookPen size={24} color={colors.text} />
      </View>
      <Txt variant="heading">{t('journal.empty.title')}</Txt>
      <Txt tone="secondary" style={{ textAlign: 'center', maxWidth: 280 }}>
        {t('journal.empty.body')}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Space.sm, marginTop: Space.sm }}>
        {JOURNAL_KINDS.filter((kind) => kind !== 'other').map((kind) => {
          const Icon = KIND_META[kind].icon;
          return <Chip key={kind} label={t(kindLabel(kind))} onPress={() => newNote(kind)} icon={<Icon size={15} color={KIND_META[kind].color(colors)} />} />;
        })}
      </View>
    </View>
  );
}
