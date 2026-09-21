/* ============================================================
   MGG · Cocina · Conteo físico de abarrotes · Los Pinos — 21/09/2026

   Ajusta el inventario del almacén Los Pinos a lo que se contó en el depósito.

   TRES CRITERIOS, CONFIRMADOS ANTES DE TOCAR NADA
   1. «Kilos» = PAQUETES. El conteo dice «arroz 63 kilos» y el arroz viene en
      paquetes de 900 g: son 63 paquetes, no 70. Lo mismo la harina de trigo.
   2. Las pastas van a su FICHA ESPECÍFICA (tornillo, dedal, vermicelli) y las
      fichas genéricas PASTA CORTA y PASTA LARGA quedan en cero.
   3. Lo que NO se contó NO se toca. El conteo es de abarrotes: no trae carnes,
      hortalizas ni lácteos, así que la res, el pollo y las verduras quedan
      como estaban. Tomarlo como inventario completo habría borrado 402 kg de
      res que nadie contó.

   DOS RENGLONES QUE NO SON DEL CONTEO Y SE AJUSTAN IGUAL, POR SER HUEVOS
   El conteo dice 120 huevos. En el sistema hay DOS fichas de huevo: 332 en
   VIV-092 y 1.800 en VIV-094 (a costo cero, carga vieja). Entre las dos dan
   2.132. Los huevos SÍ están en el conteo, así que el total queda en 120:
   VIV-092 pasa a 120 y VIV-094 a cero.

   LO QUE NO SE PUDO AJUSTAR
   · «9 sobres de Carmencita de 100 g» — no existe ese producto en el sistema.
   · La pimienta se contó en sobres de 3 g y la ficha es de 20 g. Se cargan las
     24 unidades contadas, pero el gramaje de la ficha no coincide.

   Queda respaldo, un movimiento por ajuste con su motivo en el kardex, y la
   guarda de que nada puede quedar en negativo.
   ============================================================ */
begin;

/* ── 1) El conteo, tal como se recibió ────────────────────────────────── */
create temporary table _conteo (sku text primary key, contado numeric not null, nota text) on commit drop;
insert into _conteo (sku, contado, nota) values
  ('VIV-057',  63, 'Arroz blanco · 63 paquetes'),
  ('VIV-108',   4, 'Pasta corta tornillo · 4 kg'),
  ('VIV-109',   3, 'Pasta corta dedal · 3 kg'),
  ('VIV-067',   0, 'Pasta corta genérica · el stock pasa a las fichas específicas'),
  ('VIV-106',  12, 'Pasta larga vermicelli · 12 kg'),
  ('VIV-068',   0, 'Pasta larga genérica · el stock pasa a vermicelli'),
  ('VIV-079',  26, 'Atún · 26 unidades'),
  ('VIV-121',  11, 'Margarina · 11 unidades de 500 g'),
  ('VIV-122',   4, 'Vinagre · 4 litros'),
  ('VIV-080',  12, 'Azúcar blanca · 12 kg'),
  ('VIV-113',   8, 'Sal · 8 kg'),
  ('VIV-089',  20, 'Harina de trigo · 20 paquetes'),
  ('VIV-087',  43, 'Harina precocida blanca · 43 kg'),
  ('VIV-083',   9, 'Café · 9 unidades de 500 g'),
  ('VIV-092', 120, 'Huevos · 120 unidades'),
  ('VIV-094',   0, 'Huevos · segunda ficha, a costo cero: el total del conteo está en VIV-092'),
  ('VIV-002',  13, 'Aceite vegetal · 13 litros'),
  ('VIV-013',   1, 'Mayonesa · 1 unidad de 4 kg'),
  ('VIV-014',   1, 'Salsa de tomate · 1 unidad de 4 kg'),
  ('VIV-111',  24, 'Pimienta negra · 24 sobres (la ficha es de 20 g, el conteo de 3 g)'),
  ('VIV-059',  16, 'Caldo de pollo · 16 sobres de 17 g'),
  ('VIV-086',   5, 'Onoto · 5 sobres de 25 g'),
  ('VIV-123',   1, 'Salsa de soya · 1 envase'),
  ('VIV-124',   1, 'Salsa inglesa · 1 envase');

/* ── 2) Qué hay que mover ─────────────────────────────────────────────── */
create temporary table _ajuste on commit drop as
select p.id producto_id, p.sku, p.nombre, p.unidad,
       coalesce(e.stock, 0) antes,
       c.contado despues,
       round(c.contado - coalesce(e.stock, 0), 4) delta,
       coalesce(e.costo_promedio, 0) costo,
       c.nota
from _conteo c
join public.productos p on p.sku = c.sku
left join public.existencias e on e.producto_id = p.id and e.almacen = 'Los Pinos';

/* ── 3) Guardas ───────────────────────────────────────────────────────── */
do $$
declare faltan text; n int;
begin
  select string_agg(c.sku, ', ') into faltan
    from _conteo c where not exists (select 1 from _ajuste a where a.sku = c.sku);
  if faltan is not null then
    raise exception 'Estos SKU del conteo no existen en productos: %', faltan;
  end if;
  select count(*) into n from _ajuste where despues < 0;
  if n > 0 then raise exception 'El conteo trae % renglones negativos.', n; end if;
end $$;

/* ── 4) Respaldo ──────────────────────────────────────────────────────── */
create table if not exists public.cocina_conteo_pinos_2026_09_21 (
  producto_id uuid not null,
  sku text, nombre text, unidad text,
  almacen text not null default 'Los Pinos',
  stock_antes numeric not null,
  stock_despues numeric not null,
  delta numeric not null,
  nota text,
  aplicado_en timestamptz not null default now(),
  primary key (producto_id, almacen)
);
alter table public.cocina_conteo_pinos_2026_09_21 enable row level security;
revoke all on public.cocina_conteo_pinos_2026_09_21 from anon, public;
grant select on public.cocina_conteo_pinos_2026_09_21 to authenticated;
grant all on public.cocina_conteo_pinos_2026_09_21 to service_role;
drop policy if exists respaldo_lectura on public.cocina_conteo_pinos_2026_09_21;
create policy respaldo_lectura on public.cocina_conteo_pinos_2026_09_21
  for select to authenticated using (true);

insert into public.cocina_conteo_pinos_2026_09_21
      (producto_id, sku, nombre, unidad, stock_antes, stock_despues, delta, nota)
select producto_id, sku, nombre, unidad, antes, despues, delta, nota from _ajuste
on conflict (producto_id, almacen) do nothing;

/* ── 5) El movimiento en el kardex, con su motivo ─────────────────────── */
insert into public.movimientos
      (producto_id, tipo, delta, almacen, stock_antes, stock_despues,
       actor, actor_name, ref_tipo, detalle, costo_promedio, at)
select a.producto_id,
       (case when a.delta > 0 then 'entrada' else 'salida' end)::text::public.tipo_movimiento,
       a.delta, 'Los Pinos', a.antes, a.despues,
       'mineralgroupguayanaca@gmail.com', 'Administrador MGG', 'manual',
       'CONTEO FISICO LOS PINOS 21/09/2026 · ' || a.nota,
       a.costo, now()
from _ajuste a
where a.delta <> 0;

/* ── 6) La existencia del almacén ─────────────────────────────────────── */
insert into public.existencias (producto_id, almacen, stock, costo_promedio, updated_at)
select a.producto_id, 'Los Pinos', a.despues, a.costo, now()
from _ajuste a
where not exists (
  select 1 from public.existencias e where e.producto_id = a.producto_id and e.almacen = 'Los Pinos'
);

update public.existencias e
   set stock = a.despues, updated_at = now()
  from _ajuste a
 where e.producto_id = a.producto_id and e.almacen = 'Los Pinos' and a.delta <> 0;

/* ── 7) El total del producto (stock global y precio ponderado) ───────── */
with tocados as (select distinct producto_id from _ajuste where delta <> 0),
     agg as (
       select t.producto_id,
              coalesce(sum(e.stock), 0) total,
              sum(e.stock * e.costo_promedio) filter (where e.costo_promedio > 0) valor,
              sum(e.stock) filter (where e.costo_promedio > 0) stock_costado
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

/* ── 8) Nada en negativo ──────────────────────────────────────────────── */
do $$
declare neg int;
begin
  select count(*) into neg from public.existencias where almacen = 'Los Pinos' and stock < 0;
  if neg > 0 then raise exception 'Quedaron % existencias negativas en Los Pinos', neg; end if;
  select count(*) into neg from public.productos p
   where p.id in (select producto_id from _ajuste) and p.stock < 0;
  if neg > 0 then raise exception 'Quedaron % productos con stock negativo', neg; end if;
end $$;

commit;

select sku, nombre, unidad, stock_antes, stock_despues, delta
from public.cocina_conteo_pinos_2026_09_21 order by abs(delta) desc;
