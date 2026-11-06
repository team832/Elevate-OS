/**
 * What stands between this package and real use, and that no package can fix (release-spec §8).
 * README-RUN.md lists every row. Preflight says which ones apply on this computer and database:
 * `applies` gets { env, db, pgDump }; `db` is null when the database could not be read.
 */
const always = () => true;

export const BLOCKERS = [
  {
    title: 'Real staff cannot sign in without Google',
    why: 'New accounts have no password, and no screen sets or resets one. Until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set, nobody can sign in, including the first administrator.',
    applies: ({ env }) => !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET,
  },
  {
    title: 'No first administrator yet',
    why: 'Nobody can open Users & roles. Put the first administrator\'s @elevateeducation.in address in BOOTSTRAP_OWNER_EMAILS; they get the roles when they first sign in.',
    applies: ({ env, db }) => !env.BOOTSTRAP_OWNER_EMAILS && !db?.hasAdmin,
  },
  {
    title: 'Password reset does not exist',
    why: 'It has not been built. A person who loses a password cannot recover it from a screen.',
    applies: always,
  },
  {
    title: 'A real admission cannot be confirmed yet',
    why: 'Confirming asks for the approver\'s password. A person who signs in with Google has none, and the step refuses rather than skipping the check. The owner has to decide how this should work (decision D-041).',
    applies: always,
  },
  {
    title: 'Reference data is not loaded',
    why: 'Without it nobody can create a lead, a demo or a course. Run: node db/seed-reference.mjs --confirm-database <name>',
    applies: ({ db }) => db !== null && !db.hasProgrammes,
  },
  {
    title: 'The onboarding template and the website fee prices are waiting',
    why: 'Both need a real operations manager as their author. Give someone that role, then run node db/seed-reference.mjs again.',
    applies: ({ db }) => db !== null && !db.hasOnboardingTemplate,
  },
  {
    title: 'Migration 0017 is waiting on this database',
    why: 'Back up first. It adds seven indexes and refuses notification links that hold a control character. Once applied it can never be changed.',
    applies: ({ db }) => Boolean(db?.pending0017 && db.hasNotifications),
  },
  {
    title: 'Migration 0019 is waiting on this database',
    why: 'Uploaded files are kept in the database (decision D-135). Until 0019 is applied, signing in fails (the shared sign-in limit needs it) and uploading a file fails: task files, leave letters, score imports, test papers and keys, and the copy of a feedback import. Back up first.',
    applies: ({ db }) => Boolean(db?.pending0019),
  },
  {
    title: 'One computer address with one port per app is the only arrangement that works',
    why: 'Each *_OS_URL is both where the Platform forwards to and where browsers are sent, and the sign-in cookie belongs to one host name. Sub-domains do not share it, and a gateway with only the Platform public would send browsers to internal addresses.',
    applies: ({ env }) =>
      new Set(
        ['PLATFORM_URL', 'BUSINESS_OPS_OS_URL', 'ACADEMIC_OS_URL', 'MARKETING_OS_URL']
          .filter((name) => env[name])
          .map((name) => new URL(env[name]).hostname),
      ).size > 1,
  },
  {
    title: 'No HTTPS',
    why: 'This package does not provide it. With an http:// address the sign-in cookie is not marked Secure, so use it only on a network you trust. A public address needs an HTTPS proxy in front and a new build.',
    applies: ({ env }) => !env.PLATFORM_URL?.startsWith('https://'),
  },
  {
    title: 'Nothing runs on a schedule',
    why: 'There is no scheduler. Enrolment intake and replies, reaching Academic when a student leaves, follow-up reminders, task reminders, demo marks and clean-up run only when a person presses the button in Business Operations. Who runs them and how often is the owner\'s decision.',
    applies: always,
  },
  {
    title: 'Sign-in limits are not shared',
    why: 'Failed sign-ins are counted separately in each of the four apps and forgotten at restart. The x-forwarded-for address is trusted even when no proxy sets it.',
    applies: always,
  },
  {
    title: 'Backups need pg_dump on this computer',
    why: 'The backup script stops without it. Install the PostgreSQL 18 client tools, or set PG_BIN_DIR.',
    applies: ({ pgDump }) => !pgDump,
  },
  {
    title: 'A restore has never been tried',
    why: 'A backup you have not restored is not proven. Try a restore on a spare database before relying on it.',
    applies: always,
  },
  {
    title: 'Old rows are never removed',
    why: 'The audit trail and the event outbox grow without limit.',
    applies: always,
  },
  {
    title: 'Nobody is alerted when something breaks',
    why: 'Logs go to the logs folder only. No monitoring is set up.',
    applies: always,
  },
  {
    title: 'Nothing leaves the system',
    why: 'Email, publishing and metrics are stand-ins (mock adapters). No email is sent and nothing is published.',
    applies: always,
  },
  {
    title: 'Owner approvals are still open',
    why: 'Role grants marked Proposed, the open questions in HANDOFF.md, and guardian consent under the DPDP Act.',
    applies: always,
  },
];
