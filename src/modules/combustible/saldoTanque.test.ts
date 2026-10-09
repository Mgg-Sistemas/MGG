import { describe, expect, it } from 'vitest';
import { errorSurtido, litrosTrasSurtido, puedeSurtir } from './saldoTanque';

describe('errorSurtido', () => {
  it('deja pasar un surtido que cabe en el tanque', () => {
    expect(errorSurtido(100, 40)).toBeNull();
    expect(errorSurtido('100', '40')).toBeNull();
    expect(errorSurtido(100, '40,5')).toBeNull();
  });

  it('deja surtir exactamente lo que hay (el tanque queda en 0, no en negativo)', () => {
    expect(errorSurtido(100, 100)).toBeNull();
    expect(errorSurtido(0.3, 0.1 + 0.2)).toBeNull();
  });

  it('rechaza el tanque en 0 L aunque todavía no hayan tecleado los litros', () => {
    expect(errorSurtido(0, 0)).toMatch(/está en 0 L/);
    expect(errorSurtido(0, 10)).toMatch(/está en 0 L/);
    expect(errorSurtido(null, 10)).toMatch(/está en 0 L/);
    expect(errorSurtido('', 10)).toMatch(/está en 0 L/);
  });

  it('rechaza un saldo negativo en la base como si fuera cero', () => {
    expect(errorSurtido(-5, 1)).toMatch(/está en 0 L/);
  });

  it('rechaza pedir más litros de los que hay y muestra los dos números', () => {
    const msg = errorSurtido(50, 60);
    expect(msg).toMatch(/no alcanza/);
    expect(msg).toContain('50');
    expect(msg).toContain('60');
    expect(msg).toMatch(/no puede quedar en negativo/);
  });

  it('con litros vacíos o en 0 no opina: eso lo dice el formulario', () => {
    expect(errorSurtido(50, 0)).toBeNull();
    expect(errorSurtido(50, '')).toBeNull();
    expect(errorSurtido(50, null)).toBeNull();
    expect(errorSurtido(50, 'abc')).toBeNull();
  });

  it('nombra el tanque cuando se lo pasan', () => {
    expect(errorSurtido(0, 5, 'TAMBOR ROJO')).toContain('"TAMBOR ROJO"');
    expect(errorSurtido(5, 9, 'TAMBOR ROJO')).toContain('"TAMBOR ROJO"');
    expect(errorSurtido(0, 5, '  ')).not.toContain('"');
  });

  it('no se deja engañar por ruido de decimales', () => {
    expect(errorSurtido(10, 10.00001)).toBeNull();
    expect(errorSurtido(10, 10.01)).toMatch(/no alcanza/);
    expect(errorSurtido(0.00005, 0)).toMatch(/está en 0 L/);
  });
});

describe('puedeSurtir', () => {
  it('solo con litros cargados y que caben', () => {
    expect(puedeSurtir(100, 40)).toBe(true);
    expect(puedeSurtir(100, 100)).toBe(true);
    expect(puedeSurtir(100, 0)).toBe(false);
    expect(puedeSurtir(100, '')).toBe(false);
    expect(puedeSurtir(100, 101)).toBe(false);
    expect(puedeSurtir(0, 1)).toBe(false);
  });
});

describe('litrosTrasSurtido', () => {
  it('es lo que queda en el tanque, con dos decimales', () => {
    expect(litrosTrasSurtido(100, 40)).toBe(60);
    expect(litrosTrasSurtido(100, 100)).toBe(0);
    expect(litrosTrasSurtido('100,5', '0,25')).toBe(100.25);
  });

  it('no inventa el resultado de un decimal binario', () => {
    expect(litrosTrasSurtido(0.3, 0.1)).toBe(0.2);
  });

  it('es null cuando el surtido no es válido', () => {
    expect(litrosTrasSurtido(100, 0)).toBeNull();
    expect(litrosTrasSurtido(0, 5)).toBeNull();
    expect(litrosTrasSurtido(50, 60)).toBeNull();
  });
});
