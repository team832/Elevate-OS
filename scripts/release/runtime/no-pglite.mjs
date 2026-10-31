// Stands in for @electric-sql/pglite in db/seed-reference.mjs: the package only ever talks to PostgreSQL.
export const types = {};
export class PGlite {
  constructor() {
    throw new Error('PGlite is not part of the release package; DATABASE_URL must be postgres://.');
  }
}
