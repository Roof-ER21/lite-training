import { test, expect } from 'vitest';
import {
  buildCertificatePdf,
  certificateFileBase,
  certificateIdFor,
  formatCertificateDate,
  isCertificateEligible,
} from '../../certificate';

const details = { recipientName: 'Alex Rivera', score: 92, certificationDate: '2026-09-01T12:00:00.000Z' };

test('every certified user is eligible, and only certified users', () => {
  expect(isCertificateEligible({ isCertified: true })).toBe(true);
  expect(isCertificateEligible({ isCertified: false })).toBe(false);
  expect(isCertificateEligible({})).toBe(false);
  expect(isCertificateEligible({ isCertified: null })).toBe(false);
});

test('certificate IDs are stable and content-sensitive', () => {
  expect(certificateIdFor(details)).toMatch(/^RER-\d{4}-[A-Z0-9]{7,}$/);
  expect(certificateIdFor(details)).toBe(certificateIdFor({ ...details }));
  expect(certificateIdFor(details)).not.toBe(certificateIdFor({ ...details, score: 71 }));
});

test('download filenames are filesystem-safe', () => {
  expect(certificateFileBase('  Alex M. Rivera  ')).toBe('RoofER_Certificate_Alex_M_Rivera');
  expect(certificateFileBase('')).toBe('RoofER_Certificate_Representative');
});

test('dates render in long form and bad dates are blank', () => {
  expect(formatCertificateDate('2026-09-01T12:00:00.000Z')).toContain('2026');
  expect(formatCertificateDate('not-a-date')).toBe('');
});

test('buildCertificatePdf produces a valid single-page PDF around the image', () => {
  const pdf = buildCertificatePdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  return pdf.arrayBuffer().then(buffer => {
    const text = new TextDecoder('latin1').decode(buffer);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 792 612]');
    expect(text).toContain('/Subtype /Image');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf.type).toBe('application/pdf');
  });
});
