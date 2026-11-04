/* ============================================================
   MGG · RRHH · «Reporte Dinámico de Recursos Humanos» (04-11-2026)

   Modal interactivo multi-empresa que unifica:
     - Directorio y Personal (ficha, pagos, carga familiar)
     - Histórico Salarial (cambios de sueldo y aumentos)
     - Histórico de Cargos (tabulador salarial)

   Soporta selección de múltiples empresas con casillas, filtros avanzados
   (incluyendo hijos / carga familiar), selección de columnas con presets,
   vista previa en vivo con tarjetas KPI y exportación a Excel, PDF, CSV
   y WhatsApp.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { mensajeError } from '@/shared/lib/errores';
import { useRealtime } from '@/shared/lib/useRealtime';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import type { Personal } from '@/shared/lib/types';
import type { DefinicionEmpresa } from './empresa';
import type { CambioSueldoRegistro, FamiliarPersonal } from './personal.repository';
import type { HistorialTabulador } from './tabulador';
import { cargarDatosReporteRrhh } from './reporteRrhh.repository';
import {
  AMBITOS_RRHH,
  CAMPOS_DEFAULT_RRHH,
  CAMPOS_REPORTE_RRHH,
  MODOS_AGRUPACION_RRHH,
  calcularResumenRrhh,
  filtrarFilasRrhh,
  normalizarHistoricoCargosRrhh,
  normalizarHistoricoSalarialRrhh,
  normalizarPersonalRrhh,
  obtenerMetricasFichaRrhh,
  procesarFilasReporteRrhh,
  type AmbitoRrhh,
  type FilaReporteRrhh,
  type FiltrosRrhh,
  type ModoAgrupacionRrhh,
} from './reporteRrhhDinamico';
import {
  descargarRrhhCsv,
  descargarRrhhExcel,
  descargarRrhhPdf,
  textoCeldaRrhh,
  type OpcionesExportacionRrhh,
} from './exportarRrhhDinamico';
import { textoWhatsappRrhh } from './whatsappRrhh';

const CLAVE_PREFS_RRHH = 'mgg.rrhh.reporte_dinamico.v1';

interface PrefsUsuario {
  agrupacion: ModoAgrupacionRrhh;
  columnasPorAmbito?: Partial<Record<AmbitoRrhh, string[]>>;
  orientacion: 'auto' | 'vertical' | 'horizontal';
}

function leerPrefs(): PrefsUsuario {
  const def: PrefsUsuario = {
    agrupacion: 'departamento',
    orientacion: 'auto',
  };
  try {
    const raw = localStorage.getItem(CLAVE_PREFS_RRHH);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<PrefsUsuario>;
    return {
      agrupacion: MODOS_AGRUPACION_RRHH.some((m) => m.id === parsed.agrupacion)
        ? (parsed.agrupacion as ModoAgrupacionRrhh)
        : def.agrupacion,
      columnasPorAmbito: parsed.columnasPorAmbito || {},
      orientacion: parsed.orientacion || 'auto',
    };
  } catch {
    return def;
  }
}

function guardarPrefs(p: PrefsUsuario): void {
  try {
    localStorage.setItem(CLAVE_PREFS_RRHH, JSON.stringify(p));
  } catch {
    /* opcional */
  }
}

interface Props {
  empresaInicial?: string;
  ambitoInicial?: AmbitoRrhh;
  personalInicial?: Personal[];
  onClose: () => void;
}

export function ReporteRrhhModal({ empresaInicial, ambitoInicial = 'personal', personalInicial, onClose }: Props) {
  const prefs = useMemo(() => leerPrefs(), []);

  // Estados de control
  const [ambito, setAmbito] = useState<AmbitoRrhh>(ambitoInicial);
  const [agrupacion, setAgrupacion] = useState<ModoAgrupacionRrhh>(prefs.agrupacion);
  const [orientacion, setOrientacion] = useState<'auto' | 'vertical' | 'horizontal'>(prefs.orientacion);

  // Multi-empresa (checks)
  const [empresas, setEmpresas] = useState<DefinicionEmpresa[]>([]);
  const [empresasSel, setEmpresasSel] = useState<string[]>(() =>
    empresaInicial ? [empresaInicial] : ['MGG'],
  );

  // Filtro de Hijos / Carga Familiar
  const [filtroHijos, setFiltroHijos] = useState<'todos' | 'con_hijos' | 'sin_hijos'>('todos');

  // Filtros generales
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [estadoSel, setEstadoSel] = useState<'todos' | 'activo' | 'inactivo'>('todos');

  // Columnas activas
  const [columnasSel, setColumnasSel] = useState<string[]>(() => {
    return prefs.columnasPorAmbito?.[ambitoInicial] || CAMPOS_DEFAULT_RRHH[ambitoInicial][prefs.agrupacion];
  });

  // Datos en memoria
  const [cargando, setCargando] = useState(true);
  const [generando, setGenerando] = useState<'excel' | 'pdf' | 'csv' | null>(null);
  const [personal, setPersonal] = useState<Personal[]>(personalInicial ?? []);
  const [cambiosSueldo, setCambiosSueldo] = useState<CambioSueldoRegistro[]>([]);
  const [historialTabulador, setHistorialTabulador] = useState<HistorialTabulador[]>([]);
  const [mapaFamilia, setMapaFamilia] = useState<Map<string, FamiliarPersonal[]>>(new Map());
  const [mapaEmpresas, setMapaEmpresas] = useState<Map<string, DefinicionEmpresa>>(new Map());
  const [tasaBcv, setTasaBcv] = useState(1);
  const [recarga, setRecarga] = useState(0);

  // Carga de datos de Supabase
  const claveCarga = `${ambito}|${empresasSel.sort().join(',')}|${desde}|${hasta}`;
  const ultimaCarga = useRef('');

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      if (ultimaCarga.current !== claveCarga) setCargando(true);
      try {
        const datos = await cargarDatosReporteRrhh({
          ambito,
          empresasSel: empresasSel.length ? empresasSel : undefined,
          desde: desde || undefined,
          hasta: hasta || undefined,
        });

        if (!cancelado) {
          setEmpresas(datos.empresas);
          setMapaEmpresas(datos.mapaEmpresas);
          setPersonal(datos.personal);
          setMapaFamilia(datos.mapaFamilia);
          setCambiosSueldo(datos.cambiosSueldo);
          setHistorialTabulador(datos.historialTabulador);
          setTasaBcv(datos.tasaBcv);
          ultimaCarga.current = claveCarga;
        }
      } catch (err) {
        if (!cancelado) toast(mensajeError(err, 'No se pudieron cargar los datos de RRHH'), 'error');
      } finally {
        if (!cancelado) setCargando(false);
      }
    }
    void cargar();
    return () => {
      cancelado = true;
    };
  }, [claveCarga, recarga]);

  // Recarga silenciosa en tiempo real
  const recargarEnVivo = useCallback(() => setRecarga((n) => n + 1), []);
  useRealtime(['personal', 'personal_sueldos', 'personal_carga_familiar', 'tabulador_cargos_historial'], recargarEnVivo);

  // Al cambiar de ámbito o modo, actualizar las columnas por defecto si el usuario no tiene guardadas
  const cambiarAmbito = (nuevo: AmbitoRrhh) => {
    setAmbito(nuevo);
    const cols = prefs.columnasPorAmbito?.[nuevo] || CAMPOS_DEFAULT_RRHH[nuevo][agrupacion];
    setColumnasSel(cols);
  };

  const cambiarAgrupacion = (nuevoModo: ModoAgrupacionRrhh) => {
    setAgrupacion(nuevoModo);
    const cols = CAMPOS_DEFAULT_RRHH[ambito][nuevoModo];
    setColumnasSel(cols);
    guardarPrefs({ ...prefs, agrupacion: nuevoModo });
  };

  // Toggle de columnas individuales
  const toggleColumna = (clave: string) => {
    setColumnasSel((prev) => {
      const next = prev.includes(clave) ? prev.filter((k) => k !== clave) : [...prev, clave];
      guardarPrefs({
        ...prefs,
        columnasPorAmbito: {
          ...prefs.columnasPorAmbito,
          [ambito]: next,
        },
      });
      return next;
    });
  };

  const marcarTodasColumnas = () => {
    const todas = CAMPOS_REPORTE_RRHH.filter((c) => c.ambitos.includes(ambito)).map((c) => c.clave);
    setColumnasSel(todas);
  };

  const restaurarColumnasDefault = () => {
    const cols = CAMPOS_DEFAULT_RRHH[ambito][agrupacion];
    setColumnasSel(cols);
  };

  // Toggle de multi-empresa
  const toggleEmpresa = (codigo: string) => {
    setEmpresasSel((prev) => {
      if (prev.includes(codigo)) {
        return prev.length === 1 ? prev : prev.filter((c) => c !== codigo);
      }
      return [...prev, codigo];
    });
  };

  const seleccionarTodasEmpresas = () => {
    setEmpresasSel(empresas.map((e) => e.key));
  };

  const seleccionarSoloActual = () => {
    if (empresaInicial) setEmpresasSel([empresaInicial]);
  };

  // Normalización según ámbito
  const filasDetalle = useMemo<FilaReporteRrhh[]>(() => {
    if (ambito === 'historico_salarial') {
      return normalizarHistoricoSalarialRrhh(cambiosSueldo, personal, mapaEmpresas, tasaBcv, mapaFamilia);
    }
    if (ambito === 'historico_cargos') {
      return normalizarHistoricoCargosRrhh(historialTabulador, personal, tasaBcv);
    }
    return normalizarPersonalRrhh(personal, mapaEmpresas, tasaBcv, mapaFamilia);
  }, [ambito, personal, cambiosSueldo, historialTabulador, mapaEmpresas, tasaBcv, mapaFamilia]);

  // Filtros aplicados
  const filtros: FiltrosRrhh = useMemo(
    () => ({
      empresasSel: empresasSel.length ? empresasSel : undefined,
      filtroHijos,
      estadosSel: estadoSel === 'todos' ? undefined : [estadoSel],
      texto: textoBusqueda,
      desde: desde || undefined,
      hasta: hasta || undefined,
    }),
    [empresasSel, filtroHijos, estadoSel, textoBusqueda, desde, hasta],
  );

  const filasFiltradas = useMemo(() => filtrarFilasRrhh(filasDetalle, filtros), [filasDetalle, filtros]);

  // Agrupación
  const filasProcesadas = useMemo(
    () => procesarFilasReporteRrhh(filasFiltradas, agrupacion, tasaBcv),
    [filasFiltradas, agrupacion, tasaBcv],
  );

  // Resumen ejecutivo / KPIs
  const resumen = useMemo(
    () => calcularResumenRrhh(filasFiltradas, tasaBcv, empresas),
    [filasFiltradas, tasaBcv, empresas],
  );

  const metricasKpi = useMemo(() => obtenerMetricasFichaRrhh(resumen, ambito, columnasSel), [resumen, ambito, columnasSel]);

  const columnasDisponibles = useMemo(
    () => CAMPOS_REPORTE_RRHH.filter((c) => c.ambitos.includes(ambito)),
    [ambito],
  );

  const empresasTexto = useMemo(() => {
    if (empresasSel.length === empresas.length) return 'Todas las empresas';
    return empresasSel
      .map((k) => empresas.find((e) => e.key === k)?.label || k)
      .join(', ');
  }, [empresasSel, empresas]);

  // Parámetros para exportar
  const paramsExport: OpcionesExportacionRrhh = useMemo(
    () => ({
      ambito,
      agrupacion,
      columnasClaves: columnasSel,
      empresasTexto,
      resumen,
      filas: filasProcesadas,
      orientacion,
      desde: desde || undefined,
      hasta: hasta || undefined,
    }),
    [ambito, agrupacion, columnasSel, empresasTexto, resumen, filasProcesadas, orientacion, desde, hasta],
  );

  const textoWa = useMemo(
    () =>
      textoWhatsappRrhh({
        ambito,
        agrupacion,
        empresasTexto,
        resumen,
        filas: filasProcesadas,
        desde: desde || undefined,
        hasta: hasta || undefined,
      }),
    [ambito, agrupacion, empresasTexto, resumen, filasProcesadas, desde, hasta],
  );

  // Disparadores de descarga
  const handleExportarExcel = async () => {
    setGenerando('excel');
    try {
      await descargarRrhhExcel(paramsExport);
    } catch (e) {
      toast(mensajeError(e, 'No se pudo generar el Excel'), 'error');
    } finally {
      setGenerando(null);
    }
  };

  const handleExportarPdf = async () => {
    setGenerando('pdf');
    try {
      await descargarRrhhPdf(paramsExport);
    } catch (e) {
      toast(mensajeError(e, 'No se pudo generar el PDF'), 'error');
    } finally {
      setGenerando(null);
    }
  };

  const handleExportarCsv = () => {
    try {
      descargarRrhhCsv(paramsExport);
    } catch (e) {
      toast(mensajeError(e, 'No se pudo descargar el CSV'), 'error');
    }
  };

  return (
    <Modal
      title="📊 Reporte Dinámico de Recursos Humanos"
      size="xl"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
          <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
            {cargando ? 'Cargando datos...' : `${filasFiltradas.length} colaboradores coincidentes (${filasProcesadas.length} filas en reporte)`}
          </div>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={!!generando}>
              Cerrar
            </button>
            <CompartirWhatsapp texto={textoWa} />
            <button className="btn btn-ghost" onClick={handleExportarCsv} disabled={cargando || !filasProcesadas.length}>
              📋 CSV
            </button>
            <button className="btn btn-ghost" onClick={handleExportarExcel} disabled={cargando || !!generando || !filasProcesadas.length}>
              {generando === 'excel' ? 'Generando...' : '📊 Excel'}
            </button>
            <select
              className="select"
              value={orientacion}
              onChange={(e) => setOrientacion(e.target.value as 'auto' | 'vertical' | 'horizontal')}
              title="Orientación del PDF"
              style={{ fontSize: '.78rem', height: '32px', padding: '0 .4rem' }}
            >
              <option value="auto">PDF: Auto</option>
              <option value="horizontal">PDF: Horizontal</option>
              <option value="vertical">PDF: Vertical</option>
            </select>
            <button className="btn btn-primary" onClick={handleExportarPdf} disabled={cargando || !!generando || !filasProcesadas.length}>
              {generando === 'pdf' ? 'Generando...' : '📄 PDF para imprimir'}
            </button>
          </div>
        </div>
      }
    >
      {/* 1. Selector de Ámbito / Vertiente */}
      <div style={{ display: 'flex', gap: '.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {AMBITOS_RRHH.map((a) => {
          const sel = ambito === a.id;
          return (
            <button
              key={a.id}
              type="button"
              className={`btn ${sel ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => cambiarAmbito(a.id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.88rem' }}
            >
              <span>{a.icon}</span>
              <strong>{a.label}</strong>
            </button>
          );
        })}
      </div>

      {/* 2. Selector Multi-Empresa con Casillas (Checks) */}
      <div style={{ background: 'var(--card-bg, #1a1e24)', padding: '.75rem 1rem', borderRadius: 'var(--radius, 8px)', marginBottom: '1rem', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <div style={{ fontSize: '.85rem', fontWeight: 600 }}>
            🏢 Empresas / Nóminas incluidas en el reporte:
          </div>
          <div style={{ display: 'flex', gap: '.4rem' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={seleccionarTodasEmpresas} style={{ fontSize: '.75rem' }}>
              ✓ Todas
            </button>
            {empresaInicial && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={seleccionarSoloActual} style={{ fontSize: '.75rem' }}>
                Solo {empresaInicial}
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {empresas.map((e) => {
            const checked = empresasSel.includes(e.key);
            return (
              <label
                key={e.key}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '.35rem',
                  fontSize: '.82rem',
                  cursor: 'pointer',
                  padding: '.25rem .5rem',
                  borderRadius: '4px',
                  background: checked ? 'rgba(255, 138, 0, 0.15)' : 'transparent',
                  border: checked ? '1px solid var(--primary)' : '1px solid transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleEmpresa(e.key)}
                />
                <span>{e.icono || '🏢'} <strong>{e.label}</strong></span>
              </label>
            );
          })}
        </div>
      </div>

      {empresasSel.length === 0 && (
        <div style={{ padding: '.5rem .75rem', borderRadius: '6px', background: 'rgba(243, 156, 18, 0.12)', border: '1px solid rgba(243, 156, 18, 0.3)', color: 'var(--warning)', fontSize: '.8rem', marginBottom: '.75rem' }}>
          ⚠️ Ninguna empresa marcada en las casillas. Marque al menos una empresa arriba para ver colaboradores.
        </div>
      )}
      {columnasSel.length === 0 && (
        <div style={{ padding: '.5rem .75rem', borderRadius: '6px', background: 'rgba(52, 152, 219, 0.12)', border: '1px solid rgba(52, 152, 219, 0.3)', color: 'var(--info)', fontSize: '.8rem', marginBottom: '.75rem' }}>
          ℹ️ Ninguna columna marcada. Marque las casillas de columnas para visualizar y exportar información.
        </div>
      )}

      {/* 3. Filtros y Dimensiones */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>
        {/* Agrupación */}
        <div>
          <label style={{ display: 'block', fontSize: '.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '.3rem' }}>
            AGRUPAR POR
          </label>
          <select
            className="select"
            value={agrupacion}
            onChange={(e) => cambiarAgrupacion(e.target.value as ModoAgrupacionRrhh)}
            style={{ width: '100%' }}
          >
            {MODOS_AGRUPACION_RRHH.map((m) => (
              <option key={m.id} value={m.id}>
                {m.icon} {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Filtro Hijos / Carga Familiar (Requerimiento Crítico) */}
        <div>
          <label style={{ display: 'block', fontSize: '.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '.3rem' }}>
            👶 HIJOS / CARGA FAMILIAR
          </label>
          <div style={{ display: 'flex', gap: '.3rem' }}>
            <button
              type="button"
              className={`btn btn-sm ${filtroHijos === 'todos' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFiltroHijos('todos')}
              style={{ flex: 1, fontSize: '.75rem' }}
            >
              Todos ({resumen.totalPersonas})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filtroHijos === 'con_hijos' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFiltroHijos('con_hijos')}
              style={{ flex: 1, fontSize: '.75rem' }}
              title="Solo colaboradores que tienen hijos registrados"
            >
              Con Hijos ({resumen.conHijos})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filtroHijos === 'sin_hijos' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFiltroHijos('sin_hijos')}
              style={{ flex: 1, fontSize: '.75rem' }}
              title="Colaboradores sin hijos"
            >
              Sin Hijos ({resumen.sinHijos})
            </button>
          </div>
        </div>

        {/* Estado activo/inactivo */}
        <div>
          <label style={{ display: 'block', fontSize: '.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '.3rem' }}>
            ESTADO DEL PERSONAL
          </label>
          <select
            className="select"
            value={estadoSel}
            onChange={(e) => setEstadoSel(e.target.value as 'todos' | 'activo' | 'inactivo')}
            style={{ width: '100%' }}
          >
            <option value="todos">Todos (Activos e Inactivos)</option>
            <option value="activo">Solo Personal Activo</option>
            <option value="inactivo">Solo Personal Inactivo / Bajas</option>
          </select>
        </div>

        {/* Búsqueda rápida */}
        <div>
          <label style={{ display: 'block', fontSize: '.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '.3rem' }}>
            BÚSQUEDA RÁPIDA
          </label>
          <input
            className="input"
            placeholder="Buscar nombre, cédula, cargo..."
            value={textoBusqueda}
            onChange={(e) => setTextoBusqueda(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* Rango de fechas para históricos */}
      {ambito !== 'personal' && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '.82rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
            <span className="muted">Desde:</span>
            <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label style={{ fontSize: '.82rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
            <span className="muted">Hasta:</span>
            <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          {(desde || hasta) && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setDesde(''); setHasta(''); }}>
              Limpiar fechas
            </button>
          )}
        </div>
      )}

      {/* 4. Selector de Columnas (Casillas con checks) */}
      <div style={{ marginBottom: '1.2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--muted)' }}>
            COLUMNAS INCLUIDAS ({columnasSel.length} de {columnasDisponibles.length}):
          </div>
          <div style={{ display: 'flex', gap: '.4rem' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={restaurarColumnasDefault} style={{ fontSize: '.72rem' }}>
              Por Defecto
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={marcarTodasColumnas} style={{ fontSize: '.72rem' }}>
              Marcar Todas
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setColumnasSel([])} style={{ fontSize: '.72rem' }}>
              Limpiar
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.4rem .8rem', flexWrap: 'wrap', maxHeight: '110px', overflowY: 'auto', padding: '.4rem', border: '1px solid var(--border)', borderRadius: '6px' }}>
          {columnasDisponibles.map((col) => {
            const checked = columnasSel.includes(col.clave);
            return (
              <label key={col.clave} style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.78rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={checked} onChange={() => toggleColumna(col.clave)} />
                <span style={{ color: checked ? 'inherit' : 'var(--muted)' }}>{col.etiqueta}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* 5. Tarjetas KPI Ejecutivas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '.6rem', marginBottom: '1.2rem' }}>
        {metricasKpi.map((k) => (
          <div
            key={k.clave}
            style={{
              padding: '.6rem .75rem',
              borderRadius: '6px',
              borderLeft: `4px solid ${k.colorCss}`,
              background: 'var(--card-bg, #1e2229)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: '.7rem', fontWeight: 700, color: k.colorCss, textTransform: 'uppercase' }}>
              {k.etiqueta}
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, margin: '.2rem 0' }}>
              {k.valor}
            </div>
            {k.sub && (
              <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>
                {k.sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 6. Vista Previa en Vivo (Muestra de las 5 primeras filas) */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
          <div style={{ fontSize: '.82rem', fontWeight: 600 }}>
            👁 Vista previa en vivo ({filasProcesadas.length} filas):
          </div>
          <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>
            Mostrando las 5 primeras filas de la selección
          </div>
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
          <table className="table" style={{ margin: 0, fontSize: '.78rem' }}>
            <thead>
              <tr style={{ background: 'rgba(255, 138, 0, 0.1)' }}>
                <th style={{ width: '35px', textAlign: 'center' }}>#</th>
                {columnasDisponibles
                  .filter((c) => columnasSel.includes(c.clave))
                  .map((c) => (
                    <th key={c.clave} style={{ textAlign: c.alineacion }}>
                      {c.etiqueta}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {filasProcesadas.length === 0 ? (
                <tr>
                  <td colSpan={columnasSel.length + 1} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--muted)' }}>
                    No se encontraron colaboradores o registros con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                filasProcesadas.slice(0, 5).map((fila, idx) => (
                  <tr key={fila.id || idx}>
                    <td style={{ textAlign: 'center', color: 'var(--muted)' }}>{idx + 1}</td>
                    {columnasDisponibles
                      .filter((c) => columnasSel.includes(c.clave))
                      .map((c) => (
                        <td key={c.clave} style={{ textAlign: c.alineacion }}>
                          {textoCeldaRrhh(fila, c.clave)}
                        </td>
                      ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

