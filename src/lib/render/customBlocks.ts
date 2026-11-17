/**
 * Custom Block Renderer for Reader / View Mode
 *
 * Converts TipTap block node serializations:
 *   - <div data-jupyter-block="true" ...></div>
 *   - <div data-canvas-block="true" ...></div>
 *   - <div data-excalidraw-block="true" ...></div>
 *   - <div data-mermaid-block="true" ...></div>
 *   - <div data-google-resource-block="true" ...></div>
 *
 * into fully styled, interactive, readable HTML widgets for view mode.
 */

import rough from 'roughjs';

const roughGenerator = rough.generator();

function decodeAttr(val: string | null | undefined): string {
  if (!val) return '';
  return val
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeHtml(val: string): string {
  if (!val) return '';
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render Jupyter Block in View Mode */
function renderJupyterBlock(attrsStr: string): string {
  const codeMatch = attrsStr.match(/data-code=["']([\s\S]*?)["']/) || attrsStr.match(/code=["']([\s\S]*?)["']/);
  const outputMatch = attrsStr.match(/data-output=["']([\s\S]*?)["']/) || attrsStr.match(/output=["']([\s\S]*?)["']/);
  const countMatch = attrsStr.match(/data-execution-count=["'](\d+)["']/) || attrsStr.match(/executioncount=["'](\d+)["']/);

  const code = decodeAttr(codeMatch ? codeMatch[1] : '');
  const output = decodeAttr(outputMatch ? outputMatch[1] : '');
  const executionCount = countMatch ? countMatch[1] : '1';

  const outHtml = output
    ? `<div style="display: flex; gap: 10px; align-items: flex-start; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 10px; margin-top: 8px;"><div style="font-family: monospace; font-size: 0.75rem; color: var(--accent-rose, #f43f5e); font-weight: 700; padding-top: 2px; user-select: none; flex-shrink: 0;">Out [${executionCount}]:</div><div style="flex: 1; min-width: 0; font-family: monospace; font-size: 0.8rem; color: #38bdf8; background: rgba(0, 0, 0, 0.25); padding: 6px 10px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.04); overflow-x: auto;">${escapeHtml(output)}</div></div>`
    : '';

  return `<div class="block-chrome-shell jupyter-cell-view" style="margin: 1.5rem 0; border-radius: 12px; border: 1px solid rgba(243, 118, 38, 0.35); background: rgba(10, 15, 28, 0.85); backdrop-filter: blur(16px); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); overflow: hidden;"><div style="padding: 8px 14px; background: rgba(243, 118, 38, 0.12); border-bottom: 1px solid rgba(243, 118, 38, 0.2); display: flex; align-items: center; justify-content: space-between;"><div style="display: flex; align-items: center; gap: 8px;"><span style="font-size: 1.1rem;">🪐</span><span style="font-weight: 700; color: #fff; font-size: 0.88rem;">Jupyter Cell [${executionCount}]</span></div><span class="ui-badge ui-badge--info" style="font-size: 0.68rem; padding: 2px 8px; border-radius: 6px; background: rgba(243, 118, 38, 0.2); color: #f37626; border: 1px solid rgba(243, 118, 38, 0.3);">Python 3</span></div><div style="padding: 12px 14px; background: rgba(8, 12, 24, 0.95);"><div style="display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px;"><div style="font-family: monospace; font-size: 0.75rem; color: #f37626; font-weight: 700; padding-top: 6px; user-select: none; flex-shrink: 0;">In [${executionCount}]:</div><div style="flex: 1; min-width: 0;"><pre style="margin: 0; padding: 8px 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; color: #e2e8f0; font-family: monospace; font-size: 0.8rem; line-height: 1.5; overflow-x: auto;"><code>${escapeHtml(code)}</code></pre></div></div>${outHtml}</div></div>`;
}

/** Render Spatial Canvas Block in View Mode */
function renderCanvasBlock(attrsStr: string): string {
  const idMatch = attrsStr.match(/data-canvas-id=["']([\s\S]*?)["']/) || attrsStr.match(/canvasid=["']([\s\S]*?)["']/);
  const titleMatch = attrsStr.match(/data-title=["']([\s\S]*?)["']/) || attrsStr.match(/title=["']([\s\S]*?)["']/);

  const canvasId = decodeAttr(idMatch ? idMatch[1] : 'workspace-architecture');
  const title = decodeAttr(titleMatch ? titleMatch[1] : 'Spatial Canvas Board');

  return `
<div class="block-chrome-shell canvas-embed-node" style="margin: 1.5rem 0; border-radius: 12px; border: 1px solid rgba(147, 51, 234, 0.4); background: radial-gradient(ellipse at top left, rgba(147, 51, 234, 0.15), rgba(8, 12, 26, 0.85)); backdrop-filter: blur(16px); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); overflow: hidden;">
  <div style="padding: 10px 14px; background: rgba(147, 51, 234, 0.1); border-bottom: 1px solid rgba(147, 51, 234, 0.2); display: flex; align-items: center; justify-content: space-between;">
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 1.2rem;">🗺️</span>
      <div>
        <div style="font-size: 0.85rem; font-weight: 700; color: #c084fc;">${escapeHtml(title)}</div>
        <div style="font-size: 0.72rem; color: var(--text-muted);">Spatial Canvas Board · JSON Canvas v1.0</div>
      </div>
    </div>
    <a href="/?doc=${encodeURIComponent('canvas:' + canvasId)}" style="display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #9333ea, #c084fc); color: #fff; text-decoration: none; padding: 4px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; box-shadow: 0 0 12px rgba(147, 51, 234, 0.4);">
      <span>🔍 Open Full Canvas ↗</span>
    </a>
  </div>
  <div style="position: relative; height: 160px; background: rgba(5, 8, 16, 0.7); background-image: radial-gradient(rgba(147, 51, 234, 0.25) 1px, transparent 1px); background-size: 16px 16px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
    <div style="position: absolute; left: 15%; top: 25%; background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(0, 242, 254, 0.4); border-radius: 6px; padding: 6px 10px; font-size: 0.72rem; color: var(--accent-cyan); box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
      📄 Core Schema
    </div>
    <div style="position: absolute; right: 20%; bottom: 25%; background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(236, 72, 153, 0.4); border-radius: 6px; padding: 6px 10px; font-size: 0.72rem; color: #f472b6; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
      ⚡ ReBAC Edge Engine
    </div>
    <svg style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;">
      <line x1="28%" y1="35%" x2="72%" y2="65%" stroke="rgba(192, 132, 252, 0.5)" stroke-width="2" stroke-dasharray="4 4" />
    </svg>
    <div style="z-index: 2; text-align: center; background: rgba(8, 12, 24, 0.85); padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border-glass);">
      <span style="font-size: 0.82rem; color: var(--text-secondary);">Embedded Interactive Canvas: <strong style="color: #c084fc;">${escapeHtml(canvasId)}</strong></span>
    </div>
  </div>
</div>`;
}

/** Render Excalidraw Sketch in View Mode */
function renderExcalidrawBlock(attrsStr: string): string {
  const elementsMatch = attrsStr.match(/data-elements=["']([\s\S]*?)["']/) || attrsStr.match(/elements=["']([\s\S]*?)["']/);
  const titleMatch = attrsStr.match(/data-title=["']([\s\S]*?)["']/) || attrsStr.match(/title=["']([\s\S]*?)["']/);

  const title = decodeAttr(titleMatch ? titleMatch[1] : 'Excalidraw Sketch');
  let elements: any[] = [];
  if (elementsMatch) {
    try {
      const raw = decodeAttr(elementsMatch[1]);
      elements = JSON.parse(raw);
    } catch {
      elements = [];
    }
  }

  // Generate RoughJS SVG shapes for the sketch
  let svgShapes = '';
  let minX = 0, minY = 0, maxX = 560, maxY = 160;

  if (Array.isArray(elements) && elements.length > 0) {
    elements.forEach((el: any) => {
      const stroke = el.strokeColor || '#ec4899';
      const bg = el.backgroundColor || 'transparent';
      const strokeWidth = el.strokeWidth || 2;
      const roughness = el.roughness !== undefined ? el.roughness : 1.2;
      const opacity = el.opacity !== undefined ? el.opacity : 1;

      const roughOptions: any = {
        stroke,
        fill: bg !== 'transparent' ? bg : undefined,
        strokeWidth,
        roughness,
        bowing: 1.5,
        fillStyle: el.fillStyle || (bg !== 'transparent' ? 'hachure' : undefined),
        hachureAngle: 60,
        hachureGap: 5,
      };

      let drawable: any = null;
      switch (el.type) {
        case 'rectangle':
          drawable = roughGenerator.rectangle(el.x, el.y, el.width, el.height, roughOptions);
          break;
        case 'ellipse':
          drawable = roughGenerator.ellipse(el.x + el.width / 2, el.y + el.height / 2, el.width, el.height, roughOptions);
          break;
        case 'diamond': {
          const midX = el.x + el.width / 2;
          const midY = el.y + el.height / 2;
          drawable = roughGenerator.polygon(
            [[midX, el.y], [el.x + el.width, midY], [midX, el.y + el.height], [el.x, midY]],
            roughOptions
          );
          break;
        }
        case 'arrow':
        case 'line': {
          const p = el.points || [[0, 0], [el.width, el.height]];
          const pts: [number, number][] = p.map((pt: [number, number]) => [el.x + pt[0], el.y + pt[1]]);
          drawable = roughGenerator.linearPath(pts, roughOptions);
          break;
        }
        case 'text':
          svgShapes += `<text x="${el.x}" y="${el.y + (el.fontSize || 16)}" fill="${stroke}" font-size="${el.fontSize || 16}" font-family="'Segoe UI', system-ui, sans-serif" font-weight="600" opacity="${opacity}">${escapeHtml(el.text || '')}</text>`;
          return;
      }

      if (drawable) {
        const paths = roughGenerator.toPaths(drawable);
        const isArrow = el.type === 'arrow';
        const lastPt = el.points ? el.points[el.points.length - 1] : [el.width, el.height];
        const arrowX = el.x + lastPt[0];
        const arrowY = el.y + lastPt[1];

        svgShapes += `<g opacity="${opacity}">`;
        paths.forEach((p: any) => {
          svgShapes += `<path d="${p.d}" stroke="${p.stroke !== 'none' ? stroke : 'none'}" stroke-width="${p.strokeWidth || strokeWidth}" fill="${p.fill !== 'none' ? bg : 'none'}" stroke-linecap="round" />`;
        });
        if (isArrow) {
          svgShapes += `<circle cx="${arrowX}" cy="${arrowY}" r="4" fill="${stroke}" />`;
        }
        svgShapes += `</g>`;
      }
    });
  }

  return `
<div class="block-chrome-shell excalidraw-view-node" style="margin: 1.5rem 0; border-radius: 12px; border: 1px solid rgba(236, 72, 153, 0.4); background: rgba(10, 15, 28, 0.85); backdrop-filter: blur(16px); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); overflow: hidden;">
  <div style="padding: 8px 14px; background: rgba(236, 72, 153, 0.12); border-bottom: 1px solid rgba(236, 72, 153, 0.2); display: flex; align-items: center; justify-content: space-between;">
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 1.1rem;">🎨</span>
      <span style="font-weight: 700; color: #fff; font-size: 0.88rem;">${escapeHtml(title)}</span>
    </div>
    <span class="ui-badge" style="font-size: 0.68rem; padding: 2px 8px; border-radius: 6px; background: rgba(236, 72, 153, 0.2); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.3);">Hand-drawn Diagram</span>
  </div>
  <div style="min-height: 180px; background: radial-gradient(ellipse at center, rgba(236, 72, 153, 0.04) 0%, rgba(8, 12, 24, 0.95) 100%); display: flex; align-items: center; justify-content: center; padding: 16px; overflow-x: auto;">
    <svg width="100%" height="180" viewBox="0 0 560 160" style="max-width: 560px; display: block;">
      ${svgShapes}
    </svg>
  </div>
</div>`;
}

/** Render Mermaid Block in View Mode */
function renderMermaidBlock(attrsStr: string): string {
  const codeMatch = attrsStr.match(/data-code=["']([\s\S]*?)["']/) || attrsStr.match(/code=["']([\s\S]*?)["']/);
  const code = decodeAttr(codeMatch ? codeMatch[1] : 'graph TD;\n  A[Start] --> B[Finish];');
  const containerId = `mermaid-block-${Math.random().toString(36).slice(2, 9)}`;

  return `
<div class="block-chrome-shell mermaid-view-node" id="${containerId}" style="margin: 1.5rem 0; border-radius: 12px; border: 1px solid rgba(99, 102, 241, 0.4); background: rgba(10, 15, 28, 0.85); backdrop-filter: blur(16px); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); overflow: hidden;">
  <div style="padding: 8px 14px; background: rgba(99, 102, 241, 0.12); border-bottom: 1px solid rgba(99, 102, 241, 0.2); display: flex; align-items: center; justify-content: space-between;">
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 1.1rem;">📐</span>
      <span style="font-weight: 700; color: #fff; font-size: 0.88rem;">Mermaid Diagram</span>
    </div>
    <span class="ui-badge" style="font-size: 0.68rem; padding: 2px 8px; border-radius: 6px; background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3);">Vector Chart</span>
  </div>
  <div class="mermaid-diagram-target" style="padding: 1.5rem; text-align: center; background: rgba(8, 12, 24, 0.95); overflow-x: auto;">
    <pre class="mermaid" style="margin: 0; background: transparent;">${escapeHtml(code)}</pre>
  </div>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    try {
      mermaid.initialize({ startOnLoad: true, theme: 'dark' });
      mermaid.run({ querySelector: '#${containerId} .mermaid' });
    } catch (e) {
      console.warn('Mermaid rendering fallback:', e);
    }
  </script>
</div>`;
}

/**
 * Main entrance to transform custom editor blocks in raw markdown / HTML before marked.parse
 */
export function applyCustomEditorBlocks(text: string): string {
  // 1. Jupyter Block
  text = text.replace(/<div\s+([^>]*?data-jupyter-block=["']true["'][^>]*?)(?:><\/div>|\/>)/gi, (_m, attrs) => {
    return renderJupyterBlock(attrs);
  });
  text = text.replace(/<div\s+([^>]*?data-jupyter-block=["']true["'][^>]*?)>([\s\S]*?)<\/div>/gi, (_m, attrs) => {
    return renderJupyterBlock(attrs);
  });

  // 2. Spatial Canvas Block
  text = text.replace(/<div\s+([^>]*?data-canvas-block=["']true["'][^>]*?)(?:><\/div>|\/>)/gi, (_m, attrs) => {
    return renderCanvasBlock(attrs);
  });
  text = text.replace(/<div\s+([^>]*?data-canvas-block=["']true["'][^>]*?)>([\s\S]*?)<\/div>/gi, (_m, attrs) => {
    return renderCanvasBlock(attrs);
  });

  // 3. Excalidraw Block
  text = text.replace(/<div\s+([^>]*?data-excalidraw-block=["']true["'][^>]*?)(?:><\/div>|\/>)/gi, (_m, attrs) => {
    return renderExcalidrawBlock(attrs);
  });
  text = text.replace(/<div\s+([^>]*?data-excalidraw-block=["']true["'][^>]*?)>([\s\S]*?)<\/div>/gi, (_m, attrs) => {
    return renderExcalidrawBlock(attrs);
  });

  // 4. Mermaid Block
  text = text.replace(/<div\s+([^>]*?data-mermaid-block=["']true["'][^>]*?)(?:><\/div>|\/>)/gi, (_m, attrs) => {
    return renderMermaidBlock(attrs);
  });
  text = text.replace(/<div\s+([^>]*?data-mermaid-block=["']true["'][^>]*?)>([\s\S]*?)<\/div>/gi, (_m, attrs) => {
    return renderMermaidBlock(attrs);
  });

  return text;
}
