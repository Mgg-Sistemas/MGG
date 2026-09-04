import { describe, it, expect } from 'vitest';
import { aceptaLetra, mapasDeCalculo, nombreDeCalculo, simboloDeCalculo } from './tasasParaCalculo';
import { calcular } from '@/shared/lib/calculo';

/* Valores reales de producción del 04/09/2026 (tabla `tasa_cambio`). */
const REALES = { bcvUsd: 807.39, bcvEur: 938.45, usdtVes: 965.78, copPorUsd: 3141.36 };

describe('mapasDeCalculo', () => {
  it('arma las cinco monedas cuando hay todas las tasas', () => {
    const { enBolivares, sinTasa } = mapasDeCalculo(REALES);
    expect([...enBolivares.keys()].sort()).toEqual(['COP', 'EUR', 'USD', 'USDT', 'VES']);
    expect(sinTasa).toEqual([]);
  });

  it('el bolívar siempre vale 1, aunque no haya ninguna fuente', () => {
    // Es la unidad de referencia: la calculadora nunca se queda sin monedas.
    const { enBolivares, sinTasa } = mapasDeCalculo({ bcvUsd: null, bcvEur: null, usdtVes: null, copPorUsd: null });
    expect(enBolivares.get('VES')).toBe(1);
    expect(sinTasa.sort()).toEqual(['COP', 'EUR', 'USD', 'USDT']);
  });

  it('el peso se ancla al BCV, no se usa tal cual', () => {
    // `copUsd` es COP por 1 USD. Bs/COP = (Bs/USD) ÷ (COP/USD).
    const { enBolivares } = mapasDeCalculo(REALES);
    expect(enBolivares.get('COP')).toBeCloseTo(807.39 / 3141.36, 8);
  });

  it('sin BCV el peso queda fuera en vez de aproximarse', () => {
    const { enBolivares, sinTasa } = mapasDeCalculo({ ...REALES, bcvUsd: null });
    expect(enBolivares.has('COP')).toBe(false);
    expect(sinTasa).toContain('COP');
  });

  it('una moneda sin tasa NO entra al alias: ofrecerla enseña a chocarse', () => {
    // Si Binance no respondió, la calculadora no entiende «usdt» ese rato.
    const { alias, sinTasa } = mapasDeCalculo({ ...REALES, usdtVes: null });
    expect(alias.has('USDT')).toBe(false);
    expect(alias.has('TETHER')).toBe(false);
    expect(sinTasa).toContain('USDT');
    expect(alias.get('$')).toBe('USD');   // las demás siguen
  });

  it('ignora tasas absurdas en vez de dividir por cero', () => {
    const { enBolivares } = mapasDeCalculo({ bcvUsd: 0, bcvEur: -5, usdtVes: NaN, copPorUsd: 0 });
    expect(enBolivares.has('USD')).toBe(false);
    expect(enBolivares.has('EUR')).toBe(false);
    expect(enBolivares.has('USDT')).toBe(false);
    expect(enBolivares.has('COP')).toBe(false);
  });

  it('reconoce las formas de escribir cada moneda', () => {
    const { alias } = mapasDeCalculo(REALES);
    expect(alias.get('BS')).toBe('VES');
    expect(alias.get('BOLIVARES')).toBe('VES');
    expect(alias.get('DOLARES')).toBe('USD');
    expect(alias.get('€')).toBe('EUR');
    expect(alias.get('PESOS')).toBe('COP');
  });
});

describe('aceptaLetra — solo entran las letras que pueden formar una moneda', () => {
  const { alias } = mapasDeCalculo(REALES);
  const ok = (expr: string, letra: string) => aceptaLetra(expr, letra, alias);

  it('deja escribir las monedas del catálogo, letra por letra', () => {
    expect(ok('100 ', 'u')).toBe(true);      // USD / USDT
    expect(ok('100 u', 's')).toBe(true);
    expect(ok('100 us', 'd')).toBe(true);
    expect(ok('100 usd', 't')).toBe(true);   // USDT
    expect(ok('40 ', 'p')).toBe(true);       // PESOS
    expect(ok('5 ', 'e')).toBe(true);        // EUROS
    expect(ok('1 ', 'v')).toBe(true);        // VES
    expect(ok('1 ', 'b')).toBe(true);        // BS / BOLIVAR
    expect(ok('1 bolivare', 's')).toBe(true);
  });

  it('corta la letra que no lleva a ninguna moneda', () => {
    // «asdf» solo puede terminar en un error: mejor que la tecla no entre.
    expect(ok('100 ', 'x')).toBe(false);
    expect(ok('100 us', 'x')).toBe(false);
    expect(ok('100 ', 'z')).toBe(false);
    expect(ok('100 bol', 'x')).toBe(false);
  });

  it('los acentos no bloquean: dólar y dolar son lo mismo', () => {
    expect(ok('100 d', 'ó')).toBe(true);
    expect(ok('100 d', 'o')).toBe(true);
  });

  it('una moneda sin tasa deja de aceptarse', () => {
    // Si Binance no respondió, USDT no está en el catálogo y su «t» no entra.
    const { alias: sinUsdt } = mapasDeCalculo({ ...REALES, usdtVes: null });
    expect(aceptaLetra('100 usd', 't', sinUsdt)).toBe(false);
    expect(aceptaLetra('100 us', 'd', sinUsdt)).toBe(true);   // USD sigue
  });

  it('después de un símbolo o un operador se arranca de cero', () => {
    expect(ok('100 $ + 50 ', 'e')).toBe(true);
    expect(ok('100 $ + 50 ', 'x')).toBe(false);
  });
});

describe('el motor con las tasas reales de MGG', () => {
  const { alias, enBolivares } = mapasDeCalculo(REALES);
  const calc = (t: string) => calcular(t, alias, enBolivares, nombreDeCalculo, simboloDeCalculo);

  it('convierte dólares a bolívares al BCV del día', () => {
    expect(calc('100 $')!.valor.bs).toBeCloseTo(80739, 4);
  });

  it('el margen del paralelo sale de una división', () => {
    // Es el dato que la barra ya muestra; acá se puede calcular a mano.
    const r = calc('1 usdt / 1 $')!;
    expect(r.valor.dim).toBe(0);
    expect(r.valor.bs).toBeCloseTo(965.78 / 807.39, 6);
  });

  it('mezcla monedas pasando por bolívares', () => {
    expect(calc('100 $ + 50 €')!.valor.bs).toBeCloseTo(100 * 807.39 + 50 * 938.45, 4);
  });

  it('los miles con punto ya no se leen mal, ni con moneda', () => {
    // El caso que hacía inservible la calculadora anterior.
    expect(calc('2.000 $')!.valor.bs).toBeCloseTo(2000 * 807.39, 4);
  });

  it('cuando una moneda no tiene tasa, el motor no la inventa', () => {
    const sinUsdt = mapasDeCalculo({ ...REALES, usdtVes: null });
    expect(() => calcular('10 usdt', sinUsdt.alias, sinUsdt.enBolivares, nombreDeCalculo, simboloDeCalculo)).toThrow();
  });
});
