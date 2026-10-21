# data/syllabus — exam syllabus distribution (reviewed draft)

`syllabus-distribution-2026-10-21.json` maps each programme's official syllabus onto Academic OS course → subject → chapter, with a chapter weight from 1 to 10. Every chapter records its `share`, `weight`, `weightBasis` (the arithmetic), `weightSource` (`official`, `proxy`, `derived` or `none`), `sourceRef` and `official` (whether the title itself comes from an official list).

Status: **draft, pending owner verification.** Researched on 21 Oct 2026 from official documents only, then checked by an accuracy reviewer, who found no weight mismatches across all 275 chapters. The reviewer's fixes are applied here: the CLAT chapters cite the official syllabus page, and CLAT QT-01 uses the official wording. Teacher ownership is a proposal for the docs, so it is left out of this file.

Weight formula: `max(1, round_half_up(10 × share ÷ maxShare))`, where maxShare is taken within one scoring unit (one paper or test).

| Course | Sources (retrieved 2026-10-21) |
|---|---|
| `IPMAT-BASE` (weights only) | IIM Indore IPM 2026-31 admission procedure; IIMB UG-AT 2026 process and FAQ; IIM Rohtak IPM AT 2026 page; NTA JIPMAT-2026 bulletin. Weight = mean subject share over the four exams. |
| `CLAT-SYL-2027` | consortiumofnlus.ac.in: CLAT 2027 UG question format and UG syllabus pages |
| `CUET-SYL-2026` | NTA CUET (UG) 2026 bulletin and the 101/301/305/309/319/501 syllabi. Weights are a proxy from CBSE unit marks, because NTA publishes none. |
| `CAF-SYL-2024` | ICAI Foundation syllabus with section-wise weightage (issued 26 Oct 2023). Paper durations are not published by ICAI. |
| `COM-C11-2627`, `COM-C12-2627` | CBSE 2026-27 curricula: Accountancy 055, Business Studies 054, Economics 030, Mathematics 041, Applied Mathematics 241 and English Core 301 |

The full URLs are inside the JSON (`source`, `otherSources`). The seed `academic.syllabus-drafts` (`apps/academic-os/seed/syllabus.ts`) reads this file. When a newer official document comes out (for example the CUET 2027 bulletin), regenerate the file, save it under a new date, and point the seed at it.
