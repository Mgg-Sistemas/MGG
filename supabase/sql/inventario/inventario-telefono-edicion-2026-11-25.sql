-- ============================================================
-- Módulo: inventario
-- Archivo: inventario-telefono-edicion-2026-11-25.sql
-- Estado: APLICADO EN PRODUCCIÓN (25-11-2026 · anon=false, authenticated=true)
-- ------------------------------------------------------------
-- Edición aditiva de salidas del teléfono ya registradas.
-- No borra movimientos ni salidas, no cambia RLS ni abre UPDATE directo:
-- la escritura sigue pasando por una función con inv_tel_puede_escribir().
-- El ajuste de stock lo registra la app en movimientos; esta función solo
-- corrige la ficha SAT y valida su coherencia con los retornos.
-- ============================================================

create or replace function public.inv_tel_editar_salida(p jsonb)
returns public.inventario_salidas_telefono
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.inventario_salidas_telefono;
  v_prod public.productos;
  v_id uuid := (p->>'id')::uuid;
  v_producto uuid := (p->>'producto_id')::uuid;
  v_cant numeric := round(coalesce((p->>'cantidad')::numeric, 0), 4);
  v_motivo text := btrim(coalesce(p->>'motivo', ''));
  v_solicitante text := btrim(coalesce(p->>'autorizado_por', ''));
  v_almacen text := btrim(coalesce(p->>'almacen', ''));
  v_retorna boolean := coalesce((p->>'retorna')::boolean, false);
  v_esperado text := nullif(btrim(coalesce(p->>'actualizado_esperado', '')), '');
begin
  if not public.inv_tel_puede_escribir() then
    raise exception 'No tienes permiso de escritura en Inventario.' using errcode = '42501';
  end if;

  select * into v_s from public.inventario_salidas_telefono where id = v_id for update;
  if v_s.id is null then raise exception 'No se encontró la salida.' using errcode = '23503'; end if;
  if v_esperado is not null and v_s.updated_at <> v_esperado::timestamptz then
    raise exception 'Otra persona cambió esta salida mientras la editabas. Volvé a abrirla antes de guardar.' using errcode = 'P0001';
  end if;

  select * into v_prod from public.productos where id = v_producto;
  if v_prod.id is null then raise exception 'No se encontró el material.' using errcode = '23503'; end if;
  if v_cant <= 0 then raise exception 'La cantidad debe ser mayor que 0.' using errcode = '23514'; end if;
  if char_length(v_motivo) < 3 then raise exception 'Escribe el motivo de la salida.' using errcode = '23514'; end if;
  if v_solicitante = '' then raise exception 'Indica quién solicitó el material.' using errcode = '23514'; end if;
  if v_almacen = '' then raise exception 'Falta el almacén.' using errcode = '23514'; end if;
  if v_cant < v_s.retornado then
    raise exception 'Ya retornaron %; la cantidad no puede quedar por debajo.', v_s.retornado using errcode = '23514';
  end if;
  if v_s.retornado > 0 and not v_retorna then
    raise exception 'La salida ya tiene retornos y no se puede marcar «No retorna».' using errcode = '23514';
  end if;
  if v_s.retornado > 0 and v_s.producto_id <> v_producto then
    raise exception 'No se puede cambiar el material después de un retorno.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.movimientos m
    where m.ref_id = v_s.id::text and m.equipo_id is not null
  ) and (v_s.producto_id <> v_producto or v_s.cantidad <> v_cant or v_s.almacen <> v_almacen) then
    raise exception 'Esta salida está vinculada a Maquinaria: solo se puede editar motivo y solicitante desde aquí.' using errcode = 'P0001';
  end if;

  update public.inventario_salidas_telefono
     set producto_id = v_prod.id,
         producto_nombre = v_prod.nombre,
         unidad = v_prod.unidad,
         cantidad = v_cant,
         motivo = v_motivo,
         autorizado_por = v_solicitante,
         almacen = v_almacen,
         retorna = v_retorna,
         estado = case
           when not v_retorna then 'sin_retorno'
           when v_s.retornado >= v_cant then 'retornada'
           else 'por_retornar'
         end,
         updated_at = now()
   where id = v_s.id
  returning * into v_s;
  return v_s;
end $$;

revoke all on function public.inv_tel_editar_salida(jsonb) from public, anon;
grant execute on function public.inv_tel_editar_salida(jsonb) to authenticated;

-- Cotejo (después de aplicar):
-- select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'inv_tel_editar_salida';
-- select has_function_privilege('anon', 'public.inv_tel_editar_salida(jsonb)'::regprocedure, 'execute') as anon_puede; -- debe ser false
