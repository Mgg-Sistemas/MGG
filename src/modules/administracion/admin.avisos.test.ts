import { describe, it, expect } from 'vitest';
import { crearRepoDemo } from './demo/datosDemoAdministracion';

describe('AdminRepo · avisos', () => {
  it('crea, lista (no leído por defecto) y marca leído', async () => {
    const repo = crearRepoDemo();
    const a = await repo.crearAviso({
      empresaClave: 'GT', tipo: 'acuerdo', origen: 'gestion', origenId: 'g1',
      responsableEmail: 'ana@gt.com', fecha: '2026-11-07', texto: 'Prórroga pactada',
    });
    expect(a.leido).toBe(false);
    expect(await repo.listAvisos('GT')).toHaveLength(1);
    await repo.marcarAvisoLeido(a.id, true);
    expect((await repo.listAvisos('GT')).find((x) => x.id === a.id)?.leido).toBe(true);
  });
});
