# Things only you can supply

Elevate OS never makes up your business facts. Wherever a fact is missing, the system shows "Not available", "Proposed" or "Open — owner decision needed" until you supply it. This list says what is missing, where it shows up and what to send. The numbered decisions (OD-xxx) are described in full in `docs/EXISTING_PROJECT_AUDIT.md` §9.

## People and organisation
| What is missing | Where it shows | What to send |
|---|---|---|
| Who works at Elevate and in which role | Staff screen (today the seven teachers you named plus sample staff); access is given on **Users & roles** (`/admin/users`, also the Settings link) | Name, department, designation and manager for each person. Say which roles each person should have; nobody gets access until a platform administrator ticks their roles on Users & roles and clicks **Save roles** (OD-009) |
| Department list | Departments (13 provisional departments from the old files) | Confirm, rename or remove them (D-026) |
| Who may see students' private details (phone, address, identity documents) | Student profile, admission check screen ("Details hidden") | Whether the director should see them; today only the operations manager and counsellors for their own students do (OD-048) |
| How real staff sign in and confirm admissions | Sign-in, final confirmation. New accounts have no password and no screen sets one | Google sign-in again for confirming, or a set-password screen (D-041). Without one of these no real admission can be confirmed |
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
| How often each background job runs | Since 6 Nov 2026 the jobs can run by themselves, but every one is off until someone switches it on in Settings → Background jobs. Until then an exit reaches Academic, and reminders go out, only when someone presses Run now (D-133) | Now: how often each should run, then switch them on |
| Certificate wording (6 Nov 2026) | Certificates (`/ops/certificates`, student record). Nothing can be issued until you approve it | Approve or change the drafted course completion and bonafide wording, and add any other type (D-139; HANDOFF Q9) |
| Consent wording for logins of students under 18 (6 Nov 2026) | Student record → Portal access. No student under 18 can get a login until you approve it | Approve or change the drafted wording, ideally after a lawyer reads it (DPDP Act 2023; D-150; HANDOFF Q41) |
| Website form consent wording and your website address (6 Nov 2026) | The enquiry form `/ops/enquire` stays closed until you approve the wording | Approve or change the drafted wording; the address of any website that will send enquiries (D-152; HANDOFF Q46, Q47) |
| Salary components and leave allowances (6 Nov 2026) | Payroll and HR → Leave allowances show nothing until they are added | The earnings and deductions that make up a salary, and how many days of each leave type each person gets (D-151, D-149; HANDOFF Q14, Q25) |
| Admit card instructions and receipt number format (6 Nov 2026) | Admit cards and fee receipts use drafted text and `ER/2026-27/000001` | Confirm or change them (D-140, D-138; HANDOFF Q5, Q10) |
| The address the system will live at | The four addresses are built into the package, so a new address needs a new build (`docs/RELEASE.md`) | At go-live |
| Attendance device or app | Only if you use a biometric device; today attendance is entered by hand or by spreadsheet upload | Optional |
| Publishing tool (Metricool or similar) and YouTube key | So Marketing can publish and read numbers | Marketing go-live |
