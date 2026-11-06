import { Fraunces_400Regular_Italic, Fraunces_600SemiBold, Fraunces_700Bold, useFonts } from '@expo-google-fonts/fraunces';
import type { Locale } from '@symbiose/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, Settings } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Arrival } from '@/components/arrival';
import { ToastHost } from '@/components/ui/toast';
import { deviceLocale, LocaleContext } from '@/i18n';
import { setErrorContext } from '@/lib/error-texts';
import { useSignedOutSync } from '@/lib/glance';
import { SessionProvider, useSession } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { useAiSettings } from '@/local/ai-settings';
import { isLocalUrl } from '@/local/constants';
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
  const { ready, session, user, userLoading, startOnPhone } = useSession();
  const settingsLoaded = useSettings((s) => s.loaded);
  const loadSettings = useSettings((s) => s.load);
  // The AI chosen on this phone (without a server): the onboarding and Today need it from the first frame.
  const aiLoaded = useAiSettings((s) => s.loaded);
  const loadAi = useAiSettings((s) => s.load);
  const [fontsLoaded, fontError] = useFonts({ Fraunces_400Regular_Italic, Fraunces_600SemiBold, Fraunces_700Bold });

  useEffect(() => {
    void loadSettings();
    void loadAi();
  }, [loadSettings, loadAi]);

  const booting = !ready || userLoading || !settingsLoaded || !aiLoaded || (!fontsLoaded && !fontError);
  useEffect(() => {
    if (!booting) void SplashScreen.hideAsync();
  }, [booting]);
  useSignedOutSync(ready && !session);
  // Development builds on iOS: `-symbioseDevStart 1` taps « Commencer » (Symbiose on this phone);
  // `-symbioseDevSeed 1` also fills a profile and a plan (keyword planner), straight to Today.
  const devApi = useSession().api;
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'ios' || !ready) return;
    if (!session && Settings.get('symbioseDevStart')) void startOnPhone();
    if (devApi?.local && user && !user.plan && Settings.get('symbioseDevSeed')) {
      void (async () => {
        await devApi.saveProfile({ name: 'Lou', sex: 'female', birthYear: 1992, heightCm: 168, weightKg: 63, activityLevel: 'moderate', locale: 'fr', timezone: 'Europe/Paris' });
        const draft = await devApi.draftGoals('Moins de sucre l’après-midi');
        if (draft.plan) await devApi.saveGoals(draft.plan);
        queryClient.setQueryData(['me', session?.serverUrl, session?.token], await devApi.me());
      })();
    }
  }, [ready, session, startOnPhone, devApi, user]);
  // Errors read in the person's language, and say « no connection » rather than « server unreachable » on a phone without one.
  const errorLocale = user?.profile?.locale ?? deviceLocale();
  const onPhone = isLocalUrl(session?.serverUrl);
  useEffect(() => setErrorContext(errorLocale, onPhone), [errorLocale, onPhone]);

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

  // Development builds on iOS, from launch arguments: `-symbioseDevCheck 1` opens the checks (src/app/dev-check.tsx),
  // `-symbioseDevOpen /ai-setup` a screen (screenshots without tapping through).
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'ios') return;
    if (Settings.get('symbioseDevCheck')) router.push('/dev-check');
    const open = Settings.get('symbioseDevOpen') as string | undefined;
    if (open) setTimeout(() => router.push(open as never), 600);
  }, []);

  return (
    <LocaleContext.Provider value={locale}>
      <ThemeProvider value={{ ...base, colors: { ...base.colors, background: colors.bg, card: colors.surface, text: colors.text, primary: colors.accent } }}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard={!signedIn} redirectTo={onboarded ? '/' : '/onboarding'}>
            <Stack.Screen name="welcome" />
          </Stack.Protected>

          {/* A server: from the welcome screen, or from Me to move this phone's data there. */}
          <Stack.Screen name="server" options={signedIn ? { presentation: 'modal' } : undefined} />
          <Stack.Screen name="scan-server" options={{ presentation: 'modal' }} />
          {/* Development builds: symbiose://dev-check runs the API on this phone and shows each check. */}
          <Stack.Screen name="dev-check" />

          {/* Choosing the AI: from the onboarding and from Me. */}
          <Stack.Protected guard={signedIn} redirectTo="/welcome">
            <Stack.Screen name="ai-setup" options={{ presentation: 'modal' }} />
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
            {/* « Ta progression », from the flame; a milestone, celebrated full screen or shown again from there. */}
            <Stack.Screen name="progress" options={{ presentation: 'modal' }} />
            <Stack.Screen name="milestone" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
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
