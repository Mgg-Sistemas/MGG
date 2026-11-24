/* ============================================================
   Golden Touch · Libro Fiscal · Avisos informativos de IVA
   Genera los textos en palabras del usuario y el monto sugerido
   para la retención de IVA (75 % general vs 100 % Art. 5).
   ============================================================ */
import { money } from '@/shared/lib/format';
import { motivoCienTexto, type MotivosIvaCien } from './retencionesCalculo';

export interface InfoAvisoIva {
  porcentaje: number;
  esCien: boolean;
  motivoTexto: string | null;
  montoSugerido: number;
  resumenCorto: string;
  mensajeDetallado: string;
}

/**
 * Calcula la información clara del aviso de IVA:
 * - 75 % por omisión (alícuota general como contribuyente especial).
 * - 100 % si aplica el Artículo 5, detallando el motivo legal formal.
 * - Monto sugerido de retención calculado en base al IVA de la factura.
 */
export function obtenerInfoAvisoIva(input: {
  ivaFactura: number;
  pctGeneral?: number;
  pctEspecial?: number;
  motivos?: MotivosIvaCien | Record<string, boolean | undefined> | null;
  supuestoTexto?: string | null;
  supuestoPct?: number | null;
  moneda?: string;
}): InfoAvisoIva {
  const iva = Math.max(0, Number(input.ivaFactura) || 0);
  const moneda = input.moneda || 'Bs';
  const pctGeneral = input.pctGeneral ?? 75;
  const pctEspecial = input.pctEspecial ?? 100;

  // Supuesto específico con % parametrizado
  if (input.supuestoPct != null && input.supuestoTexto) {
    const pct = input.supuestoPct;
    const montoSugerido = Math.round((iva * pct) / 100 * 100) / 100;
    return {
      porcentaje: pct,
      esCien: pct === 100,
      motivoTexto: input.supuestoTexto,
      montoSugerido,
      resumenCorto: `${pct}% según supuesto`,
      mensajeDetallado: `Aplica retención del ${pct}% del IVA según supuesto legal: «${input.supuestoTexto}». Monto sugerido: ${money(montoSugerido, moneda)}.`,
    };
  }

  const motivos = input.motivos || {};
  const tieneMotivo = Object.values(motivos).some(Boolean);
  const motivoTexto = tieneMotivo ? motivoCienTexto(motivos as MotivosIvaCien) : null;

  if (tieneMotivo) {
    const montoSugerido = Math.round((iva * pctEspecial) / 100 * 100) / 100;
    return {
      porcentaje: pctEspecial,
      esCien: true,
      motivoTexto,
      montoSugerido,
      resumenCorto: '100% Art. 5',
      mensajeDetallado: `Retención del 100% del IVA por Artículo 5: ${motivoTexto ?? 'Causal legal especificada'}. Monto sugerido: ${money(montoSugerido, moneda)}.`,
    };
  }

  const montoSugerido = Math.round((iva * pctGeneral) / 100 * 100) / 100;
  return {
    porcentaje: pctGeneral,
    esCien: false,
    motivoTexto: null,
    montoSugerido,
    resumenCorto: `General (${pctGeneral}%)`,
    mensajeDetallado: `Alícuota general: se retiene el ${pctGeneral}% del IVA facturado como contribuyente especial. Monto sugerido: ${money(montoSugerido, moneda)}.`,
  };
}

