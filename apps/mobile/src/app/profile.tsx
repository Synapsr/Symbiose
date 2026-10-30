import type { ActivityLevel, Sex } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityPicker, BodyFields, parseBody, SexPicker, type BodyValues } from '@/components/profile-fields';
import { Button, Field, IconButton, Row, Segmented, Txt } from '@/components/ui';
import { dismiss } from '@/lib/nav';
import { useI18n } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { useApi, useSetUser, useUser } from '@/lib/session';
import { Space, useTheme } from '@/theme';

export default function ProfileScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const user = useUser();
  const setUser = useSetUser();
  const queryClient = useQueryClient();
  const profile = user.profile!;

  const [name, setName] = useState(profile.name);
  const [sex, setSex] = useState<Sex>(profile.sex);
  const [activity, setActivity] = useState<ActivityLevel>(profile.activityLevel);
  const [locale, setLocale] = useState(profile.locale);
  const [body, setBody] = useState<BodyValues>({ birthYear: String(profile.birthYear), heightCm: String(profile.heightCm), weightKg: String(profile.weightKg) });
  const parsed = parseBody(body);

  const save = useMutation({
    mutationFn: () => api.saveProfile({ ...profile, name: name.trim(), sex, activityLevel: activity, locale, ...parsed! }),
    onSuccess: (saved) => {
      haptics.success();
      setUser(saved);
      void queryClient.invalidateQueries({ queryKey: ['day'] });
      dismiss();
    },
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Row style={{ justifyContent: 'space-between', padding: Space.lg, paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.lg }}>
        <Txt variant="heading">{t('me.editProfile')}</Txt>
        <IconButton label={t('common.close')} icon={<X size={20} color={colors.text} />} onPress={() => dismiss()} />
      </Row>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: Space.xl, paddingTop: 0, gap: Space.xl, paddingBottom: insets.bottom + Space.xxxl, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <Field label={t('welcome.name')} value={name} onChangeText={setName} />
        <BodyFields value={body} onChange={setBody} />
        <SexPicker value={sex} onChange={setSex} />
        <ActivityPicker value={activity} onChange={setActivity} />
        <View style={{ gap: Space.sm }}>
          <Txt variant="caption" tone="secondary">
            Langue / Language
          </Txt>
          <Segmented value={locale} onChange={setLocale} options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]} />
        </View>
        {save.error ? (
          <Txt variant="caption" tone="warning">
            {errorMessage(save.error, t('common.error'), t('common.offline'))}
          </Txt>
        ) : null}
        <Button title={t('common.save')} onPress={() => save.mutate()} loading={save.isPending} disabled={!parsed || !name.trim()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
