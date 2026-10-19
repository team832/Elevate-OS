import { createLogger, type Logger } from '@elevate/configuration';

/**
 * External channels (email, later WhatsApp/SMS) are adapters (D-014). No live
 * adapter exists yet: the default email adapter is a MOCK that logs the
 * message and reports `not_sent`. Nothing in Elevate OS may tell a user a
 * message was delivered unless an adapter returned `sent` after a real call.
 */
export interface ChannelMessage {
  to: string;
  subject: string;
  text: string;
  /** Correlates logs with the business action. */
  reference?: string;
}

export type ConnectionStatus = 'not_configured' | 'sandbox' | 'connected' | 'error';

export type DeliveryResult =
  | { status: 'sent'; adapter: string; at: string; providerMessageId: string }
  | { status: 'not_sent'; adapter: string; at: string; reason: string }
  | { status: 'failed'; adapter: string; at: string; reason: string };

export interface ChannelAdapter {
  readonly channel: 'email';
  readonly name: string;
  readonly connection: ConnectionStatus;
  send(message: ChannelMessage): Promise<DeliveryResult>;
}

/** Logs the message (recipient domain only) and never claims delivery. */
export class MockEmailAdapter implements ChannelAdapter {
  readonly channel = 'email' as const;
  readonly name = 'mock-email';
  readonly connection: ConnectionStatus = 'sandbox';
  readonly sent: ChannelMessage[] = [];
  private readonly log: Logger;

  constructor(log: Logger = createLogger({ component: 'mock-email' })) {
    this.log = log;
  }

  async send(message: ChannelMessage): Promise<DeliveryResult> {
    this.sent.push(message);
    const domain = message.to.split('@')[1] ?? 'unknown';
    this.log.info('mock email NOT sent (no email provider configured)', {
      toDomain: domain,
      subject: message.subject,
      reference: message.reference,
    });
    return {
      status: 'not_sent',
      adapter: this.name,
      at: new Date().toISOString(),
      reason: 'Email is not configured: the mock adapter only records the message.',
    };
  }
}

/** Used when NOTIFICATIONS_EMAIL_ADAPTER=disabled. */
export class DisabledEmailAdapter implements ChannelAdapter {
  readonly channel = 'email' as const;
  readonly name = 'disabled-email';
  readonly connection: ConnectionStatus = 'not_configured';

  async send(): Promise<DeliveryResult> {
    return {
      status: 'not_sent',
      adapter: this.name,
      at: new Date().toISOString(),
      reason: 'Email channel is disabled.',
    };
  }
}

/** Pick the email adapter from NOTIFICATIONS_EMAIL_ADAPTER (mock | disabled; default mock). */
export function getEmailAdapter(
  mode: string | undefined = process.env.NOTIFICATIONS_EMAIL_ADAPTER,
): ChannelAdapter {
  if (mode === 'disabled') return new DisabledEmailAdapter();
  if (mode === undefined || mode === '' || mode === 'mock') return new MockEmailAdapter();
  throw new Error(`Unknown NOTIFICATIONS_EMAIL_ADAPTER "${mode}" (allowed: mock, disabled)`);
}
