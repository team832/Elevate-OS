/**
 * Bordered building blocks for record pop-ups, profiles and forms:
 * - Segment: a raised, bordered section with a header bar (title, badges, actions).
 * - DetailTable: label/value rows in a bordered table (replaces loose <dl> text).
 * - FormSection: a titled group of form fields in the two-column form grid.
 * Usable from server and client components (useId is allowed in both).
 */
import { useId, type ReactNode } from 'react';
import { StatusBadge } from '@elevate/shared-ui';

export function Segment({
  title,
  level = 2,
  description,
  meta,
  actions,
  flush,
  id,
  className,
  children,
}: {
  title: string;
  /** Heading level: 2 on pages, 3 inside a RecordModal (its title is the h2). */
  level?: 2 | 3;
  description?: ReactNode;
  /** Small labels next to the title (badges, "Sample data"). */
  meta?: ReactNode;
  /** Links or buttons at the right of the header bar. */
  actions?: ReactNode;
  /** No body padding: a DetailTable or RecordTable meets the segment border. */
  flush?: boolean;
  id?: string;
  /** Layout class, e.g. `ops-panel-wide` to span an `.ops-panels` row. */
  className?: string;
  children: ReactNode;
}) {
  const auto = useId();
  const headingId = `${id ?? auto}-title`;
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <section
      id={id}
      className={['el-card ops-segment', flush && 'ops-segment-flush', className]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby={headingId}
    >
      <div className="el-card-header">
        <div className="el-card-heading">
          <div className="el-card-titlerow">
            <Heading id={headingId}>{title}</Heading>
            {meta ?? null}
          </div>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="el-card-actions">{actions}</div> : null}
      </div>
      <div className="el-card-body">{children}</div>
    </section>
  );
}

export interface DetailRow {
  label: string;
  value: ReactNode;
}

/** Falsy rows are skipped, so optional rows read `cond && { label, value }`. */
export function DetailTable({
  rows,
  caption,
}: {
  rows: readonly (DetailRow | false | '' | 0 | null | undefined)[];
  /** Visually hidden caption, for tables outside a titled Segment. */
  caption?: string;
}) {
  return (
    <table className="ops-detail">
      {caption ? <caption className="el-visually-hidden">{caption}</caption> : null}
      <tbody>
        {rows
          .filter((r): r is DetailRow => Boolean(r))
          .map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.value}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

/**
 * Titled group of fields: two columns from 720px, one on phones. Give long
 * fields (text areas, checkboxes) the `el-field-wide` class to span both columns.
 */
export function FormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <fieldset className="el-fieldset ops-form-section">
      <legend>{title}</legend>
      {hint ? <p className="el-field-hint">{hint}</p> : null}
      <div className="el-form-grid">{children}</div>
    </fieldset>
  );
}

export type TaskState = 'completed' | 'incomplete' | 'cannot_start';
const TASK_STATE: Record<TaskState, [string, 'success' | 'warning' | 'neutral']> = {
  completed: ['Completed', 'success'],
  incomplete: ['Incomplete', 'warning'],
  cannot_start: ['Cannot start yet', 'neutral'],
};

/**
 * Task list (GOV.UK pattern): each task with its state in words, what is missing and a link to
 * fix it. Render it only from what the server's own check returned (never re-derive gates here).
 */
export function TaskList({
  items,
  caption,
}: {
  items: readonly {
    label: string;
    state: TaskState;
    missing?: readonly ReactNode[];
    href?: string | null;
  }[];
  caption?: string;
}) {
  return (
    <DetailTable
      caption={caption}
      rows={items.map((t) => ({
        label: t.label,
        value: (
          <>
            <StatusBadge tone={TASK_STATE[t.state][1]}>{TASK_STATE[t.state][0]}</StatusBadge>
            {t.missing?.length ? (
              <ul>
                {t.missing.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : null}
            {t.href && t.state === 'incomplete' ? <a href={t.href}>Go to this task</a> : null}
          </>
        ),
      }))}
    />
  );
}

/**
 * Activity timeline: newest first, one row per event (when · what · who/detail). The
 * marker is decorative; the time and the words carry the meaning.
 */
export function Timeline({
  label,
  items,
}: {
  label: string;
  items: readonly { key: string; when: ReactNode; title: ReactNode; detail?: ReactNode }[];
}) {
  return (
    <ol className="ops-timeline" aria-label={label}>
      {items.map((i) => (
        <li key={i.key}>
          <span className="ops-timeline-when">{i.when}</span>
          <span className="ops-timeline-title">{i.title}</span>
          {i.detail ? <span className="ops-timeline-detail">{i.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}
