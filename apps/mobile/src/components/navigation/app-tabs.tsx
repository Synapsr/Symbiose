import { NativeTabs } from 'expo-router/native-tabs';

import { useI18n } from '@/i18n';
import { useTheme } from '@/theme';

/** Native tab bar: Liquid Glass on iOS 26, Material on Android. */
export default function AppTabs() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <NativeTabs tintColor={colors.text} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'sun.max', selected: 'sun.max.fill' }} md="today" />
        <NativeTabs.Trigger.Label>{t('common.today')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="insights">
        <NativeTabs.Trigger.Icon sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }} md="insights" />
        <NativeTabs.Trigger.Label>{t('insights.title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="coach">
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left', selected: 'bubble.left.fill' }} md="chat" />
        <NativeTabs.Trigger.Label>{t('coach.title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="me">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="person" />
        <NativeTabs.Trigger.Label>{t('me.title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
