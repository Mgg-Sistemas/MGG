import { describe, expect, it } from 'vitest';
import { leerMotivoReparto, mensajeHistoricoRepartos, mensajeReparto, tocaCocina, valorReparto, type RepartoHist } from './repartoHistorico';

const r: RepartoHist = {
  id: '1', codigo: 'TRA-2026-0028', estado: 'ejecutada', fecha: '2026-11-05T13:34:45Z', ejecutadaEn: '2026-11-05T13:34:50Z',
  mercado: 4, origen: 'Los Pinos', destino: 'Resguardo Matanzas', nota: 'PARA MATANZA', quien: 'LEYDIS RENGEL',
  lineas: [
    { nombre: 'ARROZ', cantidad: 10, unidad: 'KILOGRAMO', precio: 1.2 },
    { nombre: 'CAFÉ', cantidad: 2, unidad: 'UNIDAD', precio: null },
  ],
};

describe('Histórico de distribución (05-11-2026)', () => {
  it('lee el motivo del reparto', () => {
    expect(leerMotivoReparto('Reparto del mercado #4 de Los Pinos a Resguardo Matanzas · PARA MATANZA'))
      .toEqual({ mercado: 4, origen: 'Los Pinos', destino: 'Resguardo Matanzas', nota: 'PARA MATANZA' });
    expect(leerMotivoReparto('Reparto del mercado #4 de Los Pinos a La Esperanza'))
      .toEqual({ mercado: 4, origen: 'Los Pinos', destino: 'La Esperanza', nota: null });
    expect(leerMotivoReparto('Traslado de repuestos')).toBeNull();
  });

  it('toca la cocina si sale de ella o le llega', () => {
    expect(tocaCocina(r, 'los pinos')).toBe(true);
    expect(tocaCocina(r, 'Resguardo Matanzas')).toBe(true);
    expect(tocaCocina(r, 'La Esperanza')).toBe(false);
  });

  it('el WhatsApp de un reparto lleva víveres, valor y estado', () => {
    const t = mensajeReparto(r);
    expect(t).toContain('🔹 *Traslado:* TRA-2026-0028');
    expect(t).toContain('📤 *De:* Los Pinos');
    expect(t).toContain('📥 *A:* Resguardo Matanzas');
    expect(t).toContain('📌 *Nota:* PARA MATANZA');
    expect(t).toContain('• ARROZ — 10 KILOGRAMO');
    expect(t).toContain('💵 *Valor:* $12,00');
    expect(t).toContain('📊 *Estado:* *Entregado*');
    expect(t).not.toContain('️');
    expect(valorReparto(r)).toBe(12);
  });

  it('el del histórico junta todos con su total', () => {
    const t = mensajeHistoricoRepartos([r, { ...r, codigo: 'TRA-2026-0030', nota: null }], { desde: '2026-11-01', hasta: '2026-11-05', cocina: 'Los Pinos' });
    expect(t).toContain('📅 *Del* 01/11/2026 *al* 05/11/2026');
    expect(t).toContain('1. 🔹 *TRA-2026-0028*');
    expect(t).toContain('💰 *Total (2 repartos):* *$24,00*');
    expect(mensajeHistoricoRepartos([], { desde: '2026-11-01', hasta: '2026-11-05' })).toContain('Sin repartos');
  });
});
