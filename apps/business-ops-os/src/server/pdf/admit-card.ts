/**
 * Admit cards `admit-card/1` (F4-03): two cards per A4 sheet, cut along the gap. Each card: the
 * student, roll number, admission number, batch, the test, date, time, venue, instructions and
 * signing spaces. Built only from Academic's admit-card record; missing values print in words.
 */
import type { AcademicAdmitCardsV1 } from '@elevate/shared-contracts';
import { fmtDate } from '../../ui/format';
import { createPdf } from './document';

type Card = AcademicAdmitCardsV1['rows'][number];

/** Half the A4 content height: a card starts on a new sheet unless this much is left. */
const CARD_HEIGHT = 340;

export const venueText = ({ venue }: AcademicAdmitCardsV1['assessment']) =>
  venue.online ? 'Online' : (venue.roomName ?? 'Venue not set');

const time = (t: AcademicAdmitCardsV1['assessment']) =>
  t.startTime
    ? `${t.startTime} IST${t.durationMinutes ? `, ${t.durationMinutes} minutes` : ''}`
    : 'Not set';

export async function admitCardsPdf(
  d: AcademicAdmitCardsV1,
  cards: readonly Card[],
  instructions: string,
) {
  const t = d.assessment;
  const pdf = await createPdf({
    title: 'Admit cards',
    reference: `${t.code} · ${t.title}`,
    templateVersion: 'admit-card/1',
    size: 'a4-dense',
  });
  cards.forEach((c, i) => {
    if (i % 2 === 0 && i > 0) pdf.pageBreak();
    else pdf.keep(CARD_HEIGHT);
    if (i % 2) pdf.space(24);
    pdf.banner(`Admit card · ${t.title}${t.isSample ? ' · Sample data' : ''}`, 'neutral');
    pdf.keyValuePairs([
      ['Student', c.displayName, 'Roll number', c.rollNumber],
      ['Admission no.', c.admissionNumber ?? 'Not assigned', 'Batch', c.batchCode],
      ['Test', `${t.code} · ${t.courseName}`, 'Venue', venueText(t)],
      ['Date', t.scheduledDate ? fmtDate(t.scheduledDate) : 'Not scheduled', 'Time', time(t)],
    ]);
    pdf.paragraph(instructions, { muted: true });
    pdf.signatures([{ label: 'Student' }, { label: 'Invigilator' }]);
  });
  return { bytes: await pdf.finish(), lines: pdf.lines };
}
