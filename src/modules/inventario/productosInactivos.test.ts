import { describe, it, expect } from 'vitest';
import type { Producto } from '@/shared/lib/types';
import { FILTRO_VACIO, coincideInactivo, diaDeBaja, inactivosFiltrados, opcionesDe } from './productosInactivos';

const prod = (p: Partial<Producto>): Producto => ({
  id: p.sku ?? 'x', sku: 'X-001', nombre: 'ALGO', categoria: 'VIVERES', unidad: 'UNIDAD',
  stock: 0, stock_min: 0, precio: 0, almacen: 'Los Pinos', estado: 'inactivo',
  created_at: '2026-01-01T00:00:00Z', ...p,
});

/** Los cinco vinagres que se unificaron en VIV-122, tal como quedaron en la base. */
const VINAGRES = [
  prod({ sku: 'VIV-072', nombre: 'VINAGRE 1 LTS', almacen: 'General', desactivado_en: '2026-09-09T20:10:00Z', desactivado_por: 'mineralgroupguayanaca@gmail.com', desactivado_motivo: 'Unificado en VIV-122 VINAGRE (litros)' }),
  prod({ sku: 'VIV-118', nombre: 'VINAGRE 5L GALON', unidad: 'GALON', desactivado_en: '2026-09-09T20:10:00Z', desactivado_por: 'mineralgroupguayanaca@gmail.com', desactivado_motivo: 'Unificado en VIV-122 VINAGRE (litros)' }),
  prod({ sku: 'LIM-055', nombre: 'CLORO VIEJO', categoria: 'LIMPIEZA' }), // baja vieja, sin registro
  prod({ sku: 'VIV-122', nombre: 'VINAGRE', unidad: 'LITRO', estado: 'activo' }), // el que sobrevive
];

describe('productos inactivos · qué se ve en el botón', () => {
  it('el producto activo no entra en la lista de bajas', () => {
    expect(inactivosFiltrados(VINAGRES, FILTRO_VACIO).map((p) => p.sku)).not.toContain('VIV-122');
  });

  it('trae solo los inactivos, con las bajas recientes primero', () => {
    expect(inactivosFiltrados(VINAGRES, FILTRO_VACIO).map((p) => p.sku))
      .toEqual(['VIV-072', 'VIV-118', 'LIM-055']);
  });

  it('busca por palabras sueltas cruzando nombre y unidad', () => {
    expect(coincideInactivo(VINAGRES[1], { ...FILTRO_VACIO, texto: 'vinagre galon' })).toBe(true);
    expect(coincideInactivo(VINAGRES[0], { ...FILTRO_VACIO, texto: 'vinagre galon' })).toBe(false);
  });

  it('busca también por el motivo de la baja y por quién la hizo', () => {
    expect(coincideInactivo(VINAGRES[0], { ...FILTRO_VACIO, texto: 'unificado' })).toBe(true);
    expect(coincideInactivo(VINAGRES[0], { ...FILTRO_VACIO, texto: 'mineralgroup' })).toBe(true);
  });

  it('filtra por categoría, unidad, almacén y quién lo dio de baja', () => {
    expect(inactivosFiltrados(VINAGRES, { ...FILTRO_VACIO, categoria: 'LIMPIEZA' }).map((p) => p.sku)).toEqual(['LIM-055']);
    expect(inactivosFiltrados(VINAGRES, { ...FILTRO_VACIO, unidad: 'GALON' }).map((p) => p.sku)).toEqual(['VIV-118']);
    expect(inactivosFiltrados(VINAGRES, { ...FILTRO_VACIO, almacen: 'General' }).map((p) => p.sku)).toEqual(['VIV-072']);
    expect(inactivosFiltrados(VINAGRES, { ...FILTRO_VACIO, porQuien: 'mineralgroupguayanaca@gmail.com' }).map((p) => p.sku))
      .toEqual(['VIV-072', 'VIV-118']);
  });

  it('filtra por rango de fechas, con los dos extremos incluidos', () => {
    const dentro = { ...FILTRO_VACIO, desde: '2026-09-09', hasta: '2026-09-09' };
    expect(inactivosFiltrados(VINAGRES, dentro).map((p) => p.sku)).toEqual(['VIV-072', 'VIV-118']);
    expect(inactivosFiltrados(VINAGRES, { ...FILTRO_VACIO, desde: '2026-09-10' })).toEqual([]);
  });

  it('una baja vieja sin fecha registrada no se cuela en un rango de fechas', () => {
    expect(diaDeBaja(VINAGRES[2])).toBe('');
    expect(coincideInactivo(VINAGRES[2], { ...FILTRO_VACIO, desde: '2020-01-01' })).toBe(false);
    expect(coincideInactivo(VINAGRES[2], FILTRO_VACIO)).toBe(true);
  });

  it('los desplegables solo ofrecen valores que existen entre los inactivos', () => {
    expect(opcionesDe(VINAGRES, 'unidad')).toEqual(['GALON', 'UNIDAD']);
    expect(opcionesDe(VINAGRES, 'categoria')).toEqual(['LIMPIEZA', 'VIVERES']);
    expect(opcionesDe(VINAGRES, 'desactivado_por')).toEqual(['mineralgroupguayanaca@gmail.com']);
  });
});
