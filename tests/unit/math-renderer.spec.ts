import { test, expect } from '@playwright/test';
import { applyMathRendering } from '../../src/lib/render/mathRenderer';

test.describe('math rendering', () => {
  test('renders dollar-delimited inline and display expressions', () => {
    const html = applyMathRendering('Inline $E = mc^2$ and display $$x^2 + y^2 = z^2$$.');
    expect(html).toContain('class="math-inline"');
    expect(html).toContain('class="math-block"');
    expect(html).toContain('class="katex"');
  });

  test('keeps LaTeX bracket delimiters supported', () => {
    const html = applyMathRendering('Inline \\(x + y\\), display \\[x^2\\].');
    expect(html).toContain('class="math-inline"');
    expect(html).toContain('class="math-block"');
  });

  test('leaves escaped currency markers alone', () => {
    expect(applyMathRendering('Cost: \\$5')).toBe('Cost: \\$5');
  });
});
