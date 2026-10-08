import { describe, expect, it } from 'vitest';
import {
  errorDestinatario, errorNombreCatalogo, existeEnCatalogo, filtrarCatalogo, limpiarDestinatario, limpiarNombreCatalogo,
} from './catalogoDocumentacion';

describe('catálogos de la nota de envío', () => {
  it('limpia espacios de más y valida el nombre', () => {
    expect(limpiarNombreCatalogo('  Facturas   originales ')).toBe('Facturas originales');
    expect(errorNombreCatalogo('   ')).toMatch(/Escribí/);
    expect(errorNombreCatalogo('x'.repeat(201))).toMatch(/largo/);
    expect(errorNombreCatalogo('Copias')).toBeNull();
  });

  it('detecta repetidos sin mirar mayúsculas ni acentos, por catálogo', () => {
    const items = [
      { id: 'a', scope: 'condicion' as const, nombre: 'Copias' },
      { id: 'b', scope: 'concepto' as const, nombre: 'Facturas de Golden Touch' },
    ];
    expect(existeEnCatalogo(items, 'condicion', ' COPIAS ')).toBe(true);
    expect(existeEnCatalogo(items, 'concepto', 'copias')).toBe(false);
    expect(existeEnCatalogo(items, 'condicion', 'Copias', 'a')).toBe(false); // renombrándose a sí misma
  });

  it('busca por todas las palabras y pone primero lo más usado', () => {
    const items = [
      { scope: 'concepto' as const, nombre: 'Facturas de Golden Lion', usos: 1 },
      { scope: 'concepto' as const, nombre: 'Facturas de Golden Touch', usos: 7 },
      { scope: 'condicion' as const, nombre: 'Copias', usos: 9 },
    ];
    expect(filtrarCatalogo(items, 'concepto', '').map((x) => x.nombre)).toEqual(['Facturas de Golden Touch', 'Facturas de Golden Lion']);
    expect(filtrarCatalogo(items, 'concepto', 'golden lión').map((x) => x.nombre)).toEqual(['Facturas de Golden Lion']);
    expect(filtrarCatalogo(items, 'concepto', 'copias')).toHaveLength(0);
  });

  it('deja el destinatario prolijo y exige la razón social', () => {
    expect(limpiarDestinatario({ razon_social: ' Golden  Touch ', rif: ' j-123 ', direccion: '', atencion_a: null })).toEqual({
      razon_social: 'Golden Touch', rif: 'J-123', direccion: null, atencion_a: null, telefono: null,
    });
    expect(errorDestinatario({ razon_social: '  ' })).toMatch(/obligatoria/);
    expect(errorDestinatario({ razon_social: 'Golden Touch' })).toBeNull();
  });
});
