'use client';

/**
 * F4-07 Move students: choose students of one batch, a target batch, the first day and a reason;
 * confirm the list; see (and print) what moved. The server moves all or none and names every
 * student it refuses, with the reason.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, ButtonLink, Card, DataTable, Field, Select, TextInput, fieldDescribedBy, fmtDay } from '@elevate/shared-ui';
import { transferEndDate } from '../domain/placements';
import { ErrorAlert, send, type ErrorView } from './api-form';

type Student = { enrolmentId: string; studentName: string; startDate: string; isSample: boolean };
type Target = { id: string; label: string; code: string };
type Moved = { enrolmentId: string; studentName: string; keptOff: string[] };
type Result = { moved: Moved[]; catchUp: { chapters: { code: string; title: string }[] } };

const TARGET_HINT = 'Open batches of the same course, including next year’s.';
const DATE_HINT = 'Their last day in this batch is the day before.';
const REASON_HINT = 'Kept on each student’s placement history.';

export function BulkTransfer({ from, students, targets, action, back }: { from: { id: string; code: string }; students: Student[]; targets: Target[]; action: string; back: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ toBatchId: '', effectiveDate: '', reason: '' });
  const [step, setStep] = useState<'choose' | 'confirm' | 'saving' | 'done'>('choose');
  const [error, setError] = useState<ErrorView | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => top.current?.focus(), [step, error]);

  const chosen = students.filter((s) => picked.has(s.enrolmentId));
  const target = targets.find((t) => t.id === form.toBatchId);
  const all = chosen.length === students.length;
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  function review() {
    const missing = [
      chosen.length ? null : 'Choose at least one student.',
      target ? null : 'Choose the batch they move to.',
      form.effectiveDate ? null : 'Enter the first day in the new batch.',
      form.reason.trim() ? null : 'Enter the reason.',
    ].filter((m): m is string => m !== null);
    setError(missing.length ? { message: 'There is a problem', details: missing } : null);
    if (!missing.length) setStep('confirm');
  }

  async function confirm() {
    setStep('saving');
    try {
      const res = await send(action, 'POST', { fromBatchId: from.id, enrolmentIds: chosen.map((s) => s.enrolmentId), ...form });
      if (!res.ok) {
        setError(res.error);
        setStep('confirm');
        return;
      }
      setResult(res.data as Result);
      setError(null);
      setStep('done');
      router.refresh();
    } catch {
      setError({ message: 'Could not reach Academic OS. Nothing was saved. Check your connection and try again.', details: [] });
      setStep('confirm');
    }
  }

  const when = form.effectiveDate ? `from ${fmtDay(form.effectiveDate)} (last day in ${from.code}: ${fmtDay(transferEndDate(form.effectiveDate))})` : '';
  return (
    <Card title={step === 'done' ? 'Students moved' : 'Move students'} description={`From ${from.code}. Attendance, teaching logs and marks stay where they were recorded; untouched places on future tests move with the student.`}>
      <div ref={top} tabIndex={-1} className="el-stack">
        {error ? <ErrorAlert error={error} /> : null}
        {step === 'choose' ? (
          <>
            {students.length === 0 ? (
              <Alert tone="info" title="No students are placed in this batch now">Students appear here while their placement in {from.code} is open.</Alert>
            ) : (
              <>
                <label className="el-checkbox">
                  <input type="checkbox" checked={all} ref={(el) => {
                      if (el) el.indeterminate = chosen.length > 0 && !all;
                    }} onChange={() => setPicked(new Set(all ? [] : students.map((s) => s.enrolmentId)))} />
                  Select all {students.length} students
                </label>
                <DataTable
                  label={`Students in ${from.code}`}
                  rows={students}
                  rowKey={(s) => s.enrolmentId}
                  sampleOf={(s) => s.isSample}
                  columns={[
                    { key: 'pick', header: 'Student', render: (s) => <label className="el-checkbox"><input type="checkbox" checked={picked.has(s.enrolmentId)} onChange={() => toggle(s.enrolmentId)} />{s.studentName}</label> },
                    { key: 'since', header: `In ${from.code} since`, render: (s) => fmtDay(s.startDate) },
                  ]}
                />
              </>
            )}
            <Field id="move-to" label="Move to" hint={TARGET_HINT}>
              <Select id="move-to" value={form.toBatchId} onChange={set('toBatchId')} aria-describedby={fieldDescribedBy('move-to', TARGET_HINT)}>
                <option value="">Choose…</option>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            </Field>
            <Field id="move-date" label="First day in the new batch" hint={DATE_HINT}>
              <TextInput id="move-date" type="date" value={form.effectiveDate} onChange={set('effectiveDate')} aria-describedby={fieldDescribedBy('move-date', DATE_HINT)} />
            </Field>
            <Field id="move-reason" label="Reason" hint={REASON_HINT}>
              <TextInput id="move-reason" value={form.reason} maxLength={1000} onChange={set('reason')} aria-describedby={fieldDescribedBy('move-reason', REASON_HINT)} />
            </Field>
            <div className="el-form-actions">
              <Button onClick={review} disabled={students.length === 0}>Review the move</Button>
            </div>
          </>
        ) : null}
        {step === 'confirm' || step === 'saving' ? (
          <>
            <p>
              Move these {chosen.length} students to <strong>{target?.code}</strong> {when}. Reason: {form.reason}
            </p>
            <ol>{chosen.map((s) => <li key={s.enrolmentId}>{s.studentName}</li>)}</ol>
            <p className="el-field-hint">If any student cannot move, nobody is moved and the list above says who and why.</p>
            <div className="el-form-actions">
              <Button onClick={confirm} disabled={step === 'saving'}>{step === 'saving' ? 'Moving…' : `Move ${chosen.length} students`}</Button>
              <Button variant="secondary" onClick={() => setStep('choose')} disabled={step === 'saving'}>Back</Button>
            </div>
          </>
        ) : null}
        {step === 'done' && result ? (
          <>
            <Alert tone="success" title={`${result.moved.length} students moved to ${target?.code} ${when}.`}>Reason: {form.reason}</Alert>
            <DataTable
              label="Students moved"
              rows={result.moved}
              rowKey={(m) => m.enrolmentId}
              columns={[
                { key: 'studentName', header: 'Student' },
                { key: 'from', header: 'Last day in old batch', render: () => `${from.code}, ${fmtDay(transferEndDate(form.effectiveDate))}` },
                { key: 'to', header: 'First day in new batch', render: () => `${target?.code}, ${fmtDay(form.effectiveDate)}` },
                { key: 'tests', header: 'Future tests', render: (m) => m.keptOff.map((code) => `Kept off ${code}: removed by hand`).join('; ') || 'Follow the move' },
              ]}
            />
            <p className="el-field-hint">
              Proposed catch-up (nothing is assigned; you decide):{' '}
              {result.catchUp.chapters.length ? result.catchUp.chapters.map((c) => `${c.code} ${c.title}`).join(', ') : 'nothing to catch up.'}
            </p>
            <div className="el-form-actions">
              <ButtonLink href={back}>Back to the batch</ButtonLink>
              <Button variant="secondary" onClick={() => { setPicked(new Set()); setResult(null); setStep('choose'); }}>Move more students</Button>
            </div>
          </>
        ) : null}
      </div>
    </Card>
  );
}
