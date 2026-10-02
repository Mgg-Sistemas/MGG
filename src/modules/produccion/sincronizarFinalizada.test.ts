import { describe, expect, it } from 'vitest';
import { detalleEdicionFinalizada, movimientosDeSincronizacion } from './sincronizarFinalizada';

const A = 'ESTAÑO MATANZA';
const B = 'ESTAÑO LOS PINOS';

describe('movimientosDeSincronizacion · editar una orden ya finalizada', () => {
  it('sin cambios no mueve nada', () => {
    expect(movimientosDeSincronizacion({ almacen: A, cantidad: 100, suma: true }, { almacen: A, cantidad: 100, suma: true })).toEqual([]);
  });

  it('mismo almacén: un solo ajuste por la diferencia (sube)', () => {
    expect(movimientosDeSincronizacion({ almacen: A, cantidad: 100, suma: true }, { almacen: A, cantidad: 120.5, suma: true }))
      .toEqual([{ almacen: A, delta: 20.5 }]);
  });

  it('mismo almacén: un solo ajuste por la diferencia (baja)', () => {
    expect(movimientosDeSincronizacion({ almacen: A, cantidad: 100, suma: true }, { almacen: A, cantidad: 80, suma: true }))
      .toEqual([{ almacen: A, delta: -20 }]);
  });

  it('cambia el almacén destino: sale todo del viejo y entra todo en el nuevo', () => {
    expect(movimientosDeSincronizacion({ almacen: A, cantidad: 100, suma: true }, { almacen: B, cantidad: 110, suma: true }))
      .toEqual([{ almacen: A, delta: -100 }, { almacen: B, delta: 110 }]);
  });

  it('deja de sumar al inventario: sale lo que había entrado', () => {
    expect(movimientosDeSincronizacion({ almacen: A, cantidad: 100, suma: true }, { almacen: A, cantidad: 100, suma: false }))
      .toEqual([{ almacen: A, delta: -100 }]);
  });

  it('empieza a sumar al inventario: entra lo nuevo', () => {
    expect(movimientosDeSincronizacion({ almacen: A, cantidad: 100, suma: false }, { almacen: A, cantidad: 95, suma: true }))
      .toEqual([{ almacen: A, delta: 95 }]);
  });

  it('una orden que nunca sumó y sigue sin sumar no toca el inventario aunque cambien los kg', () => {
    expect(movimientosDeSincronizacion({ almacen: A, cantidad: 100, suma: false }, { almacen: B, cantidad: 50, suma: false })).toEqual([]);
  });

  it('almacén nuevo vacío = se queda en el viejo', () => {
    expect(movimientosDeSincronizacion({ almacen: A, cantidad: 100, suma: true }, { almacen: '', cantidad: 90, suma: true }))
      .toEqual([{ almacen: A, delta: -10 }]);
  });

  it('redondea a 2 decimales y no genera ajustes de 0', () => {
    expect(movimientosDeSincronizacion({ almacen: A, cantidad: 10.004, suma: true }, { almacen: A, cantidad: 10, suma: true })).toEqual([]);
  });
});

describe('detalleEdicionFinalizada', () => {
  it('nombra el proceso, el número y lo que cambió', () => {
    const t = detalleEdicionFinalizada('fundicion', 12, { almacen: A, cantidad: 100, suma: true }, { almacen: B, cantidad: 110, suma: true });
    expect(t).toBe(`Edición de colada #12 finalizada: 100 → 110 kg · ${A} → ${B}`);
  });

  it('dice cuando la orden deja de sumar', () => {
    const t = detalleEdicionFinalizada('refinacion', 3, { almacen: A, cantidad: 50, suma: true }, { almacen: A, cantidad: 50, suma: false });
    expect(t).toBe('Edición de refinación #3 finalizada: ya no suma al inventario');
  });

  it('sin cambios de inventario queda el encabezado solo', () => {
    expect(detalleEdicionFinalizada('fundicion', null, { almacen: A, cantidad: 1, suma: true }, { almacen: A, cantidad: 1, suma: true }))
      .toBe('Edición de colada finalizada');
  });
});
