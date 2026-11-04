/* ============================================================
   MGG · RRHH · Histórico de cambios de cargo (04-11-2026)

   Pedido de la administradora: «permite poder tener un histórico de cambios
   de cargo. Que se vea la fecha del cambio del cargo y el motivo», con su
   reporte en PDF (vista previa). Cada cambio queda en `rrhh_cambios_cargo`:
   al editar la ficha (si el cargo cambió se piden fecha y motivo) o cargado a
   mano como histórico. Acá vive lo que no toca la base.
   ============================================================ */

export interface CambioCargo {
  id: string;
  personal_id: string;
  cargo_anterior: string | null;
  cargo_nuevo: string;
  departamento_anterior: string | null;
  departamento_nuevo: string | null;
  fecha: string;
  motivo: string;
  origen: 'ficha' | 'historico';
  actor: string | null;
  actor_name: string | null;
  created_at: string;
}

const norm = (t: string | null | undefined) => (t ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/** ¿Cambió el cargo? (sin importar mayúsculas ni espacios). */
export function huboCambioCargo(anterior: string | null | undefined, nuevo: string | null | undefined): boolean {
  return norm(anterior) !== norm(nuevo) && norm(nuevo) !== '';
}

/** Qué falta para registrar un cambio de cargo (null si está bien). */
export function errorCambioCargo(d: { cargoNuevo: string | null | undefined; fecha: string | null | undefined; motivo: string | null | undefined; hoy: string }): string | null {
  if (!norm(d.cargoNuevo)) return 'Indica el cargo nuevo.';
  if (!d.fecha) return 'Indica la fecha del cambio de cargo.';
  if (d.fecha > d.hoy) return 'La fecha del cambio de cargo no puede ser futura.';
  if ((d.motivo ?? '').trim().length < 3) return 'Escribe el motivo del cambio de cargo.';
  return null;
}

/** Del más nuevo al más viejo (por fecha y, si empatan, por cuándo se cargó). */
export function ordenarCambiosCargo<T extends Pick<CambioCargo, 'fecha' | 'created_at'>>(cs: T[]): T[] {
  return [...cs].sort((a, b) => (b.fecha.localeCompare(a.fecha)) || b.created_at.localeCompare(a.created_at));
}

/** «AYUDANTE → OPERADOR» (y el departamento si también cambió). */
export function textoCambioCargo(c: Pick<CambioCargo, 'cargo_anterior' | 'cargo_nuevo' | 'departamento_anterior' | 'departamento_nuevo'>): string {
  const cargo = `${c.cargo_anterior?.trim() || '—'} → ${c.cargo_nuevo}`;
  const dep = norm(c.departamento_anterior) !== norm(c.departamento_nuevo) && (c.departamento_anterior || c.departamento_nuevo)
    ? ` (${c.departamento_anterior?.trim() || '—'} → ${c.departamento_nuevo?.trim() || '—'})` : '';
  return cargo + dep;
}

/** dd/mm/aaaa a partir de aaaa-mm-dd. */
export const fechaCorta = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** Las filas del reporte: Fecha · Persona · Cédula · Cargo anterior · Cargo nuevo · Departamento · Motivo · Registró. */
export const CABECERA_CAMBIOS_CARGO = ['Fecha', 'Persona', 'Cédula', 'Cargo anterior', 'Cargo nuevo', 'Departamento', 'Motivo', 'Registró'];

export interface FilaReporteCargo { cambio: CambioCargo; persona: string; cedula: string; registro: string }

export function celdasCambioCargo(f: FilaReporteCargo): string[] {
  const c = f.cambio;
  const dep = norm(c.departamento_anterior) !== norm(c.departamento_nuevo)
    ? `${c.departamento_anterior?.trim() || '—'} → ${c.departamento_nuevo?.trim() || '—'}` : (c.departamento_nuevo?.trim() || '—');
  return [fechaCorta(c.fecha), f.persona, f.cedula || '—', c.cargo_anterior?.trim() || '—', c.cargo_nuevo, dep, c.motivo,
    f.registro + (c.origen === 'historico' ? ' (histórico)' : '')];
}
