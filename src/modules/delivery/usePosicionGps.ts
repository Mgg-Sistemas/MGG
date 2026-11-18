/* ============================================================
   MGG · Delivery · posición del teléfono (03/11/2026)

   Un solo navigator.geolocation.watchPosition para toda la vista del
   motorizado: lo usan el mapa de arriba, el «proveedor más cercano», la ruta
   y el envío de la ubicación a la oficina. Para no re-pintar la pantalla a
   cada lectura del GPS, la posición solo se actualiza si se movió más de
   POS_METROS o pasaron POS_MS. Sin permiso / sin GPS: `error` explica qué
   hacer y todo lo demás sigue funcionando.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { distanciaMetros, errorUbicacion } from './deliveryMovil';

export interface PosicionGps {
  lat: number;
  lng: number;
  precision: number | null;
  velocidad: number | null;
  rumbo: number | null;
  /** Date.now() de la lectura. */
  t: number;
}

const POS_METROS = 10;
const POS_MS = 15_000;

export function usePosicionGps(activo = true): { pos: PosicionGps | null; error: string | null } {
  const [pos, setPos] = useState<PosicionGps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ultima = useRef<PosicionGps | null>(null);

  useEffect(() => {
    if (!activo) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Este teléfono o navegador no permite leer la ubicación.');
      return;
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setError('La ubicación solo funciona cuando la página abre con https.');
      return;
    }
    const id = navigator.geolocation.watchPosition((g) => {
      const nueva: PosicionGps = {
        lat: g.coords.latitude, lng: g.coords.longitude, precision: g.coords.accuracy ?? null,
        velocidad: g.coords.speed ?? null, rumbo: g.coords.heading ?? null, t: Date.now(),
      };
      const u = ultima.current;
      setError(null);
      if (u && nueva.t - u.t < POS_MS && distanciaMetros(u, nueva) < POS_METROS) return;
      ultima.current = nueva;
      setPos(nueva);
    }, (e) => setError(errorUbicacion(e.code)), { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [activo]);

  return { pos, error };
}
