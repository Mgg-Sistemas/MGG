import { describe, it, expect } from 'vitest';
import type { Orden } from '@/shared/lib/types';
import { filaDeDirecto, filaDeOrden, GRUPOS_REPORTE, type FilaReporteCompras } from './comprasReporte';
import {
  MAX_POR_GRUPO_WHATSAPP,
  TITULOS_WHATSAPP,
  enlaceWhatsapp,
  fechaReporteTexto,
  mensajeReporteCompras,
} from './comprasReporteMensaje';

function orden(over: Partial<Orden>): Orden {
  return {
    id: 'id', codigo: 'SP-2026-0001', proveedor_id: 'p1', solicitante_email: 'x@mgg.com',
    items: [], total: 100, estado: 'oc_aprobada', historial: [], ...over,
  } as Orden;
}

/** Un juego con los cuatro renglones llenos (uno de ellos en Bs). */
function reporteCompleto(): FilaReporteCompras[] {
  return [
    filaDeOrden(orden({ estado: 'oc_creada', oc_codigo: 'OC-2026-0172', total: 8268, notas: 'COMPRA EN BRASIL' })),
    filaDeOrden(orden({ estado: 'cuenta_abierta', oc_codigo: 'OC-2026-0188', total: 1204.88, abonado_total: 204.88, notas: 'RES EN CANAL' })),
    filaDeOrden(orden({ estado: 'confirmada_metodo', oc_codigo: 'OC-2026-0190', total: 250, notas: 'FERRETERÍA' })),
    filaDeOrden(orden({ estado: 'oc_aprobada', oc_codigo: 'OC-2026-0150', total: 55, notas: 'STICKERS' })),
    filaDeOrden(orden({ estado: 'oc_aprobada', oc_codigo: 'OC-2026-0140', total: 9000, moneda: 'Bs', notas: 'PINTURA' })),
    filaDeDirecto({ tipo: 'Compra directa', codigo: 'CD-2026-0054', motivo: 'CAFETERA', proveedor: '—', total: 472.85, moneda: 'USD' }),
  ].filter((f): f is FilaReporteCompras => f !== null);
}

describe('mensajeReporteCompras', () => {
  it('abre con el título, la fecha y cuántos renglones hay', () => {
    const m = mensajeReporteCompras(reporteCompleto(), { fecha: '2026-10-19T17:32:00.000Z' });
    expect(m.startsWith('📊 *REPORTE DE COMPRAS POR RENGLÓN*')).toBe(true);
    expect(m).toContain('📅 19/10/2026');
    expect(m).toContain('🧾 6 renglón(es) pendiente(s)');
  });

  it('escribe los cuatro renglones con su emoji y su cantidad', () => {
    const m = mensajeReporteCompras(reporteCompleto(), { fecha: '2026-10-19T17:32:00.000Z' });
    for (const g of GRUPOS_REPORTE) expect(m).toContain(`${g.emoji} *${g.titulo}`);
    expect(m).toContain('⏳ *PENDIENTE POR APROBAR · 1*');
    expect(m).toContain('💳 *CUENTAS A CRÉDITO · 1*');
    expect(m).toContain('🏦 *POR INDICAR MÉTODO DE PAGO · 1*');
    expect(m).toContain('💰 *POR PAGAR · 3*');
  });

  it('cada fila lleva su código, su motivo y su monto en su moneda', () => {
    const m = mensajeReporteCompras(reporteCompleto(), { fecha: '2026-10-19T17:32:00.000Z' });
    expect(m).toContain('1. OC-2026-0172 · COMPRA EN BRASIL — $ 8.268,00');
    expect(m).toContain('2. OC-2026-0140 · PINTURA — Bs 9.000,00');
    expect(m).toContain('3. CD-2026-0054 · CAFETERA — $ 472,85');
  });

  it('en las cuentas a crédito muestra abonado y saldo, y el subtotal es el saldo', () => {
    const m = mensajeReporteCompras(reporteCompleto(), { fecha: '2026-10-19T17:32:00.000Z' });
    expect(m).toContain('1. OC-2026-0188 · RES EN CANAL — $ 1.000,00 (abonado $ 204,88 · saldo $ 1.000,00)');
    expect(m).toContain('*Subtotal (saldo):* $ 1.000,00');
  });

  it('cierra con el TOTAL GENERAL por moneda (sin mezclar $ y Bs) y la firma', () => {
    const m = mensajeReporteCompras(reporteCompleto(), { fecha: '2026-10-19T17:32:00.000Z' });
    expect(m).toContain('💰 *TOTAL GENERAL*');
    expect(m).toContain('$ 10.045,85  ·  Bs 9.000,00'); // 8268 + 1000 + 250 + 55 + 472,85 (el crédito suma el saldo)
    expect(m.trim().endsWith('🏢 *MINERAL GROUP GUAYANA C.A.*')).toBe(true);
  });

  it('no escribe los renglones vacíos', () => {
    const m = mensajeReporteCompras([filaDeOrden(orden({ estado: 'oc_aprobada', total: 55 }))!], { fecha: '2026-10-19T17:32:00.000Z' });
    expect(m).toContain('💰 *POR PAGAR · 1*');
    expect(m).not.toContain('PENDIENTE POR APROBAR');
    expect(m).not.toContain('CUENTAS A CRÉDITO');
    expect(m).not.toContain('POR INDICAR');
  });

  it('sin nada pendiente lo dice, sin renglones ni total', () => {
    const m = mensajeReporteCompras([], { fecha: '2026-10-19T17:32:00.000Z' });
    expect(m).toContain('🧾 0 renglón(es) pendiente(s)');
    expect(m).toContain('✅ No hay compras pendientes en este momento.');
    expect(m).not.toContain('TOTAL GENERAL');
  });

  it('recorta el motivo muy largo para que quepa en una línea de chat', () => {
    const largo = 'A'.repeat(200);
    const m = mensajeReporteCompras([filaDeOrden(orden({ estado: 'oc_aprobada', total: 10, motivo: largo }))!], { fecha: '2026-10-19T17:32:00.000Z' });
    const linea = m.split('\n').find((l) => l.startsWith('1. '))!;
    expect(linea).toContain('…');
    expect(linea.length).toBeLessThan(120);
  });

  it('con muchísimas filas lista hasta el tope y avisa dónde está el resto', () => {
    const muchas = Array.from({ length: MAX_POR_GRUPO_WHATSAPP + 4 }, (_, i) =>
      filaDeOrden(orden({ estado: 'oc_aprobada', oc_codigo: `OC-${i}`, total: 1 }))!);
    const m = mensajeReporteCompras(muchas, { fecha: '2026-10-19T17:32:00.000Z' });
    expect(m).toContain(`💰 *POR PAGAR · ${MAX_POR_GRUPO_WHATSAPP + 4}*`);
    expect(m).toContain('• … y 4 más (mirá el Excel o el PDF)');
  });

  it('la fila sin motivo no deja un separador suelto', () => {
    const m = mensajeReporteCompras([filaDeOrden(orden({ estado: 'oc_aprobada', oc_codigo: 'OC-1', total: 7, motivo: '', finalidad: null, notas: null, items: [] }))!], { fecha: '2026-10-19T17:32:00.000Z' });
    expect(m).toContain('1. OC-1 — $ 7,00');
    expect(m).not.toContain('— —');
  });
});

describe('emojis de WhatsApp', () => {
  const sinSelectores = (s: string) => !/\uFE0F|\u200D/.test(s);

  it('los emojis de los renglones son de color por sí mismos (sin el selector U+FE0F)', () => {
    for (const t of TITULOS_WHATSAPP) expect(sinSelectores(t)).toBe(true);
  });

  it('el mensaje entero viaja sin selector ni unión invisible: si no, llega un cuadrito', () => {
    expect(sinSelectores(mensajeReporteCompras(reporteCompleto()))).toBe(true);
  });

  it('el mensaje lleva los cuatro emojis de los renglones', () => {
    const m = mensajeReporteCompras(reporteCompleto());
    for (const e of ['⏳', '💳', '🏦', '💰']) expect(m).toContain(e);
  });
});

describe('enlaceWhatsapp', () => {
  const texto = mensajeReporteCompras(reporteCompleto(), { fecha: '2026-10-19T17:32:00.000Z' });

  it('va derecho a api.whatsapp.com con el texto codificado', () => {
    const url = enlaceWhatsapp(texto);
    expect(url.startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
    // Y al decodificar vuelve EXACTO: emojis, acentos y saltos incluidos.
    expect(decodeURIComponent(url.split('text=')[1])).toBe(texto);
  });

  it('NUNCA por wa.me: ese acortador se come los emojis al redirigir', () => {
    expect(enlaceWhatsapp(texto)).not.toContain('wa.me');
  });
});

describe('fechaReporteTexto', () => {
  it('usa la fecha y hora de planta (America/Caracas)', () => {
    expect(fechaReporteTexto('2026-10-19T17:32:00.000Z')).toBe('19/10/2026 · 1:32 p. m.');
  });

  it('sin fecha no rompe', () => {
    expect(fechaReporteTexto(null)).toBe('—');
    expect(fechaReporteTexto('no-es-fecha')).toBe('—');
  });
});
