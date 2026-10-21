# Things only you can supply

Elevate OS never makes up your business facts. Wherever a fact is missing, the system shows "Not available", "Proposed" or "Open — owner decision needed" until you supply it. This list says what is missing, where it shows up and what to send. The numbered decisions (OD-xxx) are described in full in `docs/EXISTING_PROJECT_AUDIT.md` §9.

## People and organisation
| What is missing | Where it shows | What to send |
|---|---|---|
| Who works at Elevate and in which role | Staff screen (today the seven teachers you named plus sample staff); access is given on **Users & roles** (`/admin/users`, also the Settings link) | Name, department, designation and manager for each person. Say which roles each person should have; nobody gets access until a platform administrator ticks their roles on Users & roles and clicks **Save roles** (OD-009) |
| Department list | Departments (13 provisional departments from the old files) | Confirm, rename or remove them (D-026) |
| Who may see students' private details (phone, address, identity documents) | Student profile, admission check screen ("Details hidden") | Whether the director should see them; today only the operations manager and counsellors for their own students do (OD-048) |
| Who may confirm admissions, verify identity documents and review reports | Final confirmation, KYC, student reports | Names or roles; today director and operations manager confirm, operations manager verifies and reviews (Proposed, D-041) |
| Logo file | Sidebar, sign-in page and every PDF (today a redrawn copy of the logo) | The original logo file (SVG or a large PNG), so the redrawn copy can be checked against it |

## Admissions and fees
| What is missing | Where it shows | What to send |
|---|---|---|
| Programmes and batches you are running in 2026–27 | Programme pickers, admissions | The programme list and batch dates (OD-021, OD-025 CLAT 2027 offer) |
| Tuition per programme | Fee structure and new fee agreements | The yearly fee for each programme or combination. Already decided: split 50 / 25 / 25 (D-039), registration ₹5,000 (D-044), demo ₹1,000 (D-045) |
| Refund and waiver limits; registration fee each year? | Fee screens, terms | Who may approve a refund exception (your terms say fees are non-refundable unless approved in writing); whether registration is charged again each academic year (OD-013) |
| Discounts on a running fee agreement | Student fees tab | One approver, or a second person for every discount (D-057) |
| Demo limits | Demo bookings (₹1,000 and 3 demo days are decided, D-038, D-045) | Who may add extra demo days, who may correct attendance, whether a paid demo fee is credited automatically on joining (OD-012) |
| Onboarding checklist | New student checklist (items say "(proposed)") | The items, due days and who does each one; books per programme |
| Reasons for closing an enquiry | Close/withdraw options | Confirm the reason list (OD-046) |

## Targets and reports
| What is missing | Where it shows | What to send |
|---|---|---|
| Targets for the dashboards | Dashboard rates show values but no target | Target numbers for conversion and follow-ups (OD-027) |
| Who receives student and parent reports, and whether teacher names appear | Student reports (staff-only today) | Audiences and wording (OD-023) |
| Draft syllabus courses | Academic → Curriculum (five courses marked draft) | Approve the course codes; CA chapter weights (D-051) |

## Accounts that need you (when we make it live)
| Account | Why it needs you | When |
|---|---|---|
| Hosting account | It must be in your name and may need a card on file | At go-live |
| First administrator | Put your own @elevateeducation.in email in `BOOTSTRAP_OWNER_EMAILS` in the live `.env`, so you become the first administrator when you sign in. Then open Users & roles and give everyone else their roles | At go-live |
| Database account | Holds all the data; must be in your name | At go-live |
| Email / SMS / WhatsApp service | So the system can send reminders, event invitations and end-of-day reports (today it records them and sends nothing) | When you want messages sent |
| Shared look-around account `team@elevateeducation.in` | Exists on this computer only, read-only; its password was typed in chat, so it must be changed (steps in `HANDOFF.md`) | Now |
| Document storage | So staff can upload documents (today only references are recorded) | When you want uploads |
| Attendance device or app | Only if you use a biometric device; today attendance is entered by hand or by spreadsheet upload | Optional |
| Publishing tool (Metricool or similar) and YouTube key | So Marketing can publish and read numbers | Marketing go-live |
