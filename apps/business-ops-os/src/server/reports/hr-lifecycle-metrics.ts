/**
 * HR lifecycle metrics for the HR dashboard (OPS-049): recruitment pipeline by
 * stage, open requisitions, onboarding completion, pending offboarding work and
 * separations in a window. Every value is `metric.ok` or `metric.missing`
 * (missing is never zero): a user without HR-wide (`all`) scope gets missing
 * values with the reason, and a rate with no denominator is missing.
 * KPI definitions: docs/parts/hr-lifecycle.md → KPIs.
 */
import { and, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { scopeFor } from '@elevate/authorization';
import {
  opsJobApplications,
  opsLifecycleCases,
  opsLifecycleItems,
  opsRequisitions,
  type Database,
} from '@elevate/database';
import { metric, type Metric } from '@elevate/shared-contracts';
import { addDays, istToday, type IsoDate } from '../../domain/dates';
import { isResolved } from '../../domain/hr/lifecycle';
import {
  APPLICATION_STAGES,
  pipelineByStage,
  type ApplicationStage,
} from '../../domain/hr/recruitment';
import type { Actor } from '../context';

export interface HrLifecycleMetrics {
  window: { from: IsoDate; to: IsoDate };
  pipelineByStage: Record<ApplicationStage, Metric>;
  openRequisitions: Metric;
  unfilledOpenings: Metric;
  onboardingCompletionRate: Metric;
  openOnboardingCases: Metric;
  pendingOffboardingItems: Metric;
  separationsInWindow: Metric;
}

const DEF = {
  stage: (s: ApplicationStage) => `Applications currently at stage "${s}".`,
  openRequisitions: 'Requisitions with status "open".',
  unfilled: 'Openings on open requisitions minus hires recorded against them.',
  rate: 'Required checklist items resolved (done or not applicable) across open onboarding cases.',
  openOnboarding: 'Onboarding cases with status "open".',
  pending: 'Unresolved checklist items on open or approved offboarding cases.',
  separations: 'Employees separated (separation applied) in the window, IST days.',
};

/** Instant at the start of an IST calendar day. */
function istStart(day: IsoDate): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

export async function hrLifecycleMetrics(
  db: Database,
  actor: Actor,
  options: { from?: IsoDate; to?: IsoDate; now?: Date } = {},
): Promise<HrLifecycleMetrics> {
  const today = istToday(options.now ?? new Date());
  const to = options.to ?? today;
  const from = options.from ?? addDays(to, -29);
  const window = { from, to };
  type Win = { from: IsoDate; to: IsoDate; label?: string };
  const snapshot: Win = { from: today, to: today, label: 'Now' };

  const count = (value: number, definition: string, w: Win = snapshot) =>
    metric.ok(value, { definition, window: w, unit: 'count' });
  const missing = (
    reason: string,
    definition: string,
    unit: Metric['unit'] = 'count',
    w: Win = snapshot,
  ) => metric.missing(reason, { definition, window: w, unit });
  const perStage = (f: (s: ApplicationStage) => Metric) =>
    Object.fromEntries(APPLICATION_STAGES.map((s) => [s, f(s)])) as Record<
      ApplicationStage,
      Metric
    >;

  // --- recruitment ---
  const noRecruitment = 'Needs organisation-wide recruitment read access.';
  let recruitment: Pick<
    HrLifecycleMetrics,
    'pipelineByStage' | 'openRequisitions' | 'unfilledOpenings'
  > = {
    pipelineByStage: perStage((s) => missing(noRecruitment, DEF.stage(s))),
    openRequisitions: missing(noRecruitment, DEF.openRequisitions),
    unfilledOpenings: missing(noRecruitment, DEF.unfilled),
  };
  if (scopeFor(actor, 'ops:recruitment:read') === 'all') {
    const apps = await db
      .select({ stage: opsJobApplications.stage, requisitionId: opsJobApplications.requisitionId })
      .from(opsJobApplications);
    const counts = pipelineByStage(apps.map((a) => a.stage));
    const open = await db
      .select({ id: opsRequisitions.id, openings: opsRequisitions.openings })
      .from(opsRequisitions)
      .where(eq(opsRequisitions.status, 'open'));
    const hired = (id: string) =>
      apps.filter((a) => a.stage === 'hired' && a.requisitionId === id).length;
    recruitment = {
      pipelineByStage: perStage((s) => count(counts[s], DEF.stage(s))),
      openRequisitions: count(open.length, DEF.openRequisitions),
      unfilledOpenings: count(
        open.reduce((sum, r) => sum + Math.max(0, r.openings - hired(r.id)), 0),
        DEF.unfilled,
      ),
    };
  }

  // --- lifecycle ---
  if (scopeFor(actor, 'ops:lifecycle:read') !== 'all') {
    const noLifecycle = 'Needs organisation-wide lifecycle read access.';
    return {
      window,
      ...recruitment,
      onboardingCompletionRate: missing(noLifecycle, DEF.rate, 'percent'),
      openOnboardingCases: missing(noLifecycle, DEF.openOnboarding),
      pendingOffboardingItems: missing(noLifecycle, DEF.pending),
      separationsInWindow: missing(noLifecycle, DEF.separations, 'count', window),
    };
  }
  const cases = (where: SQL | undefined) =>
    db.select({ id: opsLifecycleCases.id }).from(opsLifecycleCases).where(where);
  const itemsOf = async (caseIds: string[], requiredOnly: boolean) =>
    caseIds.length
      ? db
          .select({ status: opsLifecycleItems.status })
          .from(opsLifecycleItems)
          .where(
            and(
              inArray(opsLifecycleItems.caseId, caseIds as never),
              requiredOnly ? eq(opsLifecycleItems.required, true) : undefined,
            ),
          )
      : [];
  const openOnboarding = await cases(
    and(eq(opsLifecycleCases.kind, 'onboarding'), eq(opsLifecycleCases.status, 'open')),
  );
  const onboardingItems = await itemsOf(
    openOnboarding.map((c) => c.id),
    true,
  );
  const offItems = await itemsOf(
    (
      await cases(
        and(
          eq(opsLifecycleCases.kind, 'offboarding'),
          inArray(opsLifecycleCases.status, ['open', 'approved']),
        ),
      )
    ).map((c) => c.id),
    false,
  );
  const separated = await cases(
    and(
      eq(opsLifecycleCases.kind, 'offboarding'),
      gte(opsLifecycleCases.separatedAt, istStart(from)),
      lte(opsLifecycleCases.separatedAt, istStart(addDays(to, 1))),
    ),
  );
  const resolved = onboardingItems.filter((i) => isResolved(i.status)).length;
  return {
    window,
    ...recruitment,
    onboardingCompletionRate:
      onboardingItems.length === 0
        ? missing(
            openOnboarding.length === 0
              ? 'No open onboarding cases.'
              : 'Open cases have no required items.',
            DEF.rate,
            'percent',
          )
        : metric.ok(Math.round((resolved / onboardingItems.length) * 1000) / 10, {
            definition: DEF.rate,
            window: snapshot,
            unit: 'percent',
          }),
    openOnboardingCases: count(openOnboarding.length, DEF.openOnboarding),
    pendingOffboardingItems: count(
      offItems.filter((i) => !isResolved(i.status)).length,
      DEF.pending,
    ),
    separationsInWindow: count(separated.length, DEF.separations, window),
  };
}
