'use client';

/**
 * Pick a tracker backup file, see what it holds and whose it looks like, choose the staff
 * member it belongs to, and ask the server for a dry run. The file is read as text in the
 * browser and parsed as data (never run); the server parses and checks it again.
 */
import { useId, useState } from 'react';
import { Alert } from '@elevate/shared-ui';
import {
  MAX_BACKUP_CHARS,
  parseTrackerBackup,
  suggestStaff,
  type StaffOption,
} from '../../../../domain/task-import';
import { ActionForm } from '../../../../ui/action-form';

export function ImportUpload({ staff, base }: { staff: StaffOption[]; base: string }) {
  const id = useId();
  const [file, setFile] = useState<{ name: string; content: string | null } | null>(null);
  const parsed = typeof file?.content === 'string' ? parseTrackerBackup(file.content) : null;
  const matches = parsed?.ok ? suggestStaff(parsed.backup.profile, staff) : [];
  const suggested = matches.length === 1 ? matches[0] : undefined;
  return (
    <>
      <div className="el-field">
        <label htmlFor={id}>Tracker backup file</label>
        <input
          id={id}
          type="file"
          accept=".json,application/json"
          className="el-input"
          aria-describedby={`${id}-hint`}
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            setFile(
              f
                ? { name: f.name, content: f.size > MAX_BACKUP_CHARS ? null : await f.text() }
                : null,
            );
          }}
        />
        <p id={`${id}-hint`} className="el-field-hint">
          The file named Task-EOD-backup-YYYY-MM-DD.json that the tracker downloads from Backup →
          Export backup. One file per person.
        </p>
      </div>
      {file?.content === null ? (
        <Alert tone="danger">The file is larger than 5 MB; a tracker backup is much smaller.</Alert>
      ) : parsed && !parsed.ok ? (
        <Alert tone="danger">{parsed.error}</Alert>
      ) : parsed?.ok ? (
        <>
          <p>
            The file’s profile says <strong>{parsed.backup.profile.name ?? 'no name'}</strong>
            {parsed.backup.profile.email ? `, ${parsed.backup.profile.email}` : ''}
            {parsed.backup.profile.empId ? `, employee ID ${parsed.backup.profile.empId}` : ''}. It
            holds {parsed.backup.tasks.length} tasks and {parsed.backup.reports.length} end-of-day
            reports.
          </p>
          <ActionForm
            key={`${file!.name}:${suggested?.id ?? ''}`}
            action={`${base}/api/v1/task-imports`}
            submitLabel="Preview import"
            successText="Preview ready."
            extra={{ filename: file!.name, content: file!.content }}
            redirectTo={`${base}/tasks/imports?batch={id}`}
            fields={[
              {
                name: 'staffId',
                label: 'Whose tracker file is this?',
                type: 'select',
                // Not `required`: the list then starts at "—", so nobody is picked by default.
                defaultValue: suggested?.id,
                options: staff.map((s) => ({
                  value: s.id,
                  label: s.staffCode ? `${s.label} (${s.staffCode})` : s.label,
                })),
                hint: suggested
                  ? `Suggested because the file’s email or employee ID matches ${suggested.label} exactly. Check before you continue.`
                  : 'No staff record has this exact email or staff code. Choose the person yourself; names are never matched automatically.',
              },
            ]}
          />
        </>
      ) : null}
    </>
  );
}
