import type { OfertaProveedor, Orden } from '@/shared/lib/types';
import { totalesRepresentativos } from './variantesOferta';

export type ModalidadPagoAnalista = 'divisa' | 'bcv';

/** Impuestos absolutos ($) de una oferta (IVA + IGTF) */
export function impuestosOferta(of: OfertaProveedor): number {
  const iva = of.iva_aplicado
    ? Math.max(0, Number(of.iva_monto) || 0)
    : Math.max(0, Number(of.iva) || 0);
  const igtf = of.igtf_aplicado
    ? Math.max(0, Number(of.igtf_monto) || 0)
    : Math.max(0, Number(of.igtf) || 0);
  return Math.round((iva + igtf) * 100) / 100;
}

export interface DesgloseModalidadesOferta {
  totalBcv: number;
  totalDivisa: number | null;
  baseBcv: number;
  baseDivisa: number | null;
  impuestos: number;
  tieneOpcionDivisa: boolean;
  hayDiferencia: boolean;
  ahorroDivisa: number;
  ahorroPct: number;
}

/** Calcula los totales de una oferta para ambas modalidades (BCV y Divisa) con impuestos */
export function calcularDesgloseModalidadesOferta(oferta: OfertaProveedor): DesgloseModalidadesOferta {
  const rep = totalesRepresentativos(oferta.items ?? []);
  const baseBcv = rep.bcv > 0 ? rep.bcv : Number(oferta.precio_total) || 0;
  const precioDiv = oferta.precio_divisa ?? oferta.precio_efectivo;
  const baseDiv = precioDiv != null
    ? (rep.usd > 0 ? rep.usd : Number(precioDiv))
    : (rep.usd > 0 ? rep.usd : null);

  const imp = impuestosOferta(oferta);
  const totalBcv = Math.round((baseBcv + imp) * 100) / 100;
  const totalDivisa = baseDiv != null ? Math.round((baseDiv + imp) * 100) / 100 : null;

  const tieneOpcionDivisa = totalDivisa != null && totalDivisa > 0;
  const hayDiferencia = tieneOpcionDivisa && Math.abs(totalBcv - totalDivisa!) > 0.01;
  const ahorroDivisa = hayDiferencia ? Math.round((totalBcv - totalDivisa!) * 100) / 100 : 0;
  const ahorroPct = (totalBcv > 0 && ahorroDivisa !== 0)
    ? Math.round((ahorroDivisa / totalBcv) * 10000) / 100
    : 0;

  return {
    totalBcv,
    totalDivisa,
    baseBcv,
    baseDivisa: baseDiv,
    impuestos: imp,
    tieneOpcionDivisa,
    hayDiferencia,
    ahorroDivisa,
    ahorroPct,
  };
}

export interface InfoModalidadPagoOrden {
  modalidad: ModalidadPagoAnalista;
  esDivisa: boolean;
  etiqueta: string;
  etiquetaCorta: string;
  icono: string;
  precioBcv: number | null;
  precioDivisa: number | null;
  ahorro: number | null;
  ahorroPct: number | null;
  tieneComparativa: boolean;
}

/**
 * Obtiene la modalidad de pago elegida por el analista y los precios de referencia
 * (BCV vs Divisa) de una orden ya creada.
 */
export function obtenerInfoModalidadPago(
  orden: Partial<Orden>,
  ofertaAceptada?: OfertaProveedor | null,
): InfoModalidadPagoOrden {
  const esDivisa = !!orden.pago_en_divisa || orden.modalidad_pago === 'usd';
  const modalidad: ModalidadPagoAnalista = esDivisa ? 'divisa' : 'bcv';

  // Buscar precio original BCV en historial de la OC
  let bcvHistorial: number | null = null;
  if (orden.historial && Array.isArray(orden.historial)) {
    const evOc = orden.historial.find((h) => (h as any).evento === 'oc_creada');
    if (evOc && (evOc as any).precio_bcv != null) {
      const p = Number((evOc as any).precio_bcv);
      if (p > 0) {
        const imp = (orden.iva_aplicado ? Number(orden.iva_monto) || 0 : Number(orden.iva) || 0)
          + (orden.igtf_aplicado ? Number(orden.igtf_monto) || 0 : Number(orden.igtf) || 0);
        bcvHistorial = Math.round((p + imp) * 100) / 100;
      }
    }
  }

  // Si tenemos la oferta de referencia
  let bcvOferta: number | null = null;
  let divisaOferta: number | null = null;
  if (ofertaAceptada) {
    const desglose = calcularDesgloseModalidadesOferta(ofertaAceptada);
    bcvOferta = desglose.totalBcv;
    divisaOferta = desglose.totalDivisa;
  }

  const precioBcv = bcvHistorial ?? bcvOferta ?? orden.oferta_precio_bcv ?? (esDivisa ? null : Number(orden.total) || 0);
  const precioDivisa = (esDivisa ? Number(orden.total) : (orden.total_divisa != null ? Number(orden.total_divisa) : (orden.oferta_precio_efectivo ?? divisaOferta))) || null;

  let ahorro: number | null = null;
  let ahorroPct: number | null = null;
  if (precioBcv != null && precioDivisa != null && precioBcv > precioDivisa) {
    ahorro = Math.round((precioBcv - precioDivisa) * 100) / 100;
    ahorroPct = precioBcv > 0 ? Math.round((ahorro / precioBcv) * 10000) / 100 : 0;
  }

  const tieneComparativa = precioBcv != null && precioDivisa != null && Math.abs(precioBcv - precioDivisa) > 0.01;

  return {
    modalidad,
    esDivisa,
    etiqueta: esDivisa ? 'Pago en $ (Divisa)' : 'Pago en Bs al cambio (tasa BCV)',
    etiquetaCorta: esDivisa ? 'Pago en $' : 'Pago en Bs (BCV)',
    icono: esDivisa ? '💵' : '🏦',
    precioBcv,
    precioDivisa,
    ahorro,
    ahorroPct,
    tieneComparativa,
  };
}
