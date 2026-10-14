/* ============================================================
   MGG · Control de Maquinaria · Ficha de repuestos del equipo (Supabase)
   Tabla maquinaria_repuestos_equipo (SQL: supabase/sql/maquinaria-repuestos-equipo.sql).
   Lectura, alta/edición/borrado, copia entre equipos y la solicitud de pedido
   de «qué comprar para el próximo servicio» (misma SP de Pedidos que usan las
   órdenes de servicio: unidad MANTENIMIENTO DE MAQUINARIA, clasificación
   Mantenimiento, piezas nuevas dadas de alta con stock 0).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { ItemOrden, Producto } from '@/shared/lib/types';
import { todasLasFilas, PAGINA_SUPABASE } from '@/shared/lib/todasLasFilas';
import { crearOrden, ensureUnidadSolicitante } from '@/modules/pedidos/pedidos.repository';
import { addCategoria, createProducto, listProductosPorIds, siguienteSkuGlobal } from '@/modules/inventario/inventario.repository';
import { notify } from '@/shared/lib/notify';
import { UNIDAD_MAQUINARIA } from './flota.repository';
import { CATEGORIA_REPUESTOS } from './flota';
import { copiaDeRepuesto, repuestosParaCopiar, validarRepuestoEquipo, type DatosRepuestoEquipo, type NecesidadServicio, type RepuestoEquipo } from './repuestosEquipo';

const TABLE = 'maquinaria_repuestos_equipo';
const ALMACEN_PIEZAS = 'General';

type Actor = { email: string; nombre: string | null };

const limpia = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  return s ? s : null;
};

function filaDe(d: DatosRepuestoEquipo) {
  return {
    sistema: d.sistema, tipo: d.tipo.trim(),
    numero_parte: limpia(d.numero_parte), equivalencias: limpia(d.equivalencias), especificacion: limpia(d.especificacion),
    cantidad: Math.round(Number(d.cantidad) * 100) / 100, unidad: (d.unidad ?? '').trim() || 'und',
    cada_horas: d.cada_horas ?? null, cada_km: d.cada_km ?? null,
    producto_id: d.producto_id || null, nota: limpia(d.nota),
  };
}

/** La ficha de un equipo, o la de toda la flota si no se indica. */
export async function listRepuestosEquipo(equipoId?: string): Promise<RepuestoEquipo[]> {
  return todasLasFilas<RepuestoEquipo>((desde, hasta) => {
    let q = supabase.from(TABLE).select('*').order('sistema').order('orden').order('tipo').order('id');
    if (equipoId) q = q.eq('equipo_id', equipoId);
    return q.range(desde, hasta);
  }, PAGINA_SUPABASE, 3).then((rows) => rows.map((r) => ({
    ...r, cantidad: Number(r.cantidad) || 0,
    cada_horas: r.cada_horas == null ? null : Number(r.cada_horas), cada_km: r.cada_km == null ? null : Number(r.cada_km),
  })));
}

/** Los productos del inventario que las fichas tienen vinculados (para el stock en vivo). */
export async function productosDeFichas(fichas: Pick<RepuestoEquipo, 'producto_id'>[]): Promise<Map<string, Producto>> {
  const ids = fichas.map((f) => f.producto_id).filter((x): x is string => !!x);
  const lista = await listProductosPorIds(ids);
  return new Map(lista.map((p) => [p.id, p]));
}

export async function registrarRepuestoEquipo(equipoId: string, d: DatosRepuestoEquipo, actor: Actor): Promise<RepuestoEquipo> {
  const err = validarRepuestoEquipo(d);
  if (err) throw new Error(err);
  const { data, error } = await supabase.from(TABLE).insert({ equipo_id: equipoId, ...filaDe(d), actor: actor.email, actor_name: actor.nombre }).select('*').single();
  if (error) throw error;
  return data as RepuestoEquipo;
}

export async function actualizarRepuestoEquipo(id: string, d: DatosRepuestoEquipo): Promise<void> {
  const err = validarRepuestoEquipo(d);
  if (err) throw new Error(err);
  const { data, error } = await supabase.from(TABLE).update(filaDe(d)).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('No se pudo guardar (puede que el repuesto ya no exista o que no tengas permiso).');
}

export async function eliminarRepuestoEquipo(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

/** Copia la ficha de otro equipo (solo lo que el destino no tiene). Devuelve cuántos entraron. */
export async function copiarRepuestosDeEquipo(desdeEquipoId: string, haciaEquipoId: string, actor: Actor): Promise<number> {
  if (desdeEquipoId === haciaEquipoId) throw new Error('Elige otro equipo: no se puede copiar de sí mismo.');
  const [origen, destino] = await Promise.all([listRepuestosEquipo(desdeEquipoId), listRepuestosEquipo(haciaEquipoId)]);
  const nuevos = repuestosParaCopiar(origen, destino);
  if (!nuevos.length) return 0;
  const filas = nuevos.map((r) => ({ equipo_id: haciaEquipoId, ...filaDe(copiaDeRepuesto(r)), orden: r.orden, actor: actor.email, actor_name: actor.nombre }));
  const { error } = await supabase.from(TABLE).insert(filas);
  if (error) throw error;
  return filas.length;
}

/**
 * Solicitud de pedido con los faltantes del próximo servicio. Las piezas que no están en el
 * inventario se dan de alta (REPUESTOS, stock 0) antes de pedirlas. Devuelve el código de la SP.
 */
export async function solicitarCompraFaltantes(necesidades: NecesidadServicio[], actor: Actor): Promise<string> {
  const pedir = necesidades.filter((n) => n.faltante > 0);
  if (!pedir.length) throw new Error('No hay faltantes que pedir: el inventario cubre el próximo servicio.');
  const items: ItemOrden[] = [];
  const creados: string[] = [];
  const equiposTodos = new Set<string>();
  for (const n of pedir) {
    let productoId = n.producto_id;
    let sku = n.sku ?? '';
    if (!productoId) {
      const { data: ya } = await supabase.from('productos').select('id, sku').eq('estado', 'activo').ilike('nombre', n.nombre).limit(1).maybeSingle();
      const hallado = ya as { id: string; sku: string } | null;
      if (hallado) { productoId = hallado.id; sku = hallado.sku; }
      else {
        const categoria = (await addCategoria(CATEGORIA_REPUESTOS, actor.email).catch(() => null)) ?? CATEGORIA_REPUESTOS;
        const p = await createProducto({
          sku: await siguienteSkuGlobal(categoria), nombre: n.nombre, categoria, unidad: n.unidad || 'und',
          stock: 0, stock_min: 0, precio: 0, almacen: ALMACEN_PIEZAS, estado: 'activo',
          descripcion: `Dado de alta desde la ficha de repuestos de Maquinaria (${n.equipos.map((e) => e.equipo).join(', ')}).${n.detalle ? ` ${n.detalle}.` : ''}`,
        });
        productoId = p.id; sku = p.sku; creados.push(`${p.sku} ${p.nombre}`);
      }
    }
    const equipos = n.equipos.map((e) => e.equipo);
    equipos.forEach((e) => equiposTodos.add(e));
    const unico = n.equipos.length === 1 ? n.equipos[0] : null;
    items.push({
      productoId, sku, nombre: n.nombre, cantidad: n.faltante, precio: 0, unidad: n.unidad || 'und', comprar: true,
      finalidad: `Próximo servicio · ${equipos.join(', ')}${n.detalle ? ` · ${n.detalle}` : ''}`,
      ...(unico ? { equipo_id: unico.equipo_id, equipo_nombre: unico.equipo } : {}),
    });
  }
  await ensureUnidadSolicitante(UNIDAD_MAQUINARIA, actor.email);
  const lista = [...equiposTodos];
  const finalidad = `Repuestos para el próximo servicio de ${lista.length === 1 ? lista[0] : `${lista.length} equipos (${lista.join(', ')})`}`;
  const notas = [`Faltantes según la ficha de repuestos de cada equipo (Maquinaria → Repuestos y compras → Qué comprar).`,
    creados.length ? `Productos nuevos dados de alta: ${creados.join('; ')}.` : ''].filter(Boolean).join(' ');
  const sp = await crearOrden({
    proveedor_id: null, items, notas, motivo: null, finalidad, clasificacion: ['Mantenimiento'],
    solicitante_email: actor.email, solicitante: UNIDAD_MAQUINARIA, solicitante_persona: actor.nombre ?? null,
    ci_solicitante: null, urgente: false,
  });
  notify(`🛒 Solicitud de pedido ${sp.codigo} · repuestos del próximo servicio`, 'info', {
    link: '#/app/pedidos', destino: 'admin', dedup_key: `maq-faltantes-${sp.id}`,
    detail: `${items.length} renglón(es) para ${lista.join(', ')}${creados.length ? ` (${creados.length} producto(s) nuevo(s) con stock 0)` : ''}. Revísala en Pedidos.`,
  });
  return sp.codigo;
}
