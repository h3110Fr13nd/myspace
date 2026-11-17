import 'dotenv/config';
import { query } from '../src/lib/db';
import { uploadAsset } from '../src/lib/storage';
import { writeTuples, PUBLIC_USER } from '../src/lib/openfga';
import * as fs from 'fs';
import * as path from 'path';

const SUPERADMIN = 'user:dummy_mail';
const PAPERS_DIR = '/home/user/Desktop/dev/papers/pdfs';

// Categorization heuristic for the 67 research papers
function categorizePaper(filename: string): { catSlug: string; catTitle: string } {
  const f = filename.toLowerCase();

  if (f.includes('agentic') || f.includes('agent') || f.includes('llm') || f.includes('world_model') || f.includes('generative_intent')) {
    return { catSlug: 'agentic-ai-and-llms', catTitle: 'Agentic AI & Large Language Models' };
  }
  if (f.includes('workflow') || f.includes('serverless') || f.includes('cosco') || f.includes('containerized')) {
    return { catSlug: 'serverless-and-workflows', catTitle: 'Serverless & Scientific Workflows' };
  }
  if (f.includes('digital_twin') || f.includes('iov') || f.includes('satellite') || f.includes('6g')) {
    return { catSlug: 'digital-twins-and-6g', catTitle: 'Digital Twins, IoV & 6G Networks' };
  }
  if (f.includes('irs') || f.includes('beamforming') || f.includes('phy') || f.includes('reflecting_surface')) {
    return { catSlug: 'phy-and-irs-systems', catTitle: 'PHY Layer & Intelligent Reflecting Surfaces' };
  }
  if (f.includes('taxonomy') || f.includes('survey') || f.includes('toolkit') || f.includes('ifogsim') || f.includes('workflowsim') || f.includes('benchmark')) {
    return { catSlug: 'benchmarks-surveys-toolkits', catTitle: 'Benchmarks, Surveys & Toolkits' };
  }
  return { catSlug: 'edge-offloading-and-drl', catTitle: 'Edge Computation Offloading & DRL Scheduling' };
}

// Convert paper filename to clean human-readable title
function formatPaperTitle(filename: string): string {
  return filename
    .replace(/^paper_[0-9]+_/, '')
    .replace(/\.pdf$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

async function main() {
  console.log('======================================================');
  console.log(`[Papers Vault] Initializing PhD Research Papers Library...`);
  console.log(`[Papers Vault] Reading from: ${PAPERS_DIR}`);
  console.log('======================================================');

  if (!fs.existsSync(PAPERS_DIR)) {
    console.error(`Directory not found: ${PAPERS_DIR}`);
    process.exit(1);
  }

  // Ensure public/pdfs directory exists for direct browser downloads
  const publicPdfDir = path.join(process.cwd(), 'public', 'pdfs');
  if (!fs.existsSync(publicPdfDir)) {
    fs.mkdirSync(publicPdfDir, { recursive: true });
  }

  const spaceId = 'space:papers-vault';
  const spaceSlug = 'papers-vault';
  const spaceTitle = 'PhD Research Papers & Literature Library';

  // 1. Create Space Resource
  await query(
    `INSERT INTO resources (id, type, slug, parent_id, owner_id, path, title, is_public, published_at, metadata)
     VALUES ($1, 'space', $2, NULL, $3, $4, $5, TRUE, NOW(), $6)
     ON CONFLICT (id) DO UPDATE SET
       slug = EXCLUDED.slug,
       title = EXCLUDED.title,
       is_public = TRUE,
       metadata = EXCLUDED.metadata`,
    [
      spaceId,
      spaceSlug,
      SUPERADMIN,
      spaceId,
      spaceTitle,
      JSON.stringify({
        description: 'Comprehensive research repository containing 67 peer-reviewed papers on Agentic AI, Edge Computing, DRL Scheduling, and 6G Networks.',
        vaultType: 'papers_library',
      }),
    ]
  );

  const tuplesToWrite: Array<{ user: string; relation: string; object: string }> = [
    { user: SUPERADMIN, relation: 'owner', object: spaceId },
    { user: PUBLIC_USER, relation: 'viewer', object: spaceId },
  ];

  // 2. Read and organize all PDF files
  const pdfFiles = fs.readdirSync(PAPERS_DIR).filter((f) => f.endsWith('.pdf'));
  console.log(`[Papers Vault] Found ${pdfFiles.length} research paper PDFs.`);

  const createdCollections = new Set<string>();

  for (const pdfFile of pdfFiles) {
    const filePath = path.join(PAPERS_DIR, pdfFile);
    const fileStats = fs.statSync(filePath);
    const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
    const cleanSlug = pdfFile.replace(/\.pdf$/, '');
    const cleanTitle = formatPaperTitle(pdfFile);

    // Copy to public/pdfs for instant access
    const destPath = path.join(publicPdfDir, pdfFile);
    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(filePath, destPath);
    }

    // Determine category
    const { catSlug, catTitle } = categorizePaper(pdfFile);
    const colId = `collection:papers-${catSlug}`;
    const colPath = `${spaceId}/${colId}`;

    // Create Category Collection if not yet created
    if (!createdCollections.has(colId)) {
      await query(
        `INSERT INTO resources (id, type, slug, parent_id, owner_id, path, title, is_public, published_at, metadata)
         VALUES ($1, 'collection', $2, $3, $4, $5, $6, TRUE, NOW(), $7)
         ON CONFLICT (id) DO UPDATE SET
           slug = EXCLUDED.slug,
           parent_id = EXCLUDED.parent_id,
           title = EXCLUDED.title,
           is_public = TRUE,
           metadata = EXCLUDED.metadata`,
        [
          colId,
          catSlug,
          spaceId,
          SUPERADMIN,
          colPath,
          catTitle,
          JSON.stringify({ description: `Research papers in ${catTitle}` }),
        ]
      );

      tuplesToWrite.push({ user: spaceId, relation: 'parent', object: colId });
      tuplesToWrite.push({ user: SUPERADMIN, relation: 'owner', object: colId });
      tuplesToWrite.push({ user: PUBLIC_USER, relation: 'viewer', object: colId });

      createdCollections.add(colId);
    }

    // 3. Create PDF Resource in PostgreSQL
    const pdfResourceId = `pdf:${cleanSlug}`;
    const pdfPath = `${colPath}/${pdfResourceId}`;

    const metadata = {
      slug: cleanSlug,
      fileName: pdfFile,
      fileSizeBytes: fileStats.size,
      fileSizeMB: `${fileSizeMB} MB`,
      category: catTitle,
      downloadUrl: `/pdfs/${pdfFile}`,
      streamUrl: `/api/v1/assets/pdf/${cleanSlug}`,
      tags: ['research-paper', 'pdf', catSlug],
      summary: `Research paper PDF: ${cleanTitle}. File size: ${fileSizeMB} MB. Streamable directly via embedded PDF viewer.`,
      excerpt: `Research paper PDF: ${cleanTitle}. (${fileSizeMB} MB)`,
    };

    await query(
      `INSERT INTO resources (id, type, slug, parent_id, owner_id, path, title, is_public, published_at, metadata)
       VALUES ($1, 'pdf', $2, $3, $4, $5, $6, TRUE, NOW(), $7)
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         parent_id = EXCLUDED.parent_id,
         title = EXCLUDED.title,
         is_public = TRUE,
         metadata = EXCLUDED.metadata`,
      [
        pdfResourceId,
        cleanSlug,
        colId,
        SUPERADMIN,
        pdfPath,
        cleanTitle,
        JSON.stringify(metadata),
      ]
    );

    // Parent hierarchy tuple + SuperAdmin owner grant + Public viewer
    tuplesToWrite.push({ user: colId, relation: 'parent', object: pdfResourceId });
    tuplesToWrite.push({ user: SUPERADMIN, relation: 'owner', object: pdfResourceId });
    tuplesToWrite.push({ user: PUBLIC_USER, relation: 'viewer', object: pdfResourceId });

    // Also upload to MinIO asynchronously
    const fileBuffer = fs.readFileSync(filePath);
    uploadAsset(pdfFile, fileBuffer, 'application/pdf').catch(() => {});
  }

  // 4. Batch write all OpenFGA Tuples
  console.log(`[Papers Vault] Writing ${tuplesToWrite.length} OpenFGA tuples...`);
  await writeTuples(tuplesToWrite);

  console.log(`\n🎉 SUCCESSFULLY REGISTERED ${pdfFiles.length} PAPERS INTO PAPERS VAULT!`);
  console.log(`✓ Space: space:papers-vault (/s/papers-vault)`);
  console.log(`✓ Collections: ${createdCollections.size} thematic research categories.`);
  console.log(`✓ Permissions: ${SUPERADMIN} granted full owner permissions.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Error]:', err);
  process.exit(1);
});
