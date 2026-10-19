import { describe, it, expect } from 'vitest';
import type { Orden } from '@/shared/lib/types';
import {
  GRUPOS_REPORTE,
  agruparReporte,
  COLOR_TOTAL,
  COLOR_TOTAL_TEXTO,
  filaDeDirecto,
  filaDeOrden,
  fmtMonto,
  grupoDeEstado,
  monedaDe,
  montoDeOrden,
  motivoDeOrden,
  totalesPorMoneda,
  totalesTexto,
} from './comprasReporte';

/** Una orden mínima para probar el mapeo sin base de datos. */
function orden(over: Partial<Orden>): Orden {
  return {
    id: 'id', codigo: 'SP-2026-0001', proveedor_id: 'p1', solicitante_email: 'x@mgg.com',
    items: [], total: 100, estado: 'oc_aprobada', historial: [], ...over,
  } as Orden;
}

describe('grupoDeEstado', () => {
  it('reparte los cuatro estados del reporte en sus renglones', () => {
    expect(grupoDeEstado('oc_creada')).toBe('pendiente_aprobar');
    expect(grupoDeEstado('cuenta_abierta')).toBe('cuenta_abierta');
    expect(grupoDeEstado('confirmada_metodo')).toBe('indicar_metodo');
    expect(grupoDeEstado('oc_aprobada')).toBe('por_pagar');
  });

  it('lo que ya no está pendiente no entra al reporte', () => {
    for (const e of ['pendiente', 'aprobada', 'por_recibir', 'pagada', 'recibida', 'finalizada', 'anulada', 'cancelada', 'rechazada', 'desistida_proveedor']) {
      expect(grupoDeEstado(e)).toBeNull();
    }
    expect(grupoDeEstado(null)).toBeNull();
    expect(grupoDeEstado(undefined)).toBeNull();
    expect(grupoDeEstado(' oc_creada ')).toBe('pendiente_aprobar');
  });
});

describe('monedaDe', () => {
  it('solo los bolívares son Bs; lo demás es $ (igual que el resto del sistema)', () => {
    expect(monedaDe('Bs')).toBe('Bs');
    expect(monedaDe(' BS ')).toBe('Bs');
    expect(monedaDe('ves')).toBe('Bs');
    expect(monedaDe('USD')).toBe('USD');
    expect(monedaDe('$')).toBe('USD');
    expect(monedaDe(null)).toBe('USD');
  });
});

describe('motivoDeOrden', () => {
  it('usa motivo, si no finalidad, si no notas, si no los renglones de la orden', () => {
    expect(motivoDeOrden({ motivo: 'Reparar bomba', finalidad: 'X', notas: 'Y', items: [] })).toBe('Reparar bomba');
    expect(motivoDeOrden({ motivo: '', finalidad: 'Mantenimiento', notas: 'Y', items: [] })).toBe('Mantenimiento');
    expect(motivoDeOrden({ motivo: null, finalidad: null, notas: 'SOLICITUD DE FILTROS', items: [] })).toBe('SOLICITUD DE FILTROS');
  });

  it('sin texto escrito, arma el motivo con los productos pedidos', () => {
    const o = orden({ items: [{ sku: 'A', nombre: 'GUANTES', cantidad: 2, precio: 1 }, { sku: 'B', nombre: 'CASCOS', cantidad: 1, precio: 1 }] });
    expect(motivoDeOrden(o)).toBe('GUANTES, CASCOS');
  });

  it('sin nada de nada deja el guion (nunca una celda vacía)', () => {
    expect(motivoDeOrden({ motivo: '  ', finalidad: null, notas: null, items: [] })).toBe('—');
  });

  it('junta los espacios y saltos de línea del Excel/pantalla en uno solo', () => {
    expect(motivoDeOrden({ motivo: 'COMPRA  DE\nMERCADO', items: [] })).toBe('COMPRA DE MERCADO');
  });
});

describe('montoDeOrden', () => {
  it('usa el total de la orden y le resta el descuento del método de pago', () => {
    expect(montoDeOrden({ condiciones_pago: 'contado', total: 8268, descuento_pago: null })).toBe(8268);
    expect(montoDeOrden({ condiciones_pago: 'contado', total: 8268, descuento_pago: 268 })).toBe(8000);
  });

  it('en contra entrega solo se paga lo recibido', () => {
    expect(montoDeOrden({ condiciones_pago: 'contra_entrega', total: 1000, recibido_total: 640.5, descuento_pago: null })).toBe(640.5);
    // si todavía no se recibió nada no hay monto todavía: cae al total
    expect(montoDeOrden({ condiciones_pago: 'contra_entrega', total: 1000, recibido_total: null, descuento_pago: null })).toBe(1000);
  });

  it('nunca da negativo (un descuento mayor que el total deja 0)', () => {
    expect(montoDeOrden({ condiciones_pago: 'contado', total: 100, descuento_pago: 150 })).toBe(0);
  });
});

describe('filaDeOrden', () => {
  it('pendiente por aprobar: código de la OC, motivo y monto', () => {
    const f = filaDeOrden(orden({ estado: 'oc_creada', codigo: 'SP-2026-0167', oc_codigo: 'OC-2026-0172', total: 8268, notas: 'COMPRA REALIZADA EN BRASIL' }), 'PROVEEDOR X');
    expect(f).toMatchObject({
      grupo: 'pendiente_aprobar', tipo: 'OC', codigo: 'OC-2026-0172',
      motivo: 'COMPRA REALIZADA EN BRASIL', proveedor: 'PROVEEDOR X', monto: 8268, moneda: 'USD', saldo: 8268, abonado: 0,
    });
  });

  it('sin código de OC usa el de la solicitud', () => {
    expect(filaDeOrden(orden({ oc_codigo: null }))?.codigo).toBe('SP-2026-0001');
  });

  it('un servicio se marca como Servicio (no como OC)', () => {
    expect(filaDeOrden(orden({ clase: 'servicio' }))?.tipo).toBe('Servicio');
  });

  it('cuenta a crédito: muestra el total, lo abonado y el SALDO pendiente', () => {
    const f = filaDeOrden(orden({ estado: 'cuenta_abierta', total: 1204.88, abonado_total: 204.88 }), 'PROVEEDOR Y');
    expect(f).toMatchObject({ grupo: 'cuenta_abierta', monto: 1204.88, abonado: 204.88, saldo: 1000 });
  });

  it('una cuenta a crédito ya saldada queda en saldo 0 (no en negativo)', () => {
    expect(filaDeOrden(orden({ estado: 'cuenta_abierta', total: 500, abonado_total: 600 }))?.saldo).toBe(0);
  });

  it('las órdenes en Bs conservan su moneda', () => {
    expect(filaDeOrden(orden({ moneda: 'Bs', total: 367606.68 }))?.moneda).toBe('Bs');
  });

  it('las órdenes que no son de estos cuatro renglones no aparecen', () => {
    expect(filaDeOrden(orden({ estado: 'pagada' }))).toBeNull();
    expect(filaDeOrden(orden({ estado: 'finalizada' }))).toBeNull();
  });
});

describe('filaDeDirecto', () => {
  it('una compra directa por pagar entra al renglón «Por pagar» con su código y su monto', () => {
    const f = filaDeDirecto({ tipo: 'Compra directa', codigo: 'CD-2026-0054', motivo: 'CAFETERA', proveedor: '—', total: 472.85, moneda: 'USD' });
    expect(f).toMatchObject({ grupo: 'por_pagar', tipo: 'Compra directa', codigo: 'CD-2026-0054', motivo: 'CAFETERA', monto: 472.85, moneda: 'USD', saldo: 472.85 });
  });

  it('un directo en Bs se muestra en bolívares', () => {
    expect(filaDeDirecto({ tipo: 'Servicio directo', codigo: 'SD-2026-0005', motivo: 'GRÚA', proveedor: '—', total: 12000, moneda: 'Bs' }).moneda).toBe('Bs');
  });

  it('sin código o sin motivo deja el guion (la fila nunca va vacía)', () => {
    const f = filaDeDirecto({ tipo: 'Servicio directo', codigo: '', motivo: '  ', proveedor: '', total: 0, moneda: null });
    expect(f.codigo).toBe('—');
    expect(f.motivo).toBe('—');
    expect(f.moneda).toBe('USD');
  });
});

describe('agruparReporte', () => {
  it('devuelve SIEMPRE los cuatro renglones, en el orden pedido, aunque estén vacíos', () => {
    const g = agruparReporte([]);
    expect(g.map((x) => x.key)).toEqual(['pendiente_aprobar', 'cuenta_abierta', 'indicar_metodo', 'por_pagar']);
    expect(g.map((x) => x.titulo)).toEqual(GRUPOS_REPORTE.map((x) => x.titulo));
    expect(g.every((x) => x.filas.length === 0 && x.totalUsd === 0 && x.totalBs === 0)).toBe(true);
  });

  it('suma por moneda dentro de cada renglón y en crédito suma el SALDO, no el total', () => {
    const filas = [
      filaDeOrden(orden({ estado: 'cuenta_abierta', total: 1204.88, abonado_total: 204.88 })),
      filaDeOrden(orden({ estado: 'cuenta_abierta', total: 1000, abonado_total: 0 })),
      filaDeOrden(orden({ estado: 'oc_aprobada', total: 55 })),
      filaDeOrden(orden({ estado: 'oc_aprobada', total: 9000, moneda: 'Bs' })),
      filaDeDirecto({ tipo: 'Compra directa', codigo: 'CD-1', motivo: 'X', proveedor: '—', total: 472.85, moneda: 'USD' }),
      filaDeOrden(orden({ estado: 'pagada' })),
    ].filter((f): f is NonNullable<typeof f> => f !== null);

    const g = agruparReporte(filas);
    const credito = g.find((x) => x.key === 'cuenta_abierta')!;
    expect(credito.filas).toHaveLength(2);
    expect(credito.totalUsd).toBe(2000); // 1000 (saldo) + 1000 (sin abonos)

    const porPagar = g.find((x) => x.key === 'por_pagar')!;
    expect(porPagar.filas).toHaveLength(3); // 2 OC + 1 compra directa
    expect(porPagar.totalUsd).toBe(527.85);
    expect(porPagar.totalBs).toBe(9000);

    expect(g.find((x) => x.key === 'pendiente_aprobar')!.filas).toHaveLength(0);
    expect(g.find((x) => x.key === 'indicar_metodo')!.filas).toHaveLength(0);
  });

  it('totalesPorMoneda separa $ de Bs y redondea a 2 decimales', () => {
    const filas = [
      filaDeDirecto({ tipo: 'Compra directa', codigo: 'CD-1', motivo: 'X', proveedor: '—', total: 0.005, moneda: 'USD' }),
      filaDeDirecto({ tipo: 'Compra directa', codigo: 'CD-2', motivo: 'X', proveedor: '—', total: 10.004, moneda: 'USD' }),
      filaDeDirecto({ tipo: 'Servicio directo', codigo: 'SD-1', motivo: 'X', proveedor: '—', total: 100.5, moneda: 'Bs' }),
    ];
    expect(totalesPorMoneda(filas)).toEqual({ usd: 10.01, bs: 100.5 });
  });
});

describe('totalesTexto', () => {
  const g = (filas: ReturnType<typeof filaDeDirecto>[]) => agruparReporte(filas).find((x) => x.key === 'por_pagar')!;

  it('escribe solo las monedas que tienen filas (nunca mezcla $ con Bs)', () => {
    expect(totalesTexto(g([filaDeDirecto({ tipo: 'Compra directa', codigo: 'CD-1', motivo: 'X', proveedor: '—', total: 1234.5, moneda: 'USD' })]))).toBe('$ 1.234,50');
    expect(totalesTexto(g([filaDeDirecto({ tipo: 'Compra directa', codigo: 'CD-1', motivo: 'X', proveedor: '—', total: 9000, moneda: 'Bs' })]))).toBe('Bs 9.000,00');
    expect(totalesTexto(g([
      filaDeDirecto({ tipo: 'Compra directa', codigo: 'CD-1', motivo: 'X', proveedor: '—', total: 527.85, moneda: 'USD' }),
      filaDeDirecto({ tipo: 'Compra directa', codigo: 'CD-2', motivo: 'X', proveedor: '—', total: 9000, moneda: 'Bs' }),
    ]))).toBe('$ 527,85  ·  Bs 9.000,00');
  });

  it('un renglón vacío muestra $ 0,00 (nunca una celda en blanco)', () => {
    expect(totalesTexto(agruparReporte([])[3])).toBe('$ 0,00');
  });
});

describe('los colores de los renglones (pastel, legibles)', () => {
  /** Luminancia relativa del W3C: sirve para saber si un color es claro u oscuro. */
  function luminancia(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  /** Contraste W3C entre dos colores (1 = iguales; 4,5 es el mínimo para texto chico). */
  function contraste(a: string, b: string): number {
    const [alto, bajo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
    return (alto + 0.05) / (bajo + 0.05);
  }

  it('el fondo es PASTEL (claro), no el naranja pleno de la marca ni un color saturado', () => {
    for (const g of GRUPOS_REPORTE) expect(luminancia(g.color)).toBeGreaterThan(0.7);
  });

  it('la letra va en el tono oscuro del mismo color: sobre pastel el blanco no se lee', () => {
    for (const g of GRUPOS_REPORTE) expect(luminancia(g.colorTexto)).toBeLessThan(0.15);
  });

  it('cada renglón pasa el contraste 4,5:1 del W3C (encabezado y subtotal)', () => {
    for (const g of GRUPOS_REPORTE) expect(contraste(g.color, g.colorTexto)).toBeGreaterThanOrEqual(4.5);
  });

  it('el TOTAL GENERAL usa el mismo par pastel y también se lee', () => {
    expect(luminancia(COLOR_TOTAL)).toBeGreaterThan(0.7);
    expect(contraste(COLOR_TOTAL, COLOR_TOTAL_TEXTO)).toBeGreaterThanOrEqual(4.5);
  });

  it('cada renglón tiene su emoji, para el mensaje de WhatsApp', () => {
    for (const g of GRUPOS_REPORTE) expect(g.emoji.trim().length).toBeGreaterThan(0);
  });

  it('los emojis van sin el selector U+FE0F ni unión invisible: WhatsApp los borra y llega un cuadrito', () => {
    for (const g of GRUPOS_REPORTE) expect(/[\uFE0F\u200D]/.test(g.emoji)).toBe(false);
  });
});

describe('fmtMonto', () => {
  it('escribe el monto en la moneda de la fila ($ o Bs)', () => {
    expect(fmtMonto(1204.88, 'USD')).toBe('$ 1.204,88');
    expect(fmtMonto(367606.68, 'Bs')).toBe('Bs 367.606,68');
    expect(fmtMonto(0, 'USD')).toBe('$ 0,00');
    expect(fmtMonto(null, 'Bs')).toBe('Bs 0,00');
  });
});
