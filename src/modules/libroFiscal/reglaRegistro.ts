/* ============================================================
   Golden Touch · Retenciones · Registrar con la regla vigente (R7)

   Al registrar, si hay R7 y una regla VIGENTE del impuesto cuyas condiciones
   se cumplen, el monto sale del motor de 8 pasos y la retención guarda la
   regla y la foto del cálculo. Sin R7, o sin regla vigente que aplique, esto
   devuelve null y el registro sigue con el cálculo de hoy
   (retencionesCalculo.ts), sin cambio alguno.
   ============================================================ */
import { calcularConRegla, condicionesQueFallan, type ResultadoMotor } from './motorReglas';
import { r7Disponible, reglasVigentes, type ReglaGuardada } from './reglas.repository';
import { cargarDatosPrueba, contextoDePrueba, type EntradaPrueba } from './probarRegla';

export interface CalculoConRegla { regla: ReglaGuardada; resultado: ResultadoMotor }

/** La primera regla vigente (por prioridad) que aplica a la operación, con su cálculo. null = usar el cálculo de hoy. */
export async function calcularConReglaVigente(impuestoClave: string, entrada: EntradaPrueba): Promise<CalculoConRegla | null> {
  if (!(await r7Disponible())) return null;
  const reglas = (await reglasVigentes(impuestoClave, entrada.fecha, false))
    .filter((r) => r.estado === 'vigente')
    .sort((a, b) => a.prioridad - b.prioridad || a.nombre.localeCompare(b.nombre) || b.version - a.version);
  for (const regla of reglas) {
    const datos = await cargarDatosPrueba(regla, entrada);
    const ctx = contextoDePrueba(entrada, datos);
    if (condicionesQueFallan(regla, ctx).length === 0) return { regla, resultado: calcularConRegla(regla, ctx) };
  }
  return null;
}

/** Lo que la retención guarda de la regla (las columnas de R7). La base pone la versión. */
export function columnasDeRegla(c: CalculoConRegla): { regla_id: string; foto: Record<string, unknown> } {
  return { regla_id: c.regla.id, foto: { ...c.resultado.foto, base: c.resultado.base, baseBs: c.resultado.baseBs, pct: c.resultado.pct, sustraendo: c.resultado.sustraendo, monto: c.resultado.monto, montoBs: c.resultado.montoBs } };
}
