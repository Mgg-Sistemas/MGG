import { describe, it, expect } from 'vitest';
import { crearRepoDemo } from './demo/datosDemoAdministracion';
import type { ResponsabilidadInput } from './admin.repository';

const r = (over: Partial<ResponsabilidadInput>): ResponsabilidadInput => ({
  empresaClave: 'GT', usuarioEmail: 'ana@gt.com', objetivoTipo: 'carpeta', objetivoId: 'legal', ...over,
});

describe('AdminRepo · responsabilidades (N:N)', () => {
  it('asigna (compartida), no duplica, lista y quita', async () => {
    const repo = crearRepoDemo();
    await repo.asignarResponsabilidad(r({ usuarioEmail: 'ana@gt.com', objetivoTipo: 'carpeta', objetivoId: 'legal' }));
    await repo.asignarResponsabilidad(r({ usuarioEmail: 'bea@gt.com', objetivoTipo: 'carpeta', objetivoId: 'legal' }));
    const doc = await repo.asignarResponsabilidad(r({ usuarioEmail: 'ana@gt.com', objetivoTipo: 'documento', objetivoId: 'doc-1' }));

    // Carpeta 'legal' compartida por dos.
    expect((await repo.listResponsabilidades('GT')).filter((x) => x.objetivoTipo === 'carpeta' && x.objetivoId === 'legal')).toHaveLength(2);

    // Asignar repetido no duplica.
    await repo.asignarResponsabilidad(r({ usuarioEmail: 'ana@gt.com', objetivoTipo: 'carpeta', objetivoId: 'legal' }));
    expect((await repo.listResponsabilidades('GT')).filter((x) => x.usuarioEmail === 'ana@gt.com' && x.objetivoId === 'legal')).toHaveLength(1);

    await repo.quitarResponsabilidad(doc.id);
    expect((await repo.listResponsabilidades('GT')).some((x) => x.id === doc.id)).toBe(false);
  });
});
