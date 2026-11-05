import type { Locale } from '@symbiose/shared';

import { translate } from '@/i18n';

/**
 * What an API error says to the person, in their language: the server's own
 * messages are English and written for whoever hosts it. AI errors get a
 * sentence and, where it helps, what to do; on a phone without a server, the
 * key, the plan and the connection are the person's own.
 */
export function describeApiError(locale: Locale, local: boolean, error: { status: number; code: string }): string | null {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  if (error.status === 0 && local) return t('common.offlineLocal');
  switch (error.code) {
    case 'ai_disabled':
      return t(local ? 'error.ai_disabled' : 'error.ai_disabledServer');
    case 'ai_plan_limit':
      return t('error.ai_plan_limit');
    case 'ai_not_eligible':
      return t('error.ai_not_eligible');
    case 'ai_reconnect':
      return t('error.ai_reconnect');
    case 'ai_misconfigured':
      return t(local ? 'error.ai_misconfigured' : 'error.ai_misconfiguredServer');
    case 'ai_rate_limited':
      return t('error.ai_rate_limited');
    case 'ai_unreachable':
      return t('error.ai_unreachable');
    case 'ai_no_vision':
      return t('error.ai_no_vision');
    case 'ai_bad_output':
    case 'ai_bad_request':
    case 'ai_refused':
    case 'ai_error':
      return t('error.ai_failed');
    default:
      return null;
  }
}

let current: { locale: Locale; local: boolean } = { locale: 'fr', local: false };

/** Set by the app's root: the language, and whether the data lives on this phone. */
export function setErrorContext(locale: Locale, local: boolean): void {
  current = { locale, local };
}

/** The sentence for an API error in the current context, or null to keep the default. */
export function explainApiError(error: { status: number; code: string }): string | null {
  return describeApiError(current.locale, current.local, error);
}
