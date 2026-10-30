import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import { App } from './App';
import type { Lang } from './i18n';
import { LangProvider } from './lang';

/** Used at build time by scripts/prerender.mjs to inline the page's HTML. */
export function render(lang: Lang = 'fr'): string {
  return renderToString(
    <StrictMode>
      <LangProvider initial={lang}>
        <App />
      </LangProvider>
    </StrictMode>,
  );
}
