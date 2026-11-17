/* ============================================================
   Golden Touch · Administración · Diálogo de Reporte Dinámico y Exportación
   (04/11/2026)

   Modal interactivo moldeable con el estándar de oro del sistema:
     - Selección de períodos con presets (Mes actual, Mes anterior, 7d, 15d, 30d, todos)
       y selector de fechas Desde / Hasta con título formal centrado en grande.
     - Agrupación multidimensional (Empresa, Categoría, Proveedor, Período,
       Mes, Día, Moneda, Estado, Origen, Detallado).
     - Interruptores maestros de moneda: USD ($) y Bs (Bolívares).
     - Fichas ejecutivas interactivas: clic en tarjeta para incluir/excluir
       con recálculo dinámico en tiempo real y bordes naranjas corporativos.
     - Dualidad Fichas Ejecutivas vs Tabla Tabular y orientación Horizontal/Vertical.
     - Botón «Imprimir» optimizado con @media print (sin hojas en blanco).
     - Exportación a PDF con membrete oficial, Excel con estilos y fórmulas,
       CSV plano con BOM UTF-8 y aviso formateado para WhatsApp.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import type { Empresa, Movimiento, OpcionRef, EstadoPago, OrigenMovimiento } from './admin.repository';
import type { Moneda } from './administracionCalculo';
import {
  CAMPOS_REPORTE_ADMIN,
  CAMPOS_POR_DEFECTO_ADMIN_POR_MODO,
  MODOS_AGRUPACION_ADMIN,
  ETIQUETA_MODO_ADMIN,
  esColumnaAplicableModoAdmin,
  ESTADO_PAGO_LABEL,
  ORIGEN_LABEL,
  obtenerPresetRangoAdmin,
  obtenerTituloRangoAdmin,
  normalizarMovimientosAdmin,
  filtrarFilasAdmin,
  calcularResumenAdmin,
  agruparFilasAdmin,
  obtenerMetricasFichaAdmin,
  ordenarFilasAdmin,
  fmtMontoUsd,
  fmtMontoBs,
  fmtMontoNum,
  type ModoAgrupacionAdmin,
  type PresetPeriodoAdmin,
  type BaseTasaAdmin,
} from './reporteAdministracionMoldeable';
import {
  descargarAdministracionPdf,
  descargarAdministracionExcel,
  descargarAdministracionCsv,
  generarTextoWhatsappAdmin,
} from './exportarAdministracion';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';

const CLAVE_CAMPOS = 'admin.reporte.campos.v1';
const CLAVE_AGRUPACION = 'admin.reporte.agrupacion.v1';
const CLAVE_USD = 'admin.reporte.usd.v1';
const CLAVE_BS = 'admin.reporte.bs.v1';
const CLAVE_FORMATO = 'admin.reporte.formato.v1';
const CLAVE_ORIENTACION = 'admin.reporte.orientacion.v1';
const CLAVE_KPIS = 'admin.reporte.kpis.v1';

function leerBoolPref(clave: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(clave);
    return v == null ? def : v === 'true';
  } catch {
    return def;
  }
}

interface Props {
  movimientos: Movimiento[];
  empresas: Empresa[];
  categorias: OpcionRef[];
  empresaClaveInicial?: string | null;
  tasaBcvHoy: number;
  onClose: () => void;
}

export function ExportarAdministracionModal({
  movimientos,
  empresas,
  categorias,
  empresaClaveInicial,
  tasaBcvHoy,
  onClose,
}: Props) {
  // 1. Período y Fechas
  const [periodoPreset, setPeriodoPreset] = useState<PresetPeriodoAdmin>('mes_actual');
  const [desde, setDesde] = useState<string>(() => obtenerPresetRangoAdmin('mes_actual').desde);
  const [hasta, setHasta] = useState<string>(() => obtenerPresetRangoAdmin('mes_actual').hasta);

  // 2. Dimensión de Agrupación
  const [agrupacion, setAgrupacion] = useState<ModoAgrupacionAdmin>(() => {
    try {
      const g = localStorage.getItem(CLAVE_AGRUPACION) as ModoAgrupacionAdmin;
      if (g && MODOS_AGRUPACION_ADMIN.some((m) => m.id === g)) return g;
    } catch { /* default */ }
    return 'categoria';
  });

  // 3. Monedas maestras
  const [mostrarUsd, setMostrarUsd] = useState<boolean>(() => leerBoolPref(CLAVE_USD, true));
  const [mostrarBs, setMostrarBs] = useState<boolean>(() => leerBoolPref(CLAVE_BS, true));

  // 4. Formato y Orientación
  const [formatoPresentacion, setFormatoPresentacion] = useState<'fichas' | 'tabla'>(() => {
    try {
      const f = localStorage.getItem(CLAVE_FORMATO);
      if (f === 'fichas' || f === 'tabla') return f;
    } catch { /* default */ }
    return 'fichas';
  });

  const [orientacion, setOrientacion] = useState<'landscape' | 'portrait'>(() => {
    try {
      const o = localStorage.getItem(CLAVE_ORIENTACION);
      if (o === 'landscape' || o === 'portrait') return o;
    } catch { /* default */ }
    return 'landscape';
  });

  // 5. Tasa base
  const [baseTasa, setBaseTasa] = useState<BaseTasaAdmin>('movimiento');

  // 6. Controles de contenido
  const [incluirTarjetas, setIncluirTarjetas] = useState<boolean>(true);
  const [incluirMovimientos, setIncluirMovimientos] = useState<boolean>(true);
  const [incluirResumen, setIncluirResumen] = useState<boolean>(true);
  const [kpisSimplificados, setKpisSimplificados] = useState<boolean>(() => leerBoolPref(CLAVE_KPIS, false));
  const [ordenarPor, setOrdenarPor] = useState<'usd' | 'bs' | 'fecha' | 'nombre' | 'ops'>('usd');

  // 7. Columnas seleccionadas
  const [columnas, setColumnas] = useState<string[]>(() => {
    try {
      const guardadas = JSON.parse(localStorage.getItem(CLAVE_CAMPOS) || 'null');
      if (Array.isArray(guardadas) && guardadas.length) return guardadas;
    } catch { /* default */ }
    return CAMPOS_POR_DEFECTO_ADMIN_POR_MODO[agrupacion] || CAMPOS_POR_DEFECTO_ADMIN_POR_MODO.categoria;
  });

  // 8. Filtros por dimensión (vacío = todos)
  const [empresasSel, setEmpresasSel] = useState<string[]>(() =>
    empresaClaveInicial ? [empresaClaveInicial] : [],
  );
  const [categoriasSel, setCategoriasSel] = useState<string[]>([]);
  const [proveedoresSel, setProveedoresSel] = useState<string[]>([]);
  const [estadosSel, setEstadosSel] = useState<EstadoPago[]>([]);
  const [origenesSel, setOrigenesSel] = useState<OrigenMovimiento[]>([]);
  const [monedasSel, setMonedasSel] = useState<Moneda[]>([]);
  const proveedoresUnicos = useMemo(() => {
    return Array.from(new Set(movimientos.map((m) => m.proveedorNombre).filter(Boolean))) as string[];
  }, [movimientos]);

  // 9. Selección de tarjetas / grupos individuales (para incluir / excluir)
  const [tarjetasExcluidas, setTarjetasExcluidas] = useState<Set<string>>(new Set());

  // 10. Estados de carga y WhatsApp
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verWhatsapp, setVerWhatsapp] = useState<boolean>(false);

  // Guardar preferencias en localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_AGRUPACION, agrupacion);
      localStorage.setItem(CLAVE_CAMPOS, JSON.stringify(columnas));
      localStorage.setItem(CLAVE_USD, String(mostrarUsd));
      localStorage.setItem(CLAVE_BS, String(mostrarBs));
      localStorage.setItem(CLAVE_FORMATO, formatoPresentacion);
      localStorage.setItem(CLAVE_ORIENTACION, orientacion);
      localStorage.setItem(CLAVE_KPIS, String(kpisSimplificados));
    } catch { /* ignore */ }
  }, [agrupacion, columnas, mostrarUsd, mostrarBs, formatoPresentacion, orientacion, kpisSimplificados]);

  // Al cambiar la agrupación, actualizar columnas por defecto si es necesario
  const cambiarAgrupacion = (nueva: ModoAgrupacionAdmin) => {
    setAgrupacion(nueva);
    setTarjetasExcluidas(new Set());
    const sugeridas = CAMPOS_POR_DEFECTO_ADMIN_POR_MODO[nueva];
    if (sugeridas) setColumnas(sugeridas);
  };

  // Manejo de presets de fechas
  const aplicarPreset = (p: PresetPeriodoAdmin) => {
    setPeriodoPreset(p);
    const r = obtenerPresetRangoAdmin(p);
    setDesde(r.desde);
    setHasta(r.hasta);
  };

  // Nombre de empresa activa si hay filtro único
  const nombreEmpresaFiltro = useMemo(() => {
    if (empresasSel.length === 1) {
      const e = empresas.find((x) => x.clave === empresasSel[0]);
      return e ? e.nombre : empresasSel[0];
    }
    return null;
  }, [empresasSel, empresas]);

  // Etiqueta formal del período y título grande centrado
  const periodoLabel = useMemo(() => {
    return obtenerPresetRangoAdmin(periodoPreset).label || (desde && hasta ? `${desde} al ${hasta}` : 'Histórico');
  }, [periodoPreset, desde, hasta]);

  const tituloRangoGrande = useMemo(() => {
    return obtenerTituloRangoAdmin(desde, hasta, periodoPreset, nombreEmpresaFiltro);
  }, [desde, hasta, periodoPreset, nombreEmpresaFiltro]);

  // 1. Normalizar movimientos
  const normalizadas = useMemo(() => {
    return normalizarMovimientosAdmin(movimientos, empresas, categorias, tasaBcvHoy, baseTasa);
  }, [movimientos, empresas, categorias, tasaBcvHoy, baseTasa]);

  // 2. Filtrar movimientos
  const filtradas = useMemo(() => {
    return filtrarFilasAdmin(
      normalizadas,
      {
        empresasSel,
        categoriasSel,
        proveedoresSel,
        estadosSel,
        origenesSel,
        monedasSel,
      },
      desde,
      hasta,
      estadosSel.includes('anulado'),
    );
  }, [normalizadas, empresasSel, categoriasSel, proveedoresSel, estadosSel, origenesSel, monedasSel, desde, hasta]);

  // 3. Agrupar filas según la dimensión elegida
  const agrupadas = useMemo(() => {
    return agruparFilasAdmin(filtradas, agrupacion, tasaBcvHoy);
  }, [filtradas, agrupacion, tasaBcvHoy]);

  // 4. Filas activas considerando inclusión/exclusión de tarjetas
  const filasActivas = useMemo(() => {
    const activas = agrupadas.filter((f) => {
      const clave = f.grupoClave || f.id;
      return !tarjetasExcluidas.has(clave);
    });
    return ordenarFilasAdmin(activas, ordenarPor, true);
  }, [agrupadas, tarjetasExcluidas, ordenarPor]);

  // 5. Recalcular KPIs y resumen consolidado con las filas activas
  const resumen = useMemo(() => {
    // Si estamos en agrupado, calculamos a partir de los movimientos subyacentes de las tarjetas activas
    const setActivas = new Set(filasActivas.map((f) => f.grupoClave || f.id));
    const movsDeActivas = filtradas.filter((m) => {
      if (agrupacion === 'detallado') return setActivas.has(m.id);
      let k = '';
      if (agrupacion === 'empresa') k = m.empresaClave;
      else if (agrupacion === 'categoria') k = m.categoriaId || 'sin_cat';
      else if (agrupacion === 'proveedor') k = m.proveedorNombre;
      else if (agrupacion === 'periodo') k = m.periodo;
      else if (agrupacion === 'mes') k = m.fecha.slice(0, 7);
      else if (agrupacion === 'dia') k = m.fecha;
      else if (agrupacion === 'moneda') k = m.monedaOriginal;
      else if (agrupacion === 'estado') k = m.estadoPago;
      else if (agrupacion === 'origen') k = m.origen;
      return setActivas.has(k);
    });

    return calcularResumenAdmin(movsDeActivas, tasaBcvHoy);
  }, [filasActivas, filtradas, agrupacion, tasaBcvHoy]);

  // Toggle de tarjeta individual
  const toggleTarjeta = (clave: string) => {
    setTarjetasExcluidas((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(clave)) nuevo.delete(clave);
      else nuevo.add(clave);
      return nuevo;
    });
  };

  const incluirTodasTarjetas = () => setTarjetasExcluidas(new Set());
  const excluirTodasTarjetas = () => {
    const todas = new Set(agrupadas.map((f) => f.grupoClave || f.id));
    setTarjetasExcluidas(todas);
  };

  // Toggle de filtros
  const toggleFiltro = <T,>(lista: T[], setLista: (l: T[]) => void, item: T) => {
    if (lista.includes(item)) setLista(lista.filter((x) => x !== item));
    else setLista([...lista, item]);
  };

  // Toggle de columnas
  const alternarColumna = (clave: string) => {
    if (columnas.includes(clave)) {
      if (columnas.length <= 1) return;
      setColumnas(columnas.filter((c) => c !== clave));
    } else {
      setColumnas([...columnas, clave]);
    }
  };

  // Exportar handlers
  const handleExportPdf = async () => {
    if (!filasActivas.length) return;
    setOcupado('pdf');
    try {
      await descargarAdministracionPdf({
        filas: filasActivas,
        resumen,
        columnas,
        tituloRango: tituloRangoGrande,
        periodoLabel,
        empresaNombre: nombreEmpresaFiltro,
        empresaClave: empresasSel.length === 1 ? empresasSel[0] : null,
        modoAgrupacion: agrupacion,
        orientacion,
        formatoPresentacion,
        incluirTarjetas,
        incluirMovimientos,
        incluirResumen,
        mostrarUsd,
        mostrarBs,
        kpisSimplificados,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al generar el PDF.', 'error');
    } finally {
      setOcupado(null);
    }
  };

  const handleExportExcel = async () => {
    if (!filasActivas.length) return;
    setOcupado('excel');
    try {
      await descargarAdministracionExcel({
        filas: filasActivas,
        resumen,
        columnas,
        tituloRango: tituloRangoGrande,
        periodoLabel,
        empresaNombre: nombreEmpresaFiltro,
        modoAgrupacion: agrupacion,
        mostrarUsd,
        mostrarBs,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al generar el Excel.', 'error');
    } finally {
      setOcupado(null);
    }
  };

  const handleExportCsv = () => {
    if (!filasActivas.length) return;
    descargarAdministracionCsv({
      filas: filasActivas,
      columnas,
      mostrarUsd,
      mostrarBs,
      modoAgrupacion: agrupacion,
    });
  };

  // Texto para WhatsApp
  const textoWhatsapp = useMemo(() => {
    return generarTextoWhatsappAdmin({
      filas: filasActivas,
      resumen,
      tituloRango: tituloRangoGrande,
      empresaNombre: nombreEmpresaFiltro,
      periodoLabel,
      modoAgrupacion: agrupacion,
      mostrarUsd,
      mostrarBs,
    });
  }, [filasActivas, resumen, tituloRangoGrande, nombreEmpresaFiltro, periodoLabel, agrupacion, mostrarUsd, mostrarBs]);

  const columnasVisibles = useMemo(() => {
    return columnas.filter((cKey) => {
      if (cKey === 'monto_usd' && !mostrarUsd) return false;
      if (cKey === 'monto_bs' && !mostrarBs) return false;
      if (agrupacion !== 'detallado' && !esColumnaAplicableModoAdmin(cKey, agrupacion)) return false;
      return true;
    });
  }, [columnas, mostrarUsd, mostrarBs, agrupacion]);

  const surf2 = {
    background: 'var(--surface-2, #182230)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '.65rem .8rem',
  } as const;

  const tituloSec = {
    fontSize: '.82rem',
    fontWeight: 600,
    color: 'var(--text, #f1f5f9)',
  } as const;

  return (
    <Modal
      title="📄 Reporte Dinámico de Administración"
      size="xl"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '.5rem', flexWrap: 'wrap' }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>
            {filasActivas.length} registro(s) activos · Agrupado por {ETIQUETA_MODO_ADMIN[agrupacion]}
          </div>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={!!ocupado}>
              Cerrar
            </button>
            <button
              className="btn btn-ghost"
              onClick={handleExportCsv}
              disabled={!!ocupado || !filasActivas.length}
            >
              📝 CSV
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void handleExportExcel()}
              disabled={!!ocupado || !filasActivas.length}
            >
              {ocupado === 'excel' ? 'Generando…' : '📊 Descargar Excel'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setVerWhatsapp((v) => !v)}
              disabled={!!ocupado || !filasActivas.length}
            >
              💬 WhatsApp
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void handleExportPdf()}
              disabled={!!ocupado || !filasActivas.length}
            >
              {ocupado === 'pdf' ? 'Generando…' : '📄 Descargar PDF'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => window.print()}
              disabled={!filasActivas.length}
              title="Imprimir reporte tal como está configurado"
            >
              🖨 Imprimir
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
            }
            .kpi-hero-card {
              background: #f8fafc !important;
              border: 2px solid #ff8a00 !important;
              box-shadow: none !important;
              color: #0f172a !important;
              padding: .5rem !important;
              margin-bottom: .6rem !important;
              page-break-inside: avoid !important;
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
              <span style={tituloSec}>💬 Compartir Reporte Administrativo por WhatsApp</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setVerWhatsapp(false)}>
                ✕ Cerrar
              </button>
            </div>
            <p className="muted" style={{ fontSize: '.76rem', margin: '0 0 .5rem' }}>
              Mensaje preparado con totales, tasa ponderada y desglose. Puedes copiarlo o enviarlo directamente a WhatsApp Web.
            </p>
            <CompartirWhatsapp texto={textoWhatsapp} />
          </div>
        )}

        {/* 1. SECCIÓN: Filtro de Fechas y Presets */}
        <div className="no-print" style={surf2}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.4rem' }}>
            <span style={tituloSec}>📆 Rango de Fechas / Período</span>
            <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
              <button type="button" className={`btn btn-xs ${periodoPreset === 'mes_actual' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => aplicarPreset('mes_actual')}>Mes actual</button>
              <button type="button" className={`btn btn-xs ${periodoPreset === 'mes_anterior' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => aplicarPreset('mes_anterior')}>Mes anterior</button>
              <button type="button" className={`btn btn-xs ${periodoPreset === '7dias' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => aplicarPreset('7dias')}>7 días</button>
              <button type="button" className={`btn btn-xs ${periodoPreset === '15dias' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => aplicarPreset('15dias')}>15 días</button>
              <button type="button" className={`btn btn-xs ${periodoPreset === '30dias' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => aplicarPreset('30dias')}>30 días</button>
              <button type="button" className={`btn btn-xs ${periodoPreset === 'este_ano' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => aplicarPreset('este_ano')}>Año actual</button>
              <button type="button" className={`btn btn-xs ${periodoPreset === 'todos' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => aplicarPreset('todos')}>Historial completo</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.8rem' }}>
              <span className="muted">Desde:</span>
              <input type="date" className="input" style={{ padding: '.25rem .5rem', fontSize: '.8rem' }} value={desde} onChange={(e) => { setDesde(e.target.value); setPeriodoPreset('personalizado'); }} />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.8rem' }}>
              <span className="muted">Hasta:</span>
              <input type="date" className="input" style={{ padding: '.25rem .5rem', fontSize: '.8rem' }} value={hasta} onChange={(e) => { setHasta(e.target.value); setPeriodoPreset('personalizado'); }} />
            </label>
            {(desde || hasta) && (
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => aplicarPreset('todos')}>
                ✕ Limpiar fechas
              </button>
            )}
          </div>
        </div>

        {/* 2. SECCIÓN: Dimensión de Agrupación y Monedas Maestras */}
        <div className="no-print" style={surf2}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.5rem' }}>
            <span style={tituloSec}>📊 Dimensión de Agrupación</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '.76rem', color: '#94a3b8' }}>Monedas:</span>
              <button
                type="button"
                className={`btn btn-xs ${mostrarBs && !mostrarUsd ? 'btn-primary' : 'btn-ghost'}`}
                style={{ borderRadius: 999, padding: '.15rem .6rem', fontSize: '.74rem', fontWeight: 600 }}
                onClick={() => {
                  setMostrarBs(true);
                  setMostrarUsd(false);
                }}
                title="Mostrar exclusivamente en Bolívares (Bs)"
              >
                🇻🇪 Solo Bs
              </button>
              <button
                type="button"
                className={`btn btn-xs ${mostrarUsd && !mostrarBs ? 'btn-primary' : 'btn-ghost'}`}
                style={{ borderRadius: 999, padding: '.15rem .6rem', fontSize: '.74rem', fontWeight: 600 }}
                onClick={() => {
                  setMostrarUsd(true);
                  setMostrarBs(false);
                }}
                title="Mostrar exclusivamente en Dólares ($)"
              >
                💵 Solo $
              </button>
              <button
                type="button"
                className={`btn btn-xs ${mostrarUsd && mostrarBs ? 'btn-primary' : 'btn-ghost'}`}
                style={{ borderRadius: 999, padding: '.15rem .6rem', fontSize: '.74rem', fontWeight: 600 }}
                onClick={() => {
                  setMostrarUsd(true);
                  setMostrarBs(true);
                }}
                title="Mostrar ambas monedas (Bs y $)"
              >
                💱 Ambos (Bs y $)
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
            {MODOS_AGRUPACION_ADMIN.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`btn btn-xs ${agrupacion === m.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => cambiarAgrupacion(m.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}
              >
                <span>{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 3. SECCIÓN: Filtros Multidimensionales (Pills) */}
        <div className="no-print" style={surf2}>
          <div style={{ ...tituloSec, marginBottom: '.4rem' }}>🎯 Filtros Activos</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.5rem' }}>
            {/* Filtro Empresa */}
            <div>
              <span className="muted hint" style={{ fontSize: '.72rem', display: 'block', marginBottom: '.2rem' }}>Empresas</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem' }}>
                {empresas.map((e) => {
                  const activa = empresasSel.includes(e.clave);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => toggleFiltro(empresasSel, setEmpresasSel, e.clave)}
                      style={{
                        padding: '.15rem .5rem',
                        borderRadius: '999px',
                        fontSize: '.74rem',
                        border: '1px solid',
                        borderColor: activa ? '#ff8a00' : 'var(--border)',
                        background: activa ? 'rgba(255, 138, 0, 0.15)' : 'transparent',
                        color: activa ? '#f1f5f9' : '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      {activa ? '✓ ' : ''}{e.nombre}
                    </button>
                  );
                })}
                {empresasSel.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEmpresasSel([])}>Todas</button>
                )}
              </div>
            </div>

            {/* Filtro Estado */}
            <div>
              <span className="muted hint" style={{ fontSize: '.72rem', display: 'block', marginBottom: '.2rem' }}>Estado de Pago</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem' }}>
                {(['pagado', 'pendiente', 'anulado'] as EstadoPago[]).map((est) => {
                  const activo = estadosSel.includes(est);
                  return (
                    <button
                      key={est}
                      type="button"
                      onClick={() => toggleFiltro(estadosSel, setEstadosSel, est)}
                      style={{
                        padding: '.15rem .5rem',
                        borderRadius: '999px',
                        fontSize: '.74rem',
                        border: '1px solid',
                        borderColor: activo ? '#ff8a00' : 'var(--border)',
                        background: activo ? 'rgba(255, 138, 0, 0.15)' : 'transparent',
                        color: activo ? '#f1f5f9' : '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      {activo ? '✓ ' : ''}{ESTADO_PAGO_LABEL[est]}
                    </button>
                  );
                })}
                {estadosSel.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEstadosSel([])}>Todos</button>
                )}
              </div>
            </div>

            {/* Filtro Origen */}
            <div>
              <span className="muted hint" style={{ fontSize: '.72rem', display: 'block', marginBottom: '.2rem' }}>Origen</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem' }}>
                {(['generado', 'importado', 'manual'] as OrigenMovimiento[]).map((orig) => {
                  const activo = origenesSel.includes(orig);
                  return (
                    <button
                      key={orig}
                      type="button"
                      onClick={() => toggleFiltro(origenesSel, setOrigenesSel, orig)}
                      style={{
                        padding: '.15rem .5rem',
                        borderRadius: '999px',
                        fontSize: '.74rem',
                        border: '1px solid',
                        borderColor: activo ? '#ff8a00' : 'var(--border)',
                        background: activo ? 'rgba(255, 138, 0, 0.15)' : 'transparent',
                        color: activo ? '#f1f5f9' : '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      {activo ? '✓ ' : ''}{ORIGEN_LABEL[orig]}
                    </button>
                  );
                })}
                {origenesSel.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOrigenesSel([])}>Todos</button>
                )}
              </div>
            </div>

            {/* Filtro Categoría */}
            {categorias.length > 0 && (
              <div>
                <span className="muted hint" style={{ fontSize: '.72rem', display: 'block', marginBottom: '.2rem' }}>Categorías</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem', maxHeight: '70px', overflowY: 'auto' }}>
                  {categorias.map((c) => {
                    const activa = categoriasSel.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleFiltro(categoriasSel, setCategoriasSel, c.id)}
                        style={{
                          padding: '.15rem .5rem',
                          borderRadius: '999px',
                          fontSize: '.74rem',
                          border: '1px solid',
                          borderColor: activa ? '#ff8a00' : 'var(--border)',
                          background: activa ? 'rgba(255, 138, 0, 0.15)' : 'transparent',
                          color: activa ? '#f1f5f9' : '#94a3b8',
                          cursor: 'pointer',
                        }}
                      >
                        {activa ? '✓ ' : ''}{c.nombre}
                      </button>
                    );
                  })}
                  {categoriasSel.length > 0 && (
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setCategoriasSel([])}>Todas</button>
                  )}
                </div>
              </div>
            )}

            {/* Filtro Proveedor */}
            {proveedoresUnicos.length > 0 && (
              <div>
                <span className="muted hint" style={{ fontSize: '.72rem', display: 'block', marginBottom: '.2rem' }}>Proveedores</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem', maxHeight: '70px', overflowY: 'auto' }}>
                  {proveedoresUnicos.slice(0, 10).map((prov) => {
                    const activo = proveedoresSel.includes(prov);
                    return (
                      <button
                        key={prov}
                        type="button"
                        onClick={() => toggleFiltro(proveedoresSel, setProveedoresSel, prov)}
                        style={{
                          padding: '.15rem .5rem',
                          borderRadius: '999px',
                          fontSize: '.74rem',
                          border: '1px solid',
                          borderColor: activo ? '#ff8a00' : 'var(--border)',
                          background: activo ? 'rgba(255, 138, 0, 0.15)' : 'transparent',
                          color: activo ? '#f1f5f9' : '#94a3b8',
                          cursor: 'pointer',
                        }}
                      >
                        {activo ? '✓ ' : ''}{prov}
                      </button>
                    );
                  })}
                  {proveedoresSel.length > 0 && (
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setProveedoresSel([])}>Todos</button>
                  )}
                </div>
              </div>
            )}

            {/* Filtro Moneda */}
            <div>
              <span className="muted hint" style={{ fontSize: '.72rem', display: 'block', marginBottom: '.2rem' }}>Moneda Origen</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem' }}>
                {(['USD', 'Bs'] as Moneda[]).map((mon) => {
                  const activo = monedasSel.includes(mon);
                  return (
                    <button
                      key={mon}
                      type="button"
                      onClick={() => toggleFiltro(monedasSel, setMonedasSel, mon)}
                      style={{
                        padding: '.15rem .5rem',
                        borderRadius: '999px',
                        fontSize: '.74rem',
                        border: '1px solid',
                        borderColor: activo ? '#ff8a00' : 'var(--border)',
                        background: activo ? 'rgba(255, 138, 0, 0.15)' : 'transparent',
                        color: activo ? '#f1f5f9' : '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      {activo ? '✓ ' : ''}{mon}
                    </button>
                  );
                })}
                {monedasSel.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMonedasSel([])}>Todas</button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 4. SECCIÓN: Opciones de Formato, Orientación y Columnas */}
        <div className="no-print" style={surf2}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem', borderBottom: '1px solid var(--border)', paddingBottom: '.5rem', marginBottom: '.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <span style={tituloSec}>🎨 Presentación:</span>
              <button
                type="button"
                className={`btn btn-xs ${formatoPresentacion === 'fichas' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ borderRadius: '999px', padding: '.2rem .7rem' }}
                onClick={() => setFormatoPresentacion('fichas')}
              >
                🗂️ Fichas Ejecutivas
              </button>
              <button
                type="button"
                className={`btn btn-xs ${formatoPresentacion === 'tabla' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ borderRadius: '999px', padding: '.2rem .7rem' }}
                onClick={() => setFormatoPresentacion('tabla')}
              >
                📊 Tabla Tabular
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <span style={tituloSec}>📐 Orientación:</span>
              <button
                type="button"
                className={`btn btn-xs ${orientacion === 'landscape' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ borderRadius: '999px', padding: '.2rem .7rem' }}
                onClick={() => setOrientacion('landscape')}
              >
                📜 Horizontal
              </button>
              <button
                type="button"
                className={`btn btn-xs ${orientacion === 'portrait' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ borderRadius: '999px', padding: '.2rem .7rem' }}
                onClick={() => setOrientacion('portrait')}
              >
                📄 Vertical
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <span style={tituloSec}>🎯 Ordenar por:</span>
              <button type="button" className={`btn btn-xs ${ordenarPor === 'usd' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOrdenarPor('usd')}>💵 Monto $</button>
              <button type="button" className={`btn btn-xs ${ordenarPor === 'bs' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOrdenarPor('bs')}>🧾 Monto Bs</button>
              <button type="button" className={`btn btn-xs ${ordenarPor === 'ops' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOrdenarPor('ops')}>🔢 Operaciones</button>
              <button type="button" className={`btn btn-xs ${ordenarPor === 'nombre' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOrdenarPor('nombre')}>🔤 Nombre</button>
            </div>
          </div>

          
          {/* Opciones de Inclusión y Base de Tasa */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.8rem', borderBottom: '1px solid var(--border)', paddingBottom: '.5rem', marginBottom: '.5rem', fontSize: '.78rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={incluirResumen} onChange={(e) => setIncluirResumen(e.target.checked)} />
                <span>Resumen KPIs</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={kpisSimplificados} onChange={(e) => setKpisSimplificados(e.target.checked)} />
                <span>KPIs simples</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={incluirTarjetas} onChange={(e) => setIncluirTarjetas(e.target.checked)} />
                <span>Fichas / Tarjetas</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={incluirMovimientos} onChange={(e) => setIncluirMovimientos(e.target.checked)} />
                <span>Tabla Detallada</span>
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
              <span className="muted">Base valuación:</span>
              <select
                className="input"
                style={{ padding: '.15rem .45rem', fontSize: '.76rem' }}
                value={baseTasa}
                onChange={(e) => setBaseTasa(e.target.value as BaseTasaAdmin)}
              >
                <option value="movimiento">Tasa del movimiento</option>
                <option value="bcv_dia">Tasa BCV del día</option>
              </select>
            </div>
          </div>

          {/* Banner explicativo de claridad sobre la dimensión activa */}
          {agrupacion !== 'detallado' && (
            <div style={{
              background: 'rgba(249, 115, 22, 0.08)',
              border: '1px solid rgba(249, 115, 22, 0.3)',
              borderRadius: 6,
              padding: '.45rem .75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '.4rem',
              marginBottom: '.5rem',
            }}>
              <div style={{ fontSize: '.76rem', color: '#fed7aa', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                <span style={{ fontSize: '.9rem' }}>💡</span>
                <span>
                  Estás agrupando por <strong>{ETIQUETA_MODO_ADMIN[agrupacion]}</strong>: reporte en <strong>resumen consolidado</strong> ({filasActivas.length} grupo/s). Los campos de transacción (Concepto detallado) aplican en la dimensión <strong>Detallado</strong>.
                </span>
              </div>
              <button
                type="button"
                className="btn btn-xs btn-primary"
                onClick={() => cambiarAgrupacion('detallado')}
                style={{ fontSize: '.72rem', padding: '.2rem .55rem', borderRadius: 4 }}
              >
                📋 Cambiar a vista Detallada
              </button>
            </div>
          )}

          {/* Selector de columnas */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.35rem' }}>
              <span style={{ fontSize: '.78rem', fontWeight: 600 }}>
                ☑️ Columnas a mostrar ({columnasVisibles.length} {agrupacion !== 'detallado' ? 'aplicables' : 'seleccionadas'})
              </span>
              <div style={{ display: 'flex', gap: '.3rem' }}>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setColumnas(CAMPOS_POR_DEFECTO_ADMIN_POR_MODO[agrupacion] || [])}>Principales</button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => {
                    const cols = CAMPOS_REPORTE_ADMIN
                      .filter((c) => esColumnaAplicableModoAdmin(c.clave, agrupacion))
                      .map((c) => c.clave);
                    setColumnas(cols);
                  }}
                >
                  {agrupacion === 'detallado' ? 'Todas' : 'Todas aplicables'}
                </button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setColumnas([])}>Ninguna</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '.25rem .45rem', maxHeight: '120px', overflowY: 'auto' }}>
              {CAMPOS_REPORTE_ADMIN.map((col) => {
                const aplicable = esColumnaAplicableModoAdmin(col.clave, agrupacion);
                const marcado = columnas.includes(col.clave);
                const ocultoPorToggle = (col.clave === 'monto_usd' && !mostrarUsd) || (col.clave === 'monto_bs' && !mostrarBs);
                return (
                  <label
                    key={col.clave}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '.35rem',
                      fontSize: '.75rem',
                      cursor: aplicable ? 'pointer' : 'help',
                      color: marcado && aplicable ? '#f1f5f9' : '#94a3b8',
                      opacity: ocultoPorToggle ? 0.45 : !aplicable ? 0.45 : 1,
                    }}
                    title={
                      !aplicable
                        ? `La columna "${col.etiqueta}" aplica en la dimensión 'Detallado' (movimiento individual)`
                        : ocultoPorToggle
                          ? 'Oculta por la selección de moneda'
                          : col.descripcion
                    }
                    onClick={(e) => {
                      if (!aplicable) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={marcado && aplicable}
                      disabled={!aplicable}
                      onChange={() => alternarColumna(col.clave)}
                    />
                    <span>{col.etiqueta}</span>
                    {!aplicable && (
                      <span style={{ fontSize: '.58rem', background: 'rgba(255,255,255,0.08)', color: '#94a3b8', padding: '.04rem .25rem', borderRadius: 3, marginLeft: '.15rem' }}>
                        {col.clave === 'fecha' ? 'Solo Día/Mes' : 'Solo en Detallado'}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* 5. SECCIÓN IMPRIMIBLE: Contenedor con clase .reporte-print para @media print */}
        <div className="reporte-print" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Cabecera del Documento (Impresión y Vista) */}
          <div style={{ textAlign: 'center', margin: '.2rem 0 .4rem' }}>
            <div style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#ff8a00' }}>
              MINERAL GROUP GUAYANA C.A. · CONTROL ADMINISTRATIVO
            </div>
            <h2 style={{ margin: '.25rem 0 .2rem', fontSize: '1.45rem', fontWeight: 800 }}>
              {tituloRangoGrande}
            </h2>
            <div className="muted" style={{ fontSize: '.82rem' }}>
              {periodoLabel} · Agrupación: {ETIQUETA_MODO_ADMIN[agrupacion]} · Emitido: {new Date().toLocaleDateString('es-VE')}
            </div>
          </div>

          {/* Hero Banner de KPIs */}
          {incluirResumen && (
            <div
              className="card kpi-hero-card"
              style={{
                margin: 0,
                borderColor: '#ff8a00',
                borderWidth: 2,
                background: 'linear-gradient(135deg, var(--surface-2, #182230), var(--surface, #0f172a))',
                padding: '.85rem 1rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: '.85rem',
              }}
            >
              {mostrarUsd && (
                <div style={{ textAlign: 'center', padding: '.35rem .45rem', borderTop: '3px solid #22c55e', borderRadius: '4px' }}>
                  <div className="muted" style={{ fontSize: '.68rem', textTransform: 'uppercase', fontWeight: 700 }}>Total en Dólares ($)</div>
                  <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#22c55e', marginTop: '.1rem' }}>
                    {fmtMontoUsd(resumen.totalUsd)}
                  </div>
                  <div className="muted" style={{ fontSize: '.7rem', marginTop: '.15rem' }}>
                    Pagado: {fmtMontoUsd(resumen.totalPagadoUsd)}
                  </div>
                </div>
              )}

              {mostrarBs && (
                <div style={{ textAlign: 'center', padding: '.35rem .45rem', borderTop: '3px solid #ff8a00', borderRadius: '4px' }}>
                  <div className="muted" style={{ fontSize: '.68rem', textTransform: 'uppercase', fontWeight: 700 }}>Total en Bolívares (Bs)</div>
                  <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ff8a00', marginTop: '.1rem' }}>
                    {fmtMontoBs(resumen.totalBs)}
                  </div>
                  <div className="muted" style={{ fontSize: '.7rem', marginTop: '.15rem' }}>
                    Pagado: {fmtMontoBs(resumen.totalPagadoBs)}
                  </div>
                </div>
              )}

              <div style={{ textAlign: 'center', padding: '.35rem .45rem', borderTop: '3px solid #38bdf8', borderRadius: '4px' }}>
                <div className="muted" style={{ fontSize: '.68rem', textTransform: 'uppercase', fontWeight: 700 }}>Tasa Ponderada</div>
                <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#38bdf8', marginTop: '.1rem' }}>
                  {fmtMontoNum(resumen.tasaPromedioPonderada, 2)} <span style={{ fontSize: '.8rem', fontWeight: 500 }} className="muted">$/Bs</span>
                </div>
                <div className="muted" style={{ fontSize: '.7rem', marginTop: '.15rem' }}>
                  Ref. BCV del día: {fmtMontoNum(tasaBcvHoy, 2)}
                </div>
              </div>

              <div style={{ textAlign: 'center', padding: '.35rem .45rem', borderTop: '3px solid #a855f7', borderRadius: '4px' }}>
                <div className="muted" style={{ fontSize: '.68rem', textTransform: 'uppercase', fontWeight: 700 }}>Movimientos</div>
                <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#a855f7', marginTop: '.1rem' }}>
                  {resumen.totalOperaciones}
                </div>
                <div className="muted" style={{ fontSize: '.7rem', marginTop: '.15rem' }}>
                  {filasActivas.length} elemento(s) activos
                </div>
              </div>
            </div>
          )}

          {/* Botones de acción rápida sobre las tarjetas en pantalla */}
          {formatoPresentacion === 'fichas' && agrupacion !== 'detallado' && (
            <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.4rem' }}>
              <div style={{ fontSize: '.78rem', color: '#94a3b8' }}>
                💡 Haz clic en cualquier tarjeta para <strong>incluirla o excluirla</strong> del reporte y de la exportación.
              </div>
              <div style={{ display: 'flex', gap: '.3rem' }}>
                <button type="button" className="btn btn-ghost btn-xs" onClick={incluirTodasTarjetas}>
                  ✓ Incluir todas ({agrupadas.length})
                </button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={excluirTodasTarjetas}>
                  ✕ Excluir todas
                </button>
              </div>
            </div>
          )}

          {/* VISTA A: Fichas Ejecutivas con borde naranja corporativo */}
          {formatoPresentacion === 'fichas' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '.75rem',
              }}
            >
              {agrupadas.map((f) => {
                const clave = f.grupoClave || f.id;
                const seleccionada = !tarjetasExcluidas.has(clave);
                const metricas = obtenerMetricasFichaAdmin(f, columnas, { mostrarUsd, mostrarBs });

                return (
                  <div
                    key={f.id}
                    onClick={() => toggleTarjeta(clave)}
                    className={`card admin-card-item ${!seleccionada ? 'no-print' : ''}`}
                    style={{
                      margin: 0,
                      padding: '.8rem',
                      border: seleccionada ? '2px solid #ff8a00' : '1px dashed var(--border)',
                      background: seleccionada ? 'var(--surface-1, #0f172a)' : 'rgba(255, 255, 255, 0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      pageBreakInside: 'avoid',
                      opacity: seleccionada ? 1 : 0.45,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      position: 'relative',
                      userSelect: 'none',
                      boxShadow: seleccionada ? '0 0 0 1px rgba(255, 138, 0, 0.2)' : 'none',
                    }}
                    title={seleccionada ? 'Clic para excluir del reporte' : 'Clic para incluir en el reporte'}
                  >
                    {/* Badge superior derecho de inclusión */}
                    <div style={{ position: 'absolute', top: '.5rem', right: '.5rem' }}>
                      {seleccionada ? (
                        <span
                          className="badge badge-incluido"
                          style={{
                            background: 'rgba(16, 185, 129, 0.2)',
                            color: '#10b981',
                            borderColor: '#10b981',
                            fontSize: '.68rem',
                            fontWeight: 700,
                            padding: '.15rem .45rem',
                          }}
                        >
                          ✓ Incluido
                        </span>
                      ) : (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            color: '#94a3b8',
                            borderColor: 'var(--border)',
                            fontSize: '.68rem',
                            padding: '.15rem .45rem',
                          }}
                        >
                          ✕ Excluido
                        </span>
                      )}
                    </div>

                    {/* Título y subtítulo */}
                    <div style={{ paddingRight: '5rem', minHeight: '2.4rem' }}>
                      <strong style={{ fontSize: '.92rem', color: '#f8fafc', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.titulo || f.concepto}>
                        {f.titulo || f.concepto}
                      </strong>
                      <div className="muted" style={{ fontSize: '.72rem', marginTop: '.15rem' }}>
                        {f.subtitulo || f.periodo} · {f.totalOperaciones ?? 1} op.
                      </div>
                    </div>

                    {/* Chips de métricas */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: '.35rem', marginTop: '.6rem', background: 'rgba(0,0,0,0.25)', padding: '.35rem .5rem', borderRadius: '4px' }}>
                      {metricas.map((m) => (
                        <div key={m.clave} style={{ textAlign: 'center' }}>
                          <div className="muted" style={{ fontSize: '.58rem', fontWeight: 600 }}>{m.etiqueta}</div>
                          <div className="mono" style={{ fontSize: '.82rem', fontWeight: 700, color: m.colorHex, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.valor}>
                            {m.valor}
                          </div>
                          {m.sub && (
                            <div className="muted" style={{ fontSize: '.55rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.sub}>
                              {m.sub}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* VISTA B: Tabla Tabular */}
          {formatoPresentacion === 'tabla' && (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2, #182230)', borderBottom: '1px solid var(--border)' }}>
                    {columnasVisibles.map((cKey) => {
                      const col = CAMPOS_REPORTE_ADMIN.find((c) => c.clave === cKey);
                      return (
                        <th key={cKey} style={{ padding: '.45rem .6rem', textAlign: col?.alineacion || 'left', color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {col?.etiqueta || cKey}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filasActivas.map((f, idx) => (
                    <tr key={f.id || idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: idx % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                      {columnasVisibles.map((cKey) => {
                        const col = CAMPOS_REPORTE_ADMIN.find((c) => c.clave === cKey);
                        let val: string | number = '—';
                        if (cKey === 'fecha') val = f.fecha;
                        else if (cKey === 'empresa') val = f.empresaNombre || f.empresaClave;
                        else if (cKey === 'operaciones') val = `${f.totalOperaciones ?? 1} ops`;
                        else if (cKey === 'concepto') val = f.titulo || f.concepto;
                        else if (cKey === 'categoria') val = f.categoriaNombre;
                        else if (cKey === 'proveedor') val = f.proveedorNombre;
                        else if (cKey === 'periodo') val = f.periodo;
                        else if (cKey === 'estado') val = ESTADO_PAGO_LABEL[f.estadoPago] || f.estadoPago;
                        else if (cKey === 'origen') val = ORIGEN_LABEL[f.origen] || f.origen;
                        else if (cKey === 'moneda_orig') val = f.monedaOriginal;
                        else if (cKey === 'monto_orig') val = fmtMontoNum(f.montoOriginal, 2);
                        else if (cKey === 'monto_usd') val = fmtMontoUsd(f.montoUsd);
                        else if (cKey === 'monto_bs') val = fmtMontoBs(f.montoBs);
                        else if (cKey === 'tasa') val = `${fmtMontoNum(f.tasaAplicada, 2)} $/Bs`;
                        else if (cKey === 'pct_total') val = f.pctDelTotal != null ? `${f.pctDelTotal.toFixed(1)}%` : '—';

                        return (
                          <td
                            key={cKey}
                            style={{
                              padding: '.4rem .6rem',
                              textAlign: col?.alineacion || 'left',
                              whiteSpace: 'nowrap',
                              color: cKey === 'monto_usd' ? '#22c55e' : cKey === 'monto_bs' ? '#ff8a00' : 'inherit',
                              fontWeight: cKey === 'monto_usd' || cKey === 'monto_bs' ? 600 : 'normal',
                            }}
                          >
                            {val}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pie de página institucional */}
          <div style={{ marginTop: '.5rem', borderTop: '1px solid var(--border)', paddingTop: '.4rem', textAlign: 'center', fontSize: '.72rem' }} className="muted">
            <div>Mineral Group Guayana C.A. · Sistema de Gestión Administrativa</div>
            <div style={{ marginTop: '.15rem' }}>
              Reporte dinámico consolidado al {periodoLabel} con tasa ponderada promedio correspondiente.
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

