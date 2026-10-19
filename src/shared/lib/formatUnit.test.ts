import { describe, expect, it } from 'vitest';
import { money, moneyUnit } from './format';

describe('moneyUnit · precio unitario', () => {
  it('muestra 2 decimales cuando alcanzan', () => {
    expect(moneyUnit(10.26, 'Bs')).toBe(money(10.26, 'Bs'));
    expect(moneyUnit(8.7, 'USD')).toBe(money(8.7, 'USD'));
  });
  it('muestra hasta 4 cuando el proveedor cotizó más precisión', () => {
    expect(moneyUnit(10.2648, 'Bs')).toBe(money(10.2648, 'Bs').replace('10,26', '10,2648'));
    expect(moneyUnit(10.2648, 'Bs')).toContain('10,2648');
  });
  it('cantidad × precio unitario guardado = total de la oferta', () => {
    const precio = Math.round(10.2648 * 10000) / 10000;
    expect(Math.round(105 * precio * 100) / 100).toBe(1077.8);
  });
  it('sin dato', () => {
    expect(moneyUnit(null)).toBe('—');
  });
});
