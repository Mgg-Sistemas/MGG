import { describe, expect, it } from 'vitest';
import { anadirActividad, cerrarActividad, elegirPrincipal, estadoLicencia, principalDe, validarLicencia, venceDesdeEmision, type ActividadProveedor } from './actividadesLicencia';

// Datos inventados.
const a = (codigo: string, principal = false, hasta: string | null = null): ActividadProveedor => ({ codigo, principal, desde: '2026-01-01', hasta });

describe('las actividades del proveedor (maqueta v7-3; tabla retencion_proveedor_actividades, v8p-04)', () => {
  it('la primera que se añade es la principal; el mismo código abierto, una sola vez', () => {
    const r1 = anadirActividad([], '3.2.14.04', '2026-10-20');
    expect(r1).toEqual({ ok: true, actividades: [{ codigo: '3.2.14.04', principal: true, desde: '2026-10-20', hasta: null }] });
    const r2 = anadirActividad(r1.ok ? r1.actividades : [], '1.1', '2026-10-20');
    expect(r2.ok && r2.actividades.map((x) => x.principal)).toEqual([true, false]);
    expect(anadirActividad([a('1.1', true)], '1.1', '2026-10-20')).toEqual({ ok: false, error: 'Esa actividad ya está en el perfil.' });
    expect(anadirActividad([a('1.1', true, '2026-05-01')], '1.1', '2026-10-20').ok).toBe(true);
  });
  it('«sin establecimiento en el municipio» pasa a ser la principal', () => {
    const r = anadirActividad([a('1.1', true)], 'sin_actividad_municipio', '2026-10-20');
    expect(r.ok && r.actividades.map((x) => [x.codigo, x.principal])).toEqual([['1.1', false], ['sin_actividad_municipio', true]]);
  });
  it('rechaza un código mal escrito, como la base', () => {
    expect(anadirActividad([], '3.a', '2026-10-20').ok).toBe(false);
  });
  it('una sola principal; al cerrar la principal, pasa a otra abierta', () => {
    const xs = [a('1.1', true), a('2.2')];
    expect(principalDe(elegirPrincipal(xs, 1))?.codigo).toBe('2.2');
    const c = cerrarActividad(xs, 0, '2026-10-20');
    expect(c[0]).toMatchObject({ principal: false, hasta: '2026-10-20' });
    expect(principalDe(c)?.codigo).toBe('2.2');
    expect(principalDe(cerrarActividad([a('1.1', true)], 0, '2026-10-20'))).toBeNull();
    expect(elegirPrincipal([a('1.1', true), a('2.2', false, '2026-01-31')], 1)).toEqual([a('1.1', true), a('2.2', false, '2026-01-31')]);
  });
});

describe('la licencia: vigencia y aviso de vencimiento (maqueta v7EstadoLicencia; v8p-03, umbral de 30 días)', () => {
  const hoy = '2026-10-20';
  it('sin fecha, vencida, por vencer o al día', () => {
    expect(estadoLicencia(null, hoy, 30)).toEqual({ estado: 'sin_fecha', texto: 'Sin fecha de vigencia: no hay aviso.' });
    expect(estadoLicencia('2026-10-15', hoy, 30)).toEqual({ estado: 'vencida', texto: 'Vencida hace 5 días' });
    expect(estadoLicencia('2026-11-04', hoy, 30)).toEqual({ estado: 'por_vencer', texto: 'Vence en 15 días' });
    expect(estadoLicencia('2026-10-20', hoy, 30)).toEqual({ estado: 'por_vencer', texto: 'Vence hoy' });
    expect(estadoLicencia('2027-03-01', hoy, 30)).toEqual({ estado: 'al_dia', texto: 'Al día' });
  });
  it('el vencimiento propuesto desde la emisión, con los meses del tipo', () => {
    expect(venceDesdeEmision('2026-01-31', 12)).toBe('2027-01-31');
    expect(venceDesdeEmision('2026-01-31', 1)).toBe('2026-02-28');
    expect(venceDesdeEmision('2026-01-31', null)).toBeNull();
    expect(venceDesdeEmision('', 12)).toBeNull();
  });
  it('la vigencia no es anterior a la emisión (la CHECK vence ≥ emision)', () => {
    expect(validarLicencia('2026-01-01', '2026-12-31')).toBeNull();
    expect(validarLicencia('2026-01-01', '2026-01-01')).toBeNull();
    expect(validarLicencia('', '2026-01-01')).toBeNull();
    expect(validarLicencia('2026-02-01', '2026-01-01')).toBe('La vigencia no puede ser anterior a la emisión.');
  });
});
