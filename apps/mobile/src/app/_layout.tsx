import { Fraunces_400Regular_Italic, Fraunces_600SemiBold, Fraunces_700Bold, useFonts } from '@expo-google-fonts/fraunces';
import type { Locale } from '@symbiose/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Arrival } from '@/components/arrival';
import { ToastHost } from '@/components/ui/toast';
import { deviceLocale, LocaleContext } from '@/i18n';
import { useSignedOutSync } from '@/lib/glance';
import { SessionProvider, useSession } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* The keyboard's position, frame by frame, for the screens with a composer. No preloading: Today has no field. */}
      <KeyboardProvider preload={false}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <AppNavigator />
            </SessionProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function AppNavigator() {
  const { ready, session, user, userLoading } = useSession();
  const settingsLoaded = useSettings((s) => s.loaded);
  const loadSettings = useSettings((s) => s.load);
  const [fontsLoaded, fontError] = useFonts({ Fraunces_400Regular_Italic, Fraunces_600SemiBold, Fraunces_700Bold });

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const booting = !ready || userLoading || !settingsLoaded || (!fontsLoaded && !fontError);
  useEffect(() => {
    if (!booting) void SplashScreen.hideAsync();
  }, [booting]);
  useSignedOutSync(ready && !session);

  return (
    <>
      {booting ? null : <App signedIn={Boolean(session && user)} onboarded={Boolean(user?.profile && user?.plan)} locale={user?.profile?.locale ?? deviceLocale()} />}
      {/* Above the app from the first frame: it takes over from the native splash. */}
      <Arrival ready={!booting} />
    </>
  );
}

function App({ signedIn, onboarded, locale }: { signedIn: boolean; onboarded: boolean; locale: Locale }) {
  const { scheme, colors } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <LocaleContext.Provider value={locale}>
      <ThemeProvider value={{ ...base, colors: { ...base.colors, background: colors.bg, card: colors.surface, text: colors.text, primary: colors.accent } }}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard={!signedIn} redirectTo={onboarded ? '/' : '/onboarding'}>
            <Stack.Screen name="welcome" />
            <Stack.Screen name="scan-server" options={{ presentation: 'modal' }} />
          </Stack.Protected>

          <Stack.Protected guard={signedIn && !onboarded} redirectTo={signedIn ? '/' : '/welcome'}>
            <Stack.Screen name="onboarding" />
          </Stack.Protected>

          <Stack.Protected guard={signedIn && onboarded} redirectTo={signedIn ? '/onboarding' : '/welcome'}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="capture" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
            <Stack.Screen name="meal/[id]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="goals" options={{ presentation: 'modal' }} />
            <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
            <Stack.Screen
              name="craving"
              options={{ presentation: 'formSheet', sheetAllowedDetents: [0.8, 1], sheetGrabberVisible: true, sheetCornerRadius: 28 }}
            />
            <Stack.Screen
              name="workout"
              options={{ presentation: 'formSheet', sheetAllowedDetents: [0.85, 1], sheetGrabberVisible: true, sheetCornerRadius: 28 }}
            />
            <Stack.Screen name="log" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.85, 1], sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
            <Stack.Screen name="journal" options={{ presentation: 'modal' }} />
            <Stack.Screen name="coach-settings" options={{ presentation: 'modal' }} />
            <Stack.Screen name="admin" options={{ presentation: 'modal' }} />
            <Stack.Screen name="note" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.9, 1], sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
          </Stack.Protected>
        </Stack>
        <ToastHost />
      </ThemeProvider>
    </LocaleContext.Provider>
  );
}
