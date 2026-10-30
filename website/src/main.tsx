import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource-variable/instrument-sans/wght.css';
import './styles/base.css';

import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';

import { App } from './App';
import { initialLang, LangProvider } from './lang';

const container = document.getElementById('root')!;
const lang = initialLang();
const app = (
  <StrictMode>
    <LangProvider initial={lang}>
      <App />
    </LangProvider>
  </StrictMode>
);

// The HTML is prerendered in French: hydrate it, or render fresh for English.
if (lang === 'fr' && container.firstElementChild) {
  hydrateRoot(container, app);
} else {
  container.textContent = '';
  createRoot(container).render(app);
}
