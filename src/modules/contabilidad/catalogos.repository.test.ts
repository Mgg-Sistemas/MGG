/* Repositorio de los catálogos «Auxiliares y Otros» sobre los datos chicos de prueba y, para la
   siembra de las listas de Galac, sobre los datos de BD. Nunca se borra: se inactiva. */
import { describe, expect, it } from 'vitest';
import { crearRepositorio } from './contabilidad.repository';
import { claveMonedaLocal } from './logica/catalogos';
import { estadoDePrueba } from './pruebas/datosPrueba';
import { AlmacenSimulado } from './simulacion/almacen';
import { AlmacenCambios } from './simulacion/almacenCambios';

const nuevo = () => {
  const almacen = new AlmacenSimulado(null, async () => estadoDePrueba());
  const cambios = new AlmacenCambios(null);
  return { almacen, cambios, repo: crearRepositorio(almacen, undefined, cambios) };
};

describe('tipos de comprobante', () => {
  it('alta de un 12, modificación del nombre y el origen; el código no cambia', async () => {
    const { repo } = nuevo();
    const t = await repo.crearTipoComprobante({ codigo: '12', nombre: 'Nómina', origen: 'ambos' }, 'x');
    expect(t).toMatchObject({ id: 'tc-12', codigo: '12', activo: true, sistema: false });
    const m = await repo.modificarTipoComprobante(t.id, { nombre: 'Nómina quincenal', origen: 'manual' });
    expect(m).toMatchObject({ codigo: '12', nombre: 'Nómina quincenal', origen: 'manual' });
    await expect(repo.crearTipoComprobante({ codigo: '95', nombre: 'x', origen: 'ambos' }, 'x')).rejects.toThrow('son del sistema');
  });

  it('se inactiva y se vuelve a activar; el de Parámetros no se inactiva', async () => {
    const { repo } = nuevo();
    const t = await repo.crearTipoComprobante({ codigo: '12', nombre: 'Nómina', origen: 'ambos' }, 'x');
    await repo.cambiarActivoTipoComprobante(t.id, false);
    expect((await repo.listTiposComprobante()).find((x) => x.id === t.id)?.activo).toBe(false);
    await repo.cambiarActivoTipoComprobante(t.id, true);
    await expect(repo.cambiarActivoTipoComprobante('tc-09', false)).rejects.toThrow('está elegido en Parámetros');
  });

  it('Parámetros: los tipos de los procesos se eligen entre los activos, y el cierre los usa', async () => {
    const { repo } = nuevo();
    const t = await repo.crearTipoComprobante({ codigo: '12', nombre: 'Diario general', origen: 'ambos' }, 'x');
    const p = await repo.getParametros();
    const r = await repo.modificarTiposDeParametros({ tipo_comprobante_defecto_id: t.id, tipo_diferencial_id: p.tipo_diferencial_id, tipo_cierre_id: p.tipo_cierre_id, tipo_apertura_id: p.tipo_apertura_id });
    expect(r.tipo_comprobante_defecto_id).toBe('tc-12');
    await expect(repo.modificarTiposDeParametros({ ...r, tipo_cierre_id: null })).rejects.toThrow('Indique en Parámetros el tipo de comprobante del cierre.');
  });
});

describe('centros, auxiliares, monedas y países', () => {
  it('centro: alta en mayúsculas, modificar sin el código, inactivar', async () => {
    const { repo } = nuevo();
    const c = await repo.crearCentroCosto({ codigo: 'cc-90', nombre: 'Planta nueva', tipo: 'sede', padre_id: null });
    expect(c).toMatchObject({ codigo: 'CC-90', nombre: 'PLANTA NUEVA' });
    expect(await repo.modificarCentroCosto(c.id, { nombre: 'Planta 2', tipo: 'area', padre_id: null })).toMatchObject({ codigo: 'CC-90', nombre: 'PLANTA 2', tipo: 'area' });
    await repo.cambiarActivoCentroCosto(c.id, false);
    expect((await repo.listCentrosCosto()).find((x) => x.id === c.id)?.activo).toBe(false);
  });

  it('auxiliar: alta, modificar nombre y RIF, inactivar (nunca se borra)', async () => {
    const { repo } = nuevo();
    const antes = (await repo.listAuxiliares()).length;
    const a = await repo.crearAuxiliar({ tipo: 'proveedor', codigo: 'prv-900', nombre: 'Proveedor nuevo', rif: 'J-1234' });
    await repo.modificarAuxiliar(a.id, { nombre: 'Proveedor renombrado', rif: '' });
    await repo.cambiarActivoAuxiliar(a.id, false);
    const lista = await repo.listAuxiliares();
    expect(lista).toHaveLength(antes + 1);
    expect(lista.find((x) => x.id === a.id)).toMatchObject({ codigo: 'PRV-900', nombre: 'PROVEEDOR RENOMBRADO', rif: null, activo: false });
  });

  it('moneda y país: alta, modificar, inactivar; la funcional no se inactiva', async () => {
    const { repo } = nuevo();
    await repo.crearMoneda({ codigo: 'cad', nombre: 'Dólar canadiense', simbolo: 'Can$' });
    expect(await repo.modificarMoneda('CAD', { nombre: 'Dólar de Canadá', simbolo: 'C$' })).toMatchObject({ codigo: 'CAD', simbolo: 'C$' });
    await expect(repo.cambiarActivaMoneda('VES', false)).rejects.toThrow('es la funcional');
    await repo.crearPais({ codigo: 'co', nombre: 'Colombia' });
    await repo.crearMonedaLocal({ codigo_pais: 'CO', codigo_moneda: 'COP', factor_conversion: 1, codigo_moneda_anterior: 'COP', vigencia_desde: '1900-01-01', vigencia_hasta: '2079-06-06' });
    await expect(repo.cambiarActivoPais('CO', false)).rejects.toThrow('tiene una moneda local activa');
    const [local] = (await repo.listMonedasLocales()).filter((l) => l.codigo_pais === 'CO');
    await repo.cambiarActivaMonedaLocal(claveMonedaLocal(local), false);
    await repo.cambiarActivoPais('CO', false);
    expect((await repo.listPaises()).find((x) => x.codigo === 'CO')?.activo).toBe(false);
  });
});

describe('cambio: la tasa manual manda en su fecha', () => {
  it('getTasa usa la manual del día; sin manual, la del sistema; inactiva, deja de contar', async () => {
    const { repo } = nuevo();
    const fecha = '2026-05-15';
    const delSistema = await repo.getTasa('USD', fecha);
    const c = await repo.crearCambio({ moneda: 'USD', fecha, tasa_ves: 123.456789 }, 'contador@ejemplo.test');
    expect(c).toMatchObject({ fuente: 'manual', created_by: 'contador@ejemplo.test' });
    expect(await repo.getTasa('USD', fecha)).toBe(123.456789);
    await repo.modificarCambio(c.id, { moneda: 'USD', fecha, tasa_ves: 130 }, 'x');
    expect(await repo.getTasa('USD', fecha)).toBe(130);
    await repo.cambiarActivoCambio(c.id, false, 'x');
    expect(await repo.getTasa('USD', fecha)).toBe(delSistema);
    expect(await repo.listCambios()).toHaveLength(1);
  });

  it('vive en su propio almacén: el estado simulado no cambia, y reiniciar lo vacía', async () => {
    const { almacen, cambios, repo } = nuevo();
    const antes = JSON.stringify((await almacen.leer()).cont_tasas);
    await repo.crearCambio({ moneda: 'USD', fecha: '2026-05-15', tasa_ves: 130 }, 'x');
    expect(JSON.stringify((await almacen.leer()).cont_tasas)).toBe(antes);
    expect(await cambios.leer()).toHaveLength(1);
    await repo.reiniciarDatosEjemplo();
    expect(await cambios.leer()).toEqual([]);
  });
});

describe('siembra de las listas de Galac sobre los datos de BD', () => {
  it('las monedas de BD quedan como estaban y se suman las de Galac; los 20 tipos de 2 dígitos de la v1.7', async () => {
    const repo = crearRepositorio(new AlmacenSimulado(null));
    const monedas = await repo.listMonedas();
    expect(monedas.find((m) => m.codigo === 'VES')?.nombre).toBe('Bolívar');
    expect(monedas.find((m) => m.codigo === '1BT')).toMatchObject({ nombre: 'Bitcoin', activa: true });
    expect(monedas.filter((m) => m.codigo === 'USD')).toHaveLength(1);
    const tipos = (await repo.listTiposComprobante()).map((t) => t.codigo);
    expect(tipos).toEqual(expect.arrayContaining(['09', '10', '11', '93', '01', '06', '90', '98']));
    expect(await repo.listPaises()).toHaveLength(15);
    expect(await repo.listMonedasLocales()).toHaveLength(4);
    const p = await repo.getParametros();
    expect([p.tipo_comprobante_defecto_id, p.tipo_diferencial_id, p.tipo_cierre_id, p.tipo_apertura_id]).toEqual(['tc-09', 'tc-10', 'tc-11', 'tc-93']);
  });
});
