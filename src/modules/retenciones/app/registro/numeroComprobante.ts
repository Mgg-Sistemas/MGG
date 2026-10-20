/* ============================================================
   MGG · Retenciones v8 · El N° de comprobante en el registro

   La maqueta propone el siguiente de la serie y deja «Editar número» (D21b).
   Hoy el número del IVA lo asigna la base al registrar
   (siguiente_comprobante_retencion: AAAAMM + 8 dígitos) y el de ISLR e ISAE
   queda vacío: sus series necesitan la base de Retenciones (paquete 2.1).
   Este texto dice lo que pasará, sin cambiar lo que se guarda.
   ============================================================ */

import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';

export function textoNumeroComprobante(impuesto: string, periodo: string): string {
  if (impuesto === 'iva') {
    return periodo
      ? `Se asigna al registrar: el siguiente de la serie de IVA, ${periodo} + 8 dígitos.`
      : 'Se asigna al registrar: el siguiente de la serie de IVA (AAAAMM + 8 dígitos).';
  }
  return `Sin número: la serie de ${nombreImpuesto(impuesto)} todavía no está en MGG.`;
}
