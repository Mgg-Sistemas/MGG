import { describe, it, expect } from 'vitest';
import { queHizo, queHizoCorto, tieneDetalle } from './auditoria.repository';

/** Renglones reales del feed, tal como los arma la base. */
const MOVIMIENTO = { detalle: 'salida · SALCHICHAS DE POLLO · CAR-010 · CONTEO REAL DE STOCK · Los Pinos' };
const SOLICITUD = { detalle: 'SAL-2026-0157 · BIGBAG MODORO · SE LE ENTREGARON AL SR. PALMA' };
const MUDO = { detalle: null };

describe('auditoría · la columna «Qué»', () => {
  it('muestra el producto y el motivo, no solo la acción', () => {
    expect(queHizo(MOVIMIENTO)).toContain('SALCHICHAS DE POLLO');
    expect(queHizo(MOVIMIENTO)).toContain('CONTEO REAL DE STOCK');
  });

  it('un registro sin detalle lo dice, en vez de quedar en blanco', () => {
    expect(tieneDetalle(MUDO)).toBe(false);
    expect(queHizo(MUDO)).toBe('sin detalle registrado');
  });

  it('un detalle en blanco cuenta como sin detalle', () => {
    expect(tieneDetalle({ detalle: '   ' })).toBe(false);
    expect(queHizo({ detalle: '   ' })).toBe('sin detalle registrado');
  });

  it('recorta lo largo para la tabla, sin cortar lo corto', () => {
    expect(queHizoCorto(SOLICITUD, 70)).toBe(queHizo(SOLICITUD));
    const corto = queHizoCorto(MOVIMIENTO, 30);
    expect(corto.length).toBeLessThanOrEqual(30);
    expect(corto.endsWith('…')).toBe(true);
    expect(corto.startsWith('salida · SALCHICHAS')).toBe(true);
  });

  it('el recorte no deja un espacio colgando antes de los puntos', () => {
    expect(queHizoCorto({ detalle: 'entrada · POLLO FRESCO' }, 11)).toBe('entrada ·…');
  });
});
