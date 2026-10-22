-- Data only (22 Oct 2026, D-036). Academic students created from SAMPLE admissions were not flagged
-- is_sample (the enrolment event carries no sample flag), so Academic showed no SAMPLE DATA badge
-- and they would survive db:clear-samples. Copy the flag from the linked canonical core student.
UPDATE "academic"."students" s
SET "is_sample" = true
FROM "core"."students" c
WHERE s."core_student_id" = c."id" AND c."is_sample" AND NOT s."is_sample";
