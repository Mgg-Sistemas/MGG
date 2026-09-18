import { describe, expect, it } from 'vitest';
import { filtrarOpciones, type SearchOption } from './SearchSelect';

const opciones: SearchOption[] = [
  { value: 'PLOMERÍA', label: 'PLOMERÍA', hint: 'PLO-… · 44 productos', keywords: ['TUBO PVC 1/2', 'PLO-001', 'LLAVE DE PASO'] },
  { value: 'VIVERES', label: 'VIVERES', hint: 'VIV-… · 120 productos', keywords: ['ARROZ', 'HARINA PAN'] },
];

describe('filtrarOpciones', () => {
  it('sin texto devuelve todo', () => {
    expect(filtrarOpciones(opciones, '  ')).toHaveLength(2);
  });
  it('busca sin acentos y por el código', () => {
    expect(filtrarOpciones(opciones, 'plomeria').map((c) => c.opcion.value)).toEqual(['PLOMERÍA']);
    expect(filtrarOpciones(opciones, 'viv-').map((c) => c.opcion.value)).toEqual(['VIVERES']);
  });
  it('encuentra la categoría por uno de sus productos y dice cuál', () => {
    const r = filtrarOpciones(opciones, 'tubo pvc');
    expect(r).toHaveLength(1);
    expect(r[0].por).toBe('TUBO PVC 1/2');
  });
  it('cada palabra tiene que aparecer', () => {
    expect(filtrarOpciones(opciones, 'arroz tubo')).toHaveLength(0);
  });
  it('si coincide por el nombre no muestra el producto', () => {
    expect(filtrarOpciones(opciones, 'vive')[0].por).toBeNull();
  });
});
