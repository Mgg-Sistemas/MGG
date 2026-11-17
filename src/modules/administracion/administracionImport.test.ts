import { describe, expect, it } from 'vitest';
import { analizarGrid, gridDesdeTexto, parseImportacion, type ContextoImport } from './administracionImport';

const ctx: ContextoImport = {
  empresas: [{ clave: 'GT', nombre: 'Golden Touch 1127, C.A.' }, { clave: 'DEMO1', nombre: 'Minera Demo Norte, C.A.' }],
  categorias: [{ id: 'cat-serv', nombre: 'Servicios públicos' }, { id: 'cat-alq', nombre: 'Alquiler' }],
};

describe('parseImportacion', () => {
  it('mapea columnas por nombre, no por orden; deriva período y estado', () => {
    const csv = [
      'fecha,empresa,concepto,moneda,monto,categoria',
      '2026-10-05,GT,Agua,Bs,"1.800,00",Servicios públicos',
      '05/10/2026,DEMO1,Internet,USD,95.50,',
    ].join('\n');
    const { filas, errores } = parseImportacion(csv, ctx);
    expect(errores).toEqual([]);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ empresaClave: 'GT', concepto: 'Agua', moneda: 'Bs', monto: 1800, periodo: '2026-10', estadoPago: 'pagado', origen: 'importado', categoriaGastoId: 'cat-serv' });
    expect(filas[1]).toMatchObject({ empresaClave: 'DEMO1', monto: 95.5, moneda: 'USD', categoriaGastoId: null });
  });

  it('rechaza filas inválidas con su motivo, sin frenar las demás', () => {
    const csv = [
      'empresa,fecha,concepto,monto,moneda',
      'NOEXISTE,2026-10-01,X,10,USD',
      'GT,fecha-mala,X,10,USD',
      'GT,2026-10-01,,10,USD',
      'GT,2026-10-01,Y,abc,USD',
      'GT,2026-10-01,Z,10,EUR',
      'GT,2026-10-01,Bien,10,USD',
    ].join('\n');
    const { filas, errores } = parseImportacion(csv, ctx);
    expect(filas).toHaveLength(1);
    expect(filas[0].concepto).toBe('Bien');
    expect(errores.map((e) => e.fila)).toEqual([2, 3, 4, 5, 6]);
    expect(errores[0].motivo).toMatch(/Empresa/);
  });

  it('falla claro si falta una columna obligatoria o no hay datos', () => {
    expect(parseImportacion('empresa,fecha,concepto,monto\n...', ctx).errores[0].motivo).toMatch(/moneda/);
    expect(parseImportacion('empresa,fecha,concepto,monto,moneda', ctx).errores[0].motivo).toMatch(/no tiene datos/);
  });
});

describe('analizarGrid (validación rica, tipo Depósito Mina)', () => {
  it('clasifica válidas, con error y duplicadas (en archivo y contra la base)', () => {
    const csv = [
      'empresa,fecha,concepto,monto,moneda',
      'GT,2026-10-05,Agua,1800,Bs',    // dup en archivo (con la siguiente)
      'GT,2026-10-05,Agua,1800,Bs',    // dup en archivo
      'NOEXISTE,2026-10-01,X,10,USD',  // error (empresa)
      'GT,2026-11-01,Luz,20,USD',      // dup contra la base
    ].join('\n');
    const a = analizarGrid(gridDesdeTexto(csv), ctx, [{ empresaClave: 'GT', periodo: '2026-11', concepto: 'Luz' }]);
    expect(a.total).toBe(4);
    expect(a.conError).toBe(1);
    expect(a.duplicadas).toBe(3);
    expect(a.yaEnBd).toBe(1);
    expect(a.estado).toBe('Error'); // un error manda sobre el estado general
    expect(a.errorPorColumna.empresa).toBe(1);
  });

  it('estado Validado cuando todo pasa y no hay duplicados', () => {
    const a = analizarGrid(gridDesdeTexto('empresa,fecha,concepto,monto,moneda\nGT,2026-10-05,Agua,1800,Bs'), ctx, []);
    expect(a.estado).toBe('Validado');
    expect(a.validas).toBe(1);
    expect(a.filas[0].input).toMatchObject({ empresaClave: 'GT', concepto: 'Agua', monto: 1800, moneda: 'Bs' });
  });

  it('lanza si falta una columna obligatoria o no hay datos', () => {
    expect(() => analizarGrid(gridDesdeTexto('empresa,fecha,concepto,monto\nGT,2026-10-01,X,10'), ctx, [])).toThrow(/moneda/);
    expect(() => analizarGrid(gridDesdeTexto('empresa,fecha,concepto,monto,moneda'), ctx, [])).toThrow(/no tiene datos/);
  });
});
