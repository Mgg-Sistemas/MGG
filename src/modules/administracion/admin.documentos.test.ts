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

  it('resolverActorVisible: convierte cuentas de correo unidas en nombres institucionales limpios dejando el correo secundario', async () => {
    const { resolverActorVisible } = await import('./admin.repository');

    const tributos = resolverActorVisible('impuestostributosgt@gmail.com');
    expect(tributos.nombre).toBe('Impuestos y Tributos GT');
    expect(tributos.correo).toBe('impuestostributosgt@gmail.com');

    const admin = resolverActorVisible('administraciongt@gmail.com');
    expect(admin.nombre).toBe('Administración GT');
    expect(admin.correo).toBe('administraciongt@gmail.com');

    const personal = resolverActorVisible('juan.perez@empresa.com');
    expect(personal.nombre).toBe('Juan Perez');
    expect(personal.correo).toBe('juan.perez@empresa.com');

    const directo = resolverActorVisible('Administrador');
    expect(directo.nombre).toBe('Administrador');
    expect(directo.correo).toBeNull();
  });
});
