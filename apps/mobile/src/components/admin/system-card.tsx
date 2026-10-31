import type { AdminOverview } from '@symbiose/shared';
import { View } from 'react-native';

import { formatBytes, formatShortDate, formatUptime } from '@/components/admin/format';
import { CardTitle, Line } from '@/components/admin/parts';
import { Card, Dot } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { LIFE_COLORS, Space, useTheme } from '@/theme';

/** The server's health in a few lines: version, AI, sign-up, storage, backups. */
export function SystemCard({ system }: { system: AdminOverview['system'] }) {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const ai = system.ai.enabled ? [system.ai.model, system.ai.provider].filter(Boolean).join(' · ') : t('admin.aiOff');

  return (
    <Card style={{ gap: Space.sm, paddingBottom: Space.md }}>
      <CardTitle color={LIFE_COLORS.sleep} label={t('admin.system')} />
      <View>
        <Line first label={t('admin.version')} value={t('admin.versionValue', { version: system.version, uptime: formatUptime(system.uptimeSeconds, locale) })} />
        <Line label={t('admin.aiLine')} value={ai} icon={<Dot color={system.ai.enabled ? colors.accent : colors.text3} size={7} />} />
        <Line label={t('admin.signup')} value={t(`admin.signup.${system.signup}`)} />
        <Line label={t('admin.database')} value={formatBytes(system.dbBytes, locale)} />
        <Line label={t('admin.photos')} value={system.photos ? `${formatNumber(system.photos, locale)} · ${formatBytes(system.photosBytes, locale)}` : t('admin.photosNone')} />
        <Line
          label={t('admin.backups')}
          value={system.backups.lastAt ? `${plural('admin.backupCount', system.backups.count)} · ${formatShortDate(system.backups.lastAt, locale)}` : t('admin.backupsNone')}
        />
      </View>
    </Card>
  );
}
