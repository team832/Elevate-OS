# Deployment — outline (status: **Proposed**)

Nothing is deployed (D-013). No host is chosen. How to build, install and check the package, and everything that stands in the way of going live: **`docs/RELEASE.md`** (D-112).

## Topology
Ports in the code: Business Operations 3000, Academic 3001, Marketing 3002, Platform 3003.

What works today is one host with one port per app, each port reachable by the browser:
```
Browser ──▶ one host name
              ├─ :3000 business-ops-os  /ops
              ├─ :3001 academic-os      /academic
              ├─ :3002 marketing-os     /marketing
              └─ :3003 platform         /  (Users & roles, Google sign-in)
                          │
                          ▼
              PostgreSQL 18 (private), backups not yet proven
```

A gateway with only the Platform public **does not work with today's code** (F-05). Each `*_OS_URL` is both the Platform's rewrite target and the address browsers are sent to, the cross-site allowlist and the internal-call address, and the session cookie is host-only, so sub-domains do not share it. A gateway needs a second variable (`*_INTERNAL_URL`), to be written once a host is chosen. The URLs are compiled into each build: a new address needs a new build.

## Build and release
1. CI (not set up): `npm ci` → `npm run validate` → `npm run release:package` with the four addresses the host will really use.
2. Take and verify a database backup. The package's backup script needs `pg_dump` (D-024).
3. From the package: `node bin/preflight.mjs`, then `node db/migrate.mjs` (one-off job). `npm run db:migrate` refuses a non-local database unless given `-- --allow-non-local`; a package does not use it.
4. `node bin/start.mjs`: Ops, Academic and Marketing, then the Platform.
5. `node bin/smoke.mjs`: `/api/health`, `/<zone>/api/v1/health`, sign-in, one page per module, a PDF on three addresses.

## Configuration
- Secrets (`SESSION_SECRET`, `INTERNAL_SERVICE_TOKEN` — for go-live prefer `INTERNAL_SERVICE_TOKENS` with one token per module, so a workspace cannot claim another's identity, D-077 — and `DATABASE_URL`) come from the host's secret store, identical across the four apps; never from a committed file.
- `PLATFORM_URL` = the public HTTPS origin (module apps accept Server Actions from it).
- `NODE_ENV=production` turns on the `Secure` cookie flag unless `PLATFORM_URL` is plain `http://` (office Wi-Fi, D-110). Anywhere public, HTTPS is mandatory.
- The proxy must **overwrite** `X-Forwarded-For`, not append to it: the apps trust that header for sign-in limits and session addresses (API-010, open).

## Must be resolved before go-live
- Shared login rate limiting (current throttle is per process).
- Password reset and account administration screens.
- A scheduler for the jobs (today: buttons on the Business Operations Overview, D-117).
- Log shipping and alerting on 5xx/health.
- Backup schedule, retention and a tested restore.
- Owner sign-off on role mapping of real staff (D-008) and on departments/programmes (D-026).
