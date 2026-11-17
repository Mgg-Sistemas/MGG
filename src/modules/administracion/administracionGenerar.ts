/* ============================================================================
   Golden Touch · Administración · generar pendientes (lógica pura)
   Por cada gasto fijo activo, crea el/los movimientos «pendientes» que faltan
   hasta un corte (hoy por defecto), SIN duplicar los que ya existen. Es el
   núcleo de la recurrencia semiautomática: la UI llama esto y manda los nuevos
   al repositorio (que materializa el pendiente en Tesorería). Idempotente:
   la unicidad es por (gastoFijoId, periodo), igual que el índice de BD.
   Sin React, sin base, determinista.
   ============================================================================ */
import { periodosEntre, type Moneda, type Periodicidad } from './administracionCalculo';

export interface GastoGenerable {
  id: string;
  empresaClave: string;
  concepto: string;
  monto: number;
  moneda: Moneda;
  categoriaGastoId?: string | null;
  periodicidad: Periodicidad;
  diaVencimiento?: number | null;
  vigenteDesde: string | Date;
  estado: 'activo' | 'suspendido';
}

export interface MovimientoGenerado {
  gastoFijoId: string;
  empresaClave: string;
  concepto: string;
  categoriaGastoId: string | null;
  /** Token canónico del período (2026-11, 2026-T4…). */
  periodo: string;
  /** Vencimiento, 'AAAA-MM-DD'. */
  fecha: string;
  monto: number;
  moneda: Moneda;
  origen: 'generado';
  estadoPago: 'pendiente';
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clave = (gastoFijoId: string, periodo: string) => `${gastoFijoId}\u0000${periodo}`;

/**
 * Los movimientos pendientes a crear hasta `hasta` (default hoy), sin duplicar
 * los `existentes`. Solo gastos activos. El orden es estable: por vencimiento.
 */
export function generarPendientes(
  gastos: readonly GastoGenerable[],
  existentes: readonly { gastoFijoId: string; periodo: string }[],
  hasta: Date = new Date(),
): MovimientoGenerado[] {
  const ya = new Set(existentes.map((e) => clave(e.gastoFijoId, e.periodo)));
  const nuevos: MovimientoGenerado[] = [];
  for (const g of gastos) {
    if (g.estado !== 'activo') continue;
    for (const { token, vence } of periodosEntre(g, hasta)) {
      if (ya.has(clave(g.id, token))) continue;
      ya.add(clave(g.id, token)); // también evita duplicar dentro de la misma corrida
      nuevos.push({
        gastoFijoId: g.id, empresaClave: g.empresaClave, concepto: g.concepto,
        categoriaGastoId: g.categoriaGastoId ?? null, periodo: token, fecha: iso(vence),
        monto: g.monto, moneda: g.moneda, origen: 'generado', estadoPago: 'pendiente',
      });
    }
  }
  return nuevos.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.concepto.localeCompare(b.concepto, 'es')));
}

/** La nota que lleva el pendiente en Tesorería (Opción A): «Gasto fijo · empresa · período». */
export function notaPendiente(empresaNombre: string, periodoLabel: string): string {
  return `Gasto fijo · ${empresaNombre} · ${periodoLabel}`;
}
