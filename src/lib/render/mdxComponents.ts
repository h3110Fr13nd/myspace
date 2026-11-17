/**
 * MDX Component Transformers
 *
 * Handles all custom JSX/MDX component tags that appear in the research note
 * markdown files (Accordion, Note, Quote, Sidenote, Glossary, Stack, Wide,
 * FullWidth, Reference, HtmlEmbed, Image) and cleans up residual JSX syntax.
 *
 * All handlers are pure string → string transforms applied BEFORE the final
 * marked.parse() call. They may call marked.parse() internally for inner content.
 */

import { marked } from 'marked';

/** Apply all MDX component transforms sequentially to raw body text. */
export function applyMdxComponents(bodyText: string): string {
  bodyText = transformAccordion(bodyText);
  bodyText = transformNote(bodyText);
  bodyText = transformQuote(bodyText);
  bodyText = transformSidenote(bodyText);
  bodyText = transformGlossary(bodyText);
  bodyText = transformStack(bodyText);
  bodyText = transformWide(bodyText);
  bodyText = transformFullWidth(bodyText);
  bodyText = transformReference(bodyText);
  bodyText = transformHtmlEmbed(bodyText);
  bodyText = transformImage(bodyText);
  bodyText = transformHfUser(bodyText);
  bodyText = transformDemoWidgets(bodyText);
  bodyText = stripJsxSyntax(bodyText);
  return bodyText;
}

// ---------------------------------------------------------------------------
// Individual transformers
// ---------------------------------------------------------------------------

/** <Accordion title="..." open>...</Accordion> → <details> */
function transformAccordion(text: string): string {
  return text.replace(
    /<Accordion\s+title=["'](.*?)["'](?:\s+open)?\s*>([\s\S]*?)<\/Accordion>/gi,
    (_match, title, content) => {
      const innerHtml = marked.parse(content.trim()) as string;
      // All accordions start closed — avoids flooding the page with open tables
      return `<details class="prose-accordion" style="margin:1.25rem 0;padding:0 1rem;border-radius:10px;border:1px solid var(--border-glass);background:rgba(15,23,42,0.6);"><summary style="font-weight:700;color:#fff;cursor:pointer;font-size:0.95rem;padding:12px 0;list-style:none;display:flex;align-items:center;gap:8px;"><span style="color:var(--accent-cyan);">▶</span> ${title}</summary><div style="padding:10px 0 14px 0;color:var(--text-secondary);line-height:1.6;overflow-x:auto;">${innerHtml}</div></details>`;
    }
  );
}

/** <Note title="..." emoji="..." variant="...">...</Note> */
function transformNote(text: string): string {
  return text.replace(
    /<Note(?:\s+title=["'](.*?)["'])?(?:\s+emoji=["'](.*?)["'])?(?:\s+variant=["'](.*?)["'])?\s*>([\s\S]*?)<\/Note>/gi,
    (_match, title, emoji, variant, content) => {
      const icon = emoji || (variant === 'danger' ? '⚠️' : variant === 'success' ? '✅' : '💡');
      const headerTitle = title ?? (variant ? variant.toUpperCase() : 'Note');
      const innerHtml = marked.parse(content.trim()) as string;
      const borderColor = variant === 'danger' ? 'var(--accent-rose)' : variant === 'success' ? 'var(--accent-emerald)' : 'var(--accent-cyan)';
      const bgColor = variant === 'danger' ? 'rgba(244,63,94,0.08)' : variant === 'success' ? 'rgba(16,185,129,0.08)' : 'rgba(6,182,212,0.08)';
      return `<div class="prose-note" style="margin:1.25rem 0;padding:1.25rem;border-left:4px solid ${borderColor};background:${bgColor};border-radius:10px;border:1px solid ${borderColor}30;"><div style="font-weight:700;color:#fff;display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:0.9rem;"><span>${icon}</span><span>${headerTitle}</span></div><div style="color:var(--text-secondary);line-height:1.6;">${innerHtml}</div></div>`;
    }
  );
}

/** <Quote source="...">...</Quote> */
function transformQuote(text: string): string {
  return text.replace(
    /<Quote(?:\s+source=["'](.*?)["'])?\s*>([\s\S]*?)<\/Quote>/gi,
    (_match, source, content) => {
      const innerHtml = marked.parse(content.trim()) as string;
      return `<blockquote class="research-quote" style="margin:1.5rem 0;padding:1.25rem 1.5rem;border-left:4px solid var(--accent-primary);background:rgba(99,102,241,0.08);border-radius:12px;font-style:italic;color:#fff;"><div style="font-size:1.05rem;line-height:1.6;">${innerHtml}</div>${source ? `<footer style="margin-top:8px;font-size:0.85rem;color:var(--accent-cyan);font-style:normal;text-align:right;font-weight:600;">— ${source}</footer>` : ''}</blockquote>`;
    }
  );
}

/** <Sidenote>...</Sidenote> */
function transformSidenote(text: string): string {
  return text.replace(
    /<Sidenote\s*>([\s\S]*?)<\/Sidenote>/gi,
    (_match, content) => {
      const innerHtml = marked.parse(content.trim()) as string;
      return `<div class="sidenote-callout" style="margin:1rem 0;padding:10px 14px;background:rgba(148,163,184,0.1);border:1px solid var(--border-glass);border-radius:8px;font-size:0.88rem;color:var(--text-secondary);border-left:3px solid var(--accent-cyan);">${innerHtml}</div>`;
    }
  );
}

/** <Glossary term="..." definition="..." /> */
function transformGlossary(text: string): string {
  return text.replace(
    /<Glossary\s+term=["'](.*?)["']\s+definition=["'](.*?)["'](?:\s+[^>]*?)?\s*\/>/gi,
    (_match, term, definition) =>
      `<span class="glossary-term-badge" title="${definition}" style="color:var(--accent-cyan);background:rgba(0,242,254,0.12);padding:2px 8px;border-radius:6px;border:1px dashed var(--accent-cyan);font-weight:600;cursor:help;">${term} ℹ️</span>`
  );
}

/** <Stack layout="..." gap="...">...</Stack> */
function transformStack(text: string): string {
  return text.replace(
    /<Stack(?:\s+layout=["'](.*?)["'])?(?:\s+gap=["'](.*?)["'])?\s*>([\s\S]*?)<\/Stack>/gi,
    (_match, layout, _gap, content) => {
      const columns =
        layout === '3-column' ? 'repeat(3,1fr)' :
        layout === '4-column' ? 'repeat(4,1fr)' :
        'repeat(auto-fit,minmax(280px,1fr))';
      const innerHtml = marked.parse(content.trim()) as string;
      return `<div class="research-stack-grid" style="display:grid;grid-template-columns:${columns};gap:1rem;margin:1.5rem 0;">${innerHtml}</div>`;
    }
  );
}

/** <Wide>...</Wide> */
function transformWide(text: string): string {
  return text.replace(
    /<Wide\s*>([\s\S]*?)<\/Wide>/gi,
    (_match, content) => {
      const innerHtml = marked.parse(content.trim()) as string;
      return `<div class="research-wide" style="margin:1.5rem -1rem;padding:1.25rem;border-radius:12px;border:1px solid var(--border-glass);">${innerHtml}</div>`;
    }
  );
}

/** <FullWidth>...</FullWidth> */
function transformFullWidth(text: string): string {
  return text.replace(
    /<FullWidth\s*>([\s\S]*?)<\/FullWidth>/gi,
    (_match, content) => {
      const innerHtml = marked.parse(content.trim()) as string;
      return `<div class="research-full-width" style="margin:1.5rem -2rem;padding:1.5rem 2rem;background:rgba(15,23,42,0.6);">${innerHtml}</div>`;
    }
  );
}

/** <Reference id="..." caption="...">...</Reference> */
function transformReference(text: string): string {
  return text.replace(
    /<Reference\s+id=["'](.*?)["']\s+caption=["']([\s\S]*?)["']\s*>([\s\S]*?)<\/Reference>/gi,
    (_match, id, caption, content) => {
      const innerHtml = marked.parse(content.trim()) as string;
      return `<figure id="${id}" class="research-reference" style="margin:1.5rem 0;padding:1.25rem;border:1px solid var(--border-glass);border-radius:12px;">${innerHtml}<figcaption style="font-size:0.82rem;color:var(--text-muted);margin-top:8px;border-top:1px solid var(--border-glass);padding-top:6px;">${caption}</figcaption></figure>`;
    }
  );
}

/** <HtmlEmbed src="..." title="..." desc="..." ... /> → placeholder card */
function transformHtmlEmbed(text: string): string {
  return text.replace(
    /<HtmlEmbed\s+([\s\S]*?)\/>/gi,
    (_match, propsStr) => {
      const src   = (propsStr.match(/src=["'](.*?)["']/)?.[1]) ?? '';
      const title = (propsStr.match(/title=["'](.*?)["']/)?.[1]) ?? (src || 'Interactive Embed');
      const desc  = (propsStr.match(/desc=["']([\s\S]*?)["']/)?.[1]) ?? '';
      if (!src) return ''; // skip malformed / id-only tags
      return `<div class="html-embed-placeholder" style="margin:1.5rem 0;padding:1.25rem;border:1px dashed var(--border-glass);border-radius:12px;text-align:center;background:rgba(99,102,241,0.05);"><div style="font-size:0.75rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;letter-spacing:0.08em;">📊 Interactive Embed</div><div style="font-weight:700;color:#fff;margin-bottom:4px;">${title}</div>${desc ? `<div style="font-size:0.85rem;color:var(--text-secondary);">${desc}</div>` : ''}<div style="font-size:0.75rem;color:var(--text-muted);margin-top:8px;font-family:monospace;">${src}</div></div>`;
    }
  );
}

/**
 * <Image src={...} alt="..." caption="..." ... />
 * Handles both HTML-style (caption="...") and JSX-style (caption={'...'} / caption={`...`})
 */
function transformImage(text: string): string {
  return text.replace(
    /<Image\s+([\s\S]*?)\/>/gi,
    (_match, propsStr) => {
      const alt          = propsStr.match(/alt=["'](.*?)["']/)?.[1] ?? 'Image';
      const captionQ     = propsStr.match(/caption=["'](.*?)["']/)?.[1];
      const captionJsx   = propsStr.match(/caption=\{[`'"]([\s\S]*?)[`'"]\}/)?.[1];
      const caption      = captionQ ?? captionJsx ?? '';
      return `<figure class="research-image-placeholder" style="margin:1.5rem 0;padding:1rem;border:1px solid var(--border-glass);border-radius:12px;text-align:center;"><div style="padding:2rem;background:rgba(15,23,42,0.8);border-radius:8px;color:var(--text-muted);font-size:0.9rem;">🖼️ ${alt}</div>${caption ? `<figcaption style="font-size:0.8rem;color:var(--text-muted);margin-top:8px;">${caption}</figcaption>` : ''}</figure>`;
    }
  );
}

/** <HfUser username="..." name="..." /> */
function transformHfUser(text: string): string {
  return text.replace(
    /<HfUser\s+([\s\S]*?)\/>/gi,
    (_match, propsStr) => {
      const username = (propsStr.match(/username=["'](.*?)["']/)?.[1]) ?? '';
      const name = (propsStr.match(/name=["'](.*?)["']/)?.[1]) ?? username;
      const profileUrl = `https://huggingface.co/${encodeURIComponent(username)}`;
      const avatarUrl = `https://huggingface.co/api/users/${encodeURIComponent(username)}/avatar`;

      return `<div class="hf-user-badge" style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:20px;border:1px solid var(--border-glass);background:var(--surface-1);margin:4px 6px 4px 0;"><img src="${avatarUrl}" alt="${name}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'" /><a href="${profileUrl}" target="_blank" rel="noopener noreferrer" style="font-weight:600;font-size:0.85rem;color:var(--text-primary);text-decoration:none;">${name}</a><span style="font-size:0.75rem;color:var(--text-muted);">@${username}</span></div>`;
    }
  );
}

/** Demo widgets: <ColorPicker />, <Palettes /> */
function transformDemoWidgets(text: string): string {
  text = text.replace(
    /<ColorPicker\s*\/>/gi,
    '<div class="color-picker-widget-card" style="margin:1.5rem 0;padding:1.25rem;border-radius:12px;border:1px solid var(--border-glass);background:var(--surface-1);"><div style="font-weight:700;margin-bottom:6px;color:var(--accent-cyan);display:flex;align-items:center;gap:8px;">🎨 Interactive Color Palette Configurator</div><div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;">Pre-configured scientific visualization color scales conforming to WCAG 2.1 AA accessibility standards.</div><div style="display:flex;gap:8px;flex-wrap:wrap;"><span style="display:inline-block;width:32px;height:32px;border-radius:8px;background:#00f2fe;box-shadow:0 0 10px rgba(0,242,254,0.3);"></span><span style="display:inline-block;width:32px;height:32px;border-radius:8px;background:#4facfe;"></span><span style="display:inline-block;width:32px;height:32px;border-radius:8px;background:#6366f1;"></span><span style="display:inline-block;width:32px;height:32px;border-radius:8px;background:#10b981;"></span><span style="display:inline-block;width:32px;height:32px;border-radius:8px;background:#f59e0b;"></span><span style="display:inline-block;width:32px;height:32px;border-radius:8px;background:#ec4899;"></span></div></div>'
  );
  text = text.replace(
    /<Palettes\s*\/>/gi,
    '<div class="palettes-widget-card" style="margin:1.5rem 0;padding:1.25rem;border-radius:12px;border:1px solid var(--border-glass);background:var(--surface-1);"><div style="font-weight:700;margin-bottom:6px;color:var(--accent-cyan);">🌈 Scientific Palette Spectrum</div><div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;">Categorical, sequential, and diverging color swatches for D3, Plotly, and HTML canvas graphs.</div><div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:8px;"><div style="padding:8px 12px;background:rgba(0,242,254,0.1);border-radius:8px;border:1px solid var(--border-glass);font-size:0.8rem;font-weight:600;color:var(--accent-cyan);">Sequential: Cyan Deep</div><div style="padding:8px 12px;background:rgba(99,102,241,0.1);border-radius:8px;border:1px solid var(--border-glass);font-size:0.8rem;font-weight:600;color:#a5b4fc;">Categorical: Indigo Pulse</div><div style="padding:8px 12px;background:rgba(16,185,129,0.1);border-radius:8px;border:1px solid var(--border-glass);font-size:0.8rem;font-weight:600;color:#6ee7b7;">Diverging: Emerald-Rose</div></div></div>'
  );
  return text;
}

/**
 * Clean up remaining JSX syntax that has no HTML equivalent:
 *  - {/* comments *\/}
 *  - className= → class=
 *  - prop={expression} (non-string JSX props)
 */
function stripJsxSyntax(text: string): string {
  // JSX block comments
  text = text.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  // className → class
  text = text.replace(/\bclassName=/g, 'class=');
  // Remaining JSX expression props: prop={...} or prop={{ ... }}
  text = text.replace(/\b[\w-]+=\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '');
  return text;
}

