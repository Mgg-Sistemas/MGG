import { describe, expect, it } from 'vitest';
import { estadoDePrueba } from '../pruebas/datosPrueba';
import type { ContCambio, ContMonedaLocal } from '../tipos';
import {
  coincide, erroresActivarCentro, erroresInactivarCentro, erroresInactivarMoneda, erroresInactivarTipo, erroresModificarCentro,
  erroresModificarTipo, esTipoDelSistema, normalizarAuxiliar, tasasConCambios, validarAuxiliar, validarCambio, validarCentroCosto,
  validarMoneda, validarMonedaLocal, validarPais, validarTipoComprobante,
} from './catalogos';
import { MONEDAS_GALAC, PAISES_GALAC, TIPOS_COMPROBANTE_GALAC } from './catalogosGalac';

const e = estadoDePrueba();
const p = e.cont_parametros;

describe('tipos de comprobante (2 dígitos de Galac; 90-98 del sistema)', () => {
  it('el alta exige 2 dígitos, únicos, y fuera del 90-98', () => {
    expect(validarTipoComprobante({ codigo: '12', nombre: 'Nómina', origen: 'ambos' }, e.cont_tipos_comprobante)).toEqual([]);
    expect(validarTipoComprobante({ codigo: 'NO', nombre: 'x', origen: 'ambos' }, e.cont_tipos_comprobante))
      .toEqual(['El código del tipo de comprobante son 2 dígitos (por ejemplo, 07).']);
    expect(validarTipoComprobante({ codigo: '93', nombre: 'x', origen: 'ambos' }, e.cont_tipos_comprobante))
      .toEqual(['Los códigos del 90 al 98 son del sistema: el 93 no se puede usar.']);
    expect(validarTipoComprobante({ codigo: '99', nombre: 'x', origen: 'ambos' }, e.cont_tipos_comprobante)).toEqual([]);
    const conUno = [...e.cont_tipos_comprobante, { id: 'tc-77', codigo: '77', nombre: 'Otro', origen: 'ambos' as const, activo: true, sistema: false }];
    expect(validarTipoComprobante({ codigo: '77', nombre: 'x', origen: 'ambos' }, conUno)).toEqual(['Ya existe el tipo de comprobante 77.']);
  });

  it('del sistema: solo el 90-98 (DDL v0.8); los de los procesos salen de Parámetros y no son «sistema»', () => {
    expect(['90', '93', '98'].every(esTipoDelSistema)).toBe(true);
    expect(['01', '09', '10', '11', '89', '99'].some(esTipoDelSistema)).toBe(false);
    const ap = e.cont_tipos_comprobante.find((t) => t.codigo === '93')!;
    expect(ap.sistema).toBe(true);
    expect(erroresModificarTipo(ap, { nombre: 'x', origen: 'manual' })).toEqual(['El tipo 93 es del sistema: no se modifica.']);
    expect(erroresInactivarTipo(ap, [], p)).toContain('El tipo 93 es del sistema: no se inactiva.');
    const ajuste = e.cont_tipos_comprobante.find((t) => t.codigo === '10')!;
    expect(erroresModificarTipo(ajuste, { nombre: 'Ajuste del mes', origen: 'manual' })).toEqual([]);
  });

  it('no se inactiva el tipo elegido en Parámetros para un proceso', () => {
    const di = e.cont_tipos_comprobante.find((t) => t.codigo === '09')!;
    expect(erroresInactivarTipo(di, [], p)).toEqual(['El tipo 09 está elegido en Parámetros para un proceso: primero se cambia allí.']);
  });

  it('la lista de Galac es la de BD: 15 tipos, el 90-98 marcado como sistema', () => {
    expect(TIPOS_COMPROBANTE_GALAC).toHaveLength(15);
    expect(TIPOS_COMPROBANTE_GALAC.filter((t) => t.sistema).map((t) => t.codigo)).toEqual(['90', '91', '92', '93', '94', '95', '96', '97', '98']);
    expect(TIPOS_COMPROBANTE_GALAC.every((t) => t.sistema === esTipoDelSistema(t.codigo))).toBe(true);
  });
});

describe('centros de costo', () => {
  const centros = e.cont_centros_costo;
  it('alta: código único y padre activo', () => {
    expect(validarCentroCosto({ codigo: 'cc-99', nombre: 'Nuevo', tipo: 'area', padre_id: null }, centros)).toEqual([]);
    expect(validarCentroCosto({ codigo: centros[0].codigo.toLowerCase(), nombre: 'x', tipo: 'area', padre_id: null }, centros))
      .toEqual([`Ya existe el centro de costo ${centros[0].codigo}.`]);
  });

  it('modificar no deja formar un ciclo ni colgar de sí mismo', () => {
    const [a, b] = centros;
    const conHijo = centros.map((c) => (c.id === b.id ? { ...c, padre_id: a.id } : c));
    expect(erroresModificarCentro(a, { nombre: 'x', tipo: a.tipo, padre_id: a.id }, conHijo)).toEqual(['Un centro no puede depender de sí mismo.']);
    expect(erroresModificarCentro(a, { nombre: 'x', tipo: a.tipo, padre_id: b.id }, conHijo)).toEqual(['Ese padre depende del propio centro: se formaría un ciclo.']);
  });

  it('el centro por defecto de Parámetros no se inactiva; un hijo no se activa con el padre inactivo', () => {
    const porDefecto = centros.find((c) => c.id === p.centro_costo_defecto_id)!;
    expect(erroresInactivarCentro(porDefecto, centros, p)[0]).toMatch(/es el centro por defecto de Parámetros/);
    const padre = { ...centros[1], activo: false };
    const hijo = { ...centros[2], padre_id: padre.id };
    expect(erroresActivarCentro(hijo, [padre, hijo])).toEqual([`El centro padre ${padre.codigo} está inactivo: se activa primero.`]);
  });
});

describe('auxiliares', () => {
  it('único por tipo y código; RIF guardado como «LETRA-DÍGITOS»', () => {
    const a = e.cont_auxiliares[0];
    expect(validarAuxiliar({ tipo: a.tipo, codigo: a.codigo, nombre: 'x', rif: '' }, e.cont_auxiliares)[0]).toMatch(/^Ya existe el auxiliar/);
    expect(validarAuxiliar({ tipo: a.tipo === 'cliente' ? 'proveedor' : 'cliente', codigo: a.codigo, nombre: 'x', rif: '' }, e.cont_auxiliares)).toEqual([]);
    expect(normalizarAuxiliar({ tipo: 'proveedor', codigo: ' prv-1 ', nombre: ' acme ', rif: 'j-12.345.678-9' }))
      .toEqual({ tipo: 'proveedor', codigo: 'PRV-1', nombre: 'ACME', rif: 'J-123456789' });
    expect(validarAuxiliar({ tipo: 'proveedor', codigo: 'X', nombre: 'x', rif: 'J-' }, e.cont_auxiliares)).toEqual(['El RIF no tiene dígitos: se escribe como J-123456789.']);
  });
});

describe('monedas, países y monedas locales', () => {
  it('moneda: 3 letras o dígitos (como los de Galac, «1BT»), única', () => {
    expect(validarMoneda({ codigo: '1bt', nombre: 'Bitcoin', simbolo: '' }, e.cont_monedas)).toEqual([]);
    expect(validarMoneda({ codigo: 'USD', nombre: 'x', simbolo: '' }, e.cont_monedas)).toEqual(['Ya existe la moneda USD.']);
    expect(validarMoneda({ codigo: 'DOLAR', nombre: 'x', simbolo: '' }, e.cont_monedas)[0]).toMatch(/3 o 4 letras o dígitos/);
  });

  it('la funcional y la de referencia no se inactivan, ni la moneda local activa de un país', () => {
    const ves = e.cont_monedas.find((m) => m.codigo === 'VES')!;
    expect(erroresInactivarMoneda(ves, p, [])).toEqual(['La moneda VES es la funcional de la compañía: no se inactiva.']);
    const eur = e.cont_monedas.find((m) => m.codigo === 'EUR')!;
    const local: ContMonedaLocal = { codigo_pais: 'VE', codigo_moneda: 'EUR', factor_conversion: 1, codigo_moneda_anterior: 'EUR', vigencia_desde: '2020-01-01', vigencia_hasta: '2079-06-06', activo: true };
    expect(erroresInactivarMoneda(eur, p, [local])).toEqual(['La moneda EUR es la moneda local de VE: primero se inactiva esa moneda local.']);
  });

  it('país: 2 letras ISO, único', () => {
    expect(validarPais({ codigo: 've', nombre: 'Venezuela' }, e.cont_paises)).toEqual(['Ya existe el país VE.']);
    expect(validarPais({ codigo: 'COL', nombre: 'Colombia' }, e.cont_paises)[0]).toMatch(/2 letras/);
  });

  it('moneda local: país y monedas existentes, vigencia ordenada y sin solaparse en el país', () => {
    const base = { codigo_pais: 'VE', codigo_moneda: 'VES', factor_conversion: 1, codigo_moneda_anterior: 'VES', vigencia_desde: '2021-10-01', vigencia_hasta: '2079-06-06' };
    expect(validarMonedaLocal(base, [], e.cont_paises, e.cont_monedas)).toEqual([]);
    const vieja: ContMonedaLocal = { ...base, codigo_moneda: 'USD', vigencia_desde: '2000-01-01', vigencia_hasta: '2021-12-31', activo: true };
    expect(validarMonedaLocal(base, [vieja], e.cont_paises, e.cont_monedas)).toEqual(['La vigencia se solapa con la de USD (2000-01-01 a 2021-12-31) en VE.']);
    expect(validarMonedaLocal({ ...base, vigencia_desde: '2080-01-01' }, [], e.cont_paises, e.cont_monedas))
      .toEqual(['La vigencia «desde» es posterior a la vigencia «hasta».']);
    expect(validarMonedaLocal({ ...base, codigo_pais: 'ZZ' }, [], e.cont_paises, e.cont_monedas)).toEqual(['El país ZZ no existe o está inactivo.']);
  });

  it('las listas de fábrica son las de BD: 75 monedas con sus marcas y 15 países', () => {
    expect(MONEDAS_GALAC).toHaveLength(75);
    expect(MONEDAS_GALAC.filter((m) => m.codigo_completado_por_iso).length).toBeGreaterThan(0);
    expect(MONEDAS_GALAC.find((m) => m.codigo === 'VED')).toMatchObject({ nombre: 'Bolívar', simbolo: 'Bs' });
    expect(PAISES_GALAC).toHaveLength(15);
  });
});

describe('cambio (tasas manuales)', () => {
  const cambio = (fecha: string, tasa: number, activo = true): ContCambio => ({
    id: `c-${fecha}`, fecha, moneda: 'USD', tasa_ves: tasa, fuente: 'manual', activo, created_at: '', created_by: null, updated_at: null, updated_by: null,
  });

  it('una tasa por moneda y día; la funcional no lleva tasa', () => {
    expect(validarCambio({ moneda: 'USD', fecha: '2026-07-01', tasa_ves: 100 }, [cambio('2026-07-01', 90)], e.cont_monedas, p))
      .toEqual(['Ya hay un cambio de USD para el 2026-07-01: se modifica ese.']);
    expect(validarCambio({ moneda: 'VES', fecha: '2026-07-01', tasa_ves: 1 }, [], e.cont_monedas, p)).toEqual(['La moneda funcional (VES) no lleva tasa: vale 1.']);
    expect(validarCambio({ moneda: 'USD', fecha: '2026-07-01', tasa_ves: 0 }, [], e.cont_monedas, p)[0]).toMatch(/mayor que cero/);
  });

  it('la manual manda en su fecha; las demás fechas siguen con las del sistema; una inactiva no cuenta', () => {
    const sistema = [{ moneda: 'USD', fecha: '2026-07-01', tasa: 'bcv' }, { moneda: 'USD', fecha: '2026-07-02', tasa: 'bcv' }];
    const r = tasasConCambios(sistema, [cambio('2026-07-01', 99), cambio('2026-07-03', 98), cambio('2026-07-02', 1, false)], (c) => ({ moneda: c.moneda, fecha: c.fecha, tasa: `manual ${c.tasa_ves}` }));
    expect(r.sort((a, b) => a.fecha.localeCompare(b.fecha))).toEqual([
      { moneda: 'USD', fecha: '2026-07-01', tasa: 'manual 99' },
      { moneda: 'USD', fecha: '2026-07-02', tasa: 'bcv' },
      { moneda: 'USD', fecha: '2026-07-03', tasa: 'manual 98' },
    ]);
  });
});

describe('Buscar', () => {
  it('sin acentos ni mayúsculas, en cualquiera de los campos', () => {
    expect(coincide('bolivar', 'VED', 'Bolívar')).toBe(true);
    expect(coincide('ved', 'VED', 'Bolívar')).toBe(true);
    expect(coincide('euro', 'VED', 'Bolívar')).toBe(false);
    expect(coincide('', 'x')).toBe(true);
  });
});
