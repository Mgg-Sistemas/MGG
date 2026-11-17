import { describe, expect, it } from 'vitest';
import { calcularFaov, tierPorTrabajadores, factoresValidos, FAOV_TIERS } from './administracionParafiscal';

describe('parafiscales FAOV', () => {
  it('elige el factor por el tamaño de la nómina', () => {
    expect(tierPorTrabajadores(0).factor).toBe(165);
    expect(tierPorTrabajadores(50).factor).toBe(165);
    expect(tierPorTrabajadores(51).factor).toBe(330);
    expect(tierPorTrabajadores(100).factor).toBe(330);
    expect(tierPorTrabajadores(101).factor).toBe(1000);
    expect(tierPorTrabajadores(500).factor).toBe(1000);
  });

  it('total = factor × tasa de referencia (Bs), a 2 decimales', () => {
    expect(calcularFaov(165, 997.9222043)).toBe(164657.16);
    expect(calcularFaov(330, 1000)).toBe(330000);
    expect(calcularFaov(1000, 40)).toBe(40000);
  });
});

describe('factores ajustables · si cambia la Gaceta no hay que tocar codigo', () => {
  const nuevos = [
    { nivel: 'hasta50' as const, factor: 200, label: 'Nómina ≤ 50 trabajadores' },
    { nivel: 'hasta100' as const, factor: 400, label: 'Nómina 51–100 trabajadores' },
    { nivel: 'mas100' as const, factor: 1200, label: 'Nómina > 100 trabajadores' },
  ];

  it('con factores propios, el tramo devuelve el factor nuevo', () => {
    expect(tierPorTrabajadores(30, nuevos).factor).toBe(200);
    expect(tierPorTrabajadores(80, nuevos).factor).toBe(400);
    expect(tierPorTrabajadores(300, nuevos).factor).toBe(1200);
  });

  it('sin factores propios sigue usando los de la Gaceta vigente', () => {
    expect(tierPorTrabajadores(30).factor).toBe(165);
  });

  it('acepta unos factores completos y bien formados', () => {
    expect(factoresValidos(nuevos)).toBe(true);
    expect(factoresValidos(FAOV_TIERS)).toBe(true);
  });

  it('rechaza lo que no sirve, para no guardar basura', () => {
    expect(factoresValidos(null)).toBe(false);
    expect(factoresValidos([])).toBe(false);
    expect(factoresValidos([{ nivel: 'hasta50', factor: 0, label: 'x' }])).toBe(false);
    expect(factoresValidos([...nuevos.slice(0, 2)])).toBe(false);
    expect(factoresValidos([{ ...nuevos[0], factor: -5 }, nuevos[1], nuevos[2]])).toBe(false);
  });
});
