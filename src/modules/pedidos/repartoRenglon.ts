/* ============================================================
   MGG · Compras · Asignar proveedores por producto: el renglón de cada ítem
   (12-11-2026, traído de Golden Touch y adaptado a unidad_compra/factor_compra).

   El precio de una oferta es por la unidad en que la COTIZÓ el proveedor
   (PAILA, SACO…), así que la fila del asignador y la sub-OC usan esa misma
   cantidad y unidad: 2 PAILA × $230 = $460, no 5 GALON × $230 (la pantalla
   mezclaba la cantidad de la solicitud con el precio de la oferta).

   Compras puede cambiar la unidad del renglón al asignar:
     · cotizada → la del proveedor (PAILA de 5 GALON); el factor se puede corregir
     · uso      → la del inventario (GALON): cantidad y precio se convierten
     · otra     → cualquier presentación (CAJA de 12…) con su factor
   El precio por unidad de USO (lo que cuesta un GALON) no cambia al convertir.
   ============================================================ */
import { factorDe, mismaUnidad, normalizarUnidad, pideFactor, type ConUnidadCompra } from './unidadCompra';

export type ModoUnidad = 'cotizada' | 'uso' | 'otra';

export interface AjusteRenglon {
  modo: ModoUnidad;
  /** Cantidad en la unidad del modo elegido. */
  cantidad: number;
  /** Cuántas unidades de uso trae la unidad cotizada (1 PAILA = 5 GALON). 0 = falta. */
  factorCotizada: number;
  otraUnidad: string;
  otraFactor: number;
}

/** Lo que hace falta de un renglón (de la solicitud o de la oferta). */
export interface RenglonBase extends ConUnidadCompra {
  cantidad?: number | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const pos = (n: unknown) => (Number(n) > 0 ? Number(n) : 0);

/** Unidad del inventario (GALON). */
export function unidadUsoDe(itOp: RenglonBase, ofertado?: RenglonBase | null): string {
  return normalizarUnidad(itOp.unidad || ofertado?.unidad);
}

/** Unidad en la que cotizó el proveedor (PAILA); si no dijo otra, la de uso. */
export function unidadCotizadaDe(itOp: RenglonBase, ofertado?: RenglonBase | null): string {
  return normalizarUnidad(ofertado?.unidad_compra) || unidadUsoDe(itOp, ofertado);
}

/** El proveedor cotizó en una unidad distinta a la del inventario. */
export function cotizaEnOtraUnidad(itOp: RenglonBase, ofertado?: RenglonBase | null): boolean {
  return pideFactor(ofertado?.unidad_compra, unidadUsoDe(itOp, ofertado));
}

/** Factor de la unidad del modo (1 en la unidad de uso; 0 si falta). */
export function factorModo(aj: AjusteRenglon): number {
  if (aj.modo === 'cotizada') return pos(aj.factorCotizada);
  if (aj.modo === 'otra') return pos(aj.otraFactor);
  return 1;
}

/** Arranque: exactamente lo que cotizó el proveedor (cantidad, unidad y factor). */
export function ajusteInicial(itOp: RenglonBase, ofertado?: RenglonBase | null): AjusteRenglon {
  const otra = !!ofertado && cotizaEnOtraUnidad(itOp, ofertado);
  const f = otra ? (pideFactor(ofertado?.unidad_compra, ofertado?.unidad ?? itOp.unidad) && Number(ofertado?.factor_compra) > 0 ? Number(ofertado?.factor_compra) : 0) : 1;
  const cantOf = pos(ofertado?.cantidad);
  const cantOp = pos(itOp.cantidad);
  // Sin cantidad cotizada: la pedida (en uso) llevada a la unidad cotizada.
  const cantidad = cantOf > 0 ? cantOf : otra && f > 0 ? r3(cantOp / f) : cantOp;
  return { modo: otra ? 'cotizada' : 'uso', cantidad, factorCotizada: f, otraUnidad: '', otraFactor: 0 };
}

/** ¿Falta decir cuántas unidades de uso trae la unidad del renglón? */
export function faltaFactor(aj: AjusteRenglon): boolean {
  return (aj.modo === 'cotizada' || aj.modo === 'otra') && !(factorModo(aj) > 0);
}

/** Precio por unidad de USO, a partir del precio cotizado (por unidad cotizada). */
export function precioUsoDe(aj: AjusteRenglon, precioCotizado: number): number {
  const f = pos(aj.factorCotizada) || 1;
  return r4((Number(precioCotizado) || 0) / f);
}

/**
 * Cambiar de modo conservando lo que se compra EN UNIDADES DE USO
 * (2 PAILA de 5 GALON → 10 GALON).
 */
export function cambiarModo(aj: AjusteRenglon, modo: ModoUnidad): AjusteRenglon {
  if (aj.modo === modo) return aj;
  const fAct = factorModo(aj) || 1;
  const enUso = (Number(aj.cantidad) || 0) * fAct;
  const sig = { ...aj, modo };
  const fNuevo = factorModo(sig) || 1;
  return { ...sig, cantidad: r3(enUso / fNuevo) };
}

export interface RenglonReparto {
  cantidad: number;
  /** Precio por la unidad del renglón (en la moneda elegida). */
  precio: number;
  /** Escala aplicada al precio cotizado (para llevar también el precio en divisa). */
  escala: number;
  unidad_compra: string | null;
  factor_compra: number | null;
  /** Unidad en que se lee la cantidad (PAILA, GALON…). */
  unidadMostrada: string;
}

/** El renglón tal como irá a la sub-OC: cantidad, precio y presentación. */
export function renglonReparto(itOp: RenglonBase, ofertado: RenglonBase | null | undefined, aj: AjusteRenglon, precioCotizado: number): RenglonReparto {
  const uso = unidadUsoDe(itOp, ofertado);
  const precioUso = precioUsoDe(aj, precioCotizado);
  const fCot = pos(aj.factorCotizada) || 1;
  if (aj.modo === 'cotizada') {
    const uc = unidadCotizadaDe(itOp, ofertado);
    const conversion = pideFactor(uc, uso);
    return {
      cantidad: Number(aj.cantidad) || 0, precio: Number(precioCotizado) || 0, escala: 1,
      unidad_compra: conversion ? uc : null, factor_compra: conversion && aj.factorCotizada > 0 ? aj.factorCotizada : null,
      unidadMostrada: uc,
    };
  }
  if (aj.modo === 'otra') {
    const uc = normalizarUnidad(aj.otraUnidad);
    if (uc && !mismaUnidad(uc, uso)) {
      const f = pos(aj.otraFactor);
      const escala = f > 0 ? f / fCot : 1 / fCot;
      return {
        cantidad: Number(aj.cantidad) || 0, precio: r4(precioUso * (f || 1)), escala,
        unidad_compra: uc, factor_compra: f > 0 ? f : null, unidadMostrada: uc,
      };
    }
  }
  // En la unidad del inventario.
  return { cantidad: Number(aj.cantidad) || 0, precio: precioUso, escala: 1 / fCot, unidad_compra: null, factor_compra: null, unidadMostrada: uso };
}

/** «2 PAILA = 10 GALON» para mostrar debajo de la cantidad (vacío si es la de uso). */
export function textoConversion(ren: RenglonReparto, uso: string): string {
  if (!ren.unidad_compra || !ren.factor_compra) return '';
  const fmt = (n: number) => r4(n).toLocaleString('es-VE', { maximumFractionDigits: 3 });
  return `${fmt(ren.cantidad)} ${ren.unidad_compra} = ${fmt(ren.cantidad * ren.factor_compra)} ${uso}`;
}

/** Igual que factorDe de unidadCompra, para un renglón ya armado. */
export const factorRenglon = (ren: RenglonReparto, uso: string) =>
  factorDe({ unidad: uso, unidad_compra: ren.unidad_compra, factor_compra: ren.factor_compra });
