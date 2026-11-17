export interface SpreadsheetMeta {
  spreadsheetId: string;
  title: string;
  sheets: Array<{
    sheetId: number;
    title: string;
    index: number;
    rowCount?: number;
    columnCount?: number;
  }>;
}

export interface SheetValuesResult {
  range: string;
  majorDimension: string;
  values: any[][];
  records: Record<string, any>[];
  headers: string[];
}

/**
 * Fetch metadata about a Google Spreadsheet (sheet tabs, dimensions).
 */
export async function fetchSpreadsheetMetadata(
  spreadsheetId: string,
  accessToken: string
): Promise<SpreadsheetMeta> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets.properties`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Sheets API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title || 'Untitled Spreadsheet',
    sheets: (data.sheets || []).map((s: any) => ({
      sheetId: s.properties?.sheetId,
      title: s.properties?.title || 'Sheet1',
      index: s.properties?.index,
      rowCount: s.properties?.gridProperties?.rowCount,
      columnCount: s.properties?.gridProperties?.columnCount,
    })),
  };
}

/**
 * Parses raw 2D grid values into an array of structured JSON objects using row 0 as keys.
 */
export function parseSheetToRecords(rows: any[][]): { headers: string[]; records: Record<string, any>[] } {
  if (!rows || rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = rows[0].map((h, i) => (h ? String(h).trim() : `column_${i + 1}`));
  const dataRows = rows.slice(1);

  const records = dataRows.map((row) => {
    const record: Record<string, any> = {};
    headers.forEach((header, idx) => {
      record[header] = row[idx] !== undefined ? row[idx] : null;
    });
    return record;
  });

  return { headers, records };
}

/**
 * Ingests a specific range from a Google Spreadsheet.
 * e.g. range="Sheet1!A1:Z50" or "A1:E20"
 */
export async function fetchSheetValues(
  spreadsheetId: string,
  range: string = 'A1:Z100',
  accessToken: string
): Promise<SheetValuesResult> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Sheets values fetch error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const rawValues = data.values || [];
  const { headers, records } = parseSheetToRecords(rawValues);

  return {
    range: data.range || range,
    majorDimension: data.majorDimension || 'ROWS',
    values: rawValues,
    records,
    headers,
  };
}

/**
 * Updates a cell range in Google Sheets.
 */
export async function updateSheetValues(
  spreadsheetId: string,
  range: string,
  values: any[][],
  accessToken: string
): Promise<any> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      range,
      majorDimension: 'ROWS',
      values,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Sheets update error (${res.status}): ${errorText}`);
  }

  return res.json();
}
