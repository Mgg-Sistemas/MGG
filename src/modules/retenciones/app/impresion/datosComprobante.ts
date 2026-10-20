/* ============================================================
   MGG · Retenciones · Impresión · Los datos del comprobante desde el libro de hoy

   Las hojas fieles (HojasComprobante.tsx) reciben DatosComprobante. Hoy los
   datos salen de las retenciones del libro (retencionesFiscal.repository) y
   de la configuración (retencion_config), sin la base nueva:
   · el número, tal como se registró (en ISLR e ISAE, hoy sin número);
   · la fecha de emisión, la del registro (como imprimía el PDF de hoy);
   · el agente, de la configuración; el sujeto, de la retención, con la
     dirección del proveedor que se pasa aparte;
   · una fila por retención (en ISLR e ISAE, una por línea de concepto).
   La firma y el logo del ente necesitan la base nueva: sin imagen, la hoja
   deja el recuadro en blanco o rotulado, como el ejemplar.
   ============================================================ */

import type { ConceptoRetencion, ConfigRetencion, RetencionPracticada } from '../datos/puerta';
import type { DatosComprobante, FilaComprobante, Impuesto } from './tipos';

const IMPUESTO: Record<string, Impuesto> = { iva: 'iva', islr: 'islr', municipal: 'isae' };

/** Los impuestos que tienen hoja fiel (los tres con ejemplar). */
export const tieneHoja = (tipo: string): boolean => tipo in IMPUESTO;

const fechaLocal = (iso: string) => (iso.length > 10 ? new Date(iso).toLocaleDateString('en-CA') : iso.slice(0, 10));

/** Las retenciones que van en el mismo comprobante. */
export function retencionesDelComprobante(r: RetencionPracticada, libro: readonly RetencionPracticada[]): RetencionPracticada[] {
  if (r.numeroComprobante) return libro.filter((x) => x.tipo === r.tipo && x.numeroComprobante === r.numeroComprobante && !x.anulada);
  return libro.filter((x) => x.tipo === r.tipo && !x.anulada && !x.numeroComprobante && x.direccion === r.direccion
    && x.docKind === r.docKind && x.docId === r.docId && x.facturaNumero === r.facturaNumero);
}

export function datosComprobante(
  rs: readonly RetencionPracticada[],
  o: { config: ConfigRetencion; direccionSujeto: string; conceptos: readonly ConceptoRetencion[] },
): DatosComprobante {
  const r0 = rs[0];
  const impuesto = IMPUESTO[r0.tipo] ?? 'iva';
  const per = String(r0.periodo ?? '').replace(/\D/g, '');
  const codigoDe = (id: string | null) => (id ? o.conceptos.find((c) => c.id === id)?.codigo ?? '' : '');
  const filas: FilaComprobante[] = rs.map((r, i) => {
    const comun = { fecha: r.facturaFecha ?? fechaLocal(r.createdAt), factura: r.facturaNumero ?? '', control: r.facturaControl ?? '', base: Number(r.baseImponible) || 0, retenido: Number(r.montoRetenido) || 0 };
    if (impuesto === 'iva') {
      const base = Number(r.baseImponible) || 0, iva = Number(r.impuesto) || 0;
      return { ...comun, oper: String(i + 1), clase: '01-reg', total: base + iva, sinDerecho: 0, alic: Number(r.alicuota) || 0, causado: iva };
    }
    if (impuesto === 'islr') {
      return { ...comun, documento: r.facturaNumero ?? '', descripcion: (r.conceptoNombre ?? '').toUpperCase(), pct: Number(r.porcentaje) || 0, sustraendo: Number(r.sustraendo) || 0 };
    }
    return { ...comun, actividad: codigoDe(r.conceptoId), alicIsae: Number(r.porcentaje) || 0 };
  });
  return {
    impuesto,
    numero: r0.numeroComprobante ?? '',
    fecha: fechaLocal(r0.createdAt),
    periodo: { anio: per.slice(0, 4), mes: per.slice(4, 6) },
    agente: { razon: o.config.razonSocial ?? '', rif: o.config.rif ?? '', direccion: o.config.direccionFiscal ?? '' },
    sujeto: { nombre: r0.contraparteNombre ?? '', rif: r0.contraparteRif ?? '', direccion: o.direccionSujeto },
    filas,
    firma: null,
    logoEnte: null,
  };
}
