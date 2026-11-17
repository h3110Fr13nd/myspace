import { expect, test } from '@playwright/test';
import { renderMarkdownWithEmbedsAsync } from '../../src/lib/renderEngine';

test.describe('server-side Markdown render cache', () => {
  test('coalesces simultaneous static renders and reuses their HTML', async () => {
    const token = `render-cache-${Date.now()}-${Math.random()}`;
    const source = `# ${token}\n\n\`\`\`text\n${token}\n\`\`\``;

    const [first, concurrent] = await Promise.all([
      renderMarkdownWithEmbedsAsync(source),
      renderMarkdownWithEmbedsAsync(source),
    ]);

    expect(concurrent).toBe(first);
    expect(await renderMarkdownWithEmbedsAsync(source)).toBe(first);
    expect(first).toContain(token);
  });
});
