import { describe, expect, it } from 'vitest';
import { enquiryBody, validateEnquiry } from '../../src/ui/new-enquiry-form';

describe('New enquiry form checks (the server stays the authority)', () => {
  it('needs a student name and at least one phone or email', () => {
    expect(validateEnquiry({})).toEqual({
      studentName: 'Enter the student’s name.',
      contact: 'Give at least one phone number or email (student or parent).',
    });
    expect(
      validateEnquiry({ studentName: 'Asha (fictional)', guardianPhone: '98765 43210' }),
    ).toEqual({});
  });

  it('leaves Indian phone formats to the server (with or without +91, spaces, dashes)', () => {
    for (const phone of ['98765 43210', '+91 98765 43210', '098765-43210', '+919876543210'])
      expect(validateEnquiry({ studentName: 'A (fictional)', studentPhone: phone })).toEqual({});
  });

  it('flags an email without an @ or domain', () => {
    expect(
      validateEnquiry({ studentName: 'A (fictional)', studentEmail: 'asha.example.test' }),
    ).toMatchObject({ studentEmail: 'Not a valid email address.' });
  });

  it('sends trimmed values and leaves empty fields out', () => {
    expect(
      enquiryBody({ studentName: '  Asha (fictional) ', studentEmail: '', notes: ' ' }),
    ).toEqual({
      studentName: 'Asha (fictional)',
    });
  });
});
