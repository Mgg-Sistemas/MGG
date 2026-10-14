import { describe, it, expect } from 'vitest';
import { DATOS_GUIA_VACIOS, filtrarGuias, nombreDescargaGuia, tamanoLegible, validarGuia, validarPdfGuia, type Guia } from './guias';

const g = (x: Partial<Guia>): Guia => ({
  id: 'x', fecha: '2026-10-14', numero: null, descripcion: 'Guía', conductor_id: null, path: 'p', filename: 'a.pdf',
  mime: 'application/pdf', size_bytes: 1000, nota: null, actor: null, actor_name: null, created_at: '2026-10-14T12:00:00Z', ...x,
});
const LISTA = [
  g({ id: '1', fecha: '2026-10-01', numero: '0452', descripcion: 'Traslado de escombros Res. Coral', conductor_id: 'c1' }),
  g({ id: '2', fecha: '2026-10-10', numero: '0460', descripcion: 'Arena Playa Escondida', conductor_id: 'c2', filename: 'guia-arena.pdf' }),
  g({ id: '3', fecha: '2026-10-14', numero: null, descripcion: 'Guía de despacho piedra picada', actor_name: 'SUSEJ' }),
];
const nombre = (id: string | null) => (id === 'c1' ? 'José Rondón' : id === 'c2' ? 'Pedro Pérez' : '');

describe('guías de choferes (14-10-2026)', () => {
  it('solo acepta PDF hasta 15 MB', () => {
    expect(validarPdfGuia({ type: 'application/pdf', size: 1000, name: 'g.pdf' })).toBeNull();
    expect(validarPdfGuia({ type: '', size: 1000, name: 'g.PDF' })).toBeNull();
    expect(validarPdfGuia({ type: 'image/jpeg', size: 1000, name: 'g.jpg' })).toMatch(/PDF/);
    expect(validarPdfGuia({ type: 'application/pdf', size: 16 * 1024 * 1024, name: 'g.pdf' })).toMatch(/15 MB/);
    expect(validarPdfGuia({ type: 'application/pdf', size: 0, name: 'g.pdf' })).toMatch(/vacío/);
    expect(validarPdfGuia(null)).toMatch(/Elige/);
  });

  it('pide fecha y descripción', () => {
    expect(validarGuia({ ...DATOS_GUIA_VACIOS, fecha: '2026-10-14', descripcion: 'Escombros' })).toBeNull();
    expect(validarGuia({ ...DATOS_GUIA_VACIOS, descripcion: 'Escombros' })).toMatch(/fecha/);
    expect(validarGuia({ ...DATOS_GUIA_VACIOS, fecha: '2026-10-14', descripcion: 'x' })).toMatch(/descripción/);
  });

  it('filtra por rango de fechas con los dos extremos adentro', () => {
    expect(filtrarGuias(LISTA, { desde: '2026-10-10', hasta: '2026-10-14', q: '' }, nombre).map((x) => x.id)).toEqual(['2', '3']);
    expect(filtrarGuias(LISTA, { desde: '', hasta: '2026-10-01', q: '' }, nombre).map((x) => x.id)).toEqual(['1']);
    expect(filtrarGuias(LISTA, { desde: '2026-10-15', hasta: '', q: '' }, nombre)).toEqual([]);
  });

  it('busca por número, descripción, archivo, conductor y quien la cargó, sin acentos', () => {
    expect(filtrarGuias(LISTA, { desde: '', hasta: '', q: '0452' }, nombre).map((x) => x.id)).toEqual(['1']);
    expect(filtrarGuias(LISTA, { desde: '', hasta: '', q: 'rondon' }, nombre).map((x) => x.id)).toEqual(['1']);
    expect(filtrarGuias(LISTA, { desde: '', hasta: '', q: 'guia-arena' }, nombre).map((x) => x.id)).toEqual(['2']);
    expect(filtrarGuias(LISTA, { desde: '', hasta: '', q: 'piedra picada' }, nombre).map((x) => x.id)).toEqual(['3']);
    expect(filtrarGuias(LISTA, { desde: '', hasta: '', q: 'susej' }, nombre).map((x) => x.id)).toEqual(['3']);
    expect(filtrarGuias(LISTA, { desde: '', hasta: '', q: 'coral perez' }, nombre)).toEqual([]);
  });

  it('tamaño legible y nombre de descarga', () => {
    expect(tamanoLegible(0)).toBe('—');
    expect(tamanoLegible(340 * 1024)).toBe('340 KB');
    expect(tamanoLegible(1.25 * 1024 * 1024)).toBe('1,3 MB');
    expect(nombreDescargaGuia(LISTA[0])).toBe('Guia 0452 · 01-10-2026.pdf');
    expect(nombreDescargaGuia(LISTA[2])).toBe('Guía de despacho piedra picada · 14-10-2026.pdf');
  });
});
