/* ============================================================
   MGG · Inventario · Vista de teléfono · Históricos (03-11-2026)

   Pedido de la administradora, sobre el histórico del 02-11:
   · El histórico de SALIDAS trae también las del módulo de Salidas que ya se
     ejecutaron (descontaron stock), no solo las del teléfono. Y «SOLO LAS DE
     CARLOS EN EL PERFIL DE CARLOS Y SOLO LAS DE ISNER EN EL PERFIL DE ISNER»:
     el almacenista con sede ve solo las que él registró o ejecutó; quien no
     tiene sede (administración) ve todas las del almacén.
   · El PDF de la salida del teléfono es la misma ORDEN DE SALIDA del módulo
     («que esto sea como ya se tiene en salidas»): acá se arma lo que esa orden
     necesita a partir de la salida del teléfono, el generador no se duplica.
   · Nuevo histórico de TRASLADOS: los del teléfono (kardex `traslado_telefono`)
     y los del módulo de Traslados, de los almacenes que el usuario ve.

   Acá vive lo que no toca la base (filtrar, ordenar, textos, mensajes y lo que
   se le pasa a la orden en PDF), para poder probarlo. Emojis sin U+FE0F.
   ============================================================ */
import type { OpcionesOrdenPdf } from '@/modules/salidas/salidaPdf';
import type { ItemSolicitudSalida, SolicitudSalida } from '@/shared/lib/types';
import {
  fechaHoraVE, filaHistoricoSalida, filtrarSalidas, mensajeSalidaLote, mensajeTraslado, num, textoRetorno, type SalidaTelefono,
} from './inventarioTelefono';
import { nombreAlmacenVisible } from './sectorizacion';

export type OrigenRegistro = 'telefono' | 'modulo';

export const ETIQUETA_ORIGEN: Record<OrigenRegistro, string> = {
  telefono: '📱 Teléfono',
  modulo: '🗂 Módulo Salidas',
};
export const ETIQUETA_ORIGEN_TRASLADO: Record<OrigenRegistro, string> = {
  telefono: '📱 Teléfono',
  modulo: '🗂 Módulo Traslados',
};

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const conUnidad = (n: number, u?: string | null) => `${num(n)}${u ? ` ${u}` : ''}`;
const correo = (c: string | null | undefined) => (c ?? '').trim().toLowerCase();

/* ── Del módulo de Salidas y Traslados ── */

/** Las líneas de una solicitud: el detalle multi-producto o, si no hay, la cabecera. */
export function lineasDeSolicitud(sol: SolicitudSalida): ItemSolicitudSalida[] {
  if (sol.items && sol.items.length) return sol.items;
  return [{
    producto_id: sol.producto_id ?? '', producto_nombre: sol.producto_nombre, cantidad: Number(sol.cantidad) || 0,
    precio_unit: sol.precio_unit, unidad: null, almacen: sol.almacen_origen,
  }];
}

/** ¿La solicitud movió stock de verdad? Ejecutada y NO cerrada «sin descontar» (manual_externo). */
export function movioStock(sol: Pick<SolicitudSalida, 'estado' | 'mov_ref' | 'tipo'>): boolean {
  return sol.tipo === 'material' && sol.estado === 'ejecutada' && sol.mov_ref !== 'manual_externo';
}

/** ¿La solicitud toca este almacén (origen, destino o el almacén de alguna línea)? */
export function tocaAlmacen(sol: SolicitudSalida, almacen: string): boolean {
  if (!almacen) return false;
  if (sol.almacen_origen === almacen) return true;
  if (sol.scope === 'traslado' && sol.almacen_destino === almacen) return true;
  return (sol.items ?? []).some((it) => it.almacen === almacen);
}

/**
 * ¿Es «suya»? La registró (actor) o la ejecutó. `email` null = sin restricción
 * (usuario sin sede): ve todas.
 */
export function esDelUsuario(
  r: { actor?: string | null; ejecutada_por?: string | null }, email: string | null,
): boolean {
  if (email === null) return true;
  const yo = correo(email);
  return !!yo && (correo(r.actor) === yo || correo(r.ejecutada_por) === yo);
}

/* ── Histórico de salidas ── */

export type FilaSalida =
  /** `grupo`: los materiales de esa salida (mismo N° SAT, 04-11-2026); `salida` es el primero. */
  | { origen: 'telefono'; id: string; at: string; salida: SalidaTelefono; grupo: SalidaTelefono[] }
  | { origen: 'modulo'; id: string; at: string; sol: SolicitudSalida };

/**
 * Junta las salidas del teléfono y las del módulo de un almacén, de la más nueva a
 * la más vieja. Del módulo entran solo las salidas de material que descontaron
 * stock y tocan el almacén. `email` = solo las de ese usuario (null = todas).
 */
export function mezclarSalidas(
  telefono: SalidaTelefono[], modulo: SolicitudSalida[], almacen: string, email: string | null,
): FilaSalida[] {
  const filas: FilaSalida[] = [
    ...agruparPorCodigo(telefono.filter((s) => s.almacen === almacen && esDelUsuario(s, email)))
      .map((g): FilaSalida => ({ origen: 'telefono', id: `t:${g[0].id}`, at: g[0].created_at, salida: g[0], grupo: g })),
    ...modulo.filter((s) => s.scope === 'salida' && movioStock(s) && tocaAlmacen(s, almacen) && esDelUsuario(s, email))
      .map((s): FilaSalida => ({ origen: 'modulo', id: `m:${s.id}`, at: s.created_at, sol: s })),
  ];
  return filas.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id.localeCompare(b.id)));
}

/** Junta las salidas del teléfono que comparten N° SAT (una salida con varios materiales). */
export function agruparPorCodigo(ss: SalidaTelefono[]): SalidaTelefono[][] {
  const m = new Map<string, SalidaTelefono[]>();
  for (const s of ss) {
    const g = m.get(s.codigo);
    if (g) g.push(s); else m.set(s.codigo, [s]);
  }
  return [...m.values()].map((g) => [...g].sort((a, b) => a.created_at.localeCompare(b.created_at)));
}

/** Lo que se busca de una salida del módulo: N°, materiales, motivo, destino, quién. */
function textoBuscableSolicitud(sol: SolicitudSalida, at: string): string {
  return [
    sol.codigo, sol.num_usuario != null ? String(sol.num_usuario).padStart(3, '0') : '', sol.motivo ?? '', sol.destino ?? '',
    sol.solicitante ?? '', sol.actor_name ?? '', sol.almacen_destino ?? '',
    ...lineasDeSolicitud(sol).map((l) => l.producto_nombre ?? ''), fechaHoraVE(at),
  ].join(' ');
}

/** Buscador del histórico de salidas: material, N° (SAT, SAL o el del usuario) o motivo. */
export function buscarFilasSalida(filas: FilaSalida[], busca: string): FilaSalida[] {
  const q = sinAcentos(busca.trim());
  if (!q) return filas;
  return filas.filter((f) => (f.origen === 'telefono'
    ? filtrarSalidas(f.grupo, busca).length > 0
    : sinAcentos(textoBuscableSolicitud(f.sol, f.at)).includes(q)));
}

/** Cómo se ve cada renglón del histórico. */
export interface VistaFila { titulo: string; cantidad: string; lineas: string[]; estado: string; origen: string }

/** «MANGUERA» o «MANGUERA y 2 más». */
function tituloDeLineas(ls: ItemSolicitudSalida[]): string {
  const primero = ls[0]?.producto_nombre || '—';
  return ls.length > 1 ? `${primero} y ${ls.length - 1} más` : primero;
}

/** El N° como lo muestra el módulo: el correlativo del usuario y el código. */
export function numeroDeSolicitud(sol: Pick<SolicitudSalida, 'codigo' | 'num_usuario'>): string {
  return sol.num_usuario != null ? `N° ${String(sol.num_usuario).padStart(3, '0')} · ${sol.codigo}` : sol.codigo;
}

export function vistaFilaSalida(f: FilaSalida, registro?: string | null): VistaFila {
  if (f.origen === 'telefono') {
    const v = filaHistoricoSalida(f.salida, registro);
    if (f.grupo.length > 1) {
      return {
        titulo: `${f.salida.producto_nombre} y ${f.grupo.length - 1} más`, cantidad: `${f.grupo.length} materiales`,
        lineas: v.lineas, estado: v.retorno, origen: ETIQUETA_ORIGEN.telefono,
      };
    }
    return { titulo: v.titulo, cantidad: v.cantidad, lineas: v.lineas, estado: v.retorno, origen: ETIQUETA_ORIGEN.telefono };
  }
  const sol = f.sol;
  const ls = lineasDeSolicitud(sol);
  const unaSola = ls.length === 1 ? ls[0] : null;
  return {
    titulo: tituloDeLineas(ls),
    cantidad: unaSola ? conUnidad(Number(unaSola.cantidad) || 0, unaSola.unidad) : `${ls.length} renglones`,
    lineas: [
      `${numeroDeSolicitud(sol)} · ${fechaHoraVE(f.at)}`,
      sol.motivo ? `Motivo: ${sol.motivo}` : '',
      sol.destino ? `Unidad solicitante: ${sol.destino}` : '',
      registro ? `Registró ${registro}` : '',
    ].filter(Boolean),
    estado: 'Ejecutada',
    origen: ETIQUETA_ORIGEN.modulo,
  };
}

/* ── Mensajes de WhatsApp de lo que viene del módulo (allá no hay mensaje propio) ── */

function pieModulo(almacen: string | null | undefined, quien: string | null | undefined, cuando: string | null | undefined): string[] {
  const l: string[] = [''];
  if (quien) l.push(`👷 *Registrado por:* ${quien}`);
  const f = fechaHoraVE(cuando);
  if (f) l.push(`🕒 ${f}`);
  l.push('', `🏢 *MINERAL GROUP GUAYANA C.A.*${almacen ? ` · ${nombreAlmacenVisible(almacen)}` : ''}`);
  return l;
}

/** El aviso de una salida del módulo, con el mismo formato que la del teléfono. */
export function mensajeSalidaModulo(sol: SolicitudSalida, quien?: string | null): string {
  const ls = lineasDeSolicitud(sol);
  const almacen = sol.almacen_origen || ls[0]?.almacen || '';
  const l = [
    '📤 *SALIDA DE ALMACÉN*',
    `🔖 *N°:* ${numeroDeSolicitud(sol).replace(/^N° /, '')}`,
    `🏬 *Almacén:* ${nombreAlmacenVisible(almacen)}`,
    '',
  ];
  if (ls.length === 1) {
    l.push(`📦 *Material:* ${ls[0].producto_nombre || '—'}`, `🔢 *Cantidad:* ${conUnidad(Number(ls[0].cantidad) || 0, ls[0].unidad)}`);
  } else {
    l.push('📦 *Materiales:*', ...ls.map((it) => `• ${it.producto_nombre || '—'}: ${conUnidad(Number(it.cantidad) || 0, it.unidad)}`));
  }
  if (sol.destino) l.push(`📍 *Unidad solicitante:* ${sol.destino}`);
  if (sol.motivo) l.push(`📝 *Motivo:* ${sol.motivo}`);
  l.push(...pieModulo(almacen, quien ?? sol.actor_name ?? sol.actor, sol.ejecutada_en || sol.created_at));
  return l.join('\n');
}

/** El mensaje de una fila del histórico de salidas (el mismo de cuando se registró). */
export function mensajeFilaSalida(f: FilaSalida, quien: string): string {
  return f.origen === 'telefono' ? mensajeSalidaLote(f.grupo, quien) : mensajeSalidaModulo(f.sol, quien);
}

/* ── La ORDEN DE SALIDA del módulo para una salida del teléfono ── */

export interface OrdenParaPdf { sol: SolicitudSalida; opciones: OpcionesOrdenPdf }

/**
 * Lo que la ORDEN DE SALIDA del módulo necesita, armado desde la salida del teléfono.
 * El N° es el SAT de la salida (el teléfono no lleva correlativo por usuario), el
 * precio es el costo del almacén al momento de la salida (el del kardex) y en
 * «Autorizado por» va quien eligió el almacenista.
 */
export function ordenDeSalidaTelefono(s: SalidaTelefono, quien: string, precio: number | null): OrdenParaPdf {
  const almacen = nombreAlmacenVisible(s.almacen);
  const p = precio && precio > 0 ? precio : null;
  return {
    sol: {
      id: s.id, codigo: s.codigo, num_usuario: null, scope: 'salida', tipo: 'material', estado: 'ejecutada',
      producto_id: s.producto_id, producto_nombre: s.producto_nombre, almacen_origen: almacen, cantidad: s.cantidad, precio_unit: p,
      items: [{ producto_id: s.producto_id, producto_nombre: s.producto_nombre, cantidad: s.cantidad, precio_unit: p, unidad: s.unidad, almacen }],
      solicitante: quien, destino: null, motivo: s.motivo, historial: [],
      aprobada_por: null, actor: s.actor, actor_name: s.actor_name ?? quien, created_at: s.created_at, ejecutada_en: s.created_at,
      mov_ref: 'salida_telefono',
    },
    opciones: {
      autorizadoPor: s.autorizado_por || '—',
      notas: [
        `Retorno: ${textoRetorno(s)}`,
        ...(s.fotos.length ? [`Fotos: ${s.fotos.length}`] : []),
        'Registrada desde la vista de teléfono de Inventario y Almacenes.',
      ],
    },
  };
}

/**
 * La ORDEN DE SALIDA de una salida del teléfono con VARIOS materiales (04-11-2026): un
 * renglón por material, con el costo de cada uno. Con uno solo, la de siempre.
 */
export function ordenDeSalidaTelefonoLote(ss: SalidaTelefono[], quien: string, precios: (number | null)[]): OrdenParaPdf {
  const base = ordenDeSalidaTelefono(ss[0], quien, precios[0] ?? null);
  if (ss.length <= 1) return base;
  const almacen = nombreAlmacenVisible(ss[0].almacen);
  return {
    sol: {
      ...base.sol,
      producto_nombre: `${ss[0].producto_nombre} y ${ss.length - 1} más`,
      items: ss.map((s, i) => {
        const p = precios[i] && (precios[i] as number) > 0 ? precios[i] : null;
        return { producto_id: s.producto_id, producto_nombre: s.producto_nombre, cantidad: s.cantidad, precio_unit: p, unidad: s.unidad, almacen };
      }),
    },
    opciones: base.opciones,
  };
}

/** La ORDEN DE TRASLADO de un traslado del teléfono con varios materiales, armada al hacerlo. */
export function ordenDeTrasladoTelefonoLote(d: {
  origen: string; destino: string; motivo: string; quien: string; actor: string; actorName: string | null; at: string;
  lineas: { producto_id: string; nombre: string; unidad: string | null; cantidad: number; precio: number | null }[];
}): OrdenParaPdf {
  const origen = nombreAlmacenVisible(d.origen);
  const ref = `TT-${d.at.replace(/\D/g, '').slice(2, 12)}`;
  return {
    sol: {
      id: ref, codigo: ref, num_usuario: null, scope: 'traslado', tipo: 'material', estado: 'ejecutada',
      producto_id: d.lineas[0]?.producto_id ?? null, producto_nombre: d.lineas.length > 1 ? `${d.lineas[0].nombre} y ${d.lineas.length - 1} más` : (d.lineas[0]?.nombre ?? ''),
      almacen_origen: origen, almacen_destino: nombreAlmacenVisible(d.destino), cantidad: d.lineas[0]?.cantidad ?? 0, precio_unit: d.lineas[0]?.precio ?? null,
      items: d.lineas.map((l) => ({ producto_id: l.producto_id, producto_nombre: l.nombre, cantidad: l.cantidad, precio_unit: l.precio, unidad: l.unidad, almacen: origen })),
      solicitante: d.quien, motivo: d.motivo || null, historial: [], aprobada_por: null,
      actor: d.actor, actor_name: d.actorName ?? d.quien, created_at: d.at, ejecutada_en: d.at, mov_ref: 'traslado_telefono',
    },
    opciones: {
      autorizadoPor: 'No requiere (traslado directo desde el teléfono)',
      notas: ['Registrado desde la vista de teléfono de Inventario y Almacenes.'],
    },
  };
}

/* ── Histórico de traslados ── */

/** Un traslado hecho desde el teléfono, leído de su pata en el kardex del almacén elegido. */
export interface TrasladoTelefono {
  /** Id del movimiento (la pata del almacén elegido). */
  id: string;
  at: string;
  origen: string;
  destino: string;
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  unidad: string | null;
  cantidad: number;
  motivo: string;
  precio: number | null;
  actor: string | null;
  actor_name: string | null;
}

/** El renglón del kardex de un traslado del teléfono, como llega de la base. */
export interface MovimientoTraslado {
  id: string;
  producto_id: string;
  delta: number | string;
  almacen: string | null;
  detalle: string | null;
  precio_unitario?: number | string | null;
  costo_promedio?: number | string | null;
  actor?: string | null;
  actor_name?: string | null;
  at: string;
  producto?: { sku?: string | null; nombre?: string | null; unidad?: string | null } | null;
}

/** Referencia corta de un traslado del teléfono, que no lleva correlativo propio. */
export const refTrasladoTelefono = (id: string) => `TT-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;

/**
 * Lee un renglón `traslado_telefono` del kardex. La pata de salida dice «Transferencia
 * a DESTINO · motivo (teléfono)» y la de entrada «Transferencia desde ORIGEN · …». El
 * reverso de un traslado que no entró («Reverso: …») no es un traslado: `null`.
 */
export function trasladoDeMovimiento(m: MovimientoTraslado): TrasladoTelefono | null {
  const almacen = (m.almacen ?? '').trim();
  const delta = Number(m.delta) || 0;
  const r = /^Transferencia (a|desde) (.+?)(?: · (.*))?$/.exec((m.detalle ?? '').trim());
  if (!r || !almacen || delta === 0) return null;
  const sale = r[1] === 'a';
  if (sale !== delta < 0) return null;
  const otro = r[2].trim();
  const motivo = (r[3] ?? '').replace(/\s*\(teléfono\)\s*$/, '').trim();
  const precio = Number(sale ? m.costo_promedio : m.precio_unitario) || 0;
  return {
    id: m.id, at: m.at, origen: sale ? almacen : otro, destino: sale ? otro : almacen,
    producto_id: m.producto_id, producto_nombre: m.producto?.nombre || '—', sku: m.producto?.sku ?? null,
    unidad: m.producto?.unidad ?? null, cantidad: Math.abs(delta), motivo, precio: precio > 0 ? precio : null,
    actor: m.actor ?? null, actor_name: m.actor_name ?? null,
  };
}

export type FilaTraslado =
  | { origen: 'telefono'; id: string; at: string; traslado: TrasladoTelefono }
  | { origen: 'modulo'; id: string; at: string; sol: SolicitudSalida };

/**
 * Junta los traslados del teléfono y los del módulo que tocan el almacén, de la más
 * nueva a la más vieja. Del módulo, solo los que movieron stock.
 */
export function mezclarTraslados(telefono: TrasladoTelefono[], modulo: SolicitudSalida[], almacen: string): FilaTraslado[] {
  const filas: FilaTraslado[] = [
    ...telefono.filter((t) => t.origen === almacen || t.destino === almacen)
      .map((t): FilaTraslado => ({ origen: 'telefono', id: `t:${t.id}`, at: t.at, traslado: t })),
    ...modulo.filter((s) => s.scope === 'traslado' && movioStock(s) && tocaAlmacen(s, almacen))
      .map((s): FilaTraslado => ({ origen: 'modulo', id: `m:${s.id}`, at: s.created_at, sol: s })),
  ];
  return filas.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id.localeCompare(b.id)));
}

/** De dónde a dónde (con los nombres que ve la gente). */
function ruta(origen: string | null | undefined, destino: string | null | undefined): string {
  return `${nombreAlmacenVisible(origen || '—')} → ${nombreAlmacenVisible(destino || '—')}`;
}

export function vistaFilaTraslado(f: FilaTraslado, registro?: string | null): VistaFila {
  if (f.origen === 'telefono') {
    const t = f.traslado;
    return {
      titulo: t.producto_nombre,
      cantidad: conUnidad(t.cantidad, t.unidad),
      lineas: [
        `${refTrasladoTelefono(t.id)} · ${fechaHoraVE(t.at)}`,
        ruta(t.origen, t.destino),
        t.motivo ? `Motivo: ${t.motivo}` : '',
        registro ? `Registró ${registro}` : '',
      ].filter(Boolean),
      estado: 'Trasladado',
      origen: ETIQUETA_ORIGEN_TRASLADO.telefono,
    };
  }
  const sol = f.sol;
  const ls = lineasDeSolicitud(sol);
  const unaSola = ls.length === 1 ? ls[0] : null;
  return {
    titulo: tituloDeLineas(ls),
    cantidad: unaSola ? conUnidad(Number(unaSola.cantidad) || 0, unaSola.unidad) : `${ls.length} renglones`,
    lineas: [
      `${numeroDeSolicitud(sol)} · ${fechaHoraVE(f.at)}`,
      ruta(sol.almacen_origen || ls[0]?.almacen, sol.almacen_destino),
      sol.motivo ? `Motivo: ${sol.motivo}` : '',
      registro ? `Registró ${registro}` : '',
    ].filter(Boolean),
    estado: 'Ejecutado',
    origen: ETIQUETA_ORIGEN_TRASLADO.modulo,
  };
}

/** Buscador del histórico de traslados: material, N°, motivo o almacén. */
export function buscarFilasTraslado(filas: FilaTraslado[], busca: string): FilaTraslado[] {
  const q = sinAcentos(busca.trim());
  if (!q) return filas;
  return filas.filter((f) => {
    const texto = f.origen === 'telefono'
      ? [f.traslado.producto_nombre, f.traslado.sku ?? '', refTrasladoTelefono(f.traslado.id), f.traslado.motivo,
        f.traslado.origen, f.traslado.destino, nombreAlmacenVisible(f.traslado.origen), nombreAlmacenVisible(f.traslado.destino),
        f.traslado.actor_name ?? '', fechaHoraVE(f.at)].join(' ')
      : textoBuscableSolicitud(f.sol, f.at);
    return sinAcentos(texto).includes(q);
  });
}

/** El aviso de un traslado del histórico, con `mensajeTraslado` (el del teléfono). */
export function mensajeFilaTraslado(f: FilaTraslado, quien: string): string {
  if (f.origen === 'telefono') {
    const t = f.traslado;
    return mensajeTraslado({
      origen: t.origen, destino: t.destino, nombre: t.producto_nombre, sku: t.sku, unidad: t.unidad,
      cantidad: t.cantidad, motivo: t.motivo || '—', quien, cuando: t.at,
    });
  }
  const sol = f.sol;
  const ls = lineasDeSolicitud(sol);
  const origen = sol.almacen_origen || ls[0]?.almacen || '';
  const destino = sol.almacen_destino || '';
  const cuando = sol.ejecutada_en || sol.created_at;
  if (ls.length === 1) {
    return mensajeTraslado({
      origen, destino, nombre: ls[0].producto_nombre || '—', unidad: ls[0].unidad, cantidad: Number(ls[0].cantidad) || 0,
      motivo: sol.motivo || '—', quien, cuando,
    }).replace('🔁 *TRASLADO ENTRE ALMACENES*', `🔁 *TRASLADO ENTRE ALMACENES*\n🔖 *N°:* ${numeroDeSolicitud(sol).replace(/^N° /, '')}`);
  }
  const l = [
    '🔁 *TRASLADO ENTRE ALMACENES*',
    `🔖 *N°:* ${numeroDeSolicitud(sol).replace(/^N° /, '')}`,
    `🏬 *De:* ${nombreAlmacenVisible(origen)}`,
    `🏬 *A:* ${nombreAlmacenVisible(destino)}`,
    '',
    '📦 *Materiales:*',
    ...ls.map((it) => `• ${it.producto_nombre || '—'}: ${conUnidad(Number(it.cantidad) || 0, it.unidad)}`),
  ];
  if (sol.motivo) l.push(`📝 *Motivo:* ${sol.motivo}`);
  l.push(...pieModulo(origen, quien, cuando));
  return l.join('\n');
}

/** La ORDEN DE TRASLADO del módulo para un traslado del teléfono (no lleva autorización). */
export function ordenDeTrasladoTelefono(t: TrasladoTelefono, quien: string): OrdenParaPdf {
  const origen = nombreAlmacenVisible(t.origen);
  return {
    sol: {
      id: t.id, codigo: refTrasladoTelefono(t.id), num_usuario: null, scope: 'traslado', tipo: 'material', estado: 'ejecutada',
      producto_id: t.producto_id, producto_nombre: t.producto_nombre, almacen_origen: origen,
      almacen_destino: nombreAlmacenVisible(t.destino), cantidad: t.cantidad, precio_unit: t.precio,
      items: [{ producto_id: t.producto_id, producto_nombre: t.producto_nombre, cantidad: t.cantidad, precio_unit: t.precio, unidad: t.unidad, almacen: origen }],
      solicitante: quien, motivo: t.motivo || null, historial: [], aprobada_por: null,
      actor: t.actor, actor_name: t.actor_name ?? quien, created_at: t.at, ejecutada_en: t.at, mov_ref: 'traslado_telefono',
    },
    opciones: {
      autorizadoPor: 'No requiere (traslado directo desde el teléfono)',
      notas: ['Registrado desde la vista de teléfono de Inventario y Almacenes.'],
    },
  };
}
