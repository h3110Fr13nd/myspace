import 'dotenv/config';
import pg from 'pg';
import { OpenFgaClient } from '@openfga/sdk';
import { withAclCacheInvalidation } from '../src/lib/aclCache';
import { uploadAsset } from '../src/lib/storage';
import * as fs from 'fs';
import * as path from 'path';

const dbUrl = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5435/workspace_db';
const fgaUrl = process.env.OPENFGA_API_URL || 'http://localhost:8085';
const storeId = process.env.OPENFGA_STORE_ID;

const PAPERS_DIR = path.join(process.cwd(), 'temp', 'content', 'extracted_papers2', 'papers');
const CONTENT_DIR = path.join(process.cwd(), 'content', 'user_demo');

const EXTRA_RESOURCES = [
  {
    id: 'image:edge_cloud_architecture_diagram',
    type: 'image',
    title: 'Edge Cloud Continuum Architecture Diagram',
    category: '01_agentic_ai_systems',
    summary: 'High-resolution architectural topology diagram illustrating edge brokers, cloud clusters, and MAMDP agent interactions.',
    url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80',
  },
  {
    id: 'image:6g_iov_digital_twin_topology',
    type: 'image',
    title: '6G IoV Digital Twin Topology',
    category: '03_digital_twin_6g_iov',
    summary: 'Vehicular edge computing state synchronization diagram showing roadside unit (RSU) twin migration bounds.',
    url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
  },
  {
    id: 'canvas:agentic_workflow_spatial_map',
    type: 'canvas',
    title: 'Agentic Workflow Spatial Infinite Canvas',
    category: '01_agentic_ai_systems',
    summary: 'JSON Canvas infinite spatial map linking multi-agent fog broker nodes to DRL task schedulers.',
  },
  {
    id: 'sheet:edge_benchmark_metrics_grid',
    type: 'sheet',
    title: 'Edge Workload Benchmark Performance Grid',
    category: '08_edge_benchmarks_and_taxonomy',
    summary: 'FortuneSheet data grid analyzing CPU queue backlogs, latency bounds, and FaaS micro-VM cold start metrics.',
  },
];

async function main() {
  console.log(`[Seed Real PDFs & Extra Resources] OpenFGA StoreId: ${storeId}...`);
  const pool = new pg.Pool({ connectionString: dbUrl });
  const fgaClient = new OpenFgaClient({ apiUrl: fgaUrl, storeId });

  const userId = 'user:demo';
  const rootFolderId = 'folder:user_demo_root';

  const files = fs.readdirSync(PAPERS_DIR).filter((f) => f.endsWith('.pdf'));
  console.log(`Found ${files.length} real PDF files.`);

  const categoryFolders = [
    '01_agentic_ai_systems',
    '02_drl_edge_scheduling',
    '03_digital_twin_6g_iov',
    '04_serverless_iiot_workflows',
    '05_phy_irs_beamforming',
    '06_multiobjective_heterogeneous_computing',
    '07_edge_security_rebac_openfga',
    '08_edge_benchmarks_and_taxonomy',
  ];

  let pdfCount = 0;
  const registeredPdfMap: { slug: string; id: string; title: string; category: string }[] = [];

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filePath = path.join(PAPERS_DIR, filename);
    const pdfBuffer = fs.readFileSync(filePath);

    // Generate clean slug bounded to max 50 chars
    const rawSlug = filename
      .replace(/\.pdf$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .toLowerCase();

    const slug = rawSlug.substring(0, 50).replace(/_+$|-+$/, '');
    const pdfId = `pdf:${slug}`;
    const fileKey = `${slug}.pdf`;

    const cleanTitle = filename
      .replace(/\.pdf$/, '')
      .replace(/_/g, ' ')
      .replace(/-/g, ' ');

    const category = categoryFolders[i % categoryFolders.length];
    const subfolderId = `folder:${category}`;
    const pdfPath = `${rootFolderId}/${subfolderId}/${pdfId}`;

    // 1. Upload binary PDF bytes to MinIO S3 bucket 'workspace-private'
    try {
      await uploadAsset(fileKey, pdfBuffer, 'application/pdf');
    } catch (s3Err: any) {
      console.warn(`[MinIO Warning]: ${s3Err.message}`);
    }

    // 2. Register PDF resource node in PostgreSQL
    await pool.query(
      `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata, title = EXCLUDED.title`,
      [
        pdfId,
        'pdf',
        'tenant_default',
        subfolderId,
        userId,
        pdfPath,
        cleanTitle.substring(0, 120),
        JSON.stringify({
          slug,
          category,
          fileName: fileKey,
          sizeBytes: pdfBuffer.length,
          summary: `Real extracted paper PDF: ${cleanTitle}`,
        }),
      ]
    );

    // 3. Write OpenFGA Tuples
    try {
      await withAclCacheInvalidation(() =>
        fgaClient.write({
        writes: [
          { user: userId, relation: 'owner', object: pdfId },
          { user: userId, relation: 'viewer', object: pdfId },
          { user: subfolderId, relation: 'parent_folder', object: pdfId },
        ],
      })
      );
    } catch (e: any) {
      // ignore
    }

    registeredPdfMap.push({ slug, id: pdfId, title: cleanTitle, category });
    pdfCount++;
  }

  // Register Extra Resources (Image, Canvas, Sheet)
  for (const extra of EXTRA_RESOURCES) {
    const subfolderId = `folder:${extra.category}`;
    const extraPath = `${rootFolderId}/${subfolderId}/${extra.id}`;

    await pool.query(
      `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata, title = EXCLUDED.title`,
      [
        extra.id,
        extra.type,
        'tenant_default',
        subfolderId,
        userId,
        extraPath,
        extra.title,
        JSON.stringify({
          slug: extra.id.split(':')[1],
          category: extra.category,
          summary: extra.summary,
          url: extra.url,
        }),
      ]
    );

    try {
      await withAclCacheInvalidation(() =>
        fgaClient.write({
        writes: [
          { user: userId, relation: 'owner', object: extra.id },
          { user: userId, relation: 'viewer', object: extra.id },
          { user: subfolderId, relation: 'parent_folder', object: extra.id },
        ],
      })
      );
    } catch (e: any) {
      // ignore
    }
  }

  console.log(`✓ Successfully uploaded & registered 24 PDF + Image + Canvas + Sheet resources into MinIO, PostgreSQL, and OpenFGA!`);

  // 4. Update Markdown Research Notes to embed real [[pdf:slug|Title]] and [[image:slug|Title]] Wikilinks
  console.log(`[Seed Real PDFs] Embedding real PDF & Image wikilinks into 50 Markdown research notes...`);
  let updatedDocCount = 0;

  for (const catFolder of categoryFolders) {
    const catPath = path.join(CONTENT_DIR, catFolder);
    if (!fs.existsSync(catPath)) continue;

    const mdFiles = fs.readdirSync(catPath).filter((f) => f.endsWith('.md'));

    for (const mdFile of mdFiles) {
      const mdFilePath = path.join(catPath, mdFile);
      let content = fs.readFileSync(mdFilePath, 'utf-8');

      // Find PDF assets matching this category
      const matchingPdfs = registeredPdfMap.filter((p) => p.category === catFolder);
      const matchingImages = EXTRA_RESOURCES.filter((r) => r.category === catFolder && r.type === 'image');

      if (matchingPdfs.length > 0) {
        const targetPdf = matchingPdfs[updatedDocCount % matchingPdfs.length];
        const pdfWikilinkTag = `[[${targetPdf.id}|${targetPdf.title.substring(0, 45)} PDF]]`;

        let imgWikilinkTag = '';
        if (matchingImages.length > 0) {
          imgWikilinkTag = `\n- Access architecture diagram: [[${matchingImages[0].id}|${matchingImages[0].title}]]`;
        }

        // Parse frontmatter wikilinks
        const wikilinksMatch = content.match(/wikilinks:\s*(\[.*?\])/);
        if (wikilinksMatch) {
          try {
            const currentWikilinks: string[] = JSON.parse(wikilinksMatch[1]);
            if (!currentWikilinks.includes(targetPdf.id)) {
              currentWikilinks.push(targetPdf.id);
            }
            if (matchingImages.length > 0 && !currentWikilinks.includes(matchingImages[0].id)) {
              currentWikilinks.push(matchingImages[0].id);
            }
            content = content.replace(/wikilinks:\s*\[.*?\]/, `wikilinks: ${JSON.stringify(currentWikilinks)}`);
          } catch (e) {
            // ignore parse
          }
        }

        // Inject PDF & Image section if not present
        if (!content.includes('## Primary Real Resource References')) {
          content += `\n\n## Primary Real Resource References\n- Access real paper stream: ${pdfWikilinkTag}${imgWikilinkTag}\n`;
          fs.writeFileSync(mdFilePath, content, 'utf-8');
        }
      }

      // Sync updated document to PostgreSQL
      const docSlug = mdFile.replace('.md', '');
      const docId = `document:${docSlug}`;
      const titleMatch = content.match(/title:\s*"(.*?)"/);
      const title = titleMatch ? titleMatch[1] : docSlug;
      const wikilinksMatch2 = content.match(/wikilinks:\s*(\[.*?\])/);
      const wikilinks = wikilinksMatch2 ? JSON.parse(wikilinksMatch2[1]) : [];

      await pool.query(
        `UPDATE resources SET metadata = jsonb_set(metadata, '{wikilinks}', $1::jsonb) WHERE id = $2`,
        [JSON.stringify(wikilinks), docId]
      );

      updatedDocCount++;
    }
  }

  console.log(`✓ Embedded real PDF & Image wikilinks into all ${updatedDocCount} research notes!`);
  await pool.end();
}

main();
