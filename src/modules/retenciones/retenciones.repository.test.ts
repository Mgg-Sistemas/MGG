import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Supabase falso: el update de la OC devuelve lo que se ponga y anota lo que se le pidió. */
let respuestaUpdate: { data: unknown; error: unknown } = { data: [], error: null };
const metodos: unknown[][] = [];
const subidas: string[] = [];

function consulta() {
  const q: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(respuestaUpdate).then(ok, ko);
      return (...args: unknown[]) => { metodos.push([prop, ...args]); return q; };
    },
  });
  return q;
}

vi.mock('@/shared/lib/supabase', () => ({
  supabase: {
    from: () => consulta(),
    storage: { from: () => ({ upload: async (path: string) => { subidas.push(path); return { error: null }; } }) },
  },
}));

import { finalizarRetencion } from './retenciones.repository';
import type { Orden } from '@/shared/lib/types';

// Datos inventados.
const orden = { id: 'oc-1' } as unknown as Orden;
const pdf = () => new File(['x'], 'comprobante.pdf', { type: 'application/pdf' });

beforeEach(() => { metodos.length = 0; subidas.length = 0; respuestaUpdate = { data: [], error: null }; });

describe('finalizar la retención de una OC', () => {
  it('pide la fila de vuelta y finaliza cuando el update la toca', async () => {
    respuestaUpdate = { data: [{ id: 'oc-1' }], error: null };
    await finalizarRetencion({ orden, archivos: { iva: pdf() }, actor: 'prueba@ejemplo.com' });
    expect(subidas).toHaveLength(1);
    expect(metodos).toContainEqual(['eq', 'id', 'oc-1']);
    expect(metodos).toContainEqual(['select', 'id']);
    expect(metodos.find((m) => m[0] === 'update')?.[1]).toMatchObject({ retencion_finalizada: true, retencion_iva_nombre: 'comprobante.pdf' });
  });

  it('sin permiso o sin OC (0 filas) avisa en vez de dar por finalizada', async () => {
    respuestaUpdate = { data: [], error: null };
    await expect(finalizarRetencion({ orden, archivos: { iva: pdf() }, actor: 'prueba@ejemplo.com' }))
      .rejects.toThrow('No se pudo finalizar la retención');
  });

  it('un error de la base se propaga', async () => {
    respuestaUpdate = { data: null, error: new Error('fallo de red') };
    await expect(finalizarRetencion({ orden, archivos: { iva: pdf() }, actor: 'prueba@ejemplo.com' })).rejects.toThrow('fallo de red');
  });

  it('sin comprobantes no toca la base', async () => {
    await expect(finalizarRetencion({ orden, archivos: {}, actor: 'prueba@ejemplo.com' })).rejects.toThrow('al menos un comprobante');
    expect(metodos).toHaveLength(0);
  });
});
