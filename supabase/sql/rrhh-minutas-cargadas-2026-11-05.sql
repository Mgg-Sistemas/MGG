-- MGG · RRHH · Minutas ya hechas (05-11-2026): se cargan con su archivo (PDF o foto)
-- como adjunto. 'sistema' = hecha en el editor; 'cargada' = subida ya hecha.
alter table public.minutas add column if not exists origen text not null default 'sistema';
alter table public.minutas drop constraint if exists minutas_origen_chk;
alter table public.minutas add constraint minutas_origen_chk check (origen in ('sistema', 'cargada'));
create index if not exists minutas_numero_idx on public.minutas (numero);
