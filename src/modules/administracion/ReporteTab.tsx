/* ============================================================
   Golden Touch · Administración · pestaña «Reporte» (dinámico)
   (05/11/2026)

   Reporte multidimensional integral para Minería y Administración:
     1. Gastos y Movimientos (análisis contable, categorías, proveedores).
     2. Documentos y Permisos (control de vencimientos, caducidades y carpetas).
     3. Centros de Acopio, Fases y Responsables:
        - ¿En qué FASE está cada centro de acopio respecto a documentación,
          permisología y gastos fijos?
        - ¿Quién es RESPONSABLE de qué documento, o documentación de la
          empresa, o gastos fijos?
        - ¿Quién actualiza qué documento en el HISTORIAL?
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { type Moneda } from './administracionCalculo';
import { armarReporteAdmin, ETIQUETA_DIMENSION, type DimensionReporte } from './administracionReporte';
import { cargarTasaBcv, TASA_FALLBACK } from './administracionTasa';
import { descargarReporteAdminPdf } from './administracionReportePdf';
import { descargarReporteAdminExcel } from './administracionReporteExcel';
import { reporteMovimientosTxt } from './administracionWhatsApp';
import { WhatsAppReporteModal } from './WhatsAppReporteModal';
import { ExportarAdministracionModal } from './ExportarAdministracionModal';
import { ExportarDocumentosModal } from './ExportarDocumentosModal';
import { descargarDocumentosPdf, descargarDocumentosExcel, generarTextoWhatsappDocs } from './exportarDocumentos';
import { normalizarDocumentosAdmin, calcularResumenDocs, agruparDocumentosAdmin, CAMPOS_DEFECTO_DOC } from './reporteDocumentosMoldeable';
import {
  calcularMatrizCentrosAcopio,
  calcularMatrizResponsables,
  extraerHistorialGlobalDocumentos,
  type CentroAcopio,
} from './administracionCentrosResponsables';
import { leerCarpetasPersonalizadas } from './GestionarCarpetasModal';
import type { AdminRepo, Empresa, Movimiento, OpcionRef, DocumentoEmpresa, GastoFijo } from './admin.repository';

const num0 = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 0 });
const monto2 = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DIMENSIONES: DimensionReporte[] = ['categoria', 'empresa', 'proveedor', 'periodo', 'moneda', 'estado'];

const fCorta = (iso: string) => { const [a, m, d] = iso.split('-'); return d && m && a ? `${d}/${m}/${a}` : iso; };
const fFechaHora = new Intl.DateTimeFormat('es-VE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function ReporteTab({ repo, empresaClave, empresas }: {
  repo: AdminRepo;
  empresaClave: string | null;
  empresas: Empresa[];
}) {
  const [ambito, setAmbito] = useState<'gastos' | 'documentos' | 'centros'>('centros');
  const [subVistaCentros, setSubVistaCentros] = useState<'integral' | 'documentos' | 'gastos' | 'responsables' | 'historial'>('integral');

  const [docs, setDocs] = useState<DocumentoEmpresa[]>([]);
  const [gastosFijos, setGastosFijos] = useState<GastoFijo[]>([]);
  const [modalExportarDocs, setModalExportarDocs] = useState(false);
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [categorias, setCategorias] = useState<OpcionRef[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros de Movimientos
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [moneda, setMoneda] = useState<'' | Moneda>('');
  const [categoriaId, setCategoriaId] = useState('');
  const [agruparPor, setAgruparPor] = useState<DimensionReporte>('categoria');
  const [tasa, setTasa] = useState(TASA_FALLBACK);
  const [wsp, setWsp] = useState<string | null>(null);
  const [modalExportar, setModalExportar] = useState(false);

  // Filtros de Centros y Responsables
  const [filtroCentroId, setFiltroCentroId] = useState<string>('todos');
  const [filtroResponsable, setFiltroResponsable] = useState<string>('todos');
  const [busquedaHistorial, setBusquedaHistorial] = useState('');
  const [carpetas] = useState(() => leerCarpetasPersonalizadas(empresaClave));

  const nombreEmp = useMemo(() => new Map(empresas.map((e) => [e.clave, e.nombre])), [empresas]);
  // Los centros salen de la base, no de una lista fija: si no, el reporte de
  // Centros y Fases ignora lo que se crea en Configuracion.
  const [centros, setCentros] = useState<CentroAcopio[]>([]);
  useEffect(() => { repo.listCentros().then(setCentros).catch(() => setCentros([])); }, [repo]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [ms, cats, t, ds, gfs] = await Promise.all([
        repo.listMovimientos(empresaClave ?? undefined),
        repo.listCategorias().catch(() => [] as OpcionRef[]),
        cargarTasaBcv(),
        repo.listDocumentos(empresaClave ?? undefined).catch(() => [] as DocumentoEmpresa[]),
        repo.listGastosFijos(empresaClave ?? undefined).catch(() => [] as GastoFijo[]),
      ]);
      setMovs(ms);
      setCategorias(cats);
      setTasa(t.tasa);
      setDocs(ds);
      setGastosFijos(gfs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer los datos.');
    } finally {
      setCargando(false);
    }
  }, [repo, empresaClave]);

  useEffect(() => { void cargar(); }, [cargar]);

  // 1. Cálculos de Movimientos de Gasto
  const filtrados = useMemo(
    () => movs.filter((m) =>
      m.estadoPago !== 'anulado'
      && (!desde || m.fecha >= desde)
      && (!hasta || m.fecha <= hasta)
      && (!moneda || m.moneda === moneda)
      && (!categoriaId || m.categoriaGastoId === categoriaId)),
    [movs, desde, hasta, moneda, categoriaId],
  );
  const alcanceLabel = (!desde && !hasta) ? 'Todo el histórico' : `${desde ? fCorta(desde) : '…'} – ${hasta ? fCorta(hasta) : '…'}`;
  const empresaNombre = empresaClave ? nombreEmp.get(empresaClave) ?? empresaClave : null;

  const data = useMemo(
    () => armarReporteAdmin(filtrados, empresas, categorias, { empresaNombre, alcanceLabel, tasa, agruparPor }),
    [filtrados, empresas, categorias, empresaNombre, alcanceLabel, tasa, agruparPor],
  );
  const { total, grupos } = data;
  const dim = ETIQUETA_DIMENSION[agruparPor];
  const maxVal = Math.max(1, ...grupos.map((g) => g.equivUsd));

  function abrirWhatsApp() {
    setWsp(reporteMovimientosTxt(grupos, total, { empresaNombre, periodoLabel: alcanceLabel, dimLabel: dim.toLowerCase() }));
  }
  async function descargarPdf() {
    try { await descargarReporteAdminPdf(data); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF.', 'error'); }
  }
  async function descargarExcel() {
    try { await descargarReporteAdminExcel(data); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el Excel.', 'error'); }
  }

  // 2. Cálculos de Documentos y Permisos
  const docsNormalizados = useMemo(() => normalizarDocumentosAdmin(docs, empresas), [docs, empresas]);
  const resumenDocs = useMemo(() => calcularResumenDocs(docsNormalizados), [docsNormalizados]);
  const gruposDocs = useMemo(() => agruparDocumentosAdmin(docsNormalizados, 'carpeta'), [docsNormalizados]);

  async function descargarDocsPdf() {
    try {
      await descargarDocumentosPdf({
        filas: docsNormalizados,
        grupos: gruposDocs,
        resumen: resumenDocs,
        columnas: CAMPOS_DEFECTO_DOC,
        tituloRango: `Reporte de Cumplimiento Legal y Permisología`,
        periodoLabel: 'Inventario General',
        empresaNombre,
        empresaClave,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el PDF de documentos.', 'error');
    }
  }

  async function descargarDocsExcel() {
    try {
      await descargarDocumentosExcel({
        filas: docsNormalizados,
        grupos: gruposDocs,
        resumen: resumenDocs,
        periodoLabel: 'Inventario General',
        empresaNombre,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el Excel de documentos.', 'error');
    }
  }

  function abrirDocsWhatsApp() {
    setWsp(
      generarTextoWhatsappDocs({
        filas: docsNormalizados,
        grupos: gruposDocs,
        resumen: resumenDocs,
        periodoLabel: 'Inventario General',
        empresaNombre,
      }),
    );
  }

  // 3. Cálculos de Centros de Acopio, Fases y Responsables (Solo centros activos)
  const centrosFiltradosEmpresa = useMemo(() => {
    const soloActivos = centros.filter((c) => c.activo !== false);
    if (!empresaClave) return soloActivos;
    return soloActivos.filter((c) => c.empresaClave === empresaClave);
  }, [centros, empresaClave]);

  const matrizCentros = useMemo(() => {
    return calcularMatrizCentrosAcopio({
      centros: centrosFiltradosEmpresa,
      empresas,
      documentos: docs,
      gastosFijos,
      carpetas,
    });
  }, [centrosFiltradosEmpresa, empresas, docs, gastosFijos, carpetas]);

  const matrizCentrosFiltrada = useMemo(() => {
    return matrizCentros.filter((m) => {
      if (filtroCentroId !== 'todos' && m.centroId !== filtroCentroId) return false;
      if (filtroResponsable !== 'todos' && m.responsablePrincipal !== filtroResponsable) return false;
      return true;
    });
  }, [matrizCentros, filtroCentroId, filtroResponsable]);

  const matrizResponsables = useMemo(() => {
    return calcularMatrizResponsables({
      documentos: docs,
      gastosFijos,
      centros: centrosFiltradosEmpresa,
      carpetas,
    });
  }, [docs, gastosFijos, centrosFiltradosEmpresa, carpetas]);

  const listaResponsablesUnicos = useMemo(() => {
    return Array.from(new Set(matrizResponsables.map((r) => r.responsable))).filter(Boolean);
  }, [matrizResponsables]);

  const matrizResponsablesFiltrada = useMemo(() => {
    return matrizResponsables.filter((r) => {
      if (filtroResponsable !== 'todos' && r.responsable !== filtroResponsable) return false;
      if (filtroCentroId !== 'todos') {
        const centroNombre = centros.find((c) => c.id === filtroCentroId)?.nombre;
        const matchesCentro = r.centrosAcopio.includes(centroNombre || '') || r.centrosAcopio.includes(filtroCentroId);
        if (!matchesCentro) return false;
      }
      return true;
    });
  }, [matrizResponsables, filtroResponsable, filtroCentroId, centros]);

  const historialAuditoria = useMemo(() => {
    return extraerHistorialGlobalDocumentos(docs, busquedaHistorial);
  }, [docs, busquedaHistorial]);

  // Resumen de Centros de Acopio
  const kpisCentros = useMemo(() => {
    let alDia = 0;
    let atencion = 0;
    let critico = 0;
    let gastoTotalUsd = 0;

    for (const m of matrizCentros) {
      if (m.semaforo === 'al_dia') alDia += 1;
      else if (m.semaforo === 'atencion') atencion += 1;
      else critico += 1;
      gastoTotalUsd += m.montoMensualUsd;
    }

    return {
      total: matrizCentros.length,
      alDia,
      atencion,
      critico,
      gastoTotalUsd: Math.round(gastoTotalUsd),
    };
  }, [matrizCentros]);

  // Generador de WhatsApp específico para Centros y Fases
  function abrirCentrosWhatsApp() {
    const lineas = [
      `🏛️ *MINERAL GROUP GUAYANA C.A. · ESTADO DE CENTROS DE ACOPIO, FASES Y RESPONSABLES*`,
      `🏢 Empresa: *${empresaNombre || 'Consolidado General'}*`,
      `📅 Fecha de corte: *${fFechaHora.format(new Date())}*`,
      '',
      `*RESUMEN EJECUTIVO:*`,
      `• Centros de Acopio Monitoreados: *${kpisCentros.total}*`,
      `• 🟢 Centros al Día (100% cumplido): *${kpisCentros.alDia}*`,
      `• 🟡 Centros en Regularización: *${kpisCentros.atencion}*`,
      `• 🔴 Centros en Alerta Crítica: *${kpisCentros.critico}*`,
      `• 💰 Presupuesto Fijo Mensual Centros: *$ ${num0(kpisCentros.gastoTotalUsd)} / mes*`,
      '',
      `*DIAGNÓSTICO POR CENTRO DE ACOPIO:*`,
    ];

    matrizCentros.forEach((c, idx) => {
      const semaforoIcon = c.semaforo === 'critico' ? '🔴' : c.semaforo === 'atencion' ? '🟡' : '🟢';
      lineas.push(`${idx + 1}. ${semaforoIcon} *${c.centroNombre}* (${c.empresaClave})`);
      lineas.push(`   └ Fase: *${c.faseActual}*`);
      lineas.push(`   └ Responsable: *${c.responsablePrincipal}*`);
      lineas.push(`   └ Permisología: ${c.porcentajeCumplimientoDocs}% al día (${c.docsVigentes} vigentes, ${c.docsPorVencer} por vencer, ${c.docsVencidos} vencidos)`);
      lineas.push(`   └ Gastos Fijos: ${c.gastosFijosTotal} servicio(s) · $ ${num0(c.montoMensualUsd)}/mes`);
      lineas.push(`   └ Estado: _${c.diagnostico}_`);
      lineas.push('');
    });

    lineas.push(`_Generado automáticamente desde Sistema Mineral Group Guayana C.A._`);
    setWsp(lineas.join('\n'));
  }

  return (
    <div className="adm-tablero">
      {/* 1. SECCIÓN: Switcher de Ámbito Principal del Reporte */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div className="view-toggle" role="tablist">
          <button
            type="button"
            className={ambito === 'centros' ? 'active' : ''}
            onClick={() => setAmbito('centros')}
            style={{ fontWeight: 700 }}
          >
            🏢 Centros de Acopio, Fases y Responsables ({centrosFiltradosEmpresa.length})
          </button>
          <button
            type="button"
            className={ambito === 'documentos' ? 'active' : ''}
            onClick={() => setAmbito('documentos')}
          >
            📁 Documentos, Permisos y Vencimientos ({docs.length})
          </button>
          <button
            type="button"
            className={ambito === 'gastos' ? 'active' : ''}
            onClick={() => setAmbito('gastos')}
          >
            📌 Gastos Fijos y Movimientos ({movs.length})
          </button>
        </div>
      </div>

      {/* 2. ÁMBITO: Centros de Acopio, Fases y Responsables */}
      {ambito === 'centros' ? (
        <>
          {/* Cabecera y Botonera Ejecutiva */}
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
            <div>
              <strong style={{ fontSize: '1.08rem', color: '#ff8a00' }}>
                🏢 Control de Centros de Acopio, Fases Operativas y Responsables
              </strong>
              <div className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>
                {empresaNombre || 'Todas las empresas'} · {kpisCentros.total} centros de acopio · {matrizResponsables.length} responsables asignados
              </div>
            </div>

            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={abrirCentrosWhatsApp}
                title="Generar resumen ejecutivo de Centros y Responsables para WhatsApp"
                style={{ background: '#25D366', color: '#000', fontWeight: 700 }}
              >
                💬 WhatsApp Centros
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setModalExportarDocs(true)}
                title="Abrir reporte dinámico moldeable"
              >
                ✨ Reporte Dinámico
              </button>
            </div>
          </div>

          {/* KPIs Globales de Centros de Acopio */}
          <div className="adm-kpis" style={{ marginTop: '.75rem' }}>
            <div className="adm-kpi oro">
              <span className="adm-kpi-lbl">Centros de Acopio</span>
              <span className="adm-kpi-num">{kpisCentros.total}</span>
              <span className="adm-kpi-sub">Sedes y plantas activas</span>
            </div>
            <div className="adm-kpi">
              <span className="adm-kpi-lbl" style={{ color: '#10b981' }}>Centros al Día</span>
              <span className="adm-kpi-num" style={{ color: '#10b981' }}>{kpisCentros.alDia}</span>
              <span className="adm-kpi-sub">Permisología 100% vigente</span>
            </div>
            <div className="adm-kpi">
              <span className="adm-kpi-lbl" style={{ color: '#f59e0b' }}>En Regularización</span>
              <span className="adm-kpi-num" style={{ color: '#f59e0b' }}>{kpisCentros.atencion}</span>
              <span className="adm-kpi-sub">Trámites o prórrogas</span>
            </div>
            <div className="adm-kpi">
              <span className="adm-kpi-lbl" style={{ color: '#ef4444' }}>Alerta Crítica</span>
              <span className="adm-kpi-num" style={{ color: '#ef4444' }}>{kpisCentros.critico}</span>
              <span className="adm-kpi-sub">Permisos caducados</span>
            </div>
            <div className="adm-kpi">
              <span className="adm-kpi-lbl">Gastos Fijos Centros</span>
              <span className="adm-kpi-num">$ {num0(kpisCentros.gastoTotalUsd)}</span>
              <span className="adm-kpi-sub">presupuesto mensual total</span>
            </div>
          </div>

          {/* Sub-Botonera de Vista: Integral vs Solo Permisos vs Solo Gastos vs Responsables vs Historial */}
          <div className="card" style={{ marginTop: '.75rem', padding: '.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`btn btn-xs ${subVistaCentros === 'integral' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setSubVistaCentros('integral')}
                >
                  📊 Visión Integral (Documentos + Gastos)
                </button>
                <button
                  type="button"
                  className={`btn btn-xs ${subVistaCentros === 'documentos' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setSubVistaCentros('documentos')}
                >
                  📁 Solo Permisología y Fases
                </button>
                <button
                  type="button"
                  className={`btn btn-xs ${subVistaCentros === 'gastos' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setSubVistaCentros('gastos')}
                >
                  📌 Solo Gastos Fijos por Centro
                </button>
                <button
                  type="button"
                  className={`btn btn-xs ${subVistaCentros === 'responsables' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setSubVistaCentros('responsables')}
                >
                  👥 Responsables y Asignaciones ({matrizResponsablesFiltrada.length})
                </button>
                <button
                  type="button"
                  className={`btn btn-xs ${subVistaCentros === 'historial' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setSubVistaCentros('historial')}
                >
                  📜 Historial (¿Quién actualizó qué?)
                </button>
              </div>

              {/* Filtros Interactivos */}
              <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  className="input input-sm"
                  value={filtroCentroId}
                  onChange={(e) => setFiltroCentroId(e.target.value)}
                  style={{ fontSize: '.76rem', padding: '.2rem .4rem' }}
                >
                  <option value="todos">Todos los Centros</option>
                  {centrosFiltradosEmpresa.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>

                <select
                  className="input input-sm"
                  value={filtroResponsable}
                  onChange={(e) => setFiltroResponsable(e.target.value)}
                  style={{ fontSize: '.76rem', padding: '.2rem .4rem' }}
                >
                  <option value="todos">Todos los Responsables</option>
                  {listaResponsablesUnicos.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* VISTA 1 & 2 & 3: MATRIZ DE CENTROS DE ACOPIO Y FASES */}
          {(subVistaCentros === 'integral' || subVistaCentros === 'documentos' || subVistaCentros === 'gastos') && (
            <div style={{ marginTop: '.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '.75rem' }}>
              {matrizCentrosFiltrada.length === 0 ? (
                <div className="card" style={{ gridColumn: '1 / -1' }}>
                  <EmptyState icon="🏢" message="No se encontraron centros de acopio con los filtros seleccionados." />
                </div>
              ) : (
                matrizCentrosFiltrada.map((c) => {
                  const semaforoColor = c.semaforo === 'critico' ? '#ef4444' : c.semaforo === 'atencion' ? '#f59e0b' : '#10b981';
                  const semaforoIcon = c.semaforo === 'critico' ? '🔴' : c.semaforo === 'atencion' ? '🟡' : '🟢';

                  return (
                    <div
                      key={c.centroId}
                      className="card"
                      style={{
                        margin: 0,
                        padding: '.9rem 1.1rem',
                        borderLeft: `4px solid ${semaforoColor}`,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '.7rem',
                      }}
                    >
                      {/* Cabecera del Centro */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.4rem' }}>
                          <div>
                            <span style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.05em', color: '#ff8a00', fontWeight: 700 }}>
                              🏢 {c.empresaNombre} ({c.empresaClave})
                            </span>
                            <h3 style={{ margin: '.15rem 0 0', fontSize: '1.05rem', color: 'var(--text)' }}>
                              {c.centroNombre}
                            </h3>
                          </div>
                          <span
                            className="badge"
                            style={{
                              background: c.faseBg,
                              color: c.faseColor,
                              border: `1px solid ${c.faseColor}`,
                              fontSize: '.7rem',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {c.faseActual}
                          </span>
                        </div>

                        {/* Responsable Principal Asignado */}
                        <div style={{ marginTop: '.45rem', fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                          <span className="muted">👤 Responsable:</span>
                          <strong>{c.responsablePrincipal}</strong>
                        </div>
                      </div>

                      {/* Bloque Permisología (se muestra en 'integral' y 'documentos') */}
                      {(subVistaCentros === 'integral' || subVistaCentros === 'documentos') && (
                        <div style={{ background: 'var(--surface-2)', borderRadius: 6, padding: '.6rem .75rem', border: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.35rem' }}>
                            <span style={{ fontSize: '.74rem', fontWeight: 700, color: 'var(--text)' }}>
                              📋 Permisología Minera y Legal
                            </span>
                            <span style={{ fontSize: '.74rem', fontWeight: 700, color: semaforoColor }}>
                              {c.porcentajeCumplimientoDocs}% al día
                            </span>
                          </div>

                          {/* Barra de Progreso */}
                          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: '.4rem' }}>
                            <div style={{ width: `${c.porcentajeCumplimientoDocs}%`, height: '100%', background: semaforoColor, transition: 'width 0.3s' }} />
                          </div>

                          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', fontSize: '.7rem' }}>
                            <span style={{ color: '#10b981' }}>🟢 {c.docsVigentes} vigentes</span>
                            {c.docsPorVencer > 0 && <span style={{ color: '#f59e0b', fontWeight: 700 }}>🟡 {c.docsPorVencer} por vencer</span>}
                            {c.docsVencidos > 0 && <span style={{ color: '#ef4444', fontWeight: 700 }}>🔴 {c.docsVencidos} vencidos</span>}
                            {c.docsEnTramite > 0 && <span style={{ color: '#a855f7' }}>🟣 {c.docsEnTramite} en trámite</span>}
                          </div>
                        </div>
                      )}

                      {/* Bloque Gastos Fijos (se muestra en 'integral' y 'gastos') */}
                      {(subVistaCentros === 'integral' || subVistaCentros === 'gastos') && (
                        <div style={{ background: 'var(--surface-2)', borderRadius: 6, padding: '.6rem .75rem', border: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.25rem' }}>
                            <span style={{ fontSize: '.74rem', fontWeight: 700, color: 'var(--text)' }}>
                              💰 Gastos Fijos y Costos Recurrentes
                            </span>
                            <span style={{ fontSize: '.82rem', fontWeight: 800, color: '#ff8a00' }}>
                              $ {num0(c.montoMensualUsd)} <span style={{ fontSize: '.68rem', fontWeight: 400 }}>/ mes</span>
                            </span>
                          </div>
                          <div className="muted" style={{ fontSize: '.72rem' }}>
                            {c.gastosFijosTotal} servicio(s) presupuestado(s)
                            {c.serviciosGastos.length > 0 && (
                              <span style={{ display: 'block', marginTop: '.15rem', color: 'var(--text)' }}>
                                • {c.serviciosGastos.join(' · ')}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Diagnóstico Administrativo */}
                      <div style={{ fontSize: '.74rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                        <span>{semaforoIcon}</span>
                        <span className="muted" style={{ lineHeight: 1.25 }}>
                          {c.diagnostico}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* VISTA 4: DIRECTORIO DE RESPONSABLES (¿Quién es responsable de qué?) */}
          {subVistaCentros === 'responsables' && (
            <div style={{ marginTop: '.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '.75rem' }}>
              {matrizResponsablesFiltrada.length === 0 ? (
                <div className="card" style={{ gridColumn: '1 / -1' }}>
                  <EmptyState icon="👥" message="No se encontraron responsables con los filtros seleccionados." />
                </div>
              ) : (
                matrizResponsablesFiltrada.map((r) => {
                  const tieneCriticos = r.itemsCriticos > 0;
                return (
                  <div
                    key={r.responsable}
                    className="card"
                    style={{
                      margin: 0,
                      padding: '.85rem 1rem',
                      borderLeft: tieneCriticos ? '4px solid #ef4444' : '4px solid #10b981',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '.5rem',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '.95rem', color: 'var(--text)' }}>
                          👤 {r.responsable}
                        </h3>
                        <span className="adm-chip" style={{ fontSize: '.68rem' }}>
                          {r.nivelResponsabilidad === 'empresa_completa'
                            ? '🏢 Empresa Completa'
                            : r.nivelResponsabilidad === 'centro_acopio'
                            ? '🏭 Centro de Acopio'
                            : r.nivelResponsabilidad === 'gastos_fijos'
                            ? '💰 Gastos Fijos'
                            : '📑 Documentos Puntuales'}
                        </span>
                      </div>

                      <div className="muted" style={{ fontSize: '.74rem', marginTop: '.3rem' }}>
                        <strong>Empresas:</strong> {r.empresas.join(', ') || 'General'}
                        {r.centrosAcopio.length > 0 && (
                          <div style={{ marginTop: '.15rem' }}>
                            <strong>Centros bajo su custodia:</strong> {r.centrosAcopio.join(', ')}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', background: 'var(--surface-2)', padding: '.5rem .6rem', borderRadius: 6 }}>
                      <div>
                        <div className="muted hint" style={{ fontSize: '.68rem' }}>Documentos a cargo</div>
                        <div style={{ fontWeight: 700, fontSize: '.84rem' }}>
                          {r.documentosTotal} docs
                          {r.itemsCriticos > 0 && (
                            <span style={{ color: '#ef4444', marginLeft: '.3rem', fontSize: '.72rem' }}>
                              (⚠️ {r.itemsCriticos} por atender)
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="muted hint" style={{ fontSize: '.68rem' }}>Presupuesto Gastos</div>
                        <div style={{ fontWeight: 700, fontSize: '.84rem', color: '#ff8a00' }}>
                          $ {num0(r.presupuestoMensualUsd)}/mes
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }))}
            </div>
          )}

          {/* VISTA 5: TRAZABILIDAD E HISTORIAL (¿Quién actualiza qué documento?) */}
          {subVistaCentros === 'historial' && (
            <div className="card" style={{ marginTop: '.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem', flexWrap: 'wrap', gap: '.4rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '.95rem' }}>📜 Historial de Modificaciones y Auditoría</h3>
                  <p className="muted hint" style={{ margin: '.15rem 0 0', fontSize: '.74rem' }}>
                    Registro cronológico: quién actualizó qué documento, cuándo y qué acción realizó.
                  </p>
                </div>
                <input
                  type="search"
                  className="input input-sm"
                  placeholder="🔍 Buscar por usuario / actor o documento…"
                  value={busquedaHistorial}
                  onChange={(e) => setBusquedaHistorial(e.target.value)}
                  style={{ maxWidth: 280, fontSize: '.78rem' }}
                />
              </div>

              {historialAuditoria.length === 0 ? (
                <EmptyState icon="📜" message="No hay eventos en el historial que coincidan con la búsqueda." />
              ) : (
                <div className="adm-tabla" style={{ maxHeight: 380, overflowY: 'auto' }}>
                  <table>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 1 }}>
                      <tr>
                        <th>Fecha y Hora</th>
                        <th>Modificado por (Actor)</th>
                        <th>Documento / Permiso</th>
                        <th>Empresa</th>
                        <th>Responsable Asignado</th>
                        <th>Acción</th>
                        <th>Detalle del Cambio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historialAuditoria.map((h) => (
                        <tr key={h.id}>
                          <td className="mono" style={{ fontSize: '.72rem', whiteSpace: 'nowrap' }}>
                            {fFechaHora.format(new Date(h.fecha))}
                          </td>
                          <td>
                            <strong style={{ color: '#ff8a00', fontSize: '.82rem' }}>👤 {h.actor}</strong>
                          </td>
                          <td>
                            <div>
                              <strong style={{ fontSize: '.82rem' }}>{h.documentoNombre}</strong>
                              <div className="muted" style={{ fontSize: '.7rem' }}>{h.tipoLabel}</div>
                            </div>
                          </td>
                          <td>
                            <span className="badge" style={{ fontSize: '.68rem' }}>🏢 {h.empresaClave}</span>
                          </td>
                          <td>
                            <span style={{ fontSize: '.76rem' }}>{h.responsable || 'Sin asignar'}</span>
                          </td>
                          <td>
                            <span className="adm-chip" style={{ fontSize: '.68rem' }}>{h.accion}</span>
                          </td>
                          <td style={{ fontSize: '.76rem', color: 'var(--text)' }}>
                            {h.detalle}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      ) : ambito === 'documentos' ? (
        /* 3. ÁMBITO: Documentos, Permisos y Vencimientos */
        <>
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
            <div>
              <strong style={{ fontSize: '1.05rem', color: '#ff8a00' }}>
                📁 Control de Cumplimiento Legal, Permisos Mineros y Vencimientos
              </strong>
              <div className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>
                {empresaNombre || 'Todas las empresas'} · {docs.length} documentos registrados · {resumenDocs.cumplimientoPct}% cumplimiento general
              </div>
            </div>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setModalExportarDocs(true)}
                disabled={!docs.length}
                style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }}
                title="Abrir reporte interactivo con fichas ejecutivas, orientación y filtros"
              >
                ✨ Reporte Dinámico / Exportar
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void descargarDocsPdf()}
                disabled={!docs.length}
              >
                📄 PDF
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void descargarDocsExcel()}
                disabled={!docs.length}
              >
                📊 Excel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={abrirDocsWhatsApp}
                disabled={!docs.length}
                title="Compartir alerta de cumplimiento por WhatsApp"
              >
                💬 WhatsApp
              </button>
            </div>
          </div>

          {/* KPIs de Cumplimiento de Documentos */}
          <div className="adm-kpis" style={{ marginTop: '.75rem' }}>
            <div className="adm-kpi oro">
              <span className="adm-kpi-lbl">Total Documentos</span>
              <span className="adm-kpi-num">{resumenDocs.totalDocs}</span>
              <span className="adm-kpi-sub">{resumenDocs.cumplimientoPct}% cumplimiento legal</span>
            </div>
            <div className="adm-kpi">
              <span className="adm-kpi-lbl" style={{ color: '#10b981' }}>Vigentes al Día</span>
              <span className="adm-kpi-num" style={{ color: '#10b981' }}>{resumenDocs.vigentes}</span>
              <span className="adm-kpi-sub">+{resumenDocs.noVence} permanentes</span>
            </div>
            <div className="adm-kpi">
              <span className="adm-kpi-lbl" style={{ color: '#f59e0b' }}>Por Vencer (30d)</span>
              <span className="adm-kpi-num" style={{ color: '#f59e0b' }}>{resumenDocs.porVencer}</span>
              <span className="adm-kpi-sub">Atención preventiva</span>
            </div>
            <div className="adm-kpi">
              <span className="adm-kpi-lbl" style={{ color: '#ef4444' }}>Caducados / En Trámite</span>
              <span className="adm-kpi-num" style={{ color: resumenDocs.vencidos > 0 ? '#ef4444' : '#a855f7' }}>
                {resumenDocs.vencidos + resumenDocs.vencidosEnTramite}
              </span>
              <span className="adm-kpi-sub">
                {resumenDocs.vencidos} vencidos · {resumenDocs.vencidosEnTramite} en trámite
              </span>
            </div>
          </div>

          {/* Tabla Resumen por Carpetas */}
          <div className="card" style={{ marginTop: '.75rem' }}>
            <h3 style={{ margin: '0 0 .5rem', fontSize: '.95rem' }}>📂 Estado de Permisología por Carpetas</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="adm-tabla">
                <thead>
                  <tr>
                    <th>Carpeta</th>
                    <th style={{ textAlign: 'center' }}>Total</th>
                    <th style={{ textAlign: 'center' }}>Vigentes</th>
                    <th style={{ textAlign: 'center' }}>Por Vencer</th>
                    <th style={{ textAlign: 'center' }}>Caducados</th>
                    <th style={{ textAlign: 'center' }}>En Trámite</th>
                    <th style={{ textAlign: 'center' }}>Cumplimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {gruposDocs.map((g) => (
                    <tr key={g.claveGrupo}>
                      <td>
                        <strong>{g.icono} {g.tituloGrupo}</strong>
                      </td>
                      <td style={{ textAlign: 'center' }}>{g.totalDocs}</td>
                      <td style={{ textAlign: 'center', color: '#10b981', fontWeight: 600 }}>{g.vigentes}</td>
                      <td style={{ textAlign: 'center', color: '#f59e0b', fontWeight: 600 }}>{g.porVencer}</td>
                      <td style={{ textAlign: 'center', color: '#ef4444', fontWeight: 700 }}>{g.vencidos}</td>
                      <td style={{ textAlign: 'center', color: '#a855f7', fontWeight: 600 }}>{g.vencidosEnTramite}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>
                        <span style={{ color: g.cumplimientoPct === 100 ? '#10b981' : g.vencidos > 0 ? '#ef4444' : '#f59e0b' }}>
                          {g.cumplimientoPct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* 4. ÁMBITO: Gastos Fijos y Movimientos */
        <>
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ display: 'inline-flex', flexDirection: 'column', gap: '.2rem' }}>
                <span className="muted hint">Desde</span>
                <input type="date" className="input" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
              </label>
              <label style={{ display: 'inline-flex', flexDirection: 'column', gap: '.2rem' }}>
                <span className="muted hint">Hasta</span>
                <input type="date" className="input" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
              </label>
              <label style={{ display: 'inline-flex', flexDirection: 'column', gap: '.2rem' }}>
                <span className="muted hint">Moneda</span>
                <select className="input" value={moneda} onChange={(e) => setMoneda(e.target.value as '' | Moneda)}>
                  <option value="">Ambas</option><option value="USD">USD</option><option value="Bs">Bs</option>
                </select>
              </label>
              <label style={{ display: 'inline-flex', flexDirection: 'column', gap: '.2rem' }}>
                <span className="muted hint">Categoría</span>
                <select className="input" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} style={{ maxWidth: 170 }}>
                  <option value="">Todas</option>
                  {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </label>
              <label style={{ display: 'inline-flex', flexDirection: 'column', gap: '.2rem' }}>
                <span className="muted hint">Agrupar por</span>
                <select className="input" value={agruparPor} onChange={(e) => setAgruparPor(e.target.value as DimensionReporte)}>
                  {DIMENSIONES.map((d) => <option key={d} value={d}>{ETIQUETA_DIMENSION[d]}</option>)}
                </select>
              </label>
              {(desde || hasta || moneda || categoriaId) && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDesde(''); setHasta(''); setMoneda(''); setCategoriaId(''); }}>✕ Limpiar</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setModalExportar(true)} disabled={!movs.length} title="Abrir reporte dinámico con fichas ejecutivas, orientación y filtros">✨ Reporte Dinámico / Exportar</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void descargarPdf()} disabled={!filtrados.length}>📄 PDF</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void descargarExcel()} disabled={!filtrados.length}>📊 Excel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={abrirWhatsApp} disabled={!filtrados.length}
                title="Enviar el resumen por WhatsApp (o copiarlo)">💬 WhatsApp</button>
            </div>
          </div>

          {error && <div className="adm-aviso">No se pudo leer: {/sesi|jwt|auth|401|permission|relation|does not exist/i.test(error) ? 'inicia sesión o la base aún no tiene las tablas del módulo.' : error}</div>}

          {cargando ? (
            <div className="card"><p className="muted">Calculando el reporte…</p></div>
          ) : !filtrados.length && !error ? (
            <div className="card"><EmptyState icon="📊" message="No hay movimientos en este alcance. Ajuste los filtros o cargue el histórico en «Movimientos»." /></div>
          ) : (
            <>
              <div className="adm-kpis">
                <div className="adm-kpi oro">
                  <span className="adm-kpi-lbl">Total del período</span>
                  <span className="adm-kpi-num">$ {num0(total.equivUsd)}</span>
                  <span className="adm-kpi-sub">equivalente en USD · tasa {num0(tasa)}</span>
                </div>
                <div className="adm-kpi">
                  <span className="adm-kpi-lbl">En bolívares</span>
                  <span className="adm-kpi-num">{num0(total.bs)} <span className="adm-kpi-de">Bs</span></span>
                </div>
                <div className="adm-kpi">
                  <span className="adm-kpi-lbl">En dólares</span>
                  <span className="adm-kpi-num">$ {num0(total.usd)}</span>
                </div>
                <div className="adm-kpi">
                  <span className="adm-kpi-lbl">Movimientos</span>
                  <span className="adm-kpi-num">{total.n}</span>
                  <span className="adm-kpi-sub">{alcanceLabel}{empresaNombre ? ` · ${empresaNombre}` : ''}</span>
                </div>
              </div>

              <div className="adm-graficos">
                <div className="card adm-grafico">
                  <div className="adm-grafico-tit">Por {dim.toLowerCase()}</div>
                  <ul className="adm-barras">
                    {grupos.map((g) => (
                      <li key={g.clave}>
                        <span className="adm-barra-nom" title={g.clave}>{g.clave}</span>
                        <span className="adm-barra-pista"><span className="adm-barra-fill" style={{ width: `${Math.round((g.equivUsd / maxVal) * 100)}%` }} /></span>
                        <span className="adm-barra-val">$ {num0(g.equivUsd)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card adm-grafico">
                  <div className="adm-grafico-tit">Detalle · {dim}</div>
                  <div className="adm-tabla">
                    <table>
                      <thead>
                        <tr><th>{dim}</th><th style={{ textAlign: 'right' }}>Bs</th><th style={{ textAlign: 'right' }}>USD</th><th style={{ textAlign: 'right' }}>Equiv. $</th><th style={{ textAlign: 'right' }}>Mov.</th></tr>
                      </thead>
                      <tbody>
                        {grupos.map((g) => (
                          <tr key={g.clave}>
                            <td>{g.clave}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{monto2(g.bs)}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{monto2(g.usd)}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{num0(g.equivUsd)}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{g.n}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {modalExportar && (
        <ExportarAdministracionModal
          movimientos={movs}
          empresas={empresas}
          categorias={categorias}
          empresaClaveInicial={empresaClave}
          tasaBcvHoy={tasa}
          onClose={() => setModalExportar(false)}
        />
      )}

      {modalExportarDocs && (
        <ExportarDocumentosModal
          documentos={docs}
          empresas={empresas}
          empresaClaveInicial={empresaClave}
          onClose={() => setModalExportarDocs(false)}
        />
      )}

      {wsp != null && (
        <WhatsAppReporteModal titulo={`Reporte · ${alcanceLabel}`} texto={wsp} onClose={() => setWsp(null)} />
      )}
    </div>
  );
}
