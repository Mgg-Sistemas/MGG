import { describe, expect, it } from 'vitest';
import type { NominaRenglon } from '@/shared/lib/types';
import { calcularRecibo } from './sueldoQuincena';
import {
  COLUMNAS_BASICO, COLUMNAS_RESUMEN, agruparPorEmpleado, columnasElegidas, construirFila, construirFilas,
  estadoPeriodo, fechaPeriodo, filtrarPeriodos, formatearValor, ordenarPeriodos, tablaResumen, textoAlcance,
  type PeriodoResumen,
} from './resumenNomina';

const periodo = (x: Partial<PeriodoResumen>): PeriodoResumen => ({
  id: 'p1', codigo: 'NOM-2026-0001', nombre: 'Primera quincena de octubre 2026', tipo: 'quincena',
  periodo_desde: '2026-10-15', periodo_hasta: '2026-10-15', dias_base: 15, tasa_bcv: 50,
  estado: 'cargada', total_usd: 0, created_at: '2026-10-15T12:00:00Z', ...x,
}) as PeriodoResumen;

const renglon = (x: Partial<NominaRenglon>): NominaRenglon => ({
  id: 'r1', periodo_id: 'p1', personal_id: 'a', nombre: 'ANA GIL', cargo: 'Analista', departamento: 'Admin',
  sueldo_base_mensual: 200, dias_trabajados: 11, dias_descanso: 4, salario_bruto: 100, asignaciones: 0, viaticos: 0,
  deduc_anticipos: 0, deduc_prestamos: 10, deduc_ivss: 0, deduc_faov: 2, deducciones: [], neto_usd: 88,
  estado: 'por_pagar', created_at: '2026-10-15T12:00:00Z', ...x,
}) as NominaRenglon;

describe('resumen de nómina · la fila', () => {
  it('saca los montos con la misma cuenta que el recibo (20 % sueldo, 80 % bono, préstamos del bono)', () => {
    const f = construirFila(renglon({}), periodo({}), 'V-123', null);
    expect(f.bruto).toBe(100);
    expect(f.sueldoUsd).toBe(20);
    expect(f.sueldoBs).toBe(1000);        // 20 × 50
    expect(f.bonoUsd).toBe(80);
    expect(f.ded.prestamos).toBe(10);
    expect(f.ded.faov).toBe(2);
    expect(f.totalDeducciones).toBe(12);
    expect(f.netoUsd).toBe(18);           // 20 − FAOV (el préstamo no baja de la tabla)
    expect(f.netoBs).toBe(900);
    expect(f.bonoNetoUsd).toBe(70);       // 80 − préstamo
    expect(f.totalRecibidoUsd).toBe(88);
    expect(f.tasa).toBe(50);
    expect(f.cedula).toBe('V-123');
    expect(f.estadoPago).toBe('Por pagar');
    expect(f.fechaPago).toBe('');
  });

  it('coincide número por número con calcularRecibo', () => {
    const r = renglon({ salario_bruto: 173.33, dias_trabajados: 11, dias_descanso: 5, asignaciones: 15, viaticos: 4, deduc_anticipos: 200, deduc_prestamos: 30, deduc_ivss: 3, deduc_faov: 1.5 });
    const f = construirFila(r, periodo({ tasa_bcv: 36.5 }));
    const c = calcularRecibo({ brutoQuincena: 173.33, diasTrabajados: 11, diasDescanso: 5, bonosExtra: 15, viaticos: 4,
      deducciones: { anticipos: 200, prestamos: 30, ivss: 3, faov: 1.5 }, tasa: 36.5 });
    expect(f.netoUsd).toBe(c.netoUsd);
    expect(f.netoBs).toBe(c.netoBs);
    expect(f.bonoNetoUsd).toBe(c.bonoNetoUsd);
    expect(f.totalRecibidoUsd).toBe(c.totalRecibidoUsd);
    expect(f.sueldoUsd).toBe(c.reparto.sueldo);
    // El anticipo que no entró en el bono bajó a la tabla: el total deducido sigue siendo todo.
    expect(f.totalDeducciones).toBe(234.5);
  });

  it('si el renglón se pagó con tasa propia, manda esa; y trae pagado por, fecha y caja', () => {
    const f = construirFila(
      renglon({ estado: 'pagada', tasa_pago: 60, pagada_en: '2026-10-16T15:30:00Z', pagada_por: 'tesoreria@mgg.com', caja_id: 'c1' }),
      periodo({ tasa_bcv: 50 }), null, 'CAJA PRINCIPAL',
    );
    expect(f.tasa).toBe(60);
    expect(f.sueldoBs).toBe(1200);
    expect(f.estadoPago).toBe('Pagada');
    expect(f.fechaPago).toBe('2026-10-16');
    expect(f.pagadoPor).toBe('tesoreria@mgg.com');
    expect(f.caja).toBe('CAJA PRINCIPAL');
  });

  it('sin tasa, los Bs quedan en 0 y la tasa vacía (no inventa una)', () => {
    const f = construirFila(renglon({}), periodo({ tasa_bcv: null }));
    expect(f.tasa).toBeNull();
    expect(f.sueldoBs).toBe(0);
    expect(f.netoBs).toBe(0);
  });
});

describe('resumen de nómina · filas, filtros y agrupación', () => {
  const p1 = periodo({ id: 'p1', periodo_desde: '2026-10-15', tasa_bcv: 50 });
  const p2 = periodo({ id: 'p2', codigo: 'NOM-2026-0002', nombre: 'Segunda quincena de octubre 2026', periodo_desde: '2026-10-30', tasa_bcv: 60, total_renglones: 2, pagados: 2, pendientes: 0 });
  const rens = [
    renglon({ id: 'r1', periodo_id: 'p1', personal_id: 'a', nombre: 'ANA GIL', caja_id: 'c1' }),
    renglon({ id: 'r2', periodo_id: 'p1', personal_id: 'b', nombre: 'BETO RUIZ', salario_bruto: 50, deduc_prestamos: 0, deduc_faov: 0 }),
    renglon({ id: 'r3', periodo_id: 'p2', personal_id: 'a', nombre: 'ANA GIL', estado: 'pagada', pagada_en: '2026-10-31T10:00:00Z', pagada_por: 'teso@mgg.com', caja_id: 'c1', cargo: 'Jefa' }),
    renglon({ id: 'r9', periodo_id: 'otro', personal_id: 'z', nombre: 'NADIE' }),
  ];

  it('arma una fila por renglón de los períodos dados, nuevas primero y por nombre; ignora los de otros períodos', () => {
    const filas = construirFilas({ periodos: [p1, p2], renglones: rens, personal: [{ id: 'a', cedula: 'V-1' }, { id: 'b', cedula: 'V-2' }], cajas: [{ id: 'c1', nombre: 'CAJA MGG' }] });
    expect(filas.map((f) => `${f.empleado}|${f.fechaPeriodo}`)).toEqual(['ANA GIL|2026-10-30', 'ANA GIL|2026-10-15', 'BETO RUIZ|2026-10-15']);
    expect(filas[0].cedula).toBe('V-1');
    expect(filas[0].caja).toBe('CAJA MGG');
    expect(filas[1].caja).toBe('');  // r1 no está pagado: la caja no se muestra aunque tenga id
    expect(filas[2].sueldoUsd).toBe(10);
  });

  it('filtra períodos por rango de fecha y por estado', () => {
    expect(filtrarPeriodos([p1, p2], { desde: '2026-10-20' }).map((p) => p.id)).toEqual(['p2']);
    expect(filtrarPeriodos([p1, p2], { hasta: '2026-10-20' }).map((p) => p.id)).toEqual(['p1']);
    expect(filtrarPeriodos([p1, p2], { desde: '2026-10-01', hasta: '2026-10-31' }).length).toBe(2);
    expect(filtrarPeriodos([p1, p2], { estado: 'pagada' }).map((p) => p.id)).toEqual(['p2']);
    expect(filtrarPeriodos([p1, p2], { estado: 'cargada' }).map((p) => p.id)).toEqual(['p1']);
    expect(filtrarPeriodos([p1, p2], { estado: 'todos' }).length).toBe(2);
  });

  it('el estado sale de los conteos cuando vienen (igual que la pestaña), si no del campo', () => {
    expect(estadoPeriodo(p2)).toBe('pagada');
    expect(estadoPeriodo(periodo({ total_renglones: 3, pagados: 1, pendientes: 2 }))).toBe('en_pago');
    expect(estadoPeriodo(periodo({ estado: 'en_pago' }))).toBe('en_pago');
    expect(estadoPeriodo(periodo({}))).toBe('cargada');
  });

  it('ordena las nóminas de la más nueva a la más vieja y toma la fecha de carga si no hay período', () => {
    expect(ordenarPeriodos([p1, p2]).map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(fechaPeriodo(periodo({ periodo_desde: null, created_at: '2026-09-03T20:00:00Z' }))).toBe('2026-09-03');
  });

  it('agrupar por empleado suma sus nóminas, deja la tasa vacía y muestra cuántas van pagadas', () => {
    const filas = construirFilas({ periodos: [p1, p2], renglones: rens });
    const g = agruparPorEmpleado(filas);
    expect(g.map((f) => f.empleado)).toEqual(['ANA GIL', 'BETO RUIZ']);
    const ana = g[0];
    expect(ana.nominas).toBe(2);
    expect(ana.periodo).toBe('2 nóminas');
    expect(ana.bruto).toBe(200);
    expect(ana.sueldoBs).toBe(1000 + 1200);   // cada quincena con su tasa
    expect(ana.tasa).toBeNull();
    expect(ana.totalRecibidoUsd).toBe(176);
    expect(ana.ded.prestamos).toBe(20);
    expect(ana.estadoPago).toBe('1/2 pagadas');
    expect(ana.fechaPago).toBe('2026-10-31');
    expect(ana.pagadoPor).toBe('teso@mgg.com');
    expect(ana.cargo).toBe('Jefa');            // el de la nómina más reciente
    expect(g[1].nominas).toBe(1);
    expect(g[1].estadoPago).toBe('Por pagar');
  });
});

describe('resumen de nómina · la tabla', () => {
  const filas = construirFilas({ periodos: [periodo({})], renglones: [
    renglon({ id: 'r1', personal_id: 'a', nombre: 'ANA GIL' }),
    renglon({ id: 'r2', personal_id: 'b', nombre: 'BETO RUIZ', salario_bruto: 50, deduc_prestamos: 0, deduc_faov: 0 }),
  ] });

  it('encabezado con N°, filas numeradas y totales solo en las columnas que suman', () => {
    const t = tablaResumen(filas, ['total_recibido_usd', 'empleado', 'tasa', 'dias_trabajados']);
    expect(t.head).toEqual(['N°', 'Trabajador', 'Tasa (Bs/$)', 'Días trab.', 'Total recibido ($)']);
    expect(t.filas[0]).toEqual([1, 'ANA GIL', 50, 11, 88]);
    expect(t.filas[1]).toEqual([2, 'BETO RUIZ', 50, 11, 50]);
    expect(t.totales).toEqual(['TOTAL', '', '', 22, 138]);
    expect(t.personas).toBe(2);
  });

  it('las columnas salen en el orden del catálogo y no hay claves repetidas', () => {
    expect(columnasElegidas(['cedula', 'empleado']).map((c) => c.key)).toEqual(['empleado', 'cedula']);
    expect(new Set(COLUMNAS_RESUMEN.map((c) => c.key)).size).toBe(COLUMNAS_RESUMEN.length);
    expect(COLUMNAS_BASICO.every((k) => COLUMNAS_RESUMEN.some((c) => c.key === k))).toBe(true);
  });

  it('hay una columna por cada deducción del recibo', () => {
    for (const k of ['ivss', 'rpe', 'faov', 'sindicato', 'prestamos', 'anticipos', 'otros']) {
      expect(COLUMNAS_RESUMEN.some((c) => c.key === `ded_${k}`)).toBe(true);
    }
  });

  it('formatea montos en es-VE con dos decimales y deja los textos tal cual', () => {
    const monto = COLUMNAS_RESUMEN.find((c) => c.key === 'bruto')!;
    expect(formatearValor(monto, 1234.5)).toBe('1.234,50');
    expect(formatearValor(monto, '')).toBe('');
    expect(formatearValor(COLUMNAS_RESUMEN.find((c) => c.key === 'dias_trabajados')!, 11)).toBe('11');
    expect(formatearValor(null, 'Pagada')).toBe('Pagada');
  });

  it('el encabezado dice de qué es el resumen', () => {
    expect(textoAlcance({ modo: 'periodo', periodo: periodo({}) })).toBe('Primera quincena de octubre 2026 · 15/10/2026');
    expect(textoAlcance({ modo: 'general', filtro: { desde: '2026-10-01', hasta: '2026-10-31', estado: 'pagada' }, agrupado: true }))
      .toBe('Todas las nóminas · del 01/10/2026 al 31/10/2026 · solo pagadas · agrupado por trabajador');
    expect(textoAlcance({ modo: 'general', filtro: {} })).toBe('Todas las nóminas');
  });
});
