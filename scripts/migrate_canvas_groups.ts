/**
 * Migrates `.canvas` documents from geometry-derived group membership to the
 * explicit single-parent model in `src/components/canvas/core/grouping.ts`.
 *
 * Before this, a node belonged to a group because a point test against the
 * group's rect happened to pass, so membership was implicit, could disagree
 * between two different helpers, and could not survive a resize. After this,
 * every non-root node carries a `parentId` and its `x`/`y` are relative to that
 * parent, so the structure is stated rather than inferred.
 *
 * The interesting logic lives in `src/lib/canvas/canvasDocFormat.ts`; this file
 * is only the filesystem shell.
 *
 * Safety properties, in order of importance:
 *
 *  - Dry run by default. Nothing is written without `--write`.
 *  - Per-file serialisation is detected and preserved byte-for-byte. A file
 *    whose formatting cannot be reproduced exactly is reported and skipped
 *    rather than reflowed, because a data migration that also reformats the
 *    document destroys reviewability.
 *  - Idempotent. Documents are stamped with `groupingVersion`; a stamped
 *    document is re-normalised in place without re-deriving membership, and is
 *    left untouched if already current.
 *  - No canvas outside `content/` is touched. Sibling git worktrees under
 *    `.worktrees/` hold their own copies of these files and are deliberately
 *    not part of the corpus.
 *
 * Usage:
 *   npx tsx scripts/migrate_canvas_groups.ts            # dry run
 *   npx tsx scripts/migrate_canvas_groups.ts --write    # apply
 *   npx tsx scripts/migrate_canvas_groups.ts --write --force
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  detectStyle,
  isSettled,
  migrateCanvasDoc,
  serialise,
  CANVAS_ENCODINGS,
  type CanvasDoc,
} from '../src/lib/canvas/canvasDocFormat.js';

const CONTENT_ROOT = 'content';
const EXCLUDED_DIRS = new Set(['.worktrees', 'node_modules', '.git', 'dist']);

async function findCanvases(dir: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await findCanvases(path.join(dir, entry.name), found);
    } else if (entry.name.endsWith('.canvas')) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

type Status = 'migrated' | 'already-current' | 'skipped-style' | 'skipped-error';

interface FileResult {
  file: string;
  status: Status;
  adopted: number;
  coordinatesRewritten: number;
  dissolved: string[];
  detail?: string;
}

async function migrateFile(file: string, write: boolean, force: boolean): Promise<FileResult> {
  const original = await readFile(file, 'utf-8');
  const empty: Omit<FileResult, 'file' | 'status'> = { adopted: 0, coordinatesRewritten: 0, dissolved: [] };

  let doc: CanvasDoc;
  try {
    doc = JSON.parse(original) as CanvasDoc;
  } catch (err) {
    return { ...empty, file, status: 'skipped-error', detail: `unparseable JSON: ${(err as Error).message}` };
  }
  if (!Array.isArray(doc.nodes)) {
    return { ...empty, file, status: 'skipped-error', detail: 'no `nodes` array' };
  }

  const style = detectStyle(original, doc);
  if (!style && !force) {
    return {
      ...empty,
      file,
      status: 'skipped-style',
      detail: 'formatting not reproducible byte-for-byte; --force would reflow the file',
    };
  }
  const effective = style ?? { label: 'indent2, unicode (forced)', ascii: false, eol: '' };

  const { doc: next, report, dissolvedGroupIds } = migrateCanvasDoc(doc);
  if (isSettled(original, next, effective)) {
    return { ...empty, file, status: 'already-current', ...reportCounts(report) };
  }

  if (write) await writeFile(file, serialise(next, effective.ascii, effective.eol), 'utf-8');

  return { file, status: 'migrated', ...reportCounts(report), dissolved: dissolvedGroupIds };
}

function reportCounts(report: { adopted: number; groupsRefitted: number }) {
  return { adopted: report.adopted, coordinatesRewritten: report.groupsRefitted };
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const force = args.includes('--force');

  if (!existsSync(CONTENT_ROOT)) {
    console.error(`No ${CONTENT_ROOT}/ directory found; run from the repo root.`);
    process.exit(1);
  }

  const files = (await findCanvases(CONTENT_ROOT)).sort();
  if (files.length === 0) {
    console.log(`No .canvas files under ${CONTENT_ROOT}/.`);
    return;
  }

  const results: FileResult[] = [];
  for (const file of files) {
    try {
      results.push(await migrateFile(file, write, force));
    } catch (err) {
      results.push({
        file,
        status: 'skipped-error',
        adopted: 0,
        coordinatesRewritten: 0,
        dissolved: [],
        detail: (err as Error).message,
      });
    }
  }

  const label = (r: FileResult) => path.relative(process.cwd(), r.file);
  const width = Math.max(...results.map((r) => label(r).length));

  console.log(`\n${write ? 'Applying' : 'Dry run: would migrate'} ${results.length} canvas file(s)\n`);
  for (const r of results) {
    const stats =
      r.status === 'migrated' || r.status === 'already-current'
        ? `adopt ${r.adopted}, coords rewritten ${r.coordinatesRewritten}` +
          (r.dissolved.length ? `, dissolved ${r.dissolved.length}` : '')
        : (r.detail ?? '');
    console.log(`  ${label(r).padEnd(width)}  ${r.status.padEnd(16)}  ${stats}`);
  }

  const allDissolved = results.flatMap((r) => r.dissolved);
  console.log(`\n  membership adopted   : ${results.reduce((s, r) => s + r.adopted, 0)}`);
  console.log(`  coords rewritten     : ${results.reduce((s, r) => s + r.coordinatesRewritten, 0)}`);
  console.log(`  groups dissolved     : ${allDissolved.length}`);
  for (const id of allDissolved) console.log(`    - ${id}`);

  const counts = new Map<Status, number>();
  for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  console.log(
    `  by status            : ${[...counts].map(([k, v]) => `${k}=${v}`).join(', ')}`
  );

  console.log('');
  if (!write) {
    console.log('  Nothing was written. Re-run with --write to apply.');
    if (results.some((r) => r.status === 'skipped-style')) {
      console.log('  Files skipped for formatting also need --force.');
    }
  } else {
    console.log('  Written. Review with `git diff -- content`, roll back with `git checkout -- content`.');
  }
}

await main();
