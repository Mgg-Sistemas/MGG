import { describe, it, expect } from 'vitest';
import { crearRepoDemo } from './demo/datosDemoAdministracion';
import type { GestionInput } from './admin.repository';

const base = (over: Partial<GestionInput>): GestionInput => ({
  empresaClave: 'GT', profesionalId: 'p1', categoriaId: null, centroAcopioId: null, documentoId: null,
  concepto: 'Gestión', costoTotal: 100, moneda: 'USD', tasaRef: null,
  fecha: '2026-11-07', fechaPactada: null, estado: 'abierta', notaAcuerdo: null, ...over,
});

describe('AdminRepo · gestiones (honorarios en la base)', () => {
  it('CRUD por empresa/profesional; editar y anular', async () => {
    const repo = crearRepoDemo();
    const g = await repo.crearGestion(base({ profesionalId: 'p1', concepto: 'Redacción de poder', costoTotal: 200 }));
    await repo.crearGestion(base({ profesionalId: 'p1', concepto: 'Solvencia', costoTotal: 50 }));
    await repo.crearGestion(base({ empresaClave: 'MTO', profesionalId: 'p2', concepto: 'Otra' }));

    expect((await repo.listGestiones('GT'))).toHaveLength(2);
    expect((await repo.listGestiones('GT', 'p1'))).toHaveLength(2);
    expect((await repo.listGestiones('GT', 'p2'))).toHaveLength(0);

    await repo.editarGestion(g.id, { costoTotal: 250, fechaPactada: '2026-12-01', notaAcuerdo: 'Renegociado' });
    await repo.anularGestion(g.id);

    const gt = await repo.listGestiones('GT');
    expect(gt.find((x) => x.id === g.id)).toMatchObject({
      costoTotal: 250, fechaPactada: '2026-12-01', notaAcuerdo: 'Renegociado', estado: 'anulada',
    });
  });
});
