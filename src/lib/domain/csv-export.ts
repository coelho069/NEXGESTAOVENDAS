/**
 * Serialização de células CSV para exportação, com neutralização de fórmulas.
 *
 * Planilhas (Excel, LibreOffice, Google Sheets) executam uma célula que começa
 * com `=`, `+`, `-` ou `@` como fórmula. Um nome de produto como
 * `=HYPERLINK(...)` vira um link ou uma chamada externa ao abrir o arquivo.
 *
 * A neutralização só afeta a saída: o dado no banco permanece intacto. Células
 * com a forma de número (ex.: `-12.50`, `+3`) passam sem alteração, para que
 * valores negativos legítimos não sejam corrompidos.
 */

const NUMERIC_CELL = /^[+-]?\d+(?:[.,]\d+)?$/;
const FORMULA_START = /^[=+\-@]/;
const LEADING_NOISE = /^[\s\u0000-\u001f]+/;

export function neutralizeCsvFormula(text: string): string {
  if (NUMERIC_CELL.test(text)) return text;
  if (/^[\t\r\n]/.test(text) || FORMULA_START.test(text.replace(LEADING_NOISE, ""))) {
    return `'${text}`;
  }
  return text;
}

/** Célula sem aspas quando não há caracteres especiais; aspas e quebras escapadas. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = neutralizeCsvFormula(String(value));
  return /[",\r\n]/.test(text) ? quoteCsv(text) : text;
}

/** Célula sempre entre aspas (usada onde o formato histórico já é texto entre aspas). */
export function csvQuotedCell(value: unknown): string {
  return quoteCsv(neutralizeCsvFormula(value === null || value === undefined ? "" : String(value)));
}

function quoteCsv(text: string): string {
  return `"${text.replaceAll('"', '""')}"`;
}
