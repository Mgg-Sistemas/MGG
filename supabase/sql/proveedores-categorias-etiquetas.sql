/* Proveedores · categorías como ETIQUETAS PUNTUALES (18-09-2026).
   Varias «categorías» eran la descripción o la propaganda del proveedor (hasta 207 caracteres).
   Cada una pasa a 1-2 etiquetas cortas; se unifican duplicados (SILICON/SILICONES, TORNILLO/S,
   DISCO/S DE CORTE…) y errores (PLANTAS ELECTRICAAS, HIGUIENE, CONTRUCCION).
   Respaldo de lo anterior: proveedores_categorias_respaldo_2026_09_18. */
begin;
create table if not exists public.proveedores_categorias_respaldo_2026_09_18 as
  select id, razon_social, categorias, now() as respaldado_en from public.proveedores where false;
alter table public.proveedores_categorias_respaldo_2026_09_18 enable row level security;
revoke all on public.proveedores_categorias_respaldo_2026_09_18 from anon, authenticated;
insert into public.proveedores_categorias_respaldo_2026_09_18
  select id, razon_social, categorias, now() from public.proveedores
  where categorias is not null and cardinality(categorias) > 0
    and not exists (select 1 from public.proveedores_categorias_respaldo_2026_09_18 r where r.id = proveedores.id);

-- viejo → etiquetas nuevas. por_prefijo = las tres frases de propaganda, que se reconocen por su comienzo.
create temp table mapa_cat (viejo text, por_prefijo boolean, nuevas text[]) on commit drop;
insert into mapa_cat values
  ('HERRAMIENTAS Y MAS.', false, array['HERRAMIENTAS']),
  ('VENTA DE RODAMIENTOS', false, array['RODAMIENTOS']),
  ('AUTOREPUESTOS DE CAMIONES Y UTILIARIOS', false, array['AUTOREPUESTOS']),
  ('VENTA DE ELECTRODOMESTICOS', false, array['ELECTRODOMESTICOS']),
  ('CHARCUTERIA AL MAYOR Y DETAL', false, array['CHARCUTERIA']),
  ('EQUIPOS DE SEGURIDAD INDUSTRIAL', false, array['SEGURIDAD INDUSTRIAL']),
  ('Lubricantes', false, array['LUBRICANTES']),
  ('Maquinaria', false, array['MAQUINARIA']),
  ('Repuestos', false, array['REPUESTOS']),
  ('MANTENIMIENTO DE BOTELLONES', false, array['BOTELLONES']),
  ('PAPELERIA EN GENERAL AL MAYOR Y DETAL', false, array['PAPELERIA']),
  ('RECARGA DE BOMBONAS DE GAS', false, array['GAS']),
  ('RECARGA DE BOTELLONES', false, array['BOTELLONES']),
  ('SERVICIO DE CAMION CISTERNA', false, array['CISTERNA']),
  ('VENTA DE CORREAS', false, array['CORREAS']),
  ('VENTA DE TELEFONOS Y ACCESORIOS PARA CELULARES', false, array['TELEFONOS']),
  ('VENTA DE VIVERES', false, array['VIVERES']),
  ('ALQUILER TRAILERS', false, array['TRAILERS']),
  ('ASESORAMIENTO TECNICO.', false, array['ASESORIA TECNICA']),
  ('CAMIONES Y CARROS ARTICULADO JUMBO Y RETROEXCAVADORA', false, array['CAMIONES', 'MAQUINARIA PESADA']),
  ('CAMISAS JERSEY MANGA LARGA', false, array['UNIFORMES']),
  ('CHUMACERAS Y RODAMIENTOS', false, array['CHUMACERAS', 'RODAMIENTOS']),
  ('CISTERNA DE AGUA', false, array['CISTERNA']),
  ('COMBUSTIBLE Y DE AIRE', false, array['FILTROS']),
  ('COMBUSTIBLE Y DE AIRE PARA GANDOLA TRAKKER', false, array['FILTROS']),
  ('CONSUMIBLES Y MAQUINARIA DE ', true, array['SOLDADURA']),
  ('CONTRATISTAS Y GRANDES INDUSTRIAS', true, array['ELECTRODOS']),
  ('EQUIPOS Y SUMINISTROS LIDERES PARA LA INDUSTRIA DE LA SOLDADURA', true, array['SOLDADURA']),
  ('DISCO DE CORTE', false, array['DISCOS DE CORTE']),
  ('DISCO DE ESMERIL', false, array['DISCOS DE ESMERIL']),
  ('ELECTRODO', false, array['ELECTRODOS']),
  ('ETC.', false, array[]::text[]),
  ('FABRICACION DE CARTELERAS ACRILICAS', false, array['CARTELERAS']),
  ('FABRICACION DE PRODUCTOS QUIMICOS DOMESTICOS E INDUSTRIAL', false, array['PRODUCTOS QUIMICOS']),
  ('GENERADORES Y MAQUINARIAS VENTA DE FILTROS INDUSTRIALES', false, array['GENERADORES', 'FILTROS']),
  ('GRAPAS PARA EMPALMES', false, array['GRAPAS']),
  ('GRAPAS PARA EMPALMES.', false, array['GRAPAS']),
  ('HIGUIENE', false, array['HIGIENE']),
  ('INGENIERIA Y CONSTRUCCION', false, array['INGENIERIA', 'CONSTRUCCION']),
  ('INSUMOS MINEROS ( OREJAS DE MARTILLO)', false, array['INSUMOS MINEROS']),
  ('LIBRERIA Y MAS.', false, array['LIBRERIA']),
  ('LUBRICANTES TODO PARA MAQUINARIAS', false, array['LUBRICANTES']),
  ('MASCARILLAS Y BOTAS', false, array['MASCARILLAS', 'BOTAS DE SEGURIDAD']),
  ('MATERIALES DE CONTRUCCION', false, array['CONSTRUCCION']),
  ('MAZOS DE MARTILLOS', false, array['MARTILLOS']),
  ('MOTORES TRIFASICOS Y MONOFASICOS', false, array['MOTORES ELECTRICOS']),
  ('MULTISERVICIOS DE DESMALEZADORAS', false, array['DESMALEZADORAS']),
  ('PANTALONES Y BOTAS DE SEGURIDAD', false, array['UNIFORMES', 'BOTAS DE SEGURIDAD']),
  ('PLANTAS ELECTRICAAS', false, array['PLANTAS ELECTRICAS']),
  ('PRODUCTOS FERRETEROS E INDUSTRIALES', false, array['FERRETERIA']),
  ('REALIZACION DE SELLOS VALLAS PUBLICITARIAS', false, array['SELLOS', 'PUBLICIDAD']),
  ('REPUESTOS DE CAMIONES IVECO', false, array['REPUESTOS IVECO']),
  ('REVISION Y REPARACION DE MOTOSIERRAS', false, array['MOTOSIERRAS']),
  ('SERVICIO DE MANTTO Y REPARACION DE GATO POWER BOMBA HIDRAULICA', false, array['HIDRAULICA']),
  ('SERVICIO TECNICO DE RADIOS', false, array['RADIOS']),
  ('SILICON', false, array['SILICONES']),
  ('TIENDA DE COMPUTACIÓN', false, array['COMPUTACION']),
  ('TINTAS DE IMPRESORA', false, array['TINTAS']),
  ('TODO EN FILTROS PARA VEHICULOS', false, array['FILTROS']),
  ('FILTROS DE ACEITE', false, array['FILTROS']),
  ('TORNILLO', false, array['TORNILLOS']),
  ('TUBERIAS Y SOLDADURAS Y LIMPIADORES', false, array['TUBERIAS', 'SOLDADURA']),
  ('TUBOS ANGULOS', false, array['TUBOS', 'ANGULOS']),
  ('VENTA DE ACEITES', false, array['ACEITES']),
  ('VENTA DE EQUIPOS', false, array['EQUIPOS']),
  ('VENTA DE FILTROS', false, array['FILTROS']),
  ('VENTA DE FILTROS PARA MAQUINARIAS Y CARROS MARCA DONALDSON', false, array['FILTROS']),
  ('VENTA DE LITERAS', false, array['LITERAS']),
  ('VENTA DE TINTAS PARA IMPRESORA EPSON ORIGINALES', false, array['TINTAS']),
  ('VENTA DE VENTILADORES CON ASPAS', false, array['VENTILADORES']),
  ('VENTA DE VIVERES Y EMBUTIDOS NACIONAL E IMPORTADOS AL MAYOR Y DETAL', false, array['VIVERES', 'CHARCUTERIA']),
  ('VENTA ORIGINAL DE EQUIPOS PARA KOMATZU', false, array['REPUESTOS KOMATSU']),
  ('VENTAS', false, array[]::text[]),
  ('VENTAS AL MAYOR Y DETAL DE VIVERES Y CHARCUTERIA', false, array['VIVERES', 'CHARCUTERIA']),
  ('VIVERES Y PRODUCTOS AL MAYOR Y DETAL', false, array['VIVERES']),
  ('LAMINAS DE HIERRO NEGRO', false, array['LAMINAS DE HIERRO']);

-- Cada categoría se reemplaza por sus etiquetas nuevas (o se conserva); sin repetidas, en su orden.
update public.proveedores p set categorias = t.nuevas
from (
  select p2.id,
    coalesce((select array_agg(y.e order by y.o) from (
      select x.e, min(x.o) o from (
        select e, u.ord o
        from unnest(p2.categorias) with ordinality u(c, ord)
        left join lateral (
          select m.nuevas from mapa_cat m
          where (not m.por_prefijo and m.viejo = u.c) or (m.por_prefijo and u.c like m.viejo || '%')
          limit 1
        ) m on true,
        unnest(coalesce(m.nuevas, array[u.c])) e
      ) x group by x.e) y), '{}') nuevas
  from public.proveedores p2
  where exists (
    select 1 from unnest(p2.categorias) c join mapa_cat m
      on (not m.por_prefijo and m.viejo = c) or (m.por_prefijo and c like m.viejo || '%'))
) t
where p.id = t.id;

-- Catálogo compartido: fuera los valores viejos, adentro las etiquetas nuevas.
delete from public.taxonomias t using mapa_cat m
 where t.scope = 'proveedor.categoria'
   and ((not m.por_prefijo and t.valor = m.viejo) or (m.por_prefijo and t.valor like m.viejo || '%'));
insert into public.taxonomias (scope, valor, created_by)
  select distinct 'proveedor.categoria', e, 'limpieza-etiquetas' from mapa_cat, unnest(nuevas) e
  on conflict (scope, valor) do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.proveedores, unnest(categorias) c where length(c) > 40;
  if n > 0 then raise exception 'Quedan % categorías de más de 40 caracteres', n; end if;
end $$;
commit;

select json_build_object(
  'distintas', (select count(distinct c) from public.proveedores, unnest(categorias) c),
  'mas_larga', (select max(length(c)) from public.proveedores, unnest(categorias) c),
  'respaldo', (select count(*) from public.proveedores_categorias_respaldo_2026_09_18));
