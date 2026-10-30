import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const MAX_SIDE = 1280;

/**
 * Shrinks a photo before upload: ~1280 px on the long side is plenty for the
 * vision model and keeps uploads around 150–300 KB.
 */
export async function preparePhoto(uri: string, width: number, height: number): Promise<{ uri: string; base64: string }> {
  const context = ImageManipulator.manipulate(uri);
  const longest = Math.max(width, height);
  if (longest > MAX_SIDE) {
    context.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.72, base64: true });
  if (!result.base64) throw new Error('Could not encode photo');
  return { uri: result.uri, base64: result.base64 };
}
