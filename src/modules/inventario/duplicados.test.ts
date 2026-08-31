import { describe, it, expect } from 'vitest';
import {
  hayExacto, normalizarNombre, parecidoNombre, productosSimilares, tokensNombre,
  type ProductoComparable,
} from './duplicados';

const p = (id: string, sku: string, nombre: string, extra: Partial<ProductoComparable> = {}): ProductoComparable =>
  ({ id, sku, nombre, estado: 'activo', ...extra });

// Duplicados reales del catálogo de producción.
const CATALOGO: ProductoComparable[] = [
  p('1', 'INS-001', 'PINTURA EPOXICA GRIS', { almacen: 'General' }),
  p('2', 'INS-088', 'PINTURA EPÓXICA GRIS', { almacen: 'Los Pinos' }),
  p('3', 'MIN-CASITERITA', 'CASITERITA', { almacen: 'CASITERITA LOS PINOS' }),
  p('4', 'SNO2', 'CASITERITA (SNO2)', { almacen: 'General' }),
  p('5', 'VIV-012', 'HARINA DE MAIZ PAN', { almacen: 'Viveres y Art. Limpieza' }),
  p('6', 'COMB-01', 'DIESEL', { almacen: 'General' }),
  p('7', 'REP-441', 'FILTRO DE ACEITE CATERPILLAR', { marca: 'CAT' }),
  p('8', 'REP-442', 'FILTRO DE AIRE CATERPILLAR', { marca: 'CAT' }),
];

describe('normalizarNombre', () => {
  it('ignora acentos, mayúsculas, signos y espacios de más', () => {
    expect(normalizarNombre('Pintura Epóxica  Gris')).toBe('PINTURA EPOXICA GRIS');
    expect(normalizarNombre('Harina P.A.N.')).toBe('HARINA P A N');
    expect(normalizarNombre('  DIÉSEL ')).toBe('DIESEL');
    expect(normalizarNombre(null)).toBe('');
  });
});

describe('tokensNombre', () => {
  it('descarta las palabras de relleno y las unidades', () => {
    expect(tokensNombre('HARINA DE MAIZ x KG')).toEqual(['HARINA', 'MAIZ']);
    expect(tokensNombre('SACO DE CEMENTO')).toEqual(['CEMENTO']);
  });
});

describe('parecidoNombre', () => {
  it('el mismo nombre con otra tipografía da 1', () => {
    expect(parecidoNombre('PINTURA EPOXICA GRIS', 'Pintura Epóxica Gris')).toBe(1);
  });

  it('reconoce el genérico dentro del nombre largo', () => {
    expect(parecidoNombre('HARINA PAN', 'HARINA DE MAIZ PAN')).toBe(1);
  });

  it('no confunde materiales distintos que comparten una palabra', () => {
    // FILTRO y CATERPILLAR se comparten, ACEITE/AIRE no: 2 de 3 tokens.
    expect(parecidoNombre('FILTRO DE ACEITE CATERPILLAR', 'FILTRO DE AIRE CATERPILLAR')).toBeCloseTo(2 / 3, 5);
    expect(parecidoNombre('TORNILLO', 'CEMENTO')).toBe(0);
  });

  it('un nombre vacío no se parece a nada', () => {
    expect(parecidoNombre('', 'CEMENTO')).toBe(0);
    expect(parecidoNombre('CEMENTO', null)).toBe(0);
  });
});

describe('productosSimilares', () => {
  it('detecta el duplicado exacto que solo cambia el acento', () => {
    const dups = productosSimilares('PINTURA EPOXICA GRIS', CATALOGO);
    expect(dups[0].producto.sku).toBe('INS-001');
    expect(dups[0].nivel).toBe('exacto');
    expect(hayExacto(dups)).toBe(true);
    // Los dos duplicados del catálogo aparecen.
    expect(dups.filter((d) => d.nivel === 'exacto')).toHaveLength(2);
  });

  it('el caso de la harina: ya existe en otra sede, no hay que crearla de nuevo', () => {
    const dups = productosSimilares('HARINA PAN', CATALOGO);
    expect(dups.map((d) => d.producto.sku)).toContain('VIV-012');
    expect(dups[0].producto.almacen).toBe('Viveres y Art. Limpieza');
  });

  it('reconoce el SKU cargado con el nombre químico', () => {
    const dups = productosSimilares('CASITERITA', CATALOGO);
    expect(dups.map((d) => d.producto.sku)).toEqual(expect.arrayContaining(['MIN-CASITERITA', 'SNO2']));
  });

  it('no avisa por un material realmente nuevo', () => {
    expect(productosSimilares('GUANTES DE CARNAZA', CATALOGO)).toEqual([]);
  });

  it('con menos de 3 letras todavía no se molesta al usuario', () => {
    expect(productosSimilares('PI', CATALOGO)).toEqual([]);
    expect(productosSimilares('', CATALOGO)).toEqual([]);
  });

  it('al editar no se sugiere a sí mismo', () => {
    const dups = productosSimilares('PINTURA EPOXICA GRIS', CATALOGO, { excluirId: '1' });
    expect(dups.map((d) => d.producto.id)).not.toContain('1');
    expect(dups.map((d) => d.producto.id)).toContain('2');
  });

  it('respeta el límite y ordena del más parecido al menos', () => {
    const dups = productosSimilares('FILTRO CATERPILLAR', CATALOGO, { limite: 1 });
    expect(dups).toHaveLength(1);
    expect(dups[0].score).toBeGreaterThanOrEqual(0.6);
  });

  it('también compara contra el nombre de búsqueda cargado en la ficha', () => {
    const cat = [p('9', 'VIV-099', 'ACEITE VATEL', { nombre_busqueda: 'ACEITE DE COCINA' })];
    const dups = productosSimilares('ACEITE DE COCINA', cat);
    expect(dups).toHaveLength(1);
    expect(dups[0].nivel).toBe('exacto');
  });
});
