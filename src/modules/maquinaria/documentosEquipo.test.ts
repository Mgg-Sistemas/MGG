import { describe, it, expect } from 'vitest';
import { slotsDeEquipo, validarArchivoDoc, limpiarNombreDoc, nombreDescarga, MAX_DOCS_EQUIPO } from './documentosEquipo';

describe('documentos por equipo', () => {
  it('cada equipo tiene 4 espacios, llenos o vacíos, en orden', () => {
    const s = slotsDeEquipo([{ slot: 3, nombre: 'CONTRATO' }, { slot: 1, nombre: 'FICHA TÉCNICA' }]);
    expect(MAX_DOCS_EQUIPO).toBe(4);
    expect(s.map((x) => x.slot)).toEqual([1, 2, 3, 4]);
    expect(s.map((x) => x.doc?.nombre ?? null)).toEqual(['FICHA TÉCNICA', null, 'CONTRATO', null]);
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
