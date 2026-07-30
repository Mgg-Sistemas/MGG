// MGG · Edge Function: transfer-recibir (webhook ENTRANTE del puente inter-sistema)
// La llama por HTTP el transfer-enviar del OTRO sistema. Se autentica con el
// secreto compartido (header x-inter-secret), NO con JWT → deploy con
// --no-verify-jwt. Maneja:
//   - 'transferencia' (recurso 'dinero' | 'combustible'): inserta una entrante en
//     estado 'por_confirmar' (NO acredita saldo: eso lo hace el operador al
//     confirmar). Idempotente por transf_id (id global) → un reintento no duplica.
//   - 'transferencia' (recurso 'casiterita'): entra DIRECTO al inventario (almacén
//     de casiterita de Los Pinos), valuada a la tasa informada (PMP). Registra la
//     entrante en estado 'recibida' e idempotente por transf_id. Devuelve el ACK.
//   - 'ack': marca la transferencia SALIENTE local como 'recibida' (el otro
//     sistema confirmó la recepción).
//
// Secrets: INTER_SECRET · INTER_CAJA_ENTRANTE_ID (opcional: caja que recibe) ·
//   INTER_CASITERITA_ALMACEN (opcional: almacén destino; def. «SNO₂ CASITERITA ALMACEN») ·
//   INTER_CASITERITA_PRODUCTO_ID (opcional: producto casiterita; si no, se resuelve
//   por SKU MIN-CASITERITA / nombre-categoría «casiterita», y se crea si no existe).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los provee la plataforma.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-inter-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ───────── Casiterita: resolución de producto/almacén + entrada al inventario (PMP) ─────────
   Réplica del registrarMovimiento del front (PMP por almacén) para poder ingresar
   la casiterita desde el servidor, sin operador. */
const ALMACEN_CASI_DEFECTO = 'SNO₂ CASITERITA ALMACEN';
const SKU_CASI = 'MIN-CASITERITA';

async function resolverProductoCasiterita(supabase: SupabaseClient, almacen: string): Promise<string> {
  // 1) Secret explícito.
  const fijo = Deno.env.get('INTER_CASITERITA_PRODUCTO_ID');
  if (fijo) return fijo;
  // 2) Por SKU estándar (el mismo que usa el módulo de Recepciones).
  const bySku = await supabase.from('productos').select('id').eq('sku', SKU_CASI).maybeSingle();
  if (bySku.data?.id) return String((bySku.data as { id: string }).id);
  // 3) Por nombre/categoría que contenga «casiterita».
  const byNombre = await supabase.from('productos').select('id')
    .or('nombre.ilike.%casiterita%,categoria.ilike.%casiterita%').limit(1).maybeSingle();
  if (byNombre.data?.id) return String((byNombre.data as { id: string }).id);
  // 4) No existe: se crea (mismo criterio que el resguardo de recepciones).
  const nuevo = await supabase.from('productos').insert({
    sku: SKU_CASI, nombre: 'CASITERITA', categoria: 'MINERALES', unidad: 'KG',
    stock: 0, stock_min: 0, precio: 0, almacen, estado: 'activo',
  }).select('id').single();
  if (nuevo.error) throw new Error(`No se pudo crear el producto casiterita: ${nuevo.error.message}`);
  return String((nuevo.data as { id: string }).id);
}

/** Entrada al inventario replicando el PMP por almacén. Devuelve el id del movimiento. */
async function entrarCasiteritaInventario(
  supabase: SupabaseClient,
  input: { productoId: string; almacen: string; pesoKg: number; tasa: number | null; refId: string; detalle: string; actor: string; actorName: string | null },
): Promise<string> {
  const delta = num(input.pesoKg);
  // Existencia actual del almacén.
  const { data: exData, error: exErr } = await supabase.from('existencias')
    .select('stock, costo_promedio').eq('producto_id', input.productoId).eq('almacen', input.almacen).maybeSingle();
  if (exErr) throw exErr;
  const stockAntes = num((exData as { stock?: number } | null)?.stock);
  const costoAntes = num((exData as { costo_promedio?: number } | null)?.costo_promedio);
  const stockDespues = Math.max(0, stockAntes + delta);
  // PMP: solo entradas con costo informado (tasa) recalculan el costo del almacén.
  const precioUnit = input.tasa != null && Number.isFinite(Number(input.tasa)) && Number(input.tasa) >= 0 ? Number(input.tasa) : null;
  const aplicaPMP = delta > 0 && precioUnit != null;
  const totalQty = stockAntes + delta;
  const costoPromedio = aplicaPMP
    ? (totalQty <= 0 ? precioUnit! : round2((stockAntes * costoAntes + delta * precioUnit!) / totalQty))
    : costoAntes;
  // 1) Movimiento.
  const { data: mov, error: mErr } = await supabase.from('movimientos').insert({
    producto_id: input.productoId, tipo: 'entrada', delta, almacen: input.almacen,
    stock_antes: stockAntes, stock_despues: stockDespues,
    actor: input.actor, actor_name: input.actorName,
    ref_tipo: 'inter_casiterita', ref_id: input.refId, detalle: input.detalle,
    precio_unitario: precioUnit, costo_promedio: costoPromedio, at: new Date().toISOString(),
  }).select('id').single();
  if (mErr) throw mErr;
  // 2) Existencia del almacén (upsert).
  const { error: uErr } = await supabase.from('existencias').upsert(
    { producto_id: input.productoId, almacen: input.almacen, stock: stockDespues, costo_promedio: costoPromedio, updated_at: new Date().toISOString() },
    { onConflict: 'producto_id,almacen' },
  );
  if (uErr) throw uErr;
  // 3) Agregados del producto (stock total + costo global ponderado por existencias costadas).
  const { data: exsAll } = await supabase.from('existencias').select('stock, costo_promedio').eq('producto_id', input.productoId);
  const rows = (exsAll ?? []) as Array<{ stock: number | null; costo_promedio: number | null }>;
  const totalStock = rows.reduce((a, r) => a + num(r.stock), 0);
  const costadas = rows.filter((r) => num(r.costo_promedio) > 0);
  const stockCostado = costadas.reduce((a, r) => a + num(r.stock), 0);
  const valor = costadas.reduce((a, r) => a + num(r.stock) * num(r.costo_promedio), 0);
  const patch: Record<string, number> = { stock: totalStock };
  if (stockCostado > 0) patch.precio = round2(valor / stockCostado);
  await supabase.from('productos').update(patch).eq('id', input.productoId);
  return String((mov as { id: string }).id);
}

/** ACK al origen (best-effort): marca su saliente como recibida. */
async function enviarAck(callbackBase: string, transfId: string, recurso: string, secret: string): Promise<void> {
  try {
    await fetch(`${callbackBase.replace(/\/$/, '')}/transfer-recibir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-inter-secret': secret },
      body: JSON.stringify({ tipo: 'ack', transf_id: transfId, recurso }),
    });
  } catch { /* el ACK no bloquea la recepción */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = Deno.env.get('INTER_SECRET');
  if (!secret) return json({ error: 'INTER_SECRET no configurado en este sistema.' }, 500);
  if (req.headers.get('x-inter-secret') !== secret) return json({ error: 'No autorizado' }, 401);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: 'Body JSON inválido' }, 400); }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase env vars faltantes' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  const transfId = payload.transf_id as string | undefined;
  if (!transfId) return json({ error: 'transf_id requerido' }, 400);

  // El recurso determina la tabla/flujo: dinero (default) · combustible · casiterita.
  const recurso = payload.recurso === 'combustible' ? 'combustible'
    : payload.recurso === 'casiterita' ? 'casiterita' : 'dinero';
  const TABLE = recurso === 'combustible' ? 'transferencias_combustible_inter'
    : recurso === 'casiterita' ? 'transferencias_casiterita_inter' : 'transferencias_inter';

  // ── ACK: el otro sistema confirmó nuestra saliente ──
  if (payload.tipo === 'ack') {
    const { error } = await supabase.from(TABLE)
      .update({ estado: 'recibida', confirmada_at: new Date().toISOString() })
      .eq('transf_id', transfId).eq('direccion', 'saliente');
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, ack: true });
  }

  // ── Idempotencia: si ya existe esta transf_id, no reprocesar ──
  const { data: existe } = await supabase.from(TABLE).select('id, estado').eq('transf_id', transfId).maybeSingle();
  if (existe) return json({ ok: true, dedup: true, estado: (existe as { estado: string }).estado });

  // ── CASITERITA: entra DIRECTO al inventario (Los Pinos casiterita), valuada a la tasa ──
  if (recurso === 'casiterita') {
    const pesoKg = round2(num(payload.peso_kg ?? payload.pesoKg ?? payload.kg));
    if (pesoKg <= 0) return json({ error: 'peso_kg debe ser > 0' }, 400);
    const tasaRaw = payload.tasa ?? payload.costo_kg ?? null;
    const tasa = tasaRaw != null && Number.isFinite(Number(tasaRaw)) ? Number(tasaRaw) : null;
    const almacen = (Deno.env.get('INTER_CASITERITA_ALMACEN') || ALMACEN_CASI_DEFECTO).trim();
    const origen = String(payload.empresa_origen ?? 'sistema externo');
    const actor = String(payload.actor ?? 'puente-inter');
    const actorName = (payload.actor_name as string | undefined) ?? null;
    try {
      const productoId = await resolverProductoCasiterita(supabase, almacen);
      const movId = await entrarCasiteritaInventario(supabase, {
        productoId, almacen, pesoKg, tasa, refId: transfId,
        detalle: `Casiterita recibida del sistema externo${origen ? ` · ${origen}` : ''}${tasa != null ? ` a ${tasa} USD/Kg` : ''}`,
        actor, actorName,
      });
      const { error: insErr } = await supabase.from('transferencias_casiterita_inter').insert({
        transf_id: transfId, direccion: 'entrante', estado: 'recibida',
        empresa_origen: origen, empresa_destino: String(payload.empresa_destino ?? 'MGG'),
        peso_kg: pesoKg, tasa, almacen_destino: almacen, inventario_mov_id: movId,
        resumen: payload.resumen ?? null, motivo: payload.motivo ?? null,
        callback_base: payload.callback_base ?? null,
        actor, actor_name: actorName, confirmada_at: new Date().toISOString(),
      });
      if (insErr) {
        if ((insErr as { code?: string }).code === '23505') return json({ ok: true, dedup: true });
        return json({ error: insErr.message }, 500);
      }
      // ACK best-effort al origen (marca su saliente como recibida).
      if (payload.callback_base) await enviarAck(String(payload.callback_base), transfId, 'casiterita', secret);
      return json({ ok: true, recurso: 'casiterita', peso_kg: pesoKg, almacen, inventario_mov_id: movId });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'Error al ingresar casiterita' }, 500);
    }
  }

  // ── Dinero / Combustible: se guardan como entrante «por_confirmar» (el operador acredita) ──
  const base = {
    transf_id: transfId, direccion: 'entrante', estado: 'por_confirmar',
    empresa_origen: payload.empresa_origen ?? 'desconocido',
    empresa_destino: payload.empresa_destino ?? 'desconocido',
    resumen: payload.resumen ?? null, motivo: payload.motivo ?? null,
    callback_base: payload.callback_base ?? null,
    actor: payload.actor ?? null, actor_name: payload.actor_name ?? null,
  };

  const fila = recurso === 'combustible'
    ? {
        ...base,
        combustible_nombre: payload.combustible_nombre ?? 'Combustible',
        litros: payload.litros ?? 0,
        costo_litro: payload.costo_litro ?? null,
        // El tanque MGG que recibe lo elige el operador al confirmar.
      }
    : {
        ...base,
        caja_id: Deno.env.get('INTER_CAJA_ENTRANTE_ID') || null,
        legs: payload.legs ?? [],
      };

  const { error } = await supabase.from(TABLE).insert(fila);
  if (error) {
    // Si chocó por unicidad (carrera con otro reintento), es idempotencia OK.
    if ((error as { code?: string }).code === '23505') return json({ ok: true, dedup: true });
    return json({ error: error.message }, 500);
  }
  return json({ ok: true });
});
