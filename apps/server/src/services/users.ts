import { computeTargets, type EnergyBreakdown, type Targets, type User } from '@symbiose/shared';
import { and, eq } from 'drizzle-orm';

import type { UserContext } from '../ai/types';
import type { Db } from '../db';
import { activity, users, type UserRow } from '../db/schema';
import type { Config } from '../env';
import { HttpError, notFound } from '../errors';
import { isAdminEmail } from './admin';
import { adaptiveShiftOn } from './expenditure';
import { workoutsBetween, workoutsKcal } from './workouts';

/** The account as the app sees it; `isAdmin` comes from ADMIN_EMAILS, never from the stored flag. */
export function toUser(row: UserRow, config?: Pick<Config, 'adminEmails'>): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: config ? isAdminEmail(config, row.email) : false,
    profile: row.profile ?? null,
    plan: row.plan ?? null,
    createdAt: row.createdAt,
  };
}

export function getUserRow(db: Db, userId: string): UserRow {
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) throw notFound('User');
  return row;
}

/** The watch's daily total (which includes its workouts), else the energy of the logged workouts. */
export function activeKcalFor(db: Db, userId: string, localDate: string): number | null {
  const row = db
    .select({ activeKcal: activity.activeKcal })
    .from(activity)
    .where(and(eq(activity.userId, userId), eq(activity.localDate, localDate)))
    .get();
  return row?.activeKcal ?? workoutsKcal(workoutsBetween(db, userId, localDate, localDate));
}

export interface ResolvedUser {
  row: UserRow;
  targets: Targets | null;
  energy: EnergyBreakdown | null;
  context: UserContext;
}

/** The user with their targets for a given day (activity-adjusted and measured-expenditure-adjusted when enabled). */
export function resolveUser(db: Db, userId: string, localDate?: string): ResolvedUser {
  const row = getUserRow(db, userId);
  const profile = row.profile ?? null;
  const plan = row.plan ?? null;
  let targets: Targets | null = null;
  let energy: EnergyBreakdown | null = null;
  if (profile) {
    const activeKcal = localDate ? activeKcalFor(db, userId, localDate) : null;
    const adaptiveKcal = localDate ? adaptiveShiftOn(db, userId, profile, plan, localDate) : null;
    ({ targets, energy } = computeTargets(profile, plan, { activeKcal, adaptiveKcal }));
  }
  return {
    row,
    targets,
    energy,
    context: { locale: profile?.locale ?? 'fr', profile, plan, targets },
  };
}

export function requireProfile(resolved: ResolvedUser): asserts resolved is ResolvedUser & { targets: Targets; energy: EnergyBreakdown } {
  if (!resolved.targets || !resolved.row.profile) {
    throw new HttpError(409, 'profile_required', 'Complete your profile first');
  }
}
