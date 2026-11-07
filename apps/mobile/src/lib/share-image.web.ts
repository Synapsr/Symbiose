import { PixelRatio } from 'react-native';
import type Svg from 'react-native-svg';

import { CARD } from '@/components/progress/share-card';

/** The size the card to capture is laid out at, as on the phone (a browser scales the drawing to the size asked anyway). */
export const CAPTURE = { width: CARD.width / PixelRatio.get(), height: CARD.height / PixelRatio.get() };

export function svgToPng(svg: Svg | null): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!svg) return reject(new Error('no_card'));
    const timer = setTimeout(() => reject(new Error('timeout')), 5000);
    svg.toDataURL(
      (base64) => {
        clearTimeout(timer);
        resolve(base64);
      },
      { width: CARD.width, height: CARD.height },
    );
  });
}

/** In a browser: the system share sheet when it takes files, else the image is downloaded. */
export async function shareCardImage(svg: Svg | null, options: { name: string; title: string; message: string }): Promise<void> {
  const base64 = await svgToPng(svg);
  const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
  const file = new window.File([blob], `${options.name}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text: options.message, title: options.title });
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
