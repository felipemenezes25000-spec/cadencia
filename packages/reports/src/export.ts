import type { ExportFormat } from './types';
import * as XLSX from 'xlsx';

const SEPARATOR = ';';
const BOM = '﻿';

function escapeCsvField(value: string): string {
  if (value.includes(SEPARATOR) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
  headers: Record<string, string>,
): Buffer {
  const headerLine = columns.map((c) => escapeCsvField(headers[c] ?? c)).join(SEPARATOR);
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCsvField(String(row[c] ?? ''))).join(SEPARATOR),
  );
  const content = BOM + [headerLine, ...dataLines].join('\n');
  return Buffer.from(content, 'utf-8');
}

function toXlsx(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
  headers: Record<string, string>,
): Buffer {
  const headerRow = columns.map((c) => headers[c] ?? c);
  const dataRows = rows.map((row) => columns.map((c) => row[c] ?? ''));
  const aoa = [headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relatorio');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(buf);
}

/**
 * Exporta linhas já filtradas para CSV ou XLSX.
 *
 * CSV usa ponto e vírgula como separador (padrão brasileiro — Excel pt-BR abre
 * direto) e inclui BOM UTF-8 para que o Excel reconheça a codificação.
 * XLSX usa SheetJS para gerar o arquivo binário.
 *
 * A função NÃO acessa banco. Recebe dados já consultados pela API.
 */
export function exportReport(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
  headers: Record<string, string>,
  format: ExportFormat,
): Buffer {
  switch (format) {
    case 'csv':
      return toCsv(rows, columns, headers);
    case 'xlsx':
      return toXlsx(rows, columns, headers);
  }
}
