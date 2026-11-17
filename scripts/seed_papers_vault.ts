import 'dotenv/config';
import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const dbUrl = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5435/workspace_db';
const RESEARCH_DIR = path.join(process.cwd(), 'content', 'public_vault', 'research');

async function main() {
  console.log(`[Seed Papers Vault] Connecting to PostgreSQL...`);
  const pool = new pg.Pool({ connectionString: dbUrl });

  const ownerId = 'user:demo';

  try {
    // 1. Research Root Folder
    const rootFolderId = 'folder:research_vault_root';
    await pool.query(
      `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
       VALUES ($1, 'folder', 'tenant_default', NULL, $2, $1, 'Academic Research Vault', $3, true, false)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, is_public = true, is_draft = false`,
      [rootFolderId, ownerId, JSON.stringify({ isResearchRoot: true })]
    );

    const subfolders = [
      { id: 'folder:research_papers', name: '77 Research Papers', dir: 'papers', type: 'paper' },
      { id: 'folder:research_authors', name: 'Authors Directory', dir: 'authors', type: 'author' },
      { id: 'folder:research_venues', name: 'Venues & Journals', dir: 'venues', type: 'venue' },
      { id: 'folder:research_institutions', name: 'Institutions & Labs', dir: 'institutions', type: 'institution' },
      { id: 'folder:research_tracks', name: 'Research Tracks', dir: 'tracks', type: 'track' },
      { id: 'folder:research_methodologies', name: 'Methodologies & Algorithms', dir: 'methodologies', type: 'methodology' },
    ];

    let totalInserted = 0;

    for (const sf of subfolders) {
      await pool.query(
        `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
         VALUES ($1, 'folder', 'tenant_default', $2, $3, $4, $5, $6, true, false)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, is_public = true, is_draft = false`,
        [sf.id, rootFolderId, ownerId, `${rootFolderId}/${sf.id}`, sf.name, JSON.stringify({ category: sf.dir })]
      );

      const targetDir = path.join(RESEARCH_DIR, sf.dir);
      if (!fs.existsSync(targetDir)) continue;

      const files = fs.readdirSync(targetDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const filePath = path.join(targetDir, file);
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const slug = file.replace('.md', '');
        const docId = `document:${slug}`;
        const docPath = `${rootFolderId}/${sf.id}/${docId}`;

        // Parse frontmatter fields
        const titleMatch = rawContent.match(/title:\s*"(.*?)"/);
        const title = titleMatch ? titleMatch[1] : slug;

        let wikilinks: string[] = [];
        const wikilinksMatch = rawContent.match(/wikilinks:\s*(\[.*?\])/s);
        if (wikilinksMatch) {
          try {
            wikilinks = JSON.parse(wikilinksMatch[1].replace(/'/g, '"'));
          } catch {
            wikilinks = [];
          }
        }

        const category = sf.dir;

        await pool.query(
          `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
           VALUES ($1, $2, 'tenant_default', $3, $4, $5, $6, $7, true, false)
           ON CONFLICT (id) DO UPDATE SET 
              type = EXCLUDED.type,
              title = EXCLUDED.title, 
              metadata = EXCLUDED.metadata, 
              is_public = true, 
              is_draft = false`,
          [
            docId,
            sf.type,
            sf.id,
            ownerId,
            docPath,
            title,
            JSON.stringify({
              slug,
              wikilinks,
              category,
              filePath,
            }),
          ]
        );
        totalInserted++;
      }
    }

    // Also register master overview index
    const masterPath = path.join(RESEARCH_DIR, 'index.md');
    if (fs.existsSync(masterPath)) {
      const masterContent = fs.readFileSync(masterPath, 'utf-8');
      const docId = 'document:research-overview-index';
      await pool.query(
        `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
         VALUES ($1, 'document', 'tenant_default', $2, $3, $4, 'Academic Research Knowledge Graph — 77 Papers Synthesis Matrix', $5, true, false)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, metadata = EXCLUDED.metadata, is_public = true, is_draft = false`,
        [
          docId,
          rootFolderId,
          ownerId,
          `${rootFolderId}/${docId}`,
          JSON.stringify({
            slug: 'research-overview-index',
            category: 'research_overview',
            filePath: masterPath,
            wikilinks: ['track-1-foundational-overviews-surveys', 'track-2-drl-workflow-scheduling', 'track-5-computation-offloading-resource-allocation'],
          }),
        ]
      );
      totalInserted++;
    }

    console.log(`✓ Successfully seeded ${totalInserted} research knowledge graph entities into PostgreSQL!`);
  } catch (err: any) {
    console.error(`[Seed Error]:`, err.message);
  } finally {
    await pool.end();
  }
}

main();

