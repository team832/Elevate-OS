/**
 * Certificate PDF `certificate/1` (F4-02), A4: institute details, the wording exactly as stored at
 * issue, the number and date, and "Duplicate" / "Revoked" marks. Built only from the register row.
 */
import { INSTITUTE } from '@elevate/shared-ui';
import { fmtDate, fmtDateTime } from '../../ui/format';
import type { CertificateListItem } from '../certificates';
import { createPdf } from './document';

export async function certificatePdf(r: CertificateListItem) {
  const { c } = r;
  const pdf = await createPdf({
    title: r.typeLabel,
    reference: c.certificateNumber,
    templateVersion: 'certificate/1',
  });
  pdf.paragraph(`Elevate Education · ${INSTITUTE.legalName}`);
  pdf.paragraph(
    `${INSTITUTE.address} · ${INSTITUTE.phone} · ${INSTITUTE.email} · GSTIN ${INSTITUTE.gstin}`,
    { muted: true },
  );
  if (c.revokedAt)
    pdf.banner(`Revoked on ${fmtDateTime(c.revokedAt)}: ${c.revokeReason}`, 'warning');
  if (c.printCount > 1) pdf.banner('Duplicate', 'neutral');
  if (r.isSample) pdf.banner('Sample data — fictional student', 'neutral');
  pdf.space(24);
  pdf.heading(r.typeLabel);
  pdf.paragraph(c.body);
  pdf.space(12);
  pdf.keyValues([
    ['Certificate no.', c.certificateNumber],
    ['Issue date', fmtDate(c.issueDate)],
  ]);
  pdf.space(24);
  pdf.signatures([{ label: 'Authorised signatory' }]);
  return { bytes: await pdf.finish(), lines: pdf.lines };
}
