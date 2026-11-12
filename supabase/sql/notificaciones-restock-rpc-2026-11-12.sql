-- ============================================================
-- 12-11-2026 · Alertas de stock (restock) desde la BASE, sin duplicados
--
-- Problema medido: 213 alertas «Stock crítico» sin leer para solo 19
-- productos (~11 copias c/u). El escaneo corría en el navegador de todo
-- usuario con Inventario; las alertas son destino 'admin' y la RLS no se las
-- deja ver a quien no es admin ⇒ su chequeo de duplicados salía vacío y las
-- volvía a insertar cada 30 min. Cada insert es además un evento de Realtime
-- que la base revisa contra todos los conectados. Y cada navegador bajaba la
-- tabla `productos` entera para escanear.
--
-- Arreglo:
--   1) Se borran las copias (queda la más reciente por producto).
--   2) Índice único: una sola alerta restock SIN LEER por clave.
--   3) RPC notif_escanear_stock(): escanea en la base (security definer),
--      inserta las que faltan (on conflict do nothing) y marca leídas las de
--      productos que ya volvieron sobre el mínimo.
-- ============================================================

-- 1) Copias sin leer: se conserva la más reciente de cada clave.
delete from public.notificaciones n
 using (
   select id, row_number() over (partition by dedup_key order by at desc, id desc) rn
     from public.notificaciones
    where not read and dedup_key like 'restock:%'
 ) d
 where n.id = d.id and d.rn > 1;

-- 2) Una sola alerta restock sin leer por clave.
create unique index if not exists ux_notif_restock_sin_leer
  on public.notificaciones (dedup_key)
  where (not read and dedup_key like 'restock:%');

-- 3) Escaneo en la base.
create or replace function public.notif_escanear_stock()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ins integer := 0;
begin
  if (select auth.uid()) is null or not public.puede_modulo('inventario', 'lectura') then
    return 0;
  end if;

  create temporary table if not exists _restock_need (k text primary key, crit boolean, sku text, nombre text, stock numeric, stock_min numeric) on commit drop;
  truncate _restock_need;
  insert into _restock_need
  select 'restock:' || case when coalesce(p.stock, 0) < p.stock_min then 'crit' else 'warn' end || ':' || p.id,
         coalesce(p.stock, 0) < p.stock_min, p.sku, p.nombre, coalesce(p.stock, 0), p.stock_min
    from public.productos p
   where p.estado = 'activo' and coalesce(p.stock_min, 0) > 0 and coalesce(p.stock, 0) <= p.stock_min;

  -- Ya se reabasteció (o cambió de nivel): la alerta vieja queda leída.
  update public.notificaciones n
     set read = true
   where not n.read and n.dedup_key like 'restock:%'
     and not exists (select 1 from _restock_need r where r.k = n.dedup_key);

  insert into public.notificaciones (destino, kind, title, message, link, dedup_key)
  select 'admin',
         (case when r.crit then 'error' else 'warning' end)::public.notif_kind,
         case when r.crit then '⚠ Stock crítico' else 'Reabastecimiento requerido' end,
         case when r.crit
           then r.sku || ' · ' || r.nombre || ': stock ' || trim_scale(r.stock)::text || ' POR DEBAJO del mínimo (' || trim_scale(r.stock_min)::text || ')'
           else r.sku || ' · ' || r.nombre || ': stock ' || trim_scale(r.stock)::text || ' ≤ mínimo ' || trim_scale(r.stock_min)::text
         end,
         '#/app/inventario',
         r.k
    from _restock_need r
  on conflict (dedup_key) where (not read and dedup_key like 'restock:%') do nothing;
  get diagnostics v_ins = row_count;
  return v_ins;
end;
$$;

revoke all on function public.notif_escanear_stock() from public, anon;
grant execute on function public.notif_escanear_stock() to authenticated;
