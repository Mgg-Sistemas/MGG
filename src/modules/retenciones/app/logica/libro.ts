/* ============================================================
   MGG · Retenciones · Las filas del Libro fiscal

   El Libro, las relaciones y los reportes salen de estas filas:
   · lo que está en USD con tasa pasa a Bs con la tasa de la retención (el
     comprobante va en bolívares a la tasa de la factura); sin tasa se queda
     en USD y se totaliza aparte;
   · la nota de crédito resta: base, IVA, total y retenido en negativo;
   · una retención con varias líneas (ISLR por concepto, ISAE por actividad)
     da una fila por línea.

   Lo gestionado en otro sistema aparece en el Libro; en los totales entra
   solo con el interruptor «Incluir lo gestionado en otro sistema».
   ============================================================ */

import { totalesPorMoneda, type FilaLibro, type ResumenLibro, type TipoImpuesto } from '../../retencionesCalculo';
import { r2 } from './numeros';

export interface LineaLibro {
  clave: string;
  descripcion: string;
  base: number;
  porcentaje: number;
  monto: number;
}

export interface RetencionParaLibro {
  id: string;
  /** La clave del impuesto en el catálogo. */
  tipo: string;
  direccion: 'practicada' | 'recibida';
  estado: 'registrada' | 'declarada' | 'anulada';
  origen: 'mgg' | 'otro_sistema';
  proveedor: string;
  rif: string;
  factura: string;
  control: string;
  fecha: string;
  tramo: number;
  base: number;
  impuesto: number;
  total: number;
  exento: number;
  porcentaje: number;
  retenido: number;
  numero: string;
  moneda: 'Bs' | 'USD';
  tasa: number | null;
  tipoDocumento: 'factura' | 'nota_credito';
  facturaAfectada: string | null;
  lineas: readonly LineaLibro[] | null;
}

export interface FilaLibroV8 extends Omit<RetencionParaLibro, 'lineas' | 'moneda'> {
  moneda: 'Bs' | 'USD';
  monedaOriginal: 'Bs' | 'USD';
  sinTasa: boolean;
  tipoDoc: 'FC' | 'NC';
  /** El código del concepto o de la actividad de la línea; vacío si la retención no tiene líneas. */
  concepto: string;
  anulada: boolean;
}

export function filasLibro(rs: readonly RetencionParaLibro[]): FilaLibroV8[] {
  const out: FilaLibroV8[] = [];
  for (const r of rs) {
    const convierte = r.moneda === 'USD' && !!r.tasa && r.tasa > 0;
    const t = convierte ? (r.tasa as number) : 1;
    const nc = r.tipoDocumento === 'nota_credito';
    const m = (v: number) => r2((nc ? -Math.abs(v) : v) * t);
    const { lineas, ...resto } = r;
    const fila: FilaLibroV8 = {
      ...resto,
      base: m(r.base), impuesto: m(r.impuesto), total: m(r.total), exento: m(r.exento), retenido: m(r.retenido),
      moneda: convierte ? 'Bs' : r.moneda, monedaOriginal: r.moneda, sinTasa: r.moneda === 'USD' && !convierte,
      tipoDoc: nc ? 'NC' : 'FC', concepto: '', anulada: r.estado === 'anulada',
    };
    if (lineas?.length) for (const l of lineas) out.push({ ...fila, base: m(l.base), porcentaje: l.porcentaje, retenido: m(l.monto), concepto: l.clave });
    else out.push(fila);
  }
  return out;
}

/** Los totales del Libro, uno por moneda (Bs y USD no se suman). */
export function resumenPorMoneda(filas: readonly FilaLibroV8[], o: { incluirOtroSistema: boolean }): { moneda: string; resumen: ResumenLibro }[] {
  const cuentan = filas.filter((f) => o.incluirOtroSistema || f.origen !== 'otro_sistema');
  return totalesPorMoneda(cuentan.map((f): FilaLibro & { moneda: string } => ({
    // El resumen solo distingue el IGTF; los demás impuestos del catálogo cuentan igual
    tipo: f.tipo as TipoImpuesto,
    direccion: f.direccion,
    estado: f.estado === 'declarada' ? 'declarada' : 'registrada',
    monto: f.retenido,
    anulada: f.anulada,
    moneda: f.moneda,
  })));
}
