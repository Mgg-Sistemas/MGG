/* ============================================================
   MGG · Inventario · «Reporte Dinámico · Centro de Fundición Matanzas» (04-11-2026)

   Modal interactivo para la sede Matanzas (CENTRO DE FUNDICION - MATANZAS) que unifica:
     - Stock y Valuación Actual por Subalmacén (USD y Bs a tasa BCV)
     - Kárdex de Movimientos (entradas, salidas, traslados, ajustes)
     - Casiterita SnO₂ Detallada (lotes, humedad, % Sn, kg finos)
     - Críticos y Auditoría (bajo mínimo, existencias en $0)

   Soporta selección de múltiples subalmacenes con casillas (checks sin discusión),
   selección de categorías, selección de columnas con presets dinámicos,
   tarjetas KPI ejecutivas reactivas a las casillas, vista previa en vivo y
   exportación a Excel (.xlsx estilizado), PDF vectorial, CSV (UTF-8 BOM) y WhatsApp.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { mensajeError } from '@/shared/lib/errores';
import { useRealtime } from '@/shared/lib/useRealtime';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import {
  AMBITOS_INVENTARIO_MATANZAS,
  COLUMNAS_DEFAULT_MATANZAS,
  COLUMNAS_PRESETS_MATANZAS,
  CAMPOS_REPORTE_MATANZAS,
  MODOS_AGRUPACION_MATANZAS,
  PRESETS_RANGO_MATANZAS,
  calcularResumenMatanzas,
  filtrarFilasMatanzas,
  formatearCeldaMatanzas,
  obtenerMetricasFichaMatanzas,
  type AmbitoInventarioMatanzas,
  type FiltrosReporteMatanzas,
  type ModoAgrupacionMatanzas,
  type PresetRangoMatanzas,
} from './reporteInventarioMatanzasDinamico';
import {
  cargarDatosReporteMatanzas,
  listSubalmacenesMatanzas,
  type DatosCargadosMatanzas,
} from './reporteInventarioMatanzas.repository';
import {
  descargarInventarioMatanzasCsv,
  descargarInventarioMatanzasExcel,
  descargarInventarioMatanzasPdf,
  type OpcionesExportacionMatanzas,
} from './exportarInventarioMatanzasDinamico';
import { textoWhatsappMatanzas } from './whatsappInventarioMatanzas';

const CLAVE_PREFS_MATANZAS = 'mgg.inventario.matanzas.reporte_dinamico.v1';

interface PrefsUsuarioMatanzas {
  agrupacion: ModoAgrupacionMatanzas;
  columnasPorAmbito?: Partial<Record<AmbitoInventarioMatanzas, string[]>>;
  orientacion: 'auto' | 'vertical' | 'horizontal';
}

function leerPrefs(): PrefsUsuarioMatanzas {
  const def: PrefsUsuarioMatanzas = {
    agrupacion: 'subalmacen',
    orientacion: 'auto',
  };
  try {
    const raw = localStorage.getItem(CLAVE_PREFS_MATANZAS);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<PrefsUsuarioMatanzas>;
    return {
      agrupacion: MODOS_AGRUPACION_MATANZAS.some((m) => m.id === parsed.agrupacion)
        ? (parsed.agrupacion as ModoAgrupacionMatanzas)
        : def.agrupacion,
      columnasPorAmbito: parsed.columnasPorAmbito || {},
      orientacion: parsed.orientacion || 'auto',
    };
  } catch {
    return def;
  }
}

function guardarPrefs(p: PrefsUsuarioMatanzas): void {
  try {
    localStorage.setItem(CLAVE_PREFS_MATANZAS, JSON.stringify(p));
  } catch {
    /* opcional */
  }
}

interface Props {
  ambitoInicial?: AmbitoInventarioMatanzas;
  subalmacenInicial?: string | null;
  onClose: () => void;
}

export function ReporteInventarioMatanzasModal({
  ambitoInicial = 'stock',
  subalmacenInicial,
  onClose,
}: Props) {
  const prefs = useMemo(() => leerPrefs(), []);

  // Ámbito activo (stock, movimientos, casiterita, criticos)
  const [ambito, setAmbito] = useState<AmbitoInventarioMatanzas>(ambitoInicial);

  // Estados de datos
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datosCrudos, setDatosCrudos] = useState<DatosCargadosMatanzas | null>(null);
  const [subalmacenesDisponibles, setSubalmacenesDisponibles] = useState<string[]>([]);

  // Subalmacenes seleccionados con checks
  const [subalmacenesSel, setSubalmacenesSel] = useState<string[]>(() =>
    subalmacenInicial ? [subalmacenInicial] : [],
  );

  // Categorías seleccionadas
  const [categoriasSel, setCategoriasSel] = useState<string[]>([]);

  // Filtros operativos
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroEstadoStock, setFiltroEstadoStock] = useState('todos');
  const [filtroTipoMov, setFiltroTipoMov] = useState('todos');
  const [presetRango, setPresetRango] = useState<PresetRangoMatanzas>('todos');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  // Columnas activas por ámbito
  const [columnasPorAmbito, setColumnasPorAmbito] = useState<Record<AmbitoInventarioMatanzas, string[]>>(() => ({
    stock: prefs.columnasPorAmbito?.stock ?? COLUMNAS_DEFAULT_MATANZAS.stock,
    movimientos: prefs.columnasPorAmbito?.movimientos ?? COLUMNAS_DEFAULT_MATANZAS.movimientos,
    casiterita: prefs.columnasPorAmbito?.casiterita ?? COLUMNAS_DEFAULT_MATANZAS.casiterita,
    criticos: prefs.columnasPorAmbito?.criticos ?? COLUMNAS_DEFAULT_MATANZAS.criticos,
  }));

  // Dimensión de agrupación y paginación
  const [agrupacion, setAgrupacion] = useState<ModoAgrupacionMatanzas>(prefs.agrupacion);
  const [orientacionPdf, setOrientacionPdf] = useState<'auto' | 'vertical' | 'horizontal'>(prefs.orientacion);
  const [paginaActual, setPaginaActual] = useState(1);
  const FILAS_POR_PAGINA = 15;

  // Estado ocupado para descargas
  const [busyExport, setBusyExport] = useState<'xlsx' | 'pdf' | 'csv' | null>(null);
  const [mostrarWhatsapp, setMostrarWhatsapp] = useState(false);

  const alternarWhatsapp = () => {
    setMostrarWhatsapp((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => {
          document.getElementById('panel-whatsapp-matanzas')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
      }
      return next;
    });
  };

  // Carga de subalmacenes al montar
  useEffect(() => {
    let cancelled = false;
    listSubalmacenesMatanzas()
      .then((subs) => {
        if (cancelled) return;
        setSubalmacenesDisponibles(subs);
        // Si no venía subalmacén inicial, seleccionamos todos por defecto
        if (!subalmacenInicial && (!subalmacenesSel || subalmacenesSel.length === 0)) {
          setSubalmacenesSel(subs);
        }
      })
      .catch(() => {
        /* fallback handled */
      });
    return () => {
      cancelled = true;
    };
  }, [subalmacenInicial]);

  // Carga de datos según ámbito
  const cargar = useCallback(
    async (silencioso = false) => {
      if (!silencioso) setLoading(true);
      setError(null);
      try {
        const datos = await cargarDatosReporteMatanzas(
          ambito,
          subalmacenesSel.length > 0 ? subalmacenesSel : undefined,
          fechaDesde || undefined,
          fechaHasta || undefined,
        );
        setDatosCrudos(datos);
        if (subalmacenesDisponibles.length === 0 && datos.subalmacenes.length > 0) {
          setSubalmacenesDisponibles(datos.subalmacenes);
        }
      } catch (err) {
        setError(mensajeError(err, 'No se pudieron cargar los datos de Matanzas'));
      } finally {
        if (!silencioso) setLoading(false);
      }
    },
    [ambito, subalmacenesSel, fechaDesde, fechaHasta, subalmacenesDisponibles.length],
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Sincronización en tiempo real
  useRealtime(['productos', 'existencias', 'movimientos'], () => cargar(true));

  // Manejo de preset de fechas
  useEffect(() => {
    const hoy = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    if (presetRango === 'todos') {
      setFechaDesde('');
      setFechaHasta('');
    } else if (presetRango === 'hoy') {
      setFechaDesde(iso(hoy));
      setFechaHasta(iso(hoy));
    } else if (presetRango === 'semana') {
      const hace7 = new Date();
      hace7.setDate(hoy.getDate() - 7);
      setFechaDesde(iso(hace7));
      setFechaHasta(iso(hoy));
    } else if (presetRango === 'mes') {
      const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      setFechaDesde(iso(inicioMes));
      setFechaHasta(iso(hoy));
    } else if (presetRango === 'mes_anterior') {
      const inicioMesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const finMesAnt = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
      setFechaDesde(iso(inicioMesAnt));
      setFechaHasta(iso(finMesAnt));
    } else if (presetRango === 'ult30') {
      const hace30 = new Date();
      hace30.setDate(hoy.getDate() - 30);
      setFechaDesde(iso(hace30));
      setFechaHasta(iso(hoy));
    } else if (presetRango === 'ult90') {
      const hace90 = new Date();
      hace90.setDate(hoy.getDate() - 90);
      setFechaDesde(iso(hace90));
      setFechaHasta(iso(hoy));
    } else if (presetRango === 'anio') {
      const inicioAnio = new Date(hoy.getFullYear(), 0, 1);
      setFechaDesde(iso(inicioAnio));
      setFechaHasta(iso(hoy));
    }
  }, [presetRango]);

  // Manejo de checks de subalmacenes
  const toggleSubalmacen = (nombre: string) => {
    setSubalmacenesSel((prev) =>
      prev.includes(nombre) ? prev.filter((s) => s !== nombre) : [...prev, nombre],
    );
  };

  const seleccionarTodosSubalmacenes = () => {
    setSubalmacenesSel(subalmacenesDisponibles);
  };

  const seleccionarSoloGeneral = () => {
    const general = subalmacenesDisponibles.filter(
      (s) => /general/i.test(s) || /taller/i.test(s) || /insumo/i.test(s),
    );
    setSubalmacenesSel(general.length > 0 ? general : subalmacenesDisponibles.slice(0, 1));
  };

  const seleccionarSoloMineral = () => {
    const mineral = subalmacenesDisponibles.filter(
      (s) => /casiterita/i.test(s) || /bruto/i.test(s) || /refinad/i.test(s),
    );
    setSubalmacenesSel(mineral.length > 0 ? mineral : subalmacenesDisponibles.slice(0, 1));
  };

  const toggleCategoria = (cat: string) => {
    setCategoriasSel((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
    setPaginaActual(1);
  };

  // Manejo de checks de columnas
  const columnasActivas = columnasPorAmbito[ambito] ?? COLUMNAS_DEFAULT_MATANZAS[ambito];

  const toggleColumna = (clave: string) => {
    setColumnasPorAmbito((prev) => {
      const actual = prev[ambito] ?? [];
      const updated = actual.includes(clave)
        ? actual.filter((c) => c !== clave)
        : [...actual, clave];
      const next = { ...prev, [ambito]: updated };
      guardarPrefs({ ...prefs, columnasPorAmbito: next, agrupacion, orientacion: orientacionPdf });
      return next;
    });
  };

  const aplicarPresetColumnas = (cols: string[]) => {
    setColumnasPorAmbito((prev) => {
      const next = { ...prev, [ambito]: cols };
      guardarPrefs({ ...prefs, columnasPorAmbito: next, agrupacion, orientacion: orientacionPdf });
      return next;
    });
  };

  // Filtrado reactivo síncrono puro
  const filasFiltradas = useMemo(() => {
    if (!datosCrudos) return [];
    const filtros: FiltrosReporteMatanzas = {
      subalmacenes: subalmacenesSel,
      categorias: categoriasSel,
      texto: filtroTexto,
      fechaDesde,
      fechaHasta,
      estadoStock: filtroEstadoStock,
      tipoMovimiento: filtroTipoMov,
    };
    return filtrarFilasMatanzas(datosCrudos.filas, filtros);
  }, [
    datosCrudos,
    subalmacenesSel,
    categoriasSel,
    filtroTexto,
    fechaDesde,
    fechaHasta,
    filtroEstadoStock,
    filtroTipoMov,
  ]);

  // Resumen reactivo de métricas
  const tasaBcv = datosCrudos?.tasaBcv ?? 1;
  const resumen = useMemo(
    () => calcularResumenMatanzas(filasFiltradas, tasaBcv),
    [filasFiltradas, tasaBcv],
  );

  // Tarjetas KPI ejecutivas ("Sin discusión")
  const metricasCards = useMemo(
    () => obtenerMetricasFichaMatanzas(resumen, ambito, columnasActivas, subalmacenesSel),
    [resumen, ambito, columnasActivas, subalmacenesSel],
  );

  // Columnas visibles filtradas según el ámbito actual
  const catalogoColumnasAmbito = useMemo(
    () => CAMPOS_REPORTE_MATANZAS.filter((c) => c.ambitos.includes(ambito)),
    [ambito],
  );

  const columnasTabla = useMemo(
    () => catalogoColumnasAmbito.filter((c) => columnasActivas.includes(c.clave)),
    [catalogoColumnasAmbito, columnasActivas],
  );

  // Paginación de la vista previa
  const totalPaginas = Math.max(1, Math.ceil(filasFiltradas.length / FILAS_POR_PAGINA));
  const filasPagina = useMemo(() => {
    const inicio = (paginaActual - 1) * FILAS_POR_PAGINA;
    return filasFiltradas.slice(inicio, inicio + FILAS_POR_PAGINA);
  }, [filasFiltradas, paginaActual]);

  const textoSubalmacenesExport = useMemo(() => {
    if (subalmacenesSel.length === 0) return 'Ningún subalmacén seleccionado';
    if (subalmacenesSel.length === subalmacenesDisponibles.length) return 'Todos los subalmacenes';
    return subalmacenesSel.join(', ');
  }, [subalmacenesSel, subalmacenesDisponibles]);

  // Opciones de exportación
  const opcionesExport: OpcionesExportacionMatanzas = useMemo(
    () => ({
      ambito,
      agrupacion,
      columnasClaves: columnasActivas,
      subalmacenesTexto: textoSubalmacenesExport,
      resumen,
      filas: filasFiltradas,
      orientacion: orientacionPdf,
      desde: fechaDesde,
      hasta: fechaHasta,
    }),
    [
      ambito,
      agrupacion,
      columnasActivas,
      textoSubalmacenesExport,
      resumen,
      filasFiltradas,
      orientacionPdf,
      fechaDesde,
      fechaHasta,
    ],
  );

  // Manejo de exportaciones
  const handleExportar = async (tipo: 'xlsx' | 'pdf' | 'csv') => {
    if (!filasFiltradas.length) {
      toast('No hay filas para exportar con los filtros seleccionados', 'warning');
      return;
    }
    setBusyExport(tipo);
    try {
      if (tipo === 'xlsx') {
        await descargarInventarioMatanzasExcel(opcionesExport);
        toast(`Excel exportado · ${filasFiltradas.length} registros`, 'success');
      } else if (tipo === 'pdf') {
        await descargarInventarioMatanzasPdf(opcionesExport);
        toast(`PDF exportado · ${filasFiltradas.length} registros`, 'success');
      } else {
        descargarInventarioMatanzasCsv(opcionesExport);
        toast(`CSV exportado · ${filasFiltradas.length} registros`, 'success');
      }
    } catch (err) {
      toast(mensajeError(err, `No se pudo generar el ${tipo.toUpperCase()}`), 'error');
    } finally {
      setBusyExport(null);
    }
  };

  const textoWhatsapp = useMemo(
    () =>
      textoWhatsappMatanzas({
        ambito,
        agrupacion,
        subalmacenesTexto: textoSubalmacenesExport,
        columnasClaves: columnasActivas,
        resumen,
        filas: filasFiltradas,
        desde: fechaDesde,
        hasta: fechaHasta,
      }),
    [
      ambito,
      agrupacion,
      textoSubalmacenesExport,
      columnasActivas,
      resumen,
      filasFiltradas,
      fechaDesde,
      fechaHasta,
    ],
  );

  return (
    <Modal
      title="📊 Reporte Dinámico · Centro de Fundición Matanzas"
      size="xl"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
            <span className="muted" style={{ fontSize: '.8rem' }}>
              Mostrando {filasFiltradas.length} fila(s)
            </span>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={!!busyExport}>
              Cerrar
            </button>
            <button
              type="button"
              className={`btn ${mostrarWhatsapp ? 'btn-primary' : 'btn-ghost'}`}
              onClick={alternarWhatsapp}
              disabled={!!busyExport || !filasFiltradas.length}
              title={mostrarWhatsapp ? 'Ocultar panel de WhatsApp' : 'Ver y compartir resumen estructurado por WhatsApp'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}
            >
              <span>💬</span> {mostrarWhatsapp ? 'Ocultar WhatsApp' : 'WhatsApp'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => handleExportar('csv')}
              disabled={!!busyExport || !filasFiltradas.length}
              title="Descargar CSV con codificación UTF-8 BOM para Excel"
            >
              ↓ CSV
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => handleExportar('pdf')}
              disabled={!!busyExport || !filasFiltradas.length}
              title="Vista previa y descarga del informe en PDF"
            >
              {busyExport === 'pdf' ? 'Generando PDF…' : '↓ PDF'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => handleExportar('xlsx')}
              disabled={!!busyExport || !filasFiltradas.length}
              title="Descargar hoja de cálculo Excel profesional con formato y fórmulas"
            >
              {busyExport === 'xlsx' ? 'Generando Excel…' : '↓ Excel'}
            </button>
          </div>
        </div>
      }
    >
      {/* 1. Selector de Ámbitos Operativos */}
      <div
        className="tabs"
        role="tablist"
        aria-label="Ámbitos del Reporte de Matanzas"
        style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}
      >
        {AMBITOS_INVENTARIO_MATANZAS.map((a) => {
          const isActive = a.id === ambito;
          return (
            <button
              key={a.id}
              role="tab"
              aria-selected={isActive}
              className={`tab ${isActive ? 'tab-active' : ''}`}
              onClick={() => {
                setAmbito(a.id);
                setPaginaActual(1);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '.4rem',
                padding: '.6rem .9rem',
                border: 'none',
                background: isActive ? 'var(--bg-card)' : 'transparent',
                borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              <span>{a.icon}</span>
              <span>{a.label}</span>
            </button>
          );
        })}
      </div>

      {/* 2. Sección de Casillas de Subalmacenes ("Sin Discusión") */}
      <div
        className="card"
        style={{
          background: 'rgba(255, 138, 0, 0.04)',
          borderColor: 'rgba(255, 138, 0, 0.25)',
          padding: '.75rem .9rem',
          marginBottom: '1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem', flexWrap: 'wrap', gap: '.4rem' }}>
          <strong style={{ fontSize: '.88rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
            <span>🏢</span>
            <span>Subalmacenes de Matanzas a incluir:</span>
            <span className="badge" style={{ fontSize: '.72rem', background: 'var(--primary)', color: '#fff' }}>
              {subalmacenesSel.length} de {subalmacenesDisponibles.length} seleccionados
            </span>
          </strong>
          <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={seleccionarTodosSubalmacenes}>
              ✓ Todos
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={seleccionarSoloGeneral}>
              Solo General
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={seleccionarSoloMineral}>
              Solo Estaño/Mineral
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setSubalmacenesSel([])}
              style={{ color: 'var(--danger)' }}
            >
              Limpiar
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', marginTop: '.3rem' }}>
          {subalmacenesDisponibles.map((sub) => {
            const isChecked = subalmacenesSel.includes(sub);
            return (
              <label
                key={sub}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '.35rem',
                  fontSize: '.82rem',
                  padding: '.25rem .55rem',
                  borderRadius: '4px',
                  background: isChecked ? 'rgba(255, 138, 0, 0.12)' : 'var(--bg-subtle, #1e293b22)',
                  border: isChecked ? '1px solid var(--primary)' : '1px solid var(--border)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleSubalmacen(sub)}
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span>{sub}</span>
              </label>
            );
          })}
        </div>
        {subalmacenesSel.length === 0 && (
          <p className="hint muted" style={{ fontSize: '.78rem', color: 'var(--danger)', marginTop: '.4rem', marginBottom: 0 }}>
            ⚠ Ningún subalmacén seleccionado. Marcá al menos uno en las casillas para visualizar el inventario.
          </p>
        )}
      </div>

      {/* 3. Tarjetas KPI Reactivas en Cabecera */}
      <div
        className="kpi-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${metricasCards.length}, 1fr)`,
          gap: '.7rem',
          marginBottom: '1rem',
        }}
      >
        {metricasCards.map((k) => (
          <div
            key={k.clave}
            className="kpi"
            style={{
              padding: '.7rem',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              background: 'var(--bg-card)',
            }}
          >
            <div
              className="label"
              style={{
                fontSize: '.72rem',
                color: k.colorCss,
                fontWeight: 600,
                letterSpacing: '.03em',
                marginBottom: '.2rem',
              }}
            >
              {k.etiqueta}
            </div>
            <div
              className="value"
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                color: 'var(--text-main)',
                lineHeight: 1.15,
              }}
            >
              {k.valor}
            </div>
            <div
              className="delta"
              style={{
                fontSize: '.72rem',
                color: 'var(--text-muted)',
                marginTop: '.2rem',
              }}
            >
              {k.sub}
            </div>
          </div>
        ))}
      </div>

      {/* 4. Filtros Interactivos y Presets de Columnas */}
      <div
        className="card"
        style={{
          padding: '.8rem',
          marginBottom: '1rem',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.6rem', marginBottom: '.6rem' }}>
          <div>
            <label style={{ fontSize: '.78rem', fontWeight: 600 }}>🔍 Buscar en texto</label>
            <input
              type="text"
              className="input input-sm"
              placeholder="SKU, producto, lote, actor..."
              value={filtroTexto}
              onChange={(e) => {
                setFiltroTexto(e.target.value);
                setPaginaActual(1);
              }}
              style={{ width: '100%' }}
            />
          </div>

          {ambito === 'movimientos' ? (
            <>
              <div>
                <label style={{ fontSize: '.78rem', fontWeight: 600 }}>📅 Rango de Fechas</label>
                <select
                  className="input input-sm"
                  value={presetRango}
                  onChange={(e) => setPresetRango(e.target.value as PresetRangoMatanzas)}
                  style={{ width: '100%' }}
                >
                  {PRESETS_RANGO_MATANZAS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '.78rem', fontWeight: 600 }}>Tipo de Movimiento</label>
                <select
                  className="input input-sm"
                  value={filtroTipoMov}
                  onChange={(e) => setFiltroTipoMov(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="todos">Todos los tipos</option>
                  <option value="entrada">Entradas / Recepciones</option>
                  <option value="salida">Salidas</option>
                  <option value="transferencia">Traslados</option>
                  <option value="ajuste">Ajustes</option>
                </select>
              </div>
            </>
          ) : (
            <div>
              <label style={{ fontSize: '.78rem', fontWeight: 600 }}>Estado de Stock</label>
              <select
                className="input input-sm"
                value={filtroEstadoStock}
                onChange={(e) => setFiltroEstadoStock(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="todos">Todos los estados</option>
                <option value="normal">Normal</option>
                <option value="bajo_minimo">Bajo Mínimo</option>
                <option value="sin_costo">Sin Costo ($0)</option>
              </select>
            </div>
          )}

          <div>
            <label style={{ fontSize: '.78rem', fontWeight: 600 }}>Agrupar por</label>
            <select
              className="input input-sm"
              value={agrupacion}
              onChange={(e) => setAgrupacion(e.target.value as ModoAgrupacionMatanzas)}
              style={{ width: '100%' }}
            >
              {MODOS_AGRUPACION_MATANZAS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '.78rem', fontWeight: 600 }}>Orientación PDF</label>
            <select
              className="input input-sm"
              value={orientacionPdf}
              onChange={(e) => {
                const o = e.target.value as 'auto' | 'vertical' | 'horizontal';
                setOrientacionPdf(o);
                guardarPrefs({ ...prefs, orientacion: o, agrupacion, columnasPorAmbito });
              }}
              style={{ width: '100%' }}
            >
              <option value="auto">Auto (según columnas)</option>
              <option value="vertical">Vertical (Portrait)</option>
              <option value="horizontal">Horizontal (Landscape)</option>
            </select>
          </div>
        </div>

        {/* Selector de Categorías (si hay disponibles) */}
        {datosCrudos?.categorias && datosCrudos.categorias.length > 0 && ambito !== 'casiterita' && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.4rem', marginTop: '.3rem', marginBottom: '.4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.25rem' }}>
              <span style={{ fontSize: '.75rem', fontWeight: 600 }}>
                📁 Categorías ({categoriasSel.length > 0 ? `${categoriasSel.length} seleccionadas` : 'Todas'}):
              </span>
              {categoriasSel.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setCategoriasSel([]);
                    setPaginaActual(1);
                  }}
                  style={{ fontSize: '.72rem', padding: '0 .3rem' }}
                >
                  Mostrar todas
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
              {datosCrudos.categorias.map((cat) => {
                const isChecked = categoriasSel.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`btn btn-sm ${isChecked ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => toggleCategoria(cat)}
                    style={{ fontSize: '.72rem', padding: '.15rem .4rem', height: 'auto', minHeight: 'unset' }}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Selector de Columnas con Presets */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.5rem', marginTop: '.4rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.35rem', flexWrap: 'wrap', gap: '.4rem' }}>
            <span style={{ fontSize: '.78rem', fontWeight: 600 }}>
              📋 Columnas ({columnasTabla.length} de {catalogoColumnasAmbito.length} activas):
            </span>
            <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
              {(COLUMNAS_PRESETS_MATANZAS[ambito] ?? []).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => aplicarPresetColumnas(preset.columnas)}
                  style={{ fontSize: '.74rem', padding: '.15rem .45rem' }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
            {catalogoColumnasAmbito.map((col) => {
              const isChecked = columnasActivas.includes(col.clave);
              return (
                <label
                  key={col.clave}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '.3rem',
                    fontSize: '.75rem',
                    padding: '.15rem .4rem',
                    borderRadius: '3px',
                    background: isChecked ? 'rgba(52, 152, 219, 0.12)' : 'transparent',
                    border: isChecked ? '1px solid #3498db' : '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleColumna(col.clave)}
                    style={{ accentColor: '#3498db' }}
                  />
                  <span>{col.etiqueta}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* Panel colapsable de WhatsApp (se muestra u oculta tras presionar el botón) */}
      {mostrarWhatsapp && (
        <div
          id="panel-whatsapp-matanzas"
          className="card"
          style={{
            marginBottom: '1rem',
            background: 'var(--surface-3, #1e293b)',
            border: '1px solid var(--success, #25D366)',
            padding: '.85rem',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.2))',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '.6rem',
            }}
          >
            <strong
              style={{
                fontSize: '.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '.45rem',
                color: 'var(--success, #25D366)',
              }}
            >
              <span>💬</span> Resumen estructurado para WhatsApp ({AMBITOS_INVENTARIO_MATANZAS.find((a) => a.id === ambito)?.label ?? 'Reporte'})
            </strong>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setMostrarWhatsapp(false)}
              style={{ fontSize: '.78rem' }}
            >
              ✕ Ocultar
            </button>
          </div>
          <CompartirWhatsapp texto={textoWhatsapp} />
        </div>
      )}

      {/* 5. Vista Previa Tabular */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="spinner" /> Cargando datos del Centro de Fundición Matanzas…
        </div>
      ) : error ? (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', padding: '1rem' }}>
          {error}
        </div>
      ) : filasFiltradas.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          <p style={{ margin: 0 }}>No hay registros que coincidan con los filtros y subalmacenes seleccionados.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
          <table className="table" style={{ width: '100%', fontSize: '.82rem', margin: 0 }}>
            <thead>
              <tr style={{ background: 'var(--bg-subtle, #1e293b11)' }}>
                {columnasTabla.map((col) => (
                  <th
                    key={col.clave}
                    style={{
                      textAlign: col.alineacion,
                      padding: '.5rem .6rem',
                      whiteSpace: 'nowrap',
                      borderBottom: '2px solid var(--primary)',
                    }}
                  >
                    {col.etiqueta}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filasPagina.map((fila) => (
                <tr key={fila.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  {columnasTabla.map((col) => {
                    const texto = formatearCeldaMatanzas(fila[col.clave], col.formato, col.clave);
                    const esCritico =
                      (col.clave === 'estado_stock' && (texto === 'Bajo Mínimo' || texto === 'Sin Stock')) ||
                      (col.clave === 'costo_usd' && fila.stock > 0 && fila.costo_usd <= 0);

                    return (
                      <td
                        key={col.clave}
                        style={{
                          textAlign: col.alineacion,
                          padding: '.45rem .6rem',
                          whiteSpace: 'nowrap',
                          color: esCritico ? 'var(--danger)' : undefined,
                          fontWeight: esCritico ? 600 : undefined,
                        }}
                      >
                        {col.clave === 'estado_stock' && texto === 'Bajo Mínimo' ? (
                          <span className="badge" style={{ background: 'var(--danger)', color: '#fff', fontSize: '.72rem' }}>
                            ⚠ Bajo Mínimo
                          </span>
                        ) : col.clave === 'estado_stock' && texto === 'Sin Costo ($0)' ? (
                          <span className="badge" style={{ background: 'var(--warning)', color: '#000', fontSize: '.72rem' }}>
                            ⚠ Sin Costo
                          </span>
                        ) : (
                          texto
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Paginación */}
          {totalPaginas > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '.5rem .8rem',
                borderTop: '1px solid var(--border)',
                background: 'var(--bg-card)',
              }}
            >
              <span className="muted" style={{ fontSize: '.78rem' }}>
                Página {paginaActual} de {totalPaginas} ({filasFiltradas.length} total)
              </span>
              <div style={{ display: 'flex', gap: '.4rem' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setPaginaActual((p) => Math.max(1, p - 1))}
                  disabled={paginaActual <= 1}
                >
                  ← Anterior
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setPaginaActual((p) => Math.min(totalPaginas, p + 1))}
                  disabled={paginaActual >= totalPaginas}
                >
                  Siguiente →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

