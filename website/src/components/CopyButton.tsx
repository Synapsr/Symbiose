import { useEffect, useRef, useState } from 'react';

import { Check, Copy } from './Icons';

/** Copies `text`; the icon cross-fades copy → check (both icons stay mounted). */
export function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers or insecure contexts: fall back to a hidden textarea.
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button type="button" className="copy-btn" onClick={copy} data-copied={copied || undefined} aria-label={label}>
      <span className="swap-icon">
        <Copy size={18} className="swap-off" />
        <Check size={18} className="swap-on" />
      </span>
      <span className="copy-btn-text" aria-hidden="true">
        {copied ? done : label.split(' ')[0]}
      </span>
      <span className="sr-only" role="status">
        {copied ? done : ''}
      </span>
    </button>
  );
}
