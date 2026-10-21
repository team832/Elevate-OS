/**
 * Messaging adapter for event and webinar messages (brief §12, D-014). No email, SMS or
 * WhatsApp provider is connected, so there is only an interface and a MOCK that never sends
 * and never returns a provider reference: a send through it is recorded as `simulated`
 * ("Simulated — not sent"), never `sent` (the DB check needs a provider reference for that).
 */
import type { MessageChannel } from '../../domain/appointments';

export interface MessagingAdapter {
  readonly name: string;
  /** True only after a real provider is configured and verified. */
  readonly connected: boolean;
  /** Returns the provider's message/batch reference, or null when nothing was sent. */
  send(message: {
    channel: MessageChannel;
    body: string;
    to: readonly string[];
  }): Promise<{ providerRef: string | null }>;
}

export class MockMessagingAdapter implements MessagingAdapter {
  readonly name = 'Messaging (mock — no provider connected)';
  readonly connected = false;

  async send() {
    return { providerRef: null };
  }
}

export function getMessagingAdapter(): MessagingAdapter {
  return new MockMessagingAdapter();
}
