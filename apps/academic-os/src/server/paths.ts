import { modulePath } from '../domain';

/** Browser paths (with basePath) used by pages, forms and redirects. */
export const MODULE_PATHS = {
  home: modulePath(),
  login: modulePath('login'),
  loginApi: modulePath('api/v1/auth/login'),
  logoutApi: modulePath('api/v1/auth/logout'),
  curriculum: modulePath('curriculum'),
  plan: (id: string) => modulePath(`curriculum/plans/${id}`),
  conceptBooks: modulePath('curriculum/concept-books'),
  batches: modulePath('batches'),
  batch: (id: string) => modulePath(`batches/${id}`),
  timetable: modulePath('timetable'),
  teaching: modulePath('teaching'),
  attendance: (sessionId: string) => modulePath(`teaching/attendance/${sessionId}`),
  assessments: modulePath('assessments'),
  assessment: (id: string) => modulePath(`assessments/${id}`),
  students: modulePath('students'),
  student: (id: string) => modulePath(`students/${id}`),
  progress: modulePath('progress'),
  intake: modulePath('intake'),
  teachingLog: (sessionId: string) => modulePath(`teaching/log/${sessionId}`),
  reviews: modulePath('reviews'),
  review: (id: string) => modulePath(`reviews/${id}`),
  /** Prefill with `?studentId=&sessionId=` (enrolled) or `?coreStudentId=&opsDemoSessionId=` (demo). */
  newReview: modulePath('reviews/new'),
  marks: (assessmentId: string) => modulePath(`assessments/${assessmentId}/marks`),
  studentProgress: (studentId: string) => modulePath(`progress/students/${studentId}`),
  reports: modulePath('reports'),
  /** Print view; query `batchId|assessmentId|staffId&from&to` as for api(`reports/${kind}`). */
  report: (kind: string) => modulePath(`reports/${kind}`),
  settings: modulePath('settings'),
  enrolments: modulePath('enrolments'),
  teachers: modulePath('teachers'),
  teacher: (staffId: string) => modulePath(`teachers/${staffId}`),
  patterns: modulePath('timetable/patterns'),
  pattern: (id: string) => modulePath(`timetable/patterns/${id}`),
  /** Browser path of an API route, e.g. api('courses') → /academic/api/v1/courses. */
  api: (subpath: string) => modulePath(`api/v1/${subpath}`),
} as const;
