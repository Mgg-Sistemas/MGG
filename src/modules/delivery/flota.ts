/* ============================================================
   MGG · Delivery · la flota que se está viendo (04-11-2026)

   Delivery (motorizados) y Carga pesada comparten el módulo: mismo flujo, otra
   flota y otro rol. Cada pantalla trabaja con una; las listas, el mapa, el
   histórico y la ubicación en vivo se piden de esa flota.
   ============================================================ */
import { createContext, useContext } from 'react';
import type { Flota } from '@/modules/pedidos/entregaModalidad';

export type { Flota };

export const FlotaContext = createContext<Flota>('delivery');
export const useFlota = (): Flota => useContext(FlotaContext);

/** El módulo de permisos de cada flota. */
export const MODULO_FLOTA: Record<Flota, 'delivery' | 'carga_pesada'> = { delivery: 'delivery', carga_pesada: 'carga_pesada' };

export const TITULO_FLOTA: Record<Flota, string> = { delivery: '🛵 Delivery', carga_pesada: '🚚 Carga pesada' };

/** La pantalla de teléfono de cada flota. */
export const RUTA_TELEFONO_FLOTA: Record<Flota, string> = { delivery: '/app/delivery/telefono', carga_pesada: '/app/carga-pesada/telefono' };
