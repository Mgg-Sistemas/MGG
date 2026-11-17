import { describe, it, expect } from 'vitest';
import {
  normalizarDocumentosAdmin,
  filtrarDocumentosAdmin,
  calcularResumenDocs,
  agruparDocumentosAdmin,
  obtenerMetricasFichaDoc,
  clasificarHorizonteCaducidad,
  obtenerTituloRangoDoc,
} from './reporteDocumentosMoldeable';
import type { DocumentoEmpresa, Empresa } from './admin.repository';

const EMPRESAS_MOCK: Empresa[] = [
  { id: '1', clave: 'GT', nombre: 'Golden Touch 1127 C.A.', rif: 'J-50129993-5', activa: true, orden: 1, moneda: null, logoPath: null },
  { id: '2', clave: 'MIN', nombre: 'Minera El Callao S.A.', rif: 'J-12345678-9', activa: true, orden: 2, moneda: null, logoPath: null },
];

const DOCS_MOCK: DocumentoEmpresa[] = [
  {
    id: 'd1',
    empresaClave: 'GT',
    carpeta: 'permisos_mineros',
    tipo: 'rupdae',
    nombre: 'Inscripción RUPDAE 2026',
    path: 'https://example.com/rupdae.pdf',
    tamano: 1024 * 500,
    contentType: 'application/pdf',
    fechaEmision: '2025-01-15',
    fechaVencimiento: '2026-01-15', // vencido
    statusVencimiento: 'vencido',
    socioNombre: null,
    entidadEmisora: 'RUPDAE - SUNDDE',
    numeroRegistro: 'RUP-2025-8812',
    notaTramite: null,
    historial: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'd2',
    empresaClave: 'GT',
    carpeta: 'permisos_mineros',
    tipo: 'ragda',
    nombre: 'Permiso RAGDA Sustancias Químicas',
    path: 'https://example.com/ragda.pdf',
    tamano: 1024 * 700,
    contentType: 'application/pdf',
    fechaEmision: '2025-10-01',
    fechaVencimiento: '2026-10-15', // vencido en trámite
    statusVencimiento: 'vencido_en_tramite',
    socioNombre: null,
    entidadEmisora: 'MINEC / RAGDA',
    numeroRegistro: 'RAD-99124',
    notaTramite: 'En renovación, comprobante #88127 ante MINEC',
    historial: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'd3',
    empresaClave: 'GT',
    carpeta: 'laboral_parafiscal',
    tipo: 'mintras',
    nombre: 'Solvencia Laboral MINTRAS',
    path: 'https://example.com/mintras.pdf',
    tamano: 1024 * 300,
    contentType: 'application/pdf',
    fechaEmision: '2026-10-01',
    fechaVencimiento: '2026-11-20', // por vencer en ~15 días
    statusVencimiento: 'por_vencer',
    socioNombre: null,
    entidadEmisora: 'Ministerio del Trabajo',
    numeroRegistro: 'MIN-SOL-2026',
    notaTramite: null,
    historial: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'd4',
    empresaClave: 'GT',
    carpeta: 'socios_representantes',
    tipo: 'cedula_socio',
    nombre: 'Cédula de Identidad - Edinson Angulo',
    path: 'https://example.com/cedula.jpg',
    tamano: 1024 * 200,
    contentType: 'image/jpeg',
    fechaEmision: '2020-05-10',
    fechaVencimiento: '2030-05-10', // vigente
    statusVencimiento: 'vigente',
    socioNombre: 'Edinson Angulo',
    entidadEmisora: 'SAIME',
    numeroRegistro: 'V-19882341',
    notaTramite: null,
    historial: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'd5',
    empresaClave: 'GT',
    carpeta: 'legal_constitutivo',
    tipo: 'acta_constitutiva',
    nombre: 'Acta Constitutiva y Estatutos Sociales',
    path: 'https://example.com/acta.pdf',
    tamano: 1024 * 1500,
    contentType: 'application/pdf',
    fechaEmision: '2022-03-15',
    fechaVencimiento: null, // permanente
    statusVencimiento: 'no_vence',
    socioNombre: null,
    entidadEmisora: 'Registro Mercantil Primero',
    numeroRegistro: 'Tomo 44-A, Nro 12',
    notaTramite: null,
    historial: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
];

describe('reporteDocumentosMoldeable', () => {
  it('normaliza documentos agregando nombres de empresa, carpeta y horizonte', () => {
    const filas = normalizarDocumentosAdmin(DOCS_MOCK, EMPRESAS_MOCK);
    expect(filas.length).toBe(5);
    expect(filas[0].empresaNombre).toBe('Golden Touch 1127 C.A.');
    expect(filas[0].carpetaNombre).toBe('Permisos Mineros y Ambientales');
    expect(filas[3].socioNombre).toBe('Edinson Angulo');
    expect(filas[4].horizonteLabel).toBe('No Vence / Permanente');
  });

  it('calcula resumen con conteos de status y % de cumplimiento', () => {
    const filas = normalizarDocumentosAdmin(DOCS_MOCK, EMPRESAS_MOCK);
    const resumen = calcularResumenDocs(filas);

    expect(resumen.totalDocs).toBe(5);
    expect(resumen.vencidos).toBe(1);
    expect(resumen.vencidosEnTramite).toBe(1);
    expect(resumen.porVencer).toBe(1);
    expect(resumen.vigentes).toBe(1);
    expect(resumen.noVence).toBe(1);
    expect(resumen.criticos).toBe(2); // 1 vencido + 1 por vencer
    // Cumplimiento = (1 vigente + 1 no vence) / 5 = 40%
    expect(resumen.cumplimientoPct).toBe(40);
    expect(resumen.conteoConSocio).toBe(1);
    expect(resumen.conteoEnTramite).toBe(1);
  });

  it('agrupa por carpeta correctamente y ordena carpetas con vencidos primero', () => {
    const filas = normalizarDocumentosAdmin(DOCS_MOCK, EMPRESAS_MOCK);
    const grupos = agruparDocumentosAdmin(filas, 'carpeta');

    expect(grupos.length).toBe(4); // permisos_mineros, laboral_parafiscales, socios_representantes, legal_constitutivo
    // La carpeta con vencidos (permisos_mineros) debe estar de primera
    expect(grupos[0].claveGrupo).toBe('permisos_mineros');
    expect(grupos[0].vencidos).toBe(1);
    expect(grupos[0].vencidosEnTramite).toBe(1);
    expect(grupos[0].colorStatusDominante).toBe('#ef4444');
  });

  it('agrupa por status de vencimiento', () => {
    const filas = normalizarDocumentosAdmin(DOCS_MOCK, EMPRESAS_MOCK);
    const grupos = agruparDocumentosAdmin(filas, 'status');

    expect(grupos.some((g) => g.claveGrupo === 'vencido')).toBe(true);
    expect(grupos.some((g) => g.claveGrupo === 'vencido_en_tramite')).toBe(true);
    expect(grupos.some((g) => g.claveGrupo === 'vigente')).toBe(true);
  });

  it('agrupa por socio / titular', () => {
    const filas = normalizarDocumentosAdmin(DOCS_MOCK, EMPRESAS_MOCK);
    const grupos = agruparDocumentosAdmin(filas, 'socio');

    const edinson = grupos.find((g) => g.claveGrupo === 'Edinson Angulo');
    expect(edinson).toBeDefined();
    expect(edinson?.totalDocs).toBe(1);
  });

  it('filtra por presets de caducidad (críticos)', () => {
    const filas = normalizarDocumentosAdmin(DOCS_MOCK, EMPRESAS_MOCK);
    const criticos = filtrarDocumentosAdmin(filas, { presetCaducidad: 'criticos' });

    // D1 (vencido), D2 (vencido_en_tramite), D3 (por_vencer en 15d)
    expect(criticos.length).toBe(3);
    expect(criticos.some((d) => d.id === 'd1')).toBe(true);
    expect(criticos.some((d) => d.id === 'd2')).toBe(true);
    expect(criticos.some((d) => d.id === 'd3')).toBe(true);
  });

  it('filtra por búsqueda libre de texto (por socio o ente)', () => {
    const filas = normalizarDocumentosAdmin(DOCS_MOCK, EMPRESAS_MOCK);
    const busqSocio = filtrarDocumentosAdmin(filas, { busquedaTexto: 'Edinson' });
    expect(busqSocio.length).toBe(1);
    expect(busqSocio[0].id).toBe('d4');

    const busqMinec = filtrarDocumentosAdmin(filas, { busquedaTexto: 'MINEC' });
    expect(busqMinec.length).toBe(1);
    expect(busqMinec[0].id).toBe('d2');
  });

  it('obtiene métricas de ficha para tarjeta ejecutiva con alerta crítica si tiene vencidos', () => {
    const filas = normalizarDocumentosAdmin(DOCS_MOCK, EMPRESAS_MOCK);
    const grupos = agruparDocumentosAdmin(filas, 'carpeta');
    const fichaPermisos = obtenerMetricasFichaDoc(grupos[0]);

    expect(fichaPermisos.alertaCritica).toBe(true);
    expect(fichaPermisos.badgeTexto).toContain('Vencido');
    expect(fichaPermisos.badgeColor).toBe('#ef4444');
  });

  it('clasifica horizontes de caducidad adecuadamente', () => {
    expect(clasificarHorizonteCaducidad(-5, 'vencido')).toBe('Vencido');
    expect(clasificarHorizonteCaducidad(-5, 'vencido_en_tramite')).toBe('Vencido en Trámite');
    expect(clasificarHorizonteCaducidad(10, 'por_vencer')).toBe('Próximos 15 días');
    expect(clasificarHorizonteCaducidad(25, 'por_vencer')).toBe('Próximos 30 días');
    expect(clasificarHorizonteCaducidad(60, 'vigente')).toBe('Próximos 90 días (3 meses)');
    expect(clasificarHorizonteCaducidad(null, 'no_vence')).toBe('No Vence / Permanente');
  });

  it('genera títulos explicativos para rangos y presets', () => {
    const tCriticos = obtenerTituloRangoDoc('criticos');
    expect(tCriticos).toContain('Críticos y Vencidos');

    const tPersonalizado = obtenerTituloRangoDoc('personalizado', '2026-10-01', '2026-10-31');
    expect(tPersonalizado).toContain('01/10/2026');
    expect(tPersonalizado).toContain('31/10/2026');
  });
});
