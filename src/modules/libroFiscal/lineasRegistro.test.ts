import { describe, expect, it } from 'vitest';
import { montoEscrito, municipioDeLinea, sujetoDeLineas } from './lineasRegistro';
import { pFacturaDe, pLineaDe } from './retencionFacturas.repository';

describe('monto retenido escrito a mano (D41, Lote 1)', () => {
  it('vacío = el calculado; «0» = 0 (no se cambia por base × %); ilegible = null', () => {
    expect(montoEscrito('', 120)).toBe(120);
    expect(montoEscrito('  ', 120)).toBe(120);
    expect(montoEscrito('0', 120)).toBe(0);
    expect(montoEscrito('1.234,5', 120)).toBe(1234.5);
    expect(montoEscrito('12a', 120)).toBeNull();
  });
});

describe('sujeto del ISLR y municipio del ISAE en el registro por factura (antes llegaban null)', () => {
  it('el sujeto de la cabecera es el de las líneas de ISLR; sin ISLR, null', () => {
    expect(sujetoDeLineas([{ tipo: 'iva', sujeto: 'pj_domiciliada' }, { tipo: 'islr', sujeto: 'pn_residente' }])).toEqual({ sujeto: 'pn_residente', error: null });
    expect(sujetoDeLineas([{ tipo: 'iva', sujeto: 'pj_domiciliada' }])).toEqual({ sujeto: null, error: null });
  });

  it('dos líneas de ISLR con sujetos distintos no se registran', () => {
    expect(sujetoDeLineas([{ tipo: 'islr', sujeto: 'pj_domiciliada' }, { tipo: 'islr', sujeto: 'pn_residente' }]).error).toMatch(/mismo sujeto/);
  });

  it('el municipio va solo en el ISAE, el de la empresa', () => {
    expect(municipioDeLinea('municipal', { municipio: ' Caroní ' })).toBe('Caroní');
    expect(municipioDeLinea('islr', { municipio: 'Caroní' })).toBeNull();
    expect(municipioDeLinea('municipal', { municipio: null })).toBeNull();
  });

  it('llegan a la RPC: p_factura.sujeto y p_lineas[].municipio', () => {
    const f = pFacturaDe({ direccion: 'practicada', docKind: 'manual', contraparteSujeto: 'pn_residente', actor: 'prueba@ejemplo.com' });
    expect(f.sujeto).not.toBeNull();
    const l = pLineaDe({ tipo: 'municipal', base: 1000, porcentaje: 2, monto: 20, municipio: municipioDeLinea('municipal', { municipio: 'Caroní' }) });
    expect(l.municipio).toBe('Caroní');
  });
});
