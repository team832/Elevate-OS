/** Requests through HR (owner brief 23 Oct 2026 §6): lifecycle, who acts, what each viewer sees. */
import { describe, expect, it } from 'vitest';
import {
  OPS_HR_REQUEST_RELATED_KINDS,
  OPS_HR_REQUEST_STATUSES,
  OPS_HR_REQUEST_URGENCIES,
} from '@elevate/database';
import {
  decideHrRequest,
  eventsFor,
  HR_REQUEST_ACTIONS,
  HR_REQUEST_RELATED_KINDS,
  HR_REQUEST_STATUSES,
  HR_REQUEST_URGENCIES,
  isEditable,
  resolveRecipient,
  type HrEventView,
  type HrRequestAction,
  type HrRequestRole,
  type HrRequestStatus,
} from '../../src/domain/hr-requests';

it('the domain vocabularies match the database', () => {
  expect(HR_REQUEST_STATUSES).toEqual(OPS_HR_REQUEST_STATUSES);
  expect(HR_REQUEST_URGENCIES).toEqual(OPS_HR_REQUEST_URGENCIES);
  expect(HR_REQUEST_RELATED_KINDS).toEqual(OPS_HR_REQUEST_RELATED_KINDS);
});

/** action → [who takes it, statuses it is allowed from, status after (null = unchanged)]. */
const LIFECYCLE: Record<
  HrRequestAction,
  [HrRequestRole, HrRequestStatus[], HrRequestStatus | null]
> = {
  submit: ['sender', ['draft'], 'submitted'],
  review: ['hr', ['submitted'], 'reviewed'],
  forward: ['hr', ['reviewed', 'forwarded'], 'forwarded'],
  resolve: ['hr', ['reviewed', 'forwarded'], 'resolved'],
  decline: ['hr', ['reviewed'], 'declined'],
  relay: ['hr', ['forwarded'], null],
  respond: ['recipient', ['forwarded'], null],
  note: ['hr', ['submitted', 'reviewed', 'forwarded', 'resolved', 'declined'], null],
  create_task: ['hr', ['submitted', 'reviewed', 'forwarded'], null],
};
const CASES = HR_REQUEST_ACTIONS.flatMap((action) =>
  HR_REQUEST_STATUSES.map((status) => {
    const [who, from, to] = LIFECYCLE[action];
    return [action, status, who, from.includes(status), to] as const;
  }),
);

describe('lifecycle: Draft → Submitted → Reviewed → Forwarded | Resolved | Declined', () => {
  it.each(CASES)('%s from %s (as %s): allowed %s', (action, status, who, ok, to) => {
    const d = decideHrRequest(action, status, [who], 'Text');
    expect(d).toEqual(
      ok
        ? { ok: true, to, event: expect.any(String) }
        : expect.objectContaining({ ok: false, code: 'state' }),
    );
  });

  it.each<[HrRequestAction, HrRequestRole[]]>([
    ['submit', ['hr']],
    ['review', ['sender']],
    ['forward', ['recipient']],
    ['respond', ['sender', 'hr']],
    ['decline', []],
  ])('%s by %j is forbidden', (action, roles) => {
    const status = LIFECYCLE[action][1][0]!;
    expect(decideHrRequest(action, status, roles, 'Text')).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
  });

  it.each(['forward', 'decline', 'relay', 'respond', 'note'] as const)(
    '%s needs its text',
    (action) => {
      const [who, [status]] = LIFECYCLE[action];
      expect(decideHrRequest(action, status!, [who], '  ')).toMatchObject({
        ok: false,
        code: 'body',
      });
    },
  );

  it.each(HR_REQUEST_STATUSES.map((s) => [s, s === 'draft'] as const))(
    'the message can change while %s: %s',
    (status, editable) => expect(isEditable(status)).toBe(editable),
  );
});

describe('recipient: never guessed', () => {
  const active = (id: string) => id === 'staff-active';
  it.each<
    [
      string,
      { recipientStaffId: string | null; recipientKey: string | null },
      Record<string, string | null>,
      unknown,
    ]
  >([
    ['HR itself', { recipientStaffId: null, recipientKey: null }, {}, { kind: 'hr' }],
    [
      'a named person',
      { recipientStaffId: 'p1', recipientKey: null },
      {},
      { kind: 'staff', staffId: 'p1' },
    ],
    [
      'Schar not set up',
      { recipientStaffId: null, recipientKey: 'schar' },
      { schar: null },
      { kind: 'unresolved', key: 'schar', note: 'Recipient not set up: Schar' },
    ],
    [
      'Schar set to someone inactive',
      { recipientStaffId: null, recipientKey: 'schar' },
      { schar: 'staff-gone' },
      { kind: 'unresolved', key: 'schar', note: 'Recipient not set up: Schar' },
    ],
    [
      'a key removed from the setting',
      { recipientStaffId: null, recipientKey: 'schar' },
      {},
      { kind: 'unresolved', key: 'schar', note: 'Recipient not set up: Schar' },
    ],
    [
      'Schar set up',
      { recipientStaffId: null, recipientKey: 'schar' },
      { schar: 'staff-active' },
      { kind: 'staff', staffId: 'staff-active' },
    ],
  ])('%s', (_n, r, named, out) => expect(resolveRecipient(r, named, active)).toEqual(out));
});

describe('what each viewer sees', () => {
  const ev = (o: Partial<HrEventView>): HrEventView => ({
    kind: 'note',
    actorUserId: 'hr-user',
    forwardedToStaffId: null,
    visibleToRecipient: false,
    hrNote: null,
    body: null,
    ...o,
  });
  const log = [
    ev({ kind: 'submitted', actorUserId: 'sender-user' }),
    ev({ kind: 'note', hrNote: 'HR only' }),
    ev({
      kind: 'forwarded',
      forwardedToStaffId: 'A',
      visibleToRecipient: true,
      body: 'to A',
      hrNote: 'why A',
    }),
    ev({ kind: 'forwarded', forwardedToStaffId: 'B', visibleToRecipient: true, body: 'to B' }),
    ev({
      kind: 'forwarded',
      forwardedToStaffId: 'A',
      visibleToRecipient: false,
      body: 'hidden from A',
    }),
    ev({
      kind: 'recipient_responded',
      actorUserId: 'a-user',
      body: 'A answers',
      visibleToRecipient: true,
    }),
    ev({ kind: 'response_relayed', body: 'answer for sender' }),
  ];
  it.each<[string, Parameters<typeof eventsFor>[0], (string | null)[]]>([
    ['recipient A', { as: 'recipient', staffId: 'A', userId: 'a-user' }, ['to A', 'A answers']],
    [
      'recipient B (never A’s forward or reply)',
      { as: 'recipient', staffId: 'B', userId: 'b-user' },
      ['to B'],
    ],
    [
      'the sender (steps and the relayed answer only)',
      { as: 'sender' },
      [null, null, null, null, 'answer for sender'],
    ],
    ['HR (everything)', { as: 'hr' }, log.map((e) => e.body)],
  ])('%s', (_n, viewer, bodies) => {
    const seen = eventsFor(viewer, log);
    expect(seen.map((e) => e.body)).toEqual(bodies);
    if (viewer.as !== 'hr') expect(seen.every((e) => e.hrNote === null)).toBe(true);
  });
});
