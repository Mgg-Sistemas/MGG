import { describe, it, expect } from 'vitest';
import type { Producto } from '@/shared/lib/types';
import { filtrarInsumos, textoDeInsumo } from './buscarInsumo';
import { coincideTodo, formasDeNumero, normalizarBusqueda } from '@/shared/lib/buscar';

function prod(p: Partial<Producto> = {}): Producto {
  return {
    id: 'id-1', sku: 'MP-001', nombre: 'COQUE METALURGICO', categoria: 'MP',
    unidad: 'KILOGRAMO', estado: 'activo',
    ...p,
  } as Producto;
}

const insumos = [
  prod({ id: 'a', sku: 'MP-014', nombre: 'CARBONATO DE CALCIO (CACO₃) M200', categoria: 'MP' }),
  prod({ id: 'b', sku: 'MP-019', nombre: 'CARBON VEGETAL', categoria: 'MP' }),
  prod({ id: 'c', sku: 'MIN-001', nombre: 'ESCOREA DE CASITERITA', categoria: 'MINERALES' }),
  prod({ id: 'd', sku: 'MP-007', nombre: 'TETRABORATO DE SODIO (BORAX)', categoria: 'MP' }),
];

const datos = (p: Producto) => ({
  a: { almacen: 'Materias Primas', disponible: 3363 },
  b: { almacen: 'General', disponible: 443.44 },
  c: { almacen: 'General', disponible: 0 },
  d: { almacen: 'General', disponible: 24, enPiso: true },
}[p.id] ?? {});

describe('la base de la búsqueda', () => {
  it('normaliza acentos y mayúsculas', () => {
    expect(normalizarBusqueda('  CARBÓN Vegetal ')).toBe('carbon vegetal');
  });

  it('sin búsqueda, todo coincide', () => {
    expect(coincideTodo('lo que sea', '')).toBe(true);
    expect(coincideTodo('lo que sea', '   ')).toBe(true);
  });

  it('exige todas las palabras, en cualquier orden', () => {
    expect(coincideTodo('carbon vegetal general', 'vegetal carbon')).toBe(true);
    expect(coincideTodo('carbon vegetal general', 'carbon mineral')).toBe(false);
  });

  it('un número se guarda como se ve y como se teclea', () => {
    const f = formasDeNumero(3363);
    expect(f).toContain('3.363,00');
    expect(f).toContain('3363,00');
    expect(f).toContain('3363.00');
  });

  it('un número vacío no aporta texto', () => {
    expect(formasDeNumero(null)).toBe('');
    expect(formasDeNumero(undefined)).toBe('');
  });
});

describe('qué se puede buscar de un insumo', () => {
  it('nombre, SKU, categoría y almacén', () => {
    const t = textoDeInsumo(insumos[0], datos(insumos[0]));
    expect(t).toContain('carbonato');
    expect(t).toContain('mp-014');
    expect(t).toContain('materias primas');
  });

  it('marca el que no tiene stock', () => {
    expect(textoDeInsumo(insumos[2], datos(insumos[2]))).toContain('sin stock');
    expect(textoDeInsumo(insumos[0], datos(insumos[0]))).toContain('con stock');
  });

  it('marca el que está en el piso de fundición', () => {
    expect(textoDeInsumo(insumos[3], datos(insumos[3]))).toContain('piso');
  });

  it('sin datos de pantalla igual se puede buscar por la ficha', () => {
    expect(textoDeInsumo(insumos[1])).toContain('carbon vegetal');
  });
});

describe('el filtro de insumos', () => {
  it('sin texto devuelve todos', () => {
    expect(filtrarInsumos(insumos, '', datos)).toHaveLength(4);
    expect(filtrarInsumos(insumos, '  ', datos)).toHaveLength(4);
  });

  it('busca por nombre sin importar acentos', () => {
    expect(filtrarInsumos(insumos, 'vegetal', datos).map((p) => p.id)).toEqual(['b']);
    expect(filtrarInsumos(insumos, 'CACO', datos).map((p) => p.id)).toEqual(['a']);
  });

  it('busca por pedazo de palabra: «carbon» trae CARBONATO y CARBON VEGETAL', () => {
    // Es lo que se quiere: quien escribe media palabra ve las dos y elige.
    expect(filtrarInsumos(insumos, 'carbon', datos).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('busca por SKU', () => {
    expect(filtrarInsumos(insumos, 'mp-007', datos).map((p) => p.id)).toEqual(['d']);
    expect(filtrarInsumos(insumos, 'MIN', datos).map((p) => p.id)).toEqual(['c']);
  });

  it('busca por categoría', () => {
    expect(filtrarInsumos(insumos, 'minerales', datos).map((p) => p.id)).toEqual(['c']);
  });

  it('busca por almacén', () => {
    expect(filtrarInsumos(insumos, 'materias primas', datos).map((p) => p.id)).toEqual(['a']);
  });

  it('busca por disponible, escrito como se ve o como se piensa', () => {
    expect(filtrarInsumos(insumos, '443,44', datos).map((p) => p.id)).toEqual(['b']);
    expect(filtrarInsumos(insumos, '3363', datos).map((p) => p.id)).toEqual(['a']);
  });

  it('«sin stock» trae los agotados', () => {
    expect(filtrarInsumos(insumos, 'sin stock', datos).map((p) => p.id)).toEqual(['c']);
  });

  it('«piso» trae lo ya entregado a fundición', () => {
    expect(filtrarInsumos(insumos, 'piso', datos).map((p) => p.id)).toEqual(['d']);
  });

  it('varias palabras se exigen todas', () => {
    // «carbon» está en CARBONATO y en CARBON VEGETAL; el almacén desempata.
    expect(filtrarInsumos(insumos, 'carbon general', datos).map((p) => p.id)).toEqual(['b']);
    expect(filtrarInsumos(insumos, 'carbon materias', datos).map((p) => p.id)).toEqual(['a']);
    expect(filtrarInsumos(insumos, 'vegetal materias', datos)).toHaveLength(0);
  });

  it('lo que no está no aparece', () => {
    expect(filtrarInsumos(insumos, 'zanahoria', datos)).toHaveLength(0);
  });

  it('conserva el orden original', () => {
    expect(filtrarInsumos(insumos, 'mp-', datos).map((p) => p.id)).toEqual(['a', 'b', 'd']);
  });
});
