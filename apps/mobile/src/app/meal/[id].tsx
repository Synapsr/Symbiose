import { localTime, mealTotals, NUTRIENT_KEYS, toLocalDate, toLocalDateTime, type FoodItem, type Meal, type MealType } from '@symbiose/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { ArrowUp, ChevronDown, RotateCcw, Sparkles, Star, Trash2, X } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemRow } from '@/components/meal/item-row';
import { Bar, Card, Chip, Dot, IconButton, Pressy, Row, SectionTitle, SwapIcon, Txt, webInput, webSingleRow } from '@/components/ui';
import { MicButton } from '@/components/ui/mic-button';
import { dismiss } from '@/lib/nav';
import { useI18n } from '@/i18n';
import { useDictation } from '@/lib/dictation';
import { formatAmount, formatNumber } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { errorMessage, useDeleteMeal, useMealLogger, useRefreshAfterMeal } from '@/lib/hooks';
import { useApi } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { NUTRIENT_COLORS, Radius, Space, useTheme, verdictColor } from '@/theme';

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export default function MealDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const { t } = useI18n();
  const { colors } = useTheme();
  const query = useQuery({ queryKey: ['meal', id], queryFn: () => api.meal(id) });

  if (!query.data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        {query.error ? <Txt tone="warning">{errorMessage(query.error, t('common.error'), t('common.offline'))}</Txt> : <ActivityIndicator />}
      </View>
    );
  }
  return <MealEditor meal={query.data} />;
}

function MealEditor({ meal }: { meal: Meal }) {
  const api = useApi();
  const { t, locale, nutrient, nutrientShort } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const refresh = useRefreshAfterMeal();
  const logger = useMealLogger();
  const hideCalories = useSettings((s) => s.hideCalories);

  const [items, setItems] = useState<FoodItem[]>(meal.items);
  const [baseGrams] = useState(() => Object.fromEntries(meal.items.map((i) => [i.id, i.grams])));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [correction, setCorrection] = useState('');
  const dictation = useDictation(correction, setCorrection);
  const [error, setError] = useState<string | null>(null);
  const [allValues, setAllValues] = useState(false);

  // Server answers replace local state (refinements change the item list).
  const lastServerItems = useRef(meal.items);
  useEffect(() => {
    if (meal.items !== lastServerItems.current) {
      lastServerItems.current = meal.items;
      setItems(meal.items);
    }
  }, [meal.items]);

  const apply = (updated: Meal) => {
    queryClient.setQueryData(['meal', meal.id], updated);
    refresh(updated);
  };
  const onError = (e: unknown) => {
    haptics.warning();
    setError(errorMessage(e, t('common.error'), t('common.offline')));
  };

  const update = useMutation({ mutationFn: (input: Parameters<typeof api.updateMeal>[1]) => api.updateMeal(meal.id, input), onSuccess: apply, onError });
  const refine = useMutation({
    mutationFn: (text: string) => api.refineMeal(meal.id, text),
    onSuccess: (updated) => {
      haptics.soft();
      setCorrection('');
      apply(updated);
    },
    onError,
  });
  // Gone at once, back with « Annuler »: the server hears about it when the toast leaves.
  const deleteMeal = useDeleteMeal();
  const remove = () => {
    deleteMeal(meal);
    dismiss();
  };
  // Sent, or kept for later without network (the logger says which); other errors stay on screen.
  const relog = useMutation({
    mutationFn: () => logger.relog(meal, { eatenAt: toLocalDateTime(), localDate: toLocalDate() }),
    onSuccess: () => dismiss(),
    onError,
  });

  // Portion edits are saved automatically, shortly after the last change.
  const dirty = items !== meal.items;
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => update.mutate({ items }), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const totals = mealTotals(items);
  const insight = meal.insight;
  const busy = refine.isPending;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + Space.xxxl }}>
        <Header meal={meal} />

        <View style={{ paddingHorizontal: Space.lg, gap: Space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <View style={{ gap: Space.sm, marginTop: Space.lg }}>
            <Txt variant="title" style={{ fontSize: 26 }}>
              {meal.title}
            </Txt>
            <Row gap={Space.sm}>
              {/* One pill: tap to cycle the meal type. */}
              <Chip
                label={`${t(`meal.${meal.mealType}`)} · ${localTime(meal.eatenAt)}`}
                onPress={() => update.mutate({ mealType: MEAL_TYPES[(MEAL_TYPES.indexOf(meal.mealType) + 1) % MEAL_TYPES.length]! })}
              />
              {busy || update.isPending ? <ActivityIndicator /> : null}
            </Row>
          </View>

          {insight && (insight.headline || insight.tips.length) ? (
            <Card style={{ gap: Space.md }}>
              <Row gap={Space.sm} style={{ alignItems: 'flex-start' }}>
                <View style={{ marginTop: 6 }}>
                  <Dot color={verdictColor(insight.verdict, colors)} size={10} />
                </View>
                <Txt variant="label" style={{ flex: 1, fontSize: 16, lineHeight: 22 }}>
                  {insight.headline}
                </Txt>
              </Row>
              {insight.tips.map((tip) => (
                <Txt key={tip} tone="secondary" style={{ marginLeft: 18 }}>
                  → {tip}
                </Txt>
              ))}
            </Card>
          ) : null}

          {insight?.clarification ? (
            <Card style={{ gap: Space.md, backgroundColor: colors.accentSoft, borderColor: 'transparent' }}>
              <Row gap={Space.sm}>
                <Sparkles size={18} color={colors.accent} />
                <Txt variant="label" style={{ flex: 1 }}>
                  {insight.clarification.question}
                </Txt>
              </Row>
              <Row gap={Space.sm} style={{ flexWrap: 'wrap' }}>
                {insight.clarification.options.map((option) => (
                  <Chip key={option} label={option} onPress={() => refine.mutate(`${insight.clarification!.question} → ${option}`)} />
                ))}
              </Row>
            </Card>
          ) : null}

          {/* What this meal means for the person's own guardrails. */}
          {insight?.flags.filter((f) => f.nutrient !== 'kcal').length ? (
            <Card style={{ gap: Space.lg }}>
              {insight.flags
                .filter((f) => f.nutrient !== 'kcal')
                .map((flag) => {
                  const heavy = flag.kind === 'max' && flag.share >= 0.5;
                  return (
                    <View key={flag.nutrient} style={{ gap: 8 }}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Row gap={8}>
                          <Dot color={NUTRIENT_COLORS[flag.nutrient]} />
                          <Txt variant="label">{nutrient(flag.nutrient)}</Txt>
                        </Row>
                        <Txt variant="label" tone={heavy ? 'warning' : 'secondary'}>
                          {formatAmount(flag.nutrient, totals[flag.nutrient], locale)}
                        </Txt>
                      </Row>
                      <Bar progress={flag.share} color={heavy ? colors.warning : NUTRIENT_COLORS[flag.nutrient]} />
                      <Txt variant="caption" tone={heavy ? 'warning' : 'tertiary'}>
                        {t('detail.ofDaily', { pct: Math.round(flag.share * 100), kind: t(flag.kind === 'max' ? 'detail.limit' : 'detail.goal') })}
                      </Txt>
                    </View>
                  );
                })}
            </Card>
          ) : null}

          <Card style={{ gap: Space.lg }}>
            <Row style={{ justifyContent: 'space-between' }}>
              {(['protein', 'carbs', 'fat', 'fiber'] as const).map((key) => (
                <View key={key} style={{ gap: 2 }}>
                  <Txt variant="caption" tone="secondary">
                    {nutrientShort(key)}
                  </Txt>
                  <Txt variant="number" style={{ fontSize: 18 }}>
                    {formatAmount(key, totals[key], locale)}
                  </Txt>
                </View>
              ))}
              {!hideCalories ? (
                <View style={{ gap: 2, alignItems: 'flex-end' }}>
                  <Txt variant="caption" tone="secondary">
                    kcal
                  </Txt>
                  <Txt variant="number" style={{ fontSize: 18 }}>
                    {formatNumber(totals.kcal, locale)}
                  </Txt>
                </View>
              ) : null}
            </Row>
            <Pressy onPress={() => setAllValues(!allValues)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Txt variant="caption" tone="secondary">
                {t('detail.allValues')}
              </Txt>
              <ChevronDown size={14} color={colors.text3} style={{ transform: [{ rotate: allValues ? '180deg' : '0deg' }] }} />
            </Pressy>
            {allValues ? (
              <View style={{ gap: Space.sm }}>
                {NUTRIENT_KEYS.filter((k) => k !== 'kcal').map((key) => (
                  <Row key={key} style={{ justifyContent: 'space-between' }}>
                    <Row gap={8}>
                      <Dot color={NUTRIENT_COLORS[key]} size={6} />
                      <Txt variant="caption">{nutrient(key)}</Txt>
                    </Row>
                    <Txt variant="caption" tone="secondary">
                      {formatAmount(key, totals[key], locale)}
                    </Txt>
                  </Row>
                ))}
              </View>
            ) : null}
          </Card>

          <SectionTitle>{t('detail.items')}</SectionTitle>
          <View style={{ gap: Space.sm, marginTop: -Space.sm }}>
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                baseGrams={baseGrams[item.id] ?? item.grams}
                expanded={expanded === item.id}
                hideCalories={hideCalories}
                onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
                onChange={(grams) => setItems(items.map((i) => (i.id === item.id ? { ...i, grams } : i)))}
                onRemove={() => {
                  haptics.tap();
                  setItems(items.filter((i) => i.id !== item.id));
                }}
              />
            ))}
          </View>

          {/* One sentence fixes everything: "no sugar in the coffee", "half the fries". */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm, backgroundColor: colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: colors.border, padding: 6, paddingLeft: Space.lg }}>
            <Sparkles size={18} color={colors.accent} style={{ marginBottom: 13 }} />
            <TextInput
              value={correction}
              onChangeText={setCorrection}
              placeholder={busy ? t('detail.fixing') : dictation.listening ? t('dictation.listening') : t('detail.fixPlaceholder')}
              placeholderTextColor={colors.text3}
              multiline
              editable={!busy}
              {...webSingleRow}
              style={[{ flex: 1, minHeight: 44, maxHeight: 120, color: colors.text, fontSize: 16, lineHeight: 20, paddingTop: 12, paddingBottom: 12 }, webInput]}
            />
            {busy ? null : <MicButton dictation={dictation} size={44} />}
            <IconButton
              label={t('detail.fix')}
              variant="inverted"
              icon={busy ? <ActivityIndicator color={colors.onInverted} /> : <ArrowUp size={20} color={colors.onInverted} />}
              onPress={() => correction.trim() && refine.mutate(correction.trim())}
            />
          </View>

          {error ? (
            <Txt variant="caption" tone="warning">
              {error}
            </Txt>
          ) : null}

          <Row gap={Space.sm} style={{ marginTop: Space.sm }}>
            <Action
              icon={<SwapIcon on={meal.favorite} onIcon={<Star size={20} color="#F5B83D" fill="#F5B83D" />} offIcon={<Star size={20} color={colors.text} />} />}
              label={t('detail.favorite')}
              onPress={() => update.mutate({ favorite: !meal.favorite })}
            />
            <Action icon={<RotateCcw size={20} color={colors.text} />} label={t('detail.relog')} onPress={() => relog.mutate()} />
            <Action icon={<Trash2 size={20} color={colors.danger} />} label={t('detail.delete')} onPress={remove} />
          </Row>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Header({ meal }: { meal: Meal }) {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();
  const top = Platform.OS === 'ios' ? Space.md : insets.top + Space.sm;
  return (
    <View>
      {meal.photoId ? (
        <Image source={{ uri: api.photoUrl(meal.photoId), headers: api.authHeaders }} style={{ width: '100%', height: 300 }} contentFit="cover" transition={200} />
      ) : (
        <View style={{ height: 160, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: Space.md }}>
          <Txt style={{ fontSize: 64 }}>{meal.items.find((i) => i.emoji)?.emoji ?? '🍽️'}</Txt>
        </View>
      )}
      <IconButton
        label={t('common.close')}
        variant={meal.photoId ? 'glass' : 'surface'}
        icon={<X size={20} color={meal.photoId ? '#fff' : colors.text} />}
        onPress={() => dismiss()}
        style={{ position: 'absolute', top, right: Space.lg }}
      />
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: ReactNode; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressy onPress={onPress} style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: Space.lg, borderRadius: Radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      {icon}
      <Txt variant="caption" tone="secondary">
        {label}
      </Txt>
    </Pressy>
  );
}
