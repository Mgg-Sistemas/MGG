/* ============================================================
   MGG · Retenciones · Impresión · Los datos de una relación desde el libro de hoy

   Como v8FilasRelacion de la maqueta: las retenciones practicadas (no las de
   clientes) y vivas del impuesto, cuya fecha de emisión (la del registro)
   cae en el rango. El «Código» de la relación es el RIF, como en el ejemplar.
   En ISLR, el tipo de documento es «FCM» y el concepto sale del catálogo; el
   literal necesita la base nueva y queda vacío.
   ============================================================ */

import type { ConceptoRetencion, RetencionPracticada } from '../datos/puerta';
import type { DatosRelacion, FilaRelacion, Impuesto } from './tipos';

const TIPO: Record<Impuesto, string> = { iva: 'iva', islr: 'islr', isae: 'municipal' };
const fechaEmision = (r: RetencionPracticada) => new Date(r.createdAt).toLocaleDateString('en-CA');

export function datosRelacion(
  libro: readonly RetencionPracticada[],
  o: { impuesto: Impuesto; desde: string; hasta: string; empresa: string; generado: Date; conceptos: readonly ConceptoRetencion[] },
): DatosRelacion {
  const tipo = TIPO[o.impuesto];
  const filas: FilaRelacion[] = libro
    .filter((r) => r.tipo === tipo && r.direccion === 'practicada' && !r.anulada)
    .filter((r) => { const f = fechaEmision(r); return f >= o.desde && f <= o.hasta; })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((r) => {
      const base = Number(r.baseImponible) || 0, impuesto = Number(r.impuesto) || 0;
      const concepto = r.conceptoId ? o.conceptos.find((c) => c.id === r.conceptoId) : undefined;
      return {
        rif: r.contraparteRif ?? '', nombre: r.contraparteNombre ?? '', comp: r.numeroComprobante ?? '', documento: r.facturaNumero ?? '',
        control: r.facturaControl ?? '', fecha: fechaEmision(r), exento: 0, base, impuesto, total: base + impuesto, retenido: Number(r.montoRetenido) || 0,
        tipodoc: 'FCM', literal: '', concepto: concepto?.codigo ?? '', descripcion: (concepto?.nombre ?? r.conceptoNombre ?? '').toUpperCase(),
        pct: Number(r.porcentaje) || 0,
      };
    });
  return { impuesto: o.impuesto, empresa: o.empresa, desde: o.desde, hasta: o.hasta, generado: o.generado, filas };
}
