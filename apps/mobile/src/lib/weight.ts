import type { WeightPoint } from '@symbiose/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useI18n } from '@/i18n';

import { ApiError } from './api';
import { formatKg } from './format';
import { useToday } from './hooks';
import { useApi } from './session';
import { useToast } from './stores';
import { useHiddenIds, useUndoableDelete } from './undo';
import { WEIGHT_HISTORY_DAYS } from './weight-chart';

/** The id a weigh-in has while its deletion can still be undone. */
export const weightId = (date: string) => `weight:${date}`;

/**
 * Every weigh-in (up to two years), for the weight screen and its row in
 * Tendances: one request, every range drawn from it, the trend warmed up on
 * the readings before the range. Under « insights », so whatever refreshes
 * Tendances (a weigh-in, the health sync) refreshes it too. A weigh-in being
 * deleted is already left out.
 */
export function useWeightHistory() {
  const api = useApi();
  const today = useToday();
  const hidden = useHiddenIds();
  const query = useQuery({
    queryKey: ['insights', 'weights', today],
    queryFn: () => api.weights(WEIGHT_HISTORY_DAYS, today),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const points = query.data?.points.filter((p) => !hidden[weightId(p.date)]) ?? null;
  return { points, error: query.error, today };
}

/** A weigh-in leaves at once, back with « Annuler » (`useUndoableDelete`); an older server says it can't yet. */
export function useDeleteWeight() {
  const api = useApi();
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const remove = useUndoableDelete();
  const showToast = useToast((s) => s.show);
  return useCallback(
    (point: WeightPoint) =>
      remove({
        id: weightId(point.date),
        reusable: true,
        message: t('weight.deleted', { kg: formatKg(point.kg, locale) }),
        commit: async () => {
          try {
            await api.deleteWeight(point.date);
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) showToast({ message: t('weight.deleteUnsupported') });
            throw error;
          }
          await Promise.all([queryClient.invalidateQueries({ queryKey: ['insights'] }), queryClient.invalidateQueries({ queryKey: ['me'] })]);
        },
      }),
    [api, locale, queryClient, remove, showToast, t],
  );
}
