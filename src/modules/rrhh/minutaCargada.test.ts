import { describe, expect, it, vi } from 'vitest';
vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }));
import type { Minuta } from '@/shared/lib/types';
import { errorMinutaCargada, participantesDeTexto, type MinutaACargar } from './minutaCargada.repository';
import { FILTROS_VACIOS, filtrarMinutas } from './minutaFiltros';

const pdf = new File(['%PDF-1.4'], 'minuta.pdf', { type: 'application/pdf' });
const base: MinutaACargar = { numero: '', fecha: '2026-10-20', lugar: '', hora_inicio: '', objetivo: 'Seguridad', participantes: '', observaciones: '', archivos: [pdf] };

describe('Minutas ya hechas (05-11-2026)', () => {
  it('pide fecha (no futura), tema y archivo', () => {
    expect(errorMinutaCargada(base, '2026-11-05')).toBeNull();
    expect(errorMinutaCargada({ ...base, fecha: '' }, '2026-11-05')).toMatch(/fecha/);
    expect(errorMinutaCargada({ ...base, fecha: '2026-12-01' }, '2026-11-05')).toMatch(/futura/);
    expect(errorMinutaCargada({ ...base, objetivo: ' ' }, '2026-11-05')).toMatch(/tema/);
    expect(errorMinutaCargada({ ...base, archivos: [] }, '2026-11-05')).toMatch(/Adjunta/);
  });

  it('los participantes escritos a mano quedan como externos', () => {
    expect(participantesDeTexto('Ana Pérez, Luis\nCarmen ;')).toEqual([
      { personal_id: null, nombre: 'Ana Pérez', cargo: '' },
      { personal_id: null, nombre: 'Luis', cargo: '' },
      { personal_id: null, nombre: 'Carmen', cargo: '' },
    ]);
  });

  it('se filtra por número, tema, lugar, origen y con archivo', () => {
    const m = (o: Partial<Minuta & { tiene_adjuntos: boolean }>) => ({
      id: o.numero ?? 'x', numero: 'MIN-2026-0001', estado: 'finalizada', fecha: '2026-10-01', lugar: null, objetivo: null,
      participantes: [], acuerdos: [], avances: [], orden_dia: [], proximos_puntos: [], tiene_adjuntos: false, ...o,
    }) as unknown as Minuta & { tiene_adjuntos: boolean };
    const L = [
      m({ numero: 'MIN-2026-0001', objetivo: 'Seguridad industrial', lugar: 'Galpón Matanzas', origen: 'cargada', tiene_adjuntos: true }),
      m({ numero: 'MIN-2026-0002', objetivo: 'Nómina', lugar: 'Oficina Los Pinos', origen: 'sistema' }),
    ];
    const n = (f: Partial<typeof FILTROS_VACIOS>) => filtrarMinutas(L, { ...FILTROS_VACIOS, ...f }).map((x) => x.numero);
    expect(n({ numero: '0002' })).toEqual(['MIN-2026-0002']);
    expect(n({ tema: 'seguridad' })).toEqual(['MIN-2026-0001']);
    expect(n({ lugar: 'pinos' })).toEqual(['MIN-2026-0002']);
    expect(n({ origen: 'cargada' })).toEqual(['MIN-2026-0001']);
    expect(n({ conArchivo: true })).toEqual(['MIN-2026-0001']);
  });
});
