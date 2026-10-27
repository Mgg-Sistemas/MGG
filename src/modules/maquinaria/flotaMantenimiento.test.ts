import { describe, it, expect } from 'vitest';
import { grupoPorTipo, grupoDeEquipo, infoServicio, compararUrgencia, resumenServicio, REGLA_PROXIMO } from './flotaMantenimiento';

const intervalos = (h: number | null, baseH: number | null, km: number | null = null, baseKm: number | null = null) => ({
  mantenimiento_cada_hrs: h, mantenimiento_base_hrs: baseH, mantenimiento_cada_km: km, mantenimiento_base_km: baseKm,
});

describe('grupos de flota', () => {
  it('se deducen del tipo', () => {
    expect(grupoPorTipo('PLANTA ELÉCTRICA 500 KVA')).toBe('PLANTAS ELÉCTRICAS');
    expect(grupoPorTipo('Camión volteo')).toBe('VEHÍCULOS DE CARGA');
    expect(grupoPorTipo('EXCAVADORA')).toBe('FLOTA PESADA');
    expect(grupoPorTipo(null)).toBe('FLOTA PESADA');
  });
  it('el asignado en la ficha manda; uno desconocido cae al deducido', () => {
    expect(grupoDeEquipo({ grupo_mantenimiento: 'PLANTAS ELÉCTRICAS', tipo: 'EXCAVADORA' })).toBe('PLANTAS ELÉCTRICAS');
    expect(grupoDeEquipo({ grupo_mantenimiento: 'OTRO GRUPO', tipo: 'CAMIÓN' })).toBe('VEHÍCULOS DE CARGA');
  });
});

describe('estado del servicio (misma regla que el catálogo)', () => {
  it('vencido, próximo (≤ 10 %), al día y sin datos', () => {
    expect(infoServicio(intervalos(250, 1000), 1260, null).estado).toBe('vencido');
    expect(infoServicio(intervalos(250, 1000), 1230, null).estado).toBe('proximo');
    expect(infoServicio(intervalos(250, 1000), 1100, null).estado).toBe('al_dia');
    expect(infoServicio(intervalos(null, null), 1100, null).estado).toBe('sin_datos');
    expect(infoServicio(intervalos(250, 1000), null, null).estado).toBe('sin_datos');
  });
  it('usa la base del último mantenimiento (no el múltiplo) cuando existe', () => {
    // Con base 1100: faltan 250 − (1240 − 1100) = 110 h → al día (sin base serían 10 h → próximo).
    expect(infoServicio(intervalos(250, 1100), 1240, null).estado).toBe('al_dia');
    expect(infoServicio(intervalos(250, null), 1240, null).estado).toBe('proximo');
  });
  it('el km también cuenta: gana el más urgente', () => {
    const i = infoServicio(intervalos(250, 1000, 5000, 10000), 1100, 15100);
    expect(i.estado).toBe('vencido');
    expect(i.aviso?.unidad).toBe('km');
    expect(i.avisoH?.nivel).toBe('ok');
  });
  it('el texto de la regla dice 10 %, no 250 h', () => {
    expect(REGLA_PROXIMO).toBe('≤ 10 % del intervalo');
  });
});

describe('orden por urgencia y resumen', () => {
  const it2 = (nombre: string, lectura: number | null, activo = true) => ({ nombre, activo, info: infoServicio(intervalos(250, 1000), lectura, null) });
  const lista = [it2('AL DIA', 1050), it2('SIN DATOS', null), it2('VENCIDO POCO', 1260), it2('PROXIMO', 1240), it2('VENCIDO MUCHO', 1400), it2('INACTIVO VENCIDO', 1500, false)];
  it('vencidos (más pasados primero), próximos, al día, sin datos; inactivos al final', () => {
    expect([...lista].sort(compararUrgencia).map((x) => x.nombre))
      .toEqual(['VENCIDO MUCHO', 'VENCIDO POCO', 'PROXIMO', 'AL DIA', 'SIN DATOS', 'INACTIVO VENCIDO']);
  });
  it('el resumen cuenta solo los activos', () => {
    expect(resumenServicio(lista)).toEqual({ vencido: 2, proximo: 1, al_dia: 1, sin_datos: 1, total: 5 });
  });
});
