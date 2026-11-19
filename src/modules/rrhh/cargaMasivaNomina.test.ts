import { describe, expect, it } from 'vitest';
import type { Personal } from '@/shared/lib/types';
import type { DefinicionEmpresa } from './empresa';
import type { FamiliarPersonal } from './personal.repository';
import {
  COLUMNAS_CARGA_MASIVA_NOMINA,
  desglosarDireccionBancaria,
  formatearFechaBancaria,
  formatearSueldoBancario15,
  normalizarDocumentoBancario,
  normalizarTelefonosBancarios,
  resolverEstadoCivilBancario,
  resolverNivelEducacionBancario,
  resolverProfesionBancaria,
  resolverTipoCargoBancario,
  separarNombresApellidos,
} from './cargaMasivaNomina';
import {
  AMBITOS_RRHH,
  CAMPOS_DEFAULT_RRHH,
  calcularResumenRrhh,
  filtrarFilasRrhh,
  normalizarCargaMasivaNominaRrhh,
  obtenerMetricasFichaRrhh,
  procesarFilasReporteRrhh,
} from './reporteRrhhDinamico';
import {
  construirDatosExcelCargaMasiva,
  generarContenidoCsvRrhh,
  generarContenidoTxtRrhh,
  generarNombreArchivoRrhh,
} from './exportarRrhhDinamico';

describe('CARGA MASIVA - NOMINA (Moneda Nacional)', () => {
  const empresas: DefinicionEmpresa[] = [
    {
      key: 'MGG',
      label: 'MGG',
      razonSocial: 'Mineral Group Guayana C.A.',
      rif: 'J-50221930-7',
      icono: '⛏',
      color: '#ff8a00',
      orden: 1,
      activa: true,
      monedaPago: 'USD',
    },
  ];
  const mapaEmpresas = new Map(empresas.map((e) => [e.key, e]));

  const personalDemo: Personal[] = [
    {
      id: 'p1',
      numero_ficha: '002',
      nombre: 'Carlos Argenis',
      apellido: 'Martínez Villalta',
      cedula: 'V-2.980.635',
      cargo: 'CHOFER DE GANDOLA',
      departamento: 'Transporte',
      sueldo_base: 500,
      activo: true,
      empresa: 'MGG',
      genero: 'masculino',
      estado_civil: 'casado',
      fecha_nacimiento: '1944-09-19',
      nacionalidad: 'Venezolano',
      fecha_ingreso: '2014-09-15',
      grado_instruccion: 'bachiller',
      telefono: '+58 426-3869794',
      correo: 'carlos.martinez@mgg.com',
      direccion: 'Urb. Unare II, Edificio Dimase Piso 2 Apto 4B, Puerto Ordaz',
      created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'p2',
      numero_ficha: '001',
      nombre: 'María Fernanda',
      apellido: 'De La Cruz Gómez',
      cedula: 'E-84512369',
      cargo: 'ANALISTA CONTABLE',
      departamento: 'Administración',
      sueldo_base: 750,
      activo: true,
      empresa: 'MGG',
      genero: 'femenino',
      estado_civil: 'concubinato',
      fecha_nacimiento: '1992-03-05',
      nacionalidad: 'Colombiana',
      fecha_ingreso: '2023-02-01',
      grado_instruccion: 'universitario',
      titulo_obtenido: 'Licenciada en Contaduría Pública',
      telefono: '0286-9612345 / 0414-8887766',
      correo: 'maria.cruz@mgg.com',
      direccion: 'Sector Centro, Calle Bolívar Casa 12, El Callao',
      created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'p3',
      numero_ficha: '003',
      nombre: 'Pedro',
      apellido: 'Pérez',
      cedula: 'V-19000111',
      cargo: 'OBRERO',
      departamento: 'Planta',
      sueldo_base: 300,
      activo: false,
      empresa: 'MGG',
      created_at: '2024-01-01T00:00:00Z',
    },
  ];

  const mapaFamilia = new Map<string, FamiliarPersonal[]>([
    [
      'p1',
      [
        { id: 'f1', personalId: 'p1', nombre: 'Hijo 1', parentesco: 'hijo', fechaNacimiento: '2015-01-01', genero: 'masculino', observacion: null, createdAt: '' },
        { id: 'f2', personalId: 'p1', nombre: 'Esposa', parentesco: 'conyuge', fechaNacimiento: '1980-01-01', genero: 'femenino', observacion: null, createdAt: '' },
      ],
    ],
  ]);

  it('registra la pestaña CARGA MASIVA - NOMINA y las 44 columnas oficiales del modelo', () => {
    const tab = AMBITOS_RRHH.find((a) => a.id === 'carga_masiva_nomina');
    expect(tab).toBeDefined();
    expect(tab?.label).toBe('CARGA MASIVA - NOMINA');
    expect(COLUMNAS_CARGA_MASIVA_NOMINA).toHaveLength(44);
    expect(CAMPOS_DEFAULT_RRHH.carga_masiva_nomina.detallado).toHaveLength(44);

    // La suma exacta de anchos fijos wch de las 44 columnas del modelo es 431 caracteres
    const sumaAnchos = COLUMNAS_CARGA_MASIVA_NOMINA.reduce((acc, c) => acc + c.anchoModelo, 0);
    expect(sumaAnchos).toBe(431);
  });

  it('mapea cédulas, fechas, sueldos de 15 dígitos, nombres compuestos y códigos bancarios', () => {
    expect(normalizarDocumentoBancario('V-2.980.635', 'VENEZOLANO')).toEqual({
      tipoDoc: 'V',
      cedula15: '000000002980635',
    });
    expect(normalizarDocumentoBancario(null, 'VENEZOLANO', 'V-12345678-9')).toEqual({
      tipoDoc: 'V',
      cedula15: '000000012345678',
    });
    expect(formatearFechaBancaria('1944-09-19')).toBe('19091944');
    expect(formatearSueldoBancario15(14846.5)).toBe('000000001484650');

    expect(separarNombresApellidos('María Fernanda', 'De La Cruz Gómez')).toEqual({
      primerApellido: 'DE LA CRUZ',
      segundoApellido: 'GOMEZ',
      primerNombre: 'MARIA',
      segundoNombre: 'FERNANDA',
    });

    expect(resolverEstadoCivilBancario('soltero')).toBe('1');
    expect(resolverEstadoCivilBancario('casado')).toBe('2');
    expect(resolverEstadoCivilBancario('divorciado')).toBe('3');
    expect(resolverEstadoCivilBancario('viudo')).toBe('4');
    expect(resolverEstadoCivilBancario('concubinato')).toBe('5');

    expect(resolverNivelEducacionBancario('primaria')).toBe('01');
    expect(resolverNivelEducacionBancario('bachiller')).toBe('02');
    expect(resolverNivelEducacionBancario('tecnico_medio')).toBe('03');
    expect(resolverNivelEducacionBancario('tsu')).toBe('04');
    expect(resolverNivelEducacionBancario('universitario')).toBe('05');
    expect(resolverNivelEducacionBancario('postgrado')).toBe('06');
    expect(resolverNivelEducacionBancario('doctorado')).toBe('07');

    expect(resolverProfesionBancaria('Licenciada en Contaduría Pública', 'Analista', 'universitario')).toBe('LCPU');
    expect(resolverProfesionBancaria(null, 'Chofer', 'bachiller')).toBe('CHOF');
    expect(resolverTipoCargoBancario('GERENTE GENERAL')).toBe('075');
    expect(resolverTipoCargoBancario('CHOFER DE GANDOLA')).toBe('021');
    expect(resolverTipoCargoBancario('ANALISTA CONTABLE')).toBe('007');

    const dirCallao = desglosarDireccionBancaria('Calle Bolívar Casa 12, El Callao');
    expect(dirCallao.region).toBe('09');
    expect(dirCallao.estado).toBe('07');
    expect(dirCallao.parroquia).toBe('070501');
    expect(dirCallao.zonaPostal).toBe('0000008056');

    const tlfs = normalizarTelefonosBancarios('0286-9612345 / +58 414-8887766');
    expect(tlfs).toEqual({ tlfLocal: '02869612345', tlfCelular: '04148887766' });
  });

  it('normaliza la nómina ordenada por ficha y reasigna correlativos continuos sin saltos tras filtrar', () => {
    const tasa = 50; // $1 = Bs 50
    const detalle = normalizarCargaMasivaNominaRrhh(personalDemo, mapaEmpresas, tasa, mapaFamilia, {
      correlativoInicio: 1,
      porcentajeSueldoBs: 0.2, // 20% oficial en Bs
      oficinaPrincipal: '0405',
      tipoCuenta: 'CCVI',
    });

    // Ficha 001 (p2), Ficha 002 (p1), Ficha 003 (p3)
    expect(detalle.map((f) => f.id)).toEqual(['p2', 'p1', 'p3']);

    // Al filtrar solo activos (excluye p3), los correlativos quedan 0000001 y 0000002 sin saltos
    const filtradas = filtrarFilasRrhh(detalle, { estadosSel: ['activo'] });
    const procesadas = procesarFilasReporteRrhh(filtradas, 'detallado', tasa, 1);
    expect(procesadas).toHaveLength(2);
    expect(procesadas[0].cargaMasiva?.cm_02_correlativo).toBe('0000001');
    expect(procesadas[1].cargaMasiva?.cm_02_correlativo).toBe('0000002');

    // Verificar María (p2, $750 * 50 * 0.2 = Bs 7.500,00 -> 000000000750000)
    const maria = procesadas[0].cargaMasiva!;
    expect(maria.cm_01_banco).toBe('0163');
    expect(maria.cm_03_tipo_doc).toBe('E');
    expect(maria.cm_04_cedula).toBe('000000084512369');
    expect(maria.cm_10_pais_nacimiento).toBe('CO');
    expect(maria.cm_12_sexo).toBe('F');
    expect(maria.cm_13_estado_civil).toBe('5');
    expect(maria.cm_14_dependientes).toBe('00');
    expect(maria.cm_32_nivel_educacion).toBe('05');
    expect(maria.cm_33_profesion).toBe('LCPU');
    expect(maria.cm_34_codigo_industria).toBe('0902');
    expect(maria.cm_39_sueldo_basico).toBe('000000000750000');
    expect(maria.cm_42_oficina_principal).toBe('0405');
    expect(maria.cm_44_constante_solicitud).toBe('I');

    // Verificar Carlos (p1, 2 dependientes, $500 * 50 * 0.2 = Bs 5.000,00 -> 000000000500000)
    const carlos = procesadas[1].cargaMasiva!;
    expect(carlos.cm_03_tipo_doc).toBe('V');
    expect(carlos.cm_04_cedula).toBe('000000002980635');
    expect(carlos.cm_09_fecha_nacimiento).toBe('19091944');
    expect(carlos.cm_14_dependientes).toBe('02');
    expect(carlos.cm_16_casa_edificio).toBe('EDIFICIO DIMASE');
    expect(carlos.cm_17_piso_nivel).toBe('2');
    expect(carlos.cm_18_apto_local).toBe('4B');
    expect(carlos.cm_29_tipo_vivienda).toBe('3');
    expect(carlos.cm_39_sueldo_basico).toBe('000000000500000');
    expect(carlos.cm_40_fecha_ingreso).toBe('15092014');
  });

  it('genera correctamente las estructuras de exportación en Excel, CSV, TXT y PDF', () => {
    const tasa = 50;
    const detalle = normalizarCargaMasivaNominaRrhh(personalDemo.slice(0, 2), mapaEmpresas, tasa, mapaFamilia);
    const procesadas = procesarFilasReporteRrhh(detalle, 'detallado', tasa, 1);
    const resumen = calcularResumenRrhh(procesadas, tasa, empresas);
    const columnasClaves = CAMPOS_DEFAULT_RRHH.carga_masiva_nomina.detallado;

    const op = {
      ambito: 'carga_masiva_nomina' as const,
      agrupacion: 'detallado' as const,
      columnasClaves,
      empresasTexto: 'MGG',
      resumen,
      filas: procesadas,
    };

    // 1. Excel
    const excelData = construirDatosExcelCargaMasiva(op);
    expect(excelData.cabecerasModelo).toHaveLength(44);
    expect(excelData.cabecerasModelo[0]).toBe('NUMERO BANCO (NO MODIFICAR)');
    expect(excelData.cabecerasModelo[43]).toBe('CONSTANTE (SE MANTIENE IGUAL)');
    expect(excelData.filasModelo).toHaveLength(2);
    expect(excelData.filasModelo[0][0]).toBe('0163');
    expect(excelData.filasModelo[0][1]).toBe('0000001');
    expect(excelData.filasControl).toHaveLength(2);

    // 2. CSV
    const csv = generarContenidoCsvRrhh(op);
    const lineasCsv = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(lineasCsv).toHaveLength(3); // 1 cabecera + 2 trabajadores
    expect(lineasCsv[0].startsWith('"NUMERO BANCO (NO MODIFICAR)";"CORRELATIVO CLIENTE"')).toBe(true);
    expect(lineasCsv[1].startsWith('"0163";"0000001";')).toBe(true);

    // 3. TXT de ancho fijo (431 caracteres exactos por línea)
    const txt = generarContenidoTxtRrhh(op);
    const lineasTxt = txt.split('\r\n');
    expect(lineasTxt).toHaveLength(2);
    expect(lineasTxt[0]).toHaveLength(431);
    expect(lineasTxt[1]).toHaveLength(431);
    expect(lineasTxt[0].slice(0, 12)).toBe('01630000001E');
    expect(lineasTxt[1].slice(0, 12)).toBe('01630000002V');
    expect(lineasTxt[0].endsWith('04050405I')).toBe(true);

    // 4. Nombres de archivos y KPIs para PDF / UI
    expect(generarNombreArchivoRrhh('carga_masiva_nomina', 'xlsx')).toMatch(/^rrhh-carga-masiva-nomina-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(generarNombreArchivoRrhh('carga_masiva_nomina', 'csv')).toMatch(/\.csv$/);
    expect(generarNombreArchivoRrhh('carga_masiva_nomina', 'txt')).toMatch(/\.txt$/);
    expect(generarNombreArchivoRrhh('carga_masiva_nomina', 'pdf')).toMatch(/\.pdf$/);

    const kpis = obtenerMetricasFichaRrhh(resumen, 'carga_masiva_nomina', columnasClaves);
    expect(kpis).toHaveLength(4);
    expect(kpis[0].valor).toBe('2');
    expect(kpis[0].sub).toContain('0000001 al 0000002');
  });
});

