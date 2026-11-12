/* ============================================================
   MGG · Usuarios autorizados (lógica pura, sin Supabase)
   Roles y Permisos › «Usuarios autorizados para:». Cada usuario de
   la lista puede aprobar Órdenes de Compra, Órdenes de Salida, o
   ambas, y tiene su firma cargada para estamparla en lo que aprueba.
   La lista vive en memoria (la carga `useAutorizados`) para que las
   comprobaciones de permiso sean síncronas en toda la app.
   ============================================================ */

export type PermisoAutorizado = 'oc' | 'salidas' | 'despachos';

export interface UsuarioAutorizado {
  email: string;
  aprobar_oc: boolean;
  aprobar_salidas: boolean;
  /** 11-11-2026 · Ventas (flujo de GT): aprueba despachos («¿Se despacha?»). */
  aprobar_despachos?: boolean;
  /** Firma manuscrita: PNG con fondo transparente como data URL. */
  firma: string | null;
  firma_w: number | null;
  firma_h: number | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

/** Opciones que se le pueden dar a un usuario autorizado. */
export const OPCIONES_AUTORIZACION: { key: PermisoAutorizado; label: string; icono: string }[] = [
  { key: 'oc', label: 'APROBAR ÓRDENES DE COMPRA', icono: '🛒' },
  { key: 'salidas', label: 'APROBAR ÓRDENES DE SALIDA', icono: '📤' },
  { key: 'despachos', label: 'APROBAR DESPACHOS DE VENTAS', icono: '🚚' },
];

const norm = (e?: string | null) => (e ?? '').trim().toLowerCase();

let lista: UsuarioAutorizado[] | null = null;
const subs = new Set<() => void>();

/** Reemplaza la lista en memoria y avisa a quien la escuche. `null` = aún no cargada. */
export function setAutorizados(l: UsuarioAutorizado[] | null): void {
  lista = l;
  subs.forEach((f) => f());
}
export function getAutorizados(): UsuarioAutorizado[] | null { return lista; }
export function subscribeAutorizados(f: () => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}

/** Ficha del usuario autorizado con ese correo (o null). */
export function autorizadoDe(email?: string | null, l: UsuarioAutorizado[] | null = lista): UsuarioAutorizado | null {
  const e = norm(email);
  if (!e || !l) return null;
  return l.find((a) => norm(a.email) === e) ?? null;
}

/**
 * ¿El correo está autorizado para ese permiso? `null` si la lista todavía
 * no se cargó (quien llama decide qué hacer mientras tanto).
 */
export function autorizadoPara(
  email: string | null | undefined, permiso: PermisoAutorizado, l: UsuarioAutorizado[] | null = lista,
): boolean | null {
  if (!l) return null;
  const a = autorizadoDe(email, l);
  if (!a) return false;
  if (permiso === 'oc') return a.aprobar_oc;
  if (permiso === 'salidas') return a.aprobar_salidas;
  return !!a.aprobar_despachos;
}

/** Texto corto de lo que puede hacer: «Compras», «Salidas», «Compras y salidas». */
export function resumenAutorizacion(a: Pick<UsuarioAutorizado, 'aprobar_oc' | 'aprobar_salidas' | 'aprobar_despachos'>): string {
  let base = '';
  if (a.aprobar_oc && a.aprobar_salidas) base = 'Aprueba compras y salidas';
  else if (a.aprobar_oc) base = 'Aprueba órdenes de compra';
  else if (a.aprobar_salidas) base = 'Aprueba órdenes de salida';
  if (a.aprobar_despachos) return base ? `${base} · despachos de ventas` : 'Aprueba despachos de ventas';
  return base || 'Sin autorizaciones';
}
