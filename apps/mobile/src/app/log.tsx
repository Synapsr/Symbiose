import { toLocalDate, WATER_SIZES, type JournalKind } from '@symbiose/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, HeartPulse, PenLine, Scale, ScanBarcode, Sparkles, SportShoe, type LucideIcon } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BloodPressureForm } from '@/components/forms/blood-pressure-form';
import { WeightForm } from '@/components/forms/weight-form';
import { KIND_META, kindLabel } from '@/components/journal/meta';
import { MoodFaces, useMood } from '@/components/today/mood-row';
import { WaterSizeChip } from '@/components/today/status-row';
import { Glass, useWater } from '@/components/today/water';
import { Card, IconButton, Pressy, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatDay, formatLiters } from '@/lib/format';
import { useDay } from '@/lib/hooks';
import { dismiss } from '@/lib/nav';
import { useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

/** The owner asked for feelings first; transit comes further down. */
const NOTE_KINDS: JournalKind[] = ['feeling', 'symptom', 'medication', 'transit', 'other'];

type View_ = 'menu' | 'weight' | 'bp';

/**
 * « + »: the single home for every log that isn't a photo. One tap for a
 * glass or a mood, two for the rest. Tiles for modules that are off are not
 * there at all. Works the same for a past day (the date comes from Today).
 */
export default function LogSheet() {
  const params = useLocalSearchParams<{ date?: string }>();
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const today = toLocalDate();
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date <= today ? params.date : today;
  const [view, setView] = useState<View_>('menu');

  const dayLabel = formatDay(date, locale, { today: t('common.today'), yesterday: t('common.yesterday') });
  const title = view === 'weight' ? t('weight.title') : view === 'bp' ? t('bp.title') : t('log.title');

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: Space.xl, paddingTop: Space.xxl, paddingBottom: insets.bottom + Space.xxl, gap: Space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      <Row gap={Space.sm}>
        {view !== 'menu' ? <IconButton label={t('common.back')} size={36} icon={<ChevronLeft size={20} color={colors.text} />} onPress={() => setView('menu')} /> : null}
        <View style={{ flex: 1 }}>
          <Txt variant="title">{title}</Txt>
          {date !== today ? (
            <Txt variant="caption" tone="secondary">
              {dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)}
            </Txt>
          ) : null}
        </View>
      </Row>

      {view === 'menu' ? (
        <Menu date={date} isToday={date === today} onOpen={setView} />
      ) : (
        <Animated.View key={view} entering={FadeIn.duration(200)}>
          {view === 'weight' ? <WeightForm date={date} onDone={dismiss} /> : <BloodPressureForm date={date} onDone={dismiss} />}
        </Animated.View>
      )}
    </ScrollView>
  );
}

function Menu({ date, isToday, onOpen }: { date: string; isToday: boolean; onOpen: (view: View_) => void }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const user = useUser();
  const day = useDay(date).data;
  const glassMl = useSettings((s) => s.glassMl);
  const setSettings = useSettings((s) => s.set);
  const pour = useWater(date);
  const { pick } = useMood(date);

  const rules = user.plan?.rules ?? [];
  // Cravings are about the plan's limits; when sugar is one of them, the craving comes first.
  const craving = isToday && rules.some((r) => r.kind === 'max');
  const sugarFirst = craving && rules.some((r) => r.kind === 'max' && (r.nutrient === 'addedSugar' || r.nutrient === 'sugar'));
  // A past day loads its own summary: the quick row waits for it rather than guess.
  const hydration = day?.date === date ? (day.hydration ?? null) : null;
  const trackMood = user.profile?.trackMood === true;
  const trackBp = user.profile?.trackBloodPressure === true;
  const mood = day?.date === date ? (day.mood ?? null) : null;

  /** Opens the next sheet in place of this one. */
  const go = (pathname: '/capture' | '/craving' | '/workout' | '/note', params: Record<string, string> = {}) => router.replace({ pathname, params: { date, ...params } });

  const cravingTile = (
    <Pressy
      onPress={() => go('/craving')}
      accessibilityRole="button"
      style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg, borderRadius: Radius.lg, borderCurve: 'continuous', backgroundColor: colors.accentSoft }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Sparkles size={18} color={colors.onAccent} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="label" style={{ fontSize: 16 }}>
          {t('today.craving')}
        </Txt>
        <Txt variant="caption" tone="secondary" numberOfLines={1}>
          {t('log.cravingHint')}
        </Txt>
      </View>
      <ChevronRight size={18} color={colors.text2} />
    </Pressy>
  );

  return (
    <View style={{ gap: Space.lg }}>
      {sugarFirst ? cravingTile : null}

      <Tiles>
        <Tile icon={PenLine} label={t('log.writeMeal')} onPress={() => go('/capture', { mode: 'text' })} />
        <Tile icon={ScanBarcode} label={t('capture.barcode')} onPress={() => go('/capture', { mode: 'barcode' })} />
      </Tiles>

      {hydration || trackMood ? (
        <Card style={{ gap: Space.lg, padding: Space.lg }}>
          {hydration ? (
            <View style={{ gap: Space.sm }}>
              <Row gap={Space.sm}>
                <Glass progress={hydration.totalMl / Math.max(1, hydration.goalMl)} totalMl={hydration.totalMl} height={18} />
                <Txt variant="label">{t('water.short')}</Txt>
                <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                  {t('water.today', { total: formatLiters(hydration.totalMl, locale), goal: formatLiters(hydration.goalMl, locale) })}
                </Txt>
              </Row>
              <Row gap={Space.sm}>
                {WATER_SIZES.map((ml) => (
                  <WaterSizeChip
                    key={ml}
                    ml={ml}
                    selected={ml === glassMl}
                    onPress={() => {
                      setSettings({ glassMl: ml });
                      void pour(ml, hydration);
                      dismiss();
                    }}
                  />
                ))}
              </Row>
            </View>
          ) : null}
          {hydration && trackMood ? <View style={{ height: 1, backgroundColor: colors.border }} /> : null}
          {trackMood ? (
            <View style={{ gap: Space.sm }}>
              <Txt variant="label">{t('mood.title')}</Txt>
              <MoodFaces
                mood={mood?.mood ?? null}
                size={36}
                onPick={(level) => {
                  pick(level);
                  dismiss();
                }}
              />
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* The body, then the journal's kinds: one even grid, so every tile is where the eye expects it. */}
      <Tiles>
        <Tile icon={SportShoe} tint={colors.accent} label={t('today.move')} onPress={() => go('/workout')} />
        <Tile icon={Scale} label={t('weight.title')} onPress={() => onOpen('weight')} />
        {trackBp ? <Tile icon={HeartPulse} tint="#D98166" label={t('bp.title')} onPress={() => onOpen('bp')} /> : null}
        {NOTE_KINDS.map((kind) => (
          <Tile
            key={kind}
            icon={KIND_META[kind].icon}
            tint={kind === 'other' ? undefined : KIND_META[kind].color(colors)}
            label={t(kind === 'other' ? 'journal.kind.otherShort' : (kindLabel(kind) as TranslationKey))}
            onPress={() => go('/note', { kind })}
          />
        ))}
        {craving && !sugarFirst ? <Tile icon={Sparkles} tint={colors.accent} label={t('today.craving')} onPress={() => go('/craving')} /> : null}
      </Tiles>
    </View>
  );
}

/** Two even columns; a last tile on its own keeps its width. */
function Tiles({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Space.sm }}>{children}</View>;
}

/** An entry point: a tinted icon and a word. */
function Tile({ icon: Icon, label, tint, onPress }: { icon: LucideIcon; label: string; tint?: string; onPress: () => void }) {
  const { colors, elevation } = useTheme();
  const color = tint ?? colors.text;
  return (
    <Pressy
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        { width: '48.8%', flexDirection: 'row', alignItems: 'center', gap: Space.sm, height: 54, paddingHorizontal: 10, borderRadius: Radius.lg, borderCurve: 'continuous', backgroundColor: colors.surface },
        elevation,
      ]}>
      {/* Concentric: the bubble's corner follows the tile's, minus the padding. */}
      <View style={{ width: 32, height: 32, borderRadius: Radius.lg - 10, borderCurve: 'continuous', backgroundColor: tint ? `${tint}24` : colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={17} color={color} />
      </View>
      <Txt variant="label" numberOfLines={1} style={{ flexShrink: 1, fontSize: 14.5 }}>
        {label}
      </Txt>
    </Pressy>
  );
}
