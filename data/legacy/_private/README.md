# Private mapping note (no personal data here)

The JSON files in `data/legacy/` replace every real person with a role label. This file only records **that** a mapping exists and where an authorised person can find it. It does not, and must not, contain names, handles, phone numbers or emails.

## Role labels used in the outputs

| Label | Meaning |
|---|---|
| `[founder]` | Elevate's co-founder (the approver for all content in the legacy content OS) |
| `[founder-family]` | the founder's family name where it appeared without a first name |
| `{founder}` (inside a source path) | the founder's first name, which two legacy folder slugs contain: `accounts/linkedin-{founder}/` and `accounts/instagram-{founder}/` |
| `[faculty:current_affairs]` | CLAT Current Affairs & GK teacher |
| `[faculty:logical_reasoning]` | CLAT Logical Reasoning teacher |
| `[faculty:english_verbal]` | CLAT English / Verbal teacher |
| `[faculty:quant]` | CLAT Quant teacher |
| `[staff:former_presenter]` | the person on camera in older CLAT reels, replaced from 7 Oct 2026 |
| `[student]` | a student named in a testimonial post |
| `[guest expert]` | an external expert session speaker |
| `[personal handle redacted]`, `[personal profile URL redacted]` | personal social-media handles / profile URLs |

## Where the mapping lives

The real identities are only in the legacy sources, which stay read-only (D-001): the content OS brand brief (faculty and founder sections), the CLAT account README and post audit, the idea/version trackers' free-text columns, and the two founder account folders named above. The operations handover deliberately uses role names only.

## Rules

- Seeds use fictional people (D-016). Do not copy the real mapping into any seed, fixture, test or doc.
- Mapping real staff to system roles is an owner decision (D-008) made in the running system, not in this folder.
- `data/legacy/_extract/verify.py` fails if a known name, phone number or email appears anywhere under `data/legacy/`, including this folder.
