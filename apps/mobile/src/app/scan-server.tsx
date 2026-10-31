import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { X } from 'lucide-react-native';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { useScannedServer } from '@/lib/stores';
import { Radius, Space } from '@/theme';

export default function ScanServer() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const setScanned = useScannedServer((s) => s.set);
  const done = useRef(false);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (done.current || !/^https?:\/\//i.test(data)) return;
            done.current = true;
            haptics.success();
            setScanned(data.trim());
            router.back();
          }}
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.xl, padding: Space.xxl }}>
          <Txt tone="inverted" style={{ textAlign: 'center', color: '#fff' }}>
            {t('scan.permission')}
          </Txt>
          <Button title={t('scan.allow')} variant="primary" onPress={requestPermission} />
        </View>
      )}

      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: 240, height: 240, borderRadius: Radius.xl, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' }} />
        <Txt variant="label" style={{ color: '#fff', marginTop: Space.xl, textAlign: 'center', paddingHorizontal: Space.xxl }}>
          {t('scan.title')}
        </Txt>
      </View>

      <IconButton
        label={t('common.close')}
        variant="glass"
        icon={<X size={22} color="#fff" />}
        onPress={() => router.back()}
        style={{ position: 'absolute', top: insets.top + Space.md, right: Space.lg }}
      />
    </View>
  );
}
