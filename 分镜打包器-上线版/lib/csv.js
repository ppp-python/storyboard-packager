/**
 * Spreadsheet-safe CSV helpers.
 *
 * JSON manifests keep the original value. CSV is a presentation format and
 * therefore prefixes cells that could be interpreted as formulas by common
 * spreadsheet programs.
 */
export function protectCsvFormula(value) {
  const text = String(value ?? '');
  return /^\s*[=+\-@]/u.test(text) ? `'${text}` : text;
}

export function escapeCsvCell(value) {
  const text = protectCsvFormula(value);
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

export function rowsToCsv(rows) {
  return `\uFEFF${(rows ?? [])
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n')}`;
}
