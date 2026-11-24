/* ============================================================
   Golden Touch · Retenciones · XML del SENIAT (retenciones de ISLR)

   Estructura oficial exigida por el portal fiscal del SENIAT para la
   declaración de retenciones de ISLR (Decreto 1.808):
   <?xml version="1.0" encoding="ISO-8859-1"?>
   <RelacionRetencionesISLR RifAgente="J123456780" Periodo="AAAAMM">
     <DetalleRetencion>
       <RifRetenido>J000000000</RifRetenido>
       <NumeroFactura>000123</NumeroFactura>
       <NumeroControl>00-000456</NumeroControl>
       <FechaOperacion>21/10/2026</FechaOperacion>
       <CodigoConcepto>001</CodigoConcepto>
       <MontoOperacion>1000.00</MontoOperacion>
       <PorcentajeRetencion>2.00</PorcentajeRetencion>
     </DetalleRetencion>
   </RelacionRetencionesISLR>
   ============================================================ */
import type { RetencionPracticada } from '@/modules/libroFiscal/retencionesFiscal.repository';

export interface EntradaXmlIslr {
  rifAgente: string;
  razonSocial: string;
  /** Mes de las operaciones en formato AAAAMM. */
  periodo: string;
  filas: RetencionPracticada[];
}

export interface ResultadoXmlIslr {
  nombre: string;
  contenido: string;
  /** Cantidad de retenciones incluidas. */
  lineas: number;
  /** Validaciones que impiden generar el archivo válido. */
  faltan: string[];
}

const rif = (v: string | null | undefined) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const ascii = (v: unknown) => String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/[\t\r\n]+/g, ' ').replace(/[^\x20-\x7E]/g, '').trim();
const monto = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Filtra las retenciones que aplican para el XML de ISLR del período: practicadas, ISLR, no anuladas. */
export function filasXmlIslr(filas: RetencionPracticada[], periodo: string): RetencionPracticada[] {
  const p = periodo.replace(/\D/g, '').slice(0, 6);
  return filas.filter((r) => r.direccion === 'practicada' && r.tipo === 'islr' && !r.anulada && r.montoRetenido > 0 && (r.periodo ?? '').replace(/\D/g, '').slice(0, 6) === p)
    .sort((a, b) => (a.numeroComprobante ?? '').localeCompare(b.numeroComprobante ?? ''));
}

const enBs = (n: number, r: RetencionPracticada): number | null => {
  if (r.baseBs != null && r.baseBs > 0) return r.baseBs;
  if (String(r.moneda).toUpperCase() === 'BS') return n;
  return r.tasa && r.tasa > 0 ? n * r.tasa : null;
};

/** Convierte una cadena a bytes ISO-8859-1 (Latin-1) para que el Blob coincida con el prólogo XML. */
export function bytesIso88591(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out[i] = code <= 0xff ? code : 0x3f;
  }
  return out;
}

/** Formatea una fecha YYYY-MM-DD a DD/MM/AAAA requerida por el SENIAT. */
export function fechaSeniat(f: string | null | undefined): string {
  if (!f) return '';
  const d = f.slice(0, 10).split('-');
  if (d.length === 3) return `${d[2]}/${d[1]}/${d[0]}`;
  return f;
}

/** Extrae el código de 3 dígitos del concepto (ej. "001" de "001:pnr" o "001"). */
export function codigoConceptoSeniat(conceptoId: string | null | undefined): string {
  if (!conceptoId) return '001';
  const codigo = conceptoId.split(':')[0].replace(/\D/g, '');
  return codigo ? codigo.padStart(3, '0').slice(-3) : '001';
}

export function armarXmlIslr(e: EntradaXmlIslr): ResultadoXmlIslr {
  const faltan: string[] = [];
  const rifAg = rif(e.rifAgente);
  if (!/^[JGVEP]\d{9}$/.test(rifAg)) faltan.push('El RIF de la empresa no está cargado o no es válido (Parámetros).');
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(e.periodo)) faltan.push('El período debe ser AAAAMM.');

  const nombre = `${ascii(e.razonSocial).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'EMPRESA'}DECLARACIONINFORMATIVAISLR${e.periodo}.XML`;

  const filas = filasXmlIslr(e.filas, e.periodo);
  if (!filas.length) {
    const xmlVacio = `<?xml version="1.0" encoding="ISO-8859-1"?>\r\n<RelacionRetencionesISLR RifAgente="${rifAg}" Periodo="${e.periodo}" />\r\n`;
    return { nombre, contenido: xmlVacio, lineas: 0, faltan };
  }

  const detalles: string[] = [];
  filas.forEach((r) => {
    const quien = `${r.contraparteNombre ?? 'Sin nombre'} · factura ${r.facturaNumero ?? '—'}`;
    const baseBs = enBs(r.baseImponible, r);
    const rifProv = rif(r.contraparteRif);

    if (baseBs == null) faltan.push(`${quien}: está en ${r.moneda} sin tasa de cambio para llevarla a Bs.`);
    if (!rifProv) faltan.push(`${quien}: falta el RIF del proveedor.`);
    else if (!/^[JGVEP]\d{9}$/.test(rifProv)) faltan.push(`${quien}: el RIF del proveedor no es válido (letra J/G/V/E/P y 9 dígitos).`);
    if (!r.facturaNumero?.trim()) faltan.push(`${quien}: falta el N° de factura.`);
    if (!r.facturaControl?.trim()) faltan.push(`${quien}: falta el N° de control.`);
    if (!/^\d{4}-\d{2}-\d{2}/.test(r.facturaFecha ?? '')) faltan.push(`${quien}: falta la fecha de la factura.`);

    const conceptoCod = codigoConceptoSeniat(r.conceptoId);
    const fechaOp = fechaSeniat(r.facturaFecha);
    const numFactura = escapeXml(ascii(r.facturaNumero || '0').slice(0, 20));
    const numControl = escapeXml(ascii(r.facturaControl || '0').slice(0, 20));

    detalles.push(
      `  <DetalleRetencion>\r\n` +
      `    <RifRetenido>${rifProv}</RifRetenido>\r\n` +
      `    <NumeroFactura>${numFactura}</NumeroFactura>\r\n` +
      `    <NumeroControl>${numControl}</NumeroControl>\r\n` +
      `    <FechaOperacion>${fechaOp}</FechaOperacion>\r\n` +
      `    <CodigoConcepto>${conceptoCod}</CodigoConcepto>\r\n` +
      `    <MontoOperacion>${monto(Math.max(0, baseBs ?? 0))}</MontoOperacion>\r\n` +
      `    <PorcentajeRetencion>${monto(r.porcentaje)}</PorcentajeRetencion>\r\n` +
      `  </DetalleRetencion>`
    );
  });

  const xmlCompleto =
    `<?xml version="1.0" encoding="ISO-8859-1"?>\r\n` +
    `<RelacionRetencionesISLR RifAgente="${rifAg}" Periodo="${e.periodo}">\r\n` +
    `${detalles.join('\r\n')}\r\n` +
    `</RelacionRetencionesISLR>\r\n`;

  return { nombre, contenido: xmlCompleto, lineas: filas.length, faltan };
}
