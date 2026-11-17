import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveDocumentFilePath } from '../../src/lib/workspace/documentResolver';
import type { WorkspaceResource } from '../../src/lib/workspace/treeBuilder';

test('a cached missing file is retried so newly synced Markdown becomes visible', async () => {
  const originalCwd = process.cwd();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'document-resolver-'));
  const slug = `resolver-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const resource = {
    id: `document:${slug}`,
    type: 'document',
    title: slug,
    metadata: { category: 'Notes', slug },
  } as unknown as WorkspaceResource;

  try {
    process.chdir(temporaryRoot);
    expect(resolveDocumentFilePath(resource)).toBeNull();

    const addedFile = path.join(temporaryRoot, 'content', 'new-vault', `${slug}.md`);
    fs.mkdirSync(path.dirname(addedFile), { recursive: true });
    fs.writeFileSync(addedFile, '# Newly synced note\n');
    expect(resolveDocumentFilePath(resource)).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 1_010));
    expect(resolveDocumentFilePath(resource)).toBe(addedFile);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
