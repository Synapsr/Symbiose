import { Redirect, router } from 'expo-router';
import { ArchiveRestore, Server } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Pressy, Reveal, Row, Txt } from '@/components/ui';
import { Logo } from '@/components/ui/logo';
import { Wordmark } from '@/components/ui/wordmark';
import { useI18n } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import { useToast } from '@/lib/stores';
import { restoreBackupFromPicker } from '@/local/backup-actions';
import { localModeAvailable } from '@/local/transport';
import { Space, useTheme } from '@/theme';

/**
 * The first screen: one promise, one button. Symbiose starts on this phone,
 * nothing to install; a backup or a server are there for those who have one.
 */
export default function Welcome() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { startOnPhone } = useSession();
  const showToast = useToast((s) => s.show);
  const [busy, setBusy] = useState<'start' | 'restore' | null>(null);

  // The web build is a development tool: it always talks to a server.
  if (!localModeAvailable) return <Redirect href="/server" />;

  const start = async () => {
    setBusy('start');
    try {
      await startOnPhone();
      haptics.success();
    } catch {
      haptics.warning();
      showToast({ message: t('common.error') });
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy('restore');
    try {
      const restored = await restoreBackupFromPicker(t);
      if (restored) await startOnPhone();
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + Space.xxxl, paddingHorizontal: Space.xxl, gap: Space.xxl, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Reveal index={0}>
          <Row gap={Space.sm}>
            <Logo size={40} animated />
            <Wordmark height={34} />
          </Row>
        </Reveal>

        <View style={{ gap: Space.md, marginTop: Space.xl }}>
          <Reveal index={2}>
            <Txt variant="title" style={{ fontSize: 42, lineHeight: 46 }}>
              {t('welcome.tagline').split('\n')[0]}
            </Txt>
            <Txt variant="accent" tone="accent" style={{ fontSize: 42, lineHeight: 48 }}>
              {t('welcome.tagline').split('\n')[1]}
            </Txt>
          </Reveal>
          <Reveal index={4}>
            <Txt tone="secondary" style={{ fontSize: 17, lineHeight: 24 }}>
              {t('welcome.subtitle')}
            </Txt>
          </Reveal>
        </View>
      </ScrollView>

      {/* Where the thumb is. */}
      <Reveal index={6} style={{ paddingHorizontal: Space.xxl, paddingBottom: insets.bottom + Space.lg, gap: Space.md, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Button title={t('welcome.start')} onPress={() => void start()} loading={busy === 'start'} disabled={busy !== null} />
        <Txt variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
          {t('welcome.startNote')}
        </Txt>
        <Row style={{ justifyContent: 'center', gap: Space.lg, marginTop: Space.sm, flexWrap: 'wrap' }}>
          <Pressy onPress={() => void restore()} disabled={busy !== null} style={{ padding: Space.sm }} accessibilityRole="button">
            <Row gap={6}>
              <ArchiveRestore size={15} color={colors.text2} />
              <Txt variant="label" tone="secondary">
                {t('welcome.haveBackup')}
              </Txt>
            </Row>
          </Pressy>
          <Pressy onPress={() => router.push('/server')} disabled={busy !== null} style={{ padding: Space.sm }} accessibilityRole="button">
            <Row gap={6}>
              <Server size={15} color={colors.text2} />
              <Txt variant="label" tone="secondary">
                {t('welcome.haveServer')}
              </Txt>
            </Row>
          </Pressy>
        </Row>
      </Reveal>
    </View>
  );
}
