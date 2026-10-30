import type { CSSProperties } from 'react';

import { screenSrc, type ScreenName, type Theme } from '../screens';

type PhoneProps = {
  screen: ScreenName | ScreenName[];
  alt: string;
  /** `auto` follows the site theme (both files rendered, CSS shows one). */
  theme?: Theme | 'auto';
  priority?: boolean;
  /** Load at once without raising the fetch priority. */
  eager?: boolean;
  crop?: boolean;
  width?: string;
  className?: string;
  style?: CSSProperties;
};

/** An app screenshot in a phone frame. Renders nothing if no screenshot exists. */
export function Phone({ screen, alt, theme = 'auto', priority = false, eager = false, crop = false, width, className = '', style }: PhoneProps) {
  const light = screenSrc(screen, theme === 'dark' ? 'dark' : 'light');
  const dark = screenSrc(screen, theme === 'light' ? 'light' : 'dark');
  if (!light || !dark) return null;

  const img = (src: string, extra = '') => (
    <img
      key={src + extra}
      className={extra || undefined}
      src={src}
      alt={alt}
      width={390}
      height={844}
      loading={priority || eager ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : undefined}
      draggable={false}
    />
  );

  return (
    <div
      className={`phone${crop ? ' phone--crop' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...(width ? ({ '--w': width } as CSSProperties) : null), ...style }}>
      <div className="phone-screen">
        {theme === 'auto' && light !== dark ? [img(light, 'only-light'), img(dark, 'only-dark')] : img(theme === 'dark' ? dark : light)}
      </div>
    </div>
  );
}
