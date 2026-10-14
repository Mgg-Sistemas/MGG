import { describe, it, expect } from 'vitest';
import {
  alertasDocumentos, calcularRecibo, diasHasta, errorViajeRealizado, estadoChofer, estadoVence, liquidarViaticos, peorEstadoDocumentos,
  progresoParadas, textoConformidadViaje, textoLiquidacion, textoRuta,
  tipoViajeDe, cantidadViajes, tarifaTotalViaje, textoRutaViajes, totalViajes, horasDiaVolqueta, errorViajesVolqueta,
  nombreDeConductor, datosConductor,
} from './choferes';

const HOY = '2026-10-12';

describe('vigencia de documentos del chofer', () => {
  it('vigente, por vencer (≤ 30 días) y vencido', () => {
    expect(estadoVence('2027-01-01', HOY)).toBe('vigente');
    expect(estadoVence('2026-11-11', HOY)).toBe('por_vencer');
    expect(estadoVence('2026-10-12', HOY)).toBe('por_vencer'); // vence hoy: todavía vale, pero avisa
    expect(estadoVence('2026-10-11', HOY)).toBe('vencido');
    expect(estadoVence(null, HOY)).toBe('sin_dato');
    expect(diasHasta('2026-10-15', HOY)).toBe(3);
    expect(diasHasta('2026-10-10', HOY)).toBe(-2);
  });

  it('las alertas juntan solo lo vencido y lo por vencer; el peor estado manda', () => {
    const c = { licencia_vence: '2026-10-01', certificado_medico_vence: '2026-10-30', seguro_vence: '2027-05-01' };
    const a = alertasDocumentos(c, HOY);
    expect(a.map((x) => `${x.label}:${x.estado}`)).toEqual(['Licencia:vencido', 'Certificado médico:por_vencer']);
    expect(peorEstadoDocumentos(c, HOY)).toBe('vencido');
    expect(peorEstadoDocumentos({ licencia_vence: '2027-01-01' }, HOY)).toBe('sin_dato');
    expect(peorEstadoDocumentos({ licencia_vence: '2027-01-01', certificado_medico_vence: '2027-01-01', seguro_vence: '2027-01-01' }, HOY)).toBe('vigente');
  });
});

describe('estado del chofer hoy', () => {
  it('en ruta manda sobre descanso; inactivo manda sobre todo', () => {
    expect(estadoChofer({ activo: true, enRuta: false, deDescanso: false })).toBe('disponible');
    expect(estadoChofer({ activo: true, enRuta: false, deDescanso: true })).toBe('descanso');
    expect(estadoChofer({ activo: true, enRuta: true, deDescanso: true })).toBe('en_ruta');
    expect(estadoChofer({ activo: false, enRuta: true, deDescanso: false })).toBe('inactivo');
  });

  it('cuenta las paradas cumplidas', () => {
    expect(progresoParadas([{ lugar: 'A', hecha_at: '2026-10-12T10:00:00Z' }, { lugar: 'B' }])).toEqual({ hechas: 1, total: 2 });
    expect(progresoParadas(null)).toEqual({ hechas: 0, total: 0 });
  });
});

describe('liquidación de viáticos', () => {
  it('sobrante sin devolver → deducción; gasto de bolsillo → reembolso', () => {
    const sobra = liquidarViaticos([{ tipo: 'anticipo', monto_usd: 100 }, { tipo: 'gasto', monto_usd: 60.5 }, { tipo: 'gasto', monto_usd: 10 }]);
    expect(sobra).toEqual({ anticipos: 100, gastos: 70.5, devoluciones: 0, saldo: 29.5, reembolso: 0, deduccion: 29.5 });
    expect(textoLiquidacion(sobra)).toContain('sin justificar');

    const falta = liquidarViaticos([{ tipo: 'anticipo', monto_usd: 50 }, { tipo: 'gasto', monto_usd: 80 }]);
    expect(falta.saldo).toBe(-30);
    expect(falta.reembolso).toBe(30);
    expect(falta.deduccion).toBe(0);
    expect(textoLiquidacion(falta)).toContain('reembolsa');
  });

  it('con devolución en efectivo cuadra en cero', () => {
    const l = liquidarViaticos([{ tipo: 'anticipo', monto_usd: 100 }, { tipo: 'gasto', monto_usd: 70 }, { tipo: 'devolucion', monto_usd: 30 }]);
    expect(l.saldo).toBe(0);
    expect(textoLiquidacion(l)).toContain('cuadran');
  });
});

describe('recibo de viaje', () => {
  const lineas = [
    { viaje_id: 'a', numero: 'VJ-2026-0001', ruta: 'Los Pinos → Matanzas', fecha: '2026-10-05', tarifa_usd: 40, reembolso_usd: 12.5, deduccion_usd: 0 },
    { viaje_id: 'b', numero: 'VJ-2026-0002', ruta: 'Matanzas → Puerto Ordaz', fecha: '2026-10-08', tarifa_usd: 35, reembolso_usd: 0, deduccion_usd: 20 },
  ];

  it('suma tarifas, reembolsos y bonos; resta deducciones; convierte a Bs', () => {
    const c = calcularRecibo({ lineas, bonos_usd: 10, otras_deducciones_usd: 5, tasa: 189.55 });
    expect(c.tarifas_usd).toBe(75);
    expect(c.reembolsos_usd).toBe(12.5);
    expect(c.deducciones_usd).toBe(20);
    expect(c.devengado_usd).toBe(97.5);
    expect(c.total_deducciones_usd).toBe(25);
    expect(c.neto_usd).toBe(72.5);
    expect(c.neto_bs).toBe(13742.38);
  });

  it('el neto no baja de cero y sin tasa no hay Bs', () => {
    const c = calcularRecibo({ lineas: [{ ...lineas[1], tarifa_usd: 10, deduccion_usd: 50 }] });
    expect(c.neto_usd).toBe(0);
    expect(c.neto_bs).toBeNull();
  });

  it('la conformidad nombra el neto, la cantidad de viajes y al chofer', () => {
    const c = calcularRecibo({ lineas, tasa: 189.55 });
    const t = textoConformidadViaje(c, 2, 'FELIPE ALGUERA');
    expect(t).toContain('FELIPE ALGUERA');
    expect(t).toContain('$ 67,50');
    expect(t).toContain('2 viajes');
    expect(textoConformidadViaje(c, 1, 'X')).toContain('un (1) viaje');
    expect(textoRuta({ origen: ' Los Pinos ', destino: 'Matanzas' })).toBe('Los Pinos → Matanzas');
  });
});

describe('cargar un viaje ya realizado (viaje pasado)', () => {
  const ahora = '2026-10-12T15:00';
  it('acepta salida y llegada pasadas con km coherentes', () => {
    expect(errorViajeRealizado({ salida: '2026-10-05T06:30', llegada: '2026-10-05T18:10', kmSalida: 120500, kmLlegada: 120980, ahora })).toBeNull();
    expect(errorViajeRealizado({ salida: '2026-10-05T06:30', llegada: '2026-10-05T18:10', kmSalida: null, kmLlegada: null, ahora })).toBeNull();
  });
  it('exige la llegada y no la deja antes de la salida ni en el futuro', () => {
    expect(errorViajeRealizado({ salida: '2026-10-05T06:30', llegada: '', kmSalida: null, kmLlegada: null, ahora })).toMatch(/llegada/);
    expect(errorViajeRealizado({ salida: '2026-10-05T06:30', llegada: '2026-10-05T06:00', kmSalida: null, kmLlegada: null, ahora })).toMatch(/antes de la salida/);
    expect(errorViajeRealizado({ salida: '2026-10-12T06:30', llegada: '2026-10-12T19:00', kmSalida: null, kmLlegada: null, ahora })).toMatch(/futuro/);
    expect(errorViajeRealizado({ salida: '', llegada: '2026-10-05T18:10', kmSalida: null, kmLlegada: null, ahora })).toMatch(/salida/);
  });
  it('el kilometraje de llegada no baja del de salida', () => {
    expect(errorViajeRealizado({ salida: '2026-10-05T06:30', llegada: '2026-10-05T18:10', kmSalida: 1000, kmLlegada: 900, ahora })).toMatch(/kilometraje/i);
  });
});

describe('tipo de viaje y cantidad de viajes (volqueta)', () => {
  it('tipo y cantidad con valores raros', () => {
    expect(tipoViajeDe('volqueta')).toBe('volqueta');
    expect(tipoViajeDe(undefined)).toBe('camion');
    expect(cantidadViajes(25)).toBe(25);
    expect(cantidadViajes('3')).toBe(3);
    expect(cantidadViajes(null)).toBe(1);
    expect(cantidadViajes(0)).toBe(1);
    expect(cantidadViajes(2.6)).toBe(3);
  });
  it('la tarifa es por viaje: el total multiplica', () => {
    expect(tarifaTotalViaje({ tarifa_usd: 4, viajes: 25 })).toBe(100);
    expect(tarifaTotalViaje({ tarifa_usd: 12.5 })).toBe(12.5);
    expect(textoRutaViajes({ origen: 'Playa Escondida', destino: 'Interno', viajes: 25 })).toBe('Playa Escondida → Interno × 25 viajes');
    expect(textoRutaViajes({ origen: 'A', destino: 'B', viajes: 1 })).toBe('A → B');
    expect(totalViajes([{ viajes: 25 }, { viajes: 21 }, {}])).toBe(47);
  });
  it('el día de volqueta sale 06:00 y llega 18:00, o ahora si el día es hoy', () => {
    expect(horasDiaVolqueta('2026-10-06', '2026-10-14T09:00')).toEqual({ salida: '2026-10-06T06:00', llegada: '2026-10-06T18:00' });
    expect(horasDiaVolqueta('2026-10-14', '2026-10-14T09:00')).toEqual({ salida: '2026-10-14T06:00', llegada: '2026-10-14T09:00' });
    expect(horasDiaVolqueta('2026-10-14', '2026-10-14T05:00')).toEqual({ salida: '2026-10-14T06:00', llegada: '2026-10-14T06:00' });
  });
  it('valida viajes y material', () => {
    expect(errorViajesVolqueta(25, 'Escombros')).toBeNull();
    expect(errorViajesVolqueta(0, 'Escombros')).toMatch(/viajes/);
    expect(errorViajesVolqueta(2.5, 'Escombros')).toMatch(/entero/);
    expect(errorViajesVolqueta(3, '  ')).toMatch(/material/);
  });
});

describe('chofer externo (sin ficha de RRHH)', () => {
  it('nombre y datos salen de la ficha si la hay, o del expediente si es externo', () => {
    expect(nombreDeConductor({ personal: { nombre: 'JOSE', apellido: 'RONDON', cedula: '27514395' } })).toBe('JOSE RONDON');
    expect(nombreDeConductor({ externo: true, nombre: 'PEDRO', apellido: 'PEREZ' })).toBe('PEDRO PEREZ');
    expect(nombreDeConductor({ externo: true, nombre: '', apellido: null })).toBe('Chofer externo');
    expect(nombreDeConductor({ externo: false, personal: null })).toBe('(ficha eliminada)');
    expect(nombreDeConductor(null)).toBe('—');
    expect(datosConductor({ externo: true, cedula: '12345', telefono: '0414', empresa_externa: 'Transporte Mata' })).toEqual({ cedula: '12345', telefono: '0414', cargo: 'Chofer externo · Transporte Mata' });
    expect(datosConductor({ personal: { nombre: 'A', cedula: '9', cargo: 'CHOFER' } }).cargo).toBe('CHOFER');
    expect(datosConductor(undefined).cedula).toBeNull();
  });
});
