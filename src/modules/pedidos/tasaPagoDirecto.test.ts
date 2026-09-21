import { describe, expect, it } from 'vitest';
import { efectoTasaPago, explicacionTasaPago, tasaValoraInventario } from './tasaPagoDirecto';

describe('efectoTasaPago', () => {
  it('compra en Bs pagada en Bs: no convierte, pero valora el inventario', () => {
    expect(efectoTasaPago({ kind: 'compra', monedaBase: 'Bs', cruzaBsUsd: false })).toBe('valora');
  });

  it('compra en Bs pagada en $: convierte y valora', () => {
    expect(efectoTasaPago({ kind: 'compra', monedaBase: 'Bs', cruzaBsUsd: true })).toBe('ambas');
  });

  it('compra en $ pagada en Bs: solo convierte (el inventario ya está en dólares)', () => {
    expect(efectoTasaPago({ kind: 'compra', monedaBase: 'USD', cruzaBsUsd: true })).toBe('convierte');
  });

  it('compra en $ pagada en $: la tasa no hace nada', () => {
    expect(efectoTasaPago({ kind: 'compra', monedaBase: 'USD', cruzaBsUsd: false })).toBe('ninguna');
  });

  it('servicio: nunca valora inventario, solo convierte cuando hace falta', () => {
    expect(efectoTasaPago({ kind: 'servicio', monedaBase: 'Bs', cruzaBsUsd: true })).toBe('convierte');
    expect(efectoTasaPago({ kind: 'servicio', monedaBase: 'Bs', cruzaBsUsd: false })).toBe('ninguna');
    expect(efectoTasaPago({ kind: 'servicio', monedaBase: 'USD', cruzaBsUsd: false })).toBe('ninguna');
  });
});

describe('tasaValoraInventario', () => {
  it('solo las compras en Bs valoran material con la tasa', () => {
    expect(tasaValoraInventario({ kind: 'compra', monedaBase: 'Bs', cruzaBsUsd: false })).toBe(true);
    expect(tasaValoraInventario({ kind: 'compra', monedaBase: ' bs ', cruzaBsUsd: false })).toBe(true);
    expect(tasaValoraInventario({ kind: 'compra', monedaBase: 'USD', cruzaBsUsd: false })).toBe(false);
    expect(tasaValoraInventario({ kind: 'servicio', monedaBase: 'Bs', cruzaBsUsd: false })).toBe(false);
  });
});

describe('explicacionTasaPago', () => {
  it('cada caso dice qué pasa, sin dejarlo a la adivinanza', () => {
    expect(explicacionTasaPago('ambas')).toContain('inventario');
    expect(explicacionTasaPago('convierte')).toContain('sale de la caja');
    expect(explicacionTasaPago('valora')).toContain('no cambia lo que sale de la caja');
    expect(explicacionTasaPago('ninguna')).toContain('no cambia nada');
  });
});
