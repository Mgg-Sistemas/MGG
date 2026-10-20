/* ============================================================
   MGG · Retenciones v8 · La nota de crédito (lógica pura)

   La de la maqueta (v8-12-decisiones-1014.js §4): desde la fila de Realizadas
   de una factura con IVA registrado, «+ Nota de crédito» registra la nota
   enlazada a su factura; su retención es el mismo % de la factura sobre el IVA
   de la nota, y resta en el Libro, las relaciones y el TXT.
   En la base de Retenciones es el paquete 07 (v2.2): retenciones.documento_tipo
   ('nota_credito'), documento_afectado (el número de la factura) y afecta_a (la
   retención de la factura), con el disparador retenciones_nota_credito que
   comprueba que cuadren. El monto se guarda en positivo: resta por su tipo.
   Diferencia con la maqueta: la maqueta compara el total de la nota con el de
   la factura; aquí se compara el IVA, que es el dato que tiene la retención.
   ============================================================ */
import { parseMontoEs } from '@/shared/lib/montoEs';
import type { RetencionPracticada } from '../datos/puerta';

export interface DatosNota {
  numero: string;
  control: string;
  /** aaaa-mm-dd */
  fecha: string;
  /** Lo escrito en los campos (es-VE: 1.234,56). */
  total: string;
  iva: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function puedeNotaCredito(r: RetencionPracticada): boolean {
  return r.tipo === 'iva' && r.direccion === 'practicada' && !r.anulada && (r.estado === 'registrada' || r.estado === 'declarada') && !!r.facturaNumero;
}

export function subtituloNota(r: RetencionPracticada): string {
  return [`Afecta a la factura ${r.facturaNumero ?? '—'}`, r.contraparteNombre ?? r.contraparteRif ?? '—', r.docCodigo].filter(Boolean).join(' · ');
}

/** «Pendiente: …» o null si se puede registrar. */
export function validarNotaCredito(d: DatosNota, factura: RetencionPracticada): string | null {
  const falta: string[] = [];
  const total = parseMontoEs(d.total);
  const iva = parseMontoEs(d.iva);
  if (!d.numero.trim()) falta.push('el N° de la nota');
  if (!d.fecha) falta.push('la fecha');
  if (!(total > 0)) falta.push('el monto total');
  if (!d.iva.trim() || iva < 0) falta.push('el IVA');
  else if (iva > factura.impuesto) falta.push(`un IVA que no supere el de la factura (${fmt(factura.impuesto)})`);
  else if (total > 0 && iva > total) falta.push('un IVA que no supere el monto total de la nota');
  return falta.length ? `Pendiente: ${falta.join(', ')}.` : null;
}

/** La retención de la nota: el % de la factura sobre el IVA de la nota. */
export function retencionDeNota(iva: number, porcentaje: number): number {
  return r2((Math.abs(iva) * porcentaje) / 100);
}

/** Las columnas de la retención de la nota (paquete 07). */
export function filaNotaCredito(factura: RetencionPracticada, d: DatosNota) {
  const total = parseMontoEs(d.total);
  const iva = parseMontoEs(d.iva);
  return {
    tipo: 'iva' as const, direccion: factura.direccion, documento_tipo: 'nota_credito' as const,
    afecta_a: factura.id, documento_afectado: factura.facturaNumero,
    factura_numero: d.numero.trim(), factura_control: d.control.trim() || null, factura_fecha: d.fecha,
    contraparte_id: factura.contraparteId, contraparte_rif: factura.contraparteRif, contraparte_nombre: factura.contraparteNombre,
    base_imponible: r2(total - iva), impuesto: r2(iva), porcentaje: factura.porcentaje,
    monto_retenido: retencionDeNota(iva, factura.porcentaje), moneda: factura.moneda, tasa: factura.tasa,
  };
}

export const NOTA_NC = 'La nota de crédito se registra enlazada a su factura y resta en el Libro, las relaciones y el TXT.';
