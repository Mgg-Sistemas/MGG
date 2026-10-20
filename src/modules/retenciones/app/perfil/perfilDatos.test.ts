import { describe, expect, it } from 'vitest';
import { actividadDeFila, cambioDeFila, perfilDeFila, planActividades, tipoDeFila } from './perfilDatos';
import type { ActividadProveedor } from './actividadesLicencia';

// Filas inventadas, con las columnas de la vista y las tablas de BD (v2.2 05; v8p-03, 04 y 05).
describe('el perfil leído de la base', () => {
  it('la fila de retencion_perfil_proveedor_v', () => {
    const p = perfilDeFila({
      proveedor_id: 'p1', razon_social: 'Proveedor Alfa C.A.', rif: 'J-00000001-0', direccion: 'Calle 1', vigente: true,
      tipo_contribuyente: 'especial', persona: 'pj_domiciliada', actividad_codigo: '1.1', sujeto_100_portal: null, licencia_actividad: 'LIC-1',
      numero_id: null, tiene_perfil: true, completo: true, actualizado_por: 'usuaria@ejemplo.com', actualizado_en: '2026-10-05T14:15:00Z',
      licencia_tipo_id: 't1', licencia_tipo: 'Permanente', licencia_emision: '2026-01-01', licencia_vence: '2027-01-01', actividades: 2,
    });
    expect(p.perfil).toMatchObject({ proveedorId: 'p1', tipoContribuyente: 'especial', persona: 'pj_domiciliada', licenciaActividad: 'LIC-1', completo: true });
    expect(p.licencia).toEqual({ tipoId: 't1', emision: '2026-01-01', vence: '2027-01-01' });
  });
  it('valores fuera de la lista no pasan como válidos', () => {
    const p = perfilDeFila({ proveedor_id: 'p1', razon_social: 'X', rif: 'J-1', tipo_contribuyente: 'raro', persona: 'otra', vigente: false });
    expect(p.perfil.tipoContribuyente).toBeNull();
    expect(p.perfil.persona).toBeNull();
    expect(p.perfil.vigente).toBe(false);
  });
  it('una actividad, un tipo de licencia y un cambio del historial', () => {
    expect(actividadDeFila({ id: 'a1', actividad_codigo: '1.1', principal: true, desde: '2026-01-01', hasta: null }))
      .toEqual({ id: 'a1', codigo: '1.1', principal: true, desde: '2026-01-01', hasta: null });
    expect(tipoDeFila({ id: 't1', nombre: 'Permanente', activo: true, vigencia_meses: 12 })).toEqual({ id: 't1', nombre: 'Permanente', activo: true, vigenciaMeses: 12 });
    expect(cambioDeFila({ antes: null, despues: 'LIC-1', origen: 'ficha', actor: 'u@ejemplo.com', actor_name: null, created_at: '2026-10-05T14:15:00Z' }, (iso) => iso.slice(0, 10)))
      .toEqual({ antes: null, despues: 'LIC-1', origen: 'ficha', quien: 'u@ejemplo.com', cuando: '2026-10-05' });
  });
});

describe('el plan para guardar las actividades (v8p-04: sin DELETE; el mismo código activo, una vez)', () => {
  const a = (id: string | undefined, codigo: string, principal: boolean, hasta: string | null = null): ActividadProveedor =>
    ({ ...(id ? { id } : {}), codigo, principal, desde: '2026-01-01', hasta });
  it('sin cambios, nada', () => {
    expect(planActividades([a('a1', '1.1', true)], [a('a1', '1.1', true)])).toEqual({ desactivar: [], actualizar: [], insertar: [] });
  });
  it('cambia la principal y cierra: primero lo que deja de ser principal', () => {
    const p = planActividades([a('a1', '1.1', true), a('a2', '2.2', false)], [a('a1', '1.1', false, '2026-10-20'), a('a2', '2.2', true)]);
    expect(p.actualizar).toEqual([{ id: 'a1', principal: false, hasta: '2026-10-20' }, { id: 'a2', principal: true, hasta: null }]);
  });
  it('una nueva se inserta; si repite un código cerrado, la cerrada se desactiva antes', () => {
    const p = planActividades([a('a1', '1.1', false, '2026-05-01'), a('a2', '2.2', true)], [a('a1', '1.1', false, '2026-05-01'), a('a2', '2.2', true), a(undefined, '1.1', false), a(undefined, '3.3', false)]);
    expect(p.desactivar).toEqual(['a1']);
    expect(p.insertar).toEqual([{ actividad_codigo: '1.1', principal: false, desde: '2026-01-01', hasta: null }, { actividad_codigo: '3.3', principal: false, desde: '2026-01-01', hasta: null }]);
  });
});
