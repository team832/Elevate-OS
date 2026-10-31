const PROGRAMME_NAMES: Record<string, string> = {
  COMMERCE_11_12: 'Class 11–12 Commerce',
  CLASS_11: 'Class 11 Commerce',
  CLASS_12: 'Class 12 Commerce',
  DROPPER: 'Dropper',
  CA_FOUNDATION: 'CA Foundation',
};

/** A programme as staff say it, for screens; CLAT, IPMAT and CUET already are names. */
export const programmeName = (code: string) => PROGRAMME_NAMES[code] ?? code.replace(/_/g, ' ');
