/** Form fields shared by the Overview filters, the campaign editor and Personal Settings. */
import { Field, Select } from '@elevate/shared-ui';

export interface Option {
  id: string;
  name: string;
}

/** A labelled select; `none` names the empty choice ("All campaigns"). */
export function PickField({
  id,
  label,
  value,
  options,
  none,
  hint,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  options: readonly Option[];
  none?: string;
  hint?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Select id={id} name={id} defaultValue={value ?? ''}>
        {none !== undefined ? <option value="">{none}</option> : null}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Options from a fixed vocabulary and its labels. */
export const optionsOf = <K extends string>(labels: Record<K, string>): Option[] =>
  (Object.entries(labels) as [K, string][]).map(([id, name]) => ({ id, name }));
