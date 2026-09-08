import { describe, it, expect } from 'vitest';
import {
  almacenVentaInicial, almacenesDeVenta, existenciaEn, productosVendibles,
} from './almacenVenta';

type Alm = { nombre: string; sede: string | null; parent_id: string | null; estado: 'activo' | 'inactivo' };
const alm = (nombre: string, sede: string, estado: 'activo' | 'inactivo' = 'activo'): Alm =>
  ({ nombre, sede, parent_id: null, estado });

// Los almacenes activos tal como quedaron después de consolidar Matanza.
const ALMACENES: Alm[] = [
  alm('General', 'CENTRO DE FUNDICION - MATANZAS'),
  alm('COMBUSTIBLE', 'CENTRO DE FUNDICION - MATANZAS'),
  alm('ESTAÑO EN BRUTO', 'CENTRO DE FUNDICION - MATANZAS'),
  alm('Los Pinos', 'LOS PINOS'),
  alm('SNO₂ CASITERITA ALMACEN', 'LOS PINOS'),
  alm('Viveres y Productos de Limpieza', 'CENTRO DE FUNDICION - MATANZAS', 'inactivo'),
];

type Prod = { id: string; estado: 'activo' | 'inactivo'; nombre: string };
const PRODUCTOS: Prod[] = [
  { id: 'p1', estado: 'activo', nombre: 'ARROZ' },
  { id: 'p2', estado: 'activo', nombre: 'CASITERITA' },
  { id: 'p3', estado: 'inactivo', nombre: 'A' },        // la ficha basura VIV-074
  { id: 'p4', estado: 'activo', nombre: 'SIN STOCK' },
];

const EXISTENCIAS = [
  { producto_id: 'p1', almacen: 'General', stock: 70, costo_promedio: 1.5 },
  { producto_id: 'p2', almacen: 'SNO₂ CASITERITA ALMACEN', stock: 48780.44, costo_promedio: 18.74 },
  { producto_id: 'p3', almacen: 'General', stock: 5, costo_promedio: 0 },  // inactiva PERO con stock
  { producto_id: 'p4', almacen: 'General', stock: 0, costo_promedio: 3 },
];

describe('almacén de la venta', () => {
  it('una factura nueva arranca en el padre de Matanza', () => {
    expect(almacenVentaInicial(ALMACENES)).toBe('General');
  });

  it('si Matanza se quedara sin almacén activo, cae al primero en vez de quedar en blanco', () => {
    const soloPinos = ALMACENES.filter((a) => a.sede === 'LOS PINOS');
    expect(almacenVentaInicial(soloPinos)).toBe('Los Pinos');
    expect(almacenVentaInicial([])).toBe('');
  });

  it('ofrece los padres y los almacenes de mineral, nunca los subalmacenes comunes', () => {
    const nombres = almacenesDeVenta(ALMACENES).flatMap(([, ds]) => ds.map((d) => d.nombre));
    expect(nombres).toContain('General');
    expect(nombres).toContain('Los Pinos');
    // Sin este, los 48.780 kg de casiterita no se podrían vender.
    expect(nombres).toContain('SNO₂ CASITERITA ALMACEN');
    expect(nombres).not.toContain('COMBUSTIBLE');
    expect(nombres).not.toContain('Viveres y Productos de Limpieza');
  });
});

describe('qué productos se pueden vender', () => {
  it('desde Matanza solo lo que tiene stock ahí', () => {
    expect(productosVendibles(PRODUCTOS, EXISTENCIAS, 'General').map((p) => p.nombre)).toEqual(['ARROZ']);
  });

  it('una ficha inactiva no se ofrece aunque tenga stock', () => {
    // Este es el caso que se veía en pantalla: «A (VIV-074)», inactiva.
    const ids = productosVendibles(PRODUCTOS, EXISTENCIAS, 'General').map((p) => p.id);
    expect(ids).not.toContain('p3');
  });

  it('la casiterita se vende desde su almacén de mineral', () => {
    expect(productosVendibles(PRODUCTOS, EXISTENCIAS, 'SNO₂ CASITERITA ALMACEN').map((p) => p.nombre))
      .toEqual(['CASITERITA']);
  });

  it('sin almacén elegido no se ofrece nada', () => {
    expect(productosVendibles(PRODUCTOS, EXISTENCIAS, '')).toEqual([]);
  });

  it('un producto con existencia en 0 no cuenta como vendible', () => {
    expect(productosVendibles(PRODUCTOS, EXISTENCIAS, 'General').map((p) => p.id)).not.toContain('p4');
  });
});

describe('existenciaEn', () => {
  it('trae el stock y el PMP del almacén elegido', () => {
    expect(existenciaEn(EXISTENCIAS, 'p2', 'SNO₂ CASITERITA ALMACEN')).toEqual({ stock: 48780.44, costo: 18.74 });
  });

  it('el mismo producto en otro almacén da 0, no el costo del otro', () => {
    expect(existenciaEn(EXISTENCIAS, 'p2', 'General')).toEqual({ stock: 0, costo: 0 });
  });

  it('tolera producto nulo y lista vacía', () => {
    expect(existenciaEn([], 'p1', 'General')).toEqual({ stock: 0, costo: 0 });
    expect(existenciaEn(EXISTENCIAS, null, 'General')).toEqual({ stock: 0, costo: 0 });
  });
});
