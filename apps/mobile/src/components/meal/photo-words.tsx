import { Keyboard, PenLine, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { IconButton, Pressy, Txt, webInput } from '@/components/ui';
import { MicButton } from '@/components/ui/mic-button';
import { useI18n } from '@/i18n';
import { useDictation, type Dictation } from '@/lib/dictation';
import { captionTail, DESCRIBE_HINTS } from '@/lib/photo-words-logic';
import { useSettings } from '@/lib/stores';
import { NIGHT, Radius, Space } from '@/theme';

const WHITE = '#FFFFFF';
const DIM = 'rgba(255,255,255,0.6)';
/** The camera's veil: the photo stays visible under the words. */
const VEIL = 'rgba(0,0,0,0.55)';
const LINE = 22;

/**
 * What the person says (or types) about the photo they are about to take:
 * « c'est du riz complet », « sans sucre », « j'en ai laissé la moitié ». It
 * goes with the photo to the AI, which takes it over what the photo suggests.
 */
export interface PhotoWords {
  text: string;
  dictation: Dictation;
  /** The caption is up: words being said, typed, or there. */
  open: boolean;
  typing: boolean;
  /** The mic beside the shutter: starts listening, or stops. */
  talk: () => void;
  type: () => void;
  doneTyping: () => void;
  write: (text: string) => void;
  clear: () => void;
  /** Stops listening (the gallery opens, another mode). */
  hush: () => void;
  /** The words as they stand right now, the last ones heard included. */
  latest: () => string;
}

/** Once used, the camera stops saying its mic is there. */
function learnt() {
  const settings = useSettings.getState();
  if (settings.describeHints < DESCRIBE_HINTS) settings.set({ describeHints: DESCRIBE_HINTS });
}

export function usePhotoWords(): PhotoWords {
  const [text, setText] = useState('');
  // The shot reads the words after the photo is prepared: by then the recogniser may have sent more.
  const current = useRef('');
  const write = (value: string) => {
    current.current = value;
    setText(value);
  };
  const dictation = useDictation(text, write);
  const [asked, setAsked] = useState(false);
  const [typing, setTyping] = useState(false);
  const empty = () => !current.current.trim();

  const hush = () => {
    if (dictation.listening) dictation.toggle();
  };
  const clear = () => {
    hush();
    write('');
    setAsked(false);
    setTyping(false);
  };

  return {
    text,
    dictation,
    open: asked || typing || Boolean(text.trim()),
    typing,
    talk: () => {
      learnt();
      if (dictation.listening) {
        dictation.toggle();
        // Tapped by mistake, nothing said: the caption goes as it came.
        if (empty()) setAsked(false);
        return;
      }
      setTyping(false);
      setAsked(true);
      dictation.toggle();
    },
    type: () => {
      learnt();
      hush();
      setAsked(true);
      setTyping(true);
    },
    doneTyping: () => {
      setTyping(false);
      if (empty()) clear();
    },
    write,
    clear,
    hush,
    latest: () => current.current.trim(),
  };
}

/** Beside the shutter: the mic, or a pen where the device can't listen. Mint once words go with the photo. */
export function DescribeButton({ words }: { words: PhotoWords }) {
  const { t } = useI18n();
  const tint = words.text.trim() ? NIGHT.accent : WHITE;
  if (!words.dictation.available) {
    return <IconButton label={t('photoWords.write')} variant="glass" size={52} icon={<PenLine size={22} color={tint} />} onPress={words.type} />;
  }
  return (
    <MicButton
      dictation={{ ...words.dictation, toggle: words.talk }}
      size={52}
      glyph={22}
      tint={tint}
      palette={NIGHT}
      label={t('photoWords.describe')}
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
    />
  );
}

/**
 * The words over the viewfinder, like live captions: they appear as they are
 * heard, and a tap on them opens the keyboard. While listening, the keyboard
 * glyph says typing works too; otherwise the cross takes them away.
 */
export function WordsCaption({ words }: { words: PhotoWords }) {
  const { t } = useI18n();
  if (!words.open) return null;
  const { text, typing, dictation } = words;
  const { listening } = dictation;
  const shown = captionTail(text);
  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOut.duration(160)}
      layout={LinearTransition.duration(220)}
      style={{
        alignSelf: typing ? 'stretch' : 'center',
        maxWidth: '100%',
        marginHorizontal: Space.lg,
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 44,
        borderRadius: Radius.lg,
        borderCurve: 'continuous',
        backgroundColor: VEIL,
        paddingLeft: Space.lg,
        paddingRight: 6,
      }}>
      {typing ? (
        <TextInput
          value={text}
          onChangeText={words.write}
          onBlur={words.doneTyping}
          placeholder={t('photoWords.example')}
          placeholderTextColor={DIM}
          autoFocus
          multiline
          maxLength={1000}
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          // React Native Web only knows the older prop.
          blurOnSubmit={Platform.OS === 'web' ? true : undefined}
          selectionColor={NIGHT.accent}
          style={[{ flex: 1, color: WHITE, fontSize: 17, lineHeight: LINE, paddingTop: 11, paddingBottom: 11, maxHeight: LINE * 3 + 22 }, webInput]}
        />
      ) : (
        <Pressy
          haptic={false}
          onPress={words.type}
          accessibilityRole="button"
          accessibilityLabel={text.trim() ? `${text.trim()}. ${t('photoWords.edit')}` : t('photoWords.example')}
          style={{ flexShrink: 1, paddingVertical: 11 }}>
          {/* A new key per state: the words cross-fade between « Je t'écoute… » and what was heard. */}
          <Animated.View key={shown ? 'words' : listening ? 'listening' : 'example'} entering={FadeIn.duration(180)}>
            <Txt numberOfLines={4} style={{ color: shown ? WHITE : DIM, fontSize: 17, lineHeight: LINE, fontWeight: '500' }}>
              {shown || (listening ? t('dictation.listening') : t('photoWords.example'))}
            </Txt>
          </Animated.View>
        </Pressy>
      )}
      <IconButton
        label={listening ? t('photoWords.type') : t('photoWords.clear')}
        variant="plain"
        size={32}
        icon={listening ? <Keyboard size={18} color={DIM} /> : <X size={18} color={DIM} />}
        onPress={listening ? words.type : words.clear}
        style={{ marginLeft: Space.sm }}
      />
    </Animated.View>
  );
}

/**
 * The first few times the camera opens, a quiet word above the mic: what it is
 * for, and that it's optional. Gone after a few seconds, and for good once used.
 */
export function DescribeHint({ side }: { side: 'left' | 'right' }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(() => useSettings.getState().describeHints < DESCRIBE_HINTS);
  useEffect(() => {
    if (!shown) return;
    const settings = useSettings.getState();
    settings.set({ describeHints: settings.describeHints + 1 });
    const timer = setTimeout(() => setShown(false), 5000);
    return () => clearTimeout(timer);
    // Counted once per visit, when it first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!shown) return null;
  // Over the mic's centre: the row's side padding plus half the button.
  const edge = Space.xxxl;
  const caret = 26 - 6;
  return (
    <Animated.View
      entering={FadeInDown.delay(600).duration(260)}
      exiting={FadeOut.duration(220)}
      pointerEvents="none"
      style={{ alignSelf: side === 'right' ? 'flex-end' : 'flex-start', marginHorizontal: edge, marginBottom: -Space.sm }}>
      <View style={{ backgroundColor: NIGHT.surface, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8 }}>
        <Txt variant="label" style={{ color: WHITE }}>
          {t('photoWords.hint')}
        </Txt>
      </View>
      <View
        style={[
          { position: 'absolute', bottom: -5, width: 12, height: 12, borderRadius: 2, backgroundColor: NIGHT.surface, transform: [{ rotate: '45deg' }] },
          side === 'right' ? { right: caret } : { left: caret },
        ]}
      />
    </Animated.View>
  );
}
