import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoachSettings } from '@/components/settings/coach-settings';
import { Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { Space, useTheme } from '@/theme';

/** The coach's settings, opened from the « ⋯ » of the Coach tab: the same card as in Me. */
export default function CoachSettingsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: Space.lg, paddingTop: Space.xxl, paddingBottom: insets.bottom + Space.xxl, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      <View style={{ paddingHorizontal: 4, marginBottom: Space.xl }}>
        <Txt variant="title">{t('coach.settings')}</Txt>
      </View>
      <CoachSettings />
    </ScrollView>
  );
}
