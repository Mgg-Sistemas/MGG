import { describe, expect, it } from 'vitest';
import { estadoDePrueba } from '../pruebas/datosPrueba';
import type { ContCuenta, CuentaInput } from '../tipos';
import {
  claseSugerida, codigoPadre, codigosConHijos, codigosHastaNivel, compararCodigos, construirArbol, errorDeFormato, errorDeMascara,
  filtrarArbol, formatoDeMascara, naturalezaSugerida, nivelDe, resumenPlan, siguienteCodigoHijo, validarNuevaCuenta,
} from './planCuentas';

const MASCARA = '9.9.99.99.999';
const plan = (): ContCuenta[] => estadoDePrueba().cont_cuentas;

const nueva = (x: Partial<CuentaInput>): CuentaInput => ({
  codigo: '', nombre: 'CUENTA DE PRUEBA', es_movimiento: true, naturaleza: 'deudora', clase: 'activo',
  exige_centro_costo: false, exige_auxiliar: false, tipo_auxiliar: null, moneda: null, es_monetaria: false, ...x,
});

describe('códigos del plan', () => {
  it('nivel y padre salen de los segmentos', () => {
    expect(nivelDe('1')).toBe(1);
    expect(nivelDe('1.1.01.01.001')).toBe(5);
    expect(codigoPadre('1.1.01.01.001')).toBe('1.1.01.01');
    expect(codigoPadre('1')).toBeNull();
  });

  it('ordena por número de segmento, no por texto', () => {
    const lista = ['1.1.10', '1.2', '1.1.02', '1', '1.1'].sort(compararCodigos);
    expect(lista).toEqual(['1', '1.1', '1.1.02', '1.1.10', '1.2']);
  });

  it('la máscara da el ancho de cada nivel', () => {
    expect(formatoDeMascara(MASCARA)).toEqual([1, 1, 2, 2, 3]);
  });

  it('clase y naturaleza sugeridas por el primer dígito', () => {
    expect(claseSugerida('2.1.01')).toBe('pasivo');
    expect(claseSugerida('9')).toBe('orden');
    expect(naturalezaSugerida('ingreso')).toBe('acreedora');
    expect(naturalezaSugerida('gasto')).toBe('deudora');
  });
});

describe('máscara de niveles (límites de Galac)', () => {
  it('acepta hasta 5 niveles (DDL v0.8) y 20 dígitos', () => {
    expect(errorDeMascara(MASCARA)).toBeNull();
    expect(errorDeMascara('9.9.99.999')).toBeNull();
    expect(errorDeMascara('9999.9999.9999.9999.9999')).toBeNull(); // 5 niveles, 20 dígitos
  });

  it('rechaza más de 5 niveles, más de 20 dígitos o una forma inválida', () => {
    expect(errorDeMascara('9.9.9.9.9.9')).toMatch(/5 niveles/);
    expect(errorDeMascara('9999999999.99999999999')).toMatch(/20 dígitos .*suma 21/);
    expect(errorDeMascara('9.X.99')).toMatch(/nueves separados por punto/);
  });
});

describe('formato del código', () => {
  it('acepta un código que respeta la máscara', () => {
    expect(errorDeFormato('1.1.01.01.001', MASCARA)).toBeNull();
    expect(errorDeFormato('1.1.01', MASCARA)).toBeNull();
  });

  it('rechaza ancho, letras, segmentos vacíos y niveles de más', () => {
    expect(errorDeFormato('1.1.1', MASCARA)).toMatch(/nivel 3 lleva 2/);
    expect(errorDeFormato('1.A', MASCARA)).toMatch(/solo admite dígitos/);
    expect(errorDeFormato('1..01', MASCARA)).toMatch(/segmento vacío/);
    expect(errorDeFormato('1.1.01.01.001.1', MASCARA)).toMatch(/5 niveles/);
    expect(errorDeFormato('  ', MASCARA)).toBe('Código requerido.');
  });
});

describe('validarNuevaCuenta', () => {
  it('una subcuenta bien formada bajo un título se puede crear', () => {
    expect(validarNuevaCuenta(nueva({ codigo: '1.1.01.01.004' }), plan(), MASCARA)).toEqual([]);
  });

  it('no repite un código', () => {
    expect(validarNuevaCuenta(nueva({ codigo: '1.1.01.01.001' }), plan(), MASCARA)).toContain('Ya existe la cuenta 1.1.01.01.001.');
  });

  it('exige que el padre exista', () => {
    expect(validarNuevaCuenta(nueva({ codigo: '1.1.09.01.001' }), plan(), MASCARA).join(' ')).toMatch(/No existe la cuenta padre 1\.1\.09\.01/);
  });

  it('una cuenta de movimiento no admite subcuentas', () => {
    const p = plan();
    // Se convierte un título en movimiento para probar la regla sin depender de un código de 6 niveles.
    p.find((c) => c.codigo === '1.1.01.01')!.es_movimiento = true;
    expect(validarNuevaCuenta(nueva({ codigo: '1.1.01.01.009' }), p, MASCARA).join(' ')).toMatch(/es de movimiento y no admite subcuentas/);
  });

  it('el padre inactivo bloquea', () => {
    const p = plan();
    p.find((c) => c.codigo === '1.1.01.01')!.activa = false;
    expect(validarNuevaCuenta(nueva({ codigo: '1.1.01.01.009' }), p, MASCARA).join(' ')).toMatch(/está inactiva/);
  });

  it('en el último nivel solo hay movimiento', () => {
    expect(validarNuevaCuenta(nueva({ codigo: '1.1.01.01.004', es_movimiento: false }), plan(), MASCARA))
      .toContain('En el último nivel solo hay cuentas de movimiento.');
  });

  it('un título no exige centro ni auxiliar, y el auxiliar pide su tipo', () => {
    expect(validarNuevaCuenta(nueva({ codigo: '1.1.01.04', es_movimiento: false, exige_centro_costo: true }), plan(), MASCARA).join(' '))
      .toMatch(/no exige centro de costo ni auxiliar/);
    expect(validarNuevaCuenta(nueva({ codigo: '1.1.01.01.004', exige_auxiliar: true }), plan(), MASCARA))
      .toContain('Indica el tipo de auxiliar que exige la cuenta.');
  });

  it('el nombre es obligatorio', () => {
    expect(validarNuevaCuenta(nueva({ codigo: '1.1.01.01.004', nombre: '  ' }), plan(), MASCARA)).toContain('Nombre requerido.');
  });
});

describe('árbol', () => {
  it('los seis grupos quedan en la raíz y nadie se pierde', () => {
    const p = plan();
    const raiz = construirArbol(p);
    expect(raiz.map((n) => n.cuenta.codigo)).toEqual(['1', '2', '3', '4', '5', '6']);
    let contadas = 0;
    const contar = (l: typeof raiz) => l.forEach((n) => { contadas++; contar(n.hijos); });
    contar(raiz);
    expect(contadas).toBe(p.length);
  });

  it('una cuenta sin padre queda en la raíz en vez de desaparecer', () => {
    const p = plan().filter((c) => c.codigo !== '1.1.01.01');
    const raiz = construirArbol(p);
    expect(raiz.some((n) => n.cuenta.codigo === '1.1.01.01.001')).toBe(true);
  });

  it('filtrar por nombre sin acentos trae la cuenta con sus ancestros', () => {
    const arbol = construirArbol(plan());
    const r = filtrarArbol(arbol, 'deposito'); // no existe → vacío
    expect(r).toEqual([]);
    const v = filtrarArbol(arbol, 'viveres');
    expect(v.map((n) => n.cuenta.codigo)).toEqual(['1']);
    const hoja = v[0].hijos[0].hijos[0].hijos[0].hijos[0];
    expect(hoja.cuenta.nombre).toBe('VÍVERES DEL COMEDOR');
  });

  it('filtrar por código muestra la rama completa debajo', () => {
    const arbol = construirArbol(plan());
    const r = filtrarArbol(arbol, '2.1.03');
    const nodo = r[0].hijos[0].hijos[0];
    expect(nodo.cuenta.codigo).toBe('2.1.03');
    expect(nodo.hijos.length).toBe(2);
  });

  it('expandir por nivel abre solo los títulos de menos nivel', () => {
    const arbol = construirArbol(plan());
    expect(codigosHastaNivel(arbol, 1)).toEqual([]);
    expect(codigosHastaNivel(arbol, 2)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(codigosConHijos(arbol).every((c) => nivelDe(c) <= 4)).toBe(true);
  });
});

describe('resumen y siguiente código', () => {
  it('cuenta títulos y movimiento', () => {
    const r = resumenPlan(plan());
    expect(r.total).toBe(r.titulos + r.movimiento);
    expect(r.niveles).toBe(5);
    expect(r.inactivas).toBe(0);
  });

  it('propone el siguiente código con el ancho del nivel', () => {
    expect(siguienteCodigoHijo('1.1.01.01', plan(), MASCARA)).toBe('1.1.01.01.004');
    expect(siguienteCodigoHijo('1.1', plan(), MASCARA)).toBe('1.1.05');
    expect(siguienteCodigoHijo('1.1.01.01.001', plan(), MASCARA)).toBeNull();
  });
});
