import * as WebBrowser from 'expo-web-browser';
import type { ReactNode } from 'react';
import { Platform, Text, View, type TextStyle } from 'react-native';

import { Txt, useFrenchSpacing } from '@/components/ui';
import { flatten, parseMarkdown, type Block, type ListItem, type Run } from '@/lib/markdown';
import { Space, useTheme, type Palette } from '@/theme';

/** The coach's voice: body size, airy lines. */
const BODY: TextStyle = { fontSize: 16, lineHeight: 23 };
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });
/** Room for a list's markers: what hangs to the left of its text. */
const BULLET_WIDTH = 18;
const NEST = 18;

function runStyle(run: Run, colors: Palette): TextStyle | null {
  if (!run.bold && !run.italic && !run.strike && !run.code && !run.href) return null;
  return {
    ...(run.bold ? { fontWeight: '600' } : null),
    ...(run.italic ? { fontStyle: 'italic' } : null),
    ...(run.strike ? { textDecorationLine: 'line-through' } : null),
    ...(run.code ? { fontFamily: MONO, fontSize: 14, backgroundColor: colors.surface2 } : null),
    ...(run.href ? { color: colors.accent } : null),
  };
}

/** A block's runs, as children of a Txt: plain strings, and nested text for the styled ones. */
function Runs({ runs }: { runs: Run[] }) {
  const { colors } = useTheme();
  return runs.map((run, index) => {
    const style = runStyle(run, colors);
    if (!style) return run.text;
    const href = run.href;
    return (
      <Text key={index} style={style} onPress={href ? () => void WebBrowser.openBrowserAsync(href) : undefined} accessibilityRole={href ? 'link' : undefined}>
        {run.text}
      </Text>
    );
  });
}

/**
 * AI prose with its light Markdown, in the app's own type: paragraphs, bold and italic, lists with
 * hanging indents, a modest heading. While it is being written (`streaming`), a half-typed marker
 * never shows, and `trailing` (the caret) sits at the end of the last line.
 */
export function Prose({ text, streaming = false, color, trailing, selectable }: { text: string; streaming?: boolean; color?: string; trailing?: ReactNode; selectable?: boolean }) {
  const { colors } = useTheme();
  const typography = useFrenchSpacing();
  const blocks = parseMarkdown(typography(text), { streaming });
  const ink = color ?? colors.text;
  const last = blocks.at(-1);
  const props = { color: ink, selectable };

  return (
    <View style={{ gap: 10 }}>
      {blocks.map((block, index) => (
        <ProseBlock key={index} block={block} trailing={block === last ? trailing : null} {...props} />
      ))}
      {/* Nothing to draw yet, or a rule last: the caret on its own. */}
      {trailing && (!last || last.type === 'rule') ? <View style={{ flexDirection: 'row' }}>{trailing}</View> : null}
    </View>
  );
}

function ProseBlock({ block, trailing, color, selectable }: { block: Block; trailing: ReactNode; color: string; selectable?: boolean }) {
  const { colors } = useTheme();
  switch (block.type) {
    case 'paragraph':
      return (
        <Txt color={color} style={BODY} selectable={selectable}>
          <Runs runs={block.runs} />
          {trailing}
        </Txt>
      );
    case 'heading':
      return (
        <Txt color={color} style={[BODY, { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 }]} selectable={selectable} accessibilityRole="header">
          <Runs runs={block.runs} />
          {trailing}
        </Txt>
      );
    case 'quote':
      return (
        <View style={{ borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: Space.md }}>
          <Txt color={colors.text2} style={BODY} selectable={selectable}>
            <Runs runs={block.runs} />
            {trailing}
          </Txt>
        </View>
      );
    case 'rule':
      return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: Space.xs }} />;
    case 'list': {
      // Numbers line up on the widest one.
      const widest = Math.max(0, ...block.items.map((item) => String(item.number ?? '').length));
      const markerWidth = widest ? 10 + widest * 9 : BULLET_WIDTH;
      return (
        <View style={{ gap: 6 }}>
          {block.items.map((item, index) => (
            <Item key={index} item={item} markerWidth={item.number === null ? BULLET_WIDTH : markerWidth} trailing={index === block.items.length - 1 ? trailing : null} color={color} selectable={selectable} />
          ))}
        </View>
      );
    }
  }
}

/** One list item: its marker hangs in its own column, so wrapped lines align with the first. */
function Item({ item, markerWidth, trailing, color, selectable }: { item: ListItem; markerWidth: number; trailing: ReactNode; color: string; selectable?: boolean }) {
  const { colors } = useTheme();
  const nested = item.depth > 0;
  return (
    <View style={{ flexDirection: 'row', paddingLeft: item.depth * NEST }}>
      <View style={{ width: markerWidth, height: BODY.lineHeight, justifyContent: 'center' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {item.number === null ? (
          <View style={{ width: nested ? 4 : 5, height: nested ? 4 : 5, borderRadius: 3, marginLeft: 3, backgroundColor: nested ? colors.text3 : colors.accent }} />
        ) : (
          <Txt color={nested ? colors.text2 : colors.accent} style={[BODY, { fontWeight: '600', fontVariant: ['tabular-nums'] }]}>
            {`${item.number}.`}
          </Txt>
        )}
      </View>
      <Txt color={color} style={[BODY, { flexShrink: 1 }]} selectable={selectable}>
        <Runs runs={item.runs} />
        {trailing}
      </Txt>
    </View>
  );
}

/**
 * A line or two of AI text inside a Txt (a tip, a headline): its bold and italic kept, block marks
 * dropped. For Fraunces text, where bold has no face, use `plainText` instead.
 */
export function InlineProse({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const typography = useFrenchSpacing();
  return <Runs runs={flatten(parseMarkdown(typography(text), { streaming }))} />;
}
