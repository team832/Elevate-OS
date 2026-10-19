# Data Dictionary — `core` schema

Source of truth: `packages/database/src/schema/core.ts`. Module schemas (`marketing`, `academic`, `ops`) are documented by their owning teams in `apps/<module>/docs/DOMAIN_MODEL.md`. All `timestamptz` values are UTC instants; "now" defaults use `now()`. `id` columns are `uuid DEFAULT gen_random_uuid()`.

## core.users
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid PK | no | gen_random_uuid() | `UserId` |
| email | text | no | | Lower-case, unique (`users_email_key`, `users_email_lowercase`) |
| display_name | text | no | | Name shown in the UI |
| password_hash | text | yes | | `scrypt$N$r$p$salt$hash`; null = cannot sign in with a password |
| status | text | no | 'active' | `active` \| `disabled` (disabled users cannot sign in; existing sessions stop working) |
| last_login_at | timestamptz | yes | | Last successful sign-in |
| created_at / updated_at | timestamptz | no | now() | |

## core.sessions
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid PK | no | | `SessionId` |
| user_id | uuid → users.id (cascade) | no | | Session owner |
| token_hash | text | no | | `HMAC-SHA256(SESSION_SECRET, token)`, unique; the raw token exists only in the cookie |
| created_at | timestamptz | no | now() | |
| expires_at | timestamptz | no | | Absolute expiry (7 days); must be after `created_at` |
| last_seen_at | timestamptz | no | now() | Refreshed at most every 5 minutes |
| revoked_at | timestamptz | yes | | Set on logout / revoke-all |
| ip_address | text | yes | | First `x-forwarded-for` entry at login |
| user_agent | text | yes | | Truncated to 500 chars |

## core.user_roles
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| user_id | uuid → users.id (cascade) | no | | PK part |
| role | text | no | | One of `ROLE_KEYS` (validated in code); PK part |
| granted_by | uuid → users.id (set null) | yes | | Who granted it |
| granted_at | timestamptz | no | now() | |

## core.departments
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid PK | no | | `DepartmentId` |
| code | text | no | | Unique, `^[A-Z][A-Z0-9_]{1,39}$`, e.g. `ADMISSIONS_COUNSELLING` |
| name | text | no | | e.g. "Admissions & Counselling" |
| description | text | yes | | Primary responsibility |
| status | text | no | 'provisional' | `active` \| `provisional` (legacy suggestion, unconfirmed) \| `archived` |
| created_at / updated_at | timestamptz | no | now() | |

## core.staff_members
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid PK | no | | `StaffMemberId` |
| user_id | uuid → users.id (set null) | yes | | Login account; unique when present |
| full_name | text | no | | |
| department_id | uuid → departments.id (restrict) | yes | | |
| title | text | yes | | Job title |
| manager_id | uuid → staff_members.id (set null) | yes | | Line manager; never self |
| status | text | no | 'active' | `active` \| `on_leave` \| `inactive` |
| created_at / updated_at | timestamptz | no | now() | |

## core.programmes
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid PK | no | | `ProgrammeId` |
| code | text | no | | Unique, e.g. `CLAT`, `COMMERCE_11_12` (used as `programmeCode` in contracts) |
| name | text | no | | |
| description | text | yes | | |
| status | text | no | 'planned' | `active` \| `planned` \| `paused` \| `retired` |
| created_at / updated_at | timestamptz | no | now() | |

## core.approvals
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid PK | no | | `ApprovalId` |
| subject_module | text | no | | `platform` \| `marketing` \| `academic` \| `ops` |
| subject_type | text | no | | e.g. `content_item`, `sop` |
| subject_id | uuid | no | | The item being approved (owned by `subject_module`; no FK) |
| policy | text | no | | Policy key, e.g. `marketing.content.publish` |
| status | text | no | 'pending' | `pending` \| `approved` \| `rejected` \| `withdrawn` |
| requested_by | uuid → users.id (restrict) | no | | Requester |
| requested_at | timestamptz | no | now() | |
| request_comment | text | yes | | Requester's note |
| decided_by | uuid → users.id (restrict) | yes | | Set when approved/rejected |
| decided_at | timestamptz | yes | | Set when approved/rejected/withdrawn |
| comment | text | yes | | Decision comment (required on rejection by default) |

At most one `pending` row per (subject_module, subject_type, subject_id, policy). Rows are never deleted.

## core.audit_events
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid PK | no | | `AuditEventId` |
| at | timestamptz | no | now() | When it happened |
| actor_type | text | no | | `user` \| `system` \| `service` |
| actor_user_id | uuid → users.id (restrict) | yes | | Required when `actor_type='user'` |
| module | text | no | | Module where the action happened |
| action | text | no | | Dotted verb, e.g. `auth.login`, `approval.decided`, `lead.created` |
| entity_type | text | no | | e.g. `session`, `approval`, `lead` |
| entity_id | text | yes | | Id of the entity |
| before / after | jsonb | yes | | State before/after the change |
| request_id | text | yes | | Correlates with logs and the API response |
| metadata | jsonb | yes | | Extra context (policy, decision, …) |

## core.notifications
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid PK | no | | `NotificationId` |
| user_id | uuid → users.id (cascade) | no | | Recipient |
| module | text | no | | Originating module |
| kind | text | no | | e.g. `enrolment.confirmed` |
| title | text | no | | ≤ 300 chars |
| body | text | yes | | |
| link | text | yes | | Relative path (`/ops/…`) |
| entity_type / entity_id | text | yes | | What it is about |
| created_at | timestamptz | no | now() | |
| read_at | timestamptz | yes | | Null = unread |

## core.integration_events
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid PK | no | | `IntegrationEventId` (envelope `id`) |
| type | text | no | | e.g. `ops.admission.enrolment_requested` |
| version | integer | no | | ≥ 1 |
| producer | text | no | | Producing module (from the event definition) |
| idempotency_key | text | no | | Unique per producer |
| occurred_at | timestamptz | no | now() | |
| correlation_id | uuid | yes | | First event in the conversation |
| causation_id | uuid | yes | | Event that caused this one |
| payload | jsonb | no | | Validated against the registry on publish |
| created_at | timestamptz | no | now() | |

## core.event_deliveries
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid PK | no | | |
| event_id | uuid → integration_events.id (restrict) | no | | |
| consumer | text | no | | Consumer name, e.g. `academic.enrolment-intake`; unique with `event_id` |
| status | text | no | | `processed` \| `failed` \| `dead` |
| attempts | integer | no | 1 | Number of tries |
| last_error | text | yes | | Last failure message (≤ 2000 chars) |
| processed_at | timestamptz | yes | | When processed |
| created_at / updated_at | timestamptz | no | now() | |

## core.idempotency_keys
| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| id | uuid PK | no | | |
| scope | text | no | | `METHOD /path`, e.g. `POST /ops/api/v1/leads` |
| key | text | no | | Client's `Idempotency-Key` (8–200 chars) |
| user_id | uuid → users.id (cascade) | yes | | Caller (null for service calls); unique (scope, key, user_id) NULLS NOT DISTINCT |
| request_hash | text | no | | sha256 of the JSON body; a different body with the same key → 409 |
| completed | boolean | no | false | |
| response_status | integer | yes | | Stored status |
| response_body | jsonb | yes | | Stored `data` |
| created_at | timestamptz | no | now() | |
| expires_at | timestamptz | no | | created_at + 24 h |

## Seeded reference data (development, D-026)
- Departments (status `provisional`): LEADERSHIP_OPERATIONS, ADMISSIONS_COUNSELLING, ACADEMICS, CURRICULUM_CONTENT, FACULTY_MANAGEMENT, STUDENT_SUCCESS, EXAMINATIONS, PARENT_COMMUNICATION, MARKETING_GROWTH, FINANCE, HUMAN_RESOURCES, ADMINISTRATION_FACILITIES, TECHNOLOGY_DATA.
- Programmes: CLAT, IPMAT, CUET, COMMERCE_11_12 (`active`); CA_FOUNDATION (`planned`).
- Users: one fictional user per role, `<role-with-hyphens>@example.test`; 8 fictional staff records (auditor has none).
