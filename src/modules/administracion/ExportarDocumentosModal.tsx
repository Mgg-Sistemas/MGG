/* ============================================================
   Golden Touch · Administración · Diálogo de Reporte Dinámico de Documentos
   (04/11/2026)

   Modal interactivo para control de documentos, permisos mineros, caducidades
   y cumplimiento legal:
     - Presets de caducidad (Todos, Críticos, 15d, 30d, 90d, Vencidos, En trámite, Vigentes).
     - Agrupación multidimensional (Carpeta, Status, Horizonte, Empresa, Socio, Tipo, Detallado).
     - Tarjetas ejecutivas interactivas con checkbox de inclusión/exclusión puntual
       (estilo fiel al módulo de Combustible y Tesorería).
     - Dualidad Fichas Ejecutivas vs Tabla Tabular y orientación Horizontal/Vertical.
     - Botón «Imprimir» optimizado con @media print (sin hojas en blanco).
     - Descarga PDF (jsPDF + autotable), Excel con formato, CSV plano y WhatsApp.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import type { Empresa, DocumentoEmpresa, StatusVencimiento } from './admin.repository';
import {
  CARPETAS_DOCUMENTOS,
  STATUS_VENCIMIENTO_LABEL,
  STATUS_VENCIMIENTO_COLOR,
} from './admin.repository';
import {
  MODOS_AGRUPACION_DOC,
  PRESETS_CADUCIDAD_DOC,
  CAMPOS_DEFECTO_DOC,
  ETIQUETA_MODO_DOC,
  normalizarDocumentosAdmin,
  filtrarDocumentosAdmin,
  calcularResumenDocs,
  agruparDocumentosAdmin,
  obtenerMetricasFichaDoc,
  obtenerTituloRangoDoc,
  type ModoAgrupacionDoc,
  type PresetCaducidadDoc,
} from './reporteDocumentosMoldeable';
import {
  descargarDocumentosPdf,
  descargarDocumentosExcel,
  descargarDocumentosCsv,
  generarTextoWhatsappDocs,
} from './exportarDocumentos';

const CLAVE_DOC_AGRUPACION = 'admin.doc_reporte.agrupacion.v1';
const CLAVE_DOC_FORMATO = 'admin.doc_reporte.formato.v1';
const CLAVE_DOC_ORIENTACION = 'admin.doc_reporte.orientacion.v1';

interface Props {
  documentos: DocumentoEmpresa[];
  empresas: Empresa[];
  empresaClaveInicial?: string | null;
  onClose: () => void;
}

export function ExportarDocumentosModal({
  documentos,
  empresas,
  empresaClaveInicial,
  onClose,
}: Props) {
  // 1. Preset y Fechas
  const [preset, setPreset] = useState<PresetCaducidadDoc>('todos');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  // 2. Dimensión de Agrupación
  const [agrupacion, setAgrupacion] = useState<ModoAgrupacionDoc>(() => {
    try {
      const g = localStorage.getItem(CLAVE_DOC_AGRUPACION) as ModoAgrupacionDoc;
      if (g && MODOS_AGRUPACION_DOC.some((m) => m.id === g)) return g;
    } catch { /* default */ }
    return 'carpeta';
  });

  // 3. Formato y Orientación
  const [formato, setFormato] = useState<'fichas' | 'tabla'>(() => {
    try {
      const f = localStorage.getItem(CLAVE_DOC_FORMATO);
      if (f === 'fichas' || f === 'tabla') return f;
    } catch { /* default */ }
    return 'fichas';
  });

  const [orientacion, setOrientacion] = useState<'landscape' | 'portrait'>(() => {
    try {
      const o = localStorage.getItem(CLAVE_DOC_ORIENTACION);
      if (o === 'landscape' || o === 'portrait') return o;
    } catch { /* default */ }
    return 'landscape';
  });

  // 4. Filtros interactivos
  const [empresaFiltro, setEmpresaFiltro] = useState<string>(empresaClaveInicial || 'todas');
  const [carpetaFiltro, setCarpetaFiltro] = useState<string>('todas');
  const [statusFiltro, setStatusFiltro] = useState<string>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [soloConSocio, setSoloConSocio] = useState(false);

  // 5. Inclusión puntual de tarjetas (Set de claves de grupos seleccionados)
  const [excluidos, setExcluidos] = useState<Set<string>>(() => new Set());

  // 6. Checkboxes de secciones
  const [incluirTarjetas, setIncluirTarjetas] = useState(true);
  const [incluirDetalle, setIncluirDetalle] = useState(true);
  const [incluirResumen, setIncluirResumen] = useState(true);

  // 7. WhatsApp modal
  const [verWhatsapp, setVerWhatsapp] = useState(false);
  const [descargando, setDescargando] = useState(false);

  // Guardar preferencias
  useEffect(() => {
    try { localStorage.setItem(CLAVE_DOC_AGRUPACION, agrupacion); } catch { /* ignore */ }
  }, [agrupacion]);
  useEffect(() => {
    try { localStorage.setItem(CLAVE_DOC_FORMATO, formato); } catch { /* ignore */ }
  }, [formato]);
  useEffect(() => {
    try { localStorage.setItem(CLAVE_DOC_ORIENTACION, orientacion); } catch { /* ignore */ }
  }, [orientacion]);

  // Normalizar datos
  const todasFilas = useMemo(() => normalizarDocumentosAdmin(documentos, empresas), [documentos, empresas]);

  // Filtrar
  const filasFiltradas = useMemo(() => {
    return filtrarDocumentosAdmin(todasFilas, {
      carpetasSeleccionadas: carpetaFiltro !== 'todas' ? [carpetaFiltro] : undefined,
      statusSeleccionados: statusFiltro !== 'todos' ? [statusFiltro as StatusVencimiento] : undefined,
      empresasSeleccionadas: empresaFiltro !== 'todas' ? [empresaFiltro] : undefined,
      presetCaducidad: preset,
      desdeVenc: desde || undefined,
      hastaVenc: hasta || undefined,
      busquedaTexto: busqueda,
      soloConSocio,
    });
  }, [todasFilas, carpetaFiltro, statusFiltro, empresaFiltro, preset, desde, hasta, busqueda, soloConSocio]);

  // Agrupar
  const todosGrupos = useMemo(
    () => agruparDocumentosAdmin(filasFiltradas, agrupacion),
    [filasFiltradas, agrupacion],
  );

  // Grupos activos (excluyendo los no seleccionados por el usuario)
  const gruposActivos = useMemo(
    () => todosGrupos.filter((g) => !excluidos.has(g.claveGrupo)),
    [todosGrupos, excluidos],
  );

  // Filas activas consolidadas
  const filasActivas = useMemo(
    () => gruposActivos.flatMap((g) => g.documentos),
    [gruposActivos],
  );

  // Resumen calculado en tiempo real
  const resumen = useMemo(
    () => calcularResumenDocs(filasActivas, gruposActivos.length),
    [filasActivas, gruposActivos.length],
  );

  // Título explicativo grande centrado
  const tituloRangoGrande = useMemo(
    () => obtenerTituloRangoDoc(preset, desde, hasta),
    [preset, desde, hasta],
  );

  // Nombre de empresa para el reporte
  const nombreEmpresaActual = useMemo(() => {
    if (empresaFiltro === 'todas') return 'Todas las empresas';
    return empresas.find((e) => e.clave === empresaFiltro)?.nombre || empresaFiltro;
  }, [empresaFiltro, empresas]);

  // Manejo de inclusión / exclusión puntual de tarjeta
  const alternarTarjeta = (clave: string) => {
    setExcluidos((prev) => {
      const next = new Set(prev);
      if (next.has(clave)) next.delete(clave);
      else next.add(clave);
      return next;
    });
  };

  const seleccionarTodos = () => setExcluidos(new Set());
  const deseleccionarTodos = () => setExcluidos(new Set(todosGrupos.map((g) => g.claveGrupo)));

  // Texto para WhatsApp
  const textoWhatsapp = useMemo(() => {
    return generarTextoWhatsappDocs({
      filas: filasActivas,
      grupos: gruposActivos,
      resumen,
      periodoLabel: tituloRangoGrande,
      empresaNombre: nombreEmpresaActual,
    });
  }, [filasActivas, gruposActivos, resumen, tituloRangoGrande, nombreEmpresaActual]);

  // Descargas
  const handlePdf = async () => {
    try {
      setDescargando(true);
      await descargarDocumentosPdf({
        filas: filasActivas,
        grupos: gruposActivos,
        resumen,
        columnas: CAMPOS_DEFECTO_DOC,
        tituloRango: tituloRangoGrande,
        periodoLabel: tituloRangoGrande,
        empresaNombre: nombreEmpresaActual,
        empresaClave: empresaFiltro !== 'todas' ? empresaFiltro : null,
        modoAgrupacion: agrupacion,
        orientacion,
        formatoPresentacion: formato,
        incluirTarjetas,
        incluirDetalle,
        incluirResumen,
      });
      toast('PDF de documentos generado exitosamente', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al exportar PDF', 'error');
    } finally {
      setDescargando(false);
    }
  };

  const handleExcel = async () => {
    try {
      setDescargando(true);
      await descargarDocumentosExcel({
        filas: filasActivas,
        grupos: gruposActivos,
        resumen,
        periodoLabel: tituloRangoGrande,
        empresaNombre: nombreEmpresaActual,
      });
      toast('Excel de documentos exportado exitosamente', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al exportar Excel', 'error');
    } finally {
      setDescargando(false);
    }
  };

  const handleCsv = () => {
    try {
      descargarDocumentosCsv(filasActivas, nombreEmpresaActual);
      toast('CSV de documentos exportado exitosamente', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al exportar CSV', 'error');
    }
  };

  // Estilos inline consistentes con el diseño del sistema
  const surf2 = {
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '.75rem',
  };
  const tituloSec = {
    fontSize: '.75rem',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '.06em',
    color: '#ff8a00',
    display: 'flex',
    alignItems: 'center',
    gap: '.4rem',
  };

  return (
    <Modal
      title="✨ Reporte Dinámico de Documentos, Permisología y Vencimientos"
      onClose={onClose}
      size="xl"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', fontSize: '.82rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={incluirResumen} onChange={(e) => setIncluirResumen(e.target.checked)} />
              <span>Resumen / KPIs</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={incluirTarjetas} onChange={(e) => setIncluirTarjetas(e.target.checked)} />
              <span>Tarjetas Ejecutivas</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={incluirDetalle} onChange={(e) => setIncluirDetalle(e.target.checked)} />
              <span>Inventario Detallado</span>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setVerWhatsapp((v) => !v)}
              title="Ver y compartir por WhatsApp"
            >
              💬 WhatsApp
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleCsv}
              disabled={!filasActivas.length}
              title="Descargar archivo plano CSV con delimitador punto y coma"
            >
              📄 CSV
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void handleExcel()}
              disabled={!filasActivas.length || descargando}
              title="Descargar libro Excel con hojas de Resumen y Detalle"
            >
              📊 Descargar Excel
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void handlePdf()}
              disabled={!filasActivas.length || descargando}
              title="Descargar documento PDF con membrete oficial"
            >
              📄 Descargar PDF
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => window.print()}
              disabled={!filasActivas.length}
              style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }}
              title="Imprimir el reporte directamente con formato limpio"
            >
              🖨️ Imprimir
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem', color: 'var(--text)' }}>
        {/* Estilos dedicados para impresión directa (@media print) sin páginas en blanco */}
        <style>{`
          @media print {
            @page {
              size: ${orientacion === 'portrait' ? 'letter portrait' : 'letter landscape'};
              margin: 5mm 6mm;
            }
            html, body {
              background: #ffffff !important;
              color: #0f172a !important;
              overflow: visible !important;
              height: auto !important;
            }
            .modal-backdrop {
              position: static !important;
              inset: auto !important;
              display: block !important;
              background: transparent !important;
              backdrop-filter: none !important;
              padding: 0 !important;
              margin: 0 !important;
              overflow: visible !important;
              height: auto !important;
              max-height: none !important;
            }
            .modal {
              position: static !important;
              display: block !important;
              background: #ffffff !important;
              border: none !important;
              box-shadow: none !important;
              width: 100% !important;
              max-width: 100% !important;
              height: auto !important;
              max-height: none !important;
              overflow: visible !important;
              padding: 0 !important;
              margin: 0 !important;
            }
            .modal-header, .modal-footer, .no-print {
              display: none !important;
            }
            .modal-body {
              overflow: visible !important;
              height: auto !important;
              max-height: none !important;
              display: block !important;
              padding: 0 !important;
              margin: 0 !important;
            }
            body * {
              visibility: hidden !important;
            }
            .reporte-print, .reporte-print * {
              visibility: visible !important;
            }
            .reporte-print {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              display: block !important;
              width: 100% !important;
              max-width: 100% !important;
              background: #ffffff !important;
              color: #0f172a !important;
              --text: #0f172a !important;
              --surface: #ffffff !important;
              --surface-1: #ffffff !important;
              --surface-2: #f8fafc !important;
              --border: #e2e8f0 !important;
              margin: 0 !important;
              padding: 0 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .kpi-hero-card {
              background: #f8fafc !important;
              border: 2px solid #ff8a00 !important;
              box-shadow: none !important;
              color: #0f172a !important;
              padding: .5rem !important;
              margin-bottom: .6rem !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .admin-card-item {
              border: 2px solid #ff8a00 !important;
              background: #ffffff !important;
              color: #0f172a !important;
              box-shadow: none !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .badge-incluido {
              background: rgba(16, 185, 129, 0.15) !important;
              color: #10b981 !important;
              border-color: #10b981 !important;
            }
          }
        `}</style>

        {/* Panel emergente de WhatsApp */}
        {verWhatsapp && (
          <div className="no-print" style={{ ...surf2, borderColor: '#25D366' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem', flexWrap: 'wrap', gap: '.4rem' }}>
              <span style={tituloSec}>💬 Compartir Cumplimiento Minero por WhatsApp</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setVerWhatsapp(false)}>
                ✕ Cerrar
              </button>
            </div>
            <p className="muted" style={{ fontSize: '.76rem', margin: '0 0 .5rem' }}>
              Alerta ejecutiva estructurada con % de cumplimiento, documentos vencidos, en trámite y desglose por carpetas.
            </p>
            <CompartirWhatsapp texto={textoWhatsapp} />
          </div>
        )}

        {/* 1. SECCIÓN SUPERIOR: Controles y Filtros Dinámicos (no-print) */}
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {/* Fila 1: Presets de Caducidad y Selector de Fechas */}
          <div style={{ ...surf2, display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
              <span style={tituloSec}>⏳ Filtro y Horizonte de Caducidad / Vencimiento</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.78rem' }}>
                <span className="muted">Empresa:</span>
                <select
                  className="input input-sm"
                  value={empresaFiltro}
                  onChange={(e) => setEmpresaFiltro(e.target.value)}
                  style={{ minWidth: 160 }}
                >
                  <option value="todas">Todas las empresas</option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.clave}>
                      {e.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Botonera de presets */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
              {PRESETS_CADUCIDAD_DOC.map((p) => {
                const activo = preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPreset(p.id);
                      if (p.id !== 'personalizado') {
                        setDesde('');
                        setHasta('');
                      }
                    }}
                    style={{
                      background: activo ? '#ff8a00' : 'var(--surface-1)',
                      color: activo ? '#000' : 'var(--text)',
                      fontWeight: activo ? 700 : 500,
                      border: activo ? '1px solid #ff8a00' : '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '.25rem .55rem',
                      fontSize: '.74rem',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    title={p.desc}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Inputs de fechas si es personalizado o para afinar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem', flexWrap: 'wrap', marginTop: '.2rem' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.78rem' }}>
                <span className="muted">Vence Desde:</span>
                <input
                  type="date"
                  className="input input-sm"
                  value={desde}
                  onChange={(e) => {
                    setDesde(e.target.value);
                    setPreset('personalizado');
                  }}
                  style={{ width: 140 }}
                />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.78rem' }}>
                <span className="muted">Vence Hasta:</span>
                <input
                  type="date"
                  className="input input-sm"
                  value={hasta}
                  onChange={(e) => {
                    setHasta(e.target.value);
                    setPreset('personalizado');
                  }}
                  style={{ width: 140 }}
                />
              </label>

              {(desde || hasta) && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => {
                    setDesde('');
                    setHasta('');
                    setPreset('todos');
                  }}
                >
                  ✕ Limpiar fechas
                </button>
              )}
            </div>
          </div>

          {/* Fila 2: Dimensión de Agrupación, Formato y Filtros Secundarios */}
          <div style={{ ...surf2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.75rem' }}>
            {/* Dimensión de Agrupación */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
              <span style={tituloSec}>📂 Agrupar por:</span>
              <div className="view-toggle" role="tablist">
                {MODOS_AGRUPACION_DOC.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={agrupacion === m.id ? 'active' : ''}
                    onClick={() => {
                      setAgrupacion(m.id);
                      setExcluidos(new Set()); // resetear exclusiones al cambiar dimensión
                    }}
                    style={{ fontSize: '.76rem', padding: '.25rem .55rem' }}
                  >
                    <span>{m.icon}</span> {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Formato y Orientación */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
              {/* Toggle Fichas vs Tabla */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
                <span className="muted" style={{ fontSize: '.76rem' }}>Vista:</span>
                <div className="view-toggle">
                  <button
                    type="button"
                    className={formato === 'fichas' ? 'active' : ''}
                    onClick={() => setFormato('fichas')}
                    style={{ fontSize: '.76rem', padding: '.25rem .55rem' }}
                  >
                    🏷️ Fichas
                  </button>
                  <button
                    type="button"
                    className={formato === 'tabla' ? 'active' : ''}
                    onClick={() => setFormato('tabla')}
                    style={{ fontSize: '.76rem', padding: '.25rem .55rem' }}
                  >
                    📑 Tabla
                  </button>
                </div>
              </div>

              {/* Toggle Orientación */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
                <span className="muted" style={{ fontSize: '.76rem' }}>Página:</span>
                <div className="view-toggle">
                  <button
                    type="button"
                    className={orientacion === 'landscape' ? 'active' : ''}
                    onClick={() => setOrientacion('landscape')}
                    style={{ fontSize: '.76rem', padding: '.25rem .55rem' }}
                    title="Horizontal (ideal para tablas y dashboards)"
                  >
                    ↔ Horizontal
                  </button>
                  <button
                    type="button"
                    className={orientacion === 'portrait' ? 'active' : ''}
                    onClick={() => setOrientacion('portrait')}
                    style={{ fontSize: '.76rem', padding: '.25rem .55rem' }}
                    title="Vertical (ideal para informes impresos)"
                  >
                    ↕ Vertical
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Fila 3: Filtros rápidos (Carpeta, Status, Búsqueda, Solo Socios) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap', padding: '0 .25rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.78rem' }}>
              <span className="muted">Carpeta:</span>
              <select
                className="input input-sm"
                value={carpetaFiltro}
                onChange={(e) => setCarpetaFiltro(e.target.value)}
                style={{ minWidth: 170 }}
              >
                <option value="todas">Todas las carpetas</option>
                {CARPETAS_DOCUMENTOS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.78rem' }}>
              <span className="muted">Estatus:</span>
              <select
                className="input input-sm"
                value={statusFiltro}
                onChange={(e) => setStatusFiltro(e.target.value)}
                style={{ minWidth: 150 }}
              >
                <option value="todos">Todos los estatus</option>
                <option value="vigente">🟢 Vigente</option>
                <option value="por_vencer">🟡 Por Vencer</option>
                <option value="vencido">🔴 Vencido</option>
                <option value="vencido_en_tramite">🟣 Vencido en Trámite</option>
                <option value="no_vence">⚪ No Vence</option>
              </select>
            </label>

            <input
              type="search"
              className="input input-sm"
              placeholder="Buscar por nombre, socio, ente o radicado…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ minWidth: 230, flex: 1 }}
            />

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.78rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={soloConSocio}
                onChange={(e) => setSoloConSocio(e.target.checked)}
              />
              <span>Solo con Socio asignado</span>
            </label>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem' }}>
              <button type="button" className="btn btn-ghost btn-xs" onClick={seleccionarTodos}>
                ✓ Incluir Todas
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={deseleccionarTodos}>
                ✕ Excluir Todas
              </button>
            </div>
          </div>
        </div>

        {/* 2. SECCIÓN IMPRIMIBLE: Contenedor con clase .reporte-print para @media print */}
        <div className="reporte-print" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Cabecera del Documento (Impresión y Vista) */}
          <div style={{ textAlign: 'center', margin: '.2rem 0 .4rem' }}>
            <div style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#ff8a00' }}>
              {nombreEmpresaActual.toUpperCase()} · CONTROL DE DOCUMENTOS Y PERMISOLOGÍA
            </div>
            <h2 style={{ margin: '.25rem 0 .2rem', fontSize: '1.45rem', fontWeight: 800 }}>
              {tituloRangoGrande}
            </h2>
            <div className="muted" style={{ fontSize: '.82rem' }}>
              Agrupado por: <strong>{ETIQUETA_MODO_DOC[agrupacion]}</strong> · {resumen.totalDocs} documento(s) analizado(s)
            </div>
          </div>

          {/* 3. HERO KPIS BANNER (4 bloques con borde naranja corporativo y acentos de color) */}
          {incluirResumen && (
            <div
              className="kpi-hero-card"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '.75rem',
                border: '2px solid #ff8a00',
                borderRadius: 10,
                padding: '.75rem 1rem',
                background: 'var(--surface-2)',
              }}
            >
              {/* KPI 1: Total Documentos & Cumplimiento */}
              <div style={{ borderLeft: '4px solid #ff8a00', paddingLeft: '.75rem' }}>
                <div style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  TOTAL DOCUMENTOS
                </div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ff8a00', lineHeight: 1.15, marginTop: '.2rem' }}>
                  {resumen.totalDocs}
                </div>
                <div style={{ fontSize: '.72rem', color: '#10b981', fontWeight: 600, marginTop: '.15rem' }}>
                  {resumen.cumplimientoPct}% cumplimiento legal
                </div>
              </div>

              {/* KPI 2: Vigentes / Al día */}
              <div style={{ borderLeft: '4px solid #10b981', paddingLeft: '.75rem' }}>
                <div style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  VIGENTES AL DÍA
                </div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10b981', lineHeight: 1.15, marginTop: '.2rem' }}>
                  {resumen.vigentes}
                </div>
                <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: '.15rem' }}>
                  +{resumen.noVence} permanentes (sin venc.)
                </div>
              </div>

              {/* KPI 3: Por Vencer */}
              <div style={{ borderLeft: '4px solid #f59e0b', paddingLeft: '.75rem' }}>
                <div style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  POR VENCER (PRÓX. 30D)
                </div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f59e0b', lineHeight: 1.15, marginTop: '.2rem' }}>
                  {resumen.porVencer}
                </div>
                <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: '.15rem' }}>
                  Planificar renovación oportuna
                </div>
              </div>

              {/* KPI 4: Caducados / Vencidos en Trámite */}
              <div style={{ borderLeft: '4px solid #ef4444', paddingLeft: '.75rem' }}>
                <div style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  CADUCADOS / EN TRÁMITE
                </div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: resumen.vencidos > 0 ? '#ef4444' : '#a855f7', lineHeight: 1.15, marginTop: '.2rem' }}>
                  {resumen.vencidos + resumen.vencidosEnTramite}
                </div>
                <div style={{ fontSize: '.72rem', color: resumen.vencidos > 0 ? '#ef4444' : '#a855f7', fontWeight: 600, marginTop: '.15rem' }}>
                  {resumen.vencidos} caducados · {resumen.vencidosEnTramite} en trámite
                </div>
              </div>
            </div>
          )}

          {/* 4. VISTA DE FICHAS EJECUTIVAS: Grid de Tarjetas Interactivas con borde naranja */}
          {incluirTarjetas && formato === 'fichas' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text)' }}>
                  TARJETAS EJECUTIVAS POR {ETIQUETA_MODO_DOC[agrupacion].toUpperCase()}
                </span>
                <span className="muted" style={{ fontSize: '.72rem' }}>
                  Haz clic en cualquier tarjeta o casilla para incluirla o excluirla del reporte
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    orientacion === 'landscape'
                      ? 'repeat(auto-fill, minmax(280px, 1fr))'
                      : 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: '.75rem',
                }}
              >
                {todosGrupos.map((g) => {
                  const estaExcluido = excluidos.has(g.claveGrupo);
                  const ficha = obtenerMetricasFichaDoc(g);

                  return (
                    <div
                      key={g.claveGrupo}
                      className="admin-card-item"
                      onClick={() => alternarTarjeta(g.claveGrupo)}
                      style={{
                        border: estaExcluido ? '1px dashed var(--border)' : `2px solid ${ficha.alertaCritica ? '#ef4444' : '#ff8a00'}`,
                        borderRadius: 8,
                        padding: '.65rem .75rem',
                        background: estaExcluido ? 'var(--surface-1)' : 'var(--surface-2)',
                        opacity: estaExcluido ? 0.45 : 1,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '.45rem',
                        position: 'relative',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* Cabecera de la tarjeta: Título + Checkbox / Badge */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 700, fontSize: '.85rem' }}>
                          <input
                            type="checkbox"
                            checked={!estaExcluido}
                            onChange={(e) => {
                              e.stopPropagation();
                              alternarTarjeta(g.claveGrupo);
                            }}
                            style={{ cursor: 'pointer' }}
                          />
                          <span>{g.icono}</span>
                          <span style={{ wordBreak: 'break-word' }}>{g.tituloGrupo}</span>
                        </div>

                        {/* Badge de estatus dominante */}
                        <span
                          className={!estaExcluido ? 'badge-incluido' : ''}
                          style={{
                            fontSize: '.66rem',
                            fontWeight: 700,
                            padding: '.15rem .45rem',
                            borderRadius: 999,
                            background: estaExcluido ? 'var(--surface-1)' : ficha.badgeBg,
                            color: estaExcluido ? 'var(--text-muted)' : ficha.badgeColor,
                            border: `1px solid ${estaExcluido ? 'var(--border)' : ficha.badgeColor}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {!estaExcluido ? `✓ ${ficha.badgeTexto}` : 'Excluido'}
                        </span>
                      </div>

                      {/* Métricas y subtítulo */}
                      <div style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>
                        {ficha.subtitulo}
                      </div>

                      {/* Barra de progreso de cumplimiento */}
                      <div style={{ width: '100%', height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${ficha.cumplimientoPct}%`,
                            height: '100%',
                            background: ficha.cumplimientoPct === 100 ? '#10b981' : ficha.alertaCritica ? '#ef4444' : '#f59e0b',
                          }}
                        />
                      </div>

                      {/* Chips de conteo rápido */}
                      <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', fontSize: '.68rem' }}>
                        {g.vigentes > 0 && (
                          <span style={{ padding: '.1rem .35rem', borderRadius: 4, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                            🟢 {g.vigentes} vigentes
                          </span>
                        )}
                        {g.porVencer > 0 && (
                          <span style={{ padding: '.1rem .35rem', borderRadius: 4, background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
                            🟡 {g.porVencer} por vencer
                          </span>
                        )}
                        {g.vencidos > 0 && (
                          <span style={{ padding: '.1rem .35rem', borderRadius: 4, background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                            🔴 {g.vencidos} caducados
                          </span>
                        )}
                        {g.vencidosEnTramite > 0 && (
                          <span style={{ padding: '.1rem .35rem', borderRadius: 4, background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
                            🟣 {g.vencidosEnTramite} en trámite
                          </span>
                        )}
                      </div>

                      {/* Vista previa de los 2 primeros documentos */}
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.35rem', display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                        {g.documentos.slice(0, 2).map((d) => (
                          <div key={d.id} style={{ fontSize: '.7rem', display: 'flex', justifyContent: 'space-between', gap: '.4rem', color: 'var(--text)' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              • {d.nombre}
                            </span>
                            <span style={{ fontSize: '.65rem', color: STATUS_VENCIMIENTO_COLOR[d.statusVencimiento]?.color || '#10b981', whiteSpace: 'nowrap' }}>
                              {d.fechaVencimiento || 'No vence'}
                            </span>
                          </div>
                        ))}
                        {g.documentos.length > 2 && (
                          <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                            +{g.documentos.length - 2} más…
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 5. VISTA DE TABLA TABULAR (Si se eligió Tabla o si se marcó Incluir Detalle) */}
          {(formato === 'tabla' || incluirDetalle) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text)' }}>
                  INVENTARIO DETALLADO DE DOCUMENTOS Y CADUCIDADES ({filasActivas.length})
                </span>
                <span className="muted" style={{ fontSize: '.72rem' }}>
                  Mostrando documentos incluidos en los filtros y tarjetas activas
                </span>
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
                  <thead>
                    <tr style={{ background: '#ff8a00', color: '#000', fontWeight: 800 }}>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>Carpeta</th>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>Documento / Trámite</th>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>Socio / Titular</th>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>N° Registro / Radicado</th>
                      <th style={{ padding: '.5rem', textAlign: 'center' }}>F. Emisión</th>
                      <th style={{ padding: '.5rem', textAlign: 'center' }}>F. Vence</th>
                      <th style={{ padding: '.5rem', textAlign: 'center' }}>Días Rest.</th>
                      <th style={{ padding: '.5rem', textAlign: 'center' }}>Estado Legal</th>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>Observación / Trámite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasActivas.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                          No hay documentos que coincidan con los filtros o todas las tarjetas fueron excluidas.
                        </td>
                      </tr>
                    ) : (
                      filasActivas.map((f, idx) => {
                        const esPar = idx % 2 === 0;
                        const stCfg = STATUS_VENCIMIENTO_COLOR[f.statusVencimiento] || {
                          color: '#10b981',
                          bg: 'rgba(16, 185, 129, 0.15)',
                          border: '#10b981',
                        };

                        return (
                          <tr
                            key={f.id}
                            style={{
                              background: esPar ? 'var(--surface-1)' : 'var(--surface-2)',
                              borderBottom: '1px solid var(--border)',
                            }}
                          >
                            <td style={{ padding: '.45rem .5rem', fontWeight: 600 }}>
                              {f.carpetaNombre}
                            </td>
                            <td style={{ padding: '.45rem .5rem', fontWeight: 700 }}>
                              {f.nombre}
                              {f.entidadEmisora && (
                                <span style={{ display: 'block', fontSize: '.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                                  Ente: {f.entidadEmisora}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '.45rem .5rem' }}>
                              {f.socioNombre ? (
                                <span style={{ padding: '.15rem .35rem', borderRadius: 4, background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', fontWeight: 600 }}>
                                  👤 {f.socioNombre}
                                </span>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td style={{ padding: '.45rem .5rem', fontFamily: 'monospace', fontSize: '.74rem' }}>
                              {f.numeroRegistro || '—'}
                            </td>
                            <td style={{ padding: '.45rem .5rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              {f.fechaEmision || '—'}
                            </td>
                            <td style={{ padding: '.45rem .5rem', textAlign: 'center', whiteSpace: 'nowrap', fontWeight: 700 }}>
                              {f.fechaVencimiento || 'No Vence'}
                            </td>
                            <td style={{ padding: '.45rem .5rem', textAlign: 'center', fontWeight: 800, color: stCfg.color }}>
                              {f.diasRestantes === null
                                ? '—'
                                : f.diasRestantes < 0
                                ? `${f.diasRestantes}d`
                                : `+${f.diasRestantes}d`}
                            </td>
                            <td style={{ padding: '.45rem .5rem', textAlign: 'center' }}>
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '.15rem .45rem',
                                  borderRadius: 999,
                                  fontSize: '.68rem',
                                  fontWeight: 700,
                                  background: stCfg.bg,
                                  color: stCfg.color,
                                  border: `1px solid ${stCfg.border}`,
                                }}
                              >
                                {STATUS_VENCIMIENTO_LABEL[f.statusVencimiento] || f.statusVencimiento}
                              </span>
                            </td>
                            <td style={{ padding: '.45rem .5rem', fontSize: '.72rem' }}>
                              {f.notaTramite || <span className="muted">—</span>}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pie del reporte en impresión */}
          <div style={{ textAlign: 'center', marginTop: '.5rem', fontSize: '.72rem', color: 'var(--text-muted)' }}>
            Mineral Group Guayana C.A. · Sistema de Gestión y Control Administrativo · Generado el {new Intl.DateTimeFormat('es-VE', { dateStyle: 'full', timeStyle: 'short' }).format(new Date())}
          </div>
        </div>
      </div>
    </Modal>
  );
}
