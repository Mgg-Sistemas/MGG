import { describe, it, expect } from 'vitest';
import { crearRepoDemo } from './demo/datosDemoAdministracion';

describe('AdminRepo · centros de acopio', () => {
  it('CRUD por empresa, ordenados por orden y con activo', async () => {
    const repo = crearRepoDemo();
    const a = await repo.crearCentro({ empresaClave: 'GT', nombre: 'Acopio 1', orden: 1, activo: true });
    await repo.crearCentro({ empresaClave: 'GT', nombre: 'Acopio 2', orden: 2, activo: true });
    await repo.crearCentro({ empresaClave: 'MTO', nombre: 'Otro centro', orden: 1, activo: true });

    expect((await repo.listCentros('GT')).map((c) => c.nombre)).toEqual(['Acopio 1', 'Acopio 2']);

    await repo.editarCentro(a.id, { nombre: 'Acopio Principal' });
    await repo.setActivoCentro(a.id, false);

    const gt = await repo.listCentros('GT');
    expect(gt.find((c) => c.id === a.id)).toMatchObject({ nombre: 'Acopio Principal', activo: false });
    // sin filtro de empresa, lista todos
    expect(await repo.listCentros()).toHaveLength(3);
  });

  it('guarda responsable, fase y descripción del centro', async () => {
    const repo = crearRepoDemo();
    const c = await repo.crearCentro({
      empresaClave: 'GT', nombre: 'Planta de Molienda', orden: 1, activo: true,
      responsablePrincipal: 'Jefe de Planta',
      fasePredeterminada: 'Fase 2: Permisología Minera y Ambiental',
      descripcion: 'Circuito de trituración y recuperación.',
    });
    expect(c).toMatchObject({
      responsablePrincipal: 'Jefe de Planta',
      fasePredeterminada: 'Fase 2: Permisología Minera y Ambiental',
      descripcion: 'Circuito de trituración y recuperación.',
    });

    await repo.editarCentro(c.id, { responsablePrincipal: 'Dirección de Operaciones' });
    const [leido] = await repo.listCentros('GT');
    expect(leido.responsablePrincipal).toBe('Dirección de Operaciones');
  });

  it('un centro nuevo sin esos datos los deja vacíos, no rompe', async () => {
    const repo = crearRepoDemo();
    const c = await repo.crearCentro({ empresaClave: 'GT', nombre: 'Patio', orden: 1, activo: true });
    expect(c.responsablePrincipal ?? null).toBeNull();
    expect(c.fasePredeterminada ?? null).toBeNull();
    expect(c.descripcion ?? null).toBeNull();
  });
});
