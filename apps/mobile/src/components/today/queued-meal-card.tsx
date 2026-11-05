import { localTime } from '@symbiose/shared';
import { Image } from 'expo-image';
import { CloudOff, CloudUpload, RotateCw, Trash2, TriangleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Button, Pressy, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { queuedPhotoUri, type OutboxEntry } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { Radius, Space, useTheme } from '@/theme';

import { PAD, THUMB, THUMB_RADIUS } from './meal-card';

/** The photo kept on the phone, the source meal's photo for a copy, or an emoji. */
function QueuedThumb({ entry }: { entry: OutboxEntry }) {
  const { api } = useSession();
  const { colors, imageOutline } = useTheme();
  const [local] = useState(() => (entry.kind === 'create' && entry.photo ? queuedPhotoUri(entry.id) : null));
  const source = local
    ? { uri: local }
    : entry.kind === 'duplicate' && entry.photoId && api
      ? { uri: api.photoUrl(entry.photoId), headers: api.authHeaders }
      : null;
  return (
    <View style={{ width: THUMB, height: THUMB, borderRadius: THUMB_RADIUS, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
      <Txt style={{ fontSize: 26 }}>{entry.emoji ?? '🍽️'}</Txt>
      {source ? (
        // Covers the emoji once loaded; a copy's photo comes from the image cache while offline.
        <Image source={source} style={[{ position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB_RADIUS }, imageOutline]} contentFit="cover" transition={200} />
      ) : null}
    </View>
  );
}

/** A slow breath while waiting, a quicker one while sending. */
function Breath({ color, quick }: { color: string; quick: boolean }) {
  const breath = useSharedValue(0);
  useEffect(() => {
    breath.set(withRepeat(withTiming(1, { duration: quick ? 650 : 1500, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [quick, breath]);
  const style = useAnimatedStyle(() => ({ opacity: 0.3 + breath.value * 0.7, transform: [{ scale: 0.8 + breath.value * 0.2 }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color }, style]} />;
}

/**
 * A meal captured without network, at its own time in the timeline. Calm on
 * purpose: nothing went wrong, it just waits. A tap shows « Réessayer » and
 * « Supprimer ».
 */
export function QueuedMealCard({ entry, sending, onRetry, onDelete }: { entry: OutboxEntry; sending: boolean; onRetry: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const refused = Boolean(entry.error) && !sending;
  const status = sending ? t('outbox.sending') : (entry.error ?? (entry.waitingFor === 'ai' ? t('outbox.waitingAi') : t('outbox.waiting')));
  const actions = open && !sending;
  const StatusIcon = sending ? CloudUpload : refused ? TriangleAlert : CloudOff;

  return (
    <Animated.View
      entering={FadeInDown.duration(320).easing(Easing.out(Easing.cubic))}
      exiting={FadeOut.duration(220)}
      layout={LinearTransition.duration(250)}
      style={{ gap: Space.sm }}>
      <Pressy
        // Nothing to choose while it's being sent.
        onPress={() => !sending && setOpen(!open)}
        haptic={!sending}
        accessibilityRole="button"
        accessibilityLabel={`${entry.label}, ${status}`}
        accessibilityState={{ expanded: actions, busy: sending }}
        style={{
          padding: PAD,
          borderRadius: Radius.lg,
          borderCurve: 'continuous',
          backgroundColor: colors.surface,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: refused ? colors.warning : colors.text3,
        }}>
        <Row gap={Space.md}>
          <QueuedThumb entry={entry} />
          <View style={{ flex: 1, gap: 3 }}>
            <Txt variant="label" numberOfLines={1} style={{ fontSize: 16 }}>
              {entry.label}
            </Txt>
            <Row gap={6} style={{ alignItems: 'center' }}>
              {refused ? null : <Breath color={sending ? colors.accent : colors.text3} quick={sending} />}
              <Txt variant="caption" tone={refused ? 'warning' : 'secondary'} numberOfLines={2} style={{ flexShrink: 1, fontVariant: ['tabular-nums'] }}>
                {localTime(entry.eatenAt)} · {status}
              </Txt>
            </Row>
          </View>
          <StatusIcon size={18} color={sending ? colors.accent : refused ? colors.warning : colors.text3} />
        </Row>
      </Pressy>
      {/* Beside the card, not inside it: one pressable never holds another (invalid on the web). */}
      {actions ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          <Row gap={Space.sm}>
            <Button
              size="md"
              variant="secondary"
              title={t('common.retry')}
              icon={<RotateCw size={16} color={colors.text} />}
              style={{ flex: 1 }}
              onPress={() => {
                setOpen(false);
                onRetry();
              }}
            />
            <Button size="md" variant="danger" title={t('common.delete')} icon={<Trash2 size={16} color={colors.danger} />} style={{ flex: 1 }} onPress={onDelete} />
          </Row>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
