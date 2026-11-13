import { describe, expect, it } from 'vitest';
import type { Orden } from '@/shared/lib/types';
import {
  armarFilaEntrada,
  calcularMontosRetencion,
  cruzarDriveEntrada,
  driveEntradaDe,
  EVENTO_DRIVE_ENTRADA,
  EVENTO_REINTEGRO_RETENCION,
  filtrarEntradas,
  ordenLlevaRetencion,
  reintegroDeOrden,
  tarjetasEntradas,
  type DatosDriveEntrada,
  type DatosReintegroRetencion,
} from './conciliacionEntradas';

const mockOc = (p: Record<string, unknown> = {}): Orden =>
  ({
    id: 'oc-1',
    codigo: 'SP-2026-0001',
    oc_codigo: 'OC-2026-0001',
    estado: 'pagada',
    total: 1000,
    moneda: 'USD',
    items: [],
    historial: [],
    oc_creada_en: '2026-11-05T10:00:00Z',
    pagada_en: '2026-11-06T15:00:00Z',
    ...p,
  } as unknown as Orden);

describe('conciliacionEntradas · lectura de historial', () => {
  it('reintegroDeOrden extrae los datos del evento reintegro_retencion', () => {
    const reintegro: DatosReintegroRetencion = {
      fechaReintegro: '2026-11-08',
      referencia: '782910',
      banco: 'BDV Jurídico MGG',
      montoBs: 15420.5,
      montoUsd: 75.22,
      comprobantePath: 'oc-1/reintegro.pdf',
      comprobanteNombre: 'reintegro.pdf',
      nota: 'Reintegro ISLR + IVA',
    };

    const oc = mockOc({
      historial: [
        { evento: 'creada' },
        { evento: EVENTO_REINTEGRO_RETENCION, ...reintegro },
      ],
    });

    const leido = reintegroDeOrden(oc);
    expect(leido).not.toBeNull();
    expect(leido?.fechaReintegro).toBe('2026-11-08');
    expect(leido?.referencia).toBe('782910');
    expect(leido?.banco).toBe('BDV Jurídico MGG');
    expect(leido?.montoBs).toBe(15420.5);
    expect(leido?.comprobantePath).toBe('oc-1/reintegro.pdf');
    expect(leido?.nota).toBe('Reintegro ISLR + IVA');
  });

  it('reintegroDeOrden toma el último evento si hay correcciones', () => {
    const oc = mockOc({
      historial: [
        { evento: EVENTO_REINTEGRO_RETENCION, fechaReintegro: '2026-11-05', referencia: '111', montoBs: 500 },
        { evento: EVENTO_REINTEGRO_RETENCION, fechaReintegro: '2026-11-07', referencia: '222', montoBs: 550 },
      ],
    });
    const leido = reintegroDeOrden(oc);
    expect(leido?.referencia).toBe('222');
    expect(leido?.montoBs).toBe(550);
  });

  it('reintegroDeOrden devuelve null si la orden no tiene evento de reintegro', () => {
    const oc = mockOc({ historial: [{ evento: 'pagada' }] });
    expect(reintegroDeOrden(oc)).toBeNull();
  });

  it('driveEntradaDe extrae el cotejo de entrada cargado desde el archivo', () => {
    const driveData: DatosDriveEntrada = {
      referencias: ['00322', '322'],
      montoBs: 12500,
      archivo: 'CAJA NOVIEMBRE 2026.xlsx',
      filas: [45],
      fecha: '2026-11-04',
      tipoRetencion: 'ISAE-ISLR-IVA',
    };
    const oc = mockOc({
      historial: [
        { evento: EVENTO_DRIVE_ENTRADA, ...driveData },
      ],
    });
    const leido = driveEntradaDe(oc);
    expect(leido).not.toBeNull();
    expect(leido?.montoBs).toBe(12500);
    expect(leido?.referencias).toContain('00322');
    expect(leido?.tipoRetencion).toBe('ISAE-ISLR-IVA');
  });
});

describe('conciliacionEntradas · cruce con Drive / Caja Multimoneda', () => {
  it('cruza y CUADRA si coinciden referencia y monto en Bs con tolerancia de centavos', () => {
    const reintegro: DatosReintegroRetencion = {
      fechaReintegro: '2026-11-05',
      referencia: '0000322',
      montoBs: 12500.02,
    };
    const drive: DatosDriveEntrada = {
      referencias: ['00322'],
      montoBs: 12500.0,
      archivo: 'Caja.xlsx',
      filas: [10],
    };
    const r = cruzarDriveEntrada(reintegro, drive);
    expect(r?.estado).toBe('CUADRA');
    expect(r?.motivo).toMatch(/coinciden/i);
  });

  it('detecta NO CUADRA por discrepancia de referencia', () => {
    const reintegro: DatosReintegroRetencion = {
      fechaReintegro: '2026-11-05',
      referencia: '999999',
      montoBs: 12500,
    };
    const drive: DatosDriveEntrada = {
      referencias: ['00322'],
      montoBs: 12500,
      archivo: 'Caja.xlsx',
      filas: [10],
    };
    const r = cruzarDriveEntrada(reintegro, drive);
    expect(r?.estado).toBe('NO CUADRA');
    expect(r?.motivo).toMatch(/referencia distinta/i);
  });

  it('detecta NO CUADRA por diferencia de monto mayor a 5 centavos', () => {
    const reintegro: DatosReintegroRetencion = {
      fechaReintegro: '2026-11-05',
      referencia: '00322',
      montoBs: 12500,
    };
    const drive: DatosDriveEntrada = {
      referencias: ['00322'],
      montoBs: 14000,
      archivo: 'Caja.xlsx',
      filas: [10],
    };
    const r = cruzarDriveEntrada(reintegro, drive);
    expect(r?.estado).toBe('NO CUADRA');
    expect(r?.motivo).toMatch(/monto distinto/i);
  });

  it('si no se ha registrado reintegro pero el archivo trajo entrada, informa pendiente', () => {
    const drive: DatosDriveEntrada = {
      referencias: ['00322'],
      montoBs: 12500,
      archivo: 'Caja.xlsx',
      filas: [10],
    };
    const r = cruzarDriveEntrada(null, drive);
    expect(r?.estado).toBe('NO CUADRA');
    expect(r?.motivo).toMatch(/pendiente/i);
  });
});

describe('conciliacionEntradas · montos de retención y armado de filas', () => {
  it('ordenLlevaRetencion detecta retenciones en compras, fiscales o reintegros', () => {
    expect(ordenLlevaRetencion(mockOc({ retenciones: [{ tipo: 'IVA', modo: 'pct', valor: 75, monto: 96 }] }))).toBe(true);
    expect(ordenLlevaRetencion(mockOc({ retencion_momento: 'antes' }))).toBe(true);
    expect(ordenLlevaRetencion(mockOc({ retencion_iva_path: 'path.pdf' }))).toBe(true);
    expect(ordenLlevaRetencion(mockOc({}), [{ tipo: 'islr', numero: '001' }])).toBe(true);
    expect(ordenLlevaRetencion(mockOc({}))).toBe(false);
  });

  it('calcula montos de retención desde la estructura de la orden', () => {
    const oc = mockOc({
      total: 1000,
      subtotal: 800,
      moneda: 'USD',
      retenciones: [
        { tipo: 'IVA', modo: 'pct', valor: 75, monto: 96 },
        { tipo: 'ISLR', modo: 'monto', valor: 20, monto: 20 },
      ],
    });

    const m = calcularMontosRetencion(oc, 50); // tasa 50 Bs/USD
    expect(m.totalUsd).toBe(116);
    expect(m.totalBs).toBe(116 * 50);
  });

  it('armarFilaEntrada construye la fila completa con badges y datos del reintegro', () => {
    const oc = mockOc({
      codigo: 'SP-2026-0201',
      oc_codigo: 'OC-2026-0201',
      factura_numero: 'FACT-9988',
      total: 500,
      retenciones: [{ tipo: 'ISAE', modo: 'pct', valor: 2, monto: 10 }],
      historial: [
        {
          evento: EVENTO_REINTEGRO_RETENCION,
          fechaReintegro: '2026-11-04',
          referencia: '556677',
          banco: 'BDV Jurídico MGG',
          montoBs: 500,
        },
      ],
    });

    const fila = armarFilaEntrada(oc, 'Inversiones Acme', 50, 1);
    expect(fila.id).toBe('oc-1');
    expect(fila.codigo).toBe('OC-2026-0201');
    expect(fila.proveedor).toBe('Inversiones Acme');
    expect(fila.facturaNumero).toBe('FACT-9988');
    expect(fila.tiposRetencion).toContain('ISAE');
    expect(fila.tieneReintegro).toBe(true);
    expect(fila.reintegro?.referencia).toBe('556677');
  });
});

describe('conciliacionEntradas · filtros y métricas de tarjetas', () => {
  const filasMock = [
    {
      id: '1',
      item: 1,
      codigo: 'OC-2026-0183',
      sp: 'SP-2026-0183',
      proveedor: 'Ferretería El Tornillo',
      facturaNumero: '00124',
      tiposRetencion: ['IVA', 'ISLR'],
      montoRetenidoUsd: 50,
      montoRetenidoBs: 2500,
      tieneReintegro: true,
      reintegro: { fechaReintegro: '2026-11-02', referencia: '112233', montoBs: 2500 },
      drive: { estado: 'CUADRA' as const, motivo: 'Ok', datos: { referencias: ['112233'], montoBs: 2500, archivo: 'a', filas: [1] } },
    },
    {
      id: '2',
      item: 2,
      codigo: 'OC-2026-0236',
      sp: 'SP-2026-0236',
      proveedor: 'Distribuidora Guayana',
      facturaNumero: '00322',
      tiposRetencion: ['ISAE'],
      montoRetenidoUsd: 80,
      montoRetenidoBs: 4000,
      tieneReintegro: false,
      reintegro: null,
      drive: null,
    },
    {
      id: '3',
      item: 3,
      codigo: 'OC-2026-0251',
      sp: 'SP-2026-0251',
      proveedor: 'Repuestos Bolívar',
      facturaNumero: '00981',
      tiposRetencion: ['IVA'],
      montoRetenidoUsd: 120,
      montoRetenidoBs: 6000,
      tieneReintegro: true,
      reintegro: { fechaReintegro: '2026-11-06', referencia: '887766', montoBs: 5800 },
      drive: { estado: 'NO CUADRA' as const, motivo: 'Difiere', datos: { referencias: ['887766'], montoBs: 6000, archivo: 'a', filas: [2] } },
    },
  ];

  it('filtrarEntradas por búsqueda de texto', () => {
    const r = filtrarEntradas(filasMock as any, { busqueda: 'tornillo' });
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('OC-2026-0183');

    const r2 = filtrarEntradas(filasMock as any, { busqueda: '00322' });
    expect(r2).toHaveLength(1);
    expect(r2[0].codigo).toBe('OC-2026-0236');
  });

  it('filtrarEntradas por estado de reintegro', () => {
    const reintegradas = filtrarEntradas(filasMock as any, { estado: 'reintegradas' });
    expect(reintegradas).toHaveLength(2);

    const pendientes = filtrarEntradas(filasMock as any, { estado: 'pendientes' });
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].codigo).toBe('OC-2026-0236');
  });

  it('filtrarEntradas por tipo de retención', () => {
    const isae = filtrarEntradas(filasMock as any, { tipoRetencion: 'ISAE' });
    expect(isae).toHaveLength(1);
    expect(isae[0].codigo).toBe('OC-2026-0236');

    const iva = filtrarEntradas(filasMock as any, { tipoRetencion: 'IVA' });
    expect(iva).toHaveLength(2);
  });

  it('filtrarEntradas por estado de DRIVE', () => {
    const cuadran = filtrarEntradas(filasMock as any, { drive: 'cuadra' });
    expect(cuadran).toHaveLength(1);
    expect(cuadran[0].codigo).toBe('OC-2026-0183');

    const noCuadran = filtrarEntradas(filasMock as any, { drive: 'no_cuadra' });
    expect(noCuadran).toHaveLength(1);
    expect(noCuadran[0].codigo).toBe('OC-2026-0251');

    const sinCotejar = filtrarEntradas(filasMock as any, { drive: 'sin' });
    expect(sinCotejar).toHaveLength(1);
    expect(sinCotejar[0].codigo).toBe('OC-2026-0236');
  });

  it('tarjetasEntradas calcula correctamente los 4 bloques métricos', () => {
    const t = tarjetasEntradas(filasMock as any);
    expect(t.total.cantidad).toBe(3);
    expect(t.total.montoUsd).toBe(50 + 80 + 120);
    expect(t.total.montoBs).toBe(2500 + 4000 + 6000);

    expect(t.reintegradas.cantidad).toBe(2);
    expect(t.reintegradas.montoBs).toBe(2500 + 5800);

    expect(t.pendientes.cantidad).toBe(1);
    expect(t.pendientes.montoBs).toBe(4000);

    expect(t.drive.cuadra).toBe(1);
    expect(t.drive.noCuadra).toBe(1);
    expect(t.drive.sinCotejar).toBe(1);
  });
});
