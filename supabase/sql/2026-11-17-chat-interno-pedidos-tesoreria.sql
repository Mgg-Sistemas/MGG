-- Migration: Chat interno en Compras y Tesorería
-- Tablas normalizadas orden_mensajes y orden_chat_lecturas

create table if not exists public.orden_mensajes (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes(id) on delete cascade,
  autor_email text not null,
  autor_nombre text,
  mensaje text not null check (length(btrim(mensaje)) > 0),
  created_at timestamptz not null default now()
);

-- Migrar datos previos desde oc_mensajes si la tabla existía:
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'oc_mensajes') then
    insert into public.orden_mensajes (id, orden_id, autor_email, autor_nombre, mensaje, created_at)
    select id, orden_id, coalesce(autor_email, 'sistema@mgg.com'), autor_nombre, texto, created_at
    from public.oc_mensajes
    on conflict (id) do nothing;
  end if;
end $$;

create index if not exists idx_orden_mensajes_orden on public.orden_mensajes(orden_id, created_at);

alter table public.orden_mensajes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'orden_mensajes' and policyname = 'orden_mensajes read auth') then
    create policy "orden_mensajes read auth" on public.orden_mensajes for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'orden_mensajes' and policyname = 'orden_mensajes write') then
    create policy "orden_mensajes write" on public.orden_mensajes for insert with check (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'orden_mensajes' and policyname = 'orden_mensajes delete') then
    create policy "orden_mensajes delete" on public.orden_mensajes for delete using (
      auth.role() = 'authenticated' and (
        lower(coalesce(autor_email, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        or (select public.is_admin())
      )
    );
  end if;
end $$;

create table if not exists public.orden_chat_lecturas (
  orden_id uuid not null references public.ordenes(id) on delete cascade,
  usuario_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (orden_id, usuario_id)
);

create index if not exists idx_orden_chat_lecturas_user on public.orden_chat_lecturas(usuario_id, orden_id);

alter table public.orden_chat_lecturas enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'orden_chat_lecturas' and policyname = 'orden_chat_lecturas read auth') then
    create policy "orden_chat_lecturas read auth" on public.orden_chat_lecturas for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'orden_chat_lecturas' and policyname = 'orden_chat_lecturas write auth') then
    create policy "orden_chat_lecturas write auth" on public.orden_chat_lecturas for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- Realtime
do $$
begin
  alter publication supabase_realtime add table public.orden_mensajes;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.orden_chat_lecturas;
exception when others then null;
end $$;
