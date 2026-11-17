import { describe, it, expect } from 'vitest';
import { crearRepoDemo } from './demo/datosDemoAdministracion';

const fakeFile = { name: 'rupdae.pdf', type: 'application/pdf', size: 1234 } as unknown as File;

describe('AdminRepo · documentos ampliados (costo, aviso, prioridad, badge, subcarpeta, gestión)', () => {
  it('guarda los campos nuevos al subir y al editar; un subcarpetaId huérfano no rompe el listado', async () => {
    const repo = crearRepoDemo();
    const doc = await repo.subirDocumento('GT', 'rupdae', fakeFile, {
      nombre: 'RUPDAE 2026', costoGestion: 150, monedaCosto: 'USD', avisoDias: 60,
      prioridad: 'alta', badgeTexto: 'RUPDAE', subcarpetaId: null, gestionId: null,
    });
    expect(doc).toMatchObject({ costoGestion: 150, monedaCosto: 'USD', avisoDias: 60, prioridad: 'alta', badgeTexto: 'RUPDAE' });

    await repo.editarDocumento(doc.id, { prioridad: 'media', badgeTexto: 'RUPDAE-26', subcarpetaId: 'carpeta-fantasma' });
    const docs = await repo.listDocumentos('GT');
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ prioridad: 'media', badgeTexto: 'RUPDAE-26', subcarpetaId: 'carpeta-fantasma', avisoDias: 60 });
  });
});
