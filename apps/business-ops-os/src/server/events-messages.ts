/**
 * Event messages (A-EVT-2 reach, A-EVT-3 send): a draft with a preview, then an explicit send
 * through the messaging adapter. Contacts are read only to count and send; they never leave this file.
 */
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import {
  opsAdmissions,
  opsAppointmentParticipants as participants,
  opsContactPreferences,
  opsEventMessages,
  opsGuardians,
  opsLeads,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError } from '@elevate/shared-contracts';
import { messageStatus, reachable, type MessageChannel } from '../domain/appointments';
import { getMessagingAdapter } from './adapters/messaging';
import { accessScope, type Actor } from './context';
import { lockEvent, type Row, type Tx } from './events-audience';
import { fieldError, opsAudit, rowById } from './ops-common';

const audit = opsAudit('appointment');

/**
 * Contacts of the event's current participants on one channel, with consent applied (A-EVT-2).
 * Declined and removed participants are skipped. Contacts never leave the server.
 */
async function recipients(tx: Tx, appointmentId: Row['id'], channel: MessageChannel) {
  const rows = await tx
    .select({ p: participants, g: opsGuardians })
    .from(participants)
    .leftJoin(opsGuardians, eq(opsGuardians.id, participants.guardianId))
    .where(
      and(
        eq(participants.appointmentId, appointmentId),
        inArray(participants.kind, ['student', 'guardian']),
        isNull(participants.removedAt),
        or(
          isNull(participants.registrationStatus),
          ne(participants.registrationStatus, 'declined'),
        ),
      ),
    );
  const studentOf = (r: (typeof rows)[number]) => (r.p.studentId ?? r.g?.studentId)!;
  const ids = [...new Set(rows.map(studentOf))];
  const leads = ids.length
    ? await tx
        .select({ studentId: opsAdmissions.studentId, lead: opsLeads, pref: opsContactPreferences })
        .from(opsAdmissions)
        .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
        .leftJoin(opsContactPreferences, eq(opsContactPreferences.leadId, opsLeads.id))
        .where(and(inArray(opsAdmissions.studentId, ids), isNotNull(opsAdmissions.studentId)))
    : [];
  const field = channel === 'email' ? 'Email' : 'Phone';
  const out: string[] = [];
  for (const r of rows) {
    const mine = leads.filter((l) => l.studentId === studentOf(r));
    const contact = r.g
      ? r.g[channel === 'email' ? 'email' : 'phone']
      : (mine.map((l) => l.lead[`student${field}`]).find(Boolean) ?? null);
    const ok = reachable(channel, {
      contact,
      preferences: mine.flatMap((l) => (l.pref ? [l.pref] : [])),
      ...(r.g ? { guardianConsent: r.g.consentStatus } : {}),
    });
    if (ok && contact) out.push(contact);
  }
  return { to: [...new Set(out)], unreachable: rows.length - out.length };
}

const NOT_CONNECTED =
  'No messaging provider is connected: sending will be recorded as “Simulated — not sent”.';

/** POST /appointments/{id}/messages — saves a draft and returns its preview; sends nothing. */
export async function draftEventMessage(
  db: Database,
  actor: Actor,
  id: string,
  input: { channel: MessageChannel; body: string },
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const row = await lockEvent(tx, actor, id);
    const { to, unreachable } = await recipients(tx, row.id, input.channel);
    const [message] = await tx
      .insert(opsEventMessages)
      .values({
        appointmentId: row.id,
        channel: input.channel,
        body: input.body,
        // Reach at preview time; replaced by the count at send time.
        recipientCount: to.length,
        createdBy: actor.id,
      })
      .returning();
    await audit(
      tx,
      actor,
      row.id,
      'event.message_drafted',
      {
        metadata: {
          messageId: message!.id,
          channel: input.channel,
          reachable: to.length,
          unreachable,
        },
      },
      requestId,
    );
    const adapter = getMessagingAdapter();
    return {
      ...message!,
      preview: {
        reachable: to.length,
        unreachable,
        providerConnected: adapter.connected,
        notice: adapter.connected ? null : NOT_CONNECTED,
      },
    };
  });
}

/** POST /appointments/{id}/messages/{messageId} — the explicit send (ops:event_messages:send). */
export async function sendEventMessage(
  db: Database,
  actor: Actor,
  id: string,
  messageId: string,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:event_messages:send');
  return withTransaction(db, async (tx) => {
    const row = await lockEvent(tx, actor, id);
    const message = await rowById(tx, opsEventMessages, messageId, 'Message', true);
    if (message.appointmentId !== row.id)
      throw fieldError('messageId', 'Not a message of this event.');
    if (message.status !== 'draft')
      throw new ConflictError('This message was already sent or simulated.');
    const { to } = await recipients(tx, row.id, message.channel as MessageChannel);
    // shortcut: provider call inside the transaction; move it to the outbox before a real provider is connected (a crash after sending would allow a re-send).
    const { providerRef } = await getMessagingAdapter().send({
      channel: message.channel as MessageChannel,
      body: message.body,
      to,
    });
    const status = messageStatus(providerRef);
    const [after] = await tx
      .update(opsEventMessages)
      .set({ status, providerRef, recipientCount: to.length, sentBy: actor.id, sentAt: new Date() })
      .where(eq(opsEventMessages.id, message.id))
      .returning();
    await audit(
      tx,
      actor,
      row.id,
      `event.message_${status}`,
      { metadata: { messageId: message.id, channel: message.channel, recipients: to.length } },
      requestId,
    );
    return after!;
  });
}
