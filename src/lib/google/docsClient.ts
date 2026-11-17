export interface GoogleDocResult {
  documentId: string;
  title: string;
  markdown: string;
  headings: Array<{ level: number; text: string }>;
}

/**
 * Fetches document AST from Google Docs API v1.
 */
export async function fetchDocumentAst(documentId: string, accessToken: string): Promise<any> {
  const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Docs API error (${res.status}): ${errorText}`);
  }

  return res.json();
}

/**
 * Converts Google Docs document AST into clean Obsidian Flavored Markdown (OFM).
 */
export function convertGoogleDocToMarkdown(doc: any): GoogleDocResult {
  const title = doc.title || 'Untitled Document';
  const content = doc.body?.content || [];
  const lines: string[] = [];
  const headings: Array<{ level: number; text: string }> = [];

  for (const element of content) {
    if (element.paragraph) {
      const paragraph = element.paragraph;
      const namedStyleType = paragraph.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';
      let text = '';

      for (const el of paragraph.elements || []) {
        if (el.textRun) {
          let runText = el.textRun.content || '';
          const style = el.textRun.textStyle || {};

          // Apply inline formatting
          if (style.bold && runText.trim()) {
            runText = `**${runText.replace(/\n$/, '')}**${runText.endsWith('\n') ? '\n' : ''}`;
          }
          if (style.italic && runText.trim()) {
            runText = `*${runText.replace(/\n$/, '')}*${runText.endsWith('\n') ? '\n' : ''}`;
          }
          if (style.strikethrough && runText.trim()) {
            runText = `~~${runText.replace(/\n$/, '')}~~${runText.endsWith('\n') ? '\n' : ''}`;
          }
          if (style.link?.url && runText.trim()) {
            runText = `[${runText.trim()}](${style.link.url})`;
          }

          text += runText;
        }
      }

      // Format based on heading style
      const cleanText = text.replace(/\n$/, '').trim();
      if (!cleanText) {
        lines.push('');
        continue;
      }

      if (namedStyleType === 'TITLE' || namedStyleType === 'HEADING_1') {
        lines.push(`# ${cleanText}\n`);
        headings.push({ level: 1, text: cleanText });
      } else if (namedStyleType === 'HEADING_2') {
        lines.push(`## ${cleanText}\n`);
        headings.push({ level: 2, text: cleanText });
      } else if (namedStyleType === 'HEADING_3') {
        lines.push(`### ${cleanText}\n`);
        headings.push({ level: 3, text: cleanText });
      } else if (namedStyleType === 'HEADING_4') {
        lines.push(`#### ${cleanText}\n`);
        headings.push({ level: 4, text: cleanText });
      } else if (paragraph.bullet) {
        lines.push(`- ${cleanText}`);
      } else {
        lines.push(`${cleanText}\n`);
      }
    } else if (element.table) {
      // Basic table parsing
      const table = element.table;
      const rows: string[][] = [];

      for (const row of table.tableRows || []) {
        const rowCells: string[] = [];
        for (const cell of row.tableCells || []) {
          let cellText = '';
          for (const cellContent of cell.content || []) {
            if (cellContent.paragraph) {
              for (const el of cellContent.paragraph.elements || []) {
                if (el.textRun) cellText += el.textRun.content;
              }
            }
          }
          rowCells.push(cellText.replace(/\n/g, ' ').trim());
        }
        rows.push(rowCells);
      }

      if (rows.length > 0) {
        const headerRow = `| ${rows[0].join(' | ')} |`;
        const divider = `| ${rows[0].map(() => '---').join(' | ')} |`;
        const dataRows = rows.slice(1).map((r) => `| ${r.join(' | ')} |`);
        lines.push([headerRow, divider, ...dataRows].join('\n') + '\n');
      }
    }
  }

  const markdownBody = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // Attach YAML frontmatter
  const frontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
source: "google_docs"
document_id: "${doc.documentId}"
imported_at: "${new Date().toISOString()}"
---

`;

  return {
    documentId: doc.documentId,
    title,
    markdown: frontmatter + markdownBody,
    headings,
  };
}

/**
 * Updates a Google Document by replacing text with updated markdown.
 */
export async function exportMarkdownToGoogleDoc(
  documentId: string,
  markdown: string,
  accessToken: string
): Promise<any> {
  const cleanBody = markdown.replace(/^---[\s\S]*?---\s*/, '').trim();

  // Clear existing content and insert new text
  const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: cleanBody,
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Docs export error (${res.status}): ${errorText}`);
  }

  return res.json();
}
