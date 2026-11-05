import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { Space, useTheme } from '@/theme';

/**
 * Development builds only: `symbiose://dev-check` runs the API in this engine
 * on a database of its own (src/local/dev-check.ts) and shows each check,
 * also in Metro's log. Production builds go home.
 */
export default function DevCheck() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Checks />;
}

function Checks() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [lines, setLines] = useState<string[]>(['dev-check: running…']);
  useEffect(() => {
    void import('@/local/dev-check').then(({ runDevCheck }) =>
      runDevCheck((line) => {
        console.log(`[dev-check] ${line}`);
        setLines((current) => [...current, line]);
      }),
    );
  }, []);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: Space.lg, paddingTop: insets.top + Space.lg, gap: Space.sm }}>
      {lines.map((line, i) => (
        <Txt key={i} variant="caption">
          {line}
        </Txt>
      ))}
    </ScrollView>
  );
}
