import { describe, it, expect } from 'vitest';
import {
  FILTRO_PRESTAMOS_VACIO, deudaPorTrabajador, errorPago, esHistorico, estadoDeCuenta,
  fechaDePrestamo, filtrarPagos, filtrarPrestamos, hayFiltro, labelOrigen, pagosPorPrestamo,
  rangosRapidos, resumenPrestamos, totalPagado, type PagoBase, type PrestamoBase,
} from './prestamos';

// Por defecto se cargó el mismo día en que se dio, que es el caso normal. Un
// préstamo histórico se arma pasando `created_at` posterior a `fecha`.
const prestamo = (o: Partial<PrestamoBase> & { id: string }): PrestamoBase => {
  const fecha = o.fecha ?? '2026-03-10';
  return {
    personal_id: 'p1', tipo: 'prestamo', monto_total: 100, saldo: 100, estado: 'activo',
    created_at: `${fecha}T10:00:00Z`, ...o, fecha,
  };
};
const pago = (o: Partial<PagoBase> & { id: string; anticipo_id: string }): PagoBase => ({
  fecha: '2026-04-01', monto: 50, origen: 'manual', ...o,
});

const NOMBRES: Record<string, string> = { p1: 'Ana Pérez', p2: 'Luis Díaz', p3: 'Rosa Gil' };
const nombreDe = (id: string) => NOMBRES[id] ?? '—';

describe('la fecha que vale es la que se dio, no la que se cargó', () => {
  it('usa `fecha` cuando está', () => {
    // Un préstamo de marzo cargado en septiembre es de MARZO: si valiera la
    // fecha de carga, todo el histórico caería en el mismo día.
    expect(fechaDePrestamo(prestamo({ id: 'a', fecha: '2026-03-10', created_at: '2026-09-25T00:00:00Z' })))
      .toBe('2026-03-10');
  });

  it('si no hay `fecha`, cae a la de carga', () => {
    expect(fechaDePrestamo({ ...prestamo({ id: 'a' }), fecha: null })).toBe('2026-03-10');
  });

  it('un préstamo dado antes del día en que se cargó es histórico', () => {
    expect(esHistorico(prestamo({ id: 'a', fecha: '2026-03-10', created_at: '2026-09-25T00:00:00Z' }))).toBe(true);
    expect(esHistorico(prestamo({ id: 'a', fecha: '2026-09-25', created_at: '2026-09-25T00:00:00Z' }))).toBe(false);
  });
});

describe('los abonos de cada préstamo', () => {
  const pagos = [
    pago({ id: 'g3', anticipo_id: 'a1', fecha: '2026-06-01', monto: 20 }),
    pago({ id: 'g1', anticipo_id: 'a1', fecha: '2026-04-01', monto: 30 }),
    pago({ id: 'g2', anticipo_id: 'a2', fecha: '2026-05-01', monto: 10 }),
  ];

  it('se agrupan por préstamo', () => {
    const m = pagosPorPrestamo(pagos);
    expect(m.get('a1')).toHaveLength(2);
    expect(m.get('a2')).toHaveLength(1);
    expect(m.get('a9')).toBeUndefined();
  });

  it('salen del más viejo al más nuevo: un estado de cuenta se lee hacia adelante', () => {
    expect(pagosPorPrestamo(pagos).get('a1')!.map((p) => p.fecha)).toEqual(['2026-04-01', '2026-06-01']);
  });

  it('suma sin arrastrar centavos', () => {
    expect(totalPagado([pago({ id: '1', anticipo_id: 'a', monto: 0.1 }), pago({ id: '2', anticipo_id: 'a', monto: 0.2 })])).toBe(0.3);
    expect(totalPagado([])).toBe(0);
  });

  it('cada origen tiene su nombre', () => {
    expect(labelOrigen('nomina')).toBe('Nómina');
    expect(labelOrigen('historico')).toBe('Carga histórica');
    expect(labelOrigen('loquesea')).toBe('loquesea');
  });
});

describe('qué abono se acepta', () => {
  it('uno normal pasa', () => {
    expect(errorPago(50, 100)).toBeNull();
  });

  it('pagar justo lo que falta pasa', () => {
    expect(errorPago(100, 100)).toBeNull();
  });

  it('cero o negativo no', () => {
    expect(errorPago(0, 100)).toContain('mayor que 0');
    expect(errorPago(-5, 100)).toContain('mayor que 0');
    expect(errorPago('ahí va', 100)).toContain('mayor que 0');
  });

  it('pagar de más no: la diferencia quedaría sin rastro', () => {
    expect(errorPago(150, 100)).toContain('mayor que lo que se debe');
  });

  it('un centavo de redondeo no lo traba', () => {
    expect(errorPago(100.004, 100)).toBeNull();
  });

  it('una fecha futura no', () => {
    expect(errorPago(10, 100, '2099-01-01')).toContain('futura');
  });
});

describe('el estado de cuenta de una persona', () => {
  const prestamos = [
    prestamo({ id: 'a1', personal_id: 'p1', monto_total: 300, saldo: 150, fecha: '2026-03-10' }),
    prestamo({ id: 'a2', personal_id: 'p1', monto_total: 100, saldo: 0, estado: 'saldado', fecha: '2026-01-05' }),
    prestamo({ id: 'a3', personal_id: 'p2', monto_total: 500, saldo: 500 }),
  ];
  const pagos = [
    pago({ id: 'g1', anticipo_id: 'a1', monto: 100, origen: 'nomina' }),
    pago({ id: 'g2', anticipo_id: 'a1', monto: 50, origen: 'manual' }),
    pago({ id: 'g3', anticipo_id: 'a2', monto: 100, origen: 'historico' }),
  ];

  it('trae solo los de esa persona', () => {
    const ec = estadoDeCuenta('p1', prestamos, pagos);
    expect(ec.renglones.map((r) => r.prestamo.id)).toEqual(['a1', 'a2']);
  });

  it('da las tres cifras que firma el trabajador', () => {
    const ec = estadoDeCuenta('p1', prestamos, pagos);
    expect(ec.total).toBe(400);
    expect(ec.pagado).toBe(250);
    expect(ec.debe).toBe(150);
  });

  it('cuenta cuántos siguen abiertos', () => {
    expect(estadoDeCuenta('p1', prestamos, pagos).abiertos).toBe(1);
  });

  it('el más nuevo va primero', () => {
    expect(estadoDeCuenta('p1', prestamos, pagos).renglones[0].prestamo.id).toBe('a1');
  });

  it('cada renglón trae sus abonos', () => {
    const r = estadoDeCuenta('p1', prestamos, pagos).renglones[0];
    expect(r.pagos).toHaveLength(2);
    expect(r.pagado).toBe(150);
    expect(r.debe).toBe(150);
  });

  it('alguien sin préstamos da todo en cero, no se rompe', () => {
    const ec = estadoDeCuenta('p9', prestamos, pagos);
    expect(ec).toMatchObject({ total: 0, pagado: 0, debe: 0, abiertos: 0 });
    expect(ec.renglones).toEqual([]);
  });
});

describe('las tarjetas del tablero', () => {
  const prestamos = [
    prestamo({ id: 'a1', personal_id: 'p1', monto_total: 300, saldo: 150 }),
    prestamo({ id: 'a2', personal_id: 'p1', monto_total: 100, saldo: 40 }),
    prestamo({ id: 'a3', personal_id: 'p2', monto_total: 500, saldo: 500 }),
    prestamo({ id: 'a4', personal_id: 'p3', monto_total: 80, saldo: 0, estado: 'saldado' }),
  ];

  it('TOTAL PRÉSTAMOS PENDIENTES suma solo lo que falta cobrar', () => {
    expect(resumenPrestamos(prestamos).totalPendiente).toBe(690);
  });

  it('TRABAJADORES CON PRÉSTAMOS PENDIENTES cuenta personas, no préstamos', () => {
    // Ana tiene dos préstamos abiertos pero es UNA persona; Rosa ya saldó.
    expect(resumenPrestamos(prestamos).trabajadoresConSaldo).toBe(2);
    expect(resumenPrestamos(prestamos).prestamosAbiertos).toBe(3);
  });

  it('un saldado no cuenta en ninguna de las dos', () => {
    expect(resumenPrestamos([prestamo({ id: 'x', saldo: 0, estado: 'saldado' })]))
      .toMatchObject({ totalPendiente: 0, trabajadoresConSaldo: 0, prestamosAbiertos: 0 });
  });

  it('sin nada, todo en cero', () => {
    expect(resumenPrestamos([])).toMatchObject({ totalPendiente: 0, trabajadoresConSaldo: 0, totalPrestado: 0 });
  });

  it('lo pagado cuenta solo los abonos de los préstamos que se están mirando', () => {
    // Si no, al filtrar por un mes la tarjeta seguiría mostrando todo.
    const pagos = [pago({ id: 'g1', anticipo_id: 'a1', monto: 150 }), pago({ id: 'g9', anticipo_id: 'otro', monto: 999 })];
    expect(resumenPrestamos(prestamos, pagos).totalPagado).toBe(150);
  });
});

describe('cuánto debe cada uno', () => {
  const prestamos = [
    prestamo({ id: 'a1', personal_id: 'p1', monto_total: 300, saldo: 150, fecha: '2026-03-10' }),
    prestamo({ id: 'a2', personal_id: 'p1', monto_total: 100, saldo: 40, fecha: '2026-01-05' }),
    prestamo({ id: 'a3', personal_id: 'p2', monto_total: 500, saldo: 500, fecha: '2026-02-01' }),
  ];
  const pagos = [pago({ id: 'g1', anticipo_id: 'a1', monto: 150 }), pago({ id: 'g2', anticipo_id: 'a2', monto: 60 })];

  it('el que más debe va primero: la lista se abre para saber a quién cobrarle', () => {
    expect(deudaPorTrabajador(prestamos, pagos, nombreDe).map((d) => d.nombre)).toEqual(['Luis Díaz', 'Ana Pérez']);
  });

  it('junta todos los préstamos de la persona', () => {
    const ana = deudaPorTrabajador(prestamos, pagos, nombreDe).find((d) => d.personalId === 'p1')!;
    expect(ana.total).toBe(400);
    expect(ana.pagado).toBe(210);
    expect(ana.debe).toBe(190);
    expect(ana.abiertos).toBe(2);
  });

  it('«desde» es el préstamo abierto más viejo', () => {
    const ana = deudaPorTrabajador(prestamos, pagos, nombreDe).find((d) => d.personalId === 'p1')!;
    expect(ana.desde).toBe('2026-01-05');
  });

  it('sin préstamos no devuelve a nadie', () => {
    expect(deudaPorTrabajador([], [], nombreDe)).toEqual([]);
  });
});

describe('los filtros', () => {
  const lista = [
    prestamo({ id: 'a1', personal_id: 'p1', tipo: 'prestamo', monto_total: 300, saldo: 150, fecha: '2026-03-10', motivo: 'Techo de la casa' }),
    prestamo({ id: 'a2', personal_id: 'p1', tipo: 'anticipo', monto_total: 100, saldo: 0, estado: 'saldado', fecha: '2026-01-05', motivo: 'Adelanto' }),
    prestamo({ id: 'a3', personal_id: 'p2', tipo: 'prestamo', monto_total: 500, saldo: 500, fecha: '2026-06-20', motivo: 'Moto' }),
  ];

  it('sin filtro trae todo', () => {
    expect(filtrarPrestamos(lista, FILTRO_PRESTAMOS_VACIO, nombreDe)).toHaveLength(3);
    expect(hayFiltro(FILTRO_PRESTAMOS_VACIO)).toBe(false);
  });

  it('por rango de fechas, con los dos extremos adentro', () => {
    expect(filtrarPrestamos(lista, { desde: '2026-03-10', hasta: '2026-06-20' }).map((p) => p.id)).toEqual(['a1', 'a3']);
    expect(filtrarPrestamos(lista, { desde: '2026-03-11' }).map((p) => p.id)).toEqual(['a3']);
    expect(filtrarPrestamos(lista, { hasta: '2026-01-05' }).map((p) => p.id)).toEqual(['a2']);
  });

  it('por trabajador, tipo y estado', () => {
    expect(filtrarPrestamos(lista, { trabajadorId: 'p1' })).toHaveLength(2);
    expect(filtrarPrestamos(lista, { tipo: 'anticipo' }).map((p) => p.id)).toEqual(['a2']);
    expect(filtrarPrestamos(lista, { estado: 'activos' }).map((p) => p.id)).toEqual(['a1', 'a3']);
    expect(filtrarPrestamos(lista, { estado: 'saldados' }).map((p) => p.id)).toEqual(['a2']);
  });

  it('por texto busca en el nombre y en el motivo', () => {
    expect(filtrarPrestamos(lista, { texto: 'moto' }, nombreDe).map((p) => p.id)).toEqual(['a3']);
    expect(filtrarPrestamos(lista, { texto: 'ana' }, nombreDe).map((p) => p.id)).toEqual(['a1', 'a2']);
    expect(filtrarPrestamos(lista, { texto: 'TECHO' }, nombreDe).map((p) => p.id)).toEqual(['a1']);
  });

  it('por rango de monto y por saldo mínimo', () => {
    expect(filtrarPrestamos(lista, { montoMin: 200 }).map((p) => p.id)).toEqual(['a1', 'a3']);
    expect(filtrarPrestamos(lista, { montoMax: 300 }).map((p) => p.id)).toEqual(['a1', 'a2']);
    expect(filtrarPrestamos(lista, { saldoMin: 200 }).map((p) => p.id)).toEqual(['a3']);
  });

  it('los filtros se acumulan', () => {
    expect(filtrarPrestamos(lista, { trabajadorId: 'p1', estado: 'activos' }).map((p) => p.id)).toEqual(['a1']);
  });

  it('solo históricos trae los cargados después', () => {
    const conHistorico = [...lista, prestamo({ id: 'a4', fecha: '2025-01-01', created_at: '2026-09-25T00:00:00Z' })];
    expect(filtrarPrestamos(conHistorico, { soloHistoricos: true }).map((p) => p.id)).toEqual(['a4']);
  });

  it('sabe cuándo hay algo puesto, para poder ofrecer limpiar', () => {
    expect(hayFiltro({ ...FILTRO_PRESTAMOS_VACIO, texto: 'x' })).toBe(true);
    expect(hayFiltro({ ...FILTRO_PRESTAMOS_VACIO, desde: '2026-01-01' })).toBe(true);
    expect(hayFiltro({ ...FILTRO_PRESTAMOS_VACIO, estado: 'activos' })).toBe(true);
    expect(hayFiltro({ ...FILTRO_PRESTAMOS_VACIO, montoMin: 0 })).toBe(true);
  });

  it('los abonos se recortan al mismo rango', () => {
    const pagos = [
      pago({ id: 'g1', anticipo_id: 'a1', fecha: '2026-02-01' }),
      pago({ id: 'g2', anticipo_id: 'a1', fecha: '2026-05-01' }),
    ];
    expect(filtrarPagos(pagos, { desde: '2026-03-01' }).map((p) => p.id)).toEqual(['g2']);
    expect(filtrarPagos(pagos, {}).map((p) => p.id)).toEqual(['g1', 'g2']);
  });
});

describe('los rangos rápidos', () => {
  const r = rangosRapidos('2026-09-25');
  const buscar = (k: string) => r.find((x) => x.key === k)!;

  it('este mes va del 1 al último día', () => {
    expect(buscar('mes')).toMatchObject({ desde: '2026-09-01', hasta: '2026-09-30' });
  });

  it('el mes pasado también cierra bien', () => {
    expect(buscar('mes_ant')).toMatchObject({ desde: '2026-08-01', hasta: '2026-08-31' });
  });

  it('el año va de enero a diciembre', () => {
    expect(buscar('anio')).toMatchObject({ desde: '2026-01-01', hasta: '2026-12-31' });
  });

  it('en enero, «mes pasado» cruza al año anterior', () => {
    expect(rangosRapidos('2026-01-15').find((x) => x.key === 'mes_ant'))
      .toMatchObject({ desde: '2025-12-01', hasta: '2025-12-31' });
  });

  it('febrero bisiesto no se corta en el 28', () => {
    expect(rangosRapidos('2028-02-10').find((x) => x.key === 'mes'))
      .toMatchObject({ desde: '2028-02-01', hasta: '2028-02-29' });
  });
});
