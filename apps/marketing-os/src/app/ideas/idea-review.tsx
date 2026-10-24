/** Idea review (brief §13): submit, then another approver approves or sends it back with a reason. */
import type { ReactNode } from 'react';
import { Button, Card, Field, TextInput } from '@elevate/shared-ui';
import type { IdeaStatus } from '../../domain';
import { reviewIdeaAction } from './actions';

export function IdeaReview({
  status,
  hidden,
  canSubmit,
  reviewer,
  mine,
}: {
  status: IdeaStatus;
  /** The hidden ideaId input. */
  hidden: ReactNode;
  canSubmit: boolean;
  /** Holds content:approve and is not the idea's creator or owner. */
  reviewer: boolean;
  mine: boolean;
}) {
  const submittable = canSubmit && (status === 'idea' || status === 'changes_requested');
  if (!submittable && status !== 'submitted') return null;
  const step = (to: IdeaStatus, label: string, extra?: ReactNode) => (
    <form action={reviewIdeaAction} className="el-stack">
      {hidden}
      <input type="hidden" name="status" value={to} />
      {extra}
      <div>
        <Button type="submit" variant={to === 'changes_requested' ? 'secondary' : 'primary'}>
          {label}
        </Button>
      </div>
    </form>
  );
  return (
    <Card title="Review">
      {submittable ? (
        step('submitted', 'Submit for review')
      ) : reviewer ? (
        <div className="el-stack">
          {step('approved', 'Approve idea')}
          {step(
            'changes_requested',
            'Request changes',
            <Field id="review-reason" label="What needs to change">
              <TextInput id="review-reason" name="reason" required minLength={3} maxLength={500} />
            </Field>,
          )}
        </div>
      ) : (
        <p>
          Waiting for review.{' '}
          {mine
            ? 'Another approver must review an idea you own or created.'
            : 'A marketing manager reviews ideas.'}
        </p>
      )}
    </Card>
  );
}
