import { router } from 'expo-router';
import { ChevronRight, NotebookTabs } from 'lucide-react-native';
import { View } from 'react-native';

import { Card, Pressy, Row, SectionTitle, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { Space, useTheme } from '@/theme';

/** The journal's place in Me: a row like the others, opening the Carnet. */
export function JournalLink() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <>
      <SectionTitle>{t('journal.title')}</SectionTitle>
      <Card padded={false} style={{ marginTop: -Space.sm }}>
        <Pressy onPress={() => router.push('/journal')} accessibilityRole="button" accessibilityLabel={t('journal.title')}>
          <Row gap={Space.lg} style={{ paddingHorizontal: Space.xl, paddingVertical: Space.lg, minHeight: 60 }}>
            <View style={{ width: 24, alignItems: 'center' }}>
              <NotebookTabs size={20} color={colors.text} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="label" style={{ fontSize: 16 }} numberOfLines={1}>
                {t('journal.seeAll')}
              </Txt>
              <Txt variant="caption" tone="secondary">
                {t('journal.meHint')}
              </Txt>
            </View>
            <ChevronRight size={18} color={colors.text3} />
          </Row>
        </Pressy>
      </Card>
    </>
  );
}
