/* ============================================================
   MGG · Retenciones · Sonido distintivo para facturas
   (Buzón móvil y cambios de estatus)

   Sonido exclusivo para el módulo de Retenciones, diferente al
   doble-beep estándar del sistema (880 Hz / 660 Hz).
   Generado con Web Audio API puro, sin librerías externas.
   ============================================================ */

const PREF_SONIDO_RETENCIONES = 'mgg.retenciones.sonido_notif';

let audioCtx: AudioContext | null = null;
let _sonidoHabilitadoMemoria = true;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const W = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext || W.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => undefined);
  }
  return audioCtx;
}

function campanilla(frecuencia: number, duracionMs: number, ganancia: number, retrasoMs = 0) {
  const c = getAudioContext();
  if (!c) return;

  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle'; // Tono cálido y distintivo tipo timbre/chime
    osc.frequency.value = frecuencia;

    const t0 = c.currentTime + retrasoMs / 1000;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(ganancia, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duracionMs / 1000);

    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duracionMs / 1000 + 0.05);
  } catch {
    /* Audio context no disponible o bloqueado por el navegador */
  }
}

/** Comprueba si el sonido de facturas está habilitado en las preferencias del usuario */
export function estaSonidoFacturasHabilitado(): boolean {
  if (typeof window === 'undefined') return _sonidoHabilitadoMemoria;
  const v = localStorage.getItem(PREF_SONIDO_RETENCIONES);
  return v === null ? true : v === '1';
}

export function alternarSonidoFacturas(habilitado: boolean): void {
  _sonidoHabilitadoMemoria = habilitado;
  if (typeof window === 'undefined') return;
  localStorage.setItem(PREF_SONIDO_RETENCIONES, habilitado ? '1' : '0');
}

export const isSonidoRetencionesHabilitado = estaSonidoFacturasHabilitado;

export function toggleSonidoRetenciones(): boolean {
  const actual = estaSonidoFacturasHabilitado();
  alternarSonidoFacturas(!actual);
  return !actual;
}

/**
 * Sonido distintivo cuando llega una nueva factura desde la vista teléfono.
 * Arpegio armónico ascendente de triple campanilla (Do5, Mi5, Sol5).
 */
export function reproducirSonidoFacturaNueva(): void {
  if (!estaSonidoFacturasHabilitado()) return;
  campanilla(523.25, 260, 0.14, 0);   // Do5
  campanilla(659.25, 280, 0.14, 120); // Mi5
  campanilla(783.99, 360, 0.16, 240); // Sol5
}

/**
 * Sonido distintivo cuando una factura cambia de estatus (revisada, retenida o descartada).
 * Acorde suave de confirmación en dos tonos (Fa5 -> La5).
 */
export function reproducirSonidoEstatusFactura(): void {
  if (!estaSonidoFacturasHabilitado()) return;
  campanilla(698.46, 220, 0.12, 0);   // Fa5
  campanilla(880.00, 300, 0.14, 100); // La5
}

