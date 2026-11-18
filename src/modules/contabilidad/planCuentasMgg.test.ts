import { describe, expect, it } from 'vitest';
import {
  CENTROS_COSTO_MGG,
  generarPlanCuentasMGG,
  IDENTIDAD_FISCAL_MGG,
  MASCARA_MGG,
  PARAMETROS_MGG,
} from './planCuentasMgg';
import { EMPRESA_MGG_DEFECTO } from './empresasContabilidad';
import { codigoPadre, errorDeFormato, nivelDe } from './logica/planCuentas';

describe('plan de cuentas oficial MGG', () => {
  it('identidad corporativa y parámetros correctos', () => {
    expect(EMPRESA_MGG_DEFECTO.clave).toBe('MGG');
    expect(EMPRESA_MGG_DEFECTO.nombre).toBe('MINERAL GROUP GUAYANA C.A.');
    expect(EMPRESA_MGG_DEFECTO.rif).toBe('J-50221930-7');
    expect(IDENTIDAD_FISCAL_MGG.rif).toBe('J-50221930-7');
    expect(PARAMETROS_MGG.empresa_clave).toBe('MGG');
    expect(PARAMETROS_MGG.empresa_nombre).toBe('MINERAL GROUP GUAYANA C.A.');
    expect(PARAMETROS_MGG.centro_costo_defecto_id).toBe('cc-los-pinos');
  });

  it('los centros de costo cubren las sedes operativas de MGG', () => {
    const ids = CENTROS_COSTO_MGG.map((c) => c.id);
    expect(ids).toContain('cc-admin');
    expect(ids).toContain('cc-los-pinos');
    expect(ids).toContain('cc-matanzas');
    expect(ids).toContain('cc-maquinaria');
    expect(ids).toContain('cc-comedor');
    expect(ids).toContain('cc-combustible');
  });

  it('todos los códigos respetan la máscara oficial de 5 niveles', () => {
    const cuentas = generarPlanCuentasMGG();
    expect(cuentas.length).toBeGreaterThan(50);

    const codigosVistos = new Set<string>();
    for (const c of cuentas) {
      expect(codigosVistos.has(c.codigo), `Código duplicado: ${c.codigo}`).toBe(false);
      codigosVistos.add(c.codigo);

      const err = errorDeFormato(c.codigo, MASCARA_MGG);
      expect(err, `Error en código ${c.codigo}: ${err}`).toBeNull();
      expect(c.empresa_clave).toBe('MGG');
    }
  });

  it('cada subcuenta tiene su cuenta padre existente en el plan', () => {
    const cuentas = generarPlanCuentasMGG();
    const mapa = new Set(cuentas.map((c) => c.codigo));

    for (const c of cuentas) {
      const padre = codigoPadre(c.codigo);
      if (padre !== null) {
        expect(mapa.has(padre), `Padre ${padre} de la cuenta ${c.codigo} no existe`).toBe(true);
      }
    }
  });

  it('las cuentas de nivel 5 son de movimiento y los niveles superiores son de título', () => {
    const cuentas = generarPlanCuentasMGG();
    for (const c of cuentas) {
      const nivel = nivelDe(c.codigo);
      if (nivel === 5) {
        expect(c.es_movimiento, `Nivel 5 ${c.codigo} debe ser movimiento`).toBe(true);
      } else {
        expect(c.es_movimiento, `Nivel ${nivel} ${c.codigo} debe ser de título`).toBe(false);
      }
    }
  });
});
