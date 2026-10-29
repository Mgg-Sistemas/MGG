/* ============================================================
   MGG · Retenciones · Sonido distintivo y notificaciones básicas (29-10-2026)

   Sonido distintivo fiscal (Web Audio API, sin archivos externos):
   - Cada vez que llega una factura o cambia su estatus, suena una campana/acorde
     fiscal arpegiado (C5 523Hz → E5 659Hz → G5 784Hz), claramente diferente
     del doble-beep estándar del sistema (880Hz/660Hz).
   - "Esta notificación es ajena al flujo del sistema, solo oirá la carga o estatus de las facturas."
   - Suscripción en tiempo real (Realtime) a `retencion_facturas_externas`.
   ============================================================ */

import { useEffect, useRef } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { TABLE_FACTURAS_EXTERNAS, type EstadoFacturaExterna } from './facturasExternas.repository';
import { lanzarAvisoFactura } from './notificacionesDispositivo';

const PREF_SONIDO_RETENCIONES = 'mgg.retenciones.notifSonido';

let audioCtx: AudioContext | null = null;
let interactuado = false;

if (typeof window !== 'undefined') {
  const desbloquear = () => {
    interactuado = true;
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  };
  window.addEventListener('pointerdown', desbloquear, { once: true, passive: true });
  window.addEventListener('keydown', desbloquear, { once: true, passive: true });
}

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const W = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext || W.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function sonarNota(freq: number, duracionMs: number, volumen = 0.15, offsetMs = 0) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  // Tipo de onda triangular suave con toque de campana
  osc.type = 'triangle';
  osc.frequency.value = freq;

  const t0 = ctx.currentTime + offsetMs / 1000;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volumen, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duracionMs / 1000);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duracionMs / 1000 + 0.03);
}

/** Lee si el usuario tiene habilitado el sonido distintivo de retenciones (por defecto activado). */
export function getSonidoRetencionesHabilitado(): boolean {
  const s = getStorage();
  if (!s) return true;
  const v = s.getItem(PREF_SONIDO_RETENCIONES);
  return v === null ? true : v === '1';
}

export const isSonidoRetencionesHabilitado = getSonidoRetencionesHabilitado;

/** Guarda la preferencia de sonido distintivo de retenciones. */
export function setSonidoRetencionesHabilitado(habilitado: boolean): void {
  const s = getStorage();
  if (!s) return;
  s.setItem(PREF_SONIDO_RETENCIONES, habilitado ? '1' : '0');
}

export function toggleSonidoRetenciones(): boolean {
  const actual = getSonidoRetencionesHabilitado();
  setSonidoRetencionesHabilitado(!actual);
  return !actual;
}

/**
 * Toca el sonido distintivo cuando llega una factura externa (Campana / Arpegio fiscal ascendente C5-E5-G5).
 * Distintivo del doble-beep estándar de la app.
 */
export function playSonidoFacturaLlegada(): void {
  if (!getSonidoRetencionesHabilitado() || !interactuado) return;
  // Arpegio armónico fiscal brillante
  sonarNota(523.25, 220, 0.14, 0);   // Do5 (C5)
  sonarNota(659.25, 240, 0.14, 110); // Mi5 (E5)
  sonarNota(783.99, 380, 0.16, 220); // Sol5 (G5)
}

/**
 * Toca un tono distintivo suave cuando cambia el estatus de una factura (Revisada / Procesada / Rechazada).
 */
export function playSonidoFacturaEstatus(): void {
  if (!getSonidoRetencionesHabilitado() || !interactuado) return;
  sonarNota(587.33, 180, 0.12, 0);   // Re5 (D5)
  sonarNota(880.00, 320, 0.14, 130); // La5 (A5)
}

export interface FacturaNotificacionEvento {
  tipo: 'nueva' | 'estatus';
  facturaId: string;
  empresa: string;
  numeroFactura: string;
  proveedorNombre: string;
  montoTotal: number;
  moneda: string;
  estado: EstadoFacturaExterna;
}

/**
 * Hook de suscripción en tiempo real a las facturas externas para el módulo de retenciones.
 * Emite alerta integral (sonido, vibración, parpadeo de pestaña y notificación nativa) y ejecuta callbacks.
 */
export function useNotificacionesFacturasRetencion(opciones: {
  activo?: boolean;
  onNuevaFactura?: (ev: FacturaNotificacionEvento) => void;
  onCambioEstatus?: (ev: FacturaNotificacionEvento) => void;
}) {
  const { activo = true, onNuevaFactura, onCambioEstatus } = opciones;
  const cbNuevaRef = useRef(onNuevaFactura);
  const cbEstatusRef = useRef(onCambioEstatus);

  useEffect(() => {
    cbNuevaRef.current = onNuevaFactura;
    cbEstatusRef.current = onCambioEstatus;
  });

  useEffect(() => {
    if (!activo) return;

    const channel = supabase
      .channel('realtime_retencion_facturas_externas')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: TABLE_FACTURAS_EXTERNAS },
        (payload) => {
          const row = (payload.new || {}) as Record<string, unknown>;
          const ev: FacturaNotificacionEvento = {
            tipo: 'nueva',
            facturaId: String(row.id || ''),
            empresa: String(row.empresa || 'MGG'),
            numeroFactura: String(row.numero_factura || ''),
            proveedorNombre: String(row.proveedor_nombre || ''),
            montoTotal: Number(row.monto_total) || 0,
            moneda: String(row.moneda || 'USD'),
            estado: (row.estado as EstadoFacturaExterna) || 'recibida',
          };
          lanzarAvisoFactura({
            id: ev.facturaId,
            empresa: ev.empresa,
            proveedorNombre: ev.proveedorNombre,
            numeroFactura: ev.numeroFactura,
            montoTotal: ev.montoTotal,
            moneda: ev.moneda,
          }, { conSonido: true });
          cbNuevaRef.current?.(ev);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: TABLE_FACTURAS_EXTERNAS },
        (payload) => {
          const row = (payload.new || {}) as Record<string, unknown>;
          const old = (payload.old || {}) as Record<string, unknown>;
          if (row.estado && row.estado !== old.estado) {
            playSonidoFacturaEstatus();
            const ev: FacturaNotificacionEvento = {
              tipo: 'estatus',
              facturaId: String(row.id || ''),
              empresa: String(row.empresa || 'MGG'),
              numeroFactura: String(row.numero_factura || ''),
              proveedorNombre: String(row.proveedor_nombre || ''),
              montoTotal: Number(row.monto_total) || 0,
              moneda: String(row.moneda || 'USD'),
              estado: (row.estado as EstadoFacturaExterna) || 'recibida',
            };
            cbEstatusRef.current?.(ev);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activo]);
}
