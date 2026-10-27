/* ============================================================
   Golden Touch · Maquinaria · aviso de mantenimiento de UN equipo
   Regla ÚNICA (26/10/2026): la misma del catálogo (PC y móvil), el
   expediente y Servicio de Mantenimiento. Horas con la frecuencia del
   equipo o la de la empresa (250 h), km si la ficha lo define, y la
   lectura vigente unificada (RPC maquinaria_lecturas_vigentes:
   Combustible + Maquinaria + bitácora). Los modales de bitácora y de
   resumen la reutilizan para no contradecir al catálogo.
   ============================================================ */
import { num as fmtNum } from '@/shared/lib/format';
import { avisoServicio, avisoMasUrgente, frecuenciaHrs, type AvisoServicio } from './flota';

/** Campos de la ficha que intervienen en el aviso. */
export interface EquipoConIntervalos {
  mantenimiento_cada_hrs?: number | null;
  mantenimiento_base_hrs?: number | null;
  mantenimiento_cada_km?: number | null;
  mantenimiento_base_km?: number | null;
}

/** Lectura vigente (horómetro y/o km). null = sin lectura. */
export interface LecturaParaAviso {
  horometro: number | null;
  kilometraje: number | null;
}

export interface AvisoEquipo {
  avisoH: AvisoServicio | null;
  avisoK: AvisoServicio | null;
  /** El más urgente de los dos; null = sin lectura con la que avisar. */
  aviso: AvisoServicio | null;
  /** Frecuencia por horas efectiva (la de la ficha o la de la empresa). */
  frecuenciaH: number;
}

/** Aviso de un equipo a partir de su ficha y su lectura vigente (regla del catálogo). */
export function avisoDeEquipo(equipo: EquipoConIntervalos, lectura: LecturaParaAviso | null | undefined): AvisoEquipo {
  const frecuenciaH = frecuenciaHrs(equipo);
  const avisoH = avisoServicio(frecuenciaH, lectura?.horometro ?? null, equipo.mantenimiento_base_hrs, 'h');
  const avisoK = avisoServicio(equipo.mantenimiento_cada_km, lectura?.kilometraje ?? null, equipo.mantenimiento_base_km, 'km');
  return { avisoH, avisoK, aviso: avisoMasUrgente(avisoH, avisoK), frecuenciaH };
}

export type TonoAviso = 'success' | 'warning' | 'danger' | 'retired';

/** Clase del badge: verde OK, ámbar próximo, rojo vencido; gris sin datos. */
export function tonoAviso(aviso: AvisoServicio | null | undefined): TonoAviso {
  if (!aviso) return 'retired';
  return aviso.nivel === 'vencido' ? 'danger' : aviso.nivel === 'proximo' ? 'warning' : 'success';
}

/** Texto del badge, igual que en el catálogo: «OK», «Próximo · faltan 12 h», «Vencido · pasado por 55 h». */
export function textoAviso(aviso: AvisoServicio | null | undefined): string {
  if (!aviso) return 'Sin lectura';
  if (aviso.nivel === 'vencido') return `Vencido · pasado por ${fmtNum(Math.abs(aviso.restante))} ${aviso.unidad}`;
  if (aviso.nivel === 'proximo') return `Próximo · faltan ${fmtNum(aviso.restante)} ${aviso.unidad}`;
  return 'OK';
}
