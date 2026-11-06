import { heroNutrient as sharedHero, type DaySummary, type GoalPlan, type NutrientKey, type NutrientProgress } from '@symbiose/shared';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AnimatedNumber, Card, Dot, Glow, Pressy, Ring, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatAmount, formatNumber, unitOf } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { dragPosition, heroChoice, heroIndex, heroPages, snapPage } from '@/lib/hero-logic';
import { useSettings } from '@/lib/stores';
import { Fonts, Motion, NUTRIENT_COLORS, Radius, Space, useTheme, type Palette } from '@/theme';

/** The goal decides the hero metric; shared with the server so the watch and widgets agree. */
export function heroNutrient(day: DaySummary, plan: GoalPlan | null, hideCalories: boolean): NutrientKey {
  return sharedHero(day.progress, plan, hideCalories);
}

const colorFor = (key: NutrientKey, accent: string) => (key === 'kcal' ? accent : NUTRIENT_COLORS[key]);

const PAD = Space.lg + 2;
/** A page lands like native paging: quick, with no visible bounce. */
const PAGE_SPRING = { damping: 30, stiffness: 260, mass: 1 } as const;

/**
 * The hero: what's left today for one nutrient in a big ring, and every
 * nutrient of the day as a small ring in one row under it, so sugars, protein
 * and fibre are read together. One card, not two. It opens on the goal's
 * nutrient; a small ring tapped, or a horizontal swipe, brings another into the
 * big ring (the row's tinted cell follows). The choice is remembered
 * (`heroPage`) until the goal changes. The day line above it stays on the goal.
 * Which rings: a simple default (the goal, calories, protein, fibre), or the
 * person's own, chosen with a long press on the card (`heroRings`, `hero-rings.tsx`).
 * A small ring says what its big ring would: what's left, « +5 » once a limit
 * is passed, ✓ once a minimum is reached. Before the first meal that is the
 * whole budget: a day starts with it, not with a row of zeros.
 * A goal reached today lights the ring up for a moment (`glow`, from `useGoalRewards`).
 * `hint` lets the card show, once ever, that it turns: it peeks at the next page.
 *
 * The swipe is a Gesture Handler pan that activates after 10 pt sideways, on the UI thread. Today's
 * day swipe is a PanResponder around the whole header that waits for 24 pt: on iOS and Android an
 * active gesture cancels the JS responder (the coach line's swipe relies on it too), and Today
 * also skips the day swipe for a touch that started on the card (`onTouchStart`), the web's only
 * guard. Vertical drags fail the pan and scroll the screen.
 */
export function EnergyCard({
  day,
  plan,
  hideCalories,
  glow,
  hint = false,
}: {
  day: DaySummary;
  plan: GoalPlan | null;
  hideCalories: boolean;
  glow?: SharedValue<number>;
  hint?: boolean;
}) {
  const { t, locale, nutrient } = useI18n();
  const { colors } = useTheme();
  const window = useWindowDimensions();
  const reduced = useReducedMotion();
  const saved = useSettings((s) => s.heroPage);
  const hinted = useSettings((s) => s.heroHinted);
  const chosen = useSettings((s) => s.heroRings);
  const set = useSettings((s) => s.set);

  const pages = heroPages(plan, hideCalories, chosen).filter((key) => day.progress.some((p) => p.nutrient === key));
  const count = pages.length;
  const index = heroIndex(pages, saved);
  const fresh = day.meals.length === 0;
  const views = pages.map((key) => pageView(day.progress.find((p) => p.nutrient === key)!, fresh, t, locale, colors));

  // A page is the card's width: guessed from the window (Today is one column, at most 640 wide) until measured.
  const [measured, setMeasured] = useState(0);
  const width = measured || Math.min(window.width, 640) - Space.lg * 2;

  /** Where the strip of pages stands, in pages (1.5: half way from the second to the third). */
  const position = useSharedValue(index);
  /** The page it rests on, or is heading to. */
  const target = useSharedValue(index);
  const start = useSharedValue(0);
  /** Where the finger touched down: Android's pan counts from its activation, the card from the touch. */
  const down = useSharedValue(0);

  // The pages changed under the choice (a new plan, calories hidden): the card simply shows it.
  useEffect(() => {
    if (target.get() === index) return;
    target.set(index);
    position.set(index);
  }, [index, target, position]);

  const choose = (next: number) => {
    haptics.tap();
    set({ heroPage: heroChoice(pages, next), heroHinted: true });
  };

  // Once ever, a moment after Today appears (and the arrival has left): the card leans towards the
  // next page and settles back.
  const peek = hint && !hinted && saved === null && count > 1 && !reduced;
  useEffect(() => {
    if (!peek) return;
    const timer = setTimeout(() => {
      position.set(withSequence(withTiming(0.1, { duration: 460, easing: Easing.out(Easing.cubic) }), withSpring(0, Motion.settle)));
      set({ heroHinted: true });
    }, 2000);
    return () => clearTimeout(timer);
  }, [peek, position, set]);

  const pan = Gesture.Pan()
    .enabled(count > 1)
    .activeOffsetX([-10, 10])
    .failOffsetY([-12, 12])
    .onBegin((e) => {
      down.set(e.absoluteX);
    })
    .onStart(() => {
      // From where it is, even mid-landing: the finger catches the page.
      start.set(position.value);
    })
    .onUpdate((e) => {
      position.set(dragPosition(start.value, -(e.absoluteX - down.value) / width, count));
    })
    .onEnd((e) => {
      const velocity = Math.max(-6, Math.min(6, -e.velocityX / width));
      const from = target.value;
      const next = snapPage(position.value, velocity, from, count);
      target.set(next);
      position.set(withSpring(next, { ...PAGE_SPRING, velocity }));
      if (next !== from) scheduleOnRN(choose, next);
    });

  // A long press anywhere on the card chooses its rings. Whichever starts first wins: a finger that
  // moves turns the page, one that rests opens the choice.
  const customize = () => {
    haptics.impact();
    router.push('/hero-rings');
  };
  const hold = Gesture.LongPress()
    .minDuration(420)
    .onStart(() => {
      scheduleOnRN(customize);
    });

  // VoiceOver and TalkBack turn the pages as an adjustable value: swipe up or down. The small rings
  // are for the eye; each page reads the others' numbers instead.
  const spoken = views.map((view, i) =>
    [
      nutrient(view.key),
      view.center,
      view.summary.replace(' · ', ', '),
      ...views.filter((other) => other !== view).map((other) => `${nutrient(other.key)} ${barValue(other.progress, locale)}`),
      t('hero.page', { n: i + 1, count }),
    ].join(', '),
  );
  const go = (next: number) => {
    if (next < 0 || next >= count || next === index) return;
    target.set(next);
    position.set(withSpring(next, PAGE_SPRING));
    choose(next);
    // VoiceOver reads an adjustable's new value by itself; TalkBack is told.
    if (Platform.OS === 'android') AccessibilityInfo.announceForAccessibility(spoken[next]!);
  };

  const strip = useAnimatedStyle(() => ({ transform: [{ translateX: -position.value * width }] }));

  return (
    <GestureDetector gesture={Gesture.Race(pan, hold)}>
      <Animated.View
        onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole={count > 1 ? 'adjustable' : 'summary'}
        accessibilityLabel={t('hero.a11y')}
        aria-valuetext={spoken[index]}
        accessibilityActions={[...(count > 1 ? [{ name: 'increment' }, { name: 'decrement' }] : []), { name: 'customize', label: t('heroRings.title') }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'customize') customize();
          else go(index + (e.nativeEvent.actionName === 'increment' ? 1 : -1));
        }}>
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {views.map((view, i) => (
            <PageGlow key={view.key} page={i} position={position} color={view.color} />
          ))}
          {/* The card speaks for its pages (above); TalkBack would otherwise stop on each ring too. */}
          <Animated.View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[{ flexDirection: 'row', width: width * count }, strip]}>
            {views.map((view) => (
              <View key={view.key} style={{ width, paddingHorizontal: PAD, paddingTop: PAD, paddingBottom: count > 1 ? Space.xs : PAD, justifyContent: 'center' }}>
                <HeroPage view={view} glow={glow} />
              </View>
            ))}
          </Animated.View>
          {count > 1 ? <RingRow views={views} position={position} selected={index} onSelect={go} /> : null}
        </Card>
      </Animated.View>
    </GestureDetector>
  );
}

interface PageView {
  key: NutrientKey;
  progress: NutrientProgress;
  isKcal: boolean;
  over: boolean;
  reachedMin: boolean;
  remaining: number;
  /** The ring's colour: the nutrient's own, the warning once a limit is passed. */
  color: string;
  formatCenter: (value: number) => string;
  centerLabel: string;
  /** « 16 g restants », said in one piece. */
  center: string;
  summary: string;
}

/** Everything a page says about its nutrient, for the eye and for VoiceOver alike. */
function pageView(
  p: NutrientProgress,
  fresh: boolean,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  locale: 'fr' | 'en',
  colors: Palette,
): PageView {
  const key = p.nutrient;
  const isKcal = key === 'kcal';
  const { kind } = p.target;
  const over = p.status === 'over' || (kind !== 'min' && p.consumed > p.target.value);
  const remaining = p.target.value - p.consumed;
  const amount = (value: number) => (isKcal ? `${formatNumber(value, locale)} kcal` : formatAmount(key, value, locale));
  const reachedMin = kind === 'min' && remaining <= 0;
  const formatCenter = (v: number) => (isKcal ? formatNumber(v, locale) : formatAmount(key, v, locale, false));
  const centerLabel = reachedMin
    ? t('status.reached')
    : `${isKcal ? 'kcal' : unitOf(key)} ${over ? t('today.over') : kind === 'min' ? t('status.toGo') : isKcal ? t('today.left') : t('today.leftUnit')}`;
  // « 60 g · repère 25 g », « 1 395 / 1 840 kcal », or the day's budget before the first meal.
  const summary = fresh
    ? t(kind === 'max' ? 'hero.fresh.max' : kind === 'min' ? 'hero.fresh.min' : 'hero.fresh.target', { amount: amount(p.target.value) })
    : isKcal
      ? `${formatNumber(p.consumed, locale)} / ${amount(p.target.value)}`
      : `${amount(p.consumed)} · ${t(kind === 'max' ? 'hero.limit' : 'hero.goal', { amount: amount(p.target.value) })}`;
  return {
    key,
    progress: p,
    isKcal,
    over,
    reachedMin,
    remaining,
    color: over && kind !== 'min' ? colors.warning : colorFor(key, colors.accent),
    formatCenter,
    centerLabel,
    center: reachedMin ? centerLabel : `${formatCenter(Math.abs(remaining))} ${centerLabel}`,
    summary,
  };
}

/** One page: the big ring, the nutrient's name and its numbers beside it. */
function HeroPage({ view, glow }: { view: PageView; glow?: SharedValue<number> }) {
  const { nutrient } = useI18n();
  const { colors } = useTheme();
  const centerValue = view.formatCenter(Math.abs(view.remaining));
  return (
    <Row gap={PAD}>
      <RingSwell glow={glow}>
        <Ring progress={view.progress.ratio} size={RING} stroke={11} color={view.color}>
          {view.reachedMin ? (
            <Txt variant="display" style={{ fontSize: 34 }}>
              ✓
            </Txt>
          ) : (
            <AnimatedNumber value={Math.abs(view.remaining)} format={view.formatCenter} style={{ fontSize: centerValue.length > 4 ? 27 : 34, lineHeight: 40 }} />
          )}
          <Txt variant="caption" tone={view.over ? 'warning' : 'secondary'} numberOfLines={2} style={{ textAlign: 'center', fontSize: 12, lineHeight: 15, maxWidth: 84 }}>
            {view.centerLabel}
          </Txt>
        </Ring>
      </RingSwell>

      <View style={{ flex: 1, gap: 4 }}>
        <Row gap={6}>
          <Dot color={colorFor(view.key, colors.accent)} />
          <Txt variant="overline" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {nutrient(view.key)}
          </Txt>
        </Row>
        <Txt variant="label" tone={view.over ? 'warning' : 'primary'} numberOfLines={2} style={{ fontSize: 16, lineHeight: 21, fontVariant: ['tabular-nums'] }}>
          {view.summary}
        </Txt>
      </View>
    </Row>
  );
}

/** The page's light behind the card, handing over to the next one's as the pages turn. */
function PageGlow({ page, position, color }: { page: number; position: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - Math.abs(position.value - page)) }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Glow color={color} size={260} opacity={0.2} style={{ left: -80, top: -80 }} />
    </Animated.View>
  );
}

/**
 * Every nutrient of the hero as a small ring, in the pages' order. The one in the big ring sits on
 * a tint of its colour, which slides from cell to cell with the swipe. A tap brings a ring up.
 */
function RingRow({ views, position, selected, onSelect }: { views: PageView[]; position: SharedValue<number>; selected: number; onSelect: (index: number) => void }) {
  return (
    <Row gap={0} style={{ alignItems: 'stretch', paddingHorizontal: ROW_INSET, paddingBottom: ROW_INSET }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {views.map((view, i) => (
        <SmallRing key={view.key} view={view} page={i} position={position} selected={i === selected} onPress={() => onSelect(i)} />
      ))}
    </Row>
  );
}

function SmallRing({ view, page, position, selected, onPress }: { view: PageView; page: number; position: SharedValue<number>; selected: boolean; onPress: () => void }) {
  const { nutrient } = useI18n();
  const { colors, scheme } = useTheme();
  const tint = colorFor(view.key, colors.accent);
  const shade = useAnimatedStyle(() => ({ opacity: (scheme === 'dark' ? 0.16 : 0.1) * Math.max(0, 1 - Math.abs(position.value - page)) }));
  const value = view.over ? `+${view.formatCenter(Math.abs(view.remaining))}` : view.formatCenter(Math.abs(view.remaining));
  return (
    <Pressy haptic={false} onPress={onPress} hitSlop={{ top: 4, bottom: 4 }} style={{ flex: 1, alignItems: 'center', gap: 6, paddingTop: Space.md, paddingBottom: Space.sm + 2, paddingHorizontal: 2 }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint, borderRadius: CELL_RADIUS, borderCurve: 'continuous' }, shade]} />
      <Ring progress={view.progress.ratio} size={SMALL} stroke={4} color={view.color}>
        <Txt
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          tone={view.over ? 'warning' : 'primary'}
          style={{ fontFamily: Fonts.rounded, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'], maxWidth: SMALL - 13, textAlign: 'center' }}>
          {view.reachedMin ? '✓' : value}
        </Txt>
      </Ring>
      <Txt
        numberOfLines={2}
        tone={selected ? 'primary' : 'secondary'}
        style={{ fontSize: 11, lineHeight: 13, fontWeight: selected ? '600' : '400', textAlign: 'center' }}>
        {nutrient(view.key)}
      </Txt>
    </Pressy>
  );
}

const SMALL = 42;
/** The row sits this far from the card's edges; its cells round off concentrically with the card. */
const ROW_INSET = Space.sm + 2;
const CELL_RADIUS = Radius.xl - ROW_INSET;

const RING = 118;
const HALO = 300;

/** The ring with its reward: a halo of the accent blooms behind it and the ring swells a hair, then both settle. */
function RingSwell({ glow, children }: { glow?: SharedValue<number>; children: ReactNode }) {
  const { colors, scheme } = useTheme();
  const halo = useAnimatedStyle(() => {
    const g = glow?.value ?? 0;
    return { opacity: g, transform: [{ scale: 0.55 + 0.45 * g }] };
  });
  const swell = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.045 * (glow?.value ?? 0) }] }));
  if (!glow) return children;
  return (
    <View style={{ width: RING, height: RING }}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: (RING - HALO) / 2, top: (RING - HALO) / 2, width: HALO, height: HALO }, halo]}>
        {/* The dark accent is brighter: a lighter touch there. */}
        <Glow color={colors.accent} size={HALO} opacity={scheme === 'dark' ? 0.36 : 0.55} />
      </Animated.View>
      <Animated.View style={swell}>{children}</Animated.View>
    </View>
  );
}

/** « 65 / 120 g », « 1 395 / 1 840 ». */
function barValue(p: NutrientProgress, locale: 'fr' | 'en'): string {
  return p.nutrient === 'kcal'
    ? `${formatNumber(p.consumed, locale)} / ${formatNumber(p.target.value, locale)}`
    : `${formatAmount(p.nutrient, p.consumed, locale, false)} / ${formatAmount(p.nutrient, p.target.value, locale)}`;
}
