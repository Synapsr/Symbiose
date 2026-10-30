import { Txt } from '@/components/ui';

/**
 * Today's one coach sentence, between the week and the hero. For now it says
 * where the day stands (`dayVoice`); the proactive coach takes this slot over
 * (`components/coach/coach-line.tsx`, `useProactiveLine()`), with this
 * sentence as its fallback, by swapping this import in `(tabs)/index.tsx`.
 */
export function CoachLine({ fallback }: { fallback: string }) {
  if (!fallback) return null;
  return (
    <Txt variant="accent" tone="secondary" style={{ fontSize: 18, lineHeight: 25, paddingHorizontal: 6 }}>
      {fallback}
    </Txt>
  );
}
