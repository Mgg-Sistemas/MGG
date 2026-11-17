import { describe, it, expect } from 'vitest';
import { crearRepoDemo } from './demo/datosDemoAdministracion';

describe('AdminRepo · profesionales (lista propia, NO proveedores)', () => {
  it('CRUD; N de la misma profesión; activo', async () => {
    const repo = crearRepoDemo();
    const a = await repo.crearProfesional({ nombre: 'Abg. Ana', profesion: 'abogado', contacto: null, activo: true });
    await repo.crearProfesional({ nombre: 'Abg. Bea', profesion: 'abogado', contacto: null, activo: true });

    // N de la misma profesión = N filas distintas
    expect((await repo.listProfesionales()).filter((p) => p.profesion === 'abogado')).toHaveLength(2);

    await repo.editarProfesional(a.id, { nombre: 'Abg. Ana Pérez' });
    await repo.setActivoProfesional(a.id, false);

    const list = await repo.listProfesionales();
    expect(list.find((p) => p.id === a.id)).toMatchObject({ nombre: 'Abg. Ana Pérez', activo: false });
  });
});
