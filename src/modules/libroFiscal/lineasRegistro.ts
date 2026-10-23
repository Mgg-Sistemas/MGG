/* ============================================================
   Golden Touch · Retenciones · Piezas puras del registro (D41, Lote 1)

   Lo que los dos registros (suelto y por factura) tienen que mandar igual:
   · el monto retenido escrito a mano: vacío = el calculado; «0» = 0 (y
     entonces pide el motivo del 0 %); ilegible = null (bloquea);
   · el sujeto del ISLR, que es del proveedor (va en la cabecera): una
     factura con dos líneas de ISLR de sujetos distintos no se registra;
   · el municipio de una línea de ISAE: el de la empresa (Parámetros).
   ============================================================ */
import { leerMonto } from './validarCarga';
import type { ConfigRetencion, SujetoRetenido, TipoImpuesto } from './retencionesCalculo';

/** El monto retenido de una línea: vacío = el calculado; lo escrito, tal cual (también 0); ilegible = null. */
export function montoEscrito(texto: string, calculado: number): number | null {
  if (!String(texto ?? '').trim()) return calculado;
  return leerMonto(texto);
}

/** El sujeto que va en la cabecera: el de la(s) línea(s) de ISLR. Sin ISLR, null. */
export function sujetoDeLineas(lineas: { tipo: TipoImpuesto; sujeto: SujetoRetenido }[]): { sujeto: SujetoRetenido | null; error: string | null } {
  const sujetos = [...new Set(lineas.filter((l) => l.tipo === 'islr').map((l) => l.sujeto))];
  if (sujetos.length > 1) return { sujeto: null, error: 'Las líneas de ISLR van con el mismo sujeto: es el del proveedor.' };
  return { sujeto: sujetos[0] ?? null, error: null };
}

/** El municipio de una línea: el de la empresa en el ISAE; ninguno en los demás impuestos. */
export function municipioDeLinea(tipo: TipoImpuesto, config: Pick<ConfigRetencion, 'municipio'>): string | null {
  return tipo === 'municipal' ? config.municipio?.trim() || null : null;
}
