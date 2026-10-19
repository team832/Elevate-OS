/**
 * HR lifecycle metrics for the HR dashboard (OPS-049): recruitment pipeline by
 * stage, open requisitions, onboarding completion, pending offboarding work and
 * separations in a window. Every value is `metric.ok` or `metric.missing`
 * (missing is never zero): a user without HR-wide (`all`) scope gets missing
 * values with the reason, and a rate with no denominator is missing.
 * KPI definitions: docs/parts/hr-lifecycle.md → KPIs.
 */
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
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
import { isResolved, type ItemStatus } from '../../domain/hr/lifecycle';
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
  const recruitmentAll = scopeFor(actor, 'ops:recruitment:read') === 'all';
  const lifecycleAll = scopeFor(actor, 'ops:lifecycle:read') === 'all';
  const noRecruitment = 'Needs organisation-wide recruitment read access.';
  const noLifecycle = 'Needs organisation-wide lifecycle read access.';

  const count = (value: number, definition: string, w: Win = snapshot) =>
    metric.ok(value, { definition, window: w, unit: 'count' });
  const missing = (
    reason: string,
    definition: string,
    unit: Metric['unit'] = 'count',
    w: Win = snapshot,
  ) => metric.missing(reason, { definition, window: w, unit });

  // --- recruitment ---
  const stageDef = (s: ApplicationStage) => `Applications currently at stage "${s}".`;
  let pipeline: Record<ApplicationStage, Metric>;
  let openRequisitions: Metric;
  let unfilledOpenings: Metric;
  if (recruitmentAll) {
    const apps = await db
      .select({ stage: opsJobApplications.stage, requisitionId: opsJobApplications.requisitionId })
      .from(opsJobApplications);
    const counts = pipelineByStage(apps.map((a) => a.stage as ApplicationStage));
    pipeline = Object.fromEntries(
      APPLICATION_STAGES.map((s) => [s, count(counts[s], stageDef(s))]),
    ) as Record<ApplicationStage, Metric>;
    const open = await db
      .select({ id: opsRequisitions.id, openings: opsRequisitions.openings })
      .from(opsRequisitions)
      .where(eq(opsRequisitions.status, 'open'));
    openRequisitions = count(open.length, 'Requisitions with status "open".');
    const hiredByReq = new Map<string, number>();
    for (const a of apps)
      if (a.stage === 'hired')
        hiredByReq.set(a.requisitionId, (hiredByReq.get(a.requisitionId) ?? 0) + 1);
    unfilledOpenings = count(
      open.reduce((sum, r) => sum + Math.max(0, r.openings - (hiredByReq.get(r.id) ?? 0)), 0),
      'Openings on open requisitions minus hires recorded against them.',
    );
  } else {
    pipeline = Object.fromEntries(
      APPLICATION_STAGES.map((s) => [s, missing(noRecruitment, stageDef(s))]),
    ) as Record<ApplicationStage, Metric>;
    openRequisitions = missing(noRecruitment, 'Requisitions with status "open".');
    unfilledOpenings = missing(
      noRecruitment,
      'Openings on open requisitions minus hires recorded against them.',
    );
  }

  // --- lifecycle ---
  const rateDef =
    'Required checklist items resolved (done or not applicable) across open onboarding cases.';
  const pendingDef = 'Unresolved checklist items on open or approved offboarding cases.';
  const sepDef = 'Employees separated (separation applied) in the window, IST days.';
  if (!lifecycleAll)
    return {
      window,
      pipelineByStage: pipeline,
      openRequisitions,
      unfilledOpenings,
      onboardingCompletionRate: missing(noLifecycle, rateDef, 'percent'),
      openOnboardingCases: missing(noLifecycle, 'Onboarding cases with status "open".'),
      pendingOffboardingItems: missing(noLifecycle, pendingDef),
      separationsInWindow: missing(noLifecycle, sepDef, 'count', window),
    };

  const openOnboarding = await db
    .select({ id: opsLifecycleCases.id })
    .from(opsLifecycleCases)
    .where(and(eq(opsLifecycleCases.kind, 'onboarding'), eq(opsLifecycleCases.status, 'open')));
  const onboardingItems = openOnboarding.length
    ? await db
        .select({ status: opsLifecycleItems.status })
        .from(opsLifecycleItems)
        .where(
          and(
            inArray(
              opsLifecycleItems.caseId,
              openOnboarding.map((c) => c.id),
            ),
            eq(opsLifecycleItems.required, true),
          ),
        )
    : [];
  const onboardingCompletionRate =
    onboardingItems.length === 0
      ? missing(
          openOnboarding.length === 0
            ? 'No open onboarding cases.'
            : 'Open cases have no required items.',
          rateDef,
          'percent',
        )
      : metric.ok(
          Math.round(
            (onboardingItems.filter((i) => isResolved(i.status as ItemStatus)).length /
              onboardingItems.length) *
              1000,
          ) / 10,
          { definition: rateDef, window: snapshot, unit: 'percent' },
        );
  const liveOffboarding = await db
    .select({ id: opsLifecycleCases.id })
    .from(opsLifecycleCases)
    .where(
      and(
        eq(opsLifecycleCases.kind, 'offboarding'),
        inArray(opsLifecycleCases.status, ['open', 'approved']),
      ),
    );
  const offItems = liveOffboarding.length
    ? await db
        .select({ status: opsLifecycleItems.status })
        .from(opsLifecycleItems)
        .where(
          inArray(
            opsLifecycleItems.caseId,
            liveOffboarding.map((c) => c.id),
          ),
        )
    : [];
  const separated = await db
    .select({ id: opsLifecycleCases.id })
    .from(opsLifecycleCases)
    .where(
      and(
        eq(opsLifecycleCases.kind, 'offboarding'),
        gte(opsLifecycleCases.separatedAt, istStart(from)),
        lte(opsLifecycleCases.separatedAt, istStart(addDays(to, 1))),
      ),
    );
  return {
    window,
    pipelineByStage: pipeline,
    openRequisitions,
    unfilledOpenings,
    onboardingCompletionRate,
    openOnboardingCases: count(openOnboarding.length, 'Onboarding cases with status "open".'),
    pendingOffboardingItems: count(
      offItems.filter((i) => !isResolved(i.status as ItemStatus)).length,
      pendingDef,
    ),
    separationsInWindow: count(separated.length, sepDef, window),
  };
}
