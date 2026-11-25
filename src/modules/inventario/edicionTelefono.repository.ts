import { supabase } from '@/shared/lib/supabase';
import type { Movimiento } from '@/shared/lib/types';
import { registrarMovimiento } from './movimientos.repository';
import { getExistencia } from './almacenes.repository';
import { ajustesSalidaTelefono, ajustesTrasladoTelefono, validarEdicionSalidaTelefono, validarEdicionTrasladoTelefono, type LineaEdicionTelefono } from './edicionTelefono';
import type { AjusteStockEdicionEjecutada } from '@/modules/salidas/edicionEjecutada';
import type { SalidaTelefono } from './inventarioTelefono';
import type { TrasladoTelefono } from './historicosTelefono';

const mensaje = (e: unknown) => String((e as { message?: string } | null)?.message ?? 'error desconocido');

async function aplicarAjustes(
  ajustes: AjusteStockEdicionEjecutada[],
  scope: 'salida' | 'traslado',
  refCodigo: string,
  actor: string,
  actorName: string | null,
): Promise<() => Promise<void>> {
  const faltantes: string[] = [];
  for (const a of ajustes.filter((x) => x.delta < 0)) {
    const ex = await getExistencia(a.producto_id, a.almacen);
    const hay = Number(ex?.stock) || 0;
    if (hay + a.delta < -0.000001) faltantes.push(`${a.producto_nombre}: se necesitan ${-a.delta}, hay ${hay} en ${a.almacen}`);
  }
  if (faltantes.length) throw new Error(`No se guardó: no hay stock suficiente.\n• ${faltantes.join('\n• ')}`);

  const aplicados: AjusteStockEdicionEjecutada[] = [];
  const registrar = async (a: AjusteStockEdicionEjecutada, delta: number, reverso: boolean) => {
    await registrarMovimiento({
      producto_id: a.producto_id,
      tipo: scope === 'traslado' ? 'transferencia' : (delta > 0 ? 'entrada' : 'salida'),
      delta,
      almacen: a.almacen,
      actor,
      actor_name: actorName,
      ref_tipo: scope === 'traslado' ? 'traslado_telefono_edicion' : 'salida_telefono_edicion',
      ref_codigo: refCodigo,
      detalle: reverso ? `Reverso por edición fallida de ${refCodigo}` : `Edición de ${refCodigo} · ajuste por diferencia`,
      precio_unitario: null,
    });
  };
  const revertir = async () => {
    for (const a of [...aplicados].reverse()) await registrar(a, -a.delta, true);
  };
  try {
    for (const a of ajustes) {
      await registrar(a, a.delta, false);
      aplicados.push(a);
    }
  } catch (e) {
    try { await revertir(); } catch { /* el error principal exige revisar el kardex */ }
    throw e;
  }
  return revertir;
}

export async function editarSalidaTelefono(d: {
  anteriores: SalidaTelefono[];
  lineas: LineaEdicionTelefono[];
  motivo: string;
  solicitadoPor: string;
  retorna: boolean;
  actor: string;
  actorName: string | null;
}): Promise<void> {
  const invalida = validarEdicionSalidaTelefono(d.anteriores, d.lineas, d.retorna);
  if (invalida) throw new Error(invalida);
  if (d.motivo.trim().length < 3) throw new Error('Escribe el motivo de la salida.');
  if (!d.solicitadoPor.trim()) throw new Error('Indica quién solicitó el material.');

  let hechas = 0;
  for (let i = 0; i < d.anteriores.length; i++) {
    const vieja = d.anteriores[i];
    const nueva = d.lineas[i];
    const revertir = await aplicarAjustes(ajustesSalidaTelefono([vieja], [nueva]), 'salida', vieja.codigo, d.actor, d.actorName);
    try {
      const { error } = await supabase.rpc('inv_tel_editar_salida', { p: {
        id: vieja.id,
        producto_id: nueva.producto.id,
        cantidad: nueva.cantidad,
        motivo: d.motivo.trim(),
        autorizado_por: d.solicitadoPor.trim(),
        almacen: vieja.almacen,
        retorna: d.retorna,
        actualizado_esperado: vieja.updated_at ?? null,
      } });
      if (error) throw error;
      hechas++;
    } catch (e) {
      try { await revertir(); } catch { /* se informa que hay que revisar */ }
      throw new Error(`${hechas ? `Se guardaron ${hechas} material(es); el resto no. ` : ''}No se pudo editar ${vieja.codigo}: ${mensaje(e)}`);
    }
  }
}

export async function editarTrasladoTelefono(d: {
  anteriores: TrasladoTelefono[];
  lineas: LineaEdicionTelefono[];
  destino: string;
  motivo: string;
  solicitadoPor: string;
  actor: string;
  actorName: string | null;
}): Promise<void> {
  const origen = d.anteriores[0]?.origen ?? '';
  const invalida = validarEdicionTrasladoTelefono(d.anteriores, d.lineas, origen, d.destino);
  if (invalida) throw new Error(invalida);
  if (!d.solicitadoPor.trim()) throw new Error('Indica quién solicitó el traslado.');

  let hechas = 0;
  for (let i = 0; i < d.anteriores.length; i++) {
    const vieja = d.anteriores[i];
    const nueva = d.lineas[i];
    const codigo = vieja.codigo!;
    const { data: patas, error: leerError } = await supabase.from('movimientos').select('*')
      .eq('ref_tipo', 'traslado_telefono').eq('ref_codigo', codigo).eq('producto_id', vieja.producto_id)
      .ilike('detalle', 'Transferencia%');
    if (leerError) throw leerError;
    const originales = (patas ?? []) as Movimiento[];
    const negativa = originales.find((m) => Number(m.delta) < 0);
    const positiva = originales.find((m) => Number(m.delta) > 0);
    if (!negativa || !positiva || originales.length !== 2) {
      throw new Error(`${codigo} no tiene sus dos patas originales claras; revisa el kardex antes de editarlo.`);
    }

    const revertirStock = await aplicarAjustes(ajustesTrasladoTelefono([vieja], [nueva], d.destino), 'traslado', codigo, d.actor, d.actorName);
    const precio = Number(nueva.producto.precio) || null;
    const saliente = {
      producto_id: nueva.producto.id, delta: -nueva.cantidad, almacen: origen, destino: d.destino,
      detalle: `Transferencia a ${d.destino}${d.motivo.trim() ? ` · ${d.motivo.trim()}` : ''} (teléfono)`,
      solicitante: d.solicitadoPor.trim(), precio_unitario: precio, costo_promedio: precio,
    };
    const entrante = {
      producto_id: nueva.producto.id, delta: nueva.cantidad, almacen: d.destino, destino: null,
      detalle: `Transferencia desde ${origen}${d.motivo.trim() ? ` · ${d.motivo.trim()}` : ''} (teléfono)`,
      solicitante: d.solicitadoPor.trim(), precio_unitario: precio, costo_promedio: precio,
    };
    try {
      const { error: errSalida } = await supabase.from('movimientos').update(saliente).eq('id', negativa.id);
      if (errSalida) throw errSalida;
      const { error: errEntrada } = await supabase.from('movimientos').update(entrante).eq('id', positiva.id);
      if (errEntrada) throw errEntrada;
      hechas++;
    } catch (e) {
      // Recomponer la pata que pudo haberse actualizado y devolver el stock de la
      // corrección. Se conservan los campos originales, no se borra historial.
      await supabase.from('movimientos').update({
        producto_id: negativa.producto_id, delta: negativa.delta, almacen: negativa.almacen,
        destino: negativa.destino, detalle: negativa.detalle, solicitante: negativa.solicitante,
        precio_unitario: negativa.precio_unitario, costo_promedio: negativa.costo_promedio,
      }).eq('id', negativa.id);
      await supabase.from('movimientos').update({
        producto_id: positiva.producto_id, delta: positiva.delta, almacen: positiva.almacen,
        destino: positiva.destino, detalle: positiva.detalle, solicitante: positiva.solicitante,
        precio_unitario: positiva.precio_unitario, costo_promedio: positiva.costo_promedio,
      }).eq('id', positiva.id);
      try { await revertirStock(); } catch { /* se informa que hay que revisar */ }
      throw new Error(`${hechas ? `Se guardaron ${hechas} material(es); el resto no. ` : ''}No se pudo editar ${codigo}: ${mensaje(e)}`);
    }
  }
}
