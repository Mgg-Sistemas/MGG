import { describe, it, expect } from 'vitest';
import { productosSimilares, parecidoNombre, tokensNombre, type ProductoComparable } from './duplicados';

const nombres = [
  'DISCO DE CORTE 7"',
  'DISCO DE CORTE 7" X .045" X 7/8" DEWALT',
  'DISCO DE CORTE PARA DESMALEZADORA 14" X 1/8" X 1" MARCA TOTAL',
  'DISCO CORTE CONCRETO 14"',
  'DISCO DE CORTE DE CONCRETO PUNTA DE DIAMANTE 7"',
  'TORNILLO AUTOTALADRANTE',
  'TORNILLO CON TUERCA REDONDA',
  'TORNILLO TIRA FONDO 12X3',
  'TORNILLO (ESPESOR 0.22MM X LARGO 0.38MM)',
  'FILTRO DE COMBUSTIBLE',
  'FILTRO DE COMBUSTIBLE FS-36209',
  'MANGUERA HIDRAULICA 1/2" ALTA PRESION',
  'MANGUERA HIDRAULICA 4SP 1/2" ALTA PRESION',
  'TIRRAJE 161 - 200',
  'TIRRAJE 201- 300',
  'PINTURA GRIS MARCA (MONTANA)',
  'PINTURA GRIS CLARO MARCA (MONTANA)',
  'GUANTES DE CARNAZA (PAR)',
];
const CAT: ProductoComparable[] = nombres.map((n, i) => ({ id: String(i), sku: 'S' + i, nombre: n, estado: 'activo' }));

describe('tmp', () => {
  it('dump', () => {
    for (const q of ['TORNILLO 3/8', 'TORNILLO 1/2', 'DISCO DE CORTE 4 1/2"', 'MANGUERA 5/8', 'FILTRO DE COMBUSTIBLE RACOR 500', 'GUANTES DE NITRILO', 'PINTURA GRIS OSCURO MARCA (MONTANA)']) {
      const r = productosSimilares(q, CAT);
      console.log('\nQ=', q, '| tokens=', JSON.stringify(tokensNombre(q)));
      for (const d of r) console.log('   ', d.nivel, d.score.toFixed(2), d.producto.nombre);
    }
    console.log('\nparecido TORNILLO 3/8 vs TORNILLO 1/2 =', parecidoNombre('TORNILLO 3/8', 'TORNILLO 1/2'));
    expect(true).toBe(true);
  });
});
