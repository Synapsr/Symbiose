import { toLocalDate, type CoachMessage } from '@symbiose/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ArrowUp, Sparkles, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, IconButton, Row, Txt } from '@/components/ui';
import { Logo } from '@/components/ui/logo';
import { useI18n, type TranslationKey } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { useApi } from '@/lib/session';
import { Radius, Space, useTheme } from '@/theme';

const SUGGESTIONS: TranslationKey[] = ['coach.s1', 'coach.s2', 'coach.s3', 'coach.s4'];

export default function Coach() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const messages = useQuery({ queryKey: ['coach'], queryFn: () => api.coachMessages() });

  const send = useMutation({
    mutationFn: (message: string) => api.sendCoach(message, toLocalDate()),
    onMutate: (message) => {
      setText('');
      const optimistic: CoachMessage = { id: `local-${Date.now()}`, role: 'user', content: message, suggestion: null, createdAt: new Date().toISOString() };
      queryClient.setQueryData<CoachMessage[]>(['coach'], (old = []) => [...old, optimistic]);
    },
    onSuccess: ({ user, reply }) => {
      haptics.success();
      queryClient.setQueryData<CoachMessage[]>(['coach'], (old = []) => [...old.filter((m) => !m.id.startsWith('local-')), user, reply]);
    },
    onError: () => {
      haptics.warning();
      void queryClient.invalidateQueries({ queryKey: ['coach'] });
    },
  });
  const clear = useMutation({
    mutationFn: () => api.clearCoach(),
    onSuccess: () => queryClient.setQueryData(['coach'], []),
  });

  const submit = (message: string) => {
    if (!message.trim() || send.isPending) return;
    haptics.tap();
    send.mutate(message.trim());
  };

  const list = [...(messages.data ?? [])].reverse();
  const empty = messages.data?.length === 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Row style={{ justifyContent: 'space-between', paddingTop: insets.top + Space.md, paddingHorizontal: Space.xl, paddingBottom: Space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="title">{t('coach.title')}</Txt>
          <Txt variant="caption" tone="secondary">
            {t('coach.subtitle')}
          </Txt>
        </View>
        {!empty ? <IconButton label={t('coach.clear')} icon={<Trash2 size={18} color={colors.text2} />} onPress={() => clear.mutate()} /> : null}
      </Row>

      {empty ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: Space.xl, gap: Space.xl }}>
          <View style={{ alignItems: 'center', gap: Space.md }}>
            <Logo size={56} />
            <Txt tone="secondary" style={{ textAlign: 'center', maxWidth: 300 }}>
              {t('coach.intro')}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, justifyContent: 'center' }}>
            {SUGGESTIONS.map((key) => (
              <Chip key={key} label={t(key)} onPress={() => submit(t(key))} />
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          data={list}
          inverted
          keyExtractor={(m) => m.id}
          keyboardDismissMode="interactive"
          contentContainerStyle={{ padding: Space.lg, gap: Space.md }}
          ListHeaderComponent={
            send.isPending ? (
              <Row gap={Space.sm} style={{ paddingVertical: Space.sm }}>
                <Logo size={22} breathe />
                <Txt variant="accent" tone="tertiary" style={{ fontSize: 16 }}>
                  {t('coach.thinking')}
                </Txt>
              </Row>
            ) : send.error ? (
              <Txt variant="caption" tone="warning">
                {errorMessage(send.error, t('common.error'), t('common.offline'))}
              </Txt>
            ) : undefined
          }
          renderItem={({ item }) => <Bubble message={item} />}
        />
      )}

      <View style={{ paddingHorizontal: Space.lg, paddingTop: Space.sm, paddingBottom: Platform.OS === 'web' ? 96 : Space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm, backgroundColor: colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: colors.border, padding: 6, paddingLeft: Space.lg }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('coach.placeholder')}
            placeholderTextColor={colors.text3}
            multiline
            style={{ flex: 1, minHeight: 44, maxHeight: 140, color: colors.text, fontSize: 16, paddingTop: 12, paddingBottom: 12 }}
          />
          <IconButton label={t('capture.send')} variant="inverted" icon={<ArrowUp size={20} color={colors.onInverted} />} onPress={() => submit(text)} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message }: { message: CoachMessage }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const mine = message.role === 'user';
  return (
    <Animated.View entering={FadeInUp.duration(220)} style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: Space.sm }}>
      <View
        style={{
          maxWidth: '86%',
          paddingHorizontal: Space.lg,
          paddingVertical: Space.md,
          borderRadius: Radius.lg,
          borderBottomRightRadius: mine ? 6 : Radius.lg,
          borderBottomLeftRadius: mine ? Radius.lg : 6,
          backgroundColor: mine ? colors.inverted : colors.surface,
          borderWidth: mine ? 0 : 1,
          borderColor: colors.border,
        }}>
        <Txt color={mine ? colors.onInverted : colors.text} style={{ lineHeight: 23 }} selectable>
          {message.content}
        </Txt>
      </View>
      {message.suggestion ? (
        <View style={{ maxWidth: '86%', backgroundColor: colors.accentSoft, borderRadius: Radius.lg, padding: Space.lg, gap: Space.sm }}>
          <Row gap={Space.sm}>
            <Sparkles size={16} color={colors.accent} />
            <Txt variant="label" tone="accent">
              {t('coach.suggestion')}
            </Txt>
          </Row>
          <Txt variant="caption" tone="secondary">
            {message.suggestion.rationale}
          </Txt>
          <Button title={t('coach.apply')} size="md" variant="accent" onPress={() => router.push({ pathname: '/goals', params: { intentions: message.suggestion!.intentions } })} />
        </View>
      ) : null}
    </Animated.View>
  );
}
