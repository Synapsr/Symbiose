import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { BuiltReport } from './build';

/** A4 in points: the print engine lays the report's 793 px pages out on it. */
const A4 = { width: 595, height: 842 } as const;

/**
 * Prints the report into a PDF on the phone, gives it a name that says what it
 * is, then opens the share sheet (Mail, Messages, Files, AirDrop…).
 */
export async function exportReport(report: BuiltReport, title: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: report.html, ...A4, margins: { top: 0, right: 0, bottom: 0, left: 0 } });
  const named = new File(Paths.cache, `${report.fileName}.pdf`);
  await new File(uri).move(named, { overwrite: true });
  if (!(await Sharing.isAvailableAsync())) throw new Error('no_sharing');
  await Sharing.shareAsync(named.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
}
