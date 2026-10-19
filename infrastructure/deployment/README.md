# Deployment — outline (status: **Proposed**)

Nothing is deployed (D-013). This is the intended shape, to be approved by the owner and implemented in a later wave.

## Topology
```
Internet ──HTTPS──▶ reverse proxy / load balancer (TLS)
                        │
                        ▼
                 platform app (next start, :3000)  ── only public service
                   │ rewrites (private network)
       ┌───────────┼──────────────┐
       ▼           ▼              ▼
 marketing-os  academic-os  business-ops-os   (next start :3001/:3002/:3003, not public)
       └───────────┴──────┬───────┘
                          ▼
              Managed PostgreSQL ≥ 17 (private), daily backups + point-in-time recovery
```

## Build and release
1. CI: `npm ci` → `npm run validate` → `npm run build` (set `MARKETING_OS_URL`, `ACADEMIC_OS_URL`, `BUSINESS_OPS_OS_URL` to the **internal** module URLs at platform build time — rewrites are compiled into the build).
2. Take and verify a database backup.
3. `npm run db:migrate` against production (one-off job).
4. Start the four apps with `NODE_ENV=production` (`npm run start -w <app>`), module apps first.
5. Smoke test: `/api/health`, `/<zone>/api/v1/health`, sign-in, one page per module.

## Configuration
- Secrets (`SESSION_SECRET`, `INTERNAL_SERVICE_TOKEN`, `DATABASE_URL`) come from the host's secret store, identical across the four apps; never from a committed file.
- `PLATFORM_URL` = the public HTTPS origin (module apps accept Server Actions from it).
- `NODE_ENV=production` turns on the `Secure` cookie flag — HTTPS is mandatory.

## Must be resolved before go-live
- Shared login rate limiting (current throttle is per process).
- Password reset and account administration screens.
- A scheduler for outbox consumers.
- Log shipping and alerting on 5xx/health.
- Backup schedule, retention and a tested restore.
- Owner sign-off on role mapping of real staff (D-008) and on departments/programmes (D-026).
