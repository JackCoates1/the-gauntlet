// RFC 4180-compatible CSV escaping. CSV is data-only: values are never
// interpreted as HTML by these research exports.
export function csv(rows) {
  return rows.map(row => row.map(value => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\r\n') + '\r\n';
}

export function csvResponse(filename, rows) {
  return new Response(csv(rows), { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
  } });
}
