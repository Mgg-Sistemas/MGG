import { describe, expect, it } from 'vitest';
import type { Usuario } from '@/shared/lib/types';
import {
  archivadosFiltrados,
  coincideArchivado,
  estaArchivado,
  FILTRO_ARCHIVADOS_VACIO,
  puedeArchivarse,
  quienesArchivaron,
} from './usuariosArchivados';

function usuario(over: Partial<Usuario> = {}): Usuario {
  return {
    id: 'u1',
    email: 'persona@mgg.com',
    nombre: 'PERSONA',
    role: 'obrero',
    estado: 'inactivo',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Usuario;
}

describe('puedeArchivarse', () => {
  it('solo permite archivar deshabilitados que siguen en la tabla', () => {
    expect(puedeArchivarse(usuario())).toBe(true);
    expect(puedeArchivarse(usuario({ estado: 'activo' }))).toBe(false);
    expect(puedeArchivarse(usuario({ archivado_en: '2026-09-01T10:00:00Z' }))).toBe(false);
  });
});

describe('estaArchivado', () => {
  it('archivado es tener fecha; null o ausente es estar visible', () => {
    expect(estaArchivado(usuario({ archivado_en: '2026-09-01T10:00:00Z' }))).toBe(true);
    expect(estaArchivado(usuario({ archivado_en: null }))).toBe(false);
    expect(estaArchivado(usuario())).toBe(false);
  });
});

describe('coincideArchivado', () => {
  const u = usuario({
    nombre: 'MARÍA', apellido: 'PÉREZ', email: 'maria@mgg.com', ci: '12345678',
    archivado_en: '2026-09-10T15:00:00Z', archivado_por: 'admin@mgg.com',
  });

  it('el texto se parte en palabras y todas deben aparecer, en cualquier campo', () => {
    expect(coincideArchivado(u, { ...FILTRO_ARCHIVADOS_VACIO, texto: 'maría pérez' })).toBe(true);
    expect(coincideArchivado(u, { ...FILTRO_ARCHIVADOS_VACIO, texto: 'maria@mgg 1234' })).toBe(true);
    expect(coincideArchivado(u, { ...FILTRO_ARCHIVADOS_VACIO, texto: 'maría lópez' })).toBe(false);
  });

  it('filtra por quién archivó y por rango de fechas (extremos incluidos)', () => {
    expect(coincideArchivado(u, { ...FILTRO_ARCHIVADOS_VACIO, porQuien: 'admin@mgg.com' })).toBe(true);
    expect(coincideArchivado(u, { ...FILTRO_ARCHIVADOS_VACIO, porQuien: 'otro@mgg.com' })).toBe(false);
    expect(coincideArchivado(u, { ...FILTRO_ARCHIVADOS_VACIO, desde: '2026-09-10', hasta: '2026-09-10' })).toBe(true);
    expect(coincideArchivado(u, { ...FILTRO_ARCHIVADOS_VACIO, desde: '2026-09-11' })).toBe(false);
    expect(coincideArchivado(u, { ...FILTRO_ARCHIVADOS_VACIO, hasta: '2026-09-09' })).toBe(false);
  });
});

describe('archivadosFiltrados', () => {
  it('solo muestra archivados, los más recientes primero y desempata por nombre', () => {
    const lista = [
      usuario({ id: 'a', nombre: 'ZULIA', archivado_en: '2026-09-01T10:00:00Z' }),
      usuario({ id: 'b', nombre: 'ANA', archivado_en: '2026-09-15T10:00:00Z' }),
      usuario({ id: 'c', nombre: 'BETO', archivado_en: '2026-09-15T08:00:00Z' }),
      usuario({ id: 'd', nombre: 'VISIBLE' }),
      usuario({ id: 'e', nombre: 'ACTIVO', estado: 'activo' }),
    ];
    const ids = archivadosFiltrados(lista, FILTRO_ARCHIVADOS_VACIO).map((u) => u.id);
    expect(ids).toEqual(['b', 'c', 'a']);
  });
});

describe('quienesArchivaron', () => {
  it('junta los correos de los archivadores sin repetir y ordenados', () => {
    const lista = [
      usuario({ id: 'a', archivado_en: '2026-09-01T10:00:00Z', archivado_por: 'zeta@mgg.com' }),
      usuario({ id: 'b', archivado_en: '2026-09-02T10:00:00Z', archivado_por: 'admin@mgg.com' }),
      usuario({ id: 'c', archivado_en: '2026-09-03T10:00:00Z', archivado_por: 'admin@mgg.com' }),
      usuario({ id: 'd', archivado_por: 'no-cuenta@mgg.com' }),
    ];
    expect(quienesArchivaron(lista)).toEqual(['admin@mgg.com', 'zeta@mgg.com']);
  });
});
