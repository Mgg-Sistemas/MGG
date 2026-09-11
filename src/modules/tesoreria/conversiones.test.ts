import { describe, it, expect } from 'vitest';
import {
  filtrar, coincide, tasaDe, parDe, diaDe, monedasDe, actoresDe,
  FILTRO_CONVERSIONES_VACIO, type Conversion,
} from './conversiones';
import { fechaAsiento } from './cajaSaldos.repository';

const c = (over: Partial<Conversion>): Conversion => ({
  id: 'x', at: '2026-09-11T13:23:10.000Z', actor: 'susej@mgg.com', actorName: 'SUSEJ',
  deMoneda: 'USDT', deMonto: 2000, deCajaId: 'multi',
  aMoneda: 'Bs', aMonto: 1918380, aCajaId: 'bs',
  motivo: 'Conversión 2000 USDT → 1918380 Bs', ...over,
});

const CAJAS: Record<string, string> = { multi: 'CAJA MULTIMONEDA', bs: 'CAJA BS POZ' };
const nombreCaja = (id: string) => CAJAS[id] ?? '';

const LISTA = [
  c({ id: '1', at: '2026-09-11T13:23:10.000Z' }),
  c({ id: '2', at: '2026-09-07T14:13:17.000Z', deMonto: 1500, aMonto: 1441442.34, actor: 'leniska@mgg.com', actorName: 'LENISKA' }),
  c({ id: '3', at: '2026-08-24T23:53:04.000Z', deMoneda: 'Bs', deMonto: 950000, aMoneda: 'USDT', aMonto: 1000, deCajaId: 'bs', aCajaId: 'multi' }),
];

describe('el historial de conversiones', () => {
  it('la tasa sale de los montos reales, no de la que se tipeó', () => {
    // 1.918.380 ÷ 2.000 = 959,19 Bs por USDT.
    expect(tasaDe(c({}))).toBeCloseTo(959.19, 2);
  });

  it('una conversión sin monto de origen no inventa una tasa', () => {
    expect(tasaDe(c({ deMonto: 0 }))).toBeNull();
  });

  it('el par de monedas se lee de un vistazo', () => {
    expect(parDe(c({}))).toBe('USDT → Bs');
  });

  it('el día del asiento es el de la fecha, no el de hoy', () => {
    expect(diaDe(c({ at: '2026-08-24T23:53:04.000Z' }))).toBe('2026-08-24');
  });

  it('sin filtros salen todas, de la más nueva a la más vieja', () => {
    expect(filtrar(LISTA, FILTRO_CONVERSIONES_VACIO).map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('filtrar por moneda trae las dos direcciones', () => {
    // Bs aparece como destino en 1 y 2, y como origen en 3: las tres.
    const r = filtrar(LISTA, { ...FILTRO_CONVERSIONES_VACIO, moneda: 'Bs' });
    expect(r.map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('filtrar por quién lo hizo', () => {
    const r = filtrar(LISTA, { ...FILTRO_CONVERSIONES_VACIO, actor: 'leniska@mgg.com' });
    expect(r.map((x) => x.id)).toEqual(['2']);
  });

  it('el rango de fechas incluye los extremos', () => {
    const r = filtrar(LISTA, { ...FILTRO_CONVERSIONES_VACIO, desde: '2026-09-07', hasta: '2026-09-11' });
    expect(r.map((x) => x.id)).toEqual(['1', '2']);
  });

  it('el texto busca también por el nombre de la caja', () => {
    const r = filtrar(LISTA, { ...FILTRO_CONVERSIONES_VACIO, texto: 'poz' }, nombreCaja);
    expect(r.map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('el texto busca por quién', () => {
    expect(coincide(LISTA[1], { ...FILTRO_CONVERSIONES_VACIO, texto: 'leniska' }, nombreCaja)).toBe(true);
    expect(coincide(LISTA[0], { ...FILTRO_CONVERSIONES_VACIO, texto: 'leniska' }, nombreCaja)).toBe(false);
  });

  it('los desplegables se arman con lo que hay, sin opciones vacías', () => {
    expect(monedasDe(LISTA)).toEqual(['Bs', 'USDT']);
    expect(actoresDe(LISTA)).toEqual([
      { actor: 'leniska@mgg.com', nombre: 'LENISKA' },
      { actor: 'susej@mgg.com', nombre: 'SUSEJ' },
    ]);
  });
});

describe('la fecha que se le sella al asiento', () => {
  const HOY = new Date(2026, 8, 11); // 11-09-2026 local

  it('si es de hoy, la base pone la hora real', () => {
    expect(fechaAsiento('2026-09-11', HOY)).toBeNull();
  });

  it('un día vacío o ilegible tampoco fuerza fecha', () => {
    expect(fechaAsiento('', HOY)).toBeNull();
    expect(fechaAsiento(null, HOY)).toBeNull();
    expect(fechaAsiento('11/09/2026', HOY)).toBeNull();
  });

  it('un día anterior se ancla al mediodía, para no caerse de día por el huso', () => {
    const iso = fechaAsiento('2026-08-24', HOY);
    expect(iso).not.toBeNull();
    // Leído de vuelta en hora local tiene que seguir siendo el 24.
    const d = new Date(iso as string);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(24);
    expect(d.getHours()).toBe(12);
  });
});
