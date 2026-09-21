/* ============================================================
   MGG · Cocina · Doble descuento por comidas cargadas tarde — 21/09/2026

   QUÉ PASÓ
   El 14/09/2026 se hizo un CONTEO REAL en Los Pinos y en La Esperanza: el
   stock quedó en lo que de verdad había en el depósito, y ese conteo ya
   reflejaba las comidas servidas del 11 al 14. El mercado #2 abrió el
   15/09 tomando ese stock como saldo inicial.

   Días después (17 y 19/09) se cargaron al sistema 19 comidas atrasadas,
   con fecha del 11 al 14 de septiembre. Esas comidas volvieron a descontar
   la misma mercancía: el conteo físico ya la había descontado una vez.

   Resultado: el depósito quedó corto y el libro del mercado, que por fecha
   no cuenta esas comidas, quedó por encima. De ahí el aviso «según el
   inventario quedan … · diferencia −154,1 en 23 víveres» de Los Pinos.

   QUÉ HACE ESTE SCRIPT
   Devuelve al inventario exactamente lo que esas comidas descontaron de
   más: 154,10 unidades en Los Pinos y 57,11 en La Esperanza, en 35 pares
   producto/almacén. Las comidas NO se borran: se sirvieron y son historia
   del mercado #1. Lo único que se corrige es el inventario.

   Queda respaldo en `cocina_doble_descuento_2026_09` y un movimiento de
   entrada por cada corrección, con su motivo, visible en el kardex.
   ============================================================ */
begin;

/* ── 1) Qué comidas son y cuánto descontaron de más ───────────────────── */
create temporary table _corr on commit drop as
with mercado as (
  select mc.cocina_id, mc.created_at as abierto, mc.fecha_inicio
  from public.mercados_cocina mc
  where mc.estado = 'abierto'
), tardias as (
  -- Cargadas DESPUÉS de abrir el mercado, pero con fecha ANTERIOR a su inicio.
  select cc.codigo
  from mercado m
  join public.cocina_comidas cc on cc.cocina_id = m.cocina_id
  where cc.created_at >= m.abierto and cc.at < m.fecha_inicio::timestamptz
)
select mv.producto_id,
       mv.almacen,
       round(-sum(mv.delta), 4) as devolver   -- neto: la edición de una comida ya vino con su reverso
from public.movimientos mv
where mv.ref_tipo = 'cocina'
  and mv.ref_codigo in (select codigo from tardias)
group by mv.producto_id, mv.almacen
having -sum(mv.delta) > 0;

/* ── 2) Guarda: el script corrige ESTO y nada más ─────────────────────── */
do $$
declare n int; pinos numeric; esperanza numeric;
begin
  select count(*), coalesce(sum(devolver) filter (where almacen='Los Pinos'), 0),
                   coalesce(sum(devolver) filter (where almacen='La Esperanza'), 0)
    into n, pinos, esperanza from _corr;
  if n <> 35 then raise exception 'Se esperaban 35 correcciones y hay %', n; end if;
  if round(pinos,2) <> 154.10 then raise exception 'Los Pinos: se esperaban 154,10 y da %', pinos; end if;
  if round(esperanza,2) <> 57.11 then raise exception 'La Esperanza: se esperaban 57,11 y da %', esperanza; end if;
end $$;

/* ── 3) Respaldo, antes de tocar nada ─────────────────────────────────── */
create table if not exists public.cocina_doble_descuento_2026_09 (
  producto_id uuid not null,
  sku text,
  nombre text,
  unidad text,
  almacen text not null,
  devuelto numeric not null,
  stock_antes numeric not null,
  stock_despues numeric not null,
  aplicado_at timestamptz not null default now(),
  primary key (producto_id, almacen)
);
alter table public.cocina_doble_descuento_2026_09 enable row level security;
revoke all on public.cocina_doble_descuento_2026_09 from anon, public;
grant select on public.cocina_doble_descuento_2026_09 to authenticated;
grant all on public.cocina_doble_descuento_2026_09 to service_role;
drop policy if exists respaldo_lectura on public.cocina_doble_descuento_2026_09;
create policy respaldo_lectura on public.cocina_doble_descuento_2026_09
  for select to authenticated using (true);

insert into public.cocina_doble_descuento_2026_09
      (producto_id, sku, nombre, unidad, almacen, devuelto, stock_antes, stock_despues)
select c.producto_id, p.sku, p.nombre, p.unidad, c.almacen, c.devolver,
       coalesce(e.stock, 0), coalesce(e.stock, 0) + c.devolver
from _corr c
join public.productos p on p.id = c.producto_id
left join public.existencias e on e.producto_id = c.producto_id and e.almacen = c.almacen
on conflict (producto_id, almacen) do nothing;

/* ── 4) El movimiento de entrada, con su motivo, en el kardex ─────────── */
insert into public.movimientos
      (producto_id, tipo, delta, almacen, stock_antes, stock_despues,
       actor, actor_name, ref_tipo, detalle, costo_promedio, at)
select c.producto_id, 'entrada', c.devolver, c.almacen,
       coalesce(e.stock, 0), coalesce(e.stock, 0) + c.devolver,
       'mineralgroupguayanaca@gmail.com', 'Administrador MGG', 'manual',
       'Ajuste · devolución del doble descuento de las comidas del 11 al 14/09 cargadas tarde (el conteo real del 14/09 ya las había descontado)',
       coalesce(e.costo_promedio, 0), now()
from _corr c
left join public.existencias e on e.producto_id = c.producto_id and e.almacen = c.almacen;

/* ── 5) La existencia del almacén ─────────────────────────────────────── */
insert into public.existencias (producto_id, almacen, stock, costo_promedio, updated_at)
select c.producto_id, c.almacen, c.devolver, 0, now()
from _corr c
where not exists (
  select 1 from public.existencias e
  where e.producto_id = c.producto_id and e.almacen = c.almacen
);

update public.existencias e
   set stock = e.stock + c.devolver, updated_at = now()
  from _corr c
 where e.producto_id = c.producto_id and e.almacen = c.almacen
   and e.stock is distinct from e.stock + c.devolver;

/* ── 6) El total del producto (stock global y precio ponderado) ───────── */
with tocados as (select distinct producto_id from _corr),
     agg as (
       select t.producto_id,
              coalesce(sum(e.stock), 0) as total,
              sum(e.stock * e.costo_promedio) filter (where e.costo_promedio > 0) as valor,
              sum(e.stock) filter (where e.costo_promedio > 0) as stock_costado
       from tocados t
       left join public.existencias e on e.producto_id = t.producto_id
       group by t.producto_id
     )
update public.productos p
   set stock = a.total,
       precio = case when coalesce(a.stock_costado, 0) > 0
                     then round(a.valor / a.stock_costado, 2) else p.precio end
  from agg a
 where p.id = a.producto_id;

/* ── 7) Nada puede quedar en negativo ─────────────────────────────────── */
do $$
declare neg int;
begin
  select count(*) into neg
    from public.existencias e join _corr c using (producto_id, almacen)
   where e.stock < 0;
  if neg > 0 then raise exception 'Quedaron % existencias en negativo', neg; end if;

  select count(*) into neg from public.productos p
   where p.id in (select producto_id from _corr) and p.stock < 0;
  if neg > 0 then raise exception 'Quedaron % productos con stock negativo', neg; end if;
end $$;

commit;

/* ── Cómo quedó ───────────────────────────────────────────────────────── */
select r.almacen, r.sku, r.nombre, r.unidad, r.devuelto, r.stock_antes, e.stock as stock_ahora
from public.cocina_doble_descuento_2026_09 r
join public.existencias e on e.producto_id = r.producto_id and e.almacen = r.almacen
order by r.almacen, r.devuelto desc;
