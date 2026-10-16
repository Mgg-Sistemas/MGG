/* ============================================================
   MGG · Retenciones v8 · La puerta de datos

   Todo lo que las pantallas de la v8 leen o escriben pasa por aquí. Ninguna
   pantalla lee directamente las tablas de otro módulo (modelo de dominio,
   §5 bis). Hoy la implementación es la del sistema anfitrión
   (puertaAnfitrion.ts), sobre las tablas que YA existen en producción. Lo
   que dependa de tablas que aún no están (reglas, períodos, otro sistema…)
   no se ofrece: la pantalla lo oculta, sin botones «pronto».

   Las pantallas reciben la puerta por contexto (PuertaContext), así las
   pruebas usan una puerta falsa.
   ============================================================ */

import { createContext, useContext } from 'react';
import type { RetencionItem } from '../../retenciones.repository';
import type { FiltroRetenciones, NuevaRetencion, RetencionPracticada } from '../../retencionesFiscal.repository';
import type { ConceptoRetencion, ConfigRetencion } from '../../retencionesCalculo';

export type { RetencionItem, RetencionPracticada, FiltroRetenciones, NuevaRetencion, ConfigRetencion, ConceptoRetencion };

/** Qué partes de la v8 tienen datos hoy. La pantalla oculta lo que dé false. */
export interface Capacidades {
  /** retencion_regla_versiones (REG-1): sin esto, el registro usa las reglas armadas desde la configuración de hoy. */
  reglas: boolean;
  /** retencion_periodos (E15-1): sin esto, no hay tira de período ni pestaña Períodos. */
  periodos: boolean;
  /** Convivencia con el otro sistema (9c/9d). */
  otroSistema: boolean;
  /** Impresiones y entregas (R1). */
  impresiones: boolean;
  /** Reportes guardados (E15-2). */
  reportes: boolean;
}

export interface PuertaRetenciones {
  capacidades: Capacidades;
  /** OC y compras con retenciones pendientes (lo de «Por realizar» de hoy). */
  pendientes(): Promise<RetencionItem[]>;
  /** OC y compras con la retención finalizada (lo de «Realizadas» de hoy). */
  hechas(): Promise<RetencionItem[]>;
  /** Una fila por retención (el Libro fiscal de hoy). */
  libro(filtro?: FiltroRetenciones): Promise<RetencionPracticada[]>;
  config(): Promise<ConfigRetencion>;
  conceptos(soloActivos?: boolean): Promise<ConceptoRetencion[]>;
  registrar(input: NuevaRetencion): Promise<RetencionPracticada>;
  anular(id: string, motivo: string): Promise<void>;
}

export const PuertaContext = createContext<PuertaRetenciones | null>(null);

export function usePuerta(): PuertaRetenciones {
  const p = useContext(PuertaContext);
  if (!p) throw new Error('Retenciones v8: falta la puerta de datos (PuertaContext).');
  return p;
}
