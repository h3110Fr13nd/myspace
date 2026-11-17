import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { query } from '../src/lib/db';
import { writeTuple } from '../src/lib/openfga';
import { syncVaultFiles, type IngestFile } from '../src/lib/vaultSync';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const OWNER_EMAIL = 'dummy_mail';
const OWNER_ID = `user:${OWNER_EMAIL}`;
const DISPLAY_NAME = 'DUMMY_NAME';
const VAULT_NAME = 'demo_vault';

function collectFilesRecursively(dir: string, baseDir: string, pathPrefix: string): IngestFile[] {
  const result: IngestFile[] = [];
  if (!fs.existsSync(dir)) return result;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      result.push(...collectFilesRecursively(fullPath, baseDir, pathPrefix));
    } else if (entry.isFile()) {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      const targetRelPath = pathPrefix ? `${pathPrefix}/${relPath}` : relPath;
      const data = fs.readFileSync(fullPath);
      result.push({
        relativePath: targetRelPath,
        data,
      });
    }
  }
  return result;
}

export async function main() {
  console.log(`==> 1. Provisioning user: ${OWNER_ID}...`);
  await query(
    `INSERT INTO users (id, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [OWNER_ID, OWNER_EMAIL, DISPLAY_NAME]
  );

  console.log(`==> 2. Collecting files from content/public_vault (open/ folder)...`);
  const blogsContentDir = path.resolve(process.cwd(), 'content/public_vault');
  const openFiles = collectFilesRecursively(blogsContentDir, blogsContentDir, 'open');
  console.log(`Found ${openFiles.length} files in content/public_vault for 'open/' subfolder.`);

  console.log(`==> 3. Collecting research & workspace files (research/temp/ subfolder)...`);
  const userDemoDir = path.resolve(process.cwd(), 'content/user_demo');
  const planDir = path.resolve(process.cwd(), 'plan/initial');

  const researchFiles1 = collectFilesRecursively(userDemoDir, userDemoDir, 'research/temp/notes');
  const researchFiles2 = collectFilesRecursively(planDir, planDir, 'research/temp/plans');
  const researchFiles = [...researchFiles1, ...researchFiles2];
  console.log(`Found ${researchFiles.length} files for 'research/temp/' subfolder.`);

  const allFiles: IngestFile[] = [...openFiles, ...researchFiles];
  console.log(`Total files to ingest: ${allFiles.length}`);

  console.log(`==> 4. Executing syncVaultFiles into vault: ${VAULT_NAME}...`);
  const stats = await syncVaultFiles(allFiles, OWNER_ID, VAULT_NAME);

  console.log('==> Synchronization Complete! Summary Stats:');
  console.log(JSON.stringify(stats, null, 2));

  // 5. Ensure Open folder has public viewer access in OpenFGA
  console.log('==> 5. Ensuring public viewer tuple for open/ subfolder...');
  const openFolderId = `folder:${VAULT_NAME}_open`;
  await writeTuple('user:*', 'viewer', openFolderId).catch((e) => console.log('OpenFGA note:', e.message));
  await writeTuple('user:anonymous', 'viewer', openFolderId).catch((e) => console.log('OpenFGA note:', e.message));

  console.log('==> Successfully seeded vault with open/ (public) and research/temp/ (private) subfolders!');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[Seeding Error]', err);
    process.exit(1);
  });
}
