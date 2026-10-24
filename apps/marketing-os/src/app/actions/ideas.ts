'use server';

import {
  changeIdeaStatus,
  createContentItem,
  createContentItemBody,
  ideaStatusBody,
  verifyAccountConnection,
} from '../../server';
import { go, run, str } from './common';

export async function changeIdeaStatusAction(form: FormData): Promise<void> {
  const id = str(form, 'ideaId') ?? '';
  const parsed = ideaStatusBody.safeParse({
    status: str(form, 'status'),
    reason: str(form, 'reason'),
  });
  if (!parsed.success) go(`ideas/${id}`, { error: 'Choose a valid status.' });
  const res = await run((db, user) => changeIdeaStatus(db, user, id, parsed.data));
  if (!res.ok) go(`ideas/${id}`, { error: res.error });
  go(`ideas/${id}`, { notice: `Status changed to ${res.value.status}.` });
}

export async function createContentItemAction(form: FormData): Promise<void> {
  const ideaId = str(form, 'ideaId') ?? '';
  const body = str(form, 'body');
  const parsed = createContentItemBody.safeParse({
    title: str(form, 'title'),
    format: str(form, 'format'),
    initialVersion: body ? { body } : undefined,
  });
  if (!parsed.success)
    go(`ideas/${ideaId}`, { error: 'Give the content item a title and a format.' });
  const res = await run((db, user) => createContentItem(db, user, ideaId, parsed.data));
  if (!res.ok) go(`ideas/${ideaId}`, { error: res.error });
  go(`content/${res.value.id}`, { notice: 'Content item created as a draft.' });
}

export async function verifyAccountAction(form: FormData): Promise<void> {
  const id = str(form, 'accountId') ?? '';
  const res = await run((db, user) => verifyAccountConnection(db, user, id));
  if (!res.ok) go('accounts', { error: res.error });
  go('accounts', {
    notice: `${res.value.code}: ${res.value.integrationStatus} — ${res.value.integrationNote ?? ''}`,
  });
}
