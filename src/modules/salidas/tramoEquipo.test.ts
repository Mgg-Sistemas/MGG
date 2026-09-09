import { describe, it, expect, vi } from 'vitest';
import type { ItemSolicitudSalida } from '@/shared/lib/types';

// El repositorio arrastra al cliente de Supabase; acá solo se prueba una función pura.
vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }));

const { tramoDesdeLinea } = await import('./salidas.repository');

const linea = (extra: Partial<ItemSolicitudSalida> = {}): ItemSolicitudSalida => ({
  producto_id: 'p-1',
  producto_nombre: 'FILTRO LF17356 ENCAVA',
  cantidad: 5,
  precio_unit: 12.5,
  unidad: 'UND',
  almacen: 'Los Pinos',
  ...extra,
});

describe('tramoDesdeLinea', () => {
  it('lleva el equipo al tramo: sin esto la máquina nunca se entera del consumo', () => {
    const t = tramoDesdeLinea(linea({ equipo_id: 'eq-1', equipo_nombre: 'ENCAVA EP02' }), 'Los Pinos', 3);
    expect(t.equipo_id).toBe('eq-1');
    expect(t.equipo_nombre).toBe('ENCAVA EP02');
  });

  it('parte la línea entre dos almacenes y los dos tramos conservan el mismo equipo', () => {
    const l = linea({ cantidad: 8, equipo_id: 'eq-1', equipo_nombre: 'ENCAVA EP02' });
    const a = tramoDesdeLinea(l, 'Los Pinos', 5);
    const b = tramoDesdeLinea(l, 'General', 3);
    expect([a.almacen, b.almacen]).toEqual(['Los Pinos', 'General']);
    expect([a.cantidad, b.cantidad]).toEqual([5, 3]);
    expect(a.equipo_nombre).toBe('ENCAVA EP02');
    expect(b.equipo_nombre).toBe('ENCAVA EP02');
  });

  it('una salida sin equipo sigue siendo válida: el campo es opcional', () => {
    const t = tramoDesdeLinea(linea(), 'General', 2);
    expect(t.equipo_id).toBeNull();
    expect(t.equipo_nombre).toBeNull();
  });

  it('el tramo toma el almacén y la cantidad que se le pasan, no los de la línea', () => {
    const t = tramoDesdeLinea(linea({ almacen: 'Los Pinos', cantidad: 5 }), 'General', 2);
    expect(t.almacen).toBe('General');
    expect(t.cantidad).toBe(2);
  });

  it('conserva producto, nombre y precio para que el kardex y el costo no cambien', () => {
    const t = tramoDesdeLinea(linea(), 'Los Pinos', 1);
    expect(t.producto_id).toBe('p-1');
    expect(t.producto_nombre).toBe('FILTRO LF17356 ENCAVA');
    expect(t.precio_unit).toBe(12.5);
  });
});
