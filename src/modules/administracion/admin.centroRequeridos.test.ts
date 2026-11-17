import { describe, it, expect } from 'vitest';
import { crearRepoDemo } from './demo/datosDemoAdministracion';
import type { CentroRequeridoInput } from './admin.repository';

const r = (over: Partial<CentroRequeridoInput>): CentroRequeridoInput => ({
  empresaClave: 'GT', centroId: 'acopio_principal', tipoDocumento: 'rupdae', ...over,
});

describe('AdminRepo · requeridos por centro', () => {
  it('agrega (idempotente), lista y quita', async () => {
    const repo = crearRepoDemo();
    await repo.agregarCentroRequerido(r({ tipoDocumento: 'rupdae' }));
    const mintras = await repo.agregarCentroRequerido(r({ tipoDocumento: 'mintras' }));
    await repo.agregarCentroRequerido(r({ tipoDocumento: 'rupdae' })); // repetido → no duplica

    expect(await repo.listCentroRequeridos('GT')).toHaveLength(2);
    await repo.quitarCentroRequerido(mintras.id);
    expect((await repo.listCentroRequeridos('GT')).some((x) => x.id === mintras.id)).toBe(false);
  });
});
