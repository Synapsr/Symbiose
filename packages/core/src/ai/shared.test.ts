import { describe, expect, it } from 'vitest';

import { mealText } from './shared';
import { courseInput, mealInput } from './test-fixtures';

describe('the words sent with a meal', () => {
  it('are about the photo when there is one, the meal itself otherwise', () => {
    expect(mealText(mealInput)).toContain('About the photo: Pâtes carbonara et un coca');
    expect(mealText({ ...mealInput, photos: [] })).toContain('What I ate: Pâtes carbonara et un coca');
    expect(mealText(courseInput)).toContain('Next course: une tarte aux pommes');
    expect(mealText({ ...courseInput, photos: mealInput.photos })).toContain('Next course, about its photo: une tarte aux pommes');
  });

  it('ask for nothing more when there are none', () => {
    const text = mealText({ ...mealInput, text: null });
    expect(text).not.toContain('About the photo');
    expect(text.endsWith('Analyse this meal.')).toBe(true);
  });
});
