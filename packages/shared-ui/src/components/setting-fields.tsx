'use client';

/**
 * The one settings editor: real fields driven by the setting's shape (setting-shape.ts). It posts
 * through the host form as a hidden JSON field, so the form's body is the same as a JSON box's.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Button, Checkbox, Field, fieldDescribedBy, Select, TextArea, TextInput } from './forms';
import {
  blankDraft,
  fromDraft,
  toDraft,
  type Draft,
  type FieldShape,
  type GroupDraft,
  type PlainValue,
} from './setting-shape';

type ControlProps<S extends FieldShape['kind'] = FieldShape['kind']> = {
  s: Extract<FieldShape, { kind: S }>;
  d: Draft;
  set: (d: Draft) => void;
  id: string;
};

export function SettingFields({
  name,
  shape,
  value,
}: {
  name: string;
  shape: FieldShape;
  value: unknown;
}) {
  const [draft, setDraft] = useState(() => toDraft(shape, value));
  const id = useId();
  return (
    <>
      <input type="hidden" name={name} value={JSON.stringify(fromDraft(shape, draft))} />
      <SettingControl s={shape} d={draft} set={setDraft} id={id} />
    </>
  );
}

function ListField({ s, d, set, id }: ControlProps<'list'>) {
  const rows = d as Draft[];
  const box = useRef<HTMLFieldSetElement>(null);
  const focus = useRef<'row' | 'add' | null>(null);
  useEffect(() => {
    if (focus.current === 'row')
      [...(box.current?.querySelectorAll<HTMLElement>('.el-setting-row') ?? [])]
        .at(-1)
        ?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')
        ?.focus();
    if (focus.current === 'add') box.current?.querySelector<HTMLElement>('[data-add-row]')?.focus();
    focus.current = null;
  });
  return (
    <fieldset className="el-fieldset" ref={box}>
      <legend>{s.label}</legend>
      {s.hint ? <p className="el-field-hint">{s.hint}</p> : null}
      {rows.map((row, i) => (
        <div className="el-setting-row" key={i}>
          <SettingControl
            s={{ ...s.of, label: `${s.label} ${i + 1}` }}
            d={row}
            set={(x) => set(rows.map((r, n) => (n === i ? x : r)))}
            id={`${id}-${i}`}
          />
          {rows.length > s.min ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                focus.current = 'add';
                set(rows.filter((_, n) => n !== i));
              }}
            >
              Remove<span className="el-visually-hidden"> {`${s.label} ${i + 1}`}</span>
            </Button>
          ) : null}
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        data-add-row=""
        disabled={s.max !== undefined && rows.length >= s.max}
        onClick={() => {
          focus.current = 'row';
          set([...rows, blankDraft(s.of)]);
        }}
      >
        Add a row<span className="el-visually-hidden"> to {s.label}</span>
      </Button>
    </fieldset>
  );
}

/** One field of the shape, holding `d`. */
export function SettingControl({ s, d, set, id }: ControlProps) {
  const a11y = { id, 'aria-describedby': fieldDescribedBy(id, s.hint) };
  switch (s.kind) {
    case 'number':
      return (
        <Field id={id} label={s.label} hint={s.hint}>
          <TextInput
            {...a11y}
            type="number"
            inputMode={s.whole ? 'numeric' : 'decimal'}
            min={s.min}
            max={s.max}
            step={s.paise ? 0.01 : s.whole ? 1 : 'any'}
            required={!s.nullable}
            value={d as string}
            onChange={(e) => set(e.target.value)}
          />
        </Field>
      );
    case 'text':
      return (
        <Field id={id} label={s.label} hint={s.hint}>
          {s.long ? (
            <TextArea
              {...a11y}
              rows={(d as string).length > 500 ? 12 : 3}
              maxLength={s.maxLength}
              required={!s.nullable}
              value={d as string}
              onChange={(e) => set(e.target.value)}
            />
          ) : (
            <TextInput
              {...a11y}
              type={s.time ? 'time' : 'text'}
              maxLength={s.maxLength}
              required={!s.nullable}
              value={d as string}
              onChange={(e) => set(e.target.value)}
            />
          )}
        </Field>
      );
    case 'boolean':
      return (
        <div className="el-field">
          <Checkbox
            id={id}
            label={s.label}
            checked={d as boolean}
            onChange={(e) => set(e.target.checked)}
          />
        </div>
      );
    case 'choice':
      return (
        <Field id={id} label={s.label} hint={s.hint}>
          <Select {...a11y} value={d as string} onChange={(e) => set(e.target.value)}>
            {s.nullable ? <option value="">Not set</option> : null}
            {s.options.map((o, i) => (
              <option key={i} value={String(i)}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'choices': {
      const on = d as PlainValue[];
      return (
        <fieldset className="el-fieldset">
          <legend>{s.label}</legend>
          {s.options.map((o, i) => (
            <Checkbox
              key={i}
              id={`${id}-${i}`}
              label={o.label}
              checked={on.includes(o.value)}
              // Stored order is kept and a new tick goes last, so an untouched form posts the same list.
              onChange={(e) =>
                set(e.target.checked ? [...on, o.value] : on.filter((v) => v !== o.value))
              }
            />
          ))}
        </fieldset>
      );
    }
    case 'list':
      return <ListField s={s} d={d} set={set} id={id} />;
    case 'group': {
      const g = d as GroupDraft;
      const fields = s.fields.map((f) => (
        <SettingControl
          key={f.key}
          s={f}
          d={g.fields[f.key]!}
          set={(x) => set({ ...g, fields: { ...g.fields, [f.key]: x } })}
          id={`${id}-${f.key}`}
        />
      ));
      if (!s.label) return <div className="el-form-grid">{fields}</div>;
      return (
        <fieldset className="el-fieldset el-setting-group">
          <legend>{s.label}</legend>
          {s.nullable ? (
            <div className="el-field">
              <Checkbox
                id={`${id}-on`}
                label={`Set ${s.label.toLowerCase()}`}
                checked={g.on}
                onChange={(e) => set({ ...g, on: e.target.checked })}
              />
            </div>
          ) : null}
          {g.on ? fields : null}
        </fieldset>
      );
    }
    case 'fixed':
      return (
        <p className="el-field-hint">
          {s.label}: {s.text} (fixed)
        </p>
      );
    case 'json':
      return (
        <Field id={id} label={s.label || 'Value as text'} hint={s.hint}>
          <TextArea
            {...a11y}
            rows={8}
            spellCheck={false}
            value={d as string}
            onChange={(e) => set(e.target.value)}
          />
        </Field>
      );
  }
}
