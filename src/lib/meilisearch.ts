import { Meilisearch } from 'meilisearch';

const MEILISEARCH_HOST = process.env.MEILISEARCH_URL || 'http://localhost:7705';
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || process.env.MEILISEARCH_KEY || 'meili_dev_master_key';

export const meiliClient = new Meilisearch({
  host: MEILISEARCH_HOST,
  apiKey: MEILI_MASTER_KEY,
});

export const RESOURCES_INDEX = 'resources';

export interface MeiliResourceDocument {
  id: string; // Meilisearch requires alphanumeric + hyphen/underscore (e.g. document__xyz)
  raw_id: string; // original resource id (e.g. document:xyz)
  type: string;
  title: string;
  path: string;
  category: string;
  summary: string;
  content: string;
  tags: string[];
  aliases: string[];
  owner_id: string;
  allowed_users?: string[];
  is_public: boolean;
  is_draft?: boolean;
  unlisted?: boolean;
  slug?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Configure index settings (searchable, filterable, sortable attributes and ranking rules)
 */
export async function setupMeilisearchIndex(): Promise<boolean> {
  try {
    const index = meiliClient.index(RESOURCES_INDEX);
    
    // Check if index exists or create it
    try {
      await index.getRawInfo();
    } catch {
      await meiliClient.createIndex(RESOURCES_INDEX, { primaryKey: 'id' });
    }

    await index.updateSettings({
      searchableAttributes: [
        'title',
        'tags',
        'aliases',
        'category',
        'summary',
        'content',
      ],
      filterableAttributes: [
        'type',
        'is_public',
        'is_draft',
        'unlisted',
        'owner_id',
        'allowed_users',
        'category',
        'tags',
      ],
      rankingRules: [
        'words',
        'typo',
        'proximity',
        'attribute',
        'sort',
        'exactness',
      ],
      displayedAttributes: [
        'id',
        'raw_id',
        'type',
        'title',
        'path',
        'category',
        'summary',
        'content',
        'tags',
        'aliases',
        'owner_id',
        'is_public',
        'slug',
      ],
      typoTolerance: {
        enabled: true,
        minWordSizeForTypos: {
          oneTypo: 4,
          twoTypos: 8,
        },
      },
    });

    return true;
  } catch (err: any) {
    console.warn('[Meilisearch Setup Warning]:', err.message);
    return false;
  }
}

/**
 * Helper to encode resource ID to a valid Meilisearch ID (alphanumeric, dashes, underscores)
 */
export function encodeMeiliId(rawId: string): string {
  return rawId.replace(/[^a-zA-Z0-9_-]/g, '__');
}

/**
 * Helper to decode Meilisearch ID back to raw resource ID if needed
 */
export function decodeMeiliId(meiliId: string): string {
  return meiliId.replace('__', ':');
}
