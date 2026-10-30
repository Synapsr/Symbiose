import { TabList, Tabs, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { BarChart3, MessageCircle, Sun, User } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { Radius, Space, useTheme } from '@/theme';

/** Web fallback for the native tab bar: a floating pill. */
export default function AppTabs() {
  const { t } = useI18n();
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <Bar>
          <TabTrigger name="index" href="/" asChild>
            <TabButton icon={Sun}>{t('common.today')}</TabButton>
          </TabTrigger>
          <TabTrigger name="insights" href="/insights" asChild>
            <TabButton icon={BarChart3}>{t('insights.title')}</TabButton>
          </TabTrigger>
          <TabTrigger name="coach" href="/coach" asChild>
            <TabButton icon={MessageCircle}>{t('coach.title')}</TabButton>
          </TabTrigger>
          <TabTrigger name="me" href="/me" asChild>
            <TabButton icon={User}>{t('me.title')}</TabButton>
          </TabTrigger>
        </Bar>
      </TabList>
    </Tabs>
  );
}

function Bar({ children, ...props }: { children?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View {...props} style={{ position: 'absolute', bottom: Space.lg, left: 0, right: 0, alignItems: 'center' }}>
      <View
        style={{
          flexDirection: 'row',
          gap: 4,
          padding: 6,
          borderRadius: Radius.pill,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
        }}>
        {children}
      </View>
    </View>
  );
}

function TabButton({ children, isFocused, icon: Icon, ref: _ref, ...props }: TabTriggerSlotProps & { icon: typeof Sun }) {
  const { colors } = useTheme();
  return (
    <Pressable
      {...props}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: Space.lg,
        height: 44,
        borderRadius: Radius.pill,
        backgroundColor: isFocused ? colors.inverted : 'transparent',
      }}>
      <Icon size={18} color={isFocused ? colors.onInverted : colors.text2} />
      {isFocused ? (
        <Txt variant="label" color={colors.onInverted}>
          {children}
        </Txt>
      ) : null}
    </Pressable>
  );
}
