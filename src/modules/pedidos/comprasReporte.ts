/* ============================================================
   MGG · Compras · Reporte por renglones (tipos)
   Pedido de la administradora (19-10-2026): un reporte de Compras
   que muestre, TIPO POR RENGLÓN, cada compra con su CÓDIGO, su
   MOTIVO y su MONTO en $ o Bs, agrupada en cuatro renglones:
     · Pendiente por aprobar       (OC/servicio en `oc_creada`)
     · Cuentas a crédito           (OC/servicio en `cuenta_abierta`)
     · Por indicar método de pago  (OC/servicio en `confirmada_metodo`)
     · Por pagar                   (OC/servicio en `oc_aprobada` + directos `por_pagar`)
   Funciones PURAS (sin base): se testean solas. El acceso a datos
   vive en `comprasReporte.repository.ts`.
   ============================================================ */
import type { Orden } from '@/shared/lib/types';

/** Los cuatro renglones del reporte, en el orden en que se muestran. */
export type GrupoReporte = 'pendiente_aprobar' | 'cuenta_abierta' | 'indicar_metodo' | 'por_pagar';

/** Los cuatro renglones del reporte, en el orden en que se muestran. El emoji va sin
 *  el selector U+FE0F a propósito: en WhatsApp ese selector se pierde y llega un
 *  cuadrito (ver `comprasReporteMensaje.ts`).
 *
 *  Los colores son PASTEL (pedido de la administradora, 19-10-2026: «los colores están
 *  muy chillones»): antes eran el naranja de la marca y rojo/violeta/azul plenos, con
 *  la letra en blanco. Ahora el fondo va suave y la letra en el tono oscuro del MISMO
 *  color (`colorTexto`), que es lo que se lee. `comprasReporte.test.ts` comprueba con
 *  la fórmula de contraste del W3C que cada par fondo/letra pasa de 4,5:1. */
export const GRUPOS_REPORTE: { key: GrupoReporte; titulo: string; emoji: string; color: string; colorTexto: string }[] = [
  { key: 'pendiente_aprobar', titulo: 'PENDIENTE POR APROBAR', emoji: '⏳', color: '#ffe0bd', colorTexto: '#8a4b00' },
  { key: 'cuenta_abierta', titulo: 'CUENTAS A CRÉDITO', emoji: '💳', color: '#ffd2d2', colorTexto: '#9b1c1c' },
  { key: 'indicar_metodo', titulo: 'POR INDICAR MÉTODO DE PAGO', emoji: '🏦', color: '#e3dcff', colorTexto: '#4a37a8' },
  { key: 'por_pagar', titulo: 'POR PAGAR', emoji: '💰', color: '#d2e2ff', colorTexto: '#1e4696' },
];

/** El tono del TOTAL GENERAL: un pastel de la marca con su letra oscura. */
export const COLOR_TOTAL = '#ffe6cc';
export const COLOR_TOTAL_TEXTO = '#8a4b00';

/** El tipo de documento de la fila (lo que el reporte llama «tipo por renglón»). */
export type TipoReporte = 'OC' | 'Servicio' | 'Compra directa' | 'Servicio directo';

/** Estado de una OC/servicio → renglón del reporte. `null` = no entra al reporte. */
export function grupoDeEstado(estado: string | null | undefined): GrupoReporte | null {
  switch (String(estado ?? '').trim()) {
    case 'oc_creada': return 'pendiente_aprobar';
    case 'cuenta_abierta': return 'cuenta_abierta';
    case 'confirmada_metodo': return 'indicar_metodo';
    case 'oc_aprobada': return 'por_pagar';
    default: return null;
  }
}

/** Moneda de la fila: lo que no sea bolívares se trata como dólares (igual que el resto del sistema). */
export function monedaDe(m: string | null | undefined): 'USD' | 'Bs' {
  return /bs|ves/i.test(String(m ?? '')) ? 'Bs' : 'USD';
}

/** Una fila del reporte, ya normalizada para pantalla y PDF. */
export interface FilaReporteCompras {
  grupo: GrupoReporte;
  tipo: TipoReporte;
  codigo: string;
  /** El porqué de la compra: motivo → finalidad → notas → renglones de la orden. */
  motivo: string;
  proveedor: string;
  /** Monto de la compra, en su moneda. En crédito es el total de la cuenta. */
  monto: number;
  moneda: 'USD' | 'Bs';
  /** Solo en cuentas a crédito: lo ya abonado. */
  abonado: number;
  /** Lo que queda por pagar (en crédito, monto − abonado). Es lo que suma el reporte. */
  saldo: number;
  /** Fecha del paso con el que entró al renglón (ISO); sin dato = null. */
  fecha: string | null;
}

/** El «motivo» de una compra. Muchas órdenes traen el porqué en `notas` y no en `motivo`. */
export function motivoDeOrden(o: Pick<Orden, 'motivo' | 'finalidad' | 'notas' | 'items'>): string {
  const directo = [o.motivo, o.finalidad, o.notas].map((t) => String(t ?? '').trim()).find(Boolean);
  if (directo) return directo.replace(/\s+/g, ' ');
  const items = (o.items ?? []).map((i) => String(i.nombre ?? '').trim()).filter(Boolean);
  return items.length ? items.join(', ') : '—';
}

/** Monto a pagar de una OC: en contra entrega solo lo RECIBIDO; siempre menos el descuento
 *  indicado al elegir el método de pago (mismo criterio con el que paga Tesorería). */
export function montoDeOrden(o: Pick<Orden, 'condiciones_pago' | 'total' | 'recibido_total' | 'descuento_pago'>): number {
  const contraEntrega = o.condiciones_pago === 'contra_entrega';
  const base = contraEntrega && o.recibido_total != null ? Number(o.recibido_total) : Number(o.total);
  const desc = Math.max(0, Number(o.descuento_pago) || 0);
  return Math.max(0, Math.round(((Number(base) || 0) - desc) * 100) / 100);
}

const dos = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

/** Normaliza una OC o un servicio. `null` si su estado no entra al reporte. */
export function filaDeOrden(o: Orden, proveedorNombre = '—'): FilaReporteCompras | null {
  const grupo = grupoDeEstado(o.estado);
  if (!grupo) return null;
  const monto = montoDeOrden(o);
  const abonado = grupo === 'cuenta_abierta' ? dos(o.abonado_total) : 0;
  return {
    grupo,
    tipo: o.clase === 'servicio' ? 'Servicio' : 'OC',
    codigo: String(o.oc_codigo ?? o.codigo ?? '—'),
    motivo: motivoDeOrden(o),
    proveedor: proveedorNombre || '—',
    monto,
    moneda: monedaDe(o.moneda),
    abonado,
    saldo: grupo === 'cuenta_abierta' ? Math.max(0, dos(monto - abonado)) : monto,
    fecha: o.oc_aprobada_en ?? o.oc_creada_en ?? o.created_at ?? null,
  };
}

/** Lo mínimo que necesita una compra/servicio directo para entrar al renglón «Por pagar». */
export interface DirectoReporte {
  tipo: 'Compra directa' | 'Servicio directo';
  codigo: string;
  motivo: string;
  proveedor: string;
  total: number;
  moneda: string | null | undefined;
  fecha?: string | null;
}

/** Un directo por pagar siempre cae en «Por pagar» (no tiene los otros estados de una OC). */
export function filaDeDirecto(d: DirectoReporte): FilaReporteCompras {
  const monto = dos(d.total);
  return {
    grupo: 'por_pagar',
    tipo: d.tipo,
    codigo: d.codigo || '—',
    motivo: String(d.motivo ?? '').trim() || '—',
    proveedor: d.proveedor || '—',
    monto,
    moneda: monedaDe(d.moneda),
    abonado: 0,
    saldo: monto,
    fecha: d.fecha ?? null,
  };
}

/** Un renglón del reporte con sus filas y sus totales por moneda. */
export interface GrupoReporteFilas {
  key: GrupoReporte;
  titulo: string;
  /** Emoji del renglón (sin selector U+FE0F): va en el mensaje de WhatsApp. */
  emoji: string;
  /** Fondo pastel del encabezado del renglón. */
  color: string;
  /** La letra del encabezado: el tono oscuro del mismo color (sobre pastel no va el blanco). */
  colorTexto: string;
  filas: FilaReporteCompras[];
  totalUsd: number;
  totalBs: number;
}

/** Total por moneda de un conjunto de filas (suma el SALDO: en crédito, lo pendiente). */
export function totalesPorMoneda(filas: FilaReporteCompras[]): { usd: number; bs: number } {
  let usd = 0;
  let bs = 0;
  for (const f of filas) {
    if (f.moneda === 'Bs') bs += f.saldo;
    else usd += f.saldo;
  }
  return { usd: dos(usd), bs: dos(bs) };
}

/** Los totales de un renglón en texto: solo las monedas que tienen filas, sin mezclarlas
 *  («$ 1.234,56 · Bs 9.000,00»). Lo usan la pantalla, el PDF y el mensaje de WhatsApp. */
export function totalesTexto(x: Pick<GrupoReporteFilas, 'filas' | 'totalUsd' | 'totalBs'>): string {
  const partes: string[] = [];
  if (x.filas.some((f) => f.moneda === 'USD')) partes.push(fmtMonto(x.totalUsd, 'USD'));
  if (x.filas.some((f) => f.moneda === 'Bs')) partes.push(fmtMonto(x.totalBs, 'Bs'));
  return partes.join('  ·  ') || fmtMonto(0, 'USD');
}

/** Agrupa las filas en los cuatro renglones del reporte (siempre los cuatro, aunque estén vacíos). */
export function agruparReporte(filas: FilaReporteCompras[]): GrupoReporteFilas[] {
  return GRUPOS_REPORTE.map((g) => {
    const propias = filas.filter((f) => f.grupo === g.key);
    const { usd, bs } = totalesPorMoneda(propias);
    return { ...g, filas: propias, totalUsd: usd, totalBs: bs };
  });
}

/** Monto en su moneda, tal como lo pide el reporte («$ 1.204,88» / «Bs 367.606,68»). */
export function fmtMonto(n: number | null | undefined, moneda: 'USD' | 'Bs'): string {
  const monto = (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'Bs' ? `Bs ${monto}` : `$ ${monto}`;
}
