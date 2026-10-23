import { describe, expect, it } from 'vitest';
import {
  AYUDA_ORDEN, ROTULO_ORDEN, fraseCondicion, frasePaso, rotuloAutor, rotuloEstado, rotuloImpuesto, rotuloMotivo, rotuloParametro,
  rotuloSerie, rotuloSujeto, rotuloTablaHistorial, rotuloUnidad, rotuloValorPieza, siglaSujeto, sinRotulo,
} from './rotulos';

describe('rótulos: ninguna clave técnica a la vista (usuario 21/10 11:15)', () => {
  it('impuestos por clave o tipo interno', () => {
    expect(rotuloImpuesto('MUNICIPAL')).toBe('ISAE (municipal)');
    expect(rotuloImpuesto('regional')).toBe('Estadal (timbre fiscal)');
    expect(rotuloImpuesto(null)).toBe('Todos los impuestos');
  });

  it('sujetos con su nombre, y la sigla explicada', () => {
    expect(rotuloSujeto('PJD')).toBe('Persona jurídica domiciliada');
    expect(rotuloSujeto('pn_residente')).toBe('Persona natural residente');
    expect(siglaSujeto('PNNR')).toBe('PNNR · Persona natural no residente');
  });

  it('series, unidades, estados y parámetros', () => {
    expect(rotuloSerie('AAAAMM8')).toMatch(/^Año, mes y 8 dígitos/);
    expect(rotuloSerie('N10')).toBe('10 dígitos continuos');
    expect(rotuloUnidad('dias')).toBe('días');
    expect(rotuloEstado('en_prueba')).toBe('En prueba');
    expect(rotuloEstado('sufrida')).toBe('Recibida');
    expect(rotuloParametro('pct_retencion')).toBe('% de retención');
    expect(rotuloParametro('unidad_tributaria')).toBe('Unidad tributaria');
    expect(rotuloParametro('cualquiera', 'Nombre de la base')).toBe('Nombre de la base');
  });

  it('una clave sin rótulo nunca sale cruda (en producción y pruebas, en palabras)', () => {
    expect(sinRotulo('clave_nueva_rara')).toBe('Clave nueva rara');
    expect(sinRotulo('')).toBe('—');
  });

  it('historial: «postgres» es el sistema; un motivo sembrado es «Carga inicial del sistema»; la tabla en palabras', () => {
    expect(rotuloAutor('postgres')).toBe('Sistema (carga inicial)');
    expect(rotuloAutor('ana@ejemplo.com')).toBe('ana@ejemplo.com');
    expect(rotuloMotivo('Valor de arranque (R2; antes V1). Vale también para fechas anteriores.')).toBe('Carga inicial del sistema');
    expect(rotuloMotivo('Carga inicial R3: UT vigente desde el 02/06/2025')).toBe('Carga inicial del sistema');
    expect(rotuloMotivo('Arranque R7: lo que hoy hace el código (retencionesCalculo.ts)')).toMatch(/^Regla inicial/);
    expect(rotuloMotivo('Cambio de providencia')).toBe('Cambio de providencia');
    expect(rotuloTablaHistorial('retencion_impuestos')).toBe('Datos del impuesto');
    expect(rotuloTablaHistorial('retencion_impuesto_versiones')).toBe('Cambio de valores vigentes');
  });

  it('«Orden» se dice «Posición en la lista», con su ayuda', () => {
    expect(ROTULO_ORDEN).toBe('Posición en la lista');
    expect(AYUDA_ORDEN).toMatch(/menor aparecen primero/);
  });
});

describe('reglas en palabras', () => {
  it('condiciones: la empresa, quién retiene, el documento', () => {
    expect(fraseCondicion({ pieza: 'condicion_agente', operador: 'en', valor: ['agente_retencion', 'contribuyente_especial'] }))
      .toBe('La empresa es agente de retención o contribuyente especial');
    expect(fraseCondicion({ pieza: 'direccion', operador: 'es', valor: 'practicada' })).toBe('La retención la practica la empresa (no la recibe)');
    expect(fraseCondicion({ pieza: 'direccion', operador: 'es', valor: 'sufrida' })).toMatch(/recibida/);
    expect(fraseCondicion({ pieza: 'tipo_documento', operador: 'no_en', valor: ['nota_credito', 'pago'] })).toBe('El documento no es nota de crédito ni pago');
    expect(fraseCondicion({ pieza: 'sujeto', operador: 'es', valor: 'PNR' })).toBe('El proveedor es persona natural residente');
    expect(rotuloValorPieza('tipo_documento', 'nota_debito')).toBe('Nota de débito');
  });

  it('pasos: la base, cuánto se retiene con su valor vigente, y el paso que no se usa', () => {
    expect(frasePaso({ paso: 1, operacion: 'componer_base', valores: { componentes: [{ campo: 'iva', signo: '+' }] } })).toBe('Base: el IVA de la factura');
    const vigente = (c: string) => ({ pct_retencion: 75, pct_retencion_art5: 100 } as Record<string, number>)[c];
    expect(frasePaso({ paso: 6, operacion: 'retener_pct', valores: { parametro: 'pct_retencion', supuestos: 'pct_retencion_art5' } }, vigente))
      .toBe('Cuánto se retiene: el % de retención (75 %), o 100 % si aplica un supuesto del art. 5');
    expect(frasePaso(null)).toBe('—, no aplica a este impuesto');
    expect(frasePaso({ paso: 8, operacion: 'redondear', valores: { decimales: 2 } })).toBe('Redondeo: 2 decimales');
    for (const t of [frasePaso({ paso: 4, operacion: 'pct_clasificacion', valores: { clasificacion: 'islr_conceptos' } })]) expect(t).not.toMatch(/_/);
  });
});
