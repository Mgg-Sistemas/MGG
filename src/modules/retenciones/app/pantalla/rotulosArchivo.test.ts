import { describe, expect, it } from 'vitest';
import { rotulosArchivo } from './rotulosArchivo';

describe('las acciones del archivo de una retención (maqueta v6AccionesCasilla)', () => {
  it('recibida con PDF: «📎 PDF del cliente» y «Reemplazar PDF»', () => {
    expect(rotulosArchivo({ direccion: 'recibida', tieneArchivo: true, anulada: false }))
      .toEqual({ ver: '📎 PDF del cliente', sinArchivo: null, adjuntar: 'Reemplazar PDF' });
  });

  it('recibida sin PDF: la marca «Sin PDF» y «Adjuntar PDF»', () => {
    expect(rotulosArchivo({ direccion: 'recibida', tieneArchivo: false, anulada: false }))
      .toEqual({ ver: null, sinArchivo: 'Sin PDF', adjuntar: 'Adjuntar PDF' });
  });

  it('practicada: «📎 Archivo» si lo tiene, «Adjuntar» si no (como hoy, sin reemplazar)', () => {
    expect(rotulosArchivo({ direccion: 'practicada', tieneArchivo: true, anulada: false })).toEqual({ ver: '📎 Archivo', sinArchivo: null, adjuntar: null });
    expect(rotulosArchivo({ direccion: 'practicada', tieneArchivo: false, anulada: false })).toEqual({ ver: null, sinArchivo: null, adjuntar: 'Adjuntar' });
  });

  it('una anulada no se adjunta ni se reemplaza', () => {
    expect(rotulosArchivo({ direccion: 'recibida', tieneArchivo: true, anulada: true }).adjuntar).toBeNull();
    expect(rotulosArchivo({ direccion: 'recibida', tieneArchivo: false, anulada: true }).adjuntar).toBeNull();
  });
});
