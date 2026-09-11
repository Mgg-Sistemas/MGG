/* ============================================================
   MGG · Pedidos · ¿el total de la OC cuadra con sus partes?

   El `total` de una orden es un SNAPSHOT: se congela al crear la OC
   y después vive por su cuenta. Sus partes —ítems, descuento, IVA,
   IGTF— se pueden editar por caminos distintos, y nada garantiza que
   sigan sumando lo mismo.

   `resincronizarOcDesdeOferta` arregla el desfase, pero solo mientras
   la orden está en «OC creada»; más adelante NO se toca sola, a
   propósito, porque el monto ya está en la cola de Tesorería. El
   problema no es que no se actualice: es que nadie se entera.

   Caso SP-2026-0098-1-1: la oferta se recortó de 670 a 223,65 y su
   IVA se recalculó a 35,78, pero la orden se quedó con los 107,20 del
   monto viejo. El kanban mostró $ 330,85 en vez de $ 259,43 y así
   llegó a pagarse. Ninguna pantalla lo dijo.

   Acá viven las dos comprobaciones. Son distintas y hacen falta las
   dos:

     1. `desglosarOc` — aritmética pura sobre la propia orden. Si no
        cuadra es un error seguro, y no necesita consultar nada.
     2. `ivaContraOferta` — compara con la oferta aceptada. Atrapa el
        caso en que la orden es internamente coherente pero quedó
        peleada con la cotización que le dio origen.

   NO se usa un «el IVA debería ser 16% de la base»: en producción hay
   órdenes legítimas al 10,1% y al 4,9%, donde solo parte de los
   productos tributa. Una regla así gritaría en falso y enseñaría a
   ignorar la advertencia.
   ============================================================ */
import type { ItemOrden } from '@/shared/lib/types';

/** Dinero a 2 decimales. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Diferencias por debajo de un centavo son redondeo, no descuadre. */
export const TOLERANCIA = 0.02;

/** Lo mínimo de una orden para poder cuadrarla. */
export interface OrdenCuadrable {
  items?: ItemOrden[] | null;
  descuento_obtenido?: number | null;
  iva?: number | null;
  igtf?: number | null;
  total?: number | null;
}

export interface DesgloseOc {
  /** Σ cantidad × precio de los ítems marcados para comprar. */
  base: number;
  descuento: number;
  iva: number;
  igtf: number;
  /** base − descuento + IVA + IGTF. */
  esperado: number;
  /** El `total` que tiene guardado la orden. */
  guardado: number;
  /** guardado − esperado. Positivo = la orden pide de más. */
  diferencia: number;
  /** `true` si la diferencia entra en la tolerancia. */
  cuadra: boolean;
}

/**
 * Descompone el total de una OC y lo contrasta con la suma de sus partes.
 *
 * Los ítems con `comprar === false` no entran: son los que el analista destildó
 * y no se compran, igual que en `actualizarOc`.
 */
export function desglosarOc(orden: OrdenCuadrable): DesgloseOc {
  const items = (orden.items ?? []).filter((i) => i?.comprar !== false);
  const base = r2(items.reduce((a, i) => a + (Number(i.cantidad) || 0) * (Number(i.precio) || 0), 0));
  const descuento = Math.max(0, r2(Number(orden.descuento_obtenido) || 0));
  const iva = Math.max(0, r2(Number(orden.iva) || 0));
  const igtf = Math.max(0, r2(Number(orden.igtf) || 0));
  const esperado = r2(Math.max(0, base - descuento) + iva + igtf);
  const guardado = r2(Number(orden.total) || 0);
  const diferencia = r2(guardado - esperado);
  return { base, descuento, iva, igtf, esperado, guardado, diferencia, cuadra: Math.abs(diferencia) <= TOLERANCIA };
}

export interface DesfaseConOferta {
  ivaOrden: number;
  ivaOferta: number;
  igtfOrden: number;
  igtfOferta: number;
  /** Cuánto de más (o de menos) arrastra la orden por impuestos. */
  diferencia: number;
}

/**
 * Impuestos de la orden contra los de su oferta aceptada. `null` si coinciden
 * o si no hay oferta con qué comparar.
 *
 * En una sub-OC la oferta vive en la orden madre y cotiza más productos, así
 * que sus impuestos van PRORRATEADOS: hay que pasar el recorte ya hecho
 * (`recortarOfertaAHija`), no la oferta entera, o toda sub-OC parecería mal.
 */
export function ivaContraOferta(
  orden: Pick<OrdenCuadrable, 'iva' | 'igtf'>,
  oferta: { iva?: number | null; igtf?: number | null } | null | undefined,
): DesfaseConOferta | null {
  if (!oferta) return null;
  const ivaOrden = Math.max(0, r2(Number(orden.iva) || 0));
  const ivaOferta = Math.max(0, r2(Number(oferta.iva) || 0));
  const igtfOrden = Math.max(0, r2(Number(orden.igtf) || 0));
  const igtfOferta = Math.max(0, r2(Number(oferta.igtf) || 0));
  const diferencia = r2((ivaOrden - ivaOferta) + (igtfOrden - igtfOferta));
  if (Math.abs(diferencia) <= TOLERANCIA) return null;
  return { ivaOrden, ivaOferta, igtfOrden, igtfOferta, diferencia };
}

/**
 * Aviso en palabras, para mostrar donde se ve el monto. `null` = todo cuadra.
 *
 * Dice el número que sobra o falta y de dónde sale, porque «no cuadra» sin
 * cifra obliga a sacar la calculadora antes de poder hacer nada.
 */
export function avisoDeCuadre(orden: OrdenCuadrable): string | null {
  const d = desglosarOc(orden);
  if (d.cuadra) return null;
  const sobra = d.diferencia > 0;
  const partes = [`base ${d.base.toFixed(2)}`];
  if (d.descuento > 0) partes.push(`− desc. ${d.descuento.toFixed(2)}`);
  if (d.iva > 0) partes.push(`+ IVA ${d.iva.toFixed(2)}`);
  if (d.igtf > 0) partes.push(`+ IGTF ${d.igtf.toFixed(2)}`);
  return `El total no cuadra con sus partes: ${partes.join(' ')} dan ${d.esperado.toFixed(2)}, `
    + `pero la orden dice ${d.guardado.toFixed(2)} (${sobra ? 'sobran' : 'faltan'} ${Math.abs(d.diferencia).toFixed(2)}).`;
}
