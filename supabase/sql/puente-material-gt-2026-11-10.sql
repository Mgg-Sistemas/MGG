-- 10/11/2026 · Puente inter-sistema de MATERIAL: Almacén Los Pinos de GT («General»)
-- → Almacén Los Pinos de MGG. Pedido de la administradora: «tengo productos en GT
-- que necesito en MGG Los Pinos».
--
-- Flujo: en GT se eligen productos y cantidades; salen del inventario de GT (salida
-- tipo transferencia, ref_tipo 'material_inter') y la transferencia SALIENTE se empuja
-- a MGG (transfer-enviar → transfer-recibir, recurso 'material'). En MGG queda
-- ENTRANTE «por_confirmar»: el almacenista empareja cada renglón con un producto de
-- MGG (o lo crea), y al aceptar entra al Almacén Los Pinos con el costo de GT (PMP).
-- MGG avisa por ACK (resultado 'recibida' | 'rechazada'). Si MGG rechaza, GT puede
-- devolver la mercancía a su inventario.
--
-- `transf_id` es el id GLOBAL compartido por los dos lados → idempotencia.
-- La MISMA tabla existe en los dos sistemas (cambia solo la política de escritura).

create table if not exists public.transferencias_material_inter (
  id uuid primary key default gen_random_uuid(),
  transf_id uuid not null unique,
  direccion text not null check (direccion in ('saliente', 'entrante')),
  estado text not null check (estado in ('enviada', 'por_confirmar', 'recibida', 'rechazada', 'error', 'devuelta')),
  empresa_origen text,
  empresa_destino text,
  almacen_origen text,
  almacen_destino text,
  -- [{ producto_id, sku, nombre, unidad, categoria, cantidad, costo_unitario,
  --    destino_producto_id?, destino_sku?, destino_nombre?, destino_mov_id? }]
  items jsonb not null default '[]'::jsonb,
  total_usd numeric,
  resumen text,
  motivo text,
  callback_base text,
  mensaje_error text,
  actor text,
  actor_name text,
  created_at timestamptz not null default now(),
  confirmada_at timestamptz,
  confirmada_por text,
  rechazo_motivo text,
  devuelta_at timestamptz,
  devuelta_por text
);

create index if not exists transferencias_material_inter_estado_idx
  on public.transferencias_material_inter (direccion, estado, created_at desc);

alter table public.transferencias_material_inter enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'transferencias_material_inter' and policyname = 'transf material read auth') then
    create policy "transf material read auth" on public.transferencias_material_inter
      for select using ((select auth.role()) = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'transferencias_material_inter' and policyname = 'transf material write') then
    -- MGG: escritura del personal operativo (mismo criterio que existencias).
    create policy "transf material write" on public.transferencias_material_inter
      for all using ((select is_operativo()))
      with check ((select is_operativo()));
  end if;
end $p$;

-- Tiempo real (multiusuario).
do $r$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'transferencias_material_inter') then
    alter publication supabase_realtime add table public.transferencias_material_inter;
  end if;
end $r$;
