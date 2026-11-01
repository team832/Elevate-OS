/**
 * Owner, 31 Oct 2026: "made up everything". The one table of made-up people in the test database:
 * normal names, fake numbers, named parents. It overrides the "Sample …" names and "no phones" of
 * D-036, D-061 and D-127, and only those: rows still carry is_sample, leave with db:clear-samples and
 * show the SAMPLE DATA badge. Login addresses stay as they are (other scripts sign in with them), and
 * @example.test stays the only domain here: it is how production refuses these accounts (D-030).
 * The reference seed never imports this file (scripts/release/package.mjs checks the bundle).
 */
import { eq, and } from 'drizzle-orm';
import type { Database } from '../client';
import { auditEvents } from '../schema/core';

const FAKE_PHONE_PREFIX = '+9111000';
/** For db:check: the only numbers a sample row may hold. */
export const FAKE_PHONE_PATTERN = `^\\${FAKE_PHONE_PREFIX}[0-9]{5}$`;
/** Delhi's code with a subscriber part starting 0, which no real line uses: a tap on a call link cannot reach a stranger. */
export const fakePhone = (n: number) => `${FAKE_PHONE_PREFIX}${String(n).padStart(5, '0')}`;

/** Staff with one job in the sample set, by that job. */
export const PEOPLE = {
  platformAdmin: 'Varun Khanna',
  director: 'Meenakshi Iyer',
  marketingManager: 'Gaurav Bansal',
  marketingContributor: 'Sneha Pillai',
  academicCoordinator: 'Prakash Nambiar',
  academicManager: 'Sunanda Bose',
  mathsTeacher: 'Anil Chawla',
  counsellor: 'Deepika Rathore',
  operationsManager: 'Manish Goyal',
  hrManager: 'Rekha Saxena',
  auditor: 'Naveen Gupta',
  financeOfficer: 'Harish Sodhi',
  businessLogin: 'Alok Dubey',
  hrLogin: 'Shalini Mishra',
  teacherLogin: 'Vivek Kaushik',
  marketingLogin: 'Ritu Malik',
  pooja: 'Pooja Verma',
  rohit: 'Rohit Saini',
  /** HR's forward screens name this person, so the first name stays Schar. */
  schar: 'Schar Mathur',
} as const;

/** Names on imported files that match nobody, to show the "not found" rows. */
export const UNMATCHED_TEACHER = 'Naman Trivedi';
export const UNMATCHED_STUDENT = 'Harsh Trivedi';

/** [staff code, name, subject]: teachers with a login (owner answer 4 / brief 2 §14). */
export const TEACHER_STAFF = [
  ['EMP-T01', 'Aditi Mehra', 'CA Foundation Accountancy'],
  ['EMP-T02', 'Karan Bedi', 'Business Laws'],
  ['EMP-T03', 'Nisha Rao', 'Quantitative Aptitude'],
  ['EMP-T04', 'Dev Malhotra', 'CLAT Legal Reasoning'],
  ['EMP-T05', 'Isha Nair', 'English / Verbal Ability'],
  ['EMP-T06', 'Raghav Sethi', 'Logical Reasoning'],
  ['EMP-T07', 'Kavya Joshi', 'General Knowledge / Current Affairs'],
  ['EMP-T08', 'Arjun Menon', 'IPMAT Quantitative Aptitude'],
  ['EMP-T09', 'Mehul Desai', 'Economics'],
  ['EMP-T10', 'Tara Kapoor', 'Business Studies'],
  ['EMP-T11', 'Neel Shah', 'Class 11/12 Accountancy'],
  ['EMP-T12', 'Sanya Kulkarni', 'CUET General Test'],
] as const;

/** [name, subject]: one teacher per demo class subject, no login. */
export const SUBJECT_TEACHERS = [
  ['Farida Khan', 'English'],
  ['Imran Qureshi', 'Legal Reasoning'],
  ['Lalit Bhatt', 'Logical Reasoning'],
  ['Geeta Menon', 'Current Affairs'],
  ['Hemant Joshi', 'Economics'],
  ['Tanvi Gokhale', 'Accountancy'],
] as const;

/**
 * Made-up teachers for every subject the real seven teach (apps/business-ops-os/seed/teachers.ts,
 * which only the reference seed loads). Assignments: [batch, subject code, role], sample batches only.
 */
export const COVER_TEACHERS = [
  {
    fullName: 'Ramesh Chandak',
    title: 'Accounts teacher',
    subjects: ['Class 11/12 Accountancy', 'CA Foundation Paper 1 (Accounting)', 'CUET Accountancy'],
    assignments: [
      ['CAF-A', 'ACC', 'co_teacher'],
      ['COM-C11-A', 'ACC', 'primary'],
      ['COM-C12-A', 'ACC', 'primary'],
    ],
  },
  {
    fullName: 'Kunal Vyas',
    title: 'Mathematics teacher',
    subjects: ['Class 11 Mathematics', 'Class 12 Mathematics', 'IPMAT Quantitative Aptitude'],
    assignments: [
      ['COM-C11-A', 'MATH', 'primary'],
      ['COM-C12-A', 'MATH', 'primary'],
      ['IPMAT-B', 'QUANT', 'co_teacher'],
    ],
  },
  {
    fullName: 'Jatin Oberoi',
    title: 'Economics teacher',
    subjects: ['Economics'],
    assignments: [['COM-C11-A', 'ECO', 'primary']],
  },
  {
    fullName: 'Priya Thomas',
    title: 'English teacher',
    subjects: ['English'],
    assignments: [
      ['COM-C11-A', 'ENG', 'primary'],
      ['COM-C12-A', 'ENG', 'primary'],
    ],
  },
  {
    fullName: 'Siddharth Rao',
    title: 'IPM teacher',
    subjects: ['IPM / IIM Bangalore-oriented programmes'],
    assignments: [
      ['IPMAT-B', 'LR', 'primary'],
      ['IPMAT-B', 'DI', 'primary'],
    ],
  },
  {
    fullName: 'Usha Pandey',
    title: 'Commerce mathematics teacher',
    subjects: ['Commerce-oriented / special mathematics'],
    assignments: [
      ['COM-C11-A', 'AMATH', 'primary'],
      ['COM-C12-A', 'AMATH', 'primary'],
    ],
  },
  {
    fullName: 'Bhavna Soni',
    title: 'Economics teacher',
    subjects: ['Economics'],
    assignments: [['COM-C12-A', 'ECO', 'primary']],
  },
  {
    fullName: 'Lata Krishnan',
    title: 'Current affairs teacher',
    subjects: ['CLAT Current Affairs'],
    assignments: [['CLAT-A', 'CA', 'primary']],
  },
] as const;

const STAFF_NAMES: readonly string[] = [
  ...Object.values(PEOPLE),
  ...TEACHER_STAFF.map(([, name]) => name),
  ...SUBJECT_TEACHERS.map(([name]) => name),
  ...COVER_TEACHERS.map((t) => t.fullName),
];

/** Every student and lead of the sample set. Append only: a name's place decides its family. */
const STUDENT_FIRST_NAMES = (
  'Tanisha Aarav Meera Kabir Riya Dev Ishaan Zoya Sana Arjun Diya Kavya Rohan Anaya Vihaan Myra ' +
  'Aditya Ira Reyansh Saanvi Parth ' +
  'Aanya Bhavya Charvi Dhruv Eshan Farah Gauri Ishita Hriday Jiya Kiaan Lavanya Manav Nysa Ojas ' +
  'Ishika Pranav Rehan Siya ' +
  'Nitya Advik Pihu Reva Tejas Yuvan Arnav Kiara Vivaan Navya Shaurya Anvi Aadhya Yash Ritika Om ' +
  'Samaira Prisha Ayaan Sara Rudra Inaya Krish Laksh Mahi Veer Riddhi Ahaan Anika Jai Pari ' +
  'Harini Mohit Neha Sahil Tanya Ruhi Lakshya Bhumi'
).split(' ');
/** Ishika and Ishita share their parents: the duplicate pair waiting for the merge review. */
const SAME_FAMILY: Readonly<Record<string, string>> = { Ishika: 'Ishita' };

// Coprime sizes: father or mother and surname never repeat as a pair across the students above.
const SURNAMES = (
  'Agarwal Sharma Jain Mittal Choudhary Yadav Meena Kumawat Shekhawat Khandelwal Poonia Bajaj ' +
  'Singhal Kothari Pareek Dadhich Purohit Nagar Bhargava Tak Swami Lamba Beniwal Dhaka Godara ' +
  'Jangid Rawat Sharda Modi Maheshwari Ranawat'
).split(' ');
const FATHERS = (
  'Rajesh Sunil Mahesh Dinesh Suresh Mukesh Naresh Ashok Vinod Pawan Hemraj Jagdish Kailash Mohan ' +
  'Ravi Sanjay Ajay Vijay Bharat Girish Nitin Pradeep Sandeep Yogesh Lokesh Arvind Bhupendra ' +
  'Devendra Surendra'
).split(' ');
const MOTHERS = (
  'Sunita Anita Kavita Sarita Seema Neelam Poonam Manju Suman Asha Lalita Pushpa Rashmi Vandana ' +
  'Archana Renu Savita Madhu Sangeeta Mamta Nirmala Kiran Alka Geetika Preeti Shilpa Swati'
).split(' ');
const KIN = 'Amit Neeraj Vishal Rakesh Shyam Gopal Bhanu Madan Kishore Anand Tarun Ankit'.split(
  ' ',
);
const COLONIES = [
  'Lotus Residency',
  'Green Park Colony',
  'Shanti Vihar',
  'Sunrise Enclave',
  'Gulmohar Nagar',
  'Ashoka Vihar',
];
const CITIES = ['Sikar', 'Sikar', 'Fatehpur', 'Laxmangarh', 'Jhunjhunu', 'Churu'];
const BOARDS = ['CBSE', 'RBSE', 'ICSE'];
const SCHOOLS = [
  'Bright Future Senior Secondary School',
  'Green Valley Public School',
  'Holy Angels Convent School',
  'Sunrise Academy',
];

const at = <T>(list: readonly T[], i: number) => list[i % list.length]!;
const mailbox = (fullName: string) => fullName.toLowerCase().replace(' ', '.');
const addressOf = (i: number) =>
  `House ${100 + i * 7}, ${at(COLONIES, i)}, ${at(CITIES, i)}, Rajasthan`;
const contact = (fullName: string, phone: number, relationship: 'father' | 'mother') => ({
  fullName,
  relationship,
  email: `${mailbox(fullName)}@example.test`,
  phone: fakePhone(phone),
});

/** A student's or lead's whole record by first name; null for a name not in the table. */
export function samplePerson(first: string) {
  const i = STUDENT_FIRST_NAMES.indexOf(first);
  if (i < 0) return null;
  const f = STUDENT_FIRST_NAMES.indexOf(SAME_FAMILY[first] ?? first);
  const surname = at(SURNAMES, f);
  const fullName = `${first} ${surname}`;
  return {
    fullName,
    email: `${mailbox(fullName)}@example.test`,
    phone: fakePhone(10_000 + i * 3),
    father: contact(`${at(FATHERS, f)} ${surname}`, 10_001 + f * 3, 'father'),
    mother: contact(`${at(MOTHERS, f)} ${surname}`, 10_002 + f * 3, 'mother'),
    dateOfBirth: new Date(Date.UTC(2008, 3, 1 + i * 9)).toISOString().slice(0, 10),
    school: at(SCHOOLS, i),
    board: at(BOARDS, i),
    city: at(CITIES, f),
    address: addressOf(f),
  };
}

/** The same record for a case that must exist in the table. */
export function knownPerson(first: string) {
  const person = samplePerson(first);
  if (!person) throw new Error(`Add ${first} to STUDENT_FIRST_NAMES in seed/sample-people.ts.`);
  return person;
}

/** A staff member's private details by full name; null for a name not in the table. */
export function sampleStaffDetails(fullName: string) {
  const k = STAFF_NAMES.indexOf(fullName);
  if (k < 0) return null;
  return {
    personalEmail: `${mailbox(fullName)}.personal@example.test`,
    personalPhone: fakePhone(50_000 + k * 2),
    address: addressOf(k),
    emergencyContactName: `${at(KIN, k)} ${fullName.split(' ')[1]}`,
    emergencyContactPhone: fakePhone(50_001 + k * 2),
  };
}

/** Every made-up name, for the test that none repeats, reads wrong or is a real person's. */
export const everySampleName = () => [
  ...STAFF_NAMES,
  ...STAFF_NAMES.map((n) => sampleStaffDetails(n)!.emergencyContactName),
  UNMATCHED_TEACHER,
  UNMATCHED_STUDENT,
  ...new Set(
    STUDENT_FIRST_NAMES.flatMap((first) => {
      const p = knownPerson(first);
      return [p.fullName, p.father.fullName, p.mother.fullName];
    }),
  ),
];

/**
 * Logins older seeds linked to real staff. Kept out of demo-accounts.ts on purpose: the release
 * preflight reads that file's addresses, and a real person may use one of these in production.
 */
export const FORMER_DEV_LOGINS = [
  'satish@elevateeducation.in',
  'soma@elevateeducation.in',
  'nikunjbindal@elevateeducation.in',
  'tushar@elevateeducation.in',
];

const SAMPLE_ROW_CREATED = 'sample.row_created';

/**
 * The tables with no is_sample column (schedules, holidays, rooms, branches, events, metric imports)
 * and frozen migrations: a seed records which rows it made here, and db:clear-samples removes those,
 * whatever they are called by then. The audit trail survives the clear, and these ids never recur.
 */
export async function markSampleRows(db: Database, table: string, ids: readonly string[]) {
  if (ids.length)
    await db.insert(auditEvents).values(
      ids.map((entityId) => ({
        actorType: 'system' as const,
        module: 'platform' as const,
        action: SAMPLE_ROW_CREATED,
        entityType: table,
        entityId,
      })),
    );
}

export const sampleRowsSql = (table: string) =>
  `SELECT entity_id::uuid AS id FROM core.audit_events WHERE action = '${SAMPLE_ROW_CREATED}' AND entity_type = '${table}'`;

export const sampleRowIds = async (db: Database, table: string) =>
  (
    await db
      .select({ id: auditEvents.entityId })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, SAMPLE_ROW_CREATED), eq(auditEvents.entityType, table)))
  ).map((r) => r.id!);
