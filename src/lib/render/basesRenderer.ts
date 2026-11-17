/** Render a bounded Dataview/Bases query as a permission-filtered client view. */

export interface BasesConfig {
  type: string;
  tag?: string;
  category?: string;
  view: 'table' | 'cards';
  limit: number;
}

const MAX_QUERY_VALUE_LENGTH = 120;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function parseBasesConfig(rawYaml: string): BasesConfig {
  const config: BasesConfig = { type: 'all', view: 'table', limit: 20 };

  for (const line of rawYaml.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const propName = trimmed.slice(0, colonIndex).trim().toLowerCase();
    const value = trimmed.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    const boundedValue = value.slice(0, MAX_QUERY_VALUE_LENGTH);

    if (propName === 'type') config.type = boundedValue || 'all';
    else if (propName === 'tag' || propName === 'tags') config.tag = boundedValue;
    else if (propName === 'category') config.category = boundedValue;
    else if (propName === 'view') config.view = value === 'cards' ? 'cards' : 'table';
    else if (propName === 'limit') {
      const limit = Number.parseInt(value, 10);
      config.limit = Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 20;
    }
  }

  return config;
}

export function renderBasesBlock(rawConfig: string): string {
  const config = parseBasesConfig(rawConfig);
  const queryJson = safeScriptJson(config);
  const typeLabel = escapeHtml(config.type);
  const tagLabel = config.tag ? `<span class="ui-badge ui-badge--info">#${escapeHtml(config.tag)}</span>` : '';

  return `
<section class="bases-block-card ui-card" aria-label="Dynamic resource query">
  <header class="bases-block-card__header">
    <div class="bases-block-card__summary">
      <span aria-hidden="true">📊</span>
      <strong>Dynamic Query: <span class="bases-block-card__type">${typeLabel}</span></strong>
      ${tagLabel}
    </div>
    <span class="ui-badge">View: ${config.view}</span>
  </header>
  <div class="bases-results-container" aria-live="polite">
    <p class="bases-block-card__loading"><span class="ui-viewer__spinner" aria-hidden="true">◌</span> Loading dynamic records…</p>
  </div>
  <script>
    (function() {
      const config = ${queryJson};
      const container = document.currentScript && document.currentScript.parentElement;
      const resultsEl = container && container.querySelector('.bases-results-container');
      if (!resultsEl) return;

      function make(tag, text, className) {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = String(text);
        if (className) element.className = className;
        return element;
      }

      function resourceLink(resource) {
        const link = make('a', resource.title || 'Untitled resource', 'bases-result-card__title');
        link.href = '/?doc=' + encodeURIComponent(resource.slug || resource.id || '');
        return link;
      }

      function renderCards(resources) {
        const grid = make('div', undefined, 'bases-results-grid');
        resources.forEach(function(resource) {
          const card = make('article', undefined, 'bases-result-card ui-card');
          const link = resourceLink(resource);
          const category = make('span', resource.category || 'General', 'ui-badge ui-badge--info');
          card.append(link, category);
          grid.append(card);
        });
        resultsEl.replaceChildren(grid);
      }

      function renderTable(resources) {
        const scroll = make('div', undefined, 'bases-table-scroll');
        const table = make('table', undefined, 'bases-results-table');
        const head = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Title', 'Type', 'Category', 'Action'].forEach(function(label) {
          headerRow.append(make('th', label));
        });
        head.append(headerRow);

        const body = document.createElement('tbody');
        resources.forEach(function(resource) {
          const row = document.createElement('tr');
          row.append(make('td', resource.title || 'Untitled resource'));
          row.append(make('td', resource.type || 'resource'));
          row.append(make('td', resource.category || 'General'));
          const action = document.createElement('td');
          const link = resourceLink(resource);
          link.textContent = 'Open ↗';
          action.append(link);
          row.append(action);
          body.append(row);
        });
        table.append(head, body);
        scroll.append(table);
        resultsEl.replaceChildren(scroll);
      }

      const params = new URLSearchParams({ type: config.type, limit: String(config.limit) });
      if (config.tag) params.set('tag', config.tag);
      if (config.category) params.set('category', config.category);

      fetch('/api/v1/resources/query?' + params.toString())
        .then(function(response) {
          if (!response.ok) throw new Error('Query failed');
          return response.json();
        })
        .then(function(data) {
          const resources = Array.isArray(data.results) ? data.results : [];
          if (resources.length === 0) {
            resultsEl.replaceChildren(make('p', 'No matching resources found.', 'bases-block-card__empty'));
          } else if (config.view === 'cards') {
            renderCards(resources);
          } else {
            renderTable(resources);
          }
        })
        .catch(function() {
          resultsEl.replaceChildren(make('p', 'Failed to load dynamic data.', 'bases-block-card__error'));
        });
    })();
  </script>
</section>
`;
}

export function applyBasesTransform(text: string): string {
  return text.replace(/```(?:dataview|bases)\s*([\s\S]*?)```/g, (_match, rawConfig) => {
    return renderBasesBlock(rawConfig);
  });
}
