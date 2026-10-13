/* ============================================================
   MGG · Combustible · a qué sede pertenece cada tanque / combustible

   Compartido entre la PC (CombustiblePage) y el teléfono (Surtidor):
   los dos piden la sede primero y después muestran lo de esa sede (13-10).
   ============================================================ */
import type { Tanque } from '@/shared/lib/types';

/** Los datos legados (sin sede guardada) cuentan en Matanzas. */
export const SEDE_POR_DEFECTO = 'MATANZAS';

/** Sede (clave) de un tanque o combustible; sin sede guardada → la por defecto. */
export function sedeDe(x: { sede?: string | null }): string {
  return (x.sede || '').trim() || SEDE_POR_DEFECTO;
}

/** Tanques de una sede. */
export function tanquesDeSede<T extends { sede?: string | null }>(tanques: readonly T[], clave: string): T[] {
  return tanques.filter((t) => sedeDe(t) === clave);
}

export interface ResumenSedeTanques { clave: string; nTanques: number; litros: number }

/** Para las tarjetas de sede del teléfono: cuántos tanques y cuántos litros hay en cada una. */
export function resumenTanquesPorSede(sedes: readonly { clave: string }[], tanques: readonly Pick<Tanque, 'sede' | 'litros'>[]): ResumenSedeTanques[] {
  return sedes.map((s) => {
    const list = tanquesDeSede(tanques, s.clave);
    return { clave: s.clave, nTanques: list.length, litros: list.reduce((a, t) => a + (Number(t.litros) || 0), 0) };
  });
}
