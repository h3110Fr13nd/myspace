import 'dotenv/config';
import pg from 'pg';
import { OpenFgaClient } from '@openfga/sdk';
import { withAclCacheInvalidation } from '../src/lib/aclCache';

const dbUrl = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5435/workspace_db';
const fgaUrl = process.env.OPENFGA_API_URL || 'http://localhost:8085';
const storeId = process.env.OPENFGA_STORE_ID;

async function main() {
  const pool = new pg.Pool({ connectionString: dbUrl });
  const fgaClient = new OpenFgaClient({ apiUrl: fgaUrl, storeId });

  const userId = 'user:demo';
  const subfolderId = 'folder:01_agentic_ai_systems';
  const docId = 'document:huggingface-quartz-workspace-capability-verification';
  const path = `folder:user_demo_root/${subfolderId}/${docId}`;

  await pool.query(
    `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata, title = EXCLUDED.title`,
    [
      docId,
      'document',
      'tenant_default',
      subfolderId,
      userId,
      path,
      'Comprehensive Verification Benchmark: HuggingFace & Quartz Workspace Capabilities',
      JSON.stringify({
        slug: 'huggingface-quartz-workspace-capability-verification',
        category: '01_agentic_ai_systems',
        tags: ['benchmark', 'quartz-transclusion', 'katex-math', 'rebac-security', 'pdf-streaming', 'image-embeds'],
        summary: 'Flagship capability verification note demonstrating KaTeX LaTeX math, pipe wikilinks, direct image transclusion, interactive PDF stream embeds, nested note-in-note transclusion, and ReBAC governance.',
        wikilinks: ['agentic-ai-edge-cloud-continuum', 'multi-agent-fog-broker-coordination', 'pdf:1-s2_0-s0167739x22002230-main', 'image:edge_cloud_datacenter_topology'],
      }),
    ]
  );

  try {
    await withAclCacheInvalidation(() =>
      fgaClient.write({
      writes: [
        { user: userId, relation: 'owner', object: docId },
        { user: userId, relation: 'viewer', object: docId },
        { user: subfolderId, relation: 'parent_folder', object: docId },
      ],
    })
    );
  } catch (e: any) {
    // ignore
  }

  console.log(`✓ Successfully registered ${docId} in PostgreSQL & OpenFGA!`);
  await pool.end();
}

main();
