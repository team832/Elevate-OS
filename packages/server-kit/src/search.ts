/** ILIKE pattern for "contains `text`": %, _ and \ in a name are ordinary characters, not wildcards (Postgres's default LIKE escape is \). */
export const containsPattern = (text: string) => `%${text.replace(/[%_\\]/g, '\\$&')}%`;
