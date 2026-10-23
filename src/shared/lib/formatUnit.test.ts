import { describe, expect, it } from 'vitest';
import { money, moneyUnit, formatoCI } from './format';

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

describe('formatoCI · separador de miles con puntos en la cédula', () => {
  it('formatea números simples colocando los puntos de miles', () => {
    expect(formatoCI('7514385')).toBe('7.514.385');
    expect(formatoCI(7514385)).toBe('7.514.385');
    expect(formatoCI('27514395')).toBe('27.514.395');
  });
  it('preserva el prefijo V- o E- si ya lo tiene', () => {
    expect(formatoCI('V-7514385')).toBe('V-7.514.385');
    expect(formatoCI('E-12345678')).toBe('E-12.345.678');
    expect(formatoCI('V 7514385')).toBe('V-7.514.385');
  });
  it('es idempotente si ya viene con puntos', () => {
    expect(formatoCI('7.514.385')).toBe('7.514.385');
    expect(formatoCI('V-7.514.385')).toBe('V-7.514.385');
  });
  it('maneja valores vacíos o nulos', () => {
    expect(formatoCI('')).toBe('—');
    expect(formatoCI(null)).toBe('—');
    expect(formatoCI(undefined)).toBe('—');
  });
});

