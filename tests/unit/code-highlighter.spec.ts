import { expect, test } from '@playwright/test';
import { injectHighlightedBlocks } from '../../src/lib/render/codeHighlighter';

test.describe('server-side code highlighting', () => {
  test('renders and substitutes a highlighted block for concurrent requests', async () => {
    const block = { id: 'SHIKI_0_typescript', lang: 'typescript', code: 'const answer = 42;' };
    const render = () => injectHighlightedBlocks('<p>%%SHIKI_0_typescript%%</p>', [block]);
    const [first, second] = await Promise.all([render(), render()]);

    expect(first).toContain('const');
    expect(first).toContain('answer');
    expect(first).not.toContain('%%SHIKI_0_typescript%%');
    expect(second).not.toContain('%%SHIKI_0_typescript%%');
    expect(first).toContain('shiki-code-block');
    expect(second).toContain('shiki-code-block');
  });
});
