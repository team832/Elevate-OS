# Public course catalog research: elevateeducation.in

Status: **Proposed**. Research draft only. Nothing here is approved catalog data (`approval_status: "unverified"` everywhere).
Last verified: **2026-10-20**. Machine-readable draft: `apps/business-ops-os/seed/catalog-research.json` (no seed script reads it).

What this note covers: what Elevate Education's public website says about its courses, kept separate from (a) university programmes listed in its College Directory, (b) exams and (c) school subjects. It also maps the owner's own course names to the site's wording and lists the questions only the owner can answer.

---

## 1. Method

**Tools actually used**

| Tool | Result |
|---|---|
| Firecrawl `firecrawl_scrape` (url mode, `maxAge: 0`) | Two calls, both failed: "Insufficient credits". No page content came from Firecrawl. |
| WebFetch | One call on `/course-finder`. It returned only the page title. The site is a client-side React app, so the server HTML is an empty shell. |
| `curl` (Git Bash) | HTTP status for every page, raw HTML, the site's JavaScript bundle `/static/js/main.acb9ea3f.js` (route list, menu config, College Directory data for pages 2–4), and `/sitemap.xml`. |
| Local headless Google Chrome, command line (`chrome.exe --headless=new --dump-dom`) | Rendered each page so the text a visitor sees could be read. This is the plain Chrome binary run from the shell, **not** the Claude in Chrome extension. |
| Small local Node script | Turned the rendered HTML into text and a link list. |

**About HTTP 200:** the server returns `200` with the same 7,957-byte shell for every path, including a made-up one (`/nonexistent-xyz` → 200). So "200" does not prove a page exists. The "Rendered" column below records whether real page content appeared after JavaScript ran.

**How pages were found:** top menu (IIM / IPMAT → `/ipmat`, CLAT → `/clat`, CUET → `/commerce-cuet`, Courses → `/course-combinations`, Blog → `/blog`), footer Quick Links, the route list in the site's own code, and `sitemap.xml`. Five landing pages (`/cuet-coaching`, `/ipmat-coaching`, `/commerce-coaching`, `/ca-foundation-coaching`, `/online-coaching`) and the `/course/:id` detail pages are **not linked from any menu, footer or page** I rendered; they open only by direct URL. They are included because they are live public pages with course details, and flagged as unlinked.

**Pages visited (22, all on 2026-10-20)**

| # | URL | HTTP | Rendered | Linked from menu/footer |
|---|---|---|---|---|
| 1 | https://elevateeducation.in/ | 200 | Yes | — |
| 2 | https://elevateeducation.in/course-finder | 200 | Yes | Footer |
| 3 | https://elevateeducation.in/college-directory | 200 | Yes (page 1 of 4; pages 2–4 read from site code) | Footer |
| 4 | https://www.elevateeducation.in/privacy-policy | 200 (curl, shell only) | Rendered at the non-www URL https://elevateeducation.in/privacy-policy | Footer |
| 5 | https://elevateeducation.in/blog/ca-foundation-after-12th | 200 | Yes | Blog index |
| 6 | https://elevateeducation.in/blog/best-subjects-for-commerce | 200 | Yes | Blog index |
| 7 | https://elevateeducation.in/ace-batch | 200 | Yes | Footer, homepage |
| 8 | https://elevateeducation.in/course-combinations ("Course Packages") | 200 | Yes | Menu "Courses", footer |
| 9 | https://elevateeducation.in/ipmat | 200 | Yes | Menu "IIM / IPMAT" |
| 10 | https://elevateeducation.in/clat | 200 | Yes | Menu "CLAT" |
| 11 | https://elevateeducation.in/commerce-cuet | 200 | Yes | Menu "CUET" |
| 12 | https://elevateeducation.in/cuet-handbook | 200 | Yes | Footer |
| 13 | https://elevateeducation.in/results | 200 | Yes | Footer |
| 14 | https://elevateeducation.in/blog | 200 | Yes | Menu "Blog" |
| 15 | https://elevateeducation.in/commerce-coaching | 200 | Yes | Not linked |
| 16 | https://elevateeducation.in/ca-foundation-coaching | 200 | Yes | Not linked |
| 17 | https://elevateeducation.in/cuet-coaching | 200 | Yes | Not linked |
| 18 | https://elevateeducation.in/ipmat-coaching | 200 | Yes | Not linked |
| 19 | https://elevateeducation.in/online-coaching | 200 | Yes | Not linked |
| 20 | https://elevateeducation.in/course/cuet | 200 | Yes | Not linked |
| 21 | https://elevateeducation.in/course/clat | 200 | Yes | Not linked |
| 22 | https://elevateeducation.in/course/ca-foundation and https://elevateeducation.in/course/11th-commerce | 200 | Yes | Not linked |

Not visited: `/course/ipm-jipmat`, `/course/iim-bangalore-ug`, `/course/ca-inter`, `/course/12th-commerce` (the site's code shows the last two redirect to `/course/ca-foundation` and `/course/11th-commerce`; the first two are covered as sub-sections of `/course/cuet`), and the 11 other blog posts. `/analytics` is an admin login and was not opened.

---

## 2. Findings per page

Faculty names appear on several pages; they are not copied here because faculty is outside the catalog. Testimonials on `/results` are unnamed ("ACE Batch Student"). No student names were collected.

### Homepage `/`
- Positioning (page title): "India's Premier Commerce & Entrance Exam Coaching — ACE Batch".
- Three paths: **IIM Entrances** ("IPMAT Indore, Rohtak, JIPMAT, IIM Bangalore UG"), **CLAT** ("22 NLUs including NLSIU Bangalore, NALSAR, NLU Delhi"), **Commerce + CUET** ("Delhi University, BHU, and 200+ universities"). Then: "Want it all? Try the ACE Batch — Commerce + IPMAT + CUET".
- Mode: "100% Online, Live & Interactive" and "No recorded lectures—every session is live".
- Says the ACE Batch "covers Commerce boards alongside entrance exam prep"; mentions CLAT only as a target exam within an "integrated curriculum".
- Structured data (schema.org, in page head) lists three courses: "CA Foundation Coaching", "CA Intermediate Coaching", "11th & 12th Commerce".
- Lead form "Current Class" options: Class 10th, Class 11th, Class 12th, "12th Pass / Dropper", In College.
- Contact shown: phone, `elevatesikar@gmail.com`, WhatsApp, Instagram. Footer: "A unit of Zeromiles Digital (India) Pvt Ltd". No centre address or city is listed as a teaching location.

### ACE Batch `/ace-batch`
- "The ACE Batch — Advanced Commerce & Entrance". Quote: "India's most comprehensive online program covering Commerce Boards, CUET, and IPMAT".
- Contents: Commerce Boards (11th & 12th): Accountancy, Business Studies & Economics; CUET (domain subjects, language section, general aptitude); IPMAT (quantitative, verbal, logical reasoning); live classes; mock tests; doubt support.
- Three packages, each "Unlock Pricing / Verify to see exclusive rates" and "Call to Enroll": **COMMERCE + CUET**, **THE ACE BATCH (Commerce + IPMAT + CUET)**, **IPMAT INTENSIVE (IPMAT Only)**. "Exclusive batch — Phone enrollment only".
- Dates, duration, schedule, location: not found.

### Course Packages `/course-combinations`
- Same three packages: "Commerce + CUET Batch", "The ACE Batch", "IPMAT Intensive". Commerce + CUET card lists "11th & 12th Commerce (Accounts, BST, Economics, Maths)".
- "What's Included in Every Batch": "100% Online. Learn from anywhere in India. Live classes, not recorded lectures."
- No CLAT or CA package on this page.

### IIM / IPMAT `/ipmat`
- Guide page: "DIRECT ENTRY TO IIMs", "IPMAT Indore • IPMAT Rohtak • JIPMAT • IIM Bangalore UG". Exam-pattern tabs for those four. Lists IIMs with entrance exam and average packages (third-party outcome figures; not imported).
- Calls to action are counselling ("Get Free Guidance"), not a named batch.

### IPMAT coaching `/ipmat-coaching` (unlinked)
- Course name in page data: "IPMAT Intensive Coaching". Covers Quantitative Ability, Verbal Ability, Logical Reasoning, full-length mocks, interview preparation.
- FAQ: "Our intensive batch can prepare you in 4-5 months if you're starting with a decent math foundation." Buttons go to `/ace-batch`.

### CLAT `/clat`
- Guide page: "CLAT PREPARATION — YOUR PATH TO TOP LAW SCHOOLS". Lists NLUs, a CLAT pattern, law careers, a suitability checklist.
- Actions: "Get Free Guidance", "Talk to a CLAT Counselor", "Get Free Counseling". **No batch, package, duration or price.**

### CLAT course `/course/clat` (unlinked)
- "CLAT (Common Law Admission Test)", category "Law Entrance". Quote: "CLAT opens doors to 25 National Law Universities (NLUs)".
- Course Duration "8-12 Months"; Batch Size "Limited Seats"; Mode "Offline (Face-to-Face)"; Eligibility "12th Pass (Any Stream) with 45% marks (40% for SC/ST)"; "Call to Enroll".
- Section-wise syllabus for English, Current Affairs & GK, Legal Reasoning, Logical Reasoning, Quantitative Techniques.

### CUET `/commerce-cuet`
- "COMMERCE + CUET — YOUR PATH TO SRCC & DU". CUET subject priorities: Accountancy, Business Studies, Economics, Mathematics, English (Mandatory), General Test ("For BMS/BBA"). Preparation timeline Jun–Oct / Nov–Feb / Mar–May. Lists colleges with degree names (these are college programmes, not Elevate courses).

### CUET coaching `/cuet-coaching` (unlinked)
- "CUET 2026 PREPARATION". Course name in page data: "CUET Coaching Programme". Subjects covered: Accountancy, Business Studies, Economics, Mathematics, English Language, General Aptitude (GAT). Stat strip says "100% Online & Live".
- Says it covers "all domain subjects" but lists only the four commerce subjects.

### CUET & IIM Entrance `/course/cuet` (unlinked)
- "CUET & IIM Entrance", category "University & Management Entrance". Quote: "Complete preparation for CUET, IPM, JIPMAT and IIM Bangalore UG."
- Course Duration "6-12 Months"; Mode "Offline (Face-to-Face)"; Eligibility "12th Pass (Any Stream)".
- Sub-courses (from the site data behind the page): **CUET (UG)** 6-8 Months; **IPM & JIPMAT** 8-10 Months; **IIM Bangalore UG** 12-18 Months, eligibility "Class 12 with Mathematics (Age ≤ 20 years)", described as preparation for IIMB's "4-year BSc Honours programs in Economics and Data Science", test "IIMB UG-AT". Its dates ("December 13, 2025", deadline "November 20, 2025") are past.

### Commerce coaching `/commerce-coaching` (unlinked)
- "COMMERCE BOARDS". Course name in page data: "Commerce Board Coaching (11th & 12th)". Subjects: Accountancy, Business Studies, Economics, Mathematics, with Class 11 and Class 12 topic lists.
- FAQ prices: "Commerce + CUET batch (₹10,000/month)", "The ACE Batch (₹12,000/month)". FAQ: "Can I join for Class 11?" "Yes."
- FAQ: "All live sessions are recorded and available for review." Stat strip claims "99% Board Pass Rate" (unsourced; not imported).

### 11th & 12th Commerce `/course/11th-commerce` (unlinked)
- "11th & 12th Commerce", category "Board Preparation", Course Duration "2 Years", Mode "Offline (Face-to-Face)", "Call to Enroll".
- Sub-courses: **11th Commerce** (1 Year, eligibility "Completed 10th Grade") and **12th Commerce** (1 Year, eligibility "Completed 11th Commerce").

### CA Foundation coaching `/ca-foundation-coaching` (unlinked)
- "CA FOUNDATION — Begin Your CA Journey." Four papers: Accounting; Business Laws & BCR; Quantitative Aptitude; Business Economics. "ICAI-Aligned Mock Tests". Exam frequency stated as "Twice a year (May/June & November/December)".
- FAQ says the Commerce + CUET batch "covers 60% of CA Foundation syllabus". Buttons go to `/ace-batch`. No CA batch price or duration.

### CA Foundation & CA Inter `/course/ca-foundation` (unlinked)
- "CA Foundation & CA Inter", category "Chartered Accountancy". Course Duration "2-3 Years (Combined)"; Mode "Offline (Face-to-Face)".
- Sub-courses: **CA Foundation** 4-6 Months, eligibility "12th Pass (Any Stream) - Register after Class 10th"; **CA Intermediate** 8-12 Months, eligibility "CA Foundation Pass / Graduate (Commerce: 55%+ | Non-Commerce: 60%+)". Describes exams "three times a year" (conflicts with the page above). CA Final: not found.

### Online coaching `/online-coaching` (unlinked)
- "100% ONLINE". FAQ: "Starting at ₹10,000/month for Commerce + CUET." Says every session is recorded for revision.

### Course Finder `/course-finder`
- A tool, not a course: "CUET 2026 Course Finder". Visitor picks up to 5 CUET subjects (Languages List A, Domain List B in Commerce / Science & Tech / Arts & Social / Vocational, and GAT) and sees eligible university courses and colleges. Includes an "Exam Calendar 2026" (Christ ET, MAH CET, SET-1/2, IPMAT Indore, IPMAT Rohtak, CUET).
- The full CUET subject list here describes the **exam**, not what Elevate teaches.

### College Directory `/college-directory`
- 45 institutions, filterable by exam, course type (IPM, BBA, BSc, BMS, BS, B.Com, BA, MA, BAF, Law) and city. Each card: programmes offered, entrance exams, "Expected Cutoff", "Test Deadlines", external website link.
- These are **university/college programmes and admission routes**, category (b). Full list in the JSON under `external_programs`. None of them is an Elevate batch.
- Page text: "At Elevate Education, we prepare you for these prestigious institutions with expert coaching and counseling!"

### CUET Handbook `/cuet-handbook`
- Study roadmap in four phases (Mar 29 – May 31) and exam tips. Offers "Live Classes, Mock Tests, Doubt Sessions, Performance Analysis". These phase dates describe a study plan, not a published batch schedule.

### Results `/results`
- Claims: "Record SRCC Selections", "240+ Avg. CUET Score", "100% Student Satisfaction". No sources. Three anonymous quotes. Not imported.

### Blog `/blog` and the two required posts
- 13 posts (December 2025): tags CLAT (3), IPMAT (2), CUET (2), Career Guide (2), College Guide, Elevate, CA, Education.
- `/blog/ca-foundation-after-12th`: CA Foundation eligibility (Class 12 pass, register with ICAI, appear after 4 months), four-paper pattern, pass criteria 40% per paper / 50% aggregate, a suggested CUET-then-CA timeline. Ends with a link to the ACE Batch. It does not name a separate CA batch.
- `/blog/best-subjects-for-commerce`: core Commerce subjects "Accountancy", "Business Studies", "Economics", "English", plus a fifth-subject choice (Mathematics, Informatics Practices, Physical Education, Entrepreneurship). Advice content; these are **school subjects**, category (d), not Elevate courses.

---

## 3. Proposed normalised catalog shape

Each entity keeps `aliases` (original site text, never rewritten), `source_url(s)`, `last_verified`, `confidence` (`stated` | `inferred`) and `approval_status: "unverified"`.

| Entity | What it is | Key fields | Must not contain |
|---|---|---|---|
| `program` | An Elevate-run coaching product (e.g. ACE Batch) | `code`, `display_name`, `aliases[]`, `components.exam_types[]`, `components.subjects[]`, `cohort_types[]`, `mode_stated[]`, `price_stated[]`, `duration_stated`, `dates_stated`, `linked_from_navigation`, `maps_to_core_programme` | College degrees |
| `course_offering` | One sellable unit inside a program, as the site describes it | `program_code`, `display_name`, `cohort_type`, `exam_type`, `duration_stated`, `eligibility_stated`, `mode_stated`, `batch_size_stated` | Invented dates, fees, faculty |
| `subject` | A school/exam subject | `code`, `display_name`, `aliases[]`, `stages[]`, `used_for[]` (exam codes) | Programmes |
| `cohort_type` | Who the student is by stage: Class 10, Class 11, Class 12, 12th Pass / Dropper, In College | `code`, `display_name`, `aliases[]` | Exams |
| `exam_type` | An exam a student sits (CUET, IPMAT Indore, CLAT, CA Foundation, Commerce boards) | `code`, `display_name`, `aliases[]` | Batches |
| `external_program` | A degree at a university/college (College Directory) | `institution`, `city`, `programs[]`, `exams[]` | Any link implying Elevate runs it |

`maps_to_core_programme` points at the codes already seeded in `packages/database/src/seed/core-seed.ts` (`CLAT`, `IPMAT`, `CUET`, `COMMERCE_11_12`, `CA_FOUNDATION`). New codes in the JSON follow the existing format rule `^[A-Z][A-Z0-9_]{1,39}$`. Turning this into tables belongs to Academic OS (steward of `core.programmes`); this note does not change any schema.

### Normalised catalog (Elevate's own programmes, category a)

| Code | Site display name | Exams covered | Cohort | Mode as stated | Price as stated | Duration as stated | In menu? | Confidence |
|---|---|---|---|---|---|---|---|---|
| `ACE_BATCH` | The ACE Batch | Commerce boards, CUET, IPMAT | not found (includes "11th & 12th" boards) | Online | "Unlock Pricing"; ₹12,000/month in one FAQ | not found | Yes | stated |
| `COMMERCE_CUET_BATCH` | Commerce + CUET Batch | Commerce boards, CUET | not found (includes "11th & 12th Commerce") | Online | "Unlock Pricing"; ₹10,000/month in two FAQs | not found | Yes | stated |
| `IPMAT_INTENSIVE` | IPMAT Intensive | IPMAT | not found | Online | "Unlock Pricing" | not found (FAQ: "4-5 months" with math base) | Yes | stated |
| `COMMERCE_BOARD_COACHING` | Commerce Board Coaching (11th & 12th) / 11th & 12th Commerce | Commerce boards | Class 11, Class 12 | Online (landing page) vs "Offline (Face-to-Face)" (detail page) | not found | 2 Years (1 Year each) | No | inferred (may be a landing page, not a batch) |
| `CA_FOUNDATION_INTER` | CA Foundation & CA Inter | CA Foundation, CA Intermediate | not found | "Offline (Face-to-Face)" | not found | 2-3 Years combined; 4-6 / 8-12 Months | No | stated |
| `CUET_IIM_ENTRANCE` | CUET & IIM Entrance | CUET (UG), IPMAT, JIPMAT, IIM Bangalore UG | not found ("12th Pass (Any Stream)") | "Offline (Face-to-Face)" vs "100% Online & Live" (/cuet-coaching) | not found | 6-12 Months; 6-8 / 8-10 / 12-18 Months | No | stated |
| `CLAT_COURSE` | CLAT (Common Law Admission Test) | CLAT | not found ("12th Pass (Any Stream) with 45% marks…") | "Offline (Face-to-Face)" | not found | 8-12 Months | No (menu "CLAT" goes to a guide page) | stated |

Start dates, schedules, timings, centres, faculty assignment, seat counts: **not found** for every programme. Outcome claims (pass rates, average scores, satisfaction, placements) are excluded on purpose.

### Exams (category c) and subjects (category d)
- Exams Elevate states it prepares for: CUET (UG); IPMAT Indore; IPMAT Rohtak; JIPMAT; IIM Bangalore UG (IIMB UG-AT); CLAT; CA Foundation; CA Intermediate; Commerce boards (11th & 12th; board name not found).
- Exams that appear only as College Directory filters (no Elevate coaching stated): JEE Main, IIMB BSc Entrance Test, IIMB DBE Entrance Test, IIMK BMS AT, SAT, ACT, NPAT, H-CET, MAH CET, XET, SET, Christ University Entrance Test, AILET, SLAT, LSAT India, CUET / DU LLB Entrance.
- Subjects Elevate states it teaches: Accountancy, Business Studies, Economics, Mathematics (boards and CUET); English Language and General Aptitude Test (CUET).

### Contradictions on the site (do not resolve silently)

| Topic | Says A | Says B |
|---|---|---|
| Mode | Home, Course Packages, /online-coaching: online, "100% Online" | Every `/course/*` page: "Offline (Face-to-Face)" |
| Price | Package cards: "Unlock Pricing" | FAQs: ₹10,000/month and ₹12,000/month |
| Recordings | Home: "No recorded lectures" | /commerce-coaching, /online-coaching: sessions are recorded for review |
| CLAT | /clat: English "28-32 Qs", "22" NLUs | /course/clat: English "22-26 Questions", "25" NLUs |
| IPMAT Indore pattern | /ipmat: SA 15, MCQ 30, VA 45 | /ipmat-coaching: MCQ 40, SA 20, VA 40 |
| CA Foundation | "Twice a year" | "three times a year" |
| Dates | /course/cuet IIMB UG dates are in 2025 | Past as of 2026-10-20 |
| Internal vs public | Internal seed: `CA_FOUNDATION` is `planned` (paused; 1 March 2027 start) | Public site advertises CA Foundation coaching now |

---

## 4. Owner's terms vs site evidence

| Owner's term | Supported by site? | Exact site wording | Notes |
|---|---|---|---|
| CLAT | Partly | "CLAT", "CLAT PREPARATION", "CLAT (Common Law Admission Test)" | Only the unlinked `/course/clat` page presents an enrollable CLAT course (8-12 Months, Offline). The menu page `/clat` is a guide with counselling buttons. Not in Course Packages. |
| IPMAT | Yes | "IPMAT Intensive", "IPMAT Intensive Coaching", "IPMAT Indore", "IPMAT Rohtak", "IPM & JIPMAT"; also inside "The ACE Batch" | Clear. |
| "IAM IP mat" | Wording not found | — | **Owner confirmation needed.** Candidate 1: "IIM IPMAT", matching the menu label "IIM / IPMAT" and the homepage card "IIM Entrances: IPMAT Indore, Rohtak, JIPMAT, IIM Bangalore UG". Candidate 2: "IPM", the IIM Integrated Programme in Management (course) rather than the IPMAT exam; the site uses "IPM & JIPMAT" and "Integrated Programme in Management (IPM)". Not renamed. |
| "IMBUG" | Wording not found | — | **Owner confirmation needed.** Candidate 1: "IIM Bangalore UG" (site label on `/ipmat` and `/course/cuet`), which the site ties to IIMB's BSc (Hons) Economics / Data Science and the "IIMB UG-AT" test. Candidate 2: IIM Bangalore BBA DBE; it appears only in the College Directory ("IIM Bangalore - BBA DBE (Online)", "IIMB DBE Entrance Test"), and no Elevate coaching page names DBE. Not renamed. |
| CUET | Yes | "Commerce + CUET Batch", "CUET Coaching Programme", "CUET (UG)", "CUET & IIM Entrance" | Taught subjects listed are commerce domain subjects, English and GAT. No science or humanities CUET subjects are listed as taught. |
| Regular Class 11 | Partly; "Regular" not used | "11th Commerce", "Class 11th", "Commerce Boards (11th & 12th)" | Commerce stream only. FAQ: "Can I join for Class 11?" "Yes." |
| Regular Class 12 | Partly; "Regular" not used | "12th Commerce", "Class 12th" | Commerce stream only. |
| Dropper/Repeater | Lead form only | "12th Pass / Dropper" (a "Current Class" option) | No dropper batch. "Repeater" not found. |
| CA | Yes (Foundation and Intermediate) | "CA Foundation Coaching", "CA Intermediate Coaching", "CA Foundation & CA Inter" | CA Final not found. Conflicts with internal `planned` status. |
| Commerce | Yes | "Commerce Board Coaching (11th & 12th)", "COMMERCE BOARDS", "11th & 12th Commerce", "COMMERCE + CUET" | Subjects: Accountancy, Business Studies, Economics, Mathematics. |

Treat Class 11, Class 12 and Dropper as **cohort types** that can attach to any programme, not as exams or programmes.

---

## 5. Owner answers (20 Oct 2026) and what is still open

Answered by the owner on 20 Oct 2026 (recorded as D-034):
- **"IAM IP mat"** = IPM / IPMAT, IIM Indore. Catalogue code `IPMAT`.
- **Mode**: classes run online and offline, both at the Sikar centre.
- **CLAT**: a batch Elevate sells.
- **Combinations a student can join** (catalogue codes, `apps/business-ops-os/src/domain/catalog.ts`): Class 11 + CLAT, Class 12 + CLAT, CLAT only; Class 11 + IPMAT, Class 12 + IPMAT; Class 12 + CA Foundation; Class 11 + CUET, Class 12 + CUET; Class 11 alone, Class 12 alone. The owner wrote "CAT" in the CLAT line; it is read as CLAT because the sentence is about the CLAT batch.
- **Teacher names**: all correct as supplied. The public site (`/ace-batch`, checked 20 Oct 2026 with the Chrome extension via Google results) spells "Satish Raghuvanshi".
- **SSRN**: out of scope; not modelled.

Follow-up research on "IMBUG" (Chrome extension, Google results, 20 Oct 2026). The owner did not list it among the combinations, so it is not a catalogue programme.
- Most likely meaning: **IIMB UG**, the IIM Bangalore Undergraduate Programme: BSc (Hons) in Data Sciences and in Economics, about 80 seats, selected through the IIMB UG Admissions Test (15 Nov 2026, tentative) and interviews. Sources are Google snippets of `ug.iimb.ac.in` and `iimb.ac.in`; the extension was not permitted to open `ug.iimb.ac.in` itself.
- Elevate's homepage card lists "IIM Bangalore UG" under IIM Entrances, so it falls under the existing `IPMAT` (IIM entrances) programme description, not a batch of its own.
- The College Directory also lists "IIM Bangalore - BBA DBE (Online)" (IIMB DBE Entrance Test). That is a college programme, not an Elevate batch.

Answered by the owner on 21 Oct 2026 (D-037): IIMB UG-AT is coached inside the IPMAT batch (its syllabus finishes earlier); Class 11 and Class 12 are complete Commerce batches, Commerce only; there is a dropper batch for every exam (CLAT, IPMAT incl. IIMB UG-AT, CUET, CA Foundation); CA Foundation is running now; admission numbers run 001, 002, 003.

Still open:
1. Are "Commerce Board Coaching", "CUET Coaching Programme", "CA Foundation Coaching" and "CUET & IIM Entrance" separate batches, or pages leading to the three packages (ACE Batch, Commerce + CUET, IPMAT Intensive)?
2. Is CA Intermediate offered (the site advertises it)?
3. Prices and durations on the site: current? They stay unverified.
4. Should stale public content (IIMB UG dates, exam patterns) go to the website team?

---

## 6. Privacy-policy notes

Source: https://www.elevateeducation.in/privacy-policy (rendered at https://elevateeducation.in/privacy-policy), "Last updated: December 2025". Paraphrased:

- **Who:** Elevate Education, a unit of Zeromiles Digital (India) Pvt Ltd.
- **Data collected when someone registers for counselling, enrols or makes contact:** full name, mobile number, email, course preferences and academic details, preferred counselling date and time.
- **Collected automatically:** browser, operating system, IP address and approximate location, pages visited and time spent, referring site.
- **Uses:** handle registration and counselling bookings, send course/schedule updates, send promotional messages "with your consent", improve the site, analyse traffic, meet legal duties.
- **Tracking:** essential cookies, analytics (PostHog), advertising via Meta Pixel. The Pixel records page views, button clicks and form submissions, and Meta processes that data for targeted ads on Facebook and Instagram.
- **Sharing:** not sold; shared with service providers (e.g. email, analytics), Meta (advertising) and legal authorities when required.
- **Retention:** kept as long as needed for the purpose and legal/accounting requirements; registration data kept for the coaching engagement plus "a reasonable period".
- **Rights:** access/copy, correction, deletion, withdraw promotional consent, object to processing; requests go to `elevatesikar@gmail.com`.
- **Minors and guardians:** services are for "students and their parents/guardians". The policy says it does not knowingly collect data from **children under 13** without parental consent, and asks people to report it if that happens. It says nothing specific about students aged 13–17 or how guardian consent is recorded.

**Relevance for the internal app (for the owner to decide; not legal advice):**
- The public lead form asks for "Current Class" with Class 10th, 11th and 12th, so most leads that reach the internal app will be about minors. The policy's under-13 threshold is narrower than India's DPDP Act 2023, which treats anyone under 18 as a child and requires verifiable parental consent. The owner should decide how guardian consent is captured and stored before leads are imported (record with `elevate-record-decision`).
- Catalog data (programmes, exams, subjects) contains no personal data. Keep catalog seed files free of student, guardian or faculty personal details.
- The policy mentions consent for promotional messages; the internal app should store that consent per lead if it sends marketing messages.
