import 'dotenv/config';
import { OpenFgaClient } from '@openfga/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { withAclCacheInvalidation } from '../src/lib/aclCache';

const apiUrl = process.env.OPENFGA_API_URL || 'http://localhost:8085';

export interface InitOpenFGAOptions {
  /** Reuse an existing store instead of creating a new one. Defaults to OPENFGA_STORE_ID. */
  storeId?: string;
  /** Whether to write the bootstrap demo tuples. Defaults to true. */
  seed?: boolean;
}

export async function initOpenFGA(options: InitOpenFGAOptions = {}) {
  console.log(`[OpenFGA Init Script] Connecting to OpenFGA at ${apiUrl}...`);

  const { seed = true } = options;
  const reuseStoreId = options.storeId || process.env.OPENFGA_STORE_ID || '';

  // Step 1: Create client (reuse existing store when an ID is provided)
  let client = new OpenFgaClient({ apiUrl });
  let storeId = reuseStoreId;

  try {
    if (storeId) {
      console.log(`[OpenFGA Init Script] Reusing existing store: ${storeId}`);
      client = new OpenFgaClient({ apiUrl, storeId });
    } else {
      const storeResponse = await client.createStore({
        name: 'FOSS Workspace Store',
      });
      storeId = storeResponse.id;
      console.log(`[OpenFGA Init Script] Store created successfully! Store ID: ${storeId}`);

      // Re-initialize client with Store ID
      client = new OpenFgaClient({ apiUrl, storeId });
    }

    // Step 2: Deploy Authorization Model
    console.log(`[OpenFGA Init Script] Deploying OpenFGA Authorization Model...`);
    const modelResponse = await client.writeAuthorizationModel({
      schema_version: '1.1',
      type_definitions: [
        { type: 'user' },
        {
          type: 'group',
          relations: {
            member: { this: {} },
          },
          metadata: {
            relations: {
              member: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }] },
            },
          },
        },
        { type: 'service_account' },
        {
          type: 'tag',
          relations: {
            owner: { this: {} },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                ],
              },
            },
          },
          metadata: {
            relations: {
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
            },
          },
        },
        {
          type: 'space',
          relations: {
            owner: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                ],
              },
            },
          },
          metadata: {
            relations: {
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
            },
          },
        },
        {
          type: 'folder',
          relations: {
            parent_space: { this: {} },
            parent_folder: { this: {} },
            owner: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                  { tupleToUserset: { tupleset: { relation: 'parent_space' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                  { tupleToUserset: { tupleset: { relation: 'parent_space' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
            denied_viewer: { this: {} },
          },
          metadata: {
            relations: {
              parent_space: { directly_related_user_types: [{ type: 'space' }] },
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              denied_viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }] },
            },
          },
        },
        {
          type: 'document',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            tagged: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
            denied_viewer: { this: {} },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              tagged: { directly_related_user_types: [{ type: 'tag' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              denied_viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }] },
            },
          },
        },
        {
          type: 'blog',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            tagged: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
            denied_viewer: { this: {} },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              tagged: { directly_related_user_types: [{ type: 'tag' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              denied_viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }] },
            },
          },
        },
        {
          type: 'canvas',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            tagged: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              tagged: { directly_related_user_types: [{ type: 'tag' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
            },
          },
        },
        {
          type: 'canvas_node',
          relations: {
            parent_canvas: { this: {} },
            owner: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_canvas' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_canvas' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
            denied_viewer: { this: {} },
          },
          metadata: {
            relations: {
              parent_canvas: { directly_related_user_types: [{ type: 'canvas' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              denied_viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }] },
            },
          },
        },
        {
          type: 'pdf',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            tagged: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
            denied_viewer: { this: {} },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              tagged: { directly_related_user_types: [{ type: 'tag' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              denied_viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }] },
            },
          },
        },
        {
          type: 'sheet',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
            denied_viewer: { this: {} },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              denied_viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }] },
            },
          },
        },
        {
          type: 'form',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
            submitter: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'viewer' } },
                ],
              },
            },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              submitter: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
            },
          },
        },
        {
          type: 'todo',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            assignee: { this: {} },
            tagged: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { computedUserset: { relation: 'assignee' } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              assignee: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              tagged: { directly_related_user_types: [{ type: 'tag' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
            },
          },
        },
        {
          type: 'collection',
          relations: {
            owner: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                ],
              },
            },
          },
          metadata: {
            relations: {
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
            },
          },
        },
        // ── Cloud / Media / Extended Resource Types ──────────────────────────────
        {
          type: 'image',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            tagged: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
            denied_viewer: { this: {} },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              tagged: { directly_related_user_types: [{ type: 'tag' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              denied_viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }] },
            },
          },
        },
        {
          type: 'excalidraw',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            tagged: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              tagged: { directly_related_user_types: [{ type: 'tag' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
            },
          },
        },
        {
          type: 'mermaid',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            tagged: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              tagged: { directly_related_user_types: [{ type: 'tag' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
            },
          },
        },
        {
          type: 'paper',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            tagged: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
            denied_viewer: { this: {} },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              tagged: { directly_related_user_types: [{ type: 'tag' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              denied_viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }] },
            },
          },
        },
        {
          type: 'google_doc',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            tagged: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
            denied_viewer: { this: {} },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              tagged: { directly_related_user_types: [{ type: 'tag' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              denied_viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }] },
            },
          },
        },
        {
          type: 'google_sheet',
          relations: {
            parent_folder: { this: {} },
            owner: { this: {} },
            tagged: { this: {} },
            editor: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'editor' } } },
                ],
              },
            },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { computedUserset: { relation: 'owner' } },
                  { computedUserset: { relation: 'editor' } },
                  { tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
            denied_viewer: { this: {} },
          },
          metadata: {
            relations: {
              parent_folder: { directly_related_user_types: [{ type: 'folder' }] },
              owner: { directly_related_user_types: [{ type: 'user' }, { type: 'service_account' }] },
              tagged: { directly_related_user_types: [{ type: 'tag' }] },
              editor: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }, { type: 'service_account' }] },
              denied_viewer: { directly_related_user_types: [{ type: 'user' }, { type: 'group', relation: 'member' }] },
            },
          },
        },
      ],
    });
    console.log(`[OpenFGA Init Script] Authorization Model deployed! ID: ${modelResponse.authorization_model_id}`);

    // Step 3: Write Relationship Tuples (skipped when re-deploying a model)
    if (seed) {
      console.log(`[OpenFGA Init Script] Writing initial authorization relationship tuples...`);
      await withAclCacheInvalidation(() =>
        client.write({
          writes: [
            { user: 'user:alice', relation: 'owner', object: 'space:main' },
            { user: 'user:carol', relation: 'viewer', object: 'space:main' },
            { user: 'space:main', relation: 'parent_space', object: 'folder:docs' },
            { user: 'folder:docs', relation: 'parent_folder', object: 'document:arch_doc' },
            { user: 'folder:docs', relation: 'parent_folder', object: 'pdf:q3_contract' },
            { user: 'user:bob', relation: 'denied_viewer', object: 'pdf:q3_contract' },
            { user: 'user:alice', relation: 'editor', object: 'sheet:financial_q3' },
          ],
        })
      );

      console.log(`[OpenFGA Init Script] Relationship tuples written successfully!`);
    }

    // Persist the active store ID back to .env for the runtime app
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf-8');
      envContent = envContent.replace(/OPENFGA_STORE_ID=.*/, `OPENFGA_STORE_ID=${storeId}`);
      fs.writeFileSync(envPath, envContent, 'utf-8');
    }
  } catch (error: any) {
    console.error('[OpenFGA Init Script Error]:', error.message);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  initOpenFGA().catch((err) => {
    console.error('[OpenFGA Init Fatal Error]', err);
    process.exit(1);
  });
}
