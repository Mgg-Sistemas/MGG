import { describe, expect, it } from 'vitest';
import {
  obtenerPresetRangoAdmin,
  obtenerTituloRangoAdmin,
  normalizarMovimientosAdmin,
  filtrarFilasAdmin,
  calcularResumenAdmin,
  agruparFilasAdmin,
  obtenerMetricasFichaAdmin,
  ordenarFilasAdmin,
  esColumnaAplicableModoAdmin,
} from './reporteAdministracionMoldeable';
import type { Movimiento, Empresa, OpcionRef } from './admin.repository';

describe('reporteAdministracionMoldeable', () => {
  const empresasMock: Empresa[] = [
    { id: '1', clave: 'GT', nombre: 'Golden Touch 1127 C.A.', rif: 'J-50129993-5', moneda: 'USD', logoPath: null, activa: true, orden: 1 },
    { id: '2', clave: 'MTO', nombre: 'Mina Tomi Operaciones', rif: 'J-12345678-9', moneda: 'USD', logoPath: null, activa: true, orden: 2 },
  ];

  const categoriasMock: OpcionRef[] = [
    { id: 'cat-serv', nombre: 'Servicios Básicos' },
    { id: 'cat-imp', nombre: 'Parafiscales e Impuestos' },
    { id: 'cat-nom', nombre: 'Nómina Administrativa' },
  ];

  const movsMock: Movimiento[] = [
    {
      id: 'm1',
      empresaClave: 'GT',
      gastoFijoId: 'gf1',
      concepto: 'Internet Starlink Mina',
      proveedorNombre: 'Starlink Corp',
      categoriaGastoId: 'cat-serv',
      periodo: '2026-10',
      fecha: '2026-10-05',
      monto: 100,
      moneda: 'USD',
      tasaRef: 50,
      estadoPago: 'pagado',
      origen: 'generado',
      servicioDirectoId: null,
    },
    {
      id: 'm2',
      empresaClave: 'GT',
      gastoFijoId: 'gf2',
      concepto: 'Pago IVSS y FAOV',
      proveedorNombre: 'SENIAT / IVSS',
      categoriaGastoId: 'cat-imp',
      periodo: '2026-10',
      fecha: '2026-10-15',
      monto: 2500,
      moneda: 'Bs',
      tasaRef: 50,
      estadoPago: 'pagado',
      origen: 'generado',
      servicioDirectoId: null,
    },
    {
      id: 'm3',
      empresaClave: 'MTO',
      gastoFijoId: null,
      concepto: 'Honorarios Legales Contables',
      proveedorNombre: 'Dr. Mendoza y Asoc.',
      categoriaGastoId: 'cat-nom',
      periodo: '2026-10',
      fecha: '2026-10-25',
      monto: 200,
      moneda: 'USD',
      tasaRef: 52,
      estadoPago: 'pendiente',
      origen: 'manual',
      servicioDirectoId: null,
    },
    {
      id: 'm4',
      empresaClave: 'GT',
      gastoFijoId: null,
      concepto: 'Compra de Resmas y Papelería',
      proveedorNombre: 'Librería Central',
      categoriaGastoId: 'cat-serv',
      periodo: '2026-11',
      fecha: '2026-11-02',
      monto: 50,
      moneda: 'USD',
      tasaRef: 52,
      estadoPago: 'pendiente',
      origen: 'importado',
      servicioDirectoId: null,
    },
    {
      id: 'm5',
      empresaClave: 'GT',
      gastoFijoId: null,
      concepto: 'Movimiento Anulado',
      proveedorNombre: 'Proveedor X',
      categoriaGastoId: null,
      periodo: '2026-10',
      fecha: '2026-10-30',
      monto: 1000,
      moneda: 'USD',
      tasaRef: 50,
      estadoPago: 'anulado',
      origen: 'manual',
      servicioDirectoId: null,
    },
  ];

  it('calcula presets de periodos correctamente', () => {
    const hoyRef = '2026-11-04';
    const mesActual = obtenerPresetRangoAdmin('mes_actual', hoyRef);
    expect(mesActual.desde).toBe('2026-11-01');
    expect(mesActual.hasta).toBe('2026-11-04');
    expect(mesActual.label).toContain('Noviembre 2026');

    const mesAnterior = obtenerPresetRangoAdmin('mes_anterior', hoyRef);
    expect(mesAnterior.desde).toBe('2026-10-01');
    expect(mesAnterior.hasta).toBe('2026-10-31');
    expect(mesAnterior.label).toContain('Octubre 2026');

    const ultimos7d = obtenerPresetRangoAdmin('7dias', hoyRef);
    expect(ultimos7d.hasta).toBe('2026-11-04');
  });

  it('genera títulos formales con rango de fecha explícito', () => {
    expect(obtenerTituloRangoAdmin('2026-10-01', '2026-10-31')).toBe(
      'Reporte del 01 al 31 de Octubre 2026',
    );
    expect(
      obtenerTituloRangoAdmin('2026-10-01', '2026-10-31', undefined, 'Golden Touch 1127 C.A.'),
    ).toBe('Reporte del 01 al 31 de Octubre 2026 · Golden Touch 1127 C.A.');

    expect(obtenerTituloRangoAdmin('2026-10-15', '2026-11-04')).toBe(
      'Reporte del 15 de Octubre al 04 de Noviembre 2026',
    );

    expect(obtenerTituloRangoAdmin('', '', 'todos')).toBe(
      'Reporte Administrativo Histórico Completo',
    );
  });

  it('normaliza movimientos con conversión bimoneda exacta', () => {
    const filas = normalizarMovimientosAdmin(movsMock, empresasMock, categoriasMock, 50);
    expect(filas.length).toBe(5);

    // m1: $100 USD @ tasa 50 -> $100 USD / Bs 5.000
    const f1 = filas.find((f) => f.id === 'm1')!;
    expect(f1.empresaNombre).toBe('Golden Touch 1127 C.A.');
    expect(f1.categoriaNombre).toBe('Servicios Básicos');
    expect(f1.montoUsd).toBe(100);
    expect(f1.montoBs).toBe(5000);

    // m2: Bs 2500 @ tasa 50 -> $50 USD / Bs 2.500
    const f2 = filas.find((f) => f.id === 'm2')!;
    expect(f2.montoBs).toBe(2500);
    expect(f2.montoUsd).toBe(50);

    // m3: $200 USD @ tasa 52 -> $200 USD / Bs 10.400
    const f3 = filas.find((f) => f.id === 'm3')!;
    expect(f3.montoUsd).toBe(200);
    expect(f3.montoBs).toBe(10400);
  });

  it('filtra movimientos por fechas y dimensiones', () => {
    const normalizadas = normalizarMovimientosAdmin(movsMock, empresasMock, categoriasMock, 50);

    // Filtrar solo Octubre 2026
    const oct = filtrarFilasAdmin(normalizadas, {}, '2026-10-01', '2026-10-31');
    // 3 movimientos no anulados en octubre (m1, m2, m3). m5 está anulado.
    expect(oct.length).toBe(3);

    // Filtrar por empresa GT
    const soloGt = filtrarFilasAdmin(normalizadas, { empresasSel: ['GT'] });
    // m1, m2, m4 no anulados de GT
    expect(soloGt.length).toBe(3);

    // Filtrar por estado pagado
    const pagados = filtrarFilasAdmin(normalizadas, { estadosSel: ['pagado'] });
    expect(pagados.length).toBe(2);
  });

  it('calcula resumen y KPIs con tasa ponderada', () => {
    const normalizadas = normalizarMovimientosAdmin(movsMock, empresasMock, categoriasMock, 50);
    const oct = filtrarFilasAdmin(normalizadas, {}, '2026-10-01', '2026-10-31');
    const resumen = calcularResumenAdmin(oct, 50);

    // m1: $100 (Bs 5000)
    // m2: $50 (Bs 2500)
    // m3: $200 (Bs 10400)
    // Total USD: 350. Total Bs: 17900.
    expect(resumen.totalUsd).toBe(350);
    expect(resumen.totalBs).toBe(17900);
    expect(resumen.totalOperaciones).toBe(3);
    // Tasa ponderada = 17900 / 350 = 51.14
    expect(resumen.tasaPromedioPonderada).toBe(51.14);

    // Pagado: m1 ($100) + m2 ($50) = $150
    expect(resumen.totalPagadoUsd).toBe(150);
    // Pendiente: m3 ($200) = $200
    expect(resumen.totalPendienteUsd).toBe(200);

    // Top proveedores
    expect(resumen.topProveedores[0].nombre).toBe('Dr. Mendoza y Asoc.');
    expect(resumen.topProveedores[0].montoUsd).toBe(200);
  });

  it('agrupa por diferentes dimensiones correctamente', () => {
    const normalizadas = normalizarMovimientosAdmin(movsMock, empresasMock, categoriasMock, 50);
    const oct = filtrarFilasAdmin(normalizadas, {}, '2026-10-01', '2026-10-31');

    // Agrupar por Empresa
    const porEmpresa = agruparFilasAdmin(oct, 'empresa', 50);
    expect(porEmpresa.length).toBe(2);
    const gGt = porEmpresa.find((g) => g.empresaClave === 'GT')!;
    expect(gGt.montoUsd).toBe(150); // m1 ($100) + m2 ($50)
    expect(gGt.totalOperaciones).toBe(2);

    // Agrupar por Categoría
    const porCat = agruparFilasAdmin(oct, 'categoria', 50);
    expect(porCat.length).toBe(3); // cat-serv, cat-imp, cat-nom

    // Agrupar por Moneda
    const porMon = agruparFilasAdmin(oct, 'moneda', 50);
    expect(porMon.length).toBe(2); // USD y Bs
  });

  it('extrae métricas para fichas ejecutivas', () => {
    const normalizadas = normalizarMovimientosAdmin(movsMock, empresasMock, categoriasMock, 50);
    const porEmpresa = agruparFilasAdmin(normalizadas, 'empresa', 50);
    const g = porEmpresa[0];

    const metricas = obtenerMetricasFichaAdmin(g, ['monto_usd', 'monto_bs', 'pct_total'], {
      mostrarUsd: true,
      mostrarBs: true,
    });

    expect(metricas.length).toBeGreaterThanOrEqual(3);
    expect(metricas.some((m) => m.clave === 'usd')).toBe(true);
    expect(metricas.some((m) => m.clave === 'bs')).toBe(true);
  });

  it('ordena filas según criterios', () => {
    const normalizadas = normalizarMovimientosAdmin(movsMock, empresasMock, categoriasMock, 50);
    const ordUsd = ordenarFilasAdmin(normalizadas, 'usd', true);
    // El mayor en USD debe estar de primero
    expect(ordUsd[0].montoUsd).toBeGreaterThanOrEqual(ordUsd[1].montoUsd);

    const ordFecha = ordenarFilasAdmin(normalizadas, 'fecha', false);
    expect(ordFecha[0].fecha <= ordFecha[ordFecha.length - 1].fecha).toBe(true);
  });

  it('esColumnaAplicableModoAdmin distingue campos de detalle vs consolidados', () => {
    // En detallado concepto aplica
    expect(esColumnaAplicableModoAdmin('concepto', 'detallado')).toBe(true);
    expect(esColumnaAplicableModoAdmin('fecha', 'detallado')).toBe(true);

    // En agrupaciones consolidadas concepto no aplica
    expect(esColumnaAplicableModoAdmin('concepto', 'categoria')).toBe(false);
    expect(esColumnaAplicableModoAdmin('concepto', 'empresa')).toBe(false);

    // Operaciones aplica en agrupaciones
    expect(esColumnaAplicableModoAdmin('operaciones', 'categoria')).toBe(true);
    expect(esColumnaAplicableModoAdmin('operaciones', 'empresa')).toBe(true);

    // Fecha solo en mes, dia o detallado
    expect(esColumnaAplicableModoAdmin('fecha', 'dia')).toBe(true);
    expect(esColumnaAplicableModoAdmin('fecha', 'mes')).toBe(true);
    expect(esColumnaAplicableModoAdmin('fecha', 'categoria')).toBe(false);
  });

  it('obtenerMetricasFichaAdmin representa fielmente todas las columnas marcadas sin truncar a 4', () => {
    const normalizadas = normalizarMovimientosAdmin(movsMock, empresasMock, categoriasMock, 50);
    const f = normalizadas[0];

    const todas = [
      'fecha', 'empresa', 'operaciones', 'concepto', 'categoria',
      'proveedor', 'periodo', 'estado', 'origen', 'moneda_orig',
      'monto_orig', 'monto_usd', 'monto_bs', 'tasa', 'pct_total',
    ];

    const metricas = obtenerMetricasFichaAdmin(f, todas, { mostrarUsd: true, mostrarBs: true });
    // Debe contener las métricas de las columnas solicitadas
    expect(metricas.length).toBeGreaterThan(4);
    expect(metricas.some((m) => m.clave === 'fecha')).toBe(true);
    expect(metricas.some((m) => m.clave === 'empresa')).toBe(true);
    expect(metricas.some((m) => m.clave === 'concepto')).toBe(true);
    expect(metricas.some((m) => m.clave === 'categoria')).toBe(true);
    expect(metricas.some((m) => m.clave === 'proveedor')).toBe(true);
    expect(metricas.some((m) => m.clave === 'estado')).toBe(true);
    expect(metricas.some((m) => m.clave === 'origen')).toBe(true);
    expect(metricas.some((m) => m.clave === 'moneda_orig')).toBe(true);
    expect(metricas.some((m) => m.clave === 'monto_orig')).toBe(true);
    expect(metricas.some((m) => m.clave === 'usd')).toBe(true);
    expect(metricas.some((m) => m.clave === 'bs')).toBe(true);
  });
});

