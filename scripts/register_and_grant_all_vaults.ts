import 'dotenv/config';
import { query } from '../src/lib/db';
import { writeTuples, writeTuple, PUBLIC_USER } from '../src/lib/openfga';
import * as fs from 'fs';
import * as path from 'path';

const SUPERADMIN = 'user:dummy_mail';

interface Frontmatter {
  title?: string;
  date?: string;
  author?: string;
  category?: string;
  tags?: string[];
  summary?: string;
  excerpt?: string;
  wikilinks?: string[];
  reading_time?: string;
}

function parseFrontmatter(raw: string): { frontmatter: Frontmatter; content: string } {
  const match = raw.match(/^---([\s\S]*?)---([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, content: raw };
  }

  const yamlStr = match[1];
  const content = match[2].trim();
  const frontmatter: Frontmatter = {};

  yamlStr.split('\n').forEach((line) => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();

    if (key === 'tags' || key === 'wikilinks') {
      try {
        frontmatter[key] = JSON.parse(val);
      } catch (_) {
        frontmatter[key] = val.replace(/[\[\]"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else {
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      (frontmatter as any)[key] = val;
    }
  });

  return { frontmatter, content };
}

async function registerVault(vaultDir: string, vaultSlug: string, vaultTitle: string, vaultOwner: string) {
  console.log(`\n======================================================`);
  console.log(`[Register Vault] Processing vault at: ${vaultDir}`);
  console.log(`[Register Vault] Slug: ${vaultSlug} | Title: ${vaultTitle}`);
  console.log(`======================================================`);

  if (!fs.existsSync(vaultDir)) {
    console.warn(`[Register Vault] Directory does not exist: ${vaultDir}`);
    return;
  }

  const spaceId = `space:${vaultSlug}`;
  const spacePath = spaceId;

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
      vaultSlug,
      SUPERADMIN,
      spacePath,
      vaultTitle,
      JSON.stringify({ description: `${vaultTitle} knowledge garden & research notes.` }),
    ]
  );

  const tuplesToWrite: Array<{ user: string; relation: string; object: string }> = [];

  // SuperAdmin gets owner on space
  tuplesToWrite.push({ user: SUPERADMIN, relation: 'owner', object: spaceId });
  // Public gets viewer on space
  tuplesToWrite.push({ user: PUBLIC_USER, relation: 'viewer', object: spaceId });
  if (vaultOwner !== SUPERADMIN) {
    tuplesToWrite.push({ user: vaultOwner, relation: 'editor', object: spaceId });
  }

  // 2. Iterate Category Subfolders
  const categories = fs.readdirSync(vaultDir).filter((f) => {
    const full = path.join(vaultDir, f);
    return fs.statSync(full).isDirectory();
  });

  for (const cat of categories) {
    const catDir = path.join(vaultDir, cat);
    const catSlug = cat.replace(/^[0-9]+_/, '').replace(/_/g, '-');
    const catTitle = cat
      .replace(/^[0-9]+_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());
    const catId = `collection:${vaultSlug}-${catSlug}`;
    const catPath = `${spacePath}/${catId}`;

    // Create Category Collection Resource
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
        catId,
        catSlug,
        spaceId,
        SUPERADMIN,
        catPath,
        catTitle,
        JSON.stringify({ description: `Research collection for ${catTitle}` }),
      ]
    );

    // Parent hierarchy tuple + SuperAdmin owner grant
    tuplesToWrite.push({ user: spaceId, relation: 'parent', object: catId });
    tuplesToWrite.push({ user: SUPERADMIN, relation: 'owner', object: catId });
    tuplesToWrite.push({ user: PUBLIC_USER, relation: 'viewer', object: catId });

    // 3. Iterate Markdown Files inside Category
    const files = fs.readdirSync(catDir).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(catDir, file);
      const fileSlug = file.replace(/\.md$/, '');
      const rawContent = fs.readFileSync(filePath, 'utf-8');
      const { frontmatter, content } = parseFrontmatter(rawContent);

      const postId = `post:${fileSlug}`;
      const postPath = `${catPath}/${postId}`;
      const postTitle = frontmatter.title || fileSlug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

      // Word count / reading time
      const words = content.split(/\s+/).length;
      const readingTime = `${Math.ceil(words / 200)} min read`;

      const metadata = {
        slug: fileSlug,
        filePath,
        category: frontmatter.category || catTitle,
        tags: frontmatter.tags || [],
        summary: frontmatter.summary || content.slice(0, 300),
        excerpt: frontmatter.summary || content.slice(0, 180),
        wikilinks: frontmatter.wikilinks || [],
        reading_time: frontmatter.reading_time || readingTime,
      };

      await query(
        `INSERT INTO resources (id, type, slug, parent_id, owner_id, path, title, is_public, published_at, metadata)
         VALUES ($1, 'post', $2, $3, $4, $5, $6, TRUE, NOW(), $7)
         ON CONFLICT (id) DO UPDATE SET
           slug = EXCLUDED.slug,
           parent_id = EXCLUDED.parent_id,
           title = EXCLUDED.title,
           is_public = TRUE,
           metadata = EXCLUDED.metadata`,
        [
          postId,
          fileSlug,
          catId,
          SUPERADMIN,
          postPath,
          postTitle,
          JSON.stringify(metadata),
        ]
      );

      // Parent hierarchy tuple + SuperAdmin owner grant
      tuplesToWrite.push({ user: catId, relation: 'parent', object: postId });
      tuplesToWrite.push({ user: SUPERADMIN, relation: 'owner', object: postId });
      tuplesToWrite.push({ user: PUBLIC_USER, relation: 'viewer', object: postId });
    }

    // 4. Handle PDFs or other assets inside category or pdfs/ folder
    const pdfFiles = fs.readdirSync(catDir).filter((f) => f.endsWith('.pdf'));
    for (const pdf of pdfFiles) {
      const pdfSlug = pdf.replace(/\.pdf$/, '');
      const pdfId = `asset:pdf-${pdfSlug}`;
      const pdfPath = `${catPath}/${pdfId}`;
      const pdfTitle = `${pdfSlug.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())} PDF`;

      await query(
        `INSERT INTO resources (id, type, slug, parent_id, owner_id, path, title, is_public, published_at, metadata)
         VALUES ($1, 'asset', $2, $3, $4, $5, $6, TRUE, NOW(), $7)
         ON CONFLICT (id) DO UPDATE SET
           slug = EXCLUDED.slug,
           parent_id = EXCLUDED.parent_id,
           title = EXCLUDED.title,
           is_public = TRUE`,
        [
          pdfId,
          pdfSlug,
          catId,
          SUPERADMIN,
          pdfPath,
          pdfTitle,
          JSON.stringify({ fileName: pdf, category: catTitle }),
        ]
      );

      tuplesToWrite.push({ user: catId, relation: 'parent', object: pdfId });
      tuplesToWrite.push({ user: SUPERADMIN, relation: 'owner', object: pdfId });
      tuplesToWrite.push({ user: PUBLIC_USER, relation: 'viewer', object: pdfId });
    }
  }

  // 5. Batch write all OpenFGA Tuples
  console.log(`[Register Vault] Writing ${tuplesToWrite.length} OpenFGA tuples for ${vaultTitle}...`);
  await writeTuples(tuplesToWrite);
  console.log(`✓ Vault "${vaultTitle}" successfully registered and permissions granted to ${SUPERADMIN}!`);
}

async function main() {
  console.log(`[Permission Sync] Granting full permissions to ${SUPERADMIN} across all vaults...`);

  // Ensure SuperAdmin exists in DB
  await query(
    `INSERT INTO users (id, email, display_name, is_active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [SUPERADMIN, 'dummy_mail', 'DUMMY_NAME']
  );

  const baseContent = path.join(process.cwd(), 'content');

  // Register user_demo vault
  await registerVault(
    path.join(baseContent, 'user_demo'),
    'demo-vault',
    "Demo's Research Vault",
    'user:demo'
  );

  // Register user_researcher vault
  await registerVault(
    path.join(baseContent, 'user_researcher'),
    'researcher-vault',
    "Dr. Researcher's Knowledge Base",
    'user:researcher'
  );

  console.log('\n🎉 ALL VAULTS AND PERMISSIONS FULLY SYNCHRONIZED!');
  process.exit(0);
}

main().catch((err) => {
  console.error('[Error]:', err);
  process.exit(1);
});
