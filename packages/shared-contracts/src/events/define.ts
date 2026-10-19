import { z } from 'zod';
import type { ModuleKey } from '@elevate/shared-types';
import { integrationEventIdSchema, isoDateTimeSchema, moduleKeySchema } from '../ids';

/**
 * Event type names are `<producer module>.<aggregate>.<past-tense verb>`,
 * lower snake case, e.g. `ops.admission.enrolment_requested`.
 */
export const EVENT_TYPE_RE =
  /^(platform|marketing|academic|ops)\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export interface EventDefinition<
  T extends string = string,
  V extends number = number,
  S extends z.ZodType = z.ZodType,
> {
  readonly type: T;
  readonly version: V;
  readonly producer: ModuleKey;
  readonly consumers: readonly ModuleKey[];
  readonly description: string;
  readonly payload: S;
}

/** Declare an integration event. The producer must match the type prefix. */
export function defineEvent<const T extends string, const V extends number, S extends z.ZodType>(
  definition: EventDefinition<T, V, S>,
): EventDefinition<T, V, S> {
  if (!EVENT_TYPE_RE.test(definition.type)) {
    throw new Error(`Event type "${definition.type}" must look like <module>.<aggregate>.<verb>`);
  }
  if (!definition.type.startsWith(`${definition.producer}.`)) {
    throw new Error(
      `Event type "${definition.type}" must start with its producer "${definition.producer}."`,
    );
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`Event "${definition.type}" version must be a positive integer`);
  }
  return definition;
}

/** Envelope stored in `core.integration_events` and handed to consumers. */
export const eventEnvelopeSchema = z.object({
  id: integrationEventIdSchema,
  type: z.string().regex(EVENT_TYPE_RE),
  version: z.int().min(1),
  occurredAt: isoDateTimeSchema,
  producer: moduleKeySchema,
  /**
   * Producer-chosen key that makes publishing idempotent: publishing twice with
   * the same (producer, idempotencyKey) stores one event.
   */
  idempotencyKey: z.string().min(1).max(200),
  /** Id of the first event in a conversation (e.g. the enrolment request). */
  correlationId: z.uuid().nullable(),
  /** Id of the event that directly caused this one. */
  causationId: z.uuid().nullable(),
  payload: z.unknown(),
});
export type EventEnvelope = z.output<typeof eventEnvelopeSchema>;
