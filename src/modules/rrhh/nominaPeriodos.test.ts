import { describe, it, expect } from 'vitest';
import {
  MOTIVO_MINIMO, estaCerrada, estaEliminada, etiquetaSeleccion, filtrarFilasPersonal, marcarFilas,
  motivoEliminacionValido, motivoNoCargar, nominaAbierta, normalizarTexto, textoBuscablePersona,
} from './nominaPeriodos';

const per = (tipo: string, estado: string, eliminado_en: string | null = null, codigo = 'NOM-2026-0001', nombre: string | null = null) =>
  ({ tipo, estado, eliminado_en, codigo, nombre });

describe('cerrada y eliminada', () => {
  it('cerrada es solo «pagada»', () => {
    expect(estaCerrada({ estado: 'pagada' })).toBe(true);
    expect(estaCerrada({ estado: 'en_pago' })).toBe(false);
    expect(estaCerrada({ estado: 'cargada' })).toBe(false);
  });
  it('eliminada = tiene fecha de eliminación', () => {
    expect(estaEliminada({ eliminado_en: '2026-10-09T10:00:00Z' })).toBe(true);
    expect(estaEliminada({ eliminado_en: null })).toBe(false);
    expect(estaEliminada({})).toBe(false);
  });
});

describe('una sola quincena abierta', () => {
  it('encuentra la quincena sin pagar completa', () => {
    const abierta = per('quincena', 'en_pago', null, 'NOM-2026-0002');
    expect(nominaAbierta([per('quincena', 'pagada'), abierta])).toBe(abierta);
  });
  it('una cargada sin pagos también está abierta', () => {
    expect(nominaAbierta([per('quincena', 'cargada')])).not.toBeNull();
  });
  it('vacaciones y liquidaciones no cuentan', () => {
    expect(nominaAbierta([per('vacaciones', 'cargada'), per('liquidacion', 'en_pago')])).toBeNull();
  });
  it('la que está en la papelera no cuenta', () => {
    expect(nominaAbierta([per('quincena', 'cargada', '2026-10-09T10:00:00Z')])).toBeNull();
  });
  it('todas pagadas = se puede cargar otra', () => {
    expect(nominaAbierta([per('quincena', 'pagada'), per('quincena', 'pagada')])).toBeNull();
    expect(nominaAbierta([])).toBeNull();
  });
  it('el aviso nombra la nómina abierta y cuántos faltan', () => {
    const m = motivoNoCargar({ codigo: 'NOM-2026-0003', nombre: 'Primera quincena de octubre 2026', pendientes: 4 });
    expect(m).toContain('Primera quincena de octubre 2026');
    expect(m).toContain('NOM-2026-0003');
    expect(m).toContain('Faltan 4 por pagar');
    expect(motivoNoCargar(null)).toBeNull();
  });
  it('sin nombre, el aviso usa el código', () => {
    expect(motivoNoCargar({ codigo: 'NOM-2026-0003', nombre: '  ' })).toContain('«NOM-2026-0003»');
  });
});

describe('motivo de eliminación', () => {
  it(`pide al menos ${MOTIVO_MINIMO} caracteres reales`, () => {
    expect(motivoEliminacionValido('ok')).toBe(false);
    expect(motivoEliminacionValido('   a   ')).toBe(false);
    expect(motivoEliminacionValido('mal cargada')).toBe(true);
    expect(motivoEliminacionValido(null)).toBe(false);
    expect(motivoEliminacionValido(undefined)).toBe(false);
  });
});

describe('buscar personal sin acentos', () => {
  const filas = [
    { persona: { id: '1', nombre: 'María José', apellido: 'Pérez', cedula: 'V-12.345.678', cargo: 'Cocinera', departamento: 'Cocina' }, incluido: true },
    { persona: { id: '2', nombre: 'Jesús', apellido: 'Lozada', cedula: 'V-9.876.543', cargo: 'Supervisor', departamento: 'Fundición', numero_ficha: 'A01' }, incluido: true },
    { persona: { id: '3', nombre: 'Ana', apellido: 'Gil', cedula: null, cargo: null, departamento: 'Cocina' }, incluido: false },
  ];

  it('normaliza: minúsculas y sin tildes', () => {
    expect(normalizarTexto('  Pérez FUNDICIÓN ')).toBe('perez fundicion');
    expect(textoBuscablePersona(filas[1].persona)).toContain('jesus lozada');
  });
  it('vacío devuelve todo', () => {
    expect(filtrarFilasPersonal(filas, '')).toHaveLength(3);
    expect(filtrarFilasPersonal(filas, '   ')).toHaveLength(3);
  });
  it('busca por nombre sin importar acentos ni mayúsculas', () => {
    expect(filtrarFilasPersonal(filas, 'PEREZ').map((f) => f.persona.id)).toEqual(['1']);
    expect(filtrarFilasPersonal(filas, 'jesús').map((f) => f.persona.id)).toEqual(['2']);
  });
  it('busca por cédula, cargo, departamento y ficha', () => {
    expect(filtrarFilasPersonal(filas, '9.876').map((f) => f.persona.id)).toEqual(['2']);
    expect(filtrarFilasPersonal(filas, 'cocinera').map((f) => f.persona.id)).toEqual(['1']);
    expect(filtrarFilasPersonal(filas, 'cocina').map((f) => f.persona.id)).toEqual(['1', '3']);
    expect(filtrarFilasPersonal(filas, 'a01').map((f) => f.persona.id)).toEqual(['2']);
  });
  it('varias palabras: todas tienen que estar', () => {
    expect(filtrarFilasPersonal(filas, 'ana cocina').map((f) => f.persona.id)).toEqual(['3']);
    expect(filtrarFilasPersonal(filas, 'ana fundicion')).toHaveLength(0);
  });
});

describe('seleccionar / desmarcar sobre lo filtrado', () => {
  const filas = [
    { persona: { id: '1' }, incluido: false },
    { persona: { id: '2' }, incluido: true },
    { persona: { id: '3' }, incluido: false },
  ];
  it('marca solo los ids dados y deja el resto como estaba', () => {
    const out = marcarFilas(filas, ['1'], true);
    expect(out.map((f) => f.incluido)).toEqual([true, true, false]);
  });
  it('desmarca solo los ids dados', () => {
    const out = marcarFilas(filas, new Set(['2', '3']), false);
    expect(out.map((f) => f.incluido)).toEqual([false, false, false]);
  });
  it('no crea objetos nuevos si nada cambia', () => {
    const out = marcarFilas(filas, ['2'], true);
    expect(out[1]).toBe(filas[1]);
  });
  it('etiqueta del botón según haya filtro', () => {
    expect(etiquetaSeleccion('Seleccionar', 5, 5)).toBe('Seleccionar todos');
    expect(etiquetaSeleccion('Desmarcar', 2, 5)).toBe('Desmarcar los 2 visibles');
  });
});
