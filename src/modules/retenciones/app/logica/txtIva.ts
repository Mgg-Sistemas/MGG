/* ============================================================
   MGG · Retenciones · El TXT del IVA para el SENIAT

   Lo genera solo el sistema que declara el período (14/10 09:36): si lo
   declara MGG, incluye también lo gestionado en otro sistema; si lo declara
   el otro sistema, el TXT se genera allá.

   Una línea por retención, 16 columnas. La nota de crédito va con tipo 03 y
   la factura afectada. Un período sin operaciones lleva una sola línea con
   el RIF, el período y 14 ceros.

   El separador es el tabulador. El tabulador final y el fin de línea son
   opciones: por defecto, como la vista previa aprobada y CRLF (sin cotejar
   todavía contra un archivo real).
   ============================================================ */

import { r2 } from './numeros';

export const COLUMNAS_TXT = [
  'RIF del agente', 'Período', 'Fecha', 'Tipo de operación', 'Tipo de documento', 'RIF del proveedor', 'N° de documento', 'N° de control',
  'Monto del documento', 'Base imponible', 'IVA retenido', 'Documento afectado', 'N° de comprobante', 'Monto exento', 'Alícuota', 'N° de expediente',
] as const;

export type LineaTxt = string[];

export interface FilaTxt {
  fecha: string;
  rifProveedor: string;
  factura: string;
  control: string;
  total: number;
  base: number;
  impuesto: number;
  retenido: number;
  exento: number;
  comprobante: string;
  tipoDoc: 'FC' | 'NC';
  facturaAfectada: string | null;
  anulada: boolean;
}

const rifTxt = (rif: string) => String(rif ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const montoTxt = (n: number) => r2(n).toFixed(2);

/** El campo 2: el mes del período declarado; con el interruptor «como el otro sistema», el mes siguiente. */
export function periodoTxt(periodo: string, comoOtroSistema: boolean): string {
  if (!comoOtroSistema) return periodo;
  const y = Number(periodo.slice(0, 4)), m = Number(periodo.slice(4, 6));
  return m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, '0')}`;
}

export function lineasTxtIva(p: { periodo: string }, rifAgente: string, filas: readonly FilaTxt[], o: { periodoComoOtroSistema: boolean }): LineaTxt[] {
  const per = periodoTxt(p.periodo, o.periodoComoOtroSistema), agente = rifTxt(rifAgente);
  const vivas = filas.filter((f) => !f.anulada);
  if (!vivas.length) return [[agente, per, ...Array<string>(14).fill('0')]];
  return vivas.map((f) => {
    const alicuota = f.base ? Math.round((f.impuesto / f.base) * 10000) / 100 : 0;
    return [
      agente, per, f.fecha, 'C', f.tipoDoc === 'NC' ? '03' : '01', rifTxt(f.rifProveedor), f.factura || '0', f.control || '0',
      montoTxt(f.total), montoTxt(f.base), montoTxt(f.retenido), f.tipoDoc === 'NC' ? (f.facturaAfectada || '0') : '0',
      f.comprobante, montoTxt(f.exento), montoTxt(alicuota), '0',
    ];
  });
}

export function textoTxt(lineas: readonly LineaTxt[], o: { tabuladorFinal?: boolean; finDeLinea?: '\r\n' | '\n' } = {}): string {
  const fin = o.finDeLinea ?? '\r\n', tab = (o.tabuladorFinal ?? true) ? '\t' : '';
  return lineas.map((l) => l.join('\t') + tab + fin).join('');
}

/** El nombre del archivo (valor por defecto: el patrón de los archivos del otro sistema). */
export function nombreTxt(razonSocial: string, periodo: string): string {
  const razon = razonSocial.replace(/\s+/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return `${razon}DECLARACIONINFORMATIVACOMPRAS${periodo}.TXT`;
}

export function puedeGenerarTxt(declara: 'mgg' | 'otro_sistema'): { ok: true } | { ok: false; motivo: string } {
  return declara === 'mgg' ? { ok: true } : { ok: false, motivo: 'Este período lo declara el otro sistema: el TXT se genera allá.' };
}

/** Lo gestionado en otro sistema entra al TXT con su N° de comprobante y su monto retenido. */
export function faltanDatosTxt(r: { comprobante: string | null; retenido: number | null }): string[] {
  return [...(r.comprobante ? [] : ['N° de comprobante']), ...(r.retenido != null ? [] : ['monto retenido'])];
}
