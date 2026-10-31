export * from './ids';
export * from './modules';
export * from './result';
export * from './roles';
export * from './dates';
export * from './programmes';

/** A setting's key in plain words: `dueSoonHours` is "Due soon hours", `amountPaise` "Amount", `if_under_18` "If under 18". */
export function settingFieldName(key: string) {
  const words = key
    .replace(/(Paise|Inr|Percent)$/, '')
    .replace(/Codes$/, 's')
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
