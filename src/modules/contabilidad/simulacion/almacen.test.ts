import { describe, expect, it, vi } from 'vitest';
import { crearRepositorio } from '../contabilidad.repository';
import { estadoDePrueba } from '../pruebas/datosPrueba';
import type { CuentaInput } from '../tipos';
import { AlmacenSimulado, CLAVE_SIMULACION, type Almacenamiento } from './almacen';

function memoria(inicial: Record<string, string> = {}): Almacenamiento & { datos: Record<string, string> } {
  const datos = { ...inicial };
  return {
    datos,
    getItem: (k) => datos[k] ?? null,
    setItem: (k, v) => { datos[k] = v; },
    removeItem: (k) => { delete datos[k]; },
  };
}

/** Un almacén con los datos chicos de prueba (la base de la app son los datos de BD). */
const almacenDePrueba = (m: Almacenamiento | null = memoria()) => new AlmacenSimulado(m, async () => estadoDePrueba());

const cuenta = (codigo: string, x: Partial<CuentaInput> = {}): CuentaInput => ({
  codigo, nombre: 'Cuenta nueva', es_movimiento: true, naturaleza: 'deudora', clase: 'activo',
  exige_centro_costo: false, exige_auxiliar: false, tipo_auxiliar: null, moneda: null, es_monetaria: false, ...x,
});

describe('almacén simulado', () => {
  it('sin nada guardado arranca con la base', async () => {
    const a = almacenDePrueba();
    expect((await a.leer()).cont_cuentas.length).toBe(estadoDePrueba().cont_cuentas.length);
  });

  it('lo que se lee es una copia: modificarla no cambia el almacén', async () => {
    const a = almacenDePrueba();
    (await a.leer()).cont_cuentas[0].nombre = 'OTRA COSA';
    expect((await a.leer()).cont_cuentas[0].nombre).toBe('ACTIVO');
  });

  it('guarda SOLO la capa de cambios, y otro almacén la recupera sobre la base', async () => {
    const m = memoria();
    await almacenDePrueba(m).modificar((e) => {
      e.cont_parametros.empresa_nombre = 'PRUEBA';
      e.cont_cuentas.find((c) => c.codigo === '1.1.01.01.001')!.nombre = 'CAJA RENOMBRADA';
    });
    const capa = JSON.parse(m.datos[CLAVE_SIMULACION]);
    expect(capa.parametros.empresa_nombre).toBe('PRUEBA');
    expect(capa.tablas.cont_cuentas.cambiadas).toHaveLength(1);
    expect(capa.tablas.cont_comprobantes).toBeUndefined();
    const otro = await almacenDePrueba(m).leer();
    expect(otro.cont_parametros.empresa_nombre).toBe('PRUEBA');
    expect(otro.cont_cuentas.find((c) => c.codigo === '1.1.01.01.001')!.nombre).toBe('CAJA RENOMBRADA');
    expect(otro.cont_cuentas.length).toBe(estadoDePrueba().cont_cuentas.length);
  });

  it('las filas nuevas y las quitadas también viajan en la capa', async () => {
    const m = memoria();
    await almacenDePrueba(m).modificar((e) => {
      const l = e.cont_comprobante_lineas;
      e.cont_comprobante_lineas = l.filter((x) => x.id !== l[0].id).concat({ ...l[1], id: 'linea-nueva' });
    });
    const recuperado = await almacenDePrueba(m).leer();
    const ids = recuperado.cont_comprobante_lineas.map((x) => x.id);
    expect(ids).toContain('linea-nueva');
    expect(ids).not.toContain(estadoDePrueba().cont_comprobante_lineas[0].id);
  });

  it('un cambio que lanza error no deja nada a medias', async () => {
    const m = memoria();
    const a = almacenDePrueba(m);
    await expect(a.modificar((e) => { e.cont_cuentas.length = 0; throw new Error('falla'); })).rejects.toThrow('falla');
    expect((await a.leer()).cont_cuentas.length).toBeGreaterThan(0);
    expect(m.datos[CLAVE_SIMULACION]).toBeUndefined();
  });

  it('descarta una capa de otra versión o ilegible', async () => {
    const vieja = JSON.stringify({ version: 999, tablas: { cont_cuentas: { cambiadas: [], quitadas: ['cta-1'] } } });
    expect((await almacenDePrueba(memoria({ [CLAVE_SIMULACION]: vieja })).leer()).cont_cuentas.some((c) => c.id === 'cta-1')).toBe(true);
    expect((await almacenDePrueba(memoria({ [CLAVE_SIMULACION]: '{no es json' })).leer()).cont_cuentas.length).toBeGreaterThan(0);
  });

  it('si localStorage falla sigue en memoria y avisa una sola vez', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const roto: Almacenamiento = { getItem: () => null, setItem: () => { throw new Error('cuota'); }, removeItem: () => {} };
    const a = almacenDePrueba(roto);
    await a.modificar((e) => { e.cont_parametros.empresa_nombre = 'UNO'; });
    await a.modificar((e) => { e.cont_parametros.empresa_nombre = 'DOS'; });
    expect((await a.leer()).cont_parametros.empresa_nombre).toBe('DOS');
    expect(aviso).toHaveBeenCalledTimes(1);
    aviso.mockRestore();
  });

  it('reiniciar vuelve a la base y borra la capa', async () => {
    const m = memoria();
    const a = almacenDePrueba(m);
    await a.modificar((e) => { e.cont_parametros.empresa_nombre = 'X'; });
    await a.reiniciar();
    expect((await a.leer()).cont_parametros.empresa_nombre).toBe('EMPRESA DE EJEMPLO, C.A.');
    expect(m.datos[CLAVE_SIMULACION]).toBeUndefined();
  });
});

describe('repositorio sobre la simulación · plan de cuentas', () => {
  const repoNuevo = () => crearRepositorio(almacenDePrueba());

  it('crea una cuenta con nivel, padre y actor, y la devuelve ordenada en la lista', async () => {
    const repo = repoNuevo();
    const c = await repo.crearCuenta(cuenta('1.1.01.01.004', { nombre: 'caja de prueba' }), 'ana@ejemplo.test');
    expect(c).toMatchObject({ nivel: 5, padre_id: 'cta-1.1.01.01', nombre: 'CAJA DE PRUEBA', created_by: 'ana@ejemplo.test' });
    const lista = await repo.listCuentas();
    const i = lista.findIndex((x) => x.codigo === '1.1.01.01.004');
    expect(lista[i - 1].codigo).toBe('1.1.01.01.003');
  });

  it('rechaza una cuenta inválida con el motivo en español', async () => {
    await expect(repoNuevo().crearCuenta(cuenta('1.1.01.01.001'), 'x')).rejects.toThrow('Ya existe la cuenta 1.1.01.01.001.');
  });

  it('un título no exige centro ni auxiliar aunque lleguen marcados', async () => {
    await expect(repoNuevo().crearCuenta(cuenta('1.1.01.04', { es_movimiento: false, exige_auxiliar: true, tipo_auxiliar: 'banco' }), 'x'))
      .rejects.toThrow(/no exige centro de costo ni auxiliar/);
  });

  it('no inactiva un título con subcuentas activas; sí al revés', async () => {
    const repo = repoNuevo();
    await expect(repo.cambiarActivaCuenta('cta-1.1.01.01', false)).rejects.toThrow(/subcuentas activas/);
    await repo.cambiarActivaCuenta('cta-1.1.01.01.003', false);
    expect((await repo.listCuentas()).find((c) => c.codigo === '1.1.01.01.003')?.activa).toBe(false);
  });

  it('no activa una cuenta cuyo padre está inactivo', async () => {
    const repo = repoNuevo();
    for (const c of ['001', '002', '003']) await repo.cambiarActivaCuenta(`cta-1.1.01.01.${c}`, false);
    await repo.cambiarActivaCuenta('cta-1.1.01.01', false);
    await expect(repo.cambiarActivaCuenta('cta-1.1.01.01.001', true)).rejects.toThrow(/padre 1\.1\.01\.01 está inactiva/);
  });

  it('reiniciar vuelve a los datos de la base', async () => {
    const repo = repoNuevo();
    await repo.crearCuenta(cuenta('1.1.01.01.004'), 'x');
    await repo.reiniciarDatosEjemplo();
    expect((await repo.listCuentas()).some((c) => c.codigo === '1.1.01.01.004')).toBe(false);
  });

  it('los datos de prueba son coherentes: padre_id coincide con el código y el último nivel es de movimiento', async () => {
    const repo = repoNuevo();
    const lista = await repo.listCuentas();
    const porId = new Map(lista.map((c) => [c.id, c]));
    for (const c of lista) {
      if (c.nivel === 1) expect(c.padre_id).toBeNull();
      else expect(porId.get(c.padre_id!)?.codigo).toBe(c.codigo.split('.').slice(0, -1).join('.'));
      expect(c.es_movimiento).toBe(c.nivel === 5);
      if (c.exige_auxiliar) expect(c.tipo_auxiliar).not.toBeNull();
    }
    const p = await repo.getParametros();
    for (const id of [p.cuenta_resultado_ejercicio_id, p.cuenta_utilidades_retenidas_id, p.cuenta_dif_cambio_ganancia_id, p.cuenta_dif_cambio_perdida_id]) {
      expect(porId.get(id!)?.es_movimiento).toBe(true);
    }
    expect((await repo.listPeriodos()).map((x) => x.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect((await repo.listTiposComprobante()).map((t) => t.codigo)).toEqual(['09', '02', '01', '04', '05', '07', '08', '10', '93', '11']);
  });
});
