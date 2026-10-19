# @elevate/shared-contracts

The language modules use to talk to each other. Everything here is a zod schema plus its inferred type, safe to import from server or client code.

| File | Contents | Owner |
|---|---|---|
| `src/errors.ts` | `ERROR_STATUS`, `AppError` + `ValidationError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `InvalidStateTransitionError`, `RateLimitedError`, `InternalError` | Foundation |
| `src/api.ts` | `ApiSuccess` / `ApiFailure` envelope (D-012), `apiSuccessSchema(data)`, `apiFailureSchema`, `HEADERS`, `paginationQuerySchema` | Foundation |
| `src/ids.ts` | zod ID schemas yielding branded IDs (`userIdSchema`, `leadIdSchema`, …), `isoDateSchema`, `isoDateTimeSchema`, `programmeCodeSchema`, `phoneSchema` | Foundation |
| `src/entities.ts` | `UserSummary`, `Department`, `StaffMember`, `Programme`, `LeadRef`, `StudentRef`, `CourseRef`, `BatchRef`, `TaskRef`, `Approval`, `AuditEvent` | Foundation |
| `src/events/define.ts` | `defineEvent()`, `eventEnvelopeSchema` (id, type, version, occurredAt, producer, idempotencyKey, correlationId, causationId, payload) | Foundation |
| `src/events/enrolment.ts` | The admission→enrolment handoff: `ops.admission.enrolment_requested` v1, `academic.enrolment.confirmed` v1, `academic.enrolment.rejected` v1, `enrolmentKeys` | Foundation (change via Integration) |
| `src/events/registry.ts` | `EVENT_DEFINITIONS`, `EventType`, `EventPayload<T,V>`, `IntegrationEvent<T,V>`, `getEventDefinition()` | Foundation |
| `src/summaries.ts` | `Metric` (`ok` / `estimated` / `missing` — missing ≠ zero), `metric.ok/estimated/missing`, `MarketingSummaryV1`, `AcademicDeliverySummaryV1`, `SourceResult<T>` | Foundation |
| `src/modules/marketing.ts` | Marketing events and shared shapes | **Marketing** |
| `src/modules/academic.ts` | Academic events and shared shapes | **Academic** |
| `src/modules/ops.ts` | Business Ops events and shared shapes | **Business Ops** |

## Adding an event (module teams)

In your own `src/modules/<module>.ts`:

```ts
import { z } from 'zod';
import { defineEvent } from '../events/define';
import { leadIdSchema } from '../ids';

export const leadQualifiedV1 = defineEvent({
  type: 'ops.lead.qualified',      // <producer>.<aggregate>.<past-tense verb>
  version: 1,
  producer: 'ops',
  consumers: ['marketing'],
  description: 'A lead was qualified by a counsellor.',
  payload: z.object({ leadId: leadIdSchema }).strict(),
});

export const opsEvents = [leadQualifiedV1] as const;
```

It is then known to the registry, `publishEvent()` validates payloads against it, and `EventPayload<'ops.lead.qualified', 1>` is typed. Breaking payload changes need a new version (keep v1 until consumers migrate).

See `INTEGRATION_CONTRACT.md` at the repo root for the full rules. Tests: `tests/contracts.test.ts`.
