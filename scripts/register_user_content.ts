import 'dotenv/config';
import pg from 'pg';
import { OpenFgaClient } from '@openfga/sdk';
import { withAclCacheInvalidation } from '../src/lib/aclCache';
import * as fs from 'fs';
import * as path from 'path';

const dbUrl = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5435/workspace_db';
const fgaUrl = process.env.OPENFGA_API_URL || 'http://localhost:8085';
const storeId = process.env.OPENFGA_STORE_ID;

const CONTENT_DIR = path.join(process.cwd(), 'content', 'user_demo');

const PDF_ASSETS = [
  { id: 'pdf:q3_contract', title: 'Q3 Master Service Agreement PDF', category: '01_agentic_ai_systems', summary: 'Master service agreement and legal compliance PDF asset streamed from MinIO.' },
  { id: 'pdf:agentic_ai_6g_roadmap', title: 'Agentic AI 6G Architecture Paper PDF', category: '01_agentic_ai_systems', summary: 'Technical research paper detailing Agentic AI topologies in 6G edge networks.' },
  { id: 'pdf:drl_task_offloading_spec', title: 'DRL Task Offloading Technical Spec PDF', category: '02_drl_edge_scheduling', summary: 'Detailed engineering specifications for GNN-PPO task offloading in MEC.' },
  { id: 'pdf:digital_twin_iov_whitepaper', title: 'Digital Twin 6G IoV Whitepaper PDF', category: '03_digital_twin_6g_iov', summary: 'Whitepaper detailing real-time digital twin state synchronization for 6G IoV.' },
  { id: 'pdf:serverless_iiot_benchmark', title: 'Serverless IIoT Benchmark Report PDF', category: '04_serverless_iiot_workflows', summary: 'Benchmarking Wasm micro-VM cold starts and FaaS throughput in smart factories.' },
  { id: 'pdf:irs_beamforming_paper', title: 'IRS Beamforming Optimization Paper PDF', category: '05_phy_irs_beamforming', summary: 'Convex optimization and SDR algorithms for passive IRS beamforming phase matrices.' },
];

async function main() {
  console.log(`[Register User Content] Connecting to PostgreSQL at ${dbUrl}...`);
  const pool = new pg.Pool({ connectionString: dbUrl });
  const fgaClient = new OpenFgaClient({ apiUrl: fgaUrl, storeId });

  const userId = 'user:demo';
  const userEmail = 'dummy_mail';
  const displayName = 'DUMMY_NAME';

  try {
    // 1. Insert user into PostgreSQL
    await pool.query(
      `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [userId, userEmail, displayName]
    );

    // 2. Insert Personal Root Folder
    const rootFolderId = 'folder:user_demo_root';
    await pool.query(
      `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata) 
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [
        rootFolderId,
        'folder',
        'tenant_default',
        userId,
        rootFolderId,
        "Demo's Personal Root Vault",
        JSON.stringify({ isPersonalRoot: true }),
      ]
    );

    // Write OpenFGA Owner Tuple
    try {
      await withAclCacheInvalidation(() =>
        fgaClient.write({
        writes: [{ user: userId, relation: 'owner', object: rootFolderId }],
      })
      );
    } catch (e: any) {
      // ignore
    }

    // 3. Register PDF Resources
    for (const pdfAsset of PDF_ASSETS) {
      const subfolderId = `folder:${pdfAsset.category}`;
      const pdfPath = `${rootFolderId}/${subfolderId}/${pdfAsset.id}`;

      await pool.query(
        `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [
          pdfAsset.id,
          'pdf',
          'tenant_default',
          subfolderId,
          userId,
          pdfPath,
          pdfAsset.title,
          JSON.stringify({ slug: pdfAsset.id.replace('pdf:', ''), category: pdfAsset.category, summary: pdfAsset.summary, fileName: `${pdfAsset.id.replace('pdf:', '')}.pdf` }),
        ]
      );

      // Write OpenFGA tuple
      try {
        await withAclCacheInvalidation(() =>
          fgaClient.write({
          writes: [{ user: subfolderId, relation: 'parent_folder', object: pdfAsset.id }],
        })
        );
      } catch (e: any) {
        // ignore duplicate
      }
    }
    console.log(`✓ Successfully registered ${PDF_ASSETS.length} PDF resources into PostgreSQL and OpenFGA!`);

    // 4. Recursively read markdown files from content/user_demo
    let count = 0;
    const categoryFolders = fs.readdirSync(CONTENT_DIR);
    
    for (const catFolder of categoryFolders) {
      const catPath = path.join(CONTENT_DIR, catFolder);
      if (!fs.statSync(catPath).isDirectory()) continue;

      // Create Category Subfolder Resource
      const subfolderId = `folder:${catFolder}`;
      const subfolderPath = `${rootFolderId}/${subfolderId}`;
      await pool.query(
        `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [
          subfolderId,
          'folder',
          'tenant_default',
          rootFolderId,
          userId,
          subfolderPath,
          catFolder.replace(/^\d+_/, '').replace(/_/g, ' ').toUpperCase(),
          JSON.stringify({ isSubfolder: true }),
        ]
      );

      const files = fs.readdirSync(catPath);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const filePath = path.join(catPath, file);
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const slug = file.replace('.md', '');
        const docId = `document:${slug}`;
        const docPath = `${subfolderPath}/${docId}`;

        // Parse frontmatter title
        const titleMatch = rawContent.match(/title:\s*"(.*?)"/);
        const title = titleMatch ? titleMatch[1] : slug;

        // Parse wikilinks
        const wikilinksMatch = rawContent.match(/wikilinks:\s*(\[.*?\])/);
        const wikilinks = wikilinksMatch ? JSON.parse(wikilinksMatch[1]) : [];

        await pool.query(
          `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata`,
          [
            docId,
            'document',
            'tenant_default',
            subfolderId,
            userId,
            docPath,
            title,
            JSON.stringify({ slug, wikilinks, category: catFolder, filePath }),
          ]
        );

        count++;
      }
    }

    console.log(`✓ Successfully synced all ${count} research documents with PDF wikilinks into PostgreSQL!`);
  } catch (error: any) {
    console.error(`[Register User Content Error]:`, error.message);
  } finally {
    await pool.end();
  }
}

main();
