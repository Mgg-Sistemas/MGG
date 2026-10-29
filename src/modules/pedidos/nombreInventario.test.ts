import { describe, it, expect } from 'vitest';
import {
  aplicarFicha, categoriaValida, destinoRenglon, errorRenglonesSinFicha, fichaPorNombre,
  nombreFicha, nombreQueViene, planFichas, renglonesSinFicha, type FichaMin,
} from './nombreInventario';
import type { ItemOrden } from '@/shared/lib/types';

const FICHAS: FichaMin[] = [
  { id: 'p1', sku: 'PLO-010', nombre: 'TUBO PVC 1/2"', unidad: 'UNIDAD', estado: 'activo' },
  { id: 'p2', sku: 'FER-004', nombre: 'TORNILLO 3/8 X 2', unidad: 'UNIDAD', estado: 'activo' },
  { id: 'p3', sku: 'FER-001', nombre: 'CLAVO DE ACERO', unidad: 'KILOGRAMO', estado: 'inactivo' },
];
const general = (nombre: string, extra: Partial<ItemOrden> = {}): ItemOrden =>
  ({ sku: `GEN-${nombre.slice(0, 3)}`, nombre, cantidad: 5, precio: 0, unidad: 'UNIDAD', general: true, ...extra });

describe('nombre y categoría de la ficha', () => {
  it('compara sin mayúsculas ni espacios de más', () => {
    expect(nombreFicha('  tubo   pvc 1/2"  ')).toBe('TUBO PVC 1/2"');
    expect(fichaPorNombre('tubo  pvc 1/2"', FICHAS)?.id).toBe('p1');
  });
  it('una ficha INACTIVA no se reusa', () => {
    expect(fichaPorNombre('clavo de acero', FICHAS)).toBeNull();
  });
  it('GENERAL o vacía no es categoría', () => {
    expect(categoriaValida('general')).toBe(false);
    expect(categoriaValida('  ')).toBe(false);
    expect(categoriaValida('PLOMERIA')).toBe(true);
  });
  it('lo que viene de la SP: el nombre de la ficha si está ligado', () => {
    const porId = new Map(FICHAS.map((f) => [f.id, f]));
    expect(nombreQueViene({ nombre: 'TUBO VIEJO', productoId: 'p1' }, porId)).toBe('TUBO PVC 1/2"');
    expect(nombreQueViene({ nombre: 'MANGUERA' }, porId)).toBe('MANGUERA');
  });
});

describe('destino de cada renglón', () => {
  it('ligado y «dejar como viene»: queda igual', () => {
    expect(destinoRenglon({ nombre: 'TUBO PVC 1/2"', productoId: 'p1' }, { modo: 'como_viene' }, FICHAS)).toEqual({ tipo: 'igual' });
  });
  it('general como viene, con ficha del mismo nombre: la reusa', () => {
    const d = destinoRenglon(general('tornillo 3/8 x 2'), undefined, FICHAS);
    expect(d).toEqual({ tipo: 'ficha', ficha: FICHAS[1] });
  });
  it('general como viene sin ficha: pide categoría, la unidad sale del renglón', () => {
    const d = destinoRenglon(general('manguera 1"'), { modo: 'como_viene' }, FICHAS);
    expect(d).toEqual({ tipo: 'crear', nombre: 'MANGUERA 1"', categoria: '', unidad: 'UNIDAD', falta: expect.stringContaining('categoría') });
  });
  it('GENERAL no vale como categoría', () => {
    const d = destinoRenglon(general('manguera'), { modo: 'como_viene', categoria: 'general' }, FICHAS);
    expect(d.tipo === 'crear' && d.falta).toBeTruthy();
  });
  it('elegir del inventario liga a esa ficha', () => {
    expect(destinoRenglon(general('tubo'), { modo: 'existente', productoId: 'p1' }, FICHAS)).toEqual({ tipo: 'ficha', ficha: FICHAS[0] });
    expect(destinoRenglon(general('tubo'), { modo: 'existente' }, FICHAS).tipo).toBe('incompleto');
  });
  it('cambiar el nombre de un renglón LIGADO lo re-liga: nunca renombra su ficha', () => {
    const d = destinoRenglon({ nombre: 'TUBO PVC 1/2"', productoId: 'p1', unidad: 'UNIDAD' }, { modo: 'nuevo', nombre: 'tubo pvc 3/4', categoria: 'PLOMERIA' }, FICHAS);
    expect(d).toEqual({ tipo: 'crear', nombre: 'TUBO PVC 3/4', categoria: 'PLOMERIA', unidad: 'UNIDAD', falta: null });
    // Si el nombre escrito es el de su propia ficha, no cambia nada.
    expect(destinoRenglon({ nombre: 'X', productoId: 'p1' }, { modo: 'nuevo', nombre: 'tubo pvc 1/2"' }, FICHAS)).toEqual({ tipo: 'igual' });
  });
  it('nombre nuevo vacío no se acepta', () => {
    expect(destinoRenglon(general('tubo'), { modo: 'nuevo', nombre: '  ' }, FICHAS).tipo).toBe('incompleto');
  });
});

describe('plan de la cotización', () => {
  it('una sola ficha por nombre aunque lo usen dos renglones (variantes de marca)', () => {
    const plan = planFichas([
      { item: general('manguera'), eleccion: { modo: 'como_viene', categoria: 'PLOMERIA', unidad: 'METRO' } },
      { item: general('manguera'), eleccion: { modo: 'como_viene' } },
      { item: { nombre: 'TUBO PVC 1/2"', productoId: 'p1' } },
    ], FICHAS);
    expect(plan.error).toBeNull();
    expect(plan.crear).toEqual([{ nombre: 'MANGUERA', categoria: 'PLOMERIA', unidad: 'METRO', indices: [0, 1] }]);
    expect(plan.destinos[2]).toEqual({ tipo: 'igual' });
  });
  it('sin categoría no se guarda, y dice cuál', () => {
    const plan = planFichas([{ item: general('codo galvanizado') }], FICHAS);
    expect(plan.error).toMatch(/codo galvanizado.*categoría/i);
  });
  it('la falta de producto elegido también frena', () => {
    const plan = planFichas([{ item: general('tubo'), eleccion: { modo: 'existente' } }], FICHAS);
    expect(plan.error).toMatch(/elegí el producto/);
  });
});

describe('aplicar la ficha al renglón', () => {
  it('toma id, nombre y unidad de la ficha y CONSERVA el SKU', () => {
    const it0 = general('tornillito', { unidad: 'CAJA', precio: 3 });
    const out = aplicarFicha(it0, FICHAS[1]);
    expect(out).toMatchObject({ sku: it0.sku, productoId: 'p2', nombre: 'TORNILLO 3/8 X 2', unidad: 'UNIDAD', precio: 3, general: true });
  });
});

describe('recepción: nada entra sin ficha', () => {
  const items = [
    { sku: 'GEN-1', nombre: 'MANGUERA', productoId: undefined },
    { sku: 'PLO-010', nombre: 'TUBO', productoId: 'p1' },
    { sku: 'GEN-2', nombre: 'CODO', productoId: undefined },
  ];
  it('solo frena los renglones SIN ficha que se están recibiendo', () => {
    expect(renglonesSinFicha(items, new Map([['GEN-1', 2], ['PLO-010', 1], ['GEN-2', 0]])).map((i) => i.sku)).toEqual(['GEN-1']);
    expect(errorRenglonesSinFicha(items, new Map([['PLO-010', 1]]))).toBeNull();
  });
  it('el mensaje nombra el renglón', () => {
    expect(errorRenglonesSinFicha(items, new Map([['GEN-1', 2]]))).toBe('"MANGUERA" no tiene ficha de inventario: fijá con qué nombre se guarda (en la cotización o editando la OC) antes de recibir.');
    expect(errorRenglonesSinFicha(items, new Map([['GEN-1', 2], ['GEN-2', 1]]))).toMatch(/^"MANGUERA", "CODO" no tienen ficha/);
  });
});
