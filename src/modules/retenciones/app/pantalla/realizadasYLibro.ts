/* ============================================================
   MGG · Retenciones v8 · Realizadas y Libro fiscal (lógica pura)

   Traslado de `v7PintarHechas` y `v6PintarLibro` de la maqueta, sobre las
   retenciones del libro de hoy:
   · Realizadas: una fila por factura, con todas sus retenciones.
   · Libro fiscal: una fila por retención.
   Las dos comparten la búsqueda, los filtros (impuesto, mes, estado) y el
   orden. El filtro «Origen» (MGG u otro sistema) espera a la convivencia,
   así que no se ofrece.
   ============================================================ */

import { buscaEn } from '../listas/filtros';
import type { RetencionPracticada } from '../datos/puerta';
import { nombreImpuesto } from './pendientesPorDocumento';

export type EstadoFila = 'registrada' | 'declarada' | 'anulada';
export type EstadoFacturaRealizada = 'registrada' | 'declarada' | 'anulada_pend' | 'reemplazada';

export const ESTADO_TEXTO: Record<EstadoFila, string> = { registrada: 'Registrada', declarada: 'Declarada', anulada: 'Anulada' };
export const ESTADO_FACTURA_TEXTO: Record<EstadoFacturaRealizada, string> = {
  registrada: 'Registrada',
  declarada: 'Declarada',
  anulada_pend: 'Anulada · pendiente de registrar de nuevo',
  reemplazada: 'Anulada · reemplazada',
};

/** La clase de la etiqueta de estado, como en la maqueta. */
export const ESTADO_CLASE: Record<EstadoFila, string> = { registrada: 'ok', declarada: 'declarada', anulada: 'anulada' };

export function estadoDe(r: RetencionPracticada): EstadoFila {
  if (r.anulada) return 'anulada';
  return r.estado === 'declarada' ? 'declarada' : 'registrada';
}

export function estadoFacturaDe(r: RetencionPracticada, todas: readonly RetencionPracticada[]): EstadoFacturaRealizada {
  if (!r.anulada) return r.estado === 'declarada' ? 'declarada' : 'registrada';
  const viva = todas.some((x) => x.id !== r.id && x.tipo === r.tipo && !x.anulada);
  return viva ? 'reemplazada' : 'anulada_pend';
}

/** «A proveedores» o «De clientes». */
export const textoDireccion = (r: Pick<RetencionPracticada, 'direccion'>): string => (r.direccion === 'recibida' ? 'De clientes' : 'A proveedores');

/** Fecha ISO (aaaa-mm-dd…) → dd/mm/aaaa. */
export function fechaVe(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}

/** La fecha de la fila: la de la factura o, si falta, la del registro. */
const fechaDe = (r: RetencionPracticada): string => r.facturaFecha ?? r.createdAt.slice(0, 10);

export type OrdenLista = 'reciente' | 'antiguo' | 'proveedor';

/** Las opciones del orden, como la maqueta (v8-3-listas.js:207 y :257). */
export const ORDENES_LISTA: { valor: OrdenLista; texto: string }[] = [
  { valor: 'reciente', texto: 'Más reciente primero' }, { valor: 'antiguo', texto: 'Más antiguo primero' }, { valor: 'proveedor', texto: 'Proveedor (A–Z)' },
];

export interface FiltroLibro {
  q: string;
  impuesto: string;
  /** aaaa-mm; '' = todos. */
  mes: string;
  estado: '' | EstadoFila | EstadoFacturaRealizada;
  orden: OrdenLista;
}

export const FILTRO_INICIAL: FiltroLibro = { q: '', impuesto: '', mes: '', estado: '', orden: 'reciente' };

const pasaRetencion = (r: RetencionPracticada, f: FiltroLibro): boolean =>
  (!f.impuesto || r.tipo === f.impuesto)
  && (!f.mes || fechaDe(r).startsWith(f.mes))
  && (!f.estado || estadoDe(r) === f.estado);

const pasaRetencionFactura = (r: RetencionPracticada, todas: readonly RetencionPracticada[], f: FiltroLibro): boolean => {
  if (f.impuesto && r.tipo !== f.impuesto) return false;
  if (f.mes && !fechaDe(r).startsWith(f.mes)) return false;
  if (!f.estado) return true;
  if (f.estado === 'anulada') return !!r.anulada;
  if (f.estado === 'registrada') return !r.anulada && r.estado !== 'declarada';
  if (f.estado === 'declarada') return !r.anulada && r.estado === 'declarada';
  if (f.estado === 'anulada_pend') return !!r.anulada && !todas.some((x) => x.id !== r.id && x.tipo === r.tipo && !x.anulada);
  if (f.estado === 'reemplazada') return !!r.anulada && todas.some((x) => x.id !== r.id && x.tipo === r.tipo && !x.anulada);
  return true;
};

const buscaRetencion = (r: RetencionPracticada, q: string): boolean =>
  buscaEn(q, r.numeroComprobante, r.contraparteNombre, r.contraparteRif, r.facturaNumero, r.docCodigo);

const porFecha = (orden: OrdenLista) => (a: RetencionPracticada, b: RetencionPracticada) => {
  const c = fechaDe(a).localeCompare(fechaDe(b)) || a.createdAt.localeCompare(b.createdAt);
  if (orden === 'proveedor') return (a.contraparteNombre ?? '').localeCompare(b.contraparteNombre ?? '', 'es') || -c;
  return orden === 'reciente' ? -c : c;
};

/** Libro fiscal: una fila por retención, filtrada y ordenada. */
export function filasLibro(libro: readonly RetencionPracticada[], f: FiltroLibro): RetencionPracticada[] {
  return libro.filter((r) => pasaRetencion(r, f) && buscaRetencion(r, f.q)).sort(porFecha(f.orden));
}

export interface FacturaRealizada {
  clave: string;
  docCodigo: string | null;
  contraparteNombre: string | null;
  contraparteRif: string | null;
  direccion: RetencionPracticada['direccion'];
  facturaNumero: string | null;
  fecha: string;
  /** Las que pasan el filtro: las que se muestran. */
  retenciones: RetencionPracticada[];
  /** Todas las de la factura, para decir si una anulada quedó reemplazada. */
  todas: RetencionPracticada[];
}

/**
 * Realizadas: una fila por factura (documento + número de factura), con las
 * retenciones que pasan el filtro. Una factura sin retenciones que pasen no sale.
 */
export function facturasRealizadas(libro: readonly RetencionPracticada[], f: FiltroLibro): FacturaRealizada[] {
  const grupos = new Map<string, RetencionPracticada[]>();
  for (const r of libro) {
    const clave = `${r.docKind}:${r.docId ?? ''}:${r.facturaNumero ?? r.id}`;
    const xs = grupos.get(clave);
    if (xs) xs.push(r); else grupos.set(clave, [r]);
  }
  const out: FacturaRealizada[] = [];
  for (const [clave, rs] of grupos) {
    const visibles = rs.filter((r) => pasaRetencionFactura(r, rs, f));
    if (!visibles.length) continue;
    // La búsqueda mira toda la factura: si una de sus retenciones coincide, la factura sale.
    if (f.q && !rs.some((r) => buscaRetencion(r, f.q))) continue;
    const r0 = rs[0];
    out.push({
      clave, docCodigo: r0.docCodigo, contraparteNombre: r0.contraparteNombre, contraparteRif: r0.contraparteRif,
      direccion: r0.direccion, facturaNumero: r0.facturaNumero, fecha: fechaDe(r0),
      retenciones: visibles.sort((a, b) => a.tipo.localeCompare(b.tipo)),
      todas: rs,
    });
  }
  out.sort((a, b) => (f.orden === 'proveedor'
    ? (a.contraparteNombre ?? '').localeCompare(b.contraparteNombre ?? '', 'es') || b.fecha.localeCompare(a.fecha)
    : f.orden === 'reciente' ? b.fecha.localeCompare(a.fecha) : a.fecha.localeCompare(b.fecha)));
  return out;
}

/**
 * El estado de una retención dentro de su factura, como en la maqueta: una
 * anulada dice si la reemplazó otra del mismo impuesto o si ese impuesto
 * quedó pendiente.
 */
export function textoEstadoEnFactura(r: RetencionPracticada, todas: readonly RetencionPracticada[]): string {
  const e = estadoDe(r);
  if (e !== 'anulada') return ESTADO_TEXTO[e];
  const viva = todas.find((x) => x.id !== r.id && x.tipo === r.tipo && !x.anulada);
  return viva
    ? `Anulada · reemplazada por el N° ${viva.numeroComprobante ?? 'sin número'}`
    : `Anulada · el ${nombreImpuesto(r.tipo)} de esta factura está pendiente`;
}

/**
 * Los enlaces de reemplazo del Libro, como en la maqueta: en la misma factura
 * y el mismo impuesto, la anulada dice qué número la reemplazó y la viva, a
 * cuál reemplaza (la anulada más reciente anterior a ella).
 */
export function enlacesDeReemplazo(libro: readonly RetencionPracticada[]): Map<string, string> {
  const grupos = new Map<string, RetencionPracticada[]>();
  for (const r of libro) {
    if (!r.facturaNumero) continue;
    const clave = `${r.docKind}:${r.docId ?? ''}:${r.facturaNumero}:${r.tipo}:${r.direccion}`;
    const xs = grupos.get(clave);
    if (xs) xs.push(r); else grupos.set(clave, [r]);
  }
  const out = new Map<string, string>();
  const num = (r: RetencionPracticada) => r.numeroComprobante ?? 'sin número';
  for (const xs of grupos.values()) {
    const viva = xs.find((r) => !r.anulada);
    const anuladas = xs.filter((r) => r.anulada).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!viva || !anuladas.length) continue;
    for (const a of anuladas) out.set(a.id, `Reemplazada por el N° ${num(viva)}`);
    const previa = anuladas.filter((a) => a.createdAt <= viva.createdAt).at(-1) ?? anuladas.at(-1);
    if (previa) out.set(viva.id, `Reemplaza al N° ${num(previa)}`);
  }
  return out;
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Las opciones de los filtros, con lo que hay en el libro. */
export function opcionesLibro(libro: readonly RetencionPracticada[]) {
  const impuestos = [...new Set(libro.map((r) => r.tipo as string))];
  const meses = [...new Set(libro.map((r) => fechaDe(r).slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort().reverse();
  const estados = [...new Set(libro.map(estadoDe))];
  return {
    impuesto: impuestos.map((k) => ({ valor: k, texto: nombreImpuesto(k), cuenta: libro.filter((r) => r.tipo === k).length })),
    mes: meses.map((m) => ({ valor: m, texto: `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` })),
    estado: (['registrada', 'declarada', 'anulada'] as EstadoFila[]).filter((e) => estados.includes(e)).map((e) => ({ valor: e, texto: ESTADO_TEXTO[e] })),
  };
}

/** Las 4 opciones del filtro Estado en Realizadas, tal como en la maqueta V8 (v8-3-listas.js:174). */
export function opcionesRealizadas(libro: readonly RetencionPracticada[]) {
  const impuestos = [...new Set(libro.map((r) => r.tipo as string))];
  const meses = [...new Set(libro.map((r) => fechaDe(r).slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort().reverse();

  const grupos = new Map<string, RetencionPracticada[]>();
  for (const r of libro) {
    const clave = `${r.docKind}:${r.docId ?? ''}:${r.facturaNumero ?? r.id}`;
    const xs = grupos.get(clave);
    if (xs) xs.push(r); else grupos.set(clave, [r]);
  }
  const facturas = [...grupos.values()];
  const clavesEstado: EstadoFacturaRealizada[] = ['registrada', 'declarada', 'anulada_pend', 'reemplazada'];

  const estadosOpciones = clavesEstado.map((e) => {
    const cuenta = facturas.filter((fs) => fs.some((r) => estadoFacturaDe(r, fs) === e)).length;
    return { valor: e, texto: ESTADO_FACTURA_TEXTO[e], cuenta };
  }).filter((o) => o.cuenta > 0);

  return {
    impuesto: impuestos.map((k) => ({ valor: k, texto: nombreImpuesto(k), cuenta: libro.filter((r) => r.tipo === k).length })),
    mes: meses.map((m) => ({ valor: m, texto: `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` })),
    estado: estadosOpciones,
  };
}
