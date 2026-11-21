import { describe, expect, it } from 'vitest';
import type { OfertaDetalle, Orden } from '@/shared/lib/types';
import {
  formatearFechaCortaEs,
  listarAlertasCreditoPorVencer,
  normalizarCreditoDetalle,
  resolverInfoCredito,
  sellarVencimientoAlConfirmar,
  sumarDiasYmd,
  type FuenteCredito,
} from './creditoVencimiento';

const HOY = '2026-11-19';

function ofertaConCredito(credito: NonNullable<OfertaDetalle['credito']>): OfertaDetalle {
  return { credito };
}

function fuenteCredito(fechaVencimiento: string, patch: Partial<FuenteCredito> = {}): FuenteCredito {
  return {
    condiciones_pago: 'credito',
    estado: 'cuenta_abierta',
    total: 1000,
    abonado_total: 250,
    oferta_detalle: ofertaConCredito({ modalidad: 'dias', dias: 15, fecha_vencimiento: fechaVencimiento }),
    ...patch,
  };
}

function ordenCredito(patch: Partial<Orden> = {}): Orden {
  return {
    id: 'o1',
    codigo: 'OC-2026-0001',
    estado: 'cuenta_abierta',
    condiciones_pago: 'credito',
    total: 1000,
    abonado_total: 250,
    oferta_detalle: ofertaConCredito({ modalidad: 'dias', dias: 15, fecha_vencimiento: '2026-11-20' }),
    ...patch,
  } as Orden;
}

describe('creditoVencimiento - condiciones y alertas', () => {
  it('normaliza plazo en días y modalidad «primero recibe»', () => {
    expect(normalizarCreditoDetalle({ dias: 15 }, '2026-11-19T12:00:00Z')).toMatchObject({
      modalidad: 'dias',
      dias: 15,
      fecha_inicio: HOY,
      fecha_vencimiento: '2026-12-04',
    });
    expect(normalizarCreditoDetalle({ fecha_vencimiento: '2026-11-25' }, '2026-11-19T12:00:00Z')).toMatchObject({
      modalidad: 'dias',
      dias: 6,
      fecha_inicio: HOY,
      fecha_vencimiento: '2026-11-25',
    });
    expect(normalizarCreditoDetalle({ primero_recibe: true })).toMatchObject({
      modalidad: 'primero_recibe',
      primero_recibe: true,
      fecha_vencimiento: null,
    });
    expect(normalizarCreditoDetalle({ dias: 0, primero_recibe: false })).toBeNull();
  });

  it('sella inicio y vencimiento al confirmar la OC a crédito', () => {
    const detalle = ofertaConCredito({ modalidad: 'dias', dias: 30 });
    const sellado = sellarVencimientoAlConfirmar(detalle, '2026-11-19T16:30:00Z');
    expect(sellado?.credito).toMatchObject({ fecha_inicio: HOY, fecha_vencimiento: '2026-12-19' });

    const primeroRecibe = ofertaConCredito({ modalidad: 'primero_recibe', primero_recibe: true, dias: 15 });
    const selladoPrimero = sellarVencimientoAlConfirmar(primeroRecibe, '2026-11-19T16:30:00Z');
    expect(selladoPrimero?.credito).toMatchObject({ fecha_inicio: HOY, fecha_vencimiento: null });
  });

  it('alerta a 2 días, 1 día, hoy y vencido solo con saldo pendiente', () => {
    expect(resolverInfoCredito(fuenteCredito('2026-11-21'), HOY).nivelAlerta).toBe('por_vencer_2d');
    expect(resolverInfoCredito(fuenteCredito('2026-11-20'), HOY).nivelAlerta).toBe('por_vencer_1d');
    expect(resolverInfoCredito(fuenteCredito(HOY), HOY).nivelAlerta).toBe('vence_hoy');
    expect(resolverInfoCredito(fuenteCredito('2026-11-18'), HOY).nivelAlerta).toBe('vencido');
    expect(resolverInfoCredito(fuenteCredito('2026-12-19'), HOY).nivelAlerta).toBe('ninguna');

    const saldada = resolverInfoCredito(fuenteCredito('2026-11-18', { abonado_total: 1000 }), HOY);
    expect(saldada.saldoPendiente).toBe(0);
    expect(saldada.enAlertaVencimiento).toBe(false);
  });

  it('cuenta el plazo de «primero recibe» desde la recepción', () => {
    const info = resolverInfoCredito(
      fuenteCredito('', {
        recibida_en: '2026-11-10T12:00:00Z',
        oferta_detalle: ofertaConCredito({ modalidad: 'primero_recibe', primero_recibe: true, dias: 15 }),
      }),
      HOY,
    );
    expect(info.recibida).toBe(true);
    expect(info.fechaVencimiento).toBe('2026-11-25');
    expect(info.diasRestantes).toBe(6);
    expect(info.resumenCorto).toContain('Ya recibida');
  });

  it('lista OC y OS vencidas o por vencer, sin compras directas ni cuentas saldadas', () => {
    const proveedores = new Map([
      ['prov-1', 'Proveedor Uno'],
      ['prov-2', 'Proveedor Dos'],
    ]);
    const alertas = listarAlertasCreditoPorVencer(
      [
        ordenCredito({ id: 'a', codigo: 'OC-2026-0001', proveedor_id: 'prov-1', oferta_detalle: ofertaConCredito({ modalidad: 'dias', dias: 15, fecha_vencimiento: '2026-11-20' }) }),
        ordenCredito({ id: 'b', codigo: 'SV-2026-0002', proveedor_id: 'prov-2', oferta_detalle: ofertaConCredito({ modalidad: 'dias', dias: 15, fecha_vencimiento: '2026-11-18' }) }),
        ordenCredito({ id: 'c', codigo: 'CD-2026-0003', proveedor_id: 'prov-1' }),
        ordenCredito({ id: 'd', codigo: 'OC-2026-0004', abonado_total: 1000, proveedor_id: 'prov-1' }),
      ],
      proveedores,
      HOY,
    );

    expect(alertas).toHaveLength(2);
    expect(alertas[0].tipo).toBe('OS');
    expect(alertas[0].codigo).toBe('SV-2026-0002');
    expect(alertas[0].proveedorNombre).toBe('Proveedor Dos');
    expect(alertas[0].info.nivelAlerta).toBe('vencido');
    expect(alertas[1].tipo).toBe('OC');
    expect(alertas[1].saldoPendiente).toBe(750);
  });

  it('formatea fechas y suma días sin desviación de zona horaria', () => {
    expect(sumarDiasYmd('2026-12-31', 1)).toBe('2027-01-01');
    expect(formatearFechaCortaEs('2026-11-19')).toBe('19/11/2026');
    expect(formatearFechaCortaEs(null)).toBe('—');
  });
});
