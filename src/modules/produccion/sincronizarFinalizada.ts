/* ============================================================
   MGG · Fundición / Refinación · editar una orden YA FINALIZADA

   Hasta el 02-10-2026 una colada o refinación finalizada solo admitía
   «⚖ Corregir cantidad». Todo lo demás —materiales, costos, horno, almacén,
   el reporte entero— quedaba trancado, y una colada mal cargada se arrastraba
   así para siempre. La administradora pidió poder modificar TODO.

   Lo que una orden finalizada tiene en el inventario es una sola cosa: el
   producto terminado que entró (si la orden sumaba), en SU almacén destino,
   con SUS kg. Si alguno de esos tres cambia, el inventario se mueve por la
   DIFERENCIA, nunca se vuelve a entrar todo:

     · mismos almacén → un ajuste de (kg nuevos − kg viejos);
     · otro almacén   → sale lo viejo del viejo y entra lo nuevo en el nuevo;
     · deja de sumar  → sale lo viejo; empieza a sumar → entra lo nuevo.

   La escoria / dross se sincroniza con la misma idea (en su propia ficha).
   Acá está el cálculo puro; el repositorio hace los movimientos.
   ============================================================ */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cómo quedó (o cómo queda) la orden frente al inventario. */
export interface EstadoEnInventario {
  almacen: string;
  cantidad: number;
  /** false = la orden no suma stock (registro / reporte): para el inventario vale 0. */
  suma: boolean;
}

/** Un movimiento de ajuste que hay que hacer: + entra, − sale. */
export interface MovimientoSync {
  almacen: string;
  delta: number;
}

/** Kg que la orden representa en inventario: 0 cuando no suma. */
function efectivo(e: EstadoEnInventario): number {
  if (!e.suma) return 0;
  const n = Number(e.cantidad);
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

/**
 * Los ajustes necesarios para pasar de `antes` a `despues`. Vacío cuando no
 * hay nada que mover (mismos kg, mismo almacén, misma marca de sumar).
 */
export function movimientosDeSincronizacion(antes: EstadoEnInventario, despues: EstadoEnInventario): MovimientoSync[] {
  const kgAntes = efectivo(antes);
  const kgDespues = efectivo(despues);
  const almAntes = (antes.almacen ?? '').trim();
  const almDespues = (despues.almacen ?? '').trim() || almAntes;

  if (almAntes === almDespues) {
    const delta = round2(kgDespues - kgAntes);
    return delta === 0 ? [] : [{ almacen: almDespues, delta }];
  }
  const out: MovimientoSync[] = [];
  if (kgAntes > 0) out.push({ almacen: almAntes, delta: -kgAntes });
  if (kgDespues > 0) out.push({ almacen: almDespues, delta: kgDespues });
  return out;
}

/** Texto del movimiento: se explica solo en el kardex. */
export function detalleEdicionFinalizada(
  tipo: 'fundicion' | 'refinacion' | null | undefined,
  numero: number | null | undefined,
  antes: EstadoEnInventario,
  despues: EstadoEnInventario,
): string {
  const proceso = tipo === 'refinacion' ? 'refinación' : 'colada';
  const ref = numero ? ` #${numero}` : '';
  const partes: string[] = [];
  if (round2(antes.cantidad) !== round2(despues.cantidad)) partes.push(`${round2(antes.cantidad)} → ${round2(despues.cantidad)} kg`);
  if ((antes.almacen ?? '').trim() !== (despues.almacen ?? '').trim() && (despues.almacen ?? '').trim()) partes.push(`${antes.almacen} → ${despues.almacen}`);
  if (antes.suma !== despues.suma) partes.push(despues.suma ? 'ahora suma al inventario' : 'ya no suma al inventario');
  return `Edición de ${proceso}${ref} finalizada${partes.length ? ': ' + partes.join(' · ') : ''}`;
}

/** Nota que queda en el historial de correcciones de la orden. */
export const NOTA_EDICION_FINALIZADA = 'Edición completa de la orden ya finalizada';
