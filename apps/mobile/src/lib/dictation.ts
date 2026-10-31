import { getLocales } from 'expo-localization';
import { ExpoSpeechRecognitionModule as recognizer, type ExpoSpeechRecognitionErrorCode } from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useSharedValue, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';

import { useI18n } from '@/i18n';

import { dictated, speechLocale } from './dictation-logic';
import { haptics } from './haptics';
import { useToast } from './stores';

/** Silence after the last words before dictation stops on its own, and the wait for the first ones. */
const SILENCE_MS = 3500;
const NOTHING_HEARD_MS = 8000;
/** How long a stopping recogniser gets to deliver its last words. */
const CLOSING_MS = 2000;

export interface Dictation {
  /** False where the device or browser has no speech recognition: no mic is shown. */
  available: boolean;
  listening: boolean;
  /** The voice's loudness, 0 to 1, for the mic's animation. */
  level: SharedValue<number>;
  toggle: () => void;
}

interface Session {
  /** The field's text when dictation began, and what dictation last wrote in it. */
  base: string;
  written: string;
  /** Finished stretches of speech. */
  segments: string[];
  started: boolean;
  failed: boolean;
  closing: boolean;
  /** The recogniser reports the voice's loudness (not on the web): otherwise each word heard makes the bars jump. */
  metered: boolean;
  /** Let go of: whatever the recogniser still sends is no longer for this field. */
  released: boolean;
  timer?: ReturnType<typeof setTimeout>;
  subscriptions: { remove: () => void }[];
}

let availability: boolean | undefined;
function isAvailable(): boolean {
  try {
    availability ??= recognizer.isRecognitionAvailable();
  } catch {
    availability = false;
  }
  return availability;
}

/** One field listens at a time: starting another hands the microphone over. */
let current: { session: Session; end: () => void } | null = null;

/** A field is listening: the microphone has the audio session, so feedback sounds stay quiet. */
export const isDictating = () => current !== null;

function release(session: Session) {
  session.released = true;
  clearTimeout(session.timer);
  for (const subscription of session.subscriptions) subscription.remove();
  if (current?.session === session) current = null;
}

/** On iOS, recognition stays on the phone when it can: only the microphone is asked for, and nothing leaves the device. */
async function allowed(onDevice: boolean): Promise<boolean> {
  if (Platform.OS === 'web') return true; // the browser asks when listening starts
  const permission = onDevice ? recognizer.requestMicrophonePermissionsAsync() : recognizer.requestPermissionsAsync();
  return (await permission).granted;
}

/**
 * Dictation into a text field: tap to talk, the words appear as they are
 * heard, after what is already there. It stops on a tap, after a pause, when
 * the person types or sends, or when the field goes away.
 */
export function useDictation(value: string, onChange: (text: string) => void): Dictation {
  const { t, locale } = useI18n();
  const showToast = useToast((s) => s.show);
  const [listening, setListening] = useState(false);
  const [available] = useState(isAvailable);
  const level = useSharedValue(0);
  const session = useRef<Session | null>(null);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });

  const quiet = () => {
    setListening(false);
    level.set(withTiming(0, { duration: 200 }));
  };
  const detach = (s: Session) => {
    release(s);
    if (session.current !== s) return;
    session.current = null;
    quiet();
  };
  // Lets go of the microphone at once; what was heard stays in the field.
  const end = (s: Session) => {
    if (s.released) return;
    detach(s);
    recognizer.abort();
  };
  // Ends gently: the last words still arrive, then the recogniser closes.
  const close = (s: Session) => {
    if (s.closing) return;
    s.closing = true;
    quiet();
    recognizer.stop();
    clearTimeout(s.timer);
    s.timer = setTimeout(() => end(s), CLOSING_MS);
  };

  const report = (error: ExpoSpeechRecognitionErrorCode) => {
    if (error === 'not-allowed') {
      showToast({ message: t('dictation.denied'), action: { label: t('dictation.settings'), onPress: () => void Linking.openSettings() } });
    } else if (error === 'network' || error === 'service-not-allowed' || error === 'language-not-supported') {
      showToast({ message: t('dictation.unavailable') });
    }
  };

  const start = async () => {
    current?.end();
    const onDevice = Platform.OS === 'ios' && recognizer.supportsOnDeviceRecognition();
    if (!(await allowed(onDevice))) {
      report('not-allowed');
      return;
    }
    const s: Session = { base: latest.current.value, written: latest.current.value, segments: [], started: false, failed: false, closing: false, metered: false, released: false, subscriptions: [] };
    const write = (partial: string) => {
      const text = dictated(s.base, s.segments, partial);
      if (text === s.written) return;
      s.written = text;
      latest.current.onChange(text);
    };
    const stopAfter = (ms: number) => {
      clearTimeout(s.timer);
      s.timer = setTimeout(() => close(s), ms);
    };
    // The web recogniser keeps calling removed listeners for its current run: each one checks.
    s.subscriptions.push(
      recognizer.addListener('start', () => {
        if (s.released) return;
        s.started = true;
        stopAfter(NOTHING_HEARD_MS);
      }),
      recognizer.addListener('result', (event) => {
        if (s.released) return;
        const transcript = event.results[0]?.transcript ?? '';
        if (event.isFinal) s.segments.push(transcript);
        write(event.isFinal ? '' : transcript);
        if (!s.closing) stopAfter(SILENCE_MS);
        if (!s.metered && !s.closing) level.set(withSequence(withTiming(0.9, { duration: 120 }), withTiming(0.15, { duration: 700 })));
      }),
      recognizer.addListener('volumechange', (event) => {
        if (s.released) return;
        s.metered = true;
        level.set(withTiming(Math.min(Math.max(event.value, 0) / 8, 1), { duration: 110 }));
      }),
      recognizer.addListener('error', (event) => {
        // A field that handed the microphone over is aborted: not this session's concern.
        if (s.released || event.error === 'aborted') return;
        s.failed = true;
        report(event.error);
      }),
      // The previous field's session may still be closing: only this one's end counts.
      recognizer.addListener('end', () => {
        if (!s.released && (s.started || s.failed)) detach(s);
      }),
    );
    session.current = s;
    current = { session: s, end: () => end(s) };
    setListening(true);
    haptics.soft();
    try {
      recognizer.start({
        lang: speechLocale(locale, getLocales().map((l) => l.languageTag)),
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        requiresOnDeviceRecognition: onDevice,
        iosTaskHint: 'dictation',
        volumeChangeEventOptions: { enabled: true, intervalMillis: 90 },
      });
    } catch {
      detach(s);
      report('service-not-allowed');
    }
  };

  // The person typed, cleared or sent the text: dictation steps aside.
  useEffect(() => {
    const s = session.current;
    if (s && value !== s.written) end(s);
  });

  useEffect(
    () => () => {
      const s = session.current;
      if (!s) return;
      release(s);
      recognizer.abort();
    },
    [],
  );

  return {
    available,
    listening,
    level,
    toggle: () => {
      const s = session.current;
      if (s && listening) {
        haptics.tap();
        close(s);
      } else {
        void start();
      }
    },
  };
}
