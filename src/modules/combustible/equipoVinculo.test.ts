import { describe, it, expect } from 'vitest';
import { claveEquipo, enAlertaServicio, estadoServicio, parecido, ultimoServicioHrs, vinculosRotos, UMBRAL_ALERTA_HRS } from './equipoVinculo';

// Nombres reales de producción: los vehículos se renombraron en Combustible (venían de
// Golden Touch con prefijo «GT»/«MGG») y Maquinaria se quedó con el nombre viejo.
const VEHICULOS = [
  'PITMAN ASTRA', 'IVECO TRAKKER 420', 'ENCAVA ET8', 'GEP 150 - PLANTA ELECTRICA',
  'MONTACARGA HELI H200 S35', 'YAMAGRO PRO LOS PINOS', 'CAMIÓN NHR', 'ENCAVA EP02',
];

describe('claveEquipo', () => {
  it('ignora acentos, mayúsculas y espacios de más', () => {
    expect(claveEquipo('Camión NHR')).toBe('CAMION NHR');
    expect(claveEquipo('  CAMION   NHR ')).toBe('CAMION NHR');
    expect(claveEquipo('camion nhr')).toBe(claveEquipo('CAMIÓN NHR'));
    expect(claveEquipo(null)).toBe('');
  });
});

describe('parecido', () => {
  it('reconoce el mismo equipo aunque cambie el prefijo', () => {
    expect(parecido('GT Camión Pitman Astra', 'PITMAN ASTRA')).toBe(1);
    expect(parecido('GANDOLA IVECO TRAKKER 420', 'IVECO TRAKKER 420')).toBe(1);
    expect(parecido('ENCAVA ET8 A94EE8P', 'ENCAVA ET8')).toBe(1);
  });

  it('no confunde equipos distintos', () => {
    expect(parecido('PITMAN ASTRA', 'MONTACARGA HELI H200 S35')).toBe(0);
    expect(parecido('ENCAVA EP02', 'IVECO TRAKKER 420')).toBe(0);
  });
});

describe('vinculosRotos', () => {
  const equipos = [
    { id: '1', equipo: 'PITMAN ASTRA', combustible_equipo: 'GT Camión Pitman Astra' },   // apunta a uno que ya no existe
    { id: '2', equipo: 'MONTACARGA HELI', combustible_equipo: null },                     // nunca se vinculó
    { id: '3', equipo: 'ENCAVA EP02', combustible_equipo: 'ENCAVA EP02' },                // sano
    { id: '4', equipo: 'CAMION NHR', combustible_equipo: 'camión  nhr' },                 // sano salvo formato
    { id: '5', equipo: 'GRÚA VIEJA', combustible_equipo: null, activo: false },           // inactivo: no molesta
  ];

  it('detecta solo los rotos y sugiere a qué vehículo se parecen', () => {
    const rotos = vinculosRotos(equipos, VEHICULOS);
    expect(rotos.map((r) => r.equipo.id)).toEqual(['1', '2']);
    expect(rotos[0].motivo).toBe('no_existe');
    expect(rotos[0].candidatos[0]).toBe('PITMAN ASTRA');
    expect(rotos[1].motivo).toBe('sin_vincular');
    expect(rotos[1].candidatos[0]).toBe('MONTACARGA HELI H200 S35');
  });

  it('un nombre que solo difiere en acentos o espacios NO está roto', () => {
    const rotos = vinculosRotos(equipos, VEHICULOS);
    expect(rotos.some((r) => r.equipo.id === '4')).toBe(false);
  });

  it('sin candidatos parecidos, la lista queda vacía pero el equipo se reporta igual', () => {
    const rotos = vinculosRotos([{ id: '9', equipo: 'COSA RARA', combustible_equipo: null }], VEHICULOS);
    expect(rotos).toHaveLength(1);
    expect(rotos[0].candidatos).toEqual([]);
  });

  it('sin lista de vehículos no acusa a nadie (la consulta pudo fallar)', () => {
    expect(vinculosRotos(equipos, [])).toEqual([]);
  });
});

describe('ultimoServicioHrs', () => {
  it('toma el servicio más reciente entre aceite y filtros', () => {
    expect(ultimoServicioHrs({ aceite: 1000, filtro: 1180 })).toBe(1180);
    expect(ultimoServicioHrs({ aceite: 1200, filtro: null })).toBe(1200);
    expect(ultimoServicioHrs({ aceite: null, filtro: 900 })).toBe(900);
  });

  it('sin ningún servicio registrado no hay referencia', () => {
    expect(ultimoServicioHrs({ aceite: null, filtro: null })).toBeNull();
    expect(ultimoServicioHrs(null)).toBeNull();
  });
});

describe('estadoServicio', () => {
  it('cuenta desde el último servicio registrado', () => {
    // Servicio hecho a las 1.000 h, frecuencia 250 → el próximo a las 1.250.
    expect(estadoServicio(250, 1100, 1000)).toEqual({ restantes: 150, desdeUltimo: 100, vencido: false, sinReferencia: false });
    expect(estadoServicio(250, 1240, 1000)).toEqual({ restantes: 10, desdeUltimo: 240, vencido: false, sinReferencia: false });
  });

  it('el servicio pasado queda VENCIDO, no vuelve a empezar la cuenta', () => {
    // Este es el bug que se corrige: con `frecuencia − (horómetro mod frecuencia)`,
    // 1.260 h sobre un servicio de 1.000 daba «faltan 240» y apagaba la alerta.
    const e = estadoServicio(250, 1260, 1000);
    expect(e).toEqual({ restantes: -10, desdeUltimo: 260, vencido: true, sinReferencia: false });
    expect(enAlertaServicio(e)).toBe(true);
  });

  it('sin servicio registrado NO se inventa un vencimiento', () => {
    // Estimar desde el horómetro absoluto declaraba «vencido hace 12.900 h» a una
    // máquina de 13.150 h que quizá se acaba de atender: ruido, no información.
    const e = estadoServicio(250, 13150, null);
    expect(e).toEqual({ restantes: null, desdeUltimo: null, vencido: false, sinReferencia: true });
    expect(enAlertaServicio(e)).toBe(false);
  });

  it('sin frecuencia o sin horómetro no se puede decir nada', () => {
    expect(estadoServicio(null, 100, 50)).toBeNull();
    expect(estadoServicio(250, null, 50)).toBeNull();
    expect(estadoServicio(0, 100, 50)).toBeNull();
  });
});

describe('enAlertaServicio', () => {
  const base = { desdeUltimo: 0, sinReferencia: false };
  it('avisa dentro del umbral y cuando ya venció', () => {
    expect(enAlertaServicio({ ...base, restantes: UMBRAL_ALERTA_HRS, vencido: false })).toBe(true);
    expect(enAlertaServicio({ ...base, restantes: UMBRAL_ALERTA_HRS + 1, vencido: false })).toBe(false);
    expect(enAlertaServicio({ ...base, restantes: -300, vencido: true })).toBe(true);
    expect(enAlertaServicio(null)).toBe(false);
  });

  it('sin referencia no avisa nada', () => {
    expect(enAlertaServicio({ restantes: null, desdeUltimo: null, vencido: false, sinReferencia: true })).toBe(false);
  });
});
