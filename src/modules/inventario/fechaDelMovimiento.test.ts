/* ============================================================
   MGG · Inventario · con qué fecha se archiva un movimiento

   El caso que importa: una comida de cocina cargada con fecha vieja tiene que
   bajar el stock CON ESA FECHA, o el libro del mercado y el almacén quedan
   contando en ciclos distintos.
   ============================================================ */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fechaDelMovimiento } from './movimientos.repository';

const AHORA = '2026-09-29T15:00:00.000Z';

function congelarReloj(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AHORA));
}

afterEach(() => { vi.useRealTimers(); });

describe('fechaDelMovimiento', () => {
  it('sin fecha propia, el movimiento es de ahora', () => {
    congelarReloj();
    expect(fechaDelMovimiento()).toBe(AHORA);
    expect(fechaDelMovimiento(null)).toBe(AHORA);
    expect(fechaDelMovimiento('')).toBe(AHORA);
    expect(fechaDelMovimiento('   ')).toBe(AHORA);
  });

  it('respeta la fecha del hecho cuando viene una', () => {
    congelarReloj();
    // La comida del 12 cargada el 17: el kardex tiene que decir 12.
    expect(fechaDelMovimiento('2026-09-12T16:00:00.000Z')).toBe('2026-09-12T16:00:00.000Z');
  });

  it('una fecha ilegible no rompe el movimiento: cae en ahora', () => {
    congelarReloj();
    expect(fechaDelMovimiento('el martes pasado')).toBe(AHORA);
    expect(fechaDelMovimiento('2026-13-45')).toBe(AHORA);
  });

  it('nunca hacia el futuro: se topa en ahora', () => {
    congelarReloj();
    // Un movimiento fechado mañana baja el stock hoy pero no entra en ninguna
    // ventana (todas recortan en `now`): quedaría invisible y descuadrando.
    expect(fechaDelMovimiento('2026-10-05T10:00:00.000Z')).toBe(AHORA);
  });

  it('el instante exacto de ahora sigue siendo válido', () => {
    congelarReloj();
    expect(fechaDelMovimiento(AHORA)).toBe(AHORA);
  });
});
