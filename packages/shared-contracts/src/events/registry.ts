import type { z } from 'zod';
import { academicEvents } from '../modules/academic';
import { marketingEvents } from '../modules/marketing';
import { opsEvents } from '../modules/ops';
import type { EventDefinition, EventEnvelope } from './define';
import { enrolmentEvents } from './enrolment';

/**
 * Every integration event Elevate OS knows about. Module teams extend it by
 * adding definitions to their own `src/modules/<module>.ts` file.
 */
export const EVENT_DEFINITIONS = [
  ...enrolmentEvents,
  ...marketingEvents,
  ...academicEvents,
  ...opsEvents,
] as const;

type AnyDefinition = (typeof EVENT_DEFINITIONS)[number];

export type EventType = AnyDefinition['type'];
export type EventVersion<T extends EventType> = Extract<AnyDefinition, { type: T }>['version'];
export type EventDefinitionFor<
  T extends EventType,
  V extends EventVersion<T> = EventVersion<T>,
> = Extract<AnyDefinition, { type: T; version: V }>;

/** Payload type of an event, e.g. `EventPayload<'ops.admission.enrolment_requested', 1>`. */
export type EventPayload<
  T extends EventType,
  V extends EventVersion<T> = EventVersion<T>,
> = z.output<EventDefinitionFor<T, V>['payload']>;

/** Envelope with a typed payload. */
export type IntegrationEvent<
  T extends EventType,
  V extends EventVersion<T> = EventVersion<T>,
> = Omit<EventEnvelope, 'type' | 'version' | 'payload'> & {
  type: T;
  version: V;
  payload: EventPayload<T, V>;
};

const byKey = new Map<string, EventDefinition>();
for (const definition of EVENT_DEFINITIONS as readonly EventDefinition[]) {
  const key = `${definition.type}@${definition.version}`;
  if (byKey.has(key)) throw new Error(`Duplicate event definition ${key}`);
  byKey.set(key, definition);
}

/** Look up a definition; undefined when unknown. */
export function findEventDefinition(type: string, version: number): EventDefinition | undefined {
  return byKey.get(`${type}@${version}`);
}

/** Look up a definition or throw — used by the outbox before storing or delivering an event. */
export function getEventDefinition(type: string, version: number): EventDefinition {
  const definition = findEventDefinition(type, version);
  if (!definition) throw new Error(`Unknown integration event ${type} v${version}`);
  return definition;
}

export function listEventDefinitions(): readonly EventDefinition[] {
  return [...byKey.values()];
}
