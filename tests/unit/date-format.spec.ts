import { test, expect } from '@playwright/test';
import { formatDisplayDate } from '../../src/lib/dateFormat';

test.describe('formatDisplayDate', () => {
  test('matches the existing en-US display format', () => {
    const value = '2024-06-15T12:30:00.000Z';
    const expected = new Date(value).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    expect(formatDisplayDate(value)).toBe(expected);
  });

  test('keeps empty and invalid values predictable', () => {
    expect(formatDisplayDate(undefined)).toBe('');
    expect(formatDisplayDate('not-a-date')).toBe('Invalid Date');
  });
});
