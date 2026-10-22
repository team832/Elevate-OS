-- Data only (21 Oct 2026). Link each Academic student to its canonical core student where Business
-- Ops already records the pair (ops.admissions.academic_student_id → student_id). Students enrolled
-- before Ops sent coreStudentId stayed unlinked, so Ops could not read their teacher reviews.
-- Only unambiguous pairs: one core student per Academic student AND one Academic student per core
-- student (older duplicate Academic rows for the same child stay unlinked), never one already in use.
WITH pairs AS (
  SELECT DISTINCT a."academic_student_id" AS "academic_id", a."student_id" AS "core_id"
  FROM "ops"."admissions" a
  WHERE a."academic_student_id" IS NOT NULL AND a."student_id" IS NOT NULL
), clean AS (
  SELECT p."academic_id", p."core_id" FROM pairs p
  WHERE (SELECT COUNT(*) FROM pairs x WHERE x."academic_id" = p."academic_id") = 1
    AND (SELECT COUNT(*) FROM pairs y WHERE y."core_id" = p."core_id") = 1
)
UPDATE "academic"."students" s
SET "core_student_id" = clean."core_id"
FROM clean
WHERE s."id" = clean."academic_id"
  AND s."core_student_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "academic"."students" other WHERE other."core_student_id" = clean."core_id");
