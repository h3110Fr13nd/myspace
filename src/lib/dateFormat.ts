const displayDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/** Format dates consistently without rebuilding Intl's formatter per render. */
export function formatDisplayDate(value: string | undefined): string {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid Date';
  return displayDateFormatter.format(date);
}
