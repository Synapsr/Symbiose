import type { BuiltReport } from './build';

/**
 * In a browser: the report in an invisible frame, and the browser's print
 * dialog, where « Enregistrer au format PDF » saves it. The frame's title
 * becomes the file's name.
 */
export async function exportReport(report: BuiltReport, _title: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const view = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!view || !doc) {
    frame.remove();
    throw new Error('no_frame');
  }
  doc.open();
  doc.write(report.html.replace(/<title>[^<]*<\/title>/, `<title>${report.fileName}</title>`));
  doc.close();
  // Let the frame lay its pages out before printing.
  await new Promise((resolve) => setTimeout(resolve, 150));
  view.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 1000), { once: true });
  view.focus();
  view.print();
}
