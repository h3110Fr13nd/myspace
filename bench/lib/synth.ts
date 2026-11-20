/**
 * Deterministic synthetic workloads for the scale benchmarks.
 *
 * The shape mimics a real multi-author knowledge base rather than a uniform
 * random graph, because uniform graphs flatter every algorithm:
 *
 *  - authors own a root folder, which nests 1-3 levels of sub-folders;
 *  - documents are spread over folders with a Zipf skew (a few huge folders,
 *    many small ones);
 *  - each document has a Poisson(~2) number of wikilinks, 75% to notes by the
 *    same author and 25% to globally popular notes (preferential attachment),
 *    which yields the power-law in-degree real vaults show.
 *
 * Everything is generated as typed arrays first (so a million items costs a few
 * MB), and `materialiseRows` produces the `pg`-style row objects the current
 * endpoints consume, only when a benchmark needs to measure that path.
 */

export const KIND_CODES = {
  folder: 0,
  document: 1,
  canvas: 2,
  pdf: 3,
  paper: 4,
  image: 5,
  sheet: 6,
  space: 7,
} as const;
export const KIND_NAMES = Object.keys(KIND_CODES) as Array<keyof typeof KIND_CODES>;

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'graph', 'neural', 'canvas', 'theory', 'notes', 'survey', 'method', 'review', 'draft', 'index',
  'vector', 'tensor', 'proof', 'lemma', 'model', 'system', 'design', 'journal', 'paper', 'essay',
  'kernel', 'memory', 'cache', 'latency', 'budget', 'schema', 'query', 'render', 'layout', 'stream',
];

export interface SynthWorkspace {
  count: number;
  /** Parent index or -1. */
  parent: Int32Array;
  kind: Uint8Array;
  /** Owner (author) index per item. */
  owner: Uint32Array;
  /** Wikilink edges, document -> document (item indices). */
  linkSrc: Uint32Array;
  linkDst: Uint32Array;
  authors: number;
  id(i: number): string;
  title(i: number): string;
  slug(i: number): string;
}

export function synthWorkspace(n: number, seed = 42): SynthWorkspace {
  const r = rng(seed);
  const authors = Math.max(1, Math.round(n / 2500));
  const parent = new Int32Array(n).fill(-1);
  const kind = new Uint8Array(n);
  const owner = new Uint32Array(n);

  // Item 0 is the shared space root.
  let next = 0;
  kind[next] = KIND_CODES.space;
  next++;

  // Folder skeleton per author: ~1 folder per 40 docs, nested up to 3 deep.
  const foldersByAuthor: number[][] = [];
  const perAuthor = Math.max(1, Math.floor((n - 1) / authors));
  for (let a = 0; a < authors && next < n; a++) {
    const folders: number[] = [];
    const root = next++;
    kind[root] = KIND_CODES.folder;
    parent[root] = 0;
    owner[root] = a;
    folders.push(root);
    const folderCount = Math.max(1, Math.round(perAuthor / 40));
    for (let f = 1; f < folderCount && next < n; f++) {
      const id = next++;
      kind[id] = KIND_CODES.folder;
      // Nest under a random earlier folder of this author, biased shallow.
      parent[id] = folders[Math.floor(r() * r() * folders.length)];
      owner[id] = a;
      folders.push(id);
    }
    foldersByAuthor.push(folders);
  }

  // Documents: author chosen round-robin, folder Zipf-skewed.
  const docsByAuthor: number[][] = foldersByAuthor.map(() => []);
  const docKinds = [
    KIND_CODES.document, KIND_CODES.document, KIND_CODES.document, KIND_CODES.document,
    KIND_CODES.document, KIND_CODES.paper, KIND_CODES.pdf, KIND_CODES.canvas,
    KIND_CODES.image, KIND_CODES.sheet,
  ];
  let a = 0;
  while (next < n) {
    const folders = foldersByAuthor[a];
    const id = next++;
    const u = r();
    parent[id] = folders[Math.floor(u * u * u * folders.length)];
    kind[id] = docKinds[Math.floor(r() * docKinds.length)];
    owner[id] = a;
    docsByAuthor[a].push(id);
    a = (a + 1) % foldersByAuthor.length;
  }

  // Wikilinks with preferential attachment.
  const allDocs: number[] = [];
  for (const list of docsByAuthor) allDocs.push(...list);
  const src: number[] = [];
  const dst: number[] = [];
  const poisson = (lambda: number) => {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= r();
    } while (p > L);
    return k - 1;
  };
  for (let ai = 0; ai < docsByAuthor.length; ai++) {
    const docs = docsByAuthor[ai];
    for (const d of docs) {
      const links = poisson(2);
      for (let l = 0; l < links; l++) {
        const local = r() < 0.75 && docs.length > 1;
        const pool = local ? docs : allDocs;
        const u = r();
        const t = pool[Math.floor(u * u * u * pool.length)];
        if (t !== d) {
          src.push(d);
          dst.push(t);
        }
      }
    }
  }

  const kindName = (i: number) => KIND_NAMES[kind[i]];
  return {
    count: n,
    parent,
    kind,
    owner,
    linkSrc: Uint32Array.from(src),
    linkDst: Uint32Array.from(dst),
    authors: foldersByAuthor.length,
    id: (i) => (i === 0 ? 'space:main' : `${kindName(i)}:n${i}`),
    slug: (i) => `n${i}`,
    title: (i) => {
      if (i === 0) return 'Workspace';
      const w1 = WORDS[(i * 7) % WORDS.length];
      const w2 = WORDS[(i * 13 + 5) % WORDS.length];
      return kind[i] === KIND_CODES.folder ? `Folder ${w1} ${i}` : `${w1[0].toUpperCase()}${w1.slice(1)} ${w2} ${i}`;
    },
  };
}

/**
 * `pg`-shaped rows, exactly what `listWorkspaceResourceCandidates` hands to
 * `buildGraphData` today. Costly on purpose: this is the thing being measured.
 */
export function materialiseRows(ws: SynthWorkspace) {
  const links: string[][] = Array.from({ length: ws.count }, () => []);
  for (let e = 0; e < ws.linkSrc.length; e++) links[ws.linkSrc[e]].push(ws.slug(ws.linkDst[e]));
  const rows = new Array(ws.count);
  for (let i = 0; i < ws.count; i++) {
    const p = ws.parent[i];
    rows[i] = {
      id: ws.id(i),
      type: KIND_NAMES[ws.kind[i]],
      parent_id: p >= 0 ? ws.id(p) : null,
      owner_id: `user:u${ws.owner[i]}`,
      path: p >= 0 ? `space:main/${ws.id(p)}/${ws.id(i)}` : ws.id(i),
      title: ws.title(i),
      is_public: true,
      is_draft: false,
      metadata: { slug: ws.slug(i), wikilinks: links[i] },
    };
  }
  return rows;
}

/** Edge list for the pyramid: containment edges + wikilinks, with kinds 0/1. */
export function graphEdges(ws: SynthWorkspace) {
  let parentEdges = 0;
  for (let i = 0; i < ws.count; i++) if (ws.parent[i] >= 0) parentEdges++;
  const m = parentEdges + ws.linkSrc.length;
  const src = new Uint32Array(m);
  const dst = new Uint32Array(m);
  const kind = new Uint8Array(m);
  let e = 0;
  for (let i = 0; i < ws.count; i++) {
    if (ws.parent[i] < 0) continue;
    src[e] = ws.parent[i];
    dst[e] = i;
    kind[e] = 0;
    e++;
  }
  for (let l = 0; l < ws.linkSrc.length; l++) {
    src[e] = ws.linkSrc[l];
    dst[e] = ws.linkDst[l];
    kind[e] = 1;
    e++;
  }
  return { count: m, src, dst, kind };
}

/** Degree per item, for node importance. */
export function degrees(count: number, src: Uint32Array, dst: Uint32Array) {
  const deg = new Uint32Array(count);
  for (let e = 0; e < src.length; e++) {
    deg[src[e]]++;
    deg[dst[e]]++;
  }
  return deg;
}

/**
 * A JSON Canvas document with `n` text/resource nodes in clustered groups and
 * ~1.2 edges per node, laid out on a grid of clusters like a real large board.
 */
export function synthCanvas(n: number, seed = 7, options: { resourceRatio?: number; resourceIds?: (i: number) => string } = {}) {
  const r = rng(seed);
  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];
  const cluster = 40;
  const clusters = Math.max(1, Math.ceil(n / cluster));
  const perRow = Math.ceil(Math.sqrt(clusters));
  let id = 0;
  for (let c = 0; c < clusters && id < n; c++) {
    const cx = (c % perRow) * 2600;
    const cy = Math.floor(c / perRow) * 2000;
    const groupId = `g${c}`;
    const inGroup = Math.min(cluster, n - id);
    if (c % 3 === 0) {
      nodes.push({ id: groupId, type: 'group', x: cx - 40, y: cy - 80, width: 2400, height: 1800, label: `Cluster ${c}` });
    }
    for (let k = 0; k < inGroup; k++) {
      const nid = `n${id++}`;
      const col = k % 8;
      const row = Math.floor(k / 8);
      const asResource = options.resourceIds && r() < (options.resourceRatio ?? 0);
      nodes.push({
        id: nid,
        type: asResource ? 'resource' : 'text',
        ...(asResource ? { resourceId: options.resourceIds!(id), resourceType: 'document' } : {}),
        x: cx + col * 290 + Math.floor(r() * 20),
        y: cy + row * 330 + Math.floor(r() * 20),
        width: 240,
        height: 140 + Math.floor(r() * 100),
        text: `## Card ${nid}\n\nSome **markdown** body with a [[link]] and a list:\n- one\n- two`,
        color: String(1 + (k % 6)),
        ...(c % 3 === 0 ? { parentId: groupId } : {}),
      });
      if (k > 0 && r() < 0.9) edges.push({ id: `e${edges.length}`, fromNode: nid, fromSide: 'left', toNode: `n${id - 2}`, toSide: 'right' });
      if (r() < 0.3 && id > cluster) {
        const far = Math.floor(r() * (id - 1));
        edges.push({ id: `e${edges.length}`, fromNode: nid, toNode: `n${far}`, toEnd: 'arrow', label: r() < 0.2 ? 'relates to' : undefined });
      }
    }
  }
  return { title: `Synthetic ${n}`, nodes, edges };
}
