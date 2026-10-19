import type { AuthenticatedUser } from '@elevate/authentication';
import type { Actor } from './context';

/** Build the service Actor from a defineRoute context. */
export function actorOf(ctx: { user: AuthenticatedUser; requestId: string }): Actor {
  return { user: ctx.user, requestId: ctx.requestId };
}
