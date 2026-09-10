import { describe, it, expect } from 'vitest';
import { almacenDeFundicion, validaStock, ALMACEN_PRINCIPAL_FUNDICION } from './almacenFundicion';

const MATANZA = ['General', 'Materias Primas', 'ESTAÑO REFINADO', 'ESTAÑO EN BRUTO'];

const EX = [
  { producto_id: 'coque', almacen: 'General', stock: 2514 },
  { producto_id: 'coque', almacen: 'Materias Primas', stock: 100 },
  { producto_id: 'caco3', almacen: 'Materias Primas', stock: 0 },
  { producto_id: 'casiterita', almacen: 'ALMACEN CASITERITA', stock: 900 }, // Los Pinos: otra sede
];

describe('de qué almacén de Matanza sale el material de una colada', () => {
  it('elige el almacén de Matanza donde hay más stock', () => {
    expect(almacenDeFundicion('coque', EX, MATANZA)).toBe('General');
  });

  it('sin stock en ninguno, cae en el principal de la sede', () => {
    expect(almacenDeFundicion('caco3', EX, MATANZA)).toBe(ALMACEN_PRINCIPAL_FUNDICION);
  });

  it('nunca saca material de otra sede, aunque ahí sí haya stock', () => {
    expect(almacenDeFundicion('casiterita', EX, MATANZA)).toBe('General');
  });

  it('un material que no existe en ningún lado igual devuelve un almacén usable', () => {
    expect(almacenDeFundicion('desconocido', EX, MATANZA)).toBe('General');
    expect(almacenDeFundicion('desconocido', EX, [])).toBe('General');
  });

  it('si la sede no tiene «General», usa el primero de sus almacenes', () => {
    expect(almacenDeFundicion('caco3', EX, ['Materias Primas'])).toBe('Materias Primas');
  });
});

describe('cuándo hay que exigir stock', () => {
  it('una colada normal exige stock', () => {
    expect(validaStock(true, false)).toBe(true);
  });

  it('una carga histórica no exige stock: la colada ya ocurrió', () => {
    expect(validaStock(false, false)).toBe(false);
    expect(validaStock(false, true)).toBe(false);
  });

  it('el material del piso de fundición nunca se valida contra existencia', () => {
    expect(validaStock(true, true)).toBe(false);
  });
});
