/** Remove a duplicate document title when a note starts with that same H1. */
export function stripLeadingDuplicateTitle(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  let headingIndex = 0;

  if (lines[headingIndex]?.trim() === '---') {
    const frontMatterEnd = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (frontMatterEnd !== -1) headingIndex = frontMatterEnd + 1;
  }

  while (headingIndex < lines.length && !lines[headingIndex].trim()) headingIndex++;
  const heading = lines[headingIndex]?.match(/^#\s+(.+?)\s*#*$/)?.[1]?.trim();
  if (!heading || heading.replace(/\s+/g, ' ') !== title.trim().replace(/\s+/g, ' ')) return markdown;

  lines.splice(headingIndex, 1);
  while (headingIndex < lines.length && !lines[headingIndex].trim()) lines.splice(headingIndex, 1);
  return lines.join('\n');
}
