export type Delimiter = ',' | '\t';

export interface ParsedRow {
  value: string;
  quoted: boolean;
}

export function parseDelimited(text: string, delimiter: Delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const flushCell = () => {
    row.push(quoted ? cell : cell.trim());
    cell = '';
    quoted = false;
  };

  const flushRow = () => {
    flushCell();
    rows.push(row);
    row = [];
    inQuotes = false;
  };

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && cell === '') {
      quoted = true;
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      flushCell();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      flushRow();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 2;
      else i += 1;
      flushRow();
      continue;
    }

    cell += ch;
    i += 1;
  }

  if (cell !== '' || row.length > 0) {
    flushRow();
  }

  return rows;
}

export function isEmptyRow(row: string[]): boolean {
  return row.every((c) => c === '' || c == null);
}

export interface NormalizedGrid {
  rows: string[][];
  width: number;
}

export function normalizeGrid(input: string[][]): NormalizedGrid {
  const rows = input.map((r) => r.map((c) => (c == null ? '' : String(c))));
  let start = 0;
  let end = rows.length;
  while (start < end && isEmptyRow(rows[start])) start += 1;
  while (end > start && isEmptyRow(rows[end - 1])) end -= 1;

  const kept = rows.slice(start, end);
  const width = kept.reduce((max, r) => Math.max(max, r.length), 0);
  const padded = kept.map((r) => {
    const out = new Array<string>(width).fill('');
    for (let c = 0; c < r.length; c += 1) out[c] = r[c];
    return out;
  });

  return { rows: padded, width };
}