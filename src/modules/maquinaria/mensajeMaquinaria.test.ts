import { describe, it, expect } from 'vitest';
import {
  mensajeSolicitudServicio,
  mensajeRegistroLavado,
  mensajeReporteAveria,
  mensajeLecturaHorometro,
  mensajeEstadoEquipo,
  enlaceWhatsappMaquinaria,
} from './mensajeMaquinaria';

describe('mensajeMaquinaria', () => {
  it('enlaceWhatsappMaquinaria va derecho a api.whatsapp.com con el texto codificado (nunca wa.me)', () => {
    const url = enlaceWhatsappMaquinaria('🚜 Prueba con emojis');
    expect(url.startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
    expect(url).toContain(encodeURIComponent('🚜 Prueba con emojis'));
  });

  it('mensajeSolicitudServicio formatea la orden, equipo y repuestos pedidos', () => {
    const txt = mensajeSolicitudServicio({
      codigo: 'OS-001',
      tipo: 'preventivo',
      urgencia: 'urgente',
      equipoNombre: 'CAT 320D',
      placaOSerial: 'CAT-320-01',
      horometro: 5420,
      repuestos: [
        { nombre: 'FILTRO DE ACEITE', cantidad: 1 },
        { nombre: 'ACEITE 15W40', cantidad: 20 },
      ],
      nota: 'Cambio de 250 horas',
      solicitante: 'Carlos Pérez',
    });
    expect(txt).toContain('SOLICITUD DE SERVICIO / MANTENIMIENTO');
    expect(txt).toContain('CAT 320D');
    expect(txt).toContain('OS-001');
    expect(txt).toContain('5.420');
    expect(txt).toContain('FILTRO DE ACEITE');
    expect(txt).toContain('ACEITE 15W40');
    expect(txt).toContain('Carlos Pérez');
  });

  it('mensajeRegistroLavado formatea el lavado del equipo', () => {
    const txt = mensajeRegistroLavado({
      equipoNombre: 'TOYOTA HILUX',
      placa: 'A12BC3D',
      tipoLavado: 'Completo con chasis',
      responsable: 'José Gómez',
      nota: 'Lavado antes de subir a mina',
    });
    expect(txt).toContain('REGISTRO DE LAVADO');
    expect(txt).toContain('TOYOTA HILUX');
    expect(txt).toContain('A12BC3D');
    expect(txt).toContain('Completo con chasis');
    expect(txt).toContain('José Gómez');
  });

  it('mensajeReporteAveria formatea la falla de la máquina', () => {
    const txt = mensajeReporteAveria({
      equipoNombre: 'CAMIÓN VOLTEO MACK',
      placaOSerial: 'VOL-03',
      horometro: 12500,
      kilometraje: 45200,
      ubicacion: 'Frente Mina Casiterita',
      falla: 'Bote de aceite hidráulico en manguera principal',
      reportadoPor: 'Pedro Martínez',
    });
    expect(txt).toContain('REPORTE DE MAQUINARIA AVERIADA');
    expect(txt).toContain('CAMIÓN VOLTEO MACK');
    expect(txt).toContain('Bote de aceite hidráulico');
    expect(txt).toContain('Frente Mina Casiterita');
    expect(txt).toContain('Pedro Martínez');
  });

  it('mensajeLecturaHorometro formatea la lectura registrada', () => {
    const txt = mensajeLecturaHorometro({
      equipoNombre: 'JUMBO 320',
      horometro: 3450.5,
      kilometraje: null,
      registradoPor: 'Kelvin Peña',
      nota: 'Lectura de fin de turno',
    });
    expect(txt).toContain('LECTURA DE HORÓMETRO / KM');
    expect(txt).toContain('JUMBO 320');
    expect(txt).toContain('3.450,5');
    expect(txt).toContain('Kelvin Peña');
  });

  it('mensajeEstadoEquipo formatea horas que faltan, horómetro y estado del equipo', () => {
    const txt = mensajeEstadoEquipo({
      equipoNombre: 'TRACTOR D6T',
      tipo: 'FLOTA PESADA',
      marca: 'CATERPILLAR',
      modelo: 'D6T XL',
      placaOSerial: 'D6T-01',
      responsable: 'Carlos Mendoza',
      statusLabel: 'Operativa',
      horometro: 1250,
      horasRestantes: 45,
      proximoServicioHoras: 1300,
      kilometraje: null,
      kmRestantes: null,
    });
    expect(txt).toContain('FICHA Y ESTADO DE MAQUINARIA');
    expect(txt).toContain('TRACTOR D6T');
    expect(txt).toContain('Carlos Mendoza');
    expect(txt).toContain('1.250');
    expect(txt).toContain('Horas que faltan para servicio:* 45 hrs');
    expect(txt).toContain('1.300');
  });
});

