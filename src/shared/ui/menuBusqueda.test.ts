import { describe, expect, it } from 'vitest';
import { coincideMenu } from './menuBusqueda';

describe('buscador del menú', () => {
  it('sin texto se ve todo', () => {
    expect(coincideMenu('Tesorería', '')).toBe(true);
    expect(coincideMenu('Tesorería', '   ')).toBe(true);
  });
  it('sin acentos ni mayúsculas, por partes del nombre', () => {
    expect(coincideMenu('Tesorería', 'tesoreria')).toBe(true);
    expect(coincideMenu('Conciliación', 'CONCIL')).toBe(true);
    expect(coincideMenu('Pedidos / Compras', 'compras')).toBe(true);
    expect(coincideMenu('Depósito', 'deposito')).toBe(true);
  });
  it('varias palabras: todas deben estar', () => {
    expect(coincideMenu('Control de Maquinaria y Vehículos', 'maquinaria vehiculos')).toBe(true);
    expect(coincideMenu('Control de Maquinaria y Vehículos', 'maquinaria nomina')).toBe(false);
    expect(coincideMenu('Ventas', 'retenciones')).toBe(false);
  });
});
