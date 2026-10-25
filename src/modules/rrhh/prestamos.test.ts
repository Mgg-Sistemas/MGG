import { describe, it, expect } from 'vitest';
import {
  FILTRO_PRESTAMOS_VACIO, deudaPorTrabajador, errorPago, esHistorico, estadoDeCuenta,
  fechaDePrestamo, filtrarPagos, filtrarPrestamos, hayFiltro, labelOrigen, pagosPorPrestamo,
  rangosRapidos, resumenPrestamos, totalPagado,
  formatearEntrega, obtenerEntregas, fechasDeEntregas, unificarPrestamosActivos,
  agregarEntregaAMotivo, normalizarFechaIso, parsearMontoTexto,
  type PagoBase, type PrestamoBase,
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

  it('al editar un abono, el monto disponible incluye lo que ese abono ya cubría', () => {
    const saldoActual = 30;
    const abonoEditado = 40;
    const disponible = saldoActual + abonoEditado;
    expect(errorPago(70, disponible)).toBeNull();
    expect(errorPago(75, disponible)).toContain('mayor que lo que se debe');
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

  it('el origen separa los históricos de los cargados en el sistema', () => {
    const conHistorico = [...lista, prestamo({ id: 'a4', fecha: '2025-01-01', created_at: '2026-09-25T00:00:00Z' })];
    expect(filtrarPrestamos(conHistorico, { origen: 'historico' }).map((p) => p.id)).toEqual(['a4']);
    expect(filtrarPrestamos(conHistorico, { origen: 'sistema' }).map((p) => p.id)).toEqual(['a1', 'a2', 'a3']);
    expect(filtrarPrestamos(conHistorico, { origen: 'todos' })).toHaveLength(4);
    expect(hayFiltro({ ...FILTRO_PRESTAMOS_VACIO, origen: 'historico' })).toBe(true);
    expect(hayFiltro({ ...FILTRO_PRESTAMOS_VACIO, origen: 'todos' })).toBe(false);
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

describe('entregas acumuladas de un préstamo a la misma persona', () => {
  it('formatea la entrega adicional con fecha, monto y motivo opcional', () => {
    expect(formatearEntrega('2026-10-22', 50, 'Adelanto')).toBe('[Entrega 2026-10-22 · $ 50.00]: Adelanto');
    expect(formatearEntrega('2026-10-22', 100)).toBe('[Entrega 2026-10-22 · $ 100.00]');
  });

  it('un préstamo simple devuelve una sola entrega con la fecha del préstamo', () => {
    const p = prestamo({ id: 'p1', fecha: '2026-03-10', monto_total: 100, motivo: 'Préstamo inicial' });
    const entregas = obtenerEntregas(p);
    expect(entregas).toHaveLength(1);
    expect(entregas[0]).toEqual({
      fecha: '2026-03-10',
      monto: 100,
      motivo: 'Préstamo inicial',
    });
    expect(fechasDeEntregas(p)).toEqual(['2026-03-10']);
  });

  it('extrae las entregas adicionales acumuladas y calcula el monto inicial correcto', () => {
    const motivoConEntregas = `Préstamo médico\n${formatearEntrega('2026-04-15', 50, 'Medicinas')}\n${formatearEntrega('2026-05-02', 30, 'Exámenes')}`;
    const p = prestamo({
      id: 'p2',
      fecha: '2026-03-10',
      monto_total: 180, // 100 inicial + 50 + 30
      saldo: 180,
      motivo: motivoConEntregas,
    });

    const entregas = obtenerEntregas(p);
    expect(entregas).toHaveLength(3);

    expect(entregas[0]).toEqual({
      fecha: '2026-03-10',
      monto: 100,
      motivo: 'Préstamo médico',
    });
    expect(entregas[1]).toEqual({
      fecha: '2026-04-15',
      monto: 50,
      motivo: 'Medicinas',
    });
    expect(entregas[2]).toEqual({
      fecha: '2026-05-02',
      monto: 30,
      motivo: 'Exámenes',
    });

    expect(fechasDeEntregas(p)).toEqual(['2026-03-10', '2026-04-15', '2026-05-02']);
  });

  it('ordena las entregas por fecha si no estaban en orden cronológico', () => {
    const motivoDesordenado = `Base\n${formatearEntrega('2026-08-01', 40)}\n${formatearEntrega('2026-06-01', 60)}`;
    const p = prestamo({
      id: 'p3',
      fecha: '2026-05-01',
      monto_total: 200,
      motivo: motivoDesordenado,
    });

    const fechas = fechasDeEntregas(p);
    expect(fechas).toEqual(['2026-05-01', '2026-06-01', '2026-08-01']);
  });

  it('extrae entregas formateadas con el estilo de la captura [Entrega DD-MM-AAAA · $ X,XX]: Motivo', () => {
    const motivoCaptura = `[Entrega 09-06-2026 · $ 1.200,00]: PRESTAMO EN USDT AUTORIZADO POR CHELI\n[Entrega 23-08-2026 · $ 550,00]: "PAGO PRÉSTAMO KEIMER GT AUTORIZADO POR SRA WENDY MONTO= 550$ 23-08-26"`;
    const p = prestamo({
      id: 'captura-1',
      fecha: '2026-06-09',
      monto_total: 1750,
      saldo: 1350,
      motivo: motivoCaptura,
    });

    const entregas = obtenerEntregas(p);
    expect(entregas).toHaveLength(2);
    expect(entregas[0].fecha).toBe('2026-06-09');
    expect(entregas[0].monto).toBe(1200);
    expect(entregas[0].motivo).toContain('CHELI');

    expect(entregas[1].fecha).toBe('2026-08-23');
    expect(entregas[1].monto).toBe(550);
    expect(entregas[1].motivo).toContain('WENDY');
  });

  it('unificarPrestamosActivos consolida automáticamente si un trabajador tiene más de dos préstamos activos', () => {
    const p1 = prestamo({
      id: 'prest-1',
      personal_id: 'trabajador-a',
      monto_total: 1200,
      saldo: 900,
      fecha: '2026-06-09',
      motivo: 'PRESTAMO EN USDT AUTORIZADO POR CHELI',
    });
    const p2 = prestamo({
      id: 'prest-2',
      personal_id: 'trabajador-a',
      monto_total: 550,
      saldo: 450,
      fecha: '2026-08-23',
      motivo: 'PAGO PRÉSTAMO KEIMER GT AUTORIZADO POR SRA WENDY',
    });
    const pOtro = prestamo({
      id: 'prest-3',
      personal_id: 'trabajador-b',
      monto_total: 300,
      saldo: 300,
      fecha: '2026-07-01',
    });

    const unificados = unificarPrestamosActivos([p1, p2, pOtro]);
    // Debería quedar 1 solo préstamo para trabajador-a y 1 para trabajador-b
    expect(unificados).toHaveLength(2);

    const deTrabajadorA = unificados.find((u) => u.personal_id === 'trabajador-a')!;
    expect(deTrabajadorA).toBeDefined();
    expect(deTrabajadorA.monto_total).toBe(1750); // 1200 + 550
    expect(deTrabajadorA.saldo).toBe(1350); // 900 + 450

    const entregas = obtenerEntregas(deTrabajadorA);
    expect(entregas).toHaveLength(2);
    expect(entregas[0].monto).toBe(1200);
    expect(entregas[0].fecha).toBe('2026-06-09');
    expect(entregas[1].monto).toBe(550);
    expect(entregas[1].fecha).toBe('2026-08-23');
  });

  it('normaliza fechas y parsea montos en formatos variados', () => {
    expect(normalizarFechaIso('23-08-2026')).toBe('2026-08-23');
    expect(normalizarFechaIso('2026-08-23')).toBe('2026-08-23');
    expect(parsearMontoTexto('$ 1.200,00')).toBe(1200);
    expect(parsearMontoTexto('550')).toBe(550);

    const motivo = agregarEntregaAMotivo('Inicial', '2026-01-01', 100, { fecha: '2026-02-01', monto: 50, motivo: 'Segunda entrega' });
    expect(motivo).toContain('[Entrega 2026-01-01 · $ 100.00]: Inicial');
    expect(motivo).toContain('[Entrega 2026-02-01 · $ 50.00]: Segunda entrega');
  });
});



