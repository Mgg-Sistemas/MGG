import { describe, it, expect } from 'vitest';
import { prefijoCategoria, siguienteSku } from './inventario.repository';
import type { Producto } from '@/shared/lib/types';

const p = (sku: string, categoria: string): Producto =>
  ({ id: sku, sku, nombre: sku, categoria, unidad: 'UNIDAD', estado: 'activo' } as unknown as Producto);

// El catálogo real después de darle un prefijo propio a cada categoría.
const CATALOGO = [
  p('MAT-001', 'MATERIALES'), p('MAT-096', 'MATERIALES'),
  p('EMB-001', 'MATERIAL DE EMBALAJE'),
  p('MTO-001', 'MATERIALES DE OFICINA'),
  p('HRN-001', 'HORNO'), p('HTL-001', 'HORTALIZAS Y LEGUMBRES'),
  p('PLO-043', 'PLOMERIA'), p('VIV-114', 'VIVERES'),
];

describe('prefijoCategoria', () => {
  it('una categoría que ya tiene productos conserva su prefijo', () => {
    expect(prefijoCategoria('MATERIALES', CATALOGO)).toBe('MAT');
    expect(prefijoCategoria('MATERIAL DE EMBALAJE', CATALOGO)).toBe('EMB');
    expect(prefijoCategoria('HORTALIZAS Y LEGUMBRES', CATALOGO)).toBe('HTL');
  });

  it('una categoría nueva NO se roba el prefijo de otra', () => {
    // «MAT» ya es de MATERIALES: MATERIA PRIMA no puede quedarse con él.
    const pre = prefijoCategoria('MATERIA PRIMA', CATALOGO);
    expect(pre).not.toBe('MAT');
    expect(pre).toHaveLength(3);
  });

  it('cae en las iniciales cuando las tres primeras letras están tomadas', () => {
    // MATERIALES DE SEGURIDAD → MAT tomado → iniciales MDS.
    expect(prefijoCategoria('MATERIALES DE SEGURIDAD', CATALOGO)).toBe('MDS');
  });

  it('sin colisión usa las tres primeras letras', () => {
    expect(prefijoCategoria('LUBRICANTES', CATALOGO)).toBe('LUB');
    expect(prefijoCategoria('QUIMICOS', CATALOGO)).toBe('QUI');
  });

  it('nunca devuelve un prefijo ya usado, ni agotando las combinaciones', () => {
    const ocupa = ['ABC-001', 'ABD-001', 'ACD-001', 'ADE-001', 'ABE-001']
      .map((s, i) => p(s, `OTRA ${i}`));
    const pre = prefijoCategoria('ABCDE', ocupa);
    expect(ocupa.some((x) => x.sku.startsWith(`${pre}-`))).toBe(false);
  });

  it('una categoría vacía no rompe', () => {
    expect(prefijoCategoria('', CATALOGO)).toBe('GEN');
    expect(prefijoCategoria('123', CATALOGO)).toBe('GEN');
  });

  it('el correlativo sigue al mayor del prefijo, no reinicia', () => {
    expect(siguienteSku('MATERIALES', CATALOGO)).toBe('MAT-097');
    expect(siguienteSku('VIVERES', CATALOGO)).toBe('VIV-115');
  });

  it('una categoría nueva arranca en 001', () => {
    expect(siguienteSku('LUBRICANTES', CATALOGO)).toBe('LUB-001');
  });
});
