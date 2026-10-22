/** One toolbar filter of a GET form: a select (with an "All" option unless `all` is null), or a text or date input. */
import { Field, Select, TextInput } from '@elevate/shared-ui';

export function Filter({
  id,
  name,
  label,
  value,
  type = 'text',
  options,
  all = 'All',
}: {
  id: string;
  name: string;
  label: string;
  value?: string;
  type?: 'text' | 'date' | 'select';
  options?: readonly { value: string; label: string }[];
  all?: string | null;
}) {
  return (
    <Field id={id} label={label}>
      {type === 'select' ? (
        <Select id={id} name={name} defaultValue={value ?? ''}>
          {all === null ? null : <option value="">{all}</option>}
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <TextInput id={id} name={name} type={type} defaultValue={value} />
      )}
    </Field>
  );
}
