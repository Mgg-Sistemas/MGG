/* ============================================================
   Mineral Group Guayana · Web Push (cliente)
   Permite que la PWA reciba notificaciones push nativas y avisos del sistema:
   registra el service worker (public/sw.js), solicita permisos al usuario,
   gestiona la suscripción con la llave pública VAPID y almacena el estado en
   la tabla `push_subscriptions`.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

const VAPID_PUBLIC = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim();
const SW_URL = '/sw.js';

/** ¿El navegador soporta service worker + push + notificaciones? */
export function soportaPush(): boolean {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window;
}

export function estadoPermisoNotif(): NotificationPermission | 'no-soportado' {
  if (!soportaPush()) return 'no-soportado';
  return Notification.permission;
}

let registro: Promise<ServiceWorkerRegistration | null> | null = null;

/** Registra el service worker de push (idempotente, best-effort). Solo registra;
 *  NO pide permiso ni suscribe (eso va tras una acción del usuario). */
export function registrarServiceWorkerPush(): Promise<ServiceWorkerRegistration | null> {
  if (!soportaPush()) return Promise.resolve(null);
  if (!registro) {
    registro = navigator.serviceWorker.register(SW_URL).catch((e) => {
      console.warn('No se pudo registrar el service worker de push:', e);
      return null;
    });
  }
  return registro;
}

function urlB64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
  return arr;
}

export interface ResultadoActivar { ok: boolean; motivo?: string; }

export type ModuloNotifKey =
  | 'administracion'
  | 'contabilidad'
  | 'delivery'
  | 'inventario'
  | 'maquinaria'
  | 'combustible'
  | 'tesoreria'
  | 'cocina'
  | 'compras'
  | 'retenciones';

export interface ModuloNotifConfig {
  key: ModuloNotifKey;
  label: string;
  icono: string;
  hint: string;
}

export const MODULOS_NOTIFICACION: readonly ModuloNotifConfig[] = [
  { key: 'administracion', label: 'Administración', icono: '💼', hint: 'Vencimientos de documentos, licencias y permisos' },
  { key: 'contabilidad', label: 'Contabilidad', icono: '📒', hint: 'Comprobantes, cierres de mes y estados financieros' },
  { key: 'delivery', label: 'Delivery / Carga', icono: '🛵', hint: 'Nuevos pedidos por tomar, asignaciones y traslados' },
  { key: 'inventario', label: 'Almacén / Solicitudes', icono: '📦', hint: 'Solicitudes de pedido por revisar y stock mínimo' },
  { key: 'maquinaria', label: 'Maquinaria y Flota', icono: '🚜', hint: 'Mantenimientos por horas, servicios y averías' },
  { key: 'combustible', label: 'Combustible', icono: '⛽', hint: 'Surtidor de combustible y niveles bajos de tanques' },
  { key: 'tesoreria', label: 'Tesorería', icono: '🏦', hint: 'Cuentas por pagar, aprobaciones y movimientos' },
  { key: 'cocina', label: 'Cocina / Comidas', icono: '🍽️', hint: 'Reposición de mercado y comensales' },
  { key: 'compras', label: 'Compras / Pedidos', icono: '🛒', hint: 'Órdenes de compra nuevas y cotizaciones' },
  { key: 'retenciones', label: 'Retenciones / Facturas', icono: '🧾', hint: 'Facturas recibidas en buzón móvil y retenciones pendientes' },
];

const STORAGE_KEY_MODULOS_NOTIF = 'mgg.notif_modulos_activos';
const MODULOS_DEFECTO: Record<ModuloNotifKey, boolean> = {
  administracion: true,
  contabilidad: true,
  delivery: true,
  inventario: true,
  maquinaria: true,
  combustible: true,
  tesoreria: true,
  cocina: true,
  compras: true,
  retenciones: true,
};

let _modulosMemoria: Record<ModuloNotifKey, boolean> = { ...MODULOS_DEFECTO };

export function getModulosNotifActivos(): Record<ModuloNotifKey, boolean> {
  if (typeof window === 'undefined') return _modulosMemoria;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MODULOS_NOTIF);
    if (!raw) return { ...MODULOS_DEFECTO };
    const parsed = JSON.parse(raw) as Partial<Record<ModuloNotifKey, boolean>>;
    return { ...MODULOS_DEFECTO, ...parsed };
  } catch {
    return { ...MODULOS_DEFECTO };
  }
}

export function isModuloNotifActivo(key: ModuloNotifKey): boolean {
  const activos = getModulosNotifActivos();
  return activos[key] ?? true;
}

export function setModuloNotifActivo(key: ModuloNotifKey, activo: boolean): Record<ModuloNotifKey, boolean> {
  const actuales = getModulosNotifActivos();
  actuales[key] = activo;
  _modulosMemoria = actuales;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY_MODULOS_NOTIF, JSON.stringify(actuales));
    } catch { /* ignore */ }
  }
  return actuales;
}

export function setTodosModulosNotif(activo: boolean): Record<ModuloNotifKey, boolean> {
  const todos = (Object.keys(MODULOS_DEFECTO) as ModuloNotifKey[]).reduce((acc, k) => {
    acc[k] = activo;
    return acc;
  }, {} as Record<ModuloNotifKey, boolean>);
  _modulosMemoria = todos;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY_MODULOS_NOTIF, JSON.stringify(todos));
    } catch { /* ignore */ }
  }
  return todos;
}

export interface OpcionesWebPush {
  titulo: string;
  cuerpo: string;
  url?: string;
  modulo?: ModuloNotifKey;
  tag?: string;
  vibrar?: boolean;
}

/**
 * Emite una notificación push nativa en el dispositivo si el usuario tiene
 * el push habilitado y el módulo activo en sus ajustes.
 */
export async function emitirWebPush(opciones: OpcionesWebPush): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;

  // Si se especifica un módulo, verificar si el usuario tiene activas sus alertas
  if (opciones.modulo && !isModuloNotifActivo(opciones.modulo)) {
    return false;
  }

  if (Notification.permission === 'granted') {
    try {
      const url = opciones.url || '/';
      const tag = opciones.tag || (opciones.modulo ? `mgg-${opciones.modulo}` : 'mgg-alerta');
      const notificationOptions: NotificationOptions = {
        body: opciones.cuerpo,
        icon: '/android-chrome-192x192.png',
        badge: '/favicon-32x32.png',
        tag,
        data: { url },
      };

      if ('serviceWorker' in navigator) {
        const reg = (await navigator.serviceWorker.getRegistration(SW_URL)) || (await registrarServiceWorkerPush());
        if (reg && 'showNotification' in reg) {
          await reg.showNotification(opciones.titulo, notificationOptions);
          if (opciones.vibrar !== false && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
            try { navigator.vibrate([200, 100, 200]); } catch { /* ignore */ }
          }
          return true;
        }
      }

      new Notification(opciones.titulo, notificationOptions);
      if (opciones.vibrar !== false && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate([200, 100, 200]); } catch { /* ignore */ }
      }
      return true;
    } catch (e) {
      console.warn('Error al emitir notificación nativa:', e);
    }
  }
  return false;
}

const STORAGE_KEY_PUSH_HABILITADO = 'mgg.push_habilitado';
let _pushHabilitadoMemoria = true;

/** Comprueba si las notificaciones push en este dispositivo están habilitadas por el usuario */
export function isPushHabilitado(): boolean {
  if (!soportaPush()) return false;
  if (typeof window === 'undefined') return _pushHabilitadoMemoria;
  if (Notification.permission !== 'granted') return false;
  const pref = localStorage.getItem(STORAGE_KEY_PUSH_HABILITADO);
  return pref === null ? true : pref === '1';
}

/** Pide permiso, suscribe al push y guarda la suscripción. Idempotente. */
export async function activarNotificaciones(): Promise<ResultadoActivar> {
  if (!soportaPush()) return { ok: false, motivo: 'Este navegador no soporta notificaciones push.' };
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return { ok: false, motivo: 'No se concedió el permiso de notificaciones en el navegador.' };
  const reg = await registrarServiceWorkerPush();
  if (!reg) return { ok: false, motivo: 'No se pudo registrar el service worker.' };

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_PUSH_HABILITADO, '1');
  }

  if (VAPID_PUBLIC) {
    try {
      const previa = await reg.pushManager.getSubscription();
      const sub = previa ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC),
      });
      await guardarSuscripcion(sub);
    } catch (e) {
      console.warn('No se pudo suscribir al push remoto:', e);
    }
  }
  return { ok: true };
}

/** Alterna el switch de notificaciones push guardando preferencia y gestionando permisos/suscripción */
export async function togglePushHabilitado(habilitar: boolean): Promise<ResultadoActivar> {
  _pushHabilitadoMemoria = habilitar;
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_PUSH_HABILITADO, habilitar ? '1' : '0');
  }

  if (!soportaPush()) return { ok: false, motivo: 'Este navegador no soporta notificaciones push.' };

  if (habilitar) {
    return await activarNotificaciones();
  } else {
    await desactivarNotificaciones();
    return { ok: true };
  }
}

/** Envía una notificación nativa de prueba al dispositivo (con vibración) */
export async function probarNotificacionPush(): Promise<ResultadoActivar> {
  if (!soportaPush()) {
    return { ok: false, motivo: 'Este navegador no soporta notificaciones en este dispositivo.' };
  }

  if (Notification.permission !== 'granted') {
    const res = await activarNotificaciones();
    if (!res.ok) return res;
  }

  try {
    const reg = (await navigator.serviceWorker.getRegistration(SW_URL)) || (await registrarServiceWorkerPush());
    const titulo = '🔔 MGG · Notificación de prueba';
    const opciones: NotificationOptions = {
      body: 'Las notificaciones push en este dispositivo están funcionando correctamente.',
      icon: '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
      tag: 'mgg-push-test',
      data: { url: '/app/ajustes' },
    };

    if (reg && 'showNotification' in reg) {
      await reg.showNotification(titulo, opciones);
    } else {
      new Notification(titulo, opciones);
    }

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate([150, 80, 150]); } catch { /* ignore */ }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message : 'Error al mostrar la notificación.' };
  }
}

/** Cancela la suscripción de este dispositivo y la borra del servidor. */
export async function desactivarNotificaciones(): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_PUSH_HABILITADO, '0');
  }
  if (!soportaPush()) return;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await borrarSuscripcion(sub.endpoint);
    await sub.unsubscribe().catch(() => { /* best-effort */ });
  }
}

async function guardarSuscripcion(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const { data: auth } = await supabase.auth.getUser();
  const fila = {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? null,
    auth: json.keys?.auth ?? null,
    user_id: auth.user?.id ?? null,
    user_email: auth.user?.email ?? null,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  };
  try {
    const { error } = await supabase.from('push_subscriptions').upsert(fila, { onConflict: 'endpoint' });
    if (error) console.warn('No se guardó la suscripción push (¿tabla sin aplicar?):', error.message);
  } catch (e) {
    console.warn('No se guardó la suscripción push:', e);
  }
}

async function borrarSuscripcion(endpoint: string): Promise<void> {
  try { await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint); }
  catch { /* best-effort */ }
}
