'use client';

/**
 * "Build draft timetable" (ACD-029, D-111): the coordinator picks a batch, the dates, the teaching
 * day and the classes per week; the server places draft patterns and this panel shows what was
 * saved, what was not and why, and the note. Nothing here publishes.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, DataTable, Field, Select, TextInput } from '@elevate/shared-ui';
import { WEEKDAY_NAMES } from '../domain/time';
import { ErrorAlert, send, type ErrorView } from './api-form';

type BatchOption = { id: string; code: string; subjects: { id: string; name: string }[] };
export type BuildResult = {
  drafts: { id: string; subjectName: string; weekday: number; startTime: string; teacherName: string; roomCode: string | null; classes: number; warnings: string[] }[];
  unplaced: { subjectId: string; subjectName: string; missing: number; reasons: { code: string; text: string }[] }[];
  notes: string[];
  note: { text: string; source: 'ai' | 'system'; label: string };
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function BuildTimetableForm({ batches, action, patternsPath }: { batches: BatchOption[]; action: string; patternsPath: string }) {
  const router = useRouter();
  const [batchId, setBatchId] = useState(batches[0]?.id ?? '');
  const [state, setState] = useState<{ kind: 'idle' | 'saving' } | { kind: 'error'; error: ErrorView } | { kind: 'done'; result: BuildResult }>({ kind: 'idle' });
  const subjects = batches.find((b) => b.id === batchId)?.subjects ?? [];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? '');
    const counts = subjects.flatMap((s) => (field(`weekly-${s.id}`) ? [{ subjectId: s.id, weeklyClasses: Number(field(`weekly-${s.id}`)) }] : []));
    if (counts.length === 0) return setState({ kind: 'error', error: { message: 'Enter classes per week for at least one subject.', details: [] } });
    setState({ kind: 'saving' });
    try {
      const res = await send(action, 'POST', { batchId, from: field('from'), to: field('to'), dayStart: field('dayStart'), dayEnd: field('dayEnd'), subjects: counts });
      setState(res.ok ? { kind: 'done', result: res.data as BuildResult } : { kind: 'error', error: res.error });
      if (res.ok) router.refresh();
    } catch {
      setState({ kind: 'error', error: { message: 'Could not reach Academic OS. Check your connection and try again.', details: [] } });
    }
  }

  return (
    <div className="el-stack">
      <form onSubmit={onSubmit} className="el-stack" noValidate>
        <div className="el-grid">
          <Field id="build-batch" label="Batch">
            <Select id="build-batch" name="batchId" required value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="build-from" label="First date">
            <TextInput id="build-from" name="from" type="date" required />
          </Field>
          <Field id="build-to" label="Last date">
            <TextInput id="build-to" name="to" type="date" required />
          </Field>
          <Field id="build-start" label="Day starts">
            <TextInput id="build-start" name="dayStart" type="time" required />
          </Field>
          <Field id="build-end" label="Day ends">
            <TextInput id="build-end" name="dayEnd" type="time" required />
          </Field>
        </div>
        <fieldset className="el-fieldset">
          <legend>Classes per week</legend>
          <p className="el-field-hint">Leave a subject blank to skip it. Teachers come from the batch’s teaching assignments.</p>
          <div className="el-grid">
            {subjects.map((s) => (
              <Field key={`${batchId}-${s.id}`} id={`build-${s.id}`} label={s.name}>
                <TextInput id={`build-${s.id}`} name={`weekly-${s.id}`} type="number" min={1} max={14} step={1} inputMode="numeric" />
              </Field>
            ))}
          </div>
        </fieldset>
        {state.kind === 'error' ? <ErrorAlert error={state.error} /> : null}
        <div className="el-form-actions">
          <Button type="submit" disabled={state.kind === 'saving'}>
            {state.kind === 'saving' ? 'Building…' : 'Build draft timetable'}
          </Button>
        </div>
      </form>
      {state.kind === 'done' ? <BuildResultPanel result={state.result} patternsPath={patternsPath} /> : null}
    </div>
  );
}

export function BuildResultPanel({ result, patternsPath }: { result: BuildResult; patternsPath: string }) {
  return (
    <section className="el-stack" aria-live="polite" aria-label="Build result">
      <Alert tone={result.drafts.length ? 'success' : 'warning'} title={result.drafts.length ? `${plural(result.drafts.length, 'draft pattern')} saved. Nothing is published yet.` : 'No draft patterns were saved.'}>
        {result.drafts.length ? 'Open each draft to preview its dates and publish it.' : null}
      </Alert>
      <Alert tone="info" title={result.note.label}>
        <p>{result.note.text}</p>
      </Alert>
      {result.drafts.length ? (
        <DataTable
          compact
          caption="Draft patterns saved"
          rows={result.drafts}
          rowKey={(d) => d.id}
          columns={[
            { key: 'slot', header: 'Weekly slot', render: (d) => <a href={`${patternsPath}/${d.id}`}><strong>{WEEKDAY_NAMES[d.weekday - 1]} {d.startTime}</strong></a> },
            { key: 'subject', header: 'Subject', render: (d) => d.subjectName },
            { key: 'teacher', header: 'Teacher', render: (d) => d.teacherName },
            { key: 'room', header: 'Room', render: (d) => d.roomCode ?? 'No room' },
            { key: 'classes', header: 'Classes', render: (d) => d.classes },
            { key: 'warnings', header: 'Warnings', render: (d) => d.warnings.join('; ') || 'None' },
          ]}
        />
      ) : null}
      {result.unplaced.length ? (
        <Alert tone="warning" title="Not placed">
          <ul>
            {result.unplaced.map((u) => (
              <li key={u.subjectId}>
                {u.subjectName}: {plural(u.missing, 'class')} a week not placed because {u.reasons.map((r) => r.text).join('; ')}.
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {result.notes.length ? (
        <ul className="el-field-hint">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
