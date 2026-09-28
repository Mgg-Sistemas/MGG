import { describe, expect, it } from 'vitest';
import {
  efectoTasaPago, explicacionTasaPago, tasaValoraInventario,
  mismaMonedaQueElDocumento, montoQueCorresponde,
} from './tasaPagoDirecto';

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

describe('cuánto corresponde pagar desde la cuenta elegida', () => {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  /** El motor real: pivota en USD. */
  const convertirCon = (tasa: number) => (moneda: string, usd: number) =>
    moneda === 'Bs' ? round2(usd * tasa) : round2(usd);

  it('misma moneda: corresponde el total TAL CUAL, sin ida y vuelta por el dólar', () => {
    // El caso que apareció en CD-2026-0074: la vuelta por USD inventaba Bs 1,55.
    const aPagar = 389941.68;
    const tasa = 842.21;
    const totalUsd = round2(aPagar / tasa); // 463,00 — acá se pierde el resto
    expect(montoQueCorresponde({
      monedaBase: 'Bs', aPagar, monedaCuenta: 'Bs', totalUsd, convertir: convertirCon(tasa),
    })).toBe(389941.68);
    // Lo que hacía antes, para dejar escrito de dónde salía el descuadre:
    expect(convertirCon(tasa)('Bs', totalUsd)).toBe(389943.23);
  });

  it('y no se mueve al cambiar la tasa: sin cruce, la tasa no toca la caja', () => {
    const base = { monedaBase: 'Bs', aPagar: 389941.68, monedaCuenta: 'Bs', totalUsd: 463 };
    const a = montoQueCorresponde({ ...base, convertir: convertirCon(842.21) });
    const b = montoQueCorresponde({ ...base, convertir: convertirCon(857.01) });
    expect(a).toBe(b);
  });

  it('una factura en dólares pagada en dólares corresponde igual', () => {
    expect(montoQueCorresponde({
      monedaBase: 'USD', aPagar: 463, monedaCuenta: 'USD', totalUsd: 463, convertir: convertirCon(842.21),
    })).toBe(463);
  });

  it('USDT cuenta como dólares: el sistema los trata 1:1', () => {
    expect(mismaMonedaQueElDocumento('USD', 'USDT')).toBe(true);
    expect(mismaMonedaQueElDocumento('Bs', 'USDT')).toBe(false);
    expect(montoQueCorresponde({
      monedaBase: 'USD', aPagar: 463, monedaCuenta: 'USDT', totalUsd: 463, convertir: convertirCon(842.21),
    })).toBe(463);
  });

  it('cuando SÍ cruza de moneda, convierte como siempre', () => {
    expect(montoQueCorresponde({
      monedaBase: 'USD', aPagar: 463, monedaCuenta: 'Bs', totalUsd: 463, convertir: convertirCon(842.21),
    })).toBe(389943.23);
    expect(montoQueCorresponde({
      monedaBase: 'Bs', aPagar: 389941.68, monedaCuenta: 'USD', totalUsd: 463, convertir: convertirCon(842.21),
    })).toBe(463);
  });

  it('sin cuenta elegida todavía, el total en dólares', () => {
    expect(montoQueCorresponde({
      monedaBase: 'Bs', aPagar: 389941.68, monedaCuenta: null, totalUsd: 463, convertir: convertirCon(842.21),
    })).toBe(463);
  });

  it('no deja centavos de más aunque el total venga con cola', () => {
    expect(montoQueCorresponde({
      monedaBase: 'Bs', aPagar: 100.005, monedaCuenta: 'Bs', totalUsd: 0.12, convertir: convertirCon(842.21),
    })).toBe(100.01);
  });
});
