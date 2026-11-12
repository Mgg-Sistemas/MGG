import { describe, expect, it } from 'vitest';
import type { Producto } from '@/shared/lib/types';
import {
  cantidadesPrevias, entraPorCategoria, errorPlantilla, estadoFija, renglonesDePlantilla, siguienteFecha, textoEstadoFija, textoFrecuencia,
} from './comprasFijas';

const prod = (id: string, categoria: string, estado = 'activo'): Producto =>
  ({ id, sku: `SKU-${id}`, nombre: `P${id}`, categoria, unidad: 'KG', estado } as unknown as Producto);

describe('compras fijas', () => {
  it('la próxima fecha corre un período y salta lo vencido', () => {
    expect(siguienteFecha({ frecuencia: 'semanal', cada_dias: null, proxima_fecha: '2026-11-12' }, '2026-11-12')).toBe('2026-11-19');
    // Generada antes de tiempo: igual corre un período desde la que tocaba.
    expect(siguienteFecha({ frecuencia: 'semanal', cada_dias: null, proxima_fecha: '2026-11-15' }, '2026-11-12')).toBe('2026-11-22');
    // Vencida hace semanas: queda en la primera fecha después de hoy.
    expect(siguienteFecha({ frecuencia: 'semanal', cada_dias: null, proxima_fecha: '2026-10-01' }, '2026-11-12')).toBe('2026-11-19');
    expect(siguienteFecha({ frecuencia: 'quincenal', cada_dias: null, proxima_fecha: '2026-11-12' }, '2026-11-12')).toBe('2026-11-27');
    expect(siguienteFecha({ frecuencia: 'cada_dias', cada_dias: 10, proxima_fecha: '2026-11-12' }, '2026-11-12')).toBe('2026-11-22');
    // Mensual: el 31 cae en el último día del mes siguiente.
    expect(siguienteFecha({ frecuencia: 'mensual', cada_dias: null, proxima_fecha: '2027-01-31' }, '2027-01-31')).toBe('2027-02-28');
    expect(siguienteFecha({ frecuencia: 'mensual', cada_dias: null, proxima_fecha: '2026-11-12' }, '2026-11-12')).toBe('2026-12-12');
  });

  it('semáforo de la tarjeta', () => {
    expect(estadoFija({ activa: true, proxima_fecha: '2026-11-10' }, '2026-11-12')).toBe('vencida');
    expect(textoEstadoFija({ activa: true, proxima_fecha: '2026-11-10' }, '2026-11-12')).toBe('Vencida hace 2 días');
    expect(estadoFija({ activa: true, proxima_fecha: '2026-11-12' }, '2026-11-12')).toBe('hoy');
    expect(estadoFija({ activa: true, proxima_fecha: '2026-11-15' }, '2026-11-12')).toBe('pronto');
    expect(estadoFija({ activa: true, proxima_fecha: '2026-12-15' }, '2026-11-12')).toBe('al_dia');
    expect(estadoFija({ activa: false, proxima_fecha: '2026-11-01' }, '2026-11-12')).toBe('pausada');
    expect(textoFrecuencia({ frecuencia: 'cada_dias', cada_dias: 20 })).toBe('Cada 20 días');
  });

  it('arma los renglones por categoría y lista fija, con las cantidades de la última vez', () => {
    expect(entraPorCategoria('PAPELERÍA Y OFICINA', ['papeleria'])).toBe(true);
    const productos = [prod('1', 'PAPELERIA'), prod('2', 'LIMPIEZA'), prod('3', 'FERRETERIA'), prod('4', 'PAPELERIA', 'inactivo'), prod('5', 'OTROS')];
    const previas = cantidadesPrevias([{ productoId: '1', sku: 'SKU-1', cantidad: 6 }, { productoId: '5', sku: 'SKU-5', cantidad: 2 }]);
    const r = renglonesDePlantilla({
      categorias: ['papel'], finalidad: 'COMPRA FIJA',
      productos: [{ producto_id: '3', sku: 'SKU-3', nombre: 'P3', unidad: 'UND', cantidad: 4 }],
    }, productos, previas);
    expect(r.map((x) => [x.productoId, x.cantidad])).toEqual([['3', 4], ['1', 6], ['5', 2]]);
    expect(r[0].finalidad).toBe('COMPRA FIJA');
  });

  it('valida la plantilla', () => {
    const base = { nombre: 'Papelería', frecuencia: 'mensual' as const, cada_dias: null, proxima_fecha: '2026-11-12', categorias: ['papel'], productos: [] };
    expect(errorPlantilla(base)).toBeNull();
    expect(errorPlantilla({ ...base, nombre: 'Pa' })).toMatch(/nombre/);
    expect(errorPlantilla({ ...base, categorias: [] })).toMatch(/categoría o un producto/);
    expect(errorPlantilla({ ...base, frecuencia: 'cada_dias' })).toMatch(/cada cuántos/);
  });

  it('MGG: una sugerencia sin configurar no toca ni avisa, aunque su fecha esté vencida', () => {
    const sug = { activa: false, sugerida: true, proxima_fecha: '2026-11-01' };
    expect(estadoFija(sug, '2026-11-12')).toBe('sugerida');
    expect(textoEstadoFija(sug, '2026-11-12')).toMatch(/Sugerencia/);
    // Configurada (guardada): vuelve al semáforo normal.
    expect(estadoFija({ ...sug, activa: true, sugerida: false }, '2026-11-12')).toBe('vencida');
  });
});
