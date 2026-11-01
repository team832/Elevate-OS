/**
 * What everyone's work says (owner, 31 Oct 2026: "total work"): one list of task briefs per kind of
 * job and the words of their work reports. Written by ./fill-work.ts, which gives each brief a
 * lifecycle state. Made-up text; sample rows only (D-036).
 */
export interface Brief {
  title: string;
  details: string;
  deliverable: string;
  done: string;
  category: string;
  work: string;
  result: string;
  remaining: string;
  next: string;
  blocker: string;
  checklist: string[];
}
const CAT = {
  prep: 'Teaching preparation',
  check: 'Checking and marks',
  admin: 'Administration',
  content: 'Content',
  calls: 'Calls and follow-up',
  people: 'People',
  money: 'Fees and accounts',
  systems: 'Systems',
} as const;

const brief = (
  title: string,
  details: string,
  deliverable: string,
  done: string,
  category: string,
  work: string,
  result: string,
  remaining: string,
  next: string,
  blocker: string,
  checklist: string[],
): Brief => ({ title, details, deliverable, done, category, work, result, remaining, next, blocker, checklist });

/** A teacher's work: `s` the subject they teach, `b` the batch. */
export const TEACHER_BRIEFS = (s: string, b: string): Brief[] => [
  brief(
    `Prepare the ${s} revision sheet for ${b}`,
    `Students asked for one sheet to revise from before the next ${s} test: the main points, three worked examples and five practice questions.`,
    'Two-page revision sheet (PDF)',
    'Covers the chapters taught so far, and every practice question has a worked answer.',
    CAT.prep,
    'Listed the points students keep missing and wrote the first worked example',
    'Half of the sheet is drafted.',
    'Two worked examples and the practice questions.',
    'Finish the examples and send the sheet for checking.',
    'Waiting for the printed copy of last year’s paper.',
    ['Choose the chapters', 'Write the worked examples', 'Add practice questions', 'Check the answers'],
  ),
  brief(
    `Collect the ${s} test answer sheets from ${b}`,
    'The sheets are with the invigilator. Collect them and count them against the attendance list.',
    'Sheets handed to the exam desk with the count',
    'The count matches the attendance list, or the missing names are written down.',
    CAT.check,
    'Collected the sheets and counted them against the list',
    'All sheets accounted for except one absent student.',
    'Hand them to the exam desk.',
    'Give them to the exam desk tomorrow morning.',
    'The invigilator is out until Tuesday.',
    ['Collect from the invigilator', 'Count against attendance', 'Hand to the exam desk'],
  ),
  brief(
    `Set the ${s} practice paper for ${b}`,
    'A timed paper for Friday: mixed difficulty, drawn from the chapters finished this month, with an answer key.',
    'Question paper and answer key',
    'Twenty questions, timed for forty minutes, each with a checked answer.',
    CAT.prep,
    'Wrote twelve of the twenty questions and checked them against the syllabus',
    'Twelve questions ready with answers.',
    'Eight questions and the answer key.',
    'Finish the paper and try it against the clock.',
    'Need the syllabus weights from the coordinator.',
    ['Pick the chapters', 'Write the questions', 'Write the answer key', 'Time the paper'],
  ),
  brief(
    `Plan a ${s} doubt class for ${b}`,
    'Students have listed the questions they could not do. Group them and plan one extra class to clear them.',
    'A one-page plan: questions, order and room',
    'Every question on the list is either in the plan or answered another way.',
    CAT.prep,
    'Grouped the doubts students raised this week by chapter',
    'Doubts fall into three groups.',
    'Book a room and tell the batch.',
    'Book the room as soon as one is free.',
    'No free room this week; the coordinator is checking the timetable.',
    ['List the doubts', 'Group them', 'Book the room', 'Tell the batch'],
  ),
  brief(
    `Check the ${s} homework of ${b}`,
    'The last two homework sets. Note who handed in and the mistakes most students made.',
    'A list of who handed in, with common mistakes',
    'Every student is on the list and at least three common mistakes are written down.',
    CAT.check,
    'Checked the notebooks and noted the common mistakes',
    'Most students handed in; three common mistakes noted.',
    'Tell the two students who did not hand in.',
    'Share the mistakes at the start of the next class.',
    'Two notebooks are still with the students.',
    ['Collect the notebooks', 'Check each set', 'Write down common mistakes'],
  ),
  brief(
    `Write the ${s} chapter summary for ${b}`,
    'A short summary of the chapter finished last week, in plain words, that a student who missed class can read alone.',
    'One-page summary (PDF)',
    'A student who missed the class can follow it without help.',
    CAT.content,
    'Drafted the summary and tried it on a student who missed the class',
    'First draft done.',
    'Add two examples and proofread.',
    'Add the examples after the next class.',
    'Waiting for the coordinator’s template.',
    ['Draft the summary', 'Add examples', 'Proofread'],
  ),
  brief(
    `Upload the ${s} test answer key for ${b}`,
    'The key of the last test, with a one-line reason for each answer, so students can check themselves.',
    'Answer key with reasons',
    'Each answer has a reason and two colleagues have checked the disputed ones.',
    CAT.check,
    'Uploaded the key and rechecked the two disputed answers',
    'Key uploaded; one answer corrected.',
    'None.',
    'Tell the batch that the key is up.',
    'Waiting for a colleague to check the disputed answers.',
    ['Write the reasons', 'Check disputed answers', 'Upload'],
  ),
  brief(
    `Enter the ${s} unit test marks for ${b}`,
    'Marks of the unit test are overdue on the sheet. Enter them and mark absentees as absent, not zero.',
    'Marks entered on the marks sheet',
    'Every student on the roster has a mark or is marked absent.',
    CAT.check,
    'Marked half of the answer sheets and entered those marks',
    'Half the marks are in.',
    'The other half of the sheets.',
    'Finish marking and enter the rest.',
    'Some sheets came a day late.',
    ['Mark the sheets', 'Enter the marks', 'Mark absentees'],
  ),
  brief(
    `Arrange a ${s} guest session for ${b}`,
    'A one-hour session by a visiting expert on what the exam actually asks. Find a date and a room.',
    'Confirmed date, room and speaker',
    'The speaker has confirmed in writing and the batch has been told.',
    CAT.admin,
    'Wrote to two speakers and asked the coordinator about dates',
    'One speaker replied with two possible dates.',
    'Confirm a date and a room.',
    'Confirm with the speaker once the room is known.',
    'Waiting for the speaker to reply.',
    ['Find a speaker', 'Fix a date', 'Book the room', 'Tell the batch'],
  ),
  brief(
    `Mark the ${s} mock answer sheets for ${b}`,
    'Mock sheets to be marked this week so that results can go out before the parents’ meeting.',
    'Marked sheets and a marks list',
    'All sheets are marked and the list has been checked once by a colleague.',
    CAT.check,
    'Marked the sheets and made the marks list',
    'All marked; one total to be rechecked.',
    'Recheck one total.',
    'Ask a colleague to check the list.',
    'One bundle of sheets is missing from the exam desk.',
    ['Mark the sheets', 'Make the list', 'Second check'],
  ),
  brief(
    `Update the ${s} lesson plan for ${b}`,
    'The plan has fallen a class behind. Move the remaining chapters so the batch still finishes on time.',
    'Updated lesson plan shared with the coordinator',
    'The plan ends before the first mock and the coordinator has agreed.',
    CAT.prep,
    'Moved the remaining chapters and left one spare class',
    'Plan redone with one class in hand.',
    'The coordinator’s agreement.',
    'Show the plan to the coordinator.',
    'The coordinator is away until Thursday.',
    ['Count the classes left', 'Move the chapters', 'Get it agreed'],
  ),
  brief(
    `Call the parents of students missing ${s} classes in ${b}`,
    'Two students have missed several classes. Call home, ask why, and agree what they will catch up.',
    'A note of each call and what was agreed',
    'Each family has been reached or tried three times, and a catch-up is agreed.',
    CAT.calls,
    'Called two parents and agreed the catch-up work',
    'One parent reached; one did not pick up.',
    'Try the second parent again.',
    'Call again in the evening.',
    'The second number rings without an answer.',
    ['Get the numbers', 'Make the calls', 'Write down what was agreed'],
  ),
];

/** The same shape of list for each office job. */
export const OFFICE_BRIEFS: Readonly<Record<string, Brief[]>> = {
  academic: [
    brief('Check this week’s teaching logs', 'Go through the logs submitted this week and verify those that match the timetable.', 'Logs verified or sent back', 'No submitted log older than three days is left unverified.', CAT.check, 'Verified the logs of three batches', 'Three batches done; three to go.', 'The other three batches.', 'Finish by Friday.', 'Two teachers have not submitted yet.', ['IPMAT logs', 'CLAT logs', 'Commerce logs']),
    brief('Prepare next month’s timetable draft', 'Teachers’ availability, exam dates and rooms for next month, in one draft.', 'Draft timetable for review', 'No clash in teachers or rooms, and every batch has its classes.', CAT.admin, 'Entered teachers’ availability and found two clashes', 'Two clashes found and one fixed.', 'One clash.', 'Talk to the teacher about the Thursday slot.', 'Waiting for the school exam dates.', ['Collect availability', 'Build the draft', 'Check clashes']),
    brief('Follow up on overdue catch-up work', 'Students whose catch-up tasks are past their date: check with the teacher and the student.', 'A list with what each student will do next', 'Every overdue task has a new date or is closed.', CAT.calls, 'Spoke to four teachers about overdue catch-up work', 'Four of nine followed up.', 'Five students.', 'Finish the list tomorrow.', 'Two students were away this week.', ['Pull the list', 'Talk to teachers', 'Set new dates']),
    brief('Review the batch attendance report', 'Monthly attendance by batch: flag students below 75% for a support case.', 'Flagged list and new support cases', 'Every student below 75% has a case or a written reason.', CAT.check, 'Read the report for all six batches and flagged five students', 'Five students flagged.', 'Open the cases.', 'Open support cases on Monday.', 'Attendance for two classes is not marked yet.', ['Run the report', 'Flag students', 'Open cases']),
    brief('Coordinate the mock test schedule', 'Fix dates for the next mock across IPMAT and CLAT without clashing with school exams.', 'Agreed dates on the calendar', 'Dates agreed with both teaching teams and shared with students.', CAT.admin, 'Compared the school exam dates with the proposed mock dates', 'One date works for both batches.', 'Confirm with the teachers.', 'Share the date on Monday.', 'CLAT teachers have not replied.', ['Check school dates', 'Agree with teachers', 'Announce']),
    brief('Induct the new part-time teacher', 'Show the timetable, the log and the marks screen; pair them with a teacher for the first week.', 'A checklist signed by the teacher', 'They have logged one class and entered marks once on their own.', CAT.people, 'Walked through the timetable and the teaching log', 'Timetable and logs covered.', 'Marks screen.', 'Sit together for the first marks entry.', 'Their login is not ready yet.', ['Timetable', 'Teaching log', 'Marks']),
    brief('Update the syllabus weights', 'Chapter weights for catch-up priorities, agreed with the subject teachers.', 'Updated weights in the plan', 'Every subject teacher has agreed the weights.', CAT.prep, 'Met two subject teachers about chapter weights', 'Two subjects done.', 'Four subjects.', 'Meet the rest this week.', 'Waiting for the new exam pattern notice.', ['Quant', 'Verbal', 'Legal', 'Commerce']),
    brief('Prepare the parent-teacher meeting list', 'Which families to invite first, with each student’s attendance and marks to hand.', 'Invite list with a one-line note per student', 'Every student below the batch average is on the list.', CAT.calls, 'Drew up the list from this month’s results', 'List of twenty-two families.', 'One-line notes.', 'Write the notes with the teachers.', 'Results of one test are not published yet.', ['Pull results', 'Pick families', 'Write notes']),
  ],
  counsellor: [
    brief('Call back the families who attended a demo', 'Everyone who finished the demo classes this week: ask how it went and what they need to decide.', 'Call notes on each lead', 'Each family has been reached or tried three times.', CAT.calls, 'Called six families from this week’s demo list', 'Four reached; two to try again.', 'Two families.', 'Call again in the evening.', 'Two numbers rang without an answer.', ['Pull the list', 'Make the calls', 'Update the lead']),
    brief('Prepare fee explanations for three families', 'They asked how instalments work. Write out each plan in plain words before the meeting.', 'One sheet per family', 'The figures match the fee plan exactly.', CAT.money, 'Wrote out two instalment sheets and checked them against the plans', 'Two of three done.', 'One family.', 'Finish before Saturday’s meeting.', 'Waiting for the director’s answer on the discount.', ['Family one', 'Family two', 'Family three']),
    brief('Finish the admission forms waiting for signatures', 'Forms ready but unsigned: call each parent and fix a time.', 'Signed forms on file', 'No form is left waiting more than a week.', CAT.admin, 'Called the parents of two waiting forms', 'One signed; one fixed for Saturday.', 'Three forms.', 'Call the remaining families.', 'One parent is out of town until next week.', ['List the forms', 'Call parents', 'File signed forms']),
    brief('Update the enquiry list from the open house', 'Names from the open-house sheet to be entered as leads with their programme.', 'Leads entered with source and programme', 'Every name on the sheet is a lead or marked a duplicate.', CAT.admin, 'Entered twelve names and checked for duplicates', 'Twelve of twenty done.', 'Eight names.', 'Finish tomorrow morning.', 'Some handwriting cannot be read.', ['Enter names', 'Check duplicates']),
    brief('Plan the school visit in Laxmangarh', 'A counselling session at a partner school: dates, slides and who goes.', 'Agreed date and slide deck', 'The school has confirmed and the deck is checked.', CAT.calls, 'Spoke to the principal and proposed two dates', 'Principal prefers the second date.', 'The slides.', 'Draft the slides this week.', 'The school has not confirmed.', ['Confirm date', 'Make slides', 'Book travel']),
    brief('Review demo feedback with the coordinator', 'Feedback from demo classes this month: what parents liked and what they asked about.', 'A short note to the coordinator', 'The note names three things to change.', CAT.people, 'Read this month’s demo feedback and noted the common questions', 'Three common questions noted.', 'Meet the coordinator.', 'Meet on Monday.', 'The coordinator is on leave this week.', ['Read feedback', 'Write note', 'Meet']),
    brief('Check KYC documents of new admissions', 'Which students still owe a document; call them and note when it will come.', 'A list with dates', 'Each missing document has a promised date.', CAT.admin, 'Went through the new admissions and listed missing documents', 'Five documents still owed.', 'Calls to five families.', 'Call tomorrow.', 'One family has moved house and the proof is not ready.', ['List missing', 'Call families', 'Record dates']),
    brief('Send fee reminders due this week', 'Instalments falling due this week: in-app note and a call to each family.', 'A call note per family', 'Each family has been told the amount and date.', CAT.money, 'Called four of seven families about this week’s instalments', 'Four told; none disputed.', 'Three families.', 'Call the rest tomorrow.', 'The accounts sheet was late today.', ['Pull the list', 'Call', 'Note the replies']),
  ],
  marketing: [
    brief('Draft the monthly content calendar', 'Posts, reels and articles for next month, one idea per week per programme.', 'Calendar with owners and dates', 'Each programme has at least one item a week and an owner.', CAT.content, 'Drafted the first two weeks of the calendar', 'Two weeks drafted.', 'Two more weeks.', 'Finish by Thursday.', 'Waiting for dates of the open house.', ['Collect ideas', 'Assign owners', 'Fix dates']),
    brief('Write the CLAT reading habit post', 'A short post on building a daily reading habit. No results claimed.', 'Post text and image brief', 'Reviewed by the manager with no result claims.', CAT.content, 'Wrote the first draft of the post', 'Draft ready.', 'Image brief.', 'Write the image brief tomorrow.', 'The designer is on leave this week.', ['Draft', 'Image brief', 'Review']),
    brief('Prepare the IPMAT webinar reminder series', 'Three reminder messages before the webinar, with the time and how to join.', 'Three messages in the content tool', 'Dates and joining steps are correct in all three.', CAT.content, 'Wrote two of the three reminders', 'Two reminders ready.', 'The last one.', 'Finish after the time is confirmed.', 'The webinar time is not confirmed yet.', ['First reminder', 'Second reminder', 'Last-day reminder']),
    brief('Check last month’s post figures', 'Compare what each post reached against the manual export. No figures are claimed from a live connection.', 'A short table for the monthly report', 'Every figure names where it came from.', CAT.check, 'Copied the numbers from the export and compared them to the list', 'Three mismatches found.', 'Check the three mismatches.', 'Recheck against the export.', 'The export for one account is missing.', ['Export figures', 'Compare', 'Write table']),
    brief('Update the course page copy', 'The CA Foundation page: clearer first paragraph and the fee note. Nothing about results.', 'New text ready for the website owner', 'Reviewed by the manager and matches the fee sheet.', CAT.content, 'Rewrote the first paragraph and the fee note', 'New copy drafted.', 'Review.', 'Send it to the manager.', 'Waiting for the final fee note.', ['Rewrite', 'Check fees', 'Review']),
    brief('Plan the partner school seminar material', 'A short deck and a one-page handout for the school seminar.', 'Deck and handout', 'Checked by the counsellor and the manager.', CAT.content, 'Drew up the deck outline', 'Outline agreed.', 'Slides and handout.', 'Make the slides.', 'The school has not confirmed the date.', ['Outline', 'Slides', 'Handout']),
    brief('Follow up leads from the last campaign', 'Leads from the last campaign who have no next step yet: assign them and set a date.', 'Each lead with an owner and a next step', 'No lead from the campaign is without a next step.', CAT.calls, 'Assigned the first ten leads and set dates', 'Ten of eighteen done.', 'Eight leads.', 'Finish tomorrow.', 'Two leads have the same parent; waiting for the merge decision.', ['Pull list', 'Assign', 'Set dates']),
    brief('Collect teacher quotes for the open house', 'Two short quotes from teachers on what the first month looks like. No student names.', 'Two approved quotes', 'Each teacher has approved their own words.', CAT.content, 'Asked three teachers and received one quote', 'One quote in hand.', 'One more quote.', 'Remind the teachers on Monday.', 'Waiting for replies from two teachers.', ['Ask teachers', 'Edit', 'Get approval']),
  ],
  hr: [
    brief('Review pending leave applications', 'Applications waiting for a decision: check the dates against classes and cover.', 'A decision on each', 'None is left waiting more than two days.', CAT.people, 'Checked the applications against this week’s classes', 'Three decided.', 'Two applications.', 'Decide the rest tomorrow.', 'Waiting for the coordinator’s word on cover.', ['Check classes', 'Check cover', 'Decide']),
    brief('Clear the attendance review list', 'Days with a missing check-out or no punch: ask the person, then decide.', 'A decision or a correction on each day', 'No day older than a week still reads Unmarked.', CAT.people, 'Went through the list and asked four people', 'Six days decided.', 'Four days.', 'Decide once they reply.', 'Two people have not replied.', ['Pull the list', 'Ask people', 'Decide']),
    brief('Prepare this month’s feedback summaries', 'One summary per teacher from the approved responses, for the manager to read first.', 'Draft summaries', 'Each summary names strengths and one thing to work on.', CAT.people, 'Drafted summaries for four teachers', 'Four drafts done.', 'The rest of the teachers.', 'Finish by the end of the week.', 'Two teachers have too few responses.', ['Read responses', 'Draft', 'Send for reading']),
    brief('Update staff emergency contacts', 'Everyone’s emergency contact and address: confirm them for the year.', 'Records updated', 'Every staff record has a contact checked this year.', CAT.people, 'Confirmed the contacts of the academic team', 'Academic team done.', 'Marketing team.', 'Finish next week.', 'Some people have not replied to the email.', ['Academic team', 'Marketing team', 'Office']),
    brief('Plan the staff meeting agenda', 'Topics, who presents and the room; send it two days ahead.', 'Agenda sent', 'Everyone has the agenda two days before.', CAT.admin, 'Listed topics from the managers', 'Five topics in.', 'Order and timing.', 'Fix the order on Monday.', 'Waiting for the director’s topic.', ['Collect topics', 'Order', 'Send']),
    brief('Forward open requests to the right person', 'Requests through HR waiting a day or more: answer, forward or make a task.', 'No request older than two days untouched', 'Every request has a next step.', CAT.people, 'Read and forwarded this week’s requests', 'Five handled.', 'Two requests.', 'Answer the last two tomorrow.', 'One needs Schar’s answer.', ['Read', 'Forward', 'Reply']),
    brief('Run the work report follow-up', 'Who has not sent yesterday’s report or last week’s; a short reminder to each.', 'A reminder to each person', 'The missing list is below five people.', CAT.people, 'Sent reminders to those missing last week’s report', 'Seven reminded.', 'Check again tomorrow.', 'Look at the list again.', 'Two people are on leave.', ['Check list', 'Remind']),
    brief('Check development actions past their date', 'Actions agreed with teachers that are past due: ask how they went.', 'Each action updated', 'Every past-due action is done, moved or dropped with a reason.', CAT.people, 'Spoke to three teachers about their actions', 'Two done; one moved.', 'Three more.', 'Finish next week.', 'One teacher is on leave.', ['List actions', 'Talk', 'Update']),
  ],
  office: [
    brief('Review this week’s collections', 'Fees collected against what was due this week, with who is behind.', 'A one-page note', 'The note’s total equals the ledger’s total.', CAT.money, 'Compared the receipts with the ledger', 'Totals match; three families behind.', 'Calls to those families.', 'Pass the names to the counsellor.', 'One receipt is missing a reference.', ['Pull ledger', 'Compare', 'Write note']),
    brief('Approve this week’s purchase requests', 'Stationery, printing and the projector repair: approve or send back.', 'A decision on each request', 'Each has a decision and a budget line.', CAT.admin, 'Looked at the three requests and asked for one quote', 'Two approved.', 'Projector repair quote.', 'Decide once the quote arrives.', 'Waiting for the repair quote.', ['Read', 'Check budget', 'Decide']),
    brief('Prepare the monthly review for the director', 'Admissions, fees, attendance and open issues on one page.', 'One-page review', 'Every figure names its source screen.', CAT.admin, 'Pulled the admissions and fee figures', 'Two sections done.', 'Attendance and issues.', 'Finish by Friday.', 'The attendance report is not final.', ['Admissions', 'Fees', 'Attendance', 'Issues']),
    brief('Check the rooms and timetable for next week', 'Room bookings against classes and tests.', 'A clean room plan', 'No room is double-booked.', CAT.admin, 'Compared the room sheet with the timetable', 'One clash found.', 'Fix the clash.', 'Talk to the coordinator.', 'The seminar hall is booked for the open house.', ['Pull bookings', 'Compare', 'Fix']),
    brief('Renew the software and hosting list', 'Which accounts renew this quarter and who owns each.', 'A list with dates and owners', 'Every item has an owner and a date.', CAT.systems, 'Listed the accounts and their renewal dates', 'List ready.', 'Check owners.', 'Confirm the owners next week.', 'Two invoices have not come.', ['List', 'Owners', 'Dates']),
    brief('Plan the open-house logistics', 'Rooms, chairs, a welcome desk and who stands where.', 'A one-page plan', 'Everyone on the plan knows their place.', CAT.admin, 'Drew up the plan and asked for volunteers', 'Plan drafted.', 'Names for the welcome desk.', 'Ask at the staff meeting.', 'The chairs vendor has not confirmed.', ['Rooms', 'Chairs', 'People']),
    brief('Follow up on the campus visit dates', 'Two dates are proposed; settle one and tell the families.', 'A confirmed date', 'Families have been told one date.', CAT.calls, 'Spoke to the families who asked', 'Most prefer the later date.', 'Confirm it.', 'Tell the families on Monday.', 'The hall is not confirmed for the later date.', ['Ask', 'Decide', 'Tell families']),
    brief('Reconcile the bank statement', 'Month-end check of the bank statement against the fee ledger.', 'A reconciliation sheet', 'Every line is matched or listed with a reason.', CAT.money, 'Matched the first three weeks of the statement', 'Most lines matched.', 'The last week.', 'Finish on Monday.', 'The bank’s statement for the last week is late.', ['Download', 'Match', 'List differences']),
  ],
};

/** [summary, plan] of a daily report, by kind of job. */
export const REPORT_WORDS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  teacher: [
    ['Took my classes as planned and checked the homework of one batch.', 'Prepare the next practice sheet.'],
    ['Two classes today; a short written check went better than last week.', 'Go through the two hardest questions tomorrow.'],
    ['Finished the chapter with the batch and started the revision sheet.', 'Finish the revision sheet.'],
    ['Marked the test papers and entered half the marks.', 'Enter the remaining marks.'],
    ['Covered a colleague’s class in the morning and took my own in the afternoon.', 'Catch up on my own preparation.'],
    ['Doubt class ran over; most of the batch stayed for it.', 'Give a short recap at the start of the next class.'],
    ['Quiet day: planned next week’s lessons and met the coordinator.', 'Start the next chapter.'],
  ],
  office: [
    ['Cleared the list for today and followed up on two open items.', 'Pick up the two items still waiting.'],
    ['Meetings in the morning; finished the note the manager asked for.', 'Send the note and start the next item.'],
    ['Spoke to several families and updated their records.', 'Call the ones who did not pick up.'],
    ['Checked this week’s figures against the source screens.', 'Write up the differences.'],
    ['Worked through the waiting list; two items need someone else’s answer.', 'Chase the two answers.'],
    ['Helped with the open-house preparation for most of the day.', 'Back to the regular list.'],
  ],
};
export const WEEK_WORDS: readonly (readonly [string, string])[] = [
  ['A full week: planned work finished and one item moved to next week.', 'Finish the moved item and start the month-end work.'],
  ['Good progress; two items slipped because of the holiday.', 'Catch up on the two items first.'],
  ['Steady week with no surprises.', 'Keep the same pace next week.'],
];
export const MONTH_WORDS: readonly (readonly [string, string])[] = [
  ['Finished what was planned for the month except one item, which moved with the manager’s agreement.', 'Next month: clear the moved item, then the new plan.'],
  ['A busy month: exams took more time than planned, so preparation ran behind for a week.', 'Plan a week ahead of the next exam period.'],
];
export const REVISION_ASKS = [
  'Please say which items are still open and when they will finish.',
  'Add what you did about the item that slipped.',
  'Name the students you are referring to.',
];

export const BLOCK_ON_HOLD = 'Put on hold until the exam week is over.';
export const CHANGE_ASKS = [
  'Please add the worked answers before this goes out.',
  'The figures need their source; please add it.',
  'Good start. Keep it to one page and resubmit.',
  'Two points are out of date; please check them against the latest plan.',
];
export const CANCEL_REASONS = [
  'No longer needed: the date moved to next term.',
  'Merged into the coordinator’s larger list.',
  'The family decided against it, so this is not needed.',
];
export const REOPEN_REASONS = [
  'One figure was wrong; this needs another look.',
  'A correction came in after it was closed.',
];
export const COMMENTS_MANAGER = [
  'Please keep this short; the first version is fine.',
  'Thanks. Can you finish this before Friday?',
  'Talk to the coordinator before you change the dates.',
  'Looks right so far. Tell me if the date is a problem.',
];
export const COMMENTS_OWNER = [
  'Started on this; I will have a first version tomorrow.',
  'One question: should this include last month as well?',
  'Waiting for one answer before I can finish.',
];
export const DUE_MOVES = [
  'The exam schedule moved, so this moved with it.',
  'The owner asked for two more days; agreed.',
  'Pushed back because of the holiday.',
];
