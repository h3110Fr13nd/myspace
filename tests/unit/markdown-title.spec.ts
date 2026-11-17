import { expect, test } from '@playwright/test';
import { stripLeadingDuplicateTitle } from '../../src/lib/render/markdownTitle';

test.describe('stripLeadingDuplicateTitle', () => {
  test('removes a matching H1 after frontmatter and keeps the body', () => {
    const markdown = '---\ntitle: Notes\n---\n\n# Notes\n\nThe body.';
    expect(stripLeadingDuplicateTitle(markdown, 'Notes')).toBe('---\ntitle: Notes\n---\n\nThe body.');
  });

  test('keeps an H1 that is not the resource title', () => {
    const markdown = '# A different heading\n\nThe body.';
    expect(stripLeadingDuplicateTitle(markdown, 'Notes')).toBe(markdown);
  });

  test('keeps content when there is no leading H1', () => {
    const markdown = 'A paragraph first.\n\n# Notes';
    expect(stripLeadingDuplicateTitle(markdown, 'Notes')).toBe(markdown);
  });
});
