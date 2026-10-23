/* ============================================================
   Golden Touch · Retenciones · TXT del SENIAT (retenciones de IVA)

   Formato del instructivo del SENIAT de 2020, verificado contra el instructivo
   y dos TXT reales sin operaciones:
   · tabulador entre campos, texto ASCII, 16 campos, fin de línea CRLF;
   · montos con punto decimal y 2 decimales;
   · sin operaciones: una línea con el RIF, el período y 14 ceros, con un
     tabulador al final;
   · archivo <RAZÓN SOCIAL SIN ESPACIOS>DECLARACIONINFORMATIVACOMPRAS<AAAAMM>.TXT.

   Los 16 campos: 1 RIF del agente · 2 período AAAAMM · 3 fecha del documento ·
   4 tipo de operación «C» · 5 tipo de documento (01 factura) · 6 RIF del
   proveedor · 7 N° de documento · 8 N° de control · 9 total del documento ·
   10 base imponible · 11 IVA retenido · 12 documento afectado · 13 N° de
   comprobante (14 dígitos) · 14 exento · 15 alícuota · 16 N° de expediente.

   SUPUESTOS, sin cotejar con un TXT real con operaciones: RIF sin guiones y en
   mayúsculas; fecha AAAA-MM-DD; alícuota = IVA / base × 100; documento afectado
   y expediente «0»; total = base + IVA (el libro no guarda el exento: va 0);
   las anuladas no van. Los montos van en Bs (con la tasa del registro).
   Hay que cotejar la primera declaración con el contador.
   ============================================================ */
import type { RetencionPracticada } from '@/modules/libroFiscal/retencionesFiscal.repository';

/** Campo 2: el mes de las operaciones, o el siguiente (como lo hace el otro sistema). */
export type PeriodoCampo2 = 'operaciones' | 'siguiente';

export interface EntradaTxtIva {
  rifAgente: string;
  razonSocial: string;
  /** Mes de las operaciones, AAAAMM. */
  periodo: string;
  campo2: PeriodoCampo2;
  filas: RetencionPracticada[];
}

export interface ResultadoTxtIva {
  nombre: string;
  contenido: string;
  /** Renglones que entraron. */
  lineas: number;
  /** Lo que impide armarlo bien, uno por retención. Si hay algo, no se descarga. */
  faltan: string[];
}

/** Texto ASCII: sin acentos, sin tabuladores ni saltos dentro del campo. */
const ascii = (v: unknown) => String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/[\t\r\n]+/g, ' ').replace(/[^\x20-\x7E]/g, '').trim();
const rif = (v: string | null | undefined) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const monto = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

/** AAAAMM → el mes siguiente. */
export function mesSiguiente(p: string): string {
  const y = Number(p.slice(0, 4)); const m = Number(p.slice(4, 6));
  return m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, '0')}`;
}

/** Lo que entra al TXT: practicadas de IVA del período, no anuladas. */
export function filasTxtIva(filas: RetencionPracticada[], periodo: string): RetencionPracticada[] {
  return filas.filter((r) => r.direccion === 'practicada' && r.tipo === 'iva' && !r.anulada && r.periodo === periodo)
    .sort((a, b) => (a.numeroComprobante ?? '').localeCompare(b.numeroComprobante ?? ''));
}

const enBs = (n: number, r: RetencionPracticada): number | null => {
  if (String(r.moneda).toUpperCase() === 'BS') return n;
  return r.tasa && r.tasa > 0 ? n * r.tasa : null;
};

export function armarTxtIva(e: EntradaTxtIva): ResultadoTxtIva {
  const faltan: string[] = [];
  const rifAg = rif(e.rifAgente);
  if (!/^[JGVEP]\d{9}$/.test(rifAg)) faltan.push('El RIF de la empresa no está cargado o no es válido (Parámetros).');
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(e.periodo)) faltan.push('El período debe ser AAAAMM.');
  const campo2 = e.campo2 === 'siguiente' ? mesSiguiente(e.periodo) : e.periodo;
  const nombre = `${ascii(e.razonSocial).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'EMPRESA'}DECLARACIONINFORMATIVACOMPRAS${e.periodo}.TXT`;

  const filas = filasTxtIva(e.filas, e.periodo);
  if (!filas.length) {
    const sola = [rifAg, campo2, ...Array<string>(14).fill('0')].join('\t');
    return { nombre, contenido: `${sola}\t\r\n`, lineas: 0, faltan };
  }

  const lineas = filas.map((r) => {
    const quien = `${r.contraparteNombre ?? 'Sin nombre'} · factura ${r.facturaNumero ?? '—'}`;
    const base = enBs(r.baseImponible, r);
    const iva = enBs(r.impuesto, r);
    const retenido = r.montoBs ?? enBs(r.montoRetenido, r);
    if (base == null || iva == null || retenido == null) faltan.push(`${quien}: está en ${r.moneda} sin tasa para llevarla a Bs.`);
    if (!/^\d{14}$/.test(r.numeroComprobante ?? '')) faltan.push(`${quien}: el N° de comprobante no tiene 14 dígitos.`);
    if (!rif(r.contraparteRif)) faltan.push(`${quien}: falta el RIF del proveedor.`);
    if (!r.facturaNumero?.trim()) faltan.push(`${quien}: falta el N° de factura.`);
    if (!r.facturaControl?.trim()) faltan.push(`${quien}: falta el N° de control.`);
    if (!/^\d{4}-\d{2}-\d{2}/.test(r.facturaFecha ?? '')) faltan.push(`${quien}: falta la fecha de la factura.`);
    const b = base ?? 0; const i = iva ?? 0;
    const exentoBs = r.exento != null ? (enBs(r.exento, r) ?? 0) : 0;
    const totalBs = r.facturaTotal != null ? (enBs(r.facturaTotal, r) ?? (b + i + exentoBs)) : (b + i + exentoBs);
    const tipoDoc = r.tipoDocumento === 'nota_debito' ? '02' : r.tipoDocumento === 'nota_credito' ? '03' : '01';
    const docAfectado = r.facturaAfectadaNro ? ascii(r.facturaAfectadaNro) : '0';
    const alicuota = b > 0 ? (i / b) * 100 : r.alicuota;
    return [
      rifAg, campo2, (r.facturaFecha ?? '').slice(0, 10), 'C', tipoDoc,
      rif(r.contraparteRif), ascii(r.facturaNumero), ascii(r.facturaControl),
      monto(totalBs), monto(b), monto(retenido ?? 0), docAfectado,
      r.numeroComprobante ?? '', monto(exentoBs), monto(alicuota), '0',
    ].join('\t');
  });
  return { nombre, contenido: `${lineas.join('\r\n')}\r\n`, lineas: lineas.length, faltan };
}
