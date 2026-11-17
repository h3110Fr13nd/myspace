#!/usr/bin/env node
/**
 * scripts/obsidian-sync-broker.ts
 *
 * Headless Obsidian Vault Sync Broker & Scoped Personal API Key Client
 * -------------------------------------------------------------------
 * Scans an Obsidian vault (or local content folder) for Markdown notes,
 * JSON canvases, PDF documents, and media assets, compares local content hashes
 * against the remote workspace server via /api/v1/vault/sync, and synchronizes
 * additions, updates, and deletes with support for dry-run and live watching.
 *
 * Usage:
 *   npx tsx scripts/obsidian-sync-broker.ts --vault <path> --key <fsk_live_...> [options]
 *
 * Options:
 *   --vault, -v <path>       Absolute or relative path to Obsidian vault folder (required)
 *   --key, -k <token>        Personal API key prefixed with fsk_live_ (or via FSK_API_KEY env)
 *   --server, -s <url>       Workspace server endpoint URL (default: http://localhost:4321)
 *   --vault-name, -n <name>  Custom remote vault name slug (optional, defaults to user account slug)
 *   --watch, -w              Run in continuous daemon watcher mode
 *   --dry-run, -d            Simulate delta calculation and actions without transmitting payloads
 *   --verbose                Enable exhaustive debugging logs
 *   --debounce <ms>          Watch debounce duration in milliseconds (default: 800)
 *   --help, -h               Show usage documentation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface CliArgs {
  vaultPath: string;
  apiKey: string;
  serverUrl: string;
  vaultName?: string;
  watch: boolean;
  dryRun: boolean;
  verbose: boolean;
  debounceMs: number;
}

interface LocalFileEntry {
  relativePath: string;
  fullPath: string;
  ext: string;
  sizeBytes: number;
  hash: string;
  mimeType: string;
}

interface RemoteManifestResource {
  id: string;
  type: string;
  title: string;
  path: string;
  slug: string;
  contentHash: string | null;
  sizeBytes: number | null;
  updatedAt: string;
  category?: string;
}

interface RemoteManifestResponse {
  success: boolean;
  vaultName: string;
  ownerId: string;
  count: number;
  resources: RemoteManifestResource[];
}

interface SyncDelta {
  toAdd: LocalFileEntry[];
  toUpdate: LocalFileEntry[];
  toDelete: string[]; // relative paths or slugs
  unchanged: number;
}

// Supported file extensions for sync
const SUPPORTED_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.canvas',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
  '.gif',
]);

const MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.canvas': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

function printHelp(): void {
  console.log(`
\x1b[1m\x1b[36m⚡ Obsidian Vault Sync Headless Broker & Scoped Personal API Key Client\x1b[0m

\x1b[1mUsage:\x1b[0m
  npx tsx scripts/obsidian-sync-broker.ts --vault <path> --key <fsk_live_...> [options]

\x1b[1mRequired Parameters:\x1b[0m
  --vault, -v <path>       Path to Obsidian vault directory on local disk
  --key, -k <token>        Personal Scoped API Key (prefixed with 'fsk_live_')
                           Can also be supplied via FSK_API_KEY environment variable.

\x1b[1mOptions:\x1b[0m
  --server, -s <url>       Workspace API server endpoint (default: http://localhost:4321)
  --vault-name, -n <name>  Custom remote vault namespace (default: user-derived vault)
  --watch, -w              Run in continuous filesystem watcher mode
  --dry-run, -d            Preview delta calculations without applying changes
  --verbose                Display verbose debug output for each file
  --debounce <ms>          Watch debounce duration in ms (default: 800)
  --help, -h               Show this help message

\x1b[1mExamples:\x1b[0m
  # One-shot dry-run delta calculation
  npx tsx scripts/obsidian-sync-broker.ts -v ./content/user_researcher -k fsk_live_abc123 --dry-run

  # Full synchronization with live watcher
  npx tsx scripts/obsidian-sync-broker.ts -v /path/to/my-vault -k fsk_live_abc123 --watch
`);
}

function parseCliArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let vaultPath = '';
  let apiKey = process.env.FSK_API_KEY || '';
  let serverUrl = process.env.WORKSPACE_SERVER_URL || 'http://localhost:4321';
  let vaultName: string | undefined;
  let watch = false;
  let dryRun = false;
  let verbose = false;
  let debounceMs = 800;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--vault' || arg === '-v') {
      vaultPath = argv[++i] || '';
    } else if (arg === '--key' || arg === '-k') {
      apiKey = argv[++i] || '';
    } else if (arg === '--server' || arg === '-s') {
      serverUrl = argv[++i] || serverUrl;
    } else if (arg === '--vault-name' || arg === '-n') {
      vaultName = argv[++i] || undefined;
    } else if (arg === '--watch' || arg === '-w') {
      watch = true;
    } else if (arg === '--dry-run' || arg === '-d') {
      dryRun = true;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--debounce') {
      debounceMs = parseInt(argv[++i] || '800', 10);
    }
  }

  if (!vaultPath) {
    console.error('\x1b[31m[Error] Missing required parameter: --vault <path>\x1b[0m');
    printHelp();
    process.exit(1);
  }

  const resolvedVault = path.resolve(process.cwd(), vaultPath);
  if (!fs.existsSync(resolvedVault) || !fs.statSync(resolvedVault).isDirectory()) {
    console.error(`\x1b[31m[Error] Vault directory not found: ${resolvedVault}\x1b[0m`);
    process.exit(1);
  }

  if (!apiKey) {
    console.error('\x1b[31m[Error] Missing personal API key (--key or FSK_API_KEY env var)\x1b[0m');
    process.exit(1);
  }

  if (!apiKey.startsWith('fsk_live_')) {
    console.error('\x1b[31m[Error] Invalid API key format. Expected personal key prefixed with "fsk_live_"\x1b[0m');
    process.exit(1);
  }

  // Strip trailing slashes from serverUrl
  serverUrl = serverUrl.replace(/\/+$/, '');

  return {
    vaultPath: resolvedVault,
    apiKey,
    serverUrl,
    vaultName,
    watch,
    dryRun,
    verbose,
    debounceMs,
  };
}

function computeFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Recursively scans vault directory and collects valid content files.
 */
function scanVaultDirectory(vaultDir: string, verbose: boolean): Map<string, LocalFileEntry> {
  const fileMap = new Map<string, LocalFileEntry>();

  function walk(currentDir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e: any) {
      console.warn(`[Warn] Cannot read directory ${currentDir}:`, e.message);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(vaultDir, fullPath).replace(/\\/g, '/');

      // Skip hidden folders (.obsidian, .git, .trash, etc.)
      if (entry.name.startsWith('.') || relPath.startsWith('.obsidian') || relPath.startsWith('.trash')) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) {
          if (verbose) console.log(`[Skip] Unsupported extension: ${relPath}`);
          continue;
        }

        try {
          const buffer = fs.readFileSync(fullPath);
          const hash = computeFileHash(buffer);
          const stat = fs.statSync(fullPath);
          const mimeType = MIME_MAP[ext] || 'application/octet-stream';

          fileMap.set(relPath, {
            relativePath: relPath,
            fullPath,
            ext,
            sizeBytes: stat.size,
            hash,
            mimeType,
          });
        } catch (readErr: any) {
          console.warn(`[Warn] Failed reading ${relPath}:`, readErr.message);
        }
      }
    }
  }

  walk(vaultDir);
  return fileMap;
}

/**
 * Fetch remote vault state/manifest from server
 */
async function fetchRemoteManifest(
  serverUrl: string,
  apiKey: string,
  vaultName?: string
): Promise<RemoteManifestResponse> {
  const url = new URL(`${serverUrl}/api/v1/vault/sync`);
  if (vaultName) url.searchParams.set('vaultName', vaultName);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to fetch remote manifest (${res.status} ${res.statusText}): ${errorText}`);
  }

  return (await res.json()) as RemoteManifestResponse;
}

/**
 * Computes delta between local files and remote server resources
 */
function calculateDelta(
  localFiles: Map<string, LocalFileEntry>,
  remoteManifest: RemoteManifestResponse,
  verbose: boolean
): SyncDelta {
  const remoteBySlug = new Map<string, RemoteManifestResource>();
  for (const r of remoteManifest.resources) {
    remoteBySlug.set(r.slug, r);
  }

  const toAdd: LocalFileEntry[] = [];
  const toUpdate: LocalFileEntry[] = [];
  let unchanged = 0;

  const matchedSlugs = new Set<string>();

  for (const [relPath, local] of localFiles.entries()) {
    const fileName = path.basename(relPath).replace(/\.[^/.]+$/, '');
    const slug = slugify(fileName);
    const remote = remoteBySlug.get(slug);

    if (!remote) {
      toAdd.push(local);
      if (verbose) console.log(`  \x1b[32m[+ ADD]\x1b[0m ${relPath} (slug: ${slug})`);
    } else {
      matchedSlugs.add(slug);
      // Compare hashes if available
      if (remote.contentHash && remote.contentHash === local.hash) {
        unchanged++;
        if (verbose) console.log(`  \x1b[90m[= NOOP]\x1b[0m ${relPath} (hash match: ${local.hash.slice(0, 10)}...)`);
      } else if (remote.sizeBytes && remote.sizeBytes === local.sizeBytes && !remote.contentHash) {
        // Fallback size comparison if remote lacked hash
        unchanged++;
        if (verbose) console.log(`  \x1b[90m[= NOOP]\x1b[0m ${relPath} (size match: ${local.sizeBytes}b)`);
      } else {
        toUpdate.push(local);
        if (verbose) {
          console.log(`  \x1b[33m[~ UPDATE]\x1b[0m ${relPath} (local hash: ${local.hash.slice(0, 8)}, remote: ${remote.contentHash?.slice(0, 8) || 'none'})`);
        }
      }
    }
  }

  // Deletions: resources that exist in remote manifest under this vault but no longer exist locally
  const toDelete: string[] = [];
  for (const [slug, remote] of remoteBySlug.entries()) {
    if (!matchedSlugs.has(slug)) {
      toDelete.push(slug);
      if (verbose) console.log(`  \x1b[31m[- DELETE]\x1b[0m ${remote.title} (slug: ${slug})`);
    }
  }

  return { toAdd, toUpdate, toDelete, unchanged };
}

/**
 * Transmits batch delta via multipart/form-data to /api/v1/vault/sync
 */
async function pushDeltaToServer(
  serverUrl: string,
  apiKey: string,
  vaultName: string | undefined,
  delta: SyncDelta
): Promise<any> {
  const syncFiles = [...delta.toAdd, ...delta.toUpdate];

  if (syncFiles.length === 0 && delta.toDelete.length === 0) {
    return { noop: true, message: 'Vault is already in sync with server' };
  }

  const formData = new FormData();
  if (vaultName) {
    formData.append('vaultName', vaultName);
  }

  // Attach files
  for (const entry of syncFiles) {
    const fileBytes = fs.readFileSync(entry.fullPath);
    const blob = new Blob([fileBytes], { type: entry.mimeType });
    formData.append('files', blob, path.basename(entry.relativePath));
    formData.append('paths', entry.relativePath);
  }

  // Attach deleted paths / slugs
  for (const del of delta.toDelete) {
    formData.append('deleted', del);
  }

  const endpoint = `${serverUrl}/api/v1/vault/sync`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Sync push failed (${res.status} ${res.statusText}): ${errorText}`);
  }

  return await res.json();
}

/**
 * Main execution run cycle
 */
async function runSyncCycle(args: CliArgs): Promise<boolean> {
  const startTime = Date.now();
  console.log(`\n\x1b[1m\x1b[34m[VaultSync]\x1b[0m Starting sync cycle for: \x1b[36m${args.vaultPath}\x1b[0m`);
  console.log(`\x1b[90mTarget Server: ${args.serverUrl} | API Key: ${args.apiKey.slice(0, 14)}...\x1b[0m`);

  // 1. Scan local vault files
  const localFiles = scanVaultDirectory(args.vaultPath, args.verbose);
  console.log(`Scanned \x1b[1m${localFiles.size}\x1b[0m local vault files.`);

  // 2. Fetch remote manifest
  let remoteManifest: RemoteManifestResponse;
  try {
    remoteManifest = await fetchRemoteManifest(args.serverUrl, args.apiKey, args.vaultName);
    console.log(`Remote vault '\x1b[32m${remoteManifest.vaultName}\x1b[0m' has \x1b[1m${remoteManifest.count}\x1b[0m existing resources.`);
  } catch (err: any) {
    console.error(`\x1b[31m[VaultSync Error] Manifest lookup failed:\x1b[0m ${err.message}`);
    return false;
  }

  // 3. Compute delta
  const delta = calculateDelta(localFiles, remoteManifest, args.verbose);
  console.log(`\n\x1b[1m[Sync Delta Breakdown]\x1b[0m`);
  console.log(`  ➕ Additions: \x1b[32m${delta.toAdd.length}\x1b[0m`);
  console.log(`  🔄 Updates:   \x1b[33m${delta.toUpdate.length}\x1b[0m`);
  console.log(`  🗑️  Deletions: \x1b[31m${delta.toDelete.length}\x1b[0m`);
  console.log(`  ✅ Unchanged: \x1b[90m${delta.unchanged}\x1b[0m`);

  if (delta.toAdd.length === 0 && delta.toUpdate.length === 0 && delta.toDelete.length === 0) {
    console.log(`\x1b[32m✨ Vault is 100% up-to-date with server. No changes required.\x1b[0m (${Date.now() - startTime}ms)`);
    return true;
  }

  // 4. Handle Dry-Run
  if (args.dryRun) {
    console.log(`\n\x1b[33m⚠️  [DRY-RUN] Skipping push to server. Planned changes:\x1b[0m`);
    delta.toAdd.forEach((f) => console.log(`   + Upload new file: ${f.relativePath}`));
    delta.toUpdate.forEach((f) => console.log(`   ~ Update file:     ${f.relativePath}`));
    delta.toDelete.forEach((slug) => console.log(`   - Delete resource: ${slug}`));
    return true;
  }

  // 5. Transmit delta
  try {
    console.log(`\n🚀 Transmitting delta (${delta.toAdd.length + delta.toUpdate.length} files, ${delta.toDelete.length} deletes) to server...`);
    const result = await pushDeltaToServer(args.serverUrl, args.apiKey, args.vaultName, delta);
    console.log(`\x1b[32m✅ Sync completed successfully in ${Date.now() - startTime}ms!\x1b[0m`);
    if (result.stats) {
      console.log(`   Documents: ${result.stats.documentsCount} | Canvases: ${result.stats.canvasesCount} | Assets: ${result.stats.assetsCount} | Folders: ${result.stats.foldersCount}`);
      if (result.stats.deletedCount) console.log(`   Deleted:   ${result.stats.deletedCount}`);
      if (result.stats.errors && result.stats.errors.length > 0) {
        console.warn(`   \x1b[33mWarnings during sync:\x1b[0m`, result.stats.errors);
      }
    }
    return true;
  } catch (err: any) {
    console.error(`\x1b[31m[VaultSync Error] Sync transmission failed:\x1b[0m ${err.message}`);
    return false;
  }
}

/**
 * Watcher implementation with debounced change queue
 */
function startWatcher(args: CliArgs): void {
  console.log(`\n\x1b[1m\x1b[35m[Watcher Mode]\x1b[0m Watching for changes in: \x1b[36m${args.vaultPath}\x1b[0m (debounce: ${args.debounceMs}ms)...`);

  let debounceTimer: NodeJS.Timeout | null = null;
  let isSyncing = false;
  let syncRequestedWhileRunning = false;

  const triggerDebouncedSync = (event: string, filename: string | null) => {
    if (filename && (filename.startsWith('.') || filename.includes('.obsidian') || filename.includes('.trash'))) {
      return;
    }
    if (args.verbose) {
      console.log(`[Watch Event] ${event}: ${filename}`);
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      if (isSyncing) {
        syncRequestedWhileRunning = true;
        return;
      }

      isSyncing = true;
      try {
        await runSyncCycle(args);
      } catch (err: any) {
        console.error('[Watcher Sync Error]', err.message);
      } finally {
        isSyncing = false;
        if (syncRequestedWhileRunning) {
          syncRequestedWhileRunning = false;
          triggerDebouncedSync('queued', null);
        }
      }
    }, args.debounceMs);
  };

  try {
    const watcher = fs.watch(args.vaultPath, { recursive: true }, (event, filename) => {
      triggerDebouncedSync(event, filename);
    });

    process.on('SIGINT', () => {
      console.log('\n\x1b[33mStopping vault watcher...\x1b[0m');
      watcher.close();
      process.exit(0);
    });
  } catch (e: any) {
    console.error('[Watcher Error] Failed to initialize fs.watch:', e.message);
    process.exit(1);
  }
}

/**
 * CLI Entry point
 */
async function main() {
  const args = parseCliArgs();

  // Run initial sync cycle
  const success = await runSyncCycle(args);

  if (args.watch) {
    startWatcher(args);
  } else {
    process.exit(success ? 0 : 1);
  }
}

main().catch((err) => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});
