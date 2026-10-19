/**
 * Parse pasted/imported assessment responses (pure).
 *
 * Format (header optional, comma-separated, one row per student and section):
 *   student_code,key_version,section_code,answers
 *   STU-0001,1,QA,A|B||D        answers separated by "|"; empty = unattempted
 *   STU-0002,,ABSENT,           section ABSENT marks the student absent
 * Rows are grouped by student; every problem is reported with its line number.
 */
export interface ParsedAttempt {
  studentCode: string;
  status: 'submitted' | 'absent';
  keyVersion: number | null;
  responses: Record<string, (string | null)[]> | null;
}

export interface CsvProblem {
  line: number;
  message: string;
}

export function parseResponsesCsv(text: string): { attempts: ParsedAttempt[]; problems: CsvProblem[] } {
  const problems: CsvProblem[] = [];
  const byStudent = new Map<string, ParsedAttempt>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const cells = trimmed.split(',').map((c) => c.trim());
    if (index === 0 && cells[0]?.toLowerCase() === 'student_code') return;
    if (cells.length < 3 || cells.length > 4) {
      problems.push({ line, message: 'Expected student_code,key_version,section_code,answers.' });
      return;
    }
    const [studentCode, versionText, sectionCode, answers = ''] = cells as [string, string, string, string?];
    if (!studentCode) {
      problems.push({ line, message: 'student_code is empty.' });
      return;
    }
    let keyVersion: number | null = null;
    if (versionText !== '') {
      keyVersion = Number(versionText);
      if (!Number.isInteger(keyVersion) || keyVersion < 1) {
        problems.push({ line, message: `key_version "${versionText}" is not a positive whole number.` });
        return;
      }
    }
    const existing = byStudent.get(studentCode);
    if (sectionCode.toUpperCase() === 'ABSENT') {
      if (existing) {
        problems.push({ line, message: `${studentCode} has responses and is also marked ABSENT.` });
        return;
      }
      byStudent.set(studentCode, { studentCode, status: 'absent', keyVersion: null, responses: null });
      return;
    }
    if (!sectionCode) {
      problems.push({ line, message: 'section_code is empty.' });
      return;
    }
    const attempt = existing ?? { studentCode, status: 'submitted' as const, keyVersion, responses: {} };
    if (attempt.status === 'absent') {
      problems.push({ line, message: `${studentCode} is marked ABSENT and also has responses.` });
      return;
    }
    if (attempt.keyVersion !== keyVersion) {
      problems.push({ line, message: `${studentCode} uses different key versions on different rows.` });
      return;
    }
    if (attempt.responses![sectionCode]) {
      problems.push({ line, message: `${studentCode} has section ${sectionCode} twice (duplicate attempt).` });
      return;
    }
    attempt.responses![sectionCode] = answers.split('|').map((a) => (a.trim() === '' ? null : a.trim()));
    byStudent.set(studentCode, attempt);
  });
  return { attempts: [...byStudent.values()], problems };
}
