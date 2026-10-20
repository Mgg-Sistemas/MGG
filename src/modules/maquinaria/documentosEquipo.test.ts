import { describe, it, expect } from 'vitest';
import { slotsDeEquipo, validarArchivoDoc, limpiarNombreDoc, nombreDescarga, MAX_DOCS_EQUIPO } from './documentosEquipo';

describe('documentos por equipo', () => {
  it('hasta 12 espacios: se muestran los cargados en orden y UNA tarjeta vacía (el primer espacio libre)', () => {
    const s = slotsDeEquipo([{ slot: 3, nombre: 'CONTRATO' }, { slot: 1, nombre: 'FICHA TÉCNICA' }]);
    expect(MAX_DOCS_EQUIPO).toBe(12);
    expect(s.map((x) => x.slot)).toEqual([1, 3, 2]);
    expect(s.map((x) => x.doc?.nombre ?? null)).toEqual(['FICHA TÉCNICA', 'CONTRATO', null]);
    // Lleno: sin tarjeta vacía.
    const lleno = slotsDeEquipo(Array.from({ length: 12 }, (_, i) => ({ slot: i + 1, nombre: `D${i + 1}` })));
    expect(lleno).toHaveLength(12);
    expect(lleno.every((x) => x.doc)).toBe(true);
    expect(slotsDeEquipo([])).toEqual([{ slot: 1, doc: null }]);
  });

  it('acepta PDF e imágenes y rechaza lo demás o lo muy pesado', () => {
    expect(validarArchivoDoc({ type: 'application/pdf', size: 1000, name: 'contrato.pdf' })).toBeNull();
    expect(validarArchivoDoc({ type: 'image/jpeg', size: 1000, name: 'foto.jpg' })).toBeNull();
    expect(validarArchivoDoc({ type: 'application/msword', size: 1000, name: 'contrato.doc' })).toMatch(/PDF o una imagen/);
    expect(validarArchivoDoc({ type: 'application/pdf', size: 16 * 1024 * 1024, name: 'grande.pdf' })).toMatch(/15 MB/);
  });

  it('el nombre se guarda limpio y en mayúsculas', () => {
    expect(limpiarNombreDoc('  contrato   de arrendamiento ')).toBe('CONTRATO DE ARRENDAMIENTO');
  });

  it('se descarga con el nombre del documento y la extensión del archivo', () => {
    expect(nombreDescarga('Contrato de arrendamiento', 'scan_0012.PDF')).toBe('CONTRATO_DE_ARRENDAMIENTO.pdf');
    expect(nombreDescarga('Ficha técnica', 'foto.jpg')).toBe('FICHA_TECNICA.jpg');
  });
});
