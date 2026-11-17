/**
 * KaTeX Math Renderer
 *
 * Supports the common Markdown delimiters `$...$` / `$$...$$` and the LaTeX
 * delimiters `\\(...\\)` / `\\[...\\]`.
 */
import katex from 'katex';

function renderFormula(formula: string, displayMode: boolean): string {
  return katex.renderToString(formula.trim(), { displayMode, throwOnError: false });
}

function wrapFormula(formula: string, displayMode: boolean): string {
  try {
    const html = renderFormula(formula, displayMode);
    return displayMode ? `<div class="math-block">${html}</div>` : `<span class="math-inline">${html}</span>`;
  } catch {
    return formula;
  }
}

export function renderDisplayMath(text: string): string {
  return text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, formula) => wrapFormula(formula, true))
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula) => wrapFormula(formula, true));
}

export function renderInlineMath(text: string): string {
  return text
    .replace(/\\\((.*?)\\\)/g, (_match, formula) => wrapFormula(formula, false))
    // Ignore escaped currency markers and require a closing delimiter on the same line.
    .replace(/(?<!\\)\$([^$\n]+?)\$/g, (_match, formula) => wrapFormula(formula, false));
}

export function applyMathRendering(text: string): string {
  return renderInlineMath(renderDisplayMath(text));
}
