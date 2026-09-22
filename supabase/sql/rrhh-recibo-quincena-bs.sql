-- ════════════════════════════════════════════════════════════════
-- RRHH · El recibo de pago, como se lleva de verdad
--
-- La nómina se venía llevando en una planilla. Estas columnas son lo que el
-- sistema no tenía y el recibo sí exige:
--
--  · dias_descanso   — el recibo cuenta los días en DOS renglones, trabajados
--                      y de descanso. Se pagan los dos al mismo sueldo diario,
--                      pero tienen que verse aparte.
--  · viaticos        — renglón propio del devengado.
--  · deduc_rpe       — Régimen Prestacional de Empleo.
--  · deduc_sindicato — Sindicato.
--  · deduc_otros     — el renglón "Otros" del recibo.
--
-- Las demás ya existían: dias_trabajados, asignaciones (bonos extra),
-- deduc_ivss, deduc_faov, deduc_prestamos, deduc_anticipos.
--
-- La TASA no va acá: vive en `nomina_periodos.tasa_bcv`, una sola para toda
-- la quincena. Es a propósito: un recibo firmado en septiembre no puede
-- cambiar de monto porque el dólar se movió en octubre.
--
-- Todas entran con DEFAULT 0 y NOT NULL, así los renglones que ya existen
-- quedan válidos sin tocarlos y ningún cálculo se topa con un null.
-- ════════════════════════════════════════════════════════════════

alter table public.nomina_renglones
  add column if not exists dias_descanso   numeric not null default 0,
  add column if not exists viaticos        numeric not null default 0,
  add column if not exists deduc_rpe       numeric not null default 0,
  add column if not exists deduc_sindicato numeric not null default 0,
  add column if not exists deduc_otros     numeric not null default 0;

comment on column public.nomina_renglones.dias_descanso is
  'Dias de descanso de la quincena. Van en un renglon aparte del recibo aunque se paguen al mismo sueldo diario que los trabajados.';
comment on column public.nomina_renglones.viaticos is
  'Viaticos de la quincena (devengado, renglon propio del recibo).';

-- Verificación
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'nomina_renglones'
  and column_name in ('dias_trabajados','dias_descanso','viaticos','asignaciones',
                      'deduc_ivss','deduc_rpe','deduc_faov','deduc_sindicato',
                      'deduc_prestamos','deduc_anticipos','deduc_otros')
order by column_name;
