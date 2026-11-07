import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { PixelRatio, Platform } from 'react-native';
import type Svg from 'react-native-svg';

import { CARD } from '@/components/progress/share-card';

/**
 * The size, in points, the card to capture is laid out at: the PNG's pixels
 * over the screen's density. On iOS, react-native-svg draws the view at its
 * own size whatever size is asked, in the top-left corner of the bitmap (the
 * rest left transparent, which a share sheet shows black), and the bitmap
 * takes the screen's density: so the card is laid out at exactly this size and
 * asked at it. Android scales the drawing to the size asked, in pixels.
 */
export const CAPTURE = { width: CARD.width / PixelRatio.get(), height: CARD.height / PixelRatio.get() };

/** The card as a 1080 × 1350 PNG: `svg` must be a `ShareCard` laid out at `CAPTURE`. */
export function svgToPng(svg: Svg | null): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!svg) return reject(new Error('no_card'));
    const timer = setTimeout(() => reject(new Error('timeout')), 5000);
    svg.toDataURL(
      (base64) => {
        clearTimeout(timer);
        resolve(base64);
      },
      Platform.OS === 'ios' ? CAPTURE : { width: CARD.width, height: CARD.height },
    );
  });
}

/**
 * Opens the share sheet with the card as an image (Messages, Instagram, Save
 * Image…). Throws when it can't: the caller then shares the words alone.
 */
export async function shareCardImage(svg: Svg | null, options: { name: string; title: string; message: string }): Promise<void> {
  const base64 = await svgToPng(svg);
  const file = new File(Paths.cache, `${options.name}.png`);
  if (file.exists) file.delete();
  await file.write(base64, { encoding: 'base64' });
  if (!(await Sharing.isAvailableAsync())) throw new Error('no_sharing');
  await Sharing.shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: options.title });
}
