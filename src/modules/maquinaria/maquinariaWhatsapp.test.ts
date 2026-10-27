import { describe, it, expect } from 'vitest';
import {
  textoServicioWhatsapp,
  textoLavadoWhatsapp,
  textoAveriaEstadoWhatsapp,
  textoCompraRepuestosWhatsapp,
  textoFichaFiltrosWhatsapp,
  textoEstadoEquipoWhatsapp,
} from './maquinariaWhatsapp';

describe('maquinariaWhatsapp', () => {
  it('textoServicioWhatsapp arma reporte de servicio correctamente', () => {
    const txt = textoServicioWhatsapp({
      codigo: 'OS-2026-0045',
      equipo: 'EXC-01',
      tipoEquipo: 'EXCAVADORA',
      marca: 'CATERPILLAR',
      modelo: '320D',
      tipoServicio: 'preventivo',
      urgencia: 'urgente',
      horasActuales: 4520,
      responsable: 'Carlos Pérez',
      solicitante: 'Taller Central',
      descripcion: 'Mantenimiento preventivo de 250 horas',
      repuestos: [
        { nombre: 'FILTRO DE ACEITE', cantidad: 1, unidad: 'und', a_comprar: 0 },
        { nombre: 'ACEITE 15W40', cantidad: 20, unidad: 'L', a_comprar: 5 },
      ],
      fecha: '2026-10-26T10:30:00Z',
    });

    expect(txt).toContain('MINERAL GROUP GUAYANA C.A.');
    expect(txt).toContain('SOLICITUD DE SERVICIO URGENTE');
    expect(txt).toContain('*Código:* OS-2026-0045');
    expect(txt).toContain('EXC-01');
    expect(txt).toContain('EXCAVADORA · CATERPILLAR · 320D');
    expect(txt).toContain('PREVENTIVO');
    expect(txt).toContain('4.520 h');
    expect(txt).toContain('Carlos Pérez');
    expect(txt).toContain('FILTRO DE ACEITE: *1 und*');
    expect(txt).toContain('ACEITE 15W40: *20 L* (🛒 Comprar: 5)');
    expect(txt).not.toContain('\uFE0F');
  });

  it('textoLavadoWhatsapp formatea reporte de lavado', () => {
    const txt = textoLavadoWhatsapp({
      equipo: 'CAM-05',
      tipoEquipo: 'CAMIÓN VOLTEO',
      tipoLavado: 'completo',
      lavador: 'José Gómez',
      responsable: 'Pedro Rivas',
      horasEquipo: 1200,
      notas: 'Lavado a presión con desengrasante en chasis',
      fecha: '2026-10-26T14:00:00Z',
    });

    expect(txt).toContain('REPORTE DE LAVADO DE EQUIPO');
    expect(txt).toContain('CAM-05');
    expect(txt).toContain('COMPLETO');
    expect(txt).toContain('José Gómez');
    expect(txt).toContain('Pedro Rivas');
    expect(txt).toContain('*Observaciones:* Lavado a presión');
    expect(txt).not.toContain('\uFE0F');
  });

  it('textoAveriaEstadoWhatsapp genera reporte de avería / parada', () => {
    const txt = textoAveriaEstadoWhatsapp({
      equipo: 'JUMBO-02',
      tipoEquipo: 'JUMBO',
      estadoNuevo: 'averiada',
      estadoAnterior: 'operativa',
      motivo: 'Fuga de aceite hidráulico en manguera de bomba principal',
      responsable: 'Mecánico de Guardia',
      horasActuales: 3400,
      ubicacion: 'Frente Mina 3',
      fecha: '2026-10-26T12:00:00Z',
    });

    expect(txt).toContain('REPORTE DE AVERÍA / PARADA');
    expect(txt).toContain('JUMBO-02');
    expect(txt).toContain('*AVERIADA*');
    expect(txt).toContain('OPERATIVA');
    expect(txt).toContain('Fuga de aceite hidráulico');
    expect(txt).toContain('Frente Mina 3');
    expect(txt).not.toContain('\uFE0F');
  });

  it('textoCompraRepuestosWhatsapp genera solicitud para compras', () => {
    const txt = textoCompraRepuestosWhatsapp({
      ordenServicio: 'OS-0089',
      equipo: 'RETRO-03',
      piezas: [
        { nombre: 'FILTRO COMBUSTIBLE PRIMARIO', cantidad: 2, unidad: 'und' },
        { nombre: 'CORREA ALTERNADOR', cantidad: 1, unidad: 'und' },
      ],
      solicitante: 'Juan Silva',
      fecha: '2026-10-26T13:00:00Z',
    });

    expect(txt).toContain('SOLICITUD DE COMPRA DE REPUESTOS');
    expect(txt).toContain('OS-0089');
    expect(txt).toContain('RETRO-03');
    expect(txt).toContain('FILTRO COMBUSTIBLE PRIMARIO: *2 und*');
    expect(txt).not.toContain('\uFE0F');
  });

  it('textoFichaFiltrosWhatsapp muestra marcas y números de parte', () => {
    const txt = textoFichaFiltrosWhatsapp({
      equipo: 'EXC-01',
      tipo: 'EXCAVADORA',
      marca: 'CATERPILLAR',
      modelo: '320D',
      motor: 'CAT C6.4',
      horasActuales: 4500,
      filtros: [
        {
          sistema: 'motor',
          tipo: 'Filtro de aceite',
          numeroParte: '1R-0716',
          equivalencias: ['DONALDSON P553771', 'FLEETGUARD LF3413'],
          especificacion: '15W-40',
        },
        {
          sistema: 'combustible',
          tipo: 'Filtro de combustible',
          numeroParte: '1R-0751',
          equivalencias: ['FLEETGUARD FF5320'],
          especificacion: '2 micras',
        },
      ],
    });

    expect(txt).toContain('FICHA DE FILTROS Y ESPECIFICACIONES');
    expect(txt).toContain('EXC-01');
    expect(txt).toContain('CAT C6.4');
    expect(txt).toContain('Filtro de aceite:* OEM: 1R-0716 (Marcas: DONALDSON P553771 · FLEETGUARD LF3413) [15W-40]');
    expect(txt).toContain('Filtro de combustible:* OEM: 1R-0751 (Marcas: FLEETGUARD FF5320)');
    expect(txt).not.toContain('\uFE0F');
  });

  it('textoEstadoEquipoWhatsapp arma reporte de estado y horas de mantenimiento', () => {
    const txt = textoEstadoEquipoWhatsapp({
      equipo: 'CAMIÓN DE SERVICIO FK617',
      tipo: 'CAMIÓN',
      marca: 'MITSUBISHI',
      modelo: 'FK617',
      estado: 'operativa',
      encargado: 'Juan Pérez',
      horometro: 1250,
      horasFaltantes: 45,
      nivelAviso: 'ok',
      unidadAviso: 'h',
    });

    expect(txt).toContain('ESTADO DE MÁQUINA / VEHÍCULO');
    expect(txt).toContain('CAMIÓN DE SERVICIO FK617');
    expect(txt).toContain('Juan Pérez');
    expect(txt).toContain('1.250 h');
    expect(txt).toContain('Faltan para mantenimiento:* 45 h');
    expect(txt).not.toContain('\uFE0F');
  });
});
