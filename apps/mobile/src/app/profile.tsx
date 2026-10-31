import type { ActivityLevel, Sex } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityPicker, BodyFields, parseBody, SexPicker, type BodyValues } from '@/components/profile-fields';
import { Button, Field, IconButton, Row, Txt } from '@/components/ui';
import { KeyboardAvoiding } from '@/components/ui/keyboard-avoiding';
import { useI18n } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { dismiss } from '@/lib/nav';
import { useApi, useSetUser, useUser } from '@/lib/session';
import { Space, useTheme } from '@/theme';

/** Who I am: name, body and activity. The language lives with the other preferences in Me. */
export default function ProfileScreen() {
  const { t, locale } = useI18n();
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
  const [body, setBody] = useState<BodyValues>({ birthYear: String(profile.birthYear), heightCm: String(profile.heightCm), weightKg: formatNumber(profile.weightKg, locale, 1) });
  const parsed = parseBody(body);

  const save = useMutation({
    mutationFn: () => api.saveProfile({ ...profile, name: name.trim(), sex, activityLevel: activity, ...parsed! }),
    onSuccess: (saved) => {
      haptics.soft();
      setUser(saved);
      void queryClient.invalidateQueries({ queryKey: ['day'] });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      dismiss();
    },
    onError: () => haptics.warning(),
  });

  return (
    <KeyboardAvoiding style={{ flex: 1, backgroundColor: colors.bg }}>
      <Row style={{ justifyContent: 'space-between', padding: Space.lg, paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.lg }}>
        <Txt variant="heading">{t('me.editProfile')}</Txt>
        <Row gap={Space.sm}>
          {/* Saving sits at the top, where the keyboard never hides it. */}
          <Button title={t('common.save')} size="md" variant="primary" onPress={() => save.mutate()} loading={save.isPending} disabled={!parsed || !name.trim()} />
          <IconButton label={t('common.close')} icon={<X size={20} color={colors.text} />} onPress={() => dismiss()} />
        </Row>
      </Row>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: Space.xl, paddingTop: 0, gap: Space.xl, paddingBottom: insets.bottom + Space.xxxl, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        {save.error ? (
          <Txt variant="caption" tone="warning">
            {errorMessage(save.error, t('common.error'), t('common.offline'))}
          </Txt>
        ) : null}
        <Field label={t('welcome.name')} value={name} onChangeText={setName} />
        <BodyFields value={body} onChange={setBody} />
        <SexPicker value={sex} onChange={setSex} />
        <ActivityPicker value={activity} onChange={setActivity} />
      </ScrollView>
    </KeyboardAvoiding>
  );
}
