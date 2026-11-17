import { expect, test } from '@playwright/test';
import { validateResourceMetadata } from '../../src/lib/types/metadata.schema';

test.describe('resource metadata schemas', () => {
  test('validates known fields and preserves resource-specific extension fields', () => {
    const parsed = validateResourceMetadata('document', {
      title: 'Field notes',
      tags: ['research'],
      wikilinks: ['related-work'],
      filePath: '/vault/field-notes.md',
      customImporterData: { source: 'legacy-vault' },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.tags).toEqual(['research']);
    expect(parsed.data.filePath).toBe('/vault/field-notes.md');
    expect(parsed.data.customImporterData).toEqual({ source: 'legacy-vault' });
  });

  test('rejects malformed values for known fields instead of persisting them', () => {
    const parsed = validateResourceMetadata('document', {
      tags: 'not-an-array',
    });

    expect(parsed.success).toBe(false);
  });

  test('applies the PDF MIME default while retaining storage metadata', () => {
    const parsed = validateResourceMetadata('pdf', {
      s3Key: 'vaults/user/review.pdf',
      storageKey: 'vaults/user/review.pdf',
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.mimeType).toBe('application/pdf');
    expect(parsed.data.storageKey).toBe('vaults/user/review.pdf');
  });

  test('accepts the current vault-sync metadata shape for public and private notes', () => {
    for (const tier of ['public', 'private']) {
      const parsed = validateResourceMetadata('document', {
        slug: `note-${tier}`,
        tags: [],
        wikilinks: [],
        ogImage: null,
        tier,
        draft: false,
        isDraft: false,
        isPrivate: tier === 'private',
        isUnlisted: false,
        contentLength: 10,
        contentHash: 'sha256',
      });

      expect(parsed.success, `tier ${tier}`).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ogImage).toBeNull();
        expect(parsed.data.tier).toBe(tier);
        expect(parsed.data.contentHash).toBe('sha256');
      }
    }
  });
});
