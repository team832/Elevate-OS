-- Read only. It lists candidates to check by hand, not confirmed errors.
-- Read only. Finds stored records that can hold a fee figure from before the 30 Oct 2026 fix.
-- 1. Student reports whose stored fee statement predates the fix and whose student has an accepted agreement (HMO-001).
SELECT 'report' AS what, e.id, e.student_id, e.at, e.status,
       e.snapshot->'fees'->>'balancePaise' AS stored_balance_paise
FROM ops.report_exports e
WHERE e.snapshot ? 'fees'
  AND e.snapshot->'fees'->>'basis' IS NULL
  AND EXISTS (SELECT 1 FROM ops.fee_plans p WHERE p.student_id = e.student_id AND p.approved_at IS NOT NULL);

-- 2. Admission forms printed from a later agreement version while money or discounts sit on an earlier one (HMO-003).
--    The PDF itself is not stored (only its SHA-256), signed = a signature confirmation exists.
SELECT 'form' AS what, f.id, f.application_id, f.version, f.generated_at,
       EXISTS (SELECT 1 FROM ops.signature_confirmations s
               WHERE s.form_id = f.id AND s.invalidated_at IS NULL) AS signed
FROM ops.application_forms f
JOIN ops.application_versions v ON v.application_id = f.application_id AND v.version = f.version
JOIN ops.applications a ON a.id = f.application_id
WHERE (v.snapshot->'feeAgreement'->>'version')::int > 1
  AND EXISTS (SELECT 1 FROM ops.fee_records r
              JOIN ops.fee_plans p ON p.id = r.plan_id
              WHERE p.student_id = a.student_id
                AND p.id::text <> v.snapshot->'feeAgreement'->>'planId'
                AND p.academic_year = v.snapshot->'feeAgreement'->>'academicYear');

-- 3. Exit records whose student has an accepted agreement: the frozen balance_paise came from the old sum (HMO-004).
SELECT 'exit' AS what, x.id, x.admission_id, x.recorded_at, x.balance_paise
FROM ops.exit_records x
JOIN ops.admissions a ON a.id = x.admission_id
WHERE a.student_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM ops.fee_plans p WHERE p.student_id = a.student_id AND p.approved_at IS NOT NULL);
