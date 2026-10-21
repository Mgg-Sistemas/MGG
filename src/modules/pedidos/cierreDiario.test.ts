import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armarCierre, enRango, fechaEntradaAprobacion, fechaEntradaPago, fechaVE, limitesISO, rangoCierre, sumarDias, ITEMS_CIERRE,
  type FiltroCierre,
} from './cierreDiario';
import { mensajeCierreDiario } from './cierreDiarioMensaje';

// La vista previa no se abre en las pruebas: se captura el libro que se le entrega.
const capturado: { wb?: { SheetNames: string[]; Sheets: Record<string, Record<string, { v?: unknown; z?: string }>> }; nombre?: string } = {};
vi.mock('@/shared/lib/reportPreview', () => ({
  previewWorkbook: (_x: unknown, wb: never, nombre: string) => { capturado.wb = wb; capturado.nombre = nombre; },
}));

const HOY = '2026-10-21'; // miércoles
const filtro = (over: Partial<FiltroCierre> = {}): FiltroCierre => ({ modo: 'dia', dia: HOY, mes: '2026-10', desde: HOY, hasta: HOY, ...over });

describe('fechaVE · el día se lee en horario de Venezuela', () => {
  it('las 9 p. m. del 20 en Caracas siguen siendo del 20 (aunque en UTC ya sea el 21)', () => {
    expect(fechaVE('2026-10-21T01:00:00.000Z')).toBe('2026-10-20');
  });
  it('las 12:30 a. m. del 21 en Caracas ya son del 21', () => {
    expect(fechaVE('2026-10-21T04:30:00.000Z')).toBe('2026-10-21');
  });
  it('sin fecha o con basura, null', () => {
    expect(fechaVE(null)).toBeNull();
    expect(fechaVE('')).toBeNull();
    expect(fechaVE('no es fecha')).toBeNull();
  });
});

describe('rangoCierre', () => {
  it('día: HOY dice «Hoy»; otro día dice «Día»', () => {
    expect(rangoCierre(filtro(), HOY)).toEqual({ desde: HOY, hasta: HOY, etiqueta: 'Hoy · 21/10/2026' });
    expect(rangoCierre(filtro({ dia: '2026-10-19' }), HOY).etiqueta).toBe('Día 19/10/2026');
  });

  it('semana: de lunes a domingo, sea cual sea el día que se escoja', () => {
    for (const dia of ['2026-10-19', '2026-10-21', '2026-10-25']) {
      expect(rangoCierre(filtro({ modo: 'semana', dia }), HOY)).toEqual({ desde: '2026-10-19', hasta: '2026-10-25', etiqueta: 'Semana del 19/10/2026 al 25/10/2026' });
    }
  });

  it('semana que cruza de mes y de año', () => {
    const r = rangoCierre(filtro({ modo: 'semana', dia: '2026-12-31' }), HOY);
    expect(r.desde).toBe('2026-12-28');
    expect(r.hasta).toBe('2027-01-03');
  });

  it('mes: del 1 al último día (también febrero bisiesto y diciembre)', () => {
    expect(rangoCierre(filtro({ modo: 'mes', mes: '2026-10' }), HOY)).toEqual({ desde: '2026-10-01', hasta: '2026-10-31', etiqueta: 'Octubre 2026 (01/10/2026 al 31/10/2026)' });
    expect(rangoCierre(filtro({ modo: 'mes', mes: '2028-02' }), HOY).hasta).toBe('2028-02-29');
    expect(rangoCierre(filtro({ modo: 'mes', mes: '2026-12' }), HOY).hasta).toBe('2026-12-31');
  });

  it('rango: el que se pide; al revés se endereza; un solo día se lee como día', () => {
    expect(rangoCierre(filtro({ modo: 'rango', desde: '2026-10-01', hasta: '2026-10-15' }), HOY).etiqueta).toBe('Del 01/10/2026 al 15/10/2026');
    expect(rangoCierre(filtro({ modo: 'rango', desde: '2026-10-15', hasta: '2026-10-01' }), HOY)).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-15' });
    expect(rangoCierre(filtro({ modo: 'rango', desde: '2026-10-05', hasta: '2026-10-05' }), HOY).etiqueta).toBe('Día 05/10/2026');
  });

  it('un campo vacío usa HOY: la pantalla nunca queda en blanco', () => {
    expect(rangoCierre(filtro({ dia: '' }), HOY).desde).toBe(HOY);
    expect(rangoCierre(filtro({ modo: 'rango', desde: '', hasta: '' }), HOY)).toMatchObject({ desde: HOY, hasta: HOY });
    expect(rangoCierre(filtro({ modo: 'rango', desde: '', hasta: '2026-10-03' }), HOY)).toMatchObject({ desde: '2026-10-03', hasta: '2026-10-03' });
    expect(rangoCierre(filtro({ modo: 'mes', mes: '' }), HOY).desde).toBe('2026-10-01');
  });
});

describe('limitesISO y enRango', () => {
  it('un día va de las 00:00 a las 23:59:59.999 de Caracas (04:00 UTC → 03:59:59.999 UTC)', () => {
    expect(limitesISO({ desde: '2026-10-21', hasta: '2026-10-21' })).toEqual({ inicio: '2026-10-21T04:00:00.000Z', fin: '2026-10-22T03:59:59.999Z' });
  });

  it('enRango cuenta por día de Venezuela, con los dos extremos incluidos', () => {
    const r = { desde: '2026-10-21', hasta: '2026-10-23' };
    expect(enRango('2026-10-21T04:00:00.000Z', r)).toBe(true);   // 00:00 del 21 en Caracas
    expect(enRango('2026-10-21T03:59:59.000Z', r)).toBe(false);  // 11:59 p. m. del 20
    expect(enRango('2026-10-24T03:59:59.000Z', r)).toBe(true);   // 11:59 p. m. del 23
    expect(enRango('2026-10-24T04:00:00.000Z', r)).toBe(false);  // 00:00 del 24
    expect(enRango(null, r)).toBe(false);
  });

  it('sumarDias cruza meses y años', () => {
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('fechas de entrada a cada estado', () => {
  it('pendiente por aprobar: cuando se creó la OC; sin eso, la solicitud', () => {
    expect(fechaEntradaAprobacion({ oc_creada_en: '2026-10-20T15:00:00Z', created_at: '2026-10-15T15:00:00Z' })).toBe('2026-10-20T15:00:00Z');
    expect(fechaEntradaAprobacion({ created_at: '2026-10-15T15:00:00Z' })).toBe('2026-10-15T15:00:00Z');
    expect(fechaEntradaAprobacion({})).toBeNull();
  });

  it('por pagar sin método: cuando la confirmó el Gerente', () => {
    expect(fechaEntradaPago({ estado: 'confirmada_metodo', oc_aprobada_en: '2026-10-16T11:44:00Z', created_at: '2026-10-15T00:00:00Z' })).toBe('2026-10-16T11:44:00Z');
  });

  it('por pagar ya en Tesorería: la ÚLTIMA vez que se indicó el método', () => {
    const o = {
      estado: 'oc_aprobada', oc_aprobada_en: '2026-10-16T11:44:00Z', metodo_pago_en: '2026-10-20T10:00:00Z',
      historial: [
        { evento: 'metodo_pago', at: '2026-10-17T10:00:00Z' },
        { evento: 'oc_reabierta', at: '2026-10-18T10:00:00Z' },
        { evento: 'metodo_pago', at: '2026-10-19T10:00:00Z' },
        { evento: 'metodo_pago_corregido', at: '2026-10-20T10:00:00Z' },
      ],
    };
    expect(fechaEntradaPago(o)).toBe('2026-10-19T10:00:00Z');
  });

  it('una corrección del método no cambia la fecha en que entró a pago', () => {
    expect(fechaEntradaPago({ estado: 'oc_aprobada', historial: [{ evento: 'metodo_pago', at: '2026-10-17T10:00:00Z' }, { evento: 'metodo_pago_corregido', at: '2026-10-21T10:00:00Z' }] })).toBe('2026-10-17T10:00:00Z');
  });

  it('sin historial usa la fecha del método, o la de la confirmación', () => {
    expect(fechaEntradaPago({ estado: 'oc_aprobada', metodo_pago_en: '2026-10-19T10:00:00Z', oc_aprobada_en: '2026-10-16T00:00:00Z' })).toBe('2026-10-19T10:00:00Z');
    expect(fechaEntradaPago({ estado: 'oc_aprobada', oc_aprobada_en: '2026-10-16T00:00:00Z' })).toBe('2026-10-16T00:00:00Z');
  });
});

describe('armarCierre', () => {
  const hoy = rangoCierre(filtro(), HOY);
  const hoyIso = '2026-10-21T15:00:00.000Z';   // 11:00 a. m. del 21
  const ayerIso = '2026-10-20T15:00:00.000Z';

  it('lleva los cuatro títulos, en el orden pedido', () => {
    const r = armarCierre({ pedidos: 0, pagadas: 0, pendientesAprobar: [], porPagar: [] }, hoy);
    expect(r.items.map((i) => i.titulo)).toEqual([
      'Total de pedidos', 'Total órdenes pendientes por aprobar', 'Total órdenes por pagar', 'Total órdenes pagadas',
    ]);
    expect(r.items.map((i) => i.key)).toEqual(ITEMS_CIERRE.map((i) => i.key));
    expect(r.items.every((i) => i.cantidad === 0)).toBe(true);
  });

  it('«HOY» solo cuenta lo que entró hoy a cada estado', () => {
    const r = armarCierre({ pedidos: 7, pagadas: 3, pendientesAprobar: [hoyIso, ayerIso, hoyIso, null], porPagar: [ayerIso, hoyIso] }, hoy);
    expect(r.items.map((i) => i.cantidad)).toEqual([7, 2, 1, 3]);
  });

  it('con la semana entra también lo de ayer', () => {
    const semana = rangoCierre(filtro({ modo: 'semana' }), HOY);
    const r = armarCierre({ pedidos: 20, pagadas: 9, pendientesAprobar: [hoyIso, ayerIso, '2026-10-12T15:00:00.000Z'], porPagar: [ayerIso, hoyIso, '2026-10-05T15:00:00.000Z'] }, semana);
    expect(r.items.map((i) => i.cantidad)).toEqual([20, 2, 2, 9]);
  });

  it('con el mes entra todo el mes, y lo de otro mes no', () => {
    const mes = rangoCierre(filtro({ modo: 'mes', mes: '2026-10' }), HOY);
    const r = armarCierre({ pedidos: 1, pagadas: 1, pendientesAprobar: ['2026-10-01T15:00:00Z', '2026-10-31T15:00:00Z', '2026-09-30T15:00:00Z', '2026-11-01T15:00:00Z'], porPagar: [] }, mes);
    expect(r.items[1].cantidad).toBe(2);
  });

  it('las cantidades que ya trae la base se respetan y nunca salen negativas ni decimales', () => {
    const r = armarCierre({ pedidos: -3, pagadas: 4.9, pendientesAprobar: [], porPagar: [] }, hoy);
    expect(r.items[0].cantidad).toBe(0);
    expect(r.items[3].cantidad).toBe(4);
  });
});

describe('mensajeCierreDiario · WhatsApp', () => {
  const rango = rangoCierre(filtro(), HOY);
  const r = armarCierre({ pedidos: 12, pagadas: 3, pendientesAprobar: ['2026-10-21T15:00:00.000Z', '2026-10-21T16:00:00.000Z'], porPagar: ['2026-10-21T15:00:00.000Z'] }, rango);
  const impreso = '2026-10-21T12:45:00.000Z'; // 8:45 a. m. en Caracas

  it('lleva título, período, hora de impresión y los cuatro títulos cortos, con espacios entre líneas y pie de empresa', () => {
    expect(mensajeCierreDiario(r, impreso).split('\n')).toEqual([
      '📊 *CIERRE DIARIO · COMPRAS*',
      '',
      '📅 *Período:* Hoy · 21/10/2026',
      '',
      '🕒 *Impreso:* 21/10/2026 · 8:45 a. m.',
      '',
      '📥 *Pedidos:* 12',
      '',
      '⏳ *Órdenes pendientes por aprobar:* 2',
      '',
      '💵 *Órdenes por pagar:* 1',
      '',
      '✅ *Órdenes pagadas:* 3',
      '',
      '🏢 *MINERAL GROUP GUAYANA C.A.*',
    ]);
  });

  it('SIN el selector U+FE0F ni uniones invisibles: si no, WhatsApp muestra un cuadrito', () => {
    expect(/️|‍/.test(mensajeCierreDiario(r, impreso))).toBe(false);
  });
});

describe('Excel del cierre diario', () => {
  beforeEach(() => { capturado.wb = undefined; });

  it('lleva período, hora de impresión y las cuatro cantidades como NÚMERO', async () => {
    const { exportarCierreDiarioExcel } = await import('./cierreDiarioExcel');
    const rango = rangoCierre(filtro({ modo: 'semana' }), HOY);
    const r = armarCierre({ pedidos: 12, pagadas: 3, pendientesAprobar: ['2026-10-21T15:00:00.000Z'], porPagar: [] }, rango);
    await exportarCierreDiarioExcel(r, '2026-10-21T12:45:00.000Z');
    expect(capturado.nombre).toBe('cierre-diario-compras.xlsx');
    expect(capturado.wb!.SheetNames).toEqual(['Cierre diario']);
    const celdas = Object.entries(capturado.wb!.Sheets['Cierre diario']).filter(([k]) => !k.startsWith('!')).map(([, c]) => c.v);
    expect(celdas).toContain('Período: Semana del 19/10/2026 al 25/10/2026');
    expect(celdas).toContain('Impreso: 21/10/2026 · 8:45 a. m.');
    expect(celdas).toContain('📋 Total de pedidos');
    expect(celdas).toContain(12);
    expect(celdas).toContain(1);
    expect(celdas).toContain(0);
    expect(celdas).toContain(3);
  });

  it('incluye sección de actividad por analista con números', async () => {
    const { exportarCierreDiarioExcel } = await import('./cierreDiarioExcel');
    const rango = rangoCierre(filtro(), HOY);
    const r = armarCierre(
      {
        pedidos: 1,
        pagadas: 1,
        pendientesAprobar: [],
        porPagar: [],
        cotizaciones: [{ id: 'c1', registrada_por_email: 'nazareth@mgg.com', registrada_en: '2026-10-21T15:00:00Z' }],
        finalizadas: [{ id: 'o1', finalizada_por: 'nazareth@mgg.com', finalizada_en: '2026-10-21T16:00:00Z' }],
        nombresPorEmail: new Map([['nazareth@mgg.com', 'Nazareth']]),
      },
      rango,
    );
    await exportarCierreDiarioExcel(r, '2026-10-21T12:45:00.000Z');
    const celdas = Object.entries(capturado.wb!.Sheets['Cierre diario']).filter(([k]) => !k.startsWith('!')).map(([, c]) => c.v);
    expect(celdas).toContain('ACTIVIDAD POR ANALISTA');
    expect(celdas).toContain('ANALISTA');
    expect(celdas).toContain('Nazareth');
  });
});

describe('actividad por analista · cotizaciones y órdenes finalizadas', () => {
  const hoy = rangoCierre(filtro(), HOY);

  it('agrupa cotizaciones y órdenes finalizadas por analista', () => {
    const r = armarCierre(
      {
        pedidos: 5,
        pagadas: 2,
        pendientesAprobar: [],
        porPagar: [],
        cotizaciones: [
          { id: '1', registrada_por_email: 'nazareth@mgg.com', registrada_en: '2026-10-21T14:00:00Z' },
          { id: '2', registrada_por_email: 'nazareth@mgg.com', registrada_en: '2026-10-21T15:00:00Z' },
          { id: '3', registrada_por_email: 'carlos@mgg.com', registrada_en: '2026-10-21T16:00:00Z' },
          // Fuera de rango (del día 20)
          { id: '4', registrada_por_email: 'nazareth@mgg.com', registrada_en: '2026-10-20T14:00:00Z' },
        ],
        finalizadas: [
          { id: '10', finalizada_por: 'nazareth@mgg.com', finalizada_en: '2026-10-21T18:00:00Z' },
          // Fuera de rango (del día 22)
          { id: '11', finalizada_por: 'nazareth@mgg.com', finalizada_en: '2026-10-22T10:00:00Z' },
        ],
        nombresPorEmail: new Map([
          ['nazareth@mgg.com', 'Nazareth'],
          ['carlos@mgg.com', 'Carlos Gómez'],
        ]),
      },
      hoy,
    );

    expect(r.totalCotizaciones).toBe(3);
    expect(r.totalFinalizadas).toBe(1);
    expect(r.analistas).toHaveLength(2);

    const nazareth = r.analistas.find((a) => a.email === 'nazareth@mgg.com');
    expect(nazareth).toBeDefined();
    expect(nazareth!.nombre).toBe('Nazareth');
    expect(nazareth!.cotizaciones).toBe(2);
    expect(nazareth!.ordenesFinalizadas).toBe(1);

    const carlos = r.analistas.find((a) => a.email === 'carlos@mgg.com');
    expect(carlos).toBeDefined();
    expect(carlos!.nombre).toBe('Carlos Gómez');
    expect(carlos!.cotizaciones).toBe(1);
    expect(carlos!.ordenesFinalizadas).toBe(0);
  });

  it('formatea el mensaje de WhatsApp con el desglose por analista', () => {
    const r = armarCierre(
      {
        pedidos: 4,
        pagadas: 1,
        pendientesAprobar: [],
        porPagar: [],
        cotizaciones: [{ id: '1', registrada_por_email: 'nazareth@mgg.com', registrada_en: '2026-10-21T15:00:00Z' }],
        finalizadas: [{ id: '2', finalizada_por: 'nazareth@mgg.com', finalizada_en: '2026-10-21T16:00:00Z' }],
        nombresPorEmail: new Map([['nazareth@mgg.com', 'Nazareth']]),
      },
      hoy,
    );

    const msg = mensajeCierreDiario(r, '2026-10-21T12:45:00.000Z');
    expect(msg).toContain([
      '👥 *POR ANALISTA*',
      '',
      '👤 *NAZARETH:*',
      'Total de cotizaciones realizadas: *1*',
      'Total de órdenes finalizadas: *1*',
      '',
      '🏢 *MINERAL GROUP GUAYANA C.A.*',
    ].join('\n'));
  });
});
