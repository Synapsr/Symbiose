import type { CravingOutcome } from '@symbiose/shared';

import type { useI18n } from '@/i18n';

export type Translate = ReturnType<typeof useI18n>['t'];

// The « surfer l'envie » Live Activity exists on iOS only (see live-activity.ios.ts).

export function startCravingActivity(_cravingId: string, _t: Translate) {}

export function endCravingActivity(_cravingId: string, _outcome: Exclude<CravingOutcome, 'pending'> | null) {}

export function useCravingActivitySync() {}
