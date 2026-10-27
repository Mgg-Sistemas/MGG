import { describe, it, expect } from 'vitest';
import {
  textoServicioWhatsapp,
  textoLavadoWhatsapp,
  textoAveriaEstadoWhatsapp,
  textoCompraRepuestosWhatsapp,
  textoFichaFiltrosWhatsapp,
  textoEstadoEquipoWhatsapp,
  textoAlertaMantenimientoWhatsapp,
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

  describe('textoAlertaMantenimientoWhatsapp', () => {
    const base = {
      equipo: 'EXCAVADORA VOLVO EC240',
      placa: 'A12BC3D',
      unidad: 'h' as const,
      lectura: 4305,
      frecuencia: 250,
      mensaje: 'se programa para el viernes con el mec\u00E1nico; faltan filtros',
      responsable: 'Angelica Solis',
      fecha: '26/10/2026',
    };

    it('vencido: primera l\u00EDnea RETRASADO y \u00ABpasado por\u00BB las horas de m\u00E1s', () => {
      const txt = textoAlertaMantenimientoWhatsapp({ ...base, nivel: 'vencido', restante: -55, decision: 'hara' });
      const lineas = txt.split('\n');
      expect(lineas[0]).toBe('\uD83D\uDEA8 *ALERTA MANTENIMIENTO - RETRASADO*');
      expect(txt).toContain('\uD83D\uDE9C Equipo: EXCAVADORA VOLVO EC240 \u00B7 Placa A12BC3D');
      expect(txt).toContain('\u23F1 Hor\u00F3metro: 4.305 h');
      expect(txt).toContain('\uD83D\uDD27 Servicio cada 250 h \u00B7 pasado por 55 h');
      expect(txt).toContain('\uD83D\uDCC5 26/10/2026');
      expect(txt).toContain('\uD83D\uDC64 Responsable: Angelica Solis');
      expect(txt).toContain('_Enviado desde el Sistema MGG_');
      expect(txt).not.toContain('\uFE0F');
    });

    it('pr\u00F3ximo: primera l\u00EDnea PR\u00D3XIMO y \u00ABfaltan\u00BB las horas', () => {
      const txt = textoAlertaMantenimientoWhatsapp({ ...base, nivel: 'proximo', restante: 12, decision: 'hara' });
      const lineas = txt.split('\n');
      // El archivo quita el selector U+FE0F de todos los emojis (WhatsApp lo pierde): \u26A0\uFE0F \u2192 \u26A0.
      expect(lineas[0]).toBe('\u26A0 *ALERTA MANTENIMIENTO - PR\u00D3XIMO*');
      expect(txt).toContain('\uD83D\uDD27 Servicio cada 250 h \u00B7 faltan 12 h');
      expect(txt).not.toContain('pasado por');
      expect(txt).not.toContain('\uFE0F');
    });

    it('decisi\u00F3n S\u00CD / NO y el mensaje', () => {
      const si = textoAlertaMantenimientoWhatsapp({ ...base, nivel: 'vencido', restante: -3, decision: 'hara' });
      const no = textoAlertaMantenimientoWhatsapp({ ...base, nivel: 'vencido', restante: -3, decision: 'no_hara' });
      expect(si).toContain('\u2705 Decisi\u00F3n: S\u00CD se har\u00E1 el mantenimiento');
      expect(si).not.toContain('NO se har\u00E1');
      expect(no).toContain('\u274C Decisi\u00F3n: NO se har\u00E1 el mantenimiento');
      expect(no).toContain('\uD83D\uDCDD Mensaje: se programa para el viernes con el mec\u00E1nico; faltan filtros');
    });

    it('kilometraje: usa la l\u00EDnea de km y formatea una fecha ISO', () => {
      const txt = textoAlertaMantenimientoWhatsapp({
        ...base, unidad: 'km', lectura: 12500, frecuencia: 5000, nivel: 'proximo', restante: 320, decision: 'no_hara',
        fecha: '2026-10-26T14:00:00Z', placa: null,
      });
      expect(txt).toContain('\uD83D\uDEE3 Kilometraje: 12.500 km');
      expect(txt).toContain('\uD83D\uDD27 Servicio cada 5.000 km \u00B7 faltan 320 km');
      expect(txt).toContain('\uD83D\uDCC5 26/10/2026');
      expect(txt).toContain('\uD83D\uDE9C Equipo: EXCAVADORA VOLVO EC240\n');
      expect(txt).not.toContain('Placa');
    });
  });
});
