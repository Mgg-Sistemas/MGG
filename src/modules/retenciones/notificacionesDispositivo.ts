/* ============================================================
   MGG · Retenciones · Notificaciones en Pantalla / Móvil
   (Web Notifications API + Vibración + Sonido + Título de Pestaña)

   100% Web Nativo: NO requiere instalar ninguna app ni archivo
   en el dispositivo móvil. Funciona directamente en Google Chrome,
   Safari (iOS 16.4+), Edge y navegadores móviles.
   Alineado 1:1 con la arquitectura de Golden Touch (GT).
   ============================================================ */

import { playSonidoFacturaLlegada } from './notificacionesRetencion';

const PREF_AVISOS_PANTALLA = 'mgg.retenciones.avisos_pantalla';

let _avisosMemoria = true;
let _intervaloTitulo: number | null = null;
let _tituloOriginal: string | null = null;

/** Comprueba si el navegador actual soporta la API nativa de notificaciones */
export function isNotificacionesSoportadas(): boolean {
  if (typeof window === 'undefined') return false;
  return 'Notification' in window;
}

/** Devuelve el estado actual de los permisos del navegador */
export function getEstadoPermisoNotificacion(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!isNotificacionesSoportadas()) return 'unsupported';
  try {
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

/** Comprueba si el usuario tiene activados los avisos en pantalla en este equipo */
export function isAvisosPantallaHabilitados(): boolean {
  if (typeof window === 'undefined') return _avisosMemoria;
  try {
    const v = localStorage.getItem(PREF_AVISOS_PANTALLA);
    return v === null ? true : v === '1';
  } catch {
    return _avisosMemoria;
  }
}

/** Guarda la preferencia del usuario en el navegador */
export function setAvisosPantallaHabilitados(habilitado: boolean): void {
  _avisosMemoria = habilitado;
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREF_AVISOS_PANTALLA, habilitado ? '1' : '0');
  } catch {
    // Si cookies/storage están restringidas
  }
}

/**
 * Solicita permiso al sistema operativo/navegador para mostrar avisos en pantalla.
 * No instala nada; solo activa el permiso nativo del navegador.
 */
export async function solicitarPermisoAvisos(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (!isNotificacionesSoportadas()) return 'unsupported';

  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      setAvisosPantallaHabilitados(true);
    }
    return perm;
  } catch (e) {
    console.warn('Error al solicitar permiso de notificación:', e);
    return 'unsupported';
  }
}

/**
 * Detiene el parpadeo del título de la pestaña cuando el usuario vuelve a enfocar.
 */
export function detenerAlertaTitulo(): void {
  if (typeof window === 'undefined') return;
  if (_intervaloTitulo !== null) {
    window.clearInterval(_intervaloTitulo);
    _intervaloTitulo = null;
  }
  if (_tituloOriginal && typeof document !== 'undefined') {
    document.title = _tituloOriginal;
    _tituloOriginal = null;
  }
}

/**
 * Hace parpadear el título de la pestaña si la ventana está minimizada o en segundo plano.
 */
export function activarAlertaTitulo(textoAviso: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (_intervaloTitulo !== null) return; // ya activo

  _tituloOriginal = document.title;
  let alternar = false;

  _intervaloTitulo = window.setInterval(() => {
    document.title = alternar ? textoAviso : (_tituloOriginal || 'MGG · Retenciones');
    alternar = !alternar;
  }, 1000);

  // Al hacer foco o clic en la ventana, restablecer título
  const limpiar = () => {
    detenerAlertaTitulo();
    window.removeEventListener('focus', limpiar);
    window.removeEventListener('click', limpiar);
  };
  window.addEventListener('focus', limpiar);
  window.addEventListener('click', limpiar);
}

export interface FacturaAvisoInput {
  id?: string;
  empresa?: string;
  empresaNombre?: string;
  proveedorNombre?: string;
  numeroFactura?: string;
  montoTotal?: number;
  moneda?: string;
}

/**
 * Dispara una alerta integral cuando llega una nueva factura (Idéntica a GT):
 * 1. Campanilla de audio distintiva de Retenciones (Do5 → Mi5 → Sol5).
 * 2. Vibración táctil del dispositivo móvil (2 pulsos cortos: 200ms vibra, 100ms pausa, 200ms vibra).
 * 3. Parpadeo en el título de la pestaña si el navegador está minimizado o en otra pestaña.
 * 4. Banner nativo en barra de estado del móvil/PC (si el usuario autorizó los avisos en el navegador).
 */
export function lanzarAvisoFactura(
  fac: FacturaAvisoInput,
  opciones?: { conSonido?: boolean }
): void {
  // 1. Sonido distintivo fiscal (si aplica)
  if (opciones?.conSonido !== false) {
    try {
      playSonidoFacturaLlegada();
    } catch {
      /* AudioContext restringido */
    }
  }

  // 2. Vibración táctil en móvil (200ms vibra, 100ms pausa, 200ms vibra)
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([200, 100, 200]);
    } catch {
      /* Silenciar si la política del navegador restringe vibración */
    }
  }

  // 3. Si no están habilitados los avisos en pantalla en las preferencias del usuario, detener aquí
  if (!isAvisosPantallaHabilitados()) return;

  const empresa = fac.empresa || fac.empresaNombre || 'Empresa';
  const proveedor = fac.proveedorNombre || 'Proveedor';
  const moneda = fac.moneda || 'USD';
  const monto = fac.montoTotal ?? 0;
  const montoFmt = Number(monto).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const titulo = `🧾 Factura Recibida · ${empresa}`;
  const cuerpo = `${proveedor}\nFactura: ${fac.numeroFactura || 'S/N'} · ${moneda === 'USD' ? '$' : 'Bs'} ${montoFmt}`;

  // 4. Parpadeo en el título de la pestaña (visible aun con la pestaña en segundo plano)
  activarAlertaTitulo(`(1) 🧾 ${empresa}: ${proveedor}`);

  // 5. Notificación nativa del sistema operativo (sin instalar nada)
  if (isNotificacionesSoportadas() && Notification.permission === 'granted') {
    try {
      const notif = new Notification(titulo, {
        body: cuerpo,
        icon: '/image.jpeg',
        badge: '/image.jpeg',
        tag: fac.id ? `mgg-factura-${fac.id}` : 'mgg-factura-nueva',
      });

      notif.onclick = () => {
        if (typeof window !== 'undefined') {
          window.focus();
        }
        notif.close();
      };
    } catch {
      /* Si el navegador restringe Notification() por política de contexto */
    }
  }
}

