/** HR "Assign a task": the AI brief helper wraps the form and fills its fields by name. */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { newTaskFields } from '../../src/app/hr/tasks/new-task';
import { ActionForm } from '../../src/ui/action-form';
import { TaskBriefAssist } from '../../src/ui/ai-draft';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

describe('HR assign-task form with the AI brief helper', () => {
  it('offers "Suggest a brief" over a form holding every field a brief fills', () => {
    const html = renderToStaticMarkup(
      <TaskBriefAssist api="/ops/api/v1/ai/task-brief" blocked={null}>
        <ActionForm
          action="/ops/api/v1/staff-tasks"
          submitLabel="Assign task"
          fields={newTaskFields([{ value: 's1', label: 'Sample Teacher' }], [], [], null, [])}
        />
      </TaskBriefAssist>,
    );
    expect(html).toContain('Suggest a brief');
    for (const name of [
      'title',
      'expectedDeliverable',
      'acceptanceCriteria',
      'checklist',
      'dueOn',
      'dueTime',
    ])
      expect(html, name).toContain(`name="${name}"`);
  });
});

describe('Related batch or subject (RVC-021)', () => {
  const field = (related: { value: string; label: string }[] | null) =>
    newTaskFields([], [], [], null, related).find((f) => f.name === 'relatedRef');
  it('a role that cannot read teaching assignments is not offered the field, nor told of an outage', () => {
    expect(field(null)).toBeUndefined();
  });
  it('none to choose from says so', () => {
    expect(field([])?.hint).toMatch(/could be loaded/);
  });
});
