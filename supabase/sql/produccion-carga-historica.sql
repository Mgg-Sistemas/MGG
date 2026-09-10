alter table produccion
  add column if not exists descontar_inventario boolean not null default true;

comment on column produccion.descontar_inventario is
  'false = carga historica: los materiales NO se descuentan del inventario (la colada ya ocurrio y el stock de hoy ya lo refleja).';

select count(*) filter (where descontar_inventario) as descuentan,
       count(*) filter (where not descontar_inventario) as historicas
from produccion;
