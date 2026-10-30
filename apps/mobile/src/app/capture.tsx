import { mealTotals, shortId, toLocalDate, toLocalDateTime, type FoodItem, type Meal } from '@symbiose/shared';
import { useQuery } from '@tanstack/react-query';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { ArrowUp, Images, PenLine, Star, X, Zap, ZapOff } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PortionStepper } from '@/components/meal/portion-stepper';
import { Button, IconButton, Pressy, Row, Txt, webInput } from '@/components/ui';
import { dismiss } from '@/lib/nav';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { formatAmount } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useMealLogger, useRefreshAfterMeal } from '@/lib/hooks';
import { preparePhoto } from '@/lib/image';
import { useApi } from '@/lib/session';
import { useSettings, useToast } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

type Mode = 'photo' | 'barcode' | 'text';
const BARCODES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e'];
const WHITE = '#FFFFFF';
const DIM = 'rgba(255,255,255,0.6)';

/** When logging on a past day, keep the current time of day. */
function timestampFor(date: string) {
  const now = new Date();
  if (date === toLocalDate(now)) return { eatenAt: toLocalDateTime(now), localDate: date };
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { eatenAt: toLocalDateTime(new Date(y, m - 1, d, now.getHours(), now.getMinutes())), localDate: date };
}

export default function Capture() {
  const params = useLocalSearchParams<{ date?: string; mode?: Mode }>();
  const date = params.date ?? toLocalDate();
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { log } = useMealLogger();
  const [mode, setMode] = useState<Mode>(params.mode ?? 'photo');
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [torch, setTorch] = useState(false);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const leftHanded = useSettings((s) => s.leftHanded);
  // A quick white flash confirms the shot, like a real shutter.
  const flash = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  // Barcode state
  const [product, setProduct] = useState<FoodItem | null>(null);
  const [grams, setGrams] = useState(100);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanning = useRef(false);

  const close = () => dismiss();

  const submitPhoto = async (uri: string, width: number, height: number) => {
    setBusy(true);
    try {
      const photo = await preparePhoto(uri, width, height);
      void log({ ...timestampFor(date), photoBase64: photo.base64, text: note.trim() || undefined }, { photoUri: photo.uri, label: note.trim() || t('capture.photo') });
      close();
    } catch {
      setBusy(false);
      haptics.warning();
    }
  };

  const shoot = async () => {
    if (!camera.current || busy) return;
    haptics.impact();
    flash.set(withSequence(withTiming(0.85, { duration: 60 }), withTiming(0, { duration: 280 })));
    const picture = await camera.current.takePictureAsync({ quality: 0.85, shutterSound: false });
    if (picture) await submitPhoto(picture.uri, picture.width, picture.height);
  };

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) await submitPhoto(asset.uri, asset.width, asset.height);
  };

  const onBarcode = async (code: string) => {
    if (scanning.current || product) return;
    scanning.current = true;
    haptics.success();
    setScanError(null);
    try {
      const item = await api.barcode(code);
      setProduct(item);
      setGrams(item.grams);
    } catch (e) {
      haptics.warning();
      setScanError(e instanceof ApiError && e.status === 404 ? t('capture.notFound') : t('common.offline'));
      setTimeout(() => (scanning.current = false), 2500);
    }
  };

  const addProduct = () => {
    if (!product) return;
    void log({ ...timestampFor(date), items: [{ ...product, grams }] }, { label: product.name });
    close();
  };

  const cameraNeeded = mode !== 'text';

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {cameraNeeded && permission?.granted ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={mode === 'barcode' ? { barcodeTypes: BARCODES } : undefined}
          onBarcodeScanned={mode === 'barcode' && !product ? ({ data }) => void onBarcode(data) : undefined}
        />
      ) : null}

      {cameraNeeded && permission && !permission.granted ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.xl, padding: Space.xxl }}>
          <Txt style={{ color: WHITE, textAlign: 'center' }}>{t('capture.permission')}</Txt>
          <Button title={t('capture.allow')} variant="accent" onPress={requestPermission} />
        </View>
      ) : null}

      {mode === 'barcode' && !product ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <View style={{ width: 280, height: 150, borderRadius: Radius.lg, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' }} />
          <Txt variant="label" style={{ color: WHITE, marginTop: Space.lg }}>
            {scanError ?? t('capture.scanHint')}
          </Txt>
        </View>
      ) : null}

      {mode === 'text' ? <TextMode date={date} onDone={close} /> : null}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: WHITE }, flashStyle]} />

      {/* Top bar */}
      <Row style={{ position: 'absolute', top: insets.top + Space.sm, left: Space.lg, right: Space.lg, justifyContent: 'space-between' }}>
        <IconButton label={t('common.close')} variant="glass" icon={<X size={22} color={WHITE} />} onPress={close} />
        {mode !== 'text' ? (
          <IconButton label="torch" variant="glass" icon={torch ? <Zap size={20} color={WHITE} /> : <ZapOff size={20} color={WHITE} />} onPress={() => setTorch(!torch)} />
        ) : null}
      </Row>

      {/* Product sheet after a barcode scan */}
      {product ? (
        <Animated.View
          entering={FadeInDown.duration(220)}
          style={{ position: 'absolute', left: Space.md, right: Space.md, bottom: insets.bottom + Space.md, backgroundColor: colors.surface, borderRadius: Radius.xl, padding: Space.xl, gap: Space.lg }}>
          <View style={{ gap: 4 }}>
            <Txt variant="heading" numberOfLines={2}>
              {product.name}
            </Txt>
            <Txt variant="caption" tone="secondary">
              {[product.brand, `${formatAmount('kcal', product.per100g.kcal, locale)} · ${formatAmount('sugar', product.per100g.sugar, locale)} ${t('capture.per100')}`].filter(Boolean).join(' · ')}
            </Txt>
          </View>
          <ProductPortion product={product} grams={grams} onChange={setGrams} />
          <Row gap={Space.sm}>
            <Button
              title={t('common.cancel')}
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => {
                setProduct(null);
                scanning.current = false;
              }}
            />
            <Button title={t('capture.add')} variant="accent" style={{ flex: 1 }} onPress={addProduct} />
          </Row>
        </Animated.View>
      ) : null}

      {/* Bottom controls */}
      {!product ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + Space.lg, gap: Space.xl, alignItems: 'center' }}>
          {mode === 'photo' && noteOpen ? (
            <Animated.View entering={FadeIn} style={{ width: '100%', paddingHorizontal: Space.lg }}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t('capture.note')}
                placeholderTextColor={DIM}
                autoFocus
                style={[{ height: 48, borderRadius: Radius.pill, backgroundColor: 'rgba(0,0,0,0.55)', color: WHITE, paddingHorizontal: Space.xl, fontSize: 16 }, webInput]}
              />
            </Animated.View>
          ) : null}

          {mode === 'photo' ? (
            // Left-handed: the note (used most) moves under the left thumb, the gallery to the right.
            <Row style={{ width: '100%', paddingHorizontal: Space.xxxl, justifyContent: 'space-between', flexDirection: leftHanded ? 'row-reverse' : 'row' }}>
              <IconButton label={t('capture.gallery')} variant="glass" size={52} icon={<Images size={22} color={WHITE} />} onPress={pickFromGallery} />
              <Pressy
                accessibilityRole="button"
                accessibilityLabel={t('capture.photo')}
                onPress={shoot}
                disabled={busy || !permission?.granted}
                style={{ width: 82, height: 82, borderRadius: 41, borderWidth: 4, borderColor: WHITE, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 66, height: 66, borderRadius: 33, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center' }}>
                  {busy ? <ActivityIndicator color="#000" /> : null}
                </View>
              </Pressy>
              <IconButton label={t('capture.note')} variant="glass" size={52} icon={<PenLine size={22} color={note ? '#3DD68C' : WHITE} />} onPress={() => setNoteOpen(!noteOpen)} />
            </Row>
          ) : null}

          <Row gap={Space.xl}>
            {(['text', 'photo', 'barcode'] as const).map((m) => (
              <Pressy
                key={m}
                onPress={() => {
                  setMode(m);
                  setScanError(null);
                }}
                style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.pill, backgroundColor: mode === m ? 'rgba(255,255,255,0.18)' : 'transparent' }}>
                <Txt variant="label" style={{ color: mode === m ? '#FFD60A' : WHITE, letterSpacing: 0.5 }}>
                  {t(`capture.${m}`).toUpperCase()}
                </Txt>
              </Pressy>
            ))}
          </Row>
        </View>
      ) : null}
    </View>
  );
}

function ProductPortion({ product, grams, onChange }: { product: FoodItem; grams: number; onChange: (g: number) => void }) {
  const { locale, nutrient } = useI18n();
  const totals = mealTotals([{ ...product, grams }]);
  return (
    <View style={{ gap: Space.md }}>
      <PortionStepper grams={grams} base={product.grams} onChange={onChange} />
      <Txt variant="label" tone="secondary" style={{ textAlign: 'center' }}>
        {formatAmount('kcal', totals.kcal, locale)} · {nutrient('addedSugar')} {formatAmount('addedSugar', totals.addedSugar, locale)} · {nutrient('protein')} {formatAmount('protein', totals.protein, locale)}
      </Txt>
    </View>
  );
}

/** Describe the meal in words (keyboard dictation works great), or re-log a recent food in one tap. */
function TextMode({ date, onDone }: { date: string; onDone: () => void }) {
  const { t, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { log } = useMealLogger();
  const refresh = useRefreshAfterMeal();
  const showToast = useToast((s) => s.show);
  const [text, setText] = useState('');
  const library = useQuery({ queryKey: ['library', date], queryFn: () => api.library(toLocalDate()) });

  const send = () => {
    if (!text.trim()) return;
    void log({ ...timestampFor(date), text: text.trim() }, { label: text.trim() });
    onDone();
  };

  const relogItem = (item: FoodItem) => {
    void log({ ...timestampFor(date), items: [{ ...item, id: shortId(), source: 'library' }], title: item.name }, { label: item.name });
    onDone();
  };

  const relogMeal = async (meal: Meal) => {
    haptics.success();
    onDone();
    const copy = await api.duplicateMeal(meal.id, timestampFor(date));
    refresh(copy);
    showToast({ message: `${t('detail.relogged')} · ${copy.title}` });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#0A0A0B', paddingTop: insets.top + 72, paddingBottom: insets.bottom + 72 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: Space.xl, gap: Space.xl }}>
        <View style={{ backgroundColor: '#161618', borderRadius: Radius.xl, padding: Space.lg, gap: Space.md }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('capture.textPlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.35)"
            multiline
            autoFocus
            style={[{ minHeight: 110, color: WHITE, fontSize: 20, lineHeight: 27, textAlignVertical: 'top' }, webInput]}
          />
          <Row style={{ justifyContent: 'flex-end' }}>
            <Pressy
              onPress={send}
              disabled={!text.trim()}
              accessibilityLabel={t('capture.send')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: WHITE, borderRadius: Radius.pill, paddingHorizontal: Space.lg, height: 42 }}>
              <Txt variant="label" style={{ color: '#000' }}>
                {t('capture.send')}
              </Txt>
              <ArrowUp size={18} color="#000" />
            </Pressy>
          </Row>
        </View>

        {library.data?.favoriteMeals.length ? (
          <View style={{ gap: Space.sm }}>
            <Txt variant="overline" style={{ color: DIM }}>
              {t('capture.favorites')}
            </Txt>
            {library.data.favoriteMeals.slice(0, 6).map((meal) => (
              <Pressy key={meal.id} onPress={() => void relogMeal(meal)} style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.md, borderRadius: Radius.lg, backgroundColor: '#161618' }}>
                <Star size={16} color="#FFD60A" fill="#FFD60A" />
                <Txt variant="label" style={{ color: WHITE, flex: 1 }} numberOfLines={1}>
                  {meal.title}
                </Txt>
                <Txt variant="caption" style={{ color: DIM }}>
                  {formatAmount('kcal', meal.totals.kcal, locale)}
                </Txt>
              </Pressy>
            ))}
          </View>
        ) : null}

        {library.data?.recentItems.length ? (
          <View style={{ gap: Space.sm }}>
            <Txt variant="overline" style={{ color: DIM }}>
              {t('capture.recent')}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
              {library.data.recentItems.slice(0, 18).map(({ key, item }) => (
                <Pressy key={key} onPress={() => relogItem(item)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: '#161618' }}>
                  {item.emoji ? <Txt>{item.emoji}</Txt> : null}
                  <Txt variant="label" style={{ color: WHITE }} numberOfLines={1}>
                    {item.name}
                  </Txt>
                  <Txt variant="caption" style={{ color: DIM }}>
                    {item.grams} g
                  </Txt>
                </Pressy>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
