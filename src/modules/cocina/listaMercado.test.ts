import { describe, expect, it } from 'vitest';
import { errorListaMercado } from './listaMercado';

const foto = (n: string) => ({ nombre: `${n}.jpg`, tipo: 'image/jpeg' });
const pdf = (n: string) => ({ nombre: `${n}.pdf`, tipo: 'application/pdf' });

describe('errorListaMercado · hasta 4 fotos o 1 PDF', () => {
  it('una a cuatro fotos están bien', () => {
    expect(errorListaMercado([foto('a')])).toBeNull();
    expect(errorListaMercado([foto('a'), foto('b'), foto('c'), foto('d')])).toBeNull();
  });
  it('un PDF solo está bien', () => {
    expect(errorListaMercado([pdf('lista')])).toBeNull();
  });
  it('cinco fotos no', () => {
    expect(errorListaMercado([foto('a'), foto('b'), foto('c'), foto('d'), foto('e')])).toMatch(/hasta 4/);
  });
  it('dos PDF no', () => {
    expect(errorListaMercado([pdf('a'), pdf('b')])).toMatch(/UN solo PDF/);
  });
  it('PDF y fotos juntos no', () => {
    expect(errorListaMercado([pdf('a'), foto('b')])).toMatch(/no las dos cosas/);
  });
  it('cuenta lo que el mercado ya tiene', () => {
    expect(errorListaMercado([foto('e')], [foto('a'), foto('b'), foto('c'), foto('d')])).toMatch(/hasta 4/);
    expect(errorListaMercado([foto('b')], [pdf('a')])).toMatch(/ya tiene su lista/);
    expect(errorListaMercado([foto('d')], [foto('a'), foto('b'), foto('c')])).toBeNull();
  });
  it('reconoce por extensión cuando el teléfono no manda el tipo', () => {
    expect(errorListaMercado([{ nombre: 'IMG_1.HEIC', tipo: '' }])).toBeNull();
    expect(errorListaMercado([{ nombre: 'lista.PDF', tipo: '' }])).toBeNull();
  });
  it('otro tipo de archivo no', () => {
    expect(errorListaMercado([{ nombre: 'lista.xlsx', tipo: 'application/vnd.ms-excel' }])).toMatch(/no es una imagen/);
  });
});
