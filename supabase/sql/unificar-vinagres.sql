-- ============================================================
-- MGG · Inventario · Los seis vinagres se vuelven uno
--
-- Habia seis fichas del mismo producto, en tres unidades distintas.
-- Sobrevive VIV-122 VINAGRE, en LITRO, que es el que se creo desde la
-- solicitud de mercado. Las otras cinco se convierten a litros y se dan
-- de baja.
--
-- Los factores los confirmo el usuario: el envase GRANDE y el GALON son
-- los dos de 5 litros. El VALOR EN DOLARES se conserva exacto ($43,68):
-- lo que cambia es la unidad en que se cuenta, no lo que vale.
--
--   VIV-072 VINAGRE 1 LTS       x1 L    1 en La Esperanza
--   VIV-073 VINAGRE GRANDE      x5 L    2 en Los Pinos
--   VIV-117 VINAGRE 5L          x5 L    1 Los Pinos + 1 La Esperanza
--   VIV-118 VINAGRE 5L GALON    x5 L    2,5 en Los Pinos
--   VIV-119 VINAGRE DTORINO 5L  x5 L    sin existencias
--   -> VIV-122 VINAGRE: 33,5 L a $1,3040 el litro
--
-- El kardex de las cinco (14 movimientos) se muda al que sobrevive,
-- convertido a litros y con una nota que dice de donde vino cada uno.
--
-- Aplicado en produccion el 09/09/2026.
-- ============================================================
begin;

create temp table vmap(sku text primary key, f numeric) on commit drop;
insert into vmap values ('VIV-072',1),('VIV-073',5),('VIV-117',5),('VIV-118',5),('VIV-119',5);

create temp table vsrc on commit drop as
  select p.id, p.sku, p.nombre, v.f from productos p join vmap v on v.sku = p.sku;

create temp table vdst on commit drop as
  select id from productos where sku = 'VIV-122';

create temp table vex on commit drop as
  select e.almacen,
         sum(e.stock * s.f) as litros,
         sum(e.stock * e.costo_promedio) as valor,
         avg(e.costo_promedio / s.f) as costo_l_ref
  from existencias e join vsrc s on s.id = e.producto_id
  group by e.almacen;

update movimientos m set
  producto_id = (select id from vdst),
  delta = m.delta * s.f,
  stock_antes = m.stock_antes * s.f,
  stock_despues = m.stock_despues * s.f,
  precio_unitario = m.precio_unitario / s.f,
  costo_promedio = m.costo_promedio / s.f,
  detalle = coalesce(m.detalle, '') || ' · unificado desde ' || s.sku || ' ' || s.nombre || ' (x' || s.f || ' L)'
from vsrc s where s.id = m.producto_id;

delete from existencias where producto_id in (select id from vsrc);

insert into existencias (producto_id, almacen, stock, costo_promedio, updated_at)
select (select id from vdst), almacen, litros,
       case when litros > 0 then valor / litros else coalesce(costo_l_ref, 0) end, now()
from vex
on conflict (producto_id, almacen) do update
  set stock = excluded.stock, costo_promedio = excluded.costo_promedio, updated_at = now();

update productos set
  stock = (select coalesce(sum(litros), 0) from vex),
  precio_promedio = (select case when sum(litros) > 0 then sum(valor) / sum(litros) end from vex),
  precio = (select case when sum(litros) > 0 then round(sum(valor) / sum(litros), 4) else 0 end from vex),
  almacen = (select almacen from vex order by litros desc nulls last limit 1),
  updated_at = now()
where id = (select id from vdst);

update productos set
  estado = 'inactivo',
  stock = 0,
  desactivado_en = now(),
  desactivado_por = 'mineralgroupguayanaca@gmail.com',
  desactivado_motivo = 'Unificado en VIV-122 VINAGRE (litros)',
  updated_at = now()
where id in (select id from vsrc);

select p.sku, p.nombre, p.unidad, p.estado::text as estado, p.stock,
       round(p.precio_promedio, 4) as costo_l, p.almacen,
       (select count(*) from movimientos m where m.producto_id = p.id) as movs
from productos p where p.nombre ilike '%vinagre%' order by p.sku;

commit;
