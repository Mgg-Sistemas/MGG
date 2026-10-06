import { supabase } from '@/shared/lib/supabase';

export type RoleKey = string;
export type ModuleKey =
  | 'dashboard'
  | 'pedidos'
  | 'proveedores'
  | 'inventario'
  | 'deposito'
  | 'produccion'
  | 'refinacion'
  | 'salidas'
  | 'cocina'
  | 'combustible'
  | 'acopio'
  | 'acopio_reporte'
  | 'acopio_gmt'
  | 'acopio_peramanal'
  | 'acopio_esmeralda'
  | 'acopio_pijiguaos'
  | 'maquinaria'
  | 'ventas'
  | 'tesoreria'
  | 'retenciones'
  | 'recepciones'
  | 'rrhh'
  | 'asignaciones'
  | 'usuarios'
  | 'auditoria'
  | 'ajustes';

export interface ModulePermission {
  lectura: boolean;
  escritura: boolean;
  full: boolean;
}

export type RolePermisos = Record<ModuleKey, ModulePermission>;
export type AllPermisos = Record<RoleKey, RolePermisos>;

/** Lista canónica de módulos del sistema. Fuente única para la matriz, el menú y los guards.
 *  `path` (opcional) = ruta bajo `/app/` cuando NO coincide con la key (submódulos anidados). */
export const MODULES: { key: ModuleKey; label: string; path?: string }[] = [
  { key: 'dashboard',   label: 'Dashboard' },
  { key: 'pedidos',     label: 'Pedidos / Compras' },
  { key: 'proveedores', label: 'Proveedores' },
  { key: 'inventario',  label: 'Inventario' },
  { key: 'deposito',    label: 'Depósito', path: 'deposito' },
  { key: 'produccion',  label: 'Fundición' },
  { key: 'refinacion',  label: 'Refinación de Material', path: 'refinacion' },
  { key: 'salidas',     label: 'Salidas / Traslados' },
  { key: 'cocina',      label: 'Control de Alimentación (Cocina)' },
  { key: 'combustible', label: 'Combustible' },
  { key: 'acopio',          label: 'C. Costo · La Esperanza' },
  { key: 'acopio_reporte',  label: 'C. Costo · Reporte Preliminar', path: 'acopio/reporte-preliminar' },
  { key: 'acopio_gmt',      label: 'C. Costo · Global Mineral TIN', path: 'acopio/global-mineral-tin' },
  { key: 'acopio_peramanal',label: 'C. Costo · Peramanal (Ender Mejías)', path: 'acopio/peramanal-ender' },
  { key: 'acopio_esmeralda',label: 'C. Costo · La Esmeralda (Alí)', path: 'acopio/esmeralda-ali' },
  { key: 'acopio_pijiguaos',label: 'C. Costo · Los Pijiguaos', path: 'acopio/los-pijiguaos' },
  { key: 'maquinaria',  label: 'Control de Maquinaria y Vehículos' },
  { key: 'ventas',      label: 'Ventas' },
  { key: 'tesoreria',   label: 'Tesorería' },
  { key: 'retenciones', label: 'Retenciones' },
  { key: 'recepciones', label: 'Recepciones' },
  { key: 'rrhh',        label: 'RRHH / Nómina' },
  { key: 'asignaciones',label: 'Asignaciones al Personal' },
  { key: 'usuarios',    label: 'Usuarios' },
  { key: 'auditoria',   label: 'Auditoría de Usuarios' },
  { key: 'ajustes',     label: 'Ajustes' },
];

/** Ruta bajo `/app/` de un módulo (usa `path` si está; si no, la propia key). */
export function modulePath(key: ModuleKey): string {
  return MODULES.find((m) => m.key === key)?.path ?? key;
}

/* ───────────────────── El surtidor, que solo usa el teléfono ─────────────────────
   El rol `combustible` es el del muchacho que surte en la mina: carga lo que
   despacha desde el teléfono, con botones grandes, y no tiene nada que hacer en
   el módulo de escritorio —ni en el libro mayor del tanque, ni en los costos, ni
   en los catálogos—. Por eso entra directo a la vista de teléfono y el menú le
   muestra esa, no la otra.

   La clave y la ruta viven acá, con el resto de los permisos, y no adentro de la
   pantalla: el redirector de inicio necesita saberlo antes de cargar ningún
   módulo de combustible, y hacerlo al revés obligaba a bajar el chunk entero del
   escritorio nada más que para rebotar. */

/** El rol que trabaja SOLO desde la vista de teléfono del surtidor. */
export const ROL_SURTIDOR: RoleKey = 'combustible';

/** A dónde entra ese rol, bajo `/app/`. */
export const RUTA_SURTIDOR = 'combustible/surtidor';

/** ¿Este rol vive en la vista de teléfono? */
export function esRolSurtidor(role: RoleKey | null | undefined): boolean {
  return (role ?? '').trim().toLowerCase() === ROL_SURTIDOR;
}

/* ───────────── El cocinero, que también usa solo el teléfono (02-10-2026) ─────────────
   Mismo molde que el surtidor: el rol `cocina` carga desayuno, almuerzo y cena
   desde el celular (personas, consumo, fotos, WhatsApp) y no tiene nada que hacer
   en el módulo de escritorio, que es donde la analista verifica y corrige. */

/** El rol que trabaja SOLO desde la vista de teléfono de Alimentación. */
export const ROL_COCINA: RoleKey = 'cocina';

/** A dónde entra ese rol, bajo `/app/`. */
export const RUTA_COCINA_TELEFONO = 'cocina/telefono';

/** ¿Este rol vive en la vista de teléfono de la cocina? */
export function esRolCocina(role: RoleKey | null | undefined): boolean {
  return (role ?? '').trim().toLowerCase() === ROL_COCINA;
}

/* ───────────── Inventario desde el teléfono (06-10-2026) ─────────────
   Traída del «Depósito Mina» de Golden Touch: producto nuevo y entradas en el
   almacén elegido, con botones grandes. La habilita el permiso de Inventario. */

/** El rol que vive SOLO en la vista de teléfono de Inventario (si se crea). */
export const ROL_INVENTARIO_TELEFONO: RoleKey = 'almacen_telefono';

/** A dónde entra, bajo `/app/`. */
export const RUTA_INVENTARIO_TELEFONO = 'inventario/telefono';

/* ───────────── Las vistas de teléfono, en UN solo registro (02-10-2026) ─────────────
   Pedido de la administradora: una persona de teléfono puede necesitar varias
   pantallas (el que carga combustible también sirve la comida). Los accesos ya
   no dependen del rol sino de los PERMISOS: quien tenga el módulo marcado ve su
   vista de teléfono. Para montar una vista nueva basta agregarla acá; el menú, el
   inicio y los atajos entre vistas la toman solos. */

/** Una pantalla pensada para el celular. */
export interface VistaTelefono {
  /** Módulo cuyo permiso de lectura la habilita. */
  modulo: ModuleKey;
  /** Ruta bajo `/app/`. */
  ruta: string;
  icono: string;
  label: string;
  /** El rol que vive SOLO en esta vista (entra ahí y no ve el escritorio). */
  rolPropio: RoleKey;
}

export const VISTAS_TELEFONO: readonly VistaTelefono[] = [
  { modulo: 'combustible', ruta: RUTA_SURTIDOR, icono: '⛽', label: 'Surtidor', rolPropio: ROL_SURTIDOR },
  { modulo: 'cocina', ruta: RUTA_COCINA_TELEFONO, icono: '🍳', label: 'Comidas', rolPropio: ROL_COCINA },
  { modulo: 'inventario', ruta: RUTA_INVENTARIO_TELEFONO, icono: '📦', label: 'Inventario', rolPropio: ROL_INVENTARIO_TELEFONO },
];

/**
 * ¿Este rol trabaja desde el teléfono? FALLBACK por nombre (surtidor, cocina),
 * para cuando la marca `solo_telefono` del rol no se pudo leer. La que manda es
 * la marca, que vive en `custom_roles` y llega por `usePermissions().soloTelefono`.
 */
export function esRolDeTelefono(role: RoleKey | null | undefined): boolean {
  const r = (role ?? '').trim().toLowerCase();
  return VISTAS_TELEFONO.some((v) => v.rolPropio === r);
}

/**
 * Las vistas de teléfono que le tocan a alguien según sus PERMISOS. La del rol
 * propio va primera (es a la que entra); las demás, en el orden del registro.
 */
export function vistasTelefonoDe(role: RoleKey | null | undefined, permitidos: ModuleKey[]): VistaTelefono[] {
  const r = (role ?? '').trim().toLowerCase();
  const propias = VISTAS_TELEFONO.filter((v) => v.rolPropio === r && permitidos.includes(v.modulo));
  const otras = VISTAS_TELEFONO.filter((v) => v.rolPropio !== r && permitidos.includes(v.modulo));
  return [...propias, ...otras];
}

/**
 * A dónde mandar a alguien que acaba de entrar.
 *
 * Un rol marcado «solo teléfono» va a su vista de celular aunque ese no sea su
 * primer módulo: para él, el módulo ES la vista de teléfono. Si tiene varias,
 * entra a la de su rol propio (o a la primera del registro) y las demás quedan
 * en el menú. `soloTelefono` es la marca del rol; sin ella se cae al nombre.
 */
export function rutaDeInicio(role: RoleKey | null | undefined, permitidos: ModuleKey[], soloTelefono?: boolean | null): string {
  if (soloTelefono ?? esRolDeTelefono(role)) {
    const vista = vistasTelefonoDe(role, permitidos)[0];
    if (vista) return `/app/${vista.ruta}`;
  }
  const primero = permitidos[0];
  return primero ? `/app/${modulePath(primero)}` : '/app/sin-acceso';
}

export const emptyPermission: ModulePermission = { lectura: false, escritura: false, full: false };

/** Permisos por defecto de un rol cuando la matriz aún no tiene fila guardada en BD. */
export function defaultsFor(role: RoleKey): RolePermisos {
  const all: RolePermisos = MODULES.reduce<RolePermisos>((acc, m) => {
    acc[m.key] = { ...emptyPermission };
    return acc;
  }, {} as RolePermisos);

  if (role === 'admin') {
    MODULES.forEach((m) => (all[m.key] = { lectura: true, escritura: true, full: true }));
  } else if (role === 'analista') {
    (['dashboard', 'pedidos', 'proveedores', 'inventario', 'deposito', 'produccion', 'refinacion', 'salidas', 'combustible', 'cocina', 'ajustes'] as ModuleKey[]).forEach((k) => {
      all[k] = { lectura: true, escritura: true, full: false };
    });
    all.usuarios = { lectura: true, escritura: false, full: false };
    all.tesoreria = { lectura: true, escritura: false, full: false };
    all.retenciones = { lectura: true, escritura: true, full: false };
    all.recepciones = { lectura: true, escritura: true, full: false };
    all.rrhh = { lectura: true, escritura: true, full: false };
    all.asignaciones = { lectura: true, escritura: true, full: false };
  } else if (role === ROL_SURTIDOR) {
    // Solo combustible, y en la práctica solo la vista de teléfono: el módulo de
    // escritorio lo rebota a `/app/combustible/surtidor`. Escritura porque su
    // trabajo ES cargar lo que surte; sin ella la pantalla no sirve de nada.
    all.combustible = { lectura: true, escritura: true, full: false };
  } else if (role === ROL_COCINA) {
    // Solo Alimentación, y en la práctica solo la vista de teléfono: el módulo de
    // escritorio lo rebota a `/app/cocina/telefono`. Escritura porque su trabajo
    // ES cargar las comidas.
    all.cocina = { lectura: true, escritura: true, full: false };
  } else if (role === 'obrero') {
    all.dashboard  = { lectura: true, escritura: false, full: false };
    all.pedidos    = { lectura: true, escritura: true, full: false };
    all.inventario = { lectura: true, escritura: true, full: false };
    all.deposito   = { lectura: true, escritura: true, full: false };
    all.produccion = { lectura: true, escritura: true, full: false };
    all.refinacion = { lectura: true, escritura: true, full: false };
    all.ajustes    = { lectura: true, escritura: false, full: false };
  } else {
    all.dashboard = { lectura: true, escritura: false, full: false };
  }
  return all;
}

/** Rellena los módulos faltantes de una fila parcial con `emptyPermission`. */
export function normalizeRolePermisos(stored: Partial<RolePermisos>): RolePermisos {
  return MODULES.reduce<RolePermisos>((acc, m) => {
    acc[m.key] = { ...emptyPermission, ...stored[m.key] };
    return acc;
  }, {} as RolePermisos);
}

const TABLE = 'roles_permisos';

interface Row {
  role: RoleKey;
  permisos: RolePermisos;
  updated_at?: string;
  updated_by?: string | null;
}

export async function loadPermisos(): Promise<AllPermisos | null> {
  const { data, error } = await supabase.from(TABLE).select('role, permisos');
  if (error) throw error;
  if (!data || !data.length) return null;
  return (data as Row[]).reduce<AllPermisos>((acc, row) => {
    acc[row.role] = row.permisos;
    return acc;
  }, {} as AllPermisos);
}

/** Carga la matriz de permisos de un rol concreto. `null` si la fila aún no existe. */
export async function loadRolePermisos(role: RoleKey): Promise<RolePermisos | null> {
  const { data, error } = await supabase.from(TABLE).select('permisos').eq('role', role).maybeSingle();
  if (error) throw error;
  return (data?.permisos as RolePermisos | undefined) ?? null;
}

/** Persiste los permisos de UN solo rol (autoguardado por celda en la matriz). */
export async function savePermisosRole(
  role: RoleKey,
  permisos: RolePermisos,
  actorEmail: string,
): Promise<void> {
  const { error } = await supabase.from(TABLE).upsert(
    { role, permisos, updated_at: new Date().toISOString(), updated_by: actorEmail },
    { onConflict: 'role' },
  );
  if (error) throw error;
}

export async function savePermisos(all: AllPermisos, actorEmail: string): Promise<void> {
  const rows = Object.keys(all).map((role) => ({
    role,
    permisos: all[role],
    updated_at: new Date().toISOString(),
    updated_by: actorEmail,
  }));
  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'role' });
  if (error) throw error;
}

export async function eliminarPermisosRol(role: RoleKey): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('role', role);
  if (error) throw error;
}
