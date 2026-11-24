import { describe, expect, it } from 'vitest';
import {
  categoriaDeTabla, accionDeFila, diffHistorial, resumenHistorial, celdaCsvSegura, LABEL_CATEGORIA,
  type FilaHistorial,
} from './historialRetenciones.repository';

describe('historialRetenciones · categoría por tabla', () => {
  it('mapea cada tabla conocida a su tipo de objeto', () => {
    expect(categoriaDeTabla('retenciones')).toBe('retenciones');
    expect(categoriaDeTabla('retencion_documentos')).toBe('retenciones');
    expect(categoriaDeTabla('retencion_impuestos')).toBe('impuestos');
    expect(categoriaDeTabla('retencion_parametros')).toBe('parametros');
    expect(categoriaDeTabla('retencion_agente_condiciones')).toBe('regimen');
    expect(categoriaDeTabla('retencion_facturas_externas')).toBe('buzon');
    expect(categoriaDeTabla('retencion_empresas_receptoras')).toBe('empresas');
    expect(categoriaDeTabla('retencion_reglas')).toBe('reglas');
  });
  it('lo desconocido cae en «otros» (degradación segura)', () => {
    expect(categoriaDeTabla('tabla_nueva_que_no_conozco')).toBe('otros');
  });
  it('toda categoría tiene rótulo legible', () => {
    expect(LABEL_CATEGORIA.regimen).toMatch(/quién retiene/i);
    expect(LABEL_CATEGORIA.buzon).toMatch(/buzón/i);
  });
});

describe('historialRetenciones · acción según antes/después', () => {
  it('sin antes y con después = alta; con antes y sin después = baja; ambos = cambio', () => {
    expect(accionDeFila(null, { a: 1 })).toBe('alta');
    expect(accionDeFila({ a: 1 }, null)).toBe('baja');
    expect(accionDeFila({ a: 1 }, { a: 2 })).toBe('cambio');
  });
});

describe('historialRetenciones · diff de campos', () => {
  it('solo los campos que cambiaron, ordenados', () => {
    const d = diffHistorial({ pct: 75, nombre: 'X', ut: 9 }, { pct: 100, nombre: 'X', ut: 9 });
    expect(d).toEqual([{ campo: 'pct', antes: 75, despues: 100 }]);
  });
  it('un alta (sin antes) lista los campos nuevos contra null', () => {
    const d = diffHistorial(null, { a: 1, b: 2 });
    expect(d.map((x) => x.campo)).toEqual(['a', 'b']);
    expect(d[0]).toEqual({ campo: 'a', antes: null, despues: 1 });
  });
  it('ignora diferencias de orden/identidad en objetos iguales por valor', () => {
    expect(diffHistorial({ a: { x: 1, y: 2 } }, { a: { x: 1, y: 2 } })).toEqual([]);
  });
});

describe('historialRetenciones · resumen por acción', () => {
  const fila = (accion: FilaHistorial['accion']): FilaHistorial => ({
    id: 1, tabla: 'retencion_parametros', clave: 'ut', categoria: 'parametros', categoriaLabel: 'Parámetros',
    accion, antes: null, despues: null, motivo: null, actor: null, at: '2026-10-21T10:00:00Z',
  });
  it('cuenta altas, cambios y bajas', () => {
    const r = resumenHistorial([fila('alta'), fila('alta'), fila('cambio'), fila('baja')]);
    expect(r).toEqual({ total: 4, altas: 2, cambios: 1, bajas: 1 });
  });
  it('lista vacía → todo en cero', () => {
    expect(resumenHistorial([])).toEqual({ total: 0, altas: 0, cambios: 0, bajas: 0 });
  });
});

describe('historialRetenciones · celda CSV segura (anti formula injection)', () => {
  it('antepone comilla simple cuando el texto empieza por = + - @ o tab/retorno', () => {
    expect(celdaCsvSegura('=1+1')).toBe(`"'=1+1"`);
    expect(celdaCsvSegura('+34')).toBe(`"'+34"`);
    expect(celdaCsvSegura('-5')).toBe(`"'-5"`);
    expect(celdaCsvSegura('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(celdaCsvSegura('\tdato')).toBe(`"'\tdato"`);
  });
  it('texto normal solo va entre comillas; las comillas internas se duplican', () => {
    expect(celdaCsvSegura('IVA')).toBe('"IVA"');
    expect(celdaCsvSegura('dice "hola"')).toBe('"dice ""hola"""');
    expect(celdaCsvSegura(null)).toBe('""');
  });
});
