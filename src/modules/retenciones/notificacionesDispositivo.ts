/* ============================================================
   Golden Touch · Retenciones · Notificaciones en Pantalla / Móvil
   (Web Notifications API + Vibración + Sonido + Título de Pestaña)

   100% Web Nativo: NO requiere instalar ninguna app ni archivo
   en el dispositivo móvil. Funciona directamente en Google Chrome,
   Safari (iOS 16.4+), Edge y navegadores móviles.
   ============================================================ */

import { reproducirSonidoFacturaNueva } from './soundRetenciones';
import type { FacturaExternaBuzon } from './facturasBuzon.repository';
import { registrarServiceWorkerPush } from '@/shared/lib/webpush';

const PREF_AVISOS_PANTALLA = 'gt.retenciones.avisos_pantalla';

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
  const v = localStorage.getItem(PREF_AVISOS_PANTALLA);
  return v === null ? true : v === '1';
}

/** Guarda la preferencia del usuario en el navegador */
export function setAvisosPantallaHabilitados(habilitado: boolean): void {
  _avisosMemoria = habilitado;
  if (typeof window === 'undefined') return;
  localStorage.setItem(PREF_AVISOS_PANTALLA, habilitado ? '1' : '0');
}

/**
 * Solicita permiso al sistema operativo/navegador para mostrar avisos en pantalla.
 * No instala nada; solo activa el permiso nativo del navegador.
 */
export async function solicitarPermisoAvisos(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (!isNotificacionesSoportadas()) return 'unsupported';

  try {
    // Asegurar registro del Service Worker en navegadores móviles/PWA
    void registrarServiceWorkerPush();
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
function activarAlertaTitulo(textoAviso: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (_intervaloTitulo !== null) return; // ya activo

  _tituloOriginal = document.title;
  let alternar = false;

  _intervaloTitulo = window.setInterval(() => {
    document.title = alternar ? textoAviso : (_tituloOriginal || 'Golden Touch');
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

/**
 * Dispara una alerta integral cuando llega una nueva factura:
 * 1. Banner nativo en barra de estado del móvil/PC (si hay permiso).
 * 2. Vibración del dispositivo móvil (2 pulsos cortos).
 * 3. Campanilla de audio distintiva de Retenciones.
 * 4. Parpadeo en el título de la pestaña si el navegador está minimizado.
 */
export function lanzarAvisoFactura(
  fac: Partial<FacturaExternaBuzon> & { id?: string },
  opciones?: { conSonido?: boolean }
): void {
  // 1. Sonido distintivo (si aplica)
  if (opciones?.conSonido !== false) {
    reproducirSonidoFacturaNueva();
  }

  // 2. Vibración táctil en móvil (200ms vibra, 100ms pausa, 200ms vibra)
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([200, 100, 200]);
    } catch {
      /* Silenciar si la política del navegador restringe vibración */
    }
  }

  // 3. Si no están habilitados los avisos en pantalla, detener aquí
  if (!isAvisosPantallaHabilitados()) return;

  const empresa = fac.empresaNombre || 'Empresa';
  const proveedor = fac.proveedorNombre || 'Proveedor';
  // En bolívares si se puede (es lo que se informa); si no, en dólares.
  const enBs = fac.moneda !== 'USD' || (fac.montoBs ?? 0) > 0;
  const monto = (enBs && fac.moneda === 'USD' ? fac.montoBs : fac.montoTotal) ?? 0;
  const montoFmt = Number(monto).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const numero = fac.facturaNumero?.trim() || '—';
  const titulo = `🧾 Factura recibida · ${empresa}`;
  const cuerpo = `${proveedor}\nFactura: ${numero} · ${enBs ? 'Bs' : '$'} ${montoFmt}`;

  // 4. Parpadeo en el título de la pestaña (visible aun con la pestaña en segundo plano)
  activarAlertaTitulo(`(1) 🧾 ${empresa}: ${proveedor}`);

  // 5. Notificación nativa del sistema operativo (móvil y escritorio)
  if (isNotificacionesSoportadas() && Notification.permission === 'granted') {
    const notifOptions: NotificationOptions = {
      body: cuerpo,
      icon: '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
      tag: fac.id ? `gt-factura-${fac.id}` : 'gt-factura-nueva',
      data: { url: '/retenciones' },
    };

    // Vía Service Worker (imprescindible en Chrome Android y PWA móviles donde new Notification() es ilegal)
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(titulo, notifOptions))
        .catch(() => {
          try {
            const notif = new Notification(titulo, notifOptions);
            notif.onclick = () => {
              if (typeof window !== 'undefined') window.focus();
              notif.close();
            };
          } catch {
            /* Fallback si el navegador no permite ninguno */
          }
        });
    } else {
      try {
        const notif = new Notification(titulo, notifOptions);
        notif.onclick = () => {
          if (typeof window !== 'undefined') window.focus();
          notif.close();
        };
      } catch {
        /* Silenciar si el navegador no permite Notification */
      }
    }
  }
}

