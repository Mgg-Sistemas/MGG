import { describe, it, expect } from 'vitest';
import {
  calcularMatrizCentrosAcopio,
  calcularMatrizResponsables,
  extraerHistorialGlobalDocumentos,
  obtenerListaResponsables,
  normalizarNombreResponsable,
  CENTROS_ACOPIO_DEFECTO,
  FASES_OPERATIVAS,
} from './administracionCentrosResponsables';
import type { DocumentoEmpresa, Empresa, GastoFijo, InfoCarpetaDoc } from './admin.repository';

const MOCK_EMPRESAS: Empresa[] = [
  { id: '1', clave: 'GT', nombre: 'Golden Touch 1127 C.A.', rif: 'J-50129993-5', moneda: 'USD', logoPath: null, activa: true, orden: 1 },
];

const MOCK_DOCS: DocumentoEmpresa[] = [
  {
    id: 'd1',
    empresaClave: 'GT',
    carpeta: 'permisos_mineros',
    tipo: 'rupdae',
    nombre: 'RUPDAE 2026.pdf',
    path: 'GT/rupdae.pdf',
    contentType: 'application/pdf',
    tamano: 1024,
    fechaEmision: '2026-01-01',
    fechaVencimiento: '2027-01-01',
    statusVencimiento: 'vigente',
    socioNombre: 'Carlos Silva',
    entidadEmisora: 'Min. Minas',
    numeroRegistro: 'RUP-001',
    notaTramite: null,
    historial: [
      { id: 'h1', fecha: '2026-01-01T10:00:00Z', actor: 'Abg. Sofia Gómez', accion: 'creacion', detalle: 'Documento inicial' },
      { id: 'h2', fecha: '2026-06-01T12:00:00Z', actor: 'Ing. Carlos Mendoza', accion: 'renovacion', detalle: 'Renovado por 1 año' },
    ],
    createdAt: '2026-01-01',
    updatedAt: '2026-06-01',
  },
  {
    id: 'd2',
    empresaClave: 'GT',
    carpeta: 'permisos_mineros',
    tipo: 'ragda',
    nombre: 'RAGDA Ambiental.pdf',
    path: 'GT/ragda.pdf',
    contentType: 'application/pdf',
    tamano: 2048,
    fechaEmision: '2025-01-01',
    fechaVencimiento: '2026-01-01',
    statusVencimiento: 'vencido',
    socioNombre: 'Carlos Silva',
    entidadEmisora: 'MinEc',
    numeroRegistro: 'RAG-999',
    notaTramite: null,
    historial: [
      { id: 'h3', fecha: '2025-01-01T10:00:00Z', actor: 'Abg. Sofia Gómez', accion: 'creacion', detalle: 'Carga inicial' },
    ],
    createdAt: '2025-01-01',
    updatedAt: null,
  },
];

const MOCK_GASTOS: GastoFijo[] = [
  {
    id: 'g1',
    empresaClave: 'GT',
    concepto: 'Alquiler Patio Brasilero',
    proveedorId: null,
    proveedorNombre: 'Inversiones Sur',
    categoriaGastoId: null,
    monto: 800,
    moneda: 'USD',
    tasaRef: null,
    periodicidad: 'mensual',
    diaVencimiento: 5,
    vigenteDesde: '2026-01-01',
    estado: 'activo',
  },
];

describe('administracionCentrosResponsables', () => {
  it('contiene fases operativas y centros por defecto bien definidos', () => {
    expect(FASES_OPERATIVAS.length).toBeGreaterThanOrEqual(4);
    expect(CENTROS_ACOPIO_DEFECTO.length).toBeGreaterThanOrEqual(3);
    expect(CENTROS_ACOPIO_DEFECTO.some((c) => c.nombre.includes('Principal'))).toBe(true);
  });

  it('calcula la matriz de centros de acopio con diagnóstico y semáforo correcto', () => {
    const matriz = calcularMatrizCentrosAcopio({
      centros: CENTROS_ACOPIO_DEFECTO,
      empresas: MOCK_EMPRESAS,
      documentos: MOCK_DOCS,
      gastosFijos: MOCK_GASTOS,
    });

    expect(matriz.length).toBe(CENTROS_ACOPIO_DEFECTO.length);
    const principal = matriz[0];
    expect(principal.empresaNombre).toBe('Golden Touch 1127 C.A.');
    expect(principal.docsTotal).toBe(2);
    expect(principal.docsVencidos).toBe(1);
    expect(principal.docsVigentes).toBe(1);
    expect(principal.semaforo).toBe('critico'); // Por tener 1 vencido
    expect(principal.diagnostico).toContain('Alerta crítica');
  });

  it('calcula la matriz de responsables agrupando documentos y gastos a su cargo', () => {
    const responsables = calcularMatrizResponsables({
      documentos: MOCK_DOCS,
      gastosFijos: MOCK_GASTOS,
      centros: CENTROS_ACOPIO_DEFECTO,
    });

    expect(responsables.length).toBeGreaterThan(0);
    const carlos = responsables.find((r) => r.responsable === 'Carlos Silva');
    expect(carlos).toBeDefined();
    expect(carlos?.documentosTotal).toBe(2);
    expect(carlos?.itemsCriticos).toBe(1); // 1 vencido
  });

  it('extrae el historial global cronológico de modificaciones (quién actualizó qué)', () => {
    const historial = extraerHistorialGlobalDocumentos(MOCK_DOCS);
    expect(historial.length).toBe(3); // 2 de d1 + 1 de d2

    // El más reciente primero
    expect(historial[0].actor).toBe('Ing. Carlos Mendoza');
    expect(historial[0].accion).toBe('renovacion');
    expect(historial[0].documentoNombre).toBe('RUPDAE 2026.pdf');

    // Filtro por actor
    const filtradoSofia = extraerHistorialGlobalDocumentos(MOCK_DOCS, 'Sofia');
    expect(filtradoSofia.length).toBe(2);
    expect(filtradoSofia.every((h) => h.actor.includes('Sofia'))).toBe(true);
  });
  it('asocia documentos a un centro de acopio a través de la carpeta configurada y asigna custodia a su responsable', () => {
    const carpetasConCentro: InfoCarpetaDoc[] = [
      { id: 'permisos_mineros', icon: '⛏️', label: 'Permisos Mineros', descripcion: 'Minas', centroAcopioId: 'planta_molinos' },
      { id: 'contratos_servicios', icon: '📑', label: 'Contratos', descripcion: 'Maquinaria', centroAcopioId: 'patio_brasilero' },
    ];

    const docsTest: DocumentoEmpresa[] = [
      ...MOCK_DOCS, // d1 y d2 en carpeta 'permisos_mineros'
      {
        id: 'd3',
        empresaClave: 'GT',
        carpeta: 'contratos_servicios',
        tipo: 'otro',
        nombre: 'Contrato Alquiler Patio.pdf',
        path: 'GT/contrato.pdf',
        contentType: 'application/pdf',
        tamano: 1024,
        fechaEmision: '2026-01-01',
        fechaVencimiento: '2027-01-01',
        statusVencimiento: 'vigente',
        socioNombre: null,
        entidadEmisora: null,
        numeroRegistro: null,
        notaTramite: null,
        historial: [],
        createdAt: '2026-01-01',
        updatedAt: null,
      },
    ];

    // Matriz de centros
    const matriz = calcularMatrizCentrosAcopio({
      centros: CENTROS_ACOPIO_DEFECTO,
      empresas: MOCK_EMPRESAS,
      documentos: docsTest,
      gastosFijos: MOCK_GASTOS,
      carpetas: carpetasConCentro,
    });

    const planta = matriz.find((c) => c.centroId === 'planta_molinos');
    expect(planta?.docsTotal).toBe(2); // d1 y d2
    expect(planta?.responsablePrincipal).toBe('Jefe de Planta');

    const patio = matriz.find((c) => c.centroId === 'patio_brasilero');
    expect(patio?.docsTotal).toBe(1); // d3
    expect(patio?.responsablePrincipal).toBe('Jefe de Patio y Maquinaria');

    // Matriz de responsables
    const resp = calcularMatrizResponsables({
      documentos: docsTest,
      gastosFijos: MOCK_GASTOS,
      centros: CENTROS_ACOPIO_DEFECTO,
      carpetas: carpetasConCentro,
    });

    const jefePlanta = resp.find((r) => r.responsable === 'Jefe de Planta');
    expect(jefePlanta).toBeDefined();
    expect(jefePlanta?.documentosTotal).toBe(2); // Tiene 2 docs a cargo

    const jefePatio = resp.find((r) => r.responsable === 'Jefe de Patio y Maquinaria');
    expect(jefePatio).toBeDefined();
    expect(jefePatio?.documentosTotal).toBe(1); // Tiene 1 doc a cargo
  });

  it('normaliza nombres de responsables canónicos para evitar duplicados', () => {
    expect(normalizarNombreResponsable('Administración / Finanzas')).toBe('Administración y Finanzas');
    expect(normalizarNombreResponsable('administración y finanzas')).toBe('Administración y Finanzas');
    expect(normalizarNombreResponsable('Dirección de Operaciones')).toBe('Dirección de Operaciones');
    expect(normalizarNombreResponsable('Jefe de Patio y Maquinaria')).toBe('Jefe de Patio y Maquinaria');
    expect(normalizarNombreResponsable('Lic. Ana Rojas')).toBe('Lic. Ana Rojas');
  });

  it('genera una lista completa y única de opciones de responsables desde centros, documentos y gastos', () => {
    const carpetas: InfoCarpetaDoc[] = [
      { id: 'c1', icon: '📁', label: 'Carpeta 1', descripcion: '', responsable: 'Ing. Supervisor Norte' },
    ];
    const docs: DocumentoEmpresa[] = [
      {
        ...MOCK_DOCS[0],
        responsable: 'Abg. Legal Externo',
      },
    ];
    const gastos: GastoFijo[] = [
      {
        ...MOCK_GASTOS[0],
        responsable: 'Coordinador de Compras',
      },
    ];

    const lista = obtenerListaResponsables(CENTROS_ACOPIO_DEFECTO, docs, gastos, carpetas);
    expect(lista).toContain('Dirección de Operaciones');
    expect(lista).toContain('Jefe de Planta');
    expect(lista).toContain('Administración y Finanzas');
    expect(lista).toContain('Ing. Supervisor Norte');
    expect(lista).toContain('Abg. Legal Externo');
    expect(lista).toContain('Coordinador de Compras');
    // Sin duplicados
    const set = new Set(lista);
    expect(set.size).toBe(lista.length);
  });

  it('asigna un gasto fijo puntualmente a un centro de acopio y a un analista específico sin triplicar montos', () => {
    const gastosConAsignacion: GastoFijo[] = [
      {
        id: 'gf-patio',
        empresaClave: 'GT',
        concepto: 'Reparación de Cargador Frontal',
        proveedorId: null,
        proveedorNombre: 'Taller Central',
        categoriaGastoId: null,
        monto: 350,
        moneda: 'USD',
        tasaRef: null,
        periodicidad: 'mensual',
        diaVencimiento: 15,
        vigenteDesde: '2026-01-01',
        estado: 'activo',
        centroAcopioId: 'patio_brasilero',
        responsable: 'Jefe de Patio y Maquinaria',
      },
      {
        id: 'gf-planta',
        empresaClave: 'GT',
        concepto: 'Reactivos de Molienda y Cal',
        proveedorId: null,
        proveedorNombre: 'Química Industrial',
        categoriaGastoId: null,
        monto: 1200,
        moneda: 'USD',
        tasaRef: null,
        periodicidad: 'mensual',
        diaVencimiento: 20,
        vigenteDesde: '2026-01-01',
        estado: 'activo',
        centroAcopioId: 'planta_molinos',
        responsable: 'Jefe de Planta',
      },
    ];

    const matriz = calcularMatrizCentrosAcopio({
      centros: CENTROS_ACOPIO_DEFECTO,
      empresas: MOCK_EMPRESAS,
      documentos: [],
      gastosFijos: gastosConAsignacion,
    });

    const patio = matriz.find((c) => c.centroId === 'patio_brasilero');
    expect(patio?.gastosFijosTotal).toBe(1);
    expect(patio?.montoMensualUsd).toBe(350);

    const planta = matriz.find((c) => c.centroId === 'planta_molinos');
    expect(planta?.gastosFijosTotal).toBe(1);
    expect(planta?.montoMensualUsd).toBe(1200);

    const resp = calcularMatrizResponsables({
      documentos: [],
      gastosFijos: gastosConAsignacion,
      centros: CENTROS_ACOPIO_DEFECTO,
    });

    const jefePatio = resp.find((r) => r.responsable === 'Jefe de Patio y Maquinaria');
    expect(jefePatio?.presupuestoMensualUsd).toBe(350);

    const jefePlanta = resp.find((r) => r.responsable === 'Jefe de Planta');
    expect(jefePlanta?.presupuestoMensualUsd).toBe(1200);
  });
});