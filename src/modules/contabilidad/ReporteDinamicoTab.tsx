/* ============================================================
   Golden Touch · Contabilidad · Pestaña «Reporte Dinámico»
   (18/11/2026)

   Centro de Reportería Contable Integral y Dinámica:
     1. Asientos y Movimientos (auditoría analítica transaccional).
     2. Plan de Cuentas (catálogo estructural jerárquico).
     3. Balances y Saldos (balance de comprobación dinámico).
     4. Períodos y Cierres (auditoría mensual y diferencial cambiario).

   - Bimoneda estricta (VES y USD) con verificación de partida doble.
   - Filtros multicriterio y multidimensionales en vivo.
   - Personalización interactiva de columnas visibles.
   - Exportación nativa a PDF (con membrete oficial) y Excel (XLSX).
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import {
  AMBITOS_REPORTE_CONTABLE,
  calcularRangoPreset,
  generarReporteContableDinamico,
  obtenerCamposPorAmbito,
  obtenerColumnasDefectoPorAmbito,
  type AmbitoReporteContable,
  type ConfiguracionFiltroContable,
  type FuenteReporteContable,
  type ModoAgrupacionContable,
  type PresetPeriodoContable,
} from './logica/reporteContableDinamico';
import {
  exportarReporteContableExcel,
  exportarReporteContablePdf,
} from './exportarReporteContableDinamico';
import { getFuenteReporteDinamico } from './contabilidad.repository';
import type { ContParametros } from './tipos';

const fmtBs = (v: number) => `Bs ${v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtUsd = (v: number) => `$ ${v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (v: number) => v.toLocaleString('es-VE', { maximumFractionDigits: 0 });

export function ReporteDinamicoTab({
  parametros,
  empresaClave = 'GT',
}: {
  parametros: ContParametros;
  empresaClave?: string;
}) {
  const [fuente, setFuente] = useState<FuenteReporteContable | null>(null);
  const [cargando, setCargando] = useState(true);

  // Ámbito principal
  const [ambito, setAmbito] = useState<AmbitoReporteContable>('asientos');

  // Filtros de fecha y presets (para Asientos y Balances)
  const [preset, setPreset] = useState<PresetPeriodoContable>('mes_actual');
  const [desde, setDesde] = useState(() => calcularRangoPreset('mes_actual').desde);
  const [hasta, setHasta] = useState(() => calcularRangoPreset('mes_actual').hasta);

  // Filtros de Asientos
  const [agrupacion, setAgrupacion] = useState<ModoAgrupacionContable>('comprobante');
  const [busqueda, setBusqueda] = useState('');
  const [tipoCompId, setTipoCompId] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  const [centroId, setCentroId] = useState('');
  const [auxiliarId, setAuxiliarId] = useState('');
  const [soloContabilizados, setSoloContabilizados] = useState(true);
  const [monedaVista, setMonedaVista] = useState<'todas' | 'VES' | 'USD'>('todas');

  // Filtros de Cuentas
  const [nivelCuentas, setNivelCuentas] = useState<number | undefined>(undefined);
  const [claseCuenta, setClaseCuenta] = useState('');
  const [naturalezaCuenta, setNaturalezaCuenta] = useState('');
  const [soloCuentasActivas, setSoloCuentasActivas] = useState(false);

  // Filtros de Balances
  const [nivelBalance, setNivelBalance] = useState<number>(3);
  const [incluirSinMovimiento, setIncluirSinMovimiento] = useState(false);

  // Filtros de Períodos
  const [ejercicioId, setEjercicioId] = useState('');
  const [estadoPeriodo, setEstadoPeriodo] = useState('todos');

  // Columnas visibles y modal
  const [columnasVisibles, setColumnasVisibles] = useState<string[]>(() => obtenerColumnasDefectoPorAmbito('asientos'));
  const [modalColumnas, setModalColumnas] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [modalExportarPdf, setModalExportarPdf] = useState(false);

  // Cambiar ámbito y reconfigurar columnas por defecto
  const cambiarAmbito = (nuevo: AmbitoReporteContable) => {
    setAmbito(nuevo);
    setColumnasVisibles(obtenerColumnasDefectoPorAmbito(nuevo));
    setBusqueda('');
  };

  // Cargar datos
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const data = await getFuenteReporteDinamico(empresaClave);
      setFuente(data);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar la información contable.', 'error');
    } finally {
      setCargando(false);
    }
  }, [empresaClave]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Al cambiar preset de fecha
  const cambiarPreset = (p: PresetPeriodoContable) => {
    setPreset(p);
    if (p !== 'personalizado') {
      const r = calcularRangoPreset(p);
      setDesde(r.desde);
      setHasta(r.hasta);
    }
  };

  // Configuración del reporte
  const config: ConfiguracionFiltroContable = useMemo(() => ({
    ambito,
    empresaClave,
    empresaNombre: parametros.empresa_nombre ?? undefined,
    desde,
    hasta,
    agrupacion,
    columnasVisibles,
    soloContabilizados,
    tipoComprobanteId: tipoCompId || undefined,
    cuentaId: cuentaId || undefined,
    centroCostoId: centroId || undefined,
    auxiliarId: auxiliarId || undefined,
    busqueda,
    monedaVista,
    nivelCuentas,
    claseCuenta: claseCuenta || undefined,
    naturalezaCuenta: naturalezaCuenta || undefined,
    soloCuentasActivas,
    nivelBalance,
    incluirSinMovimiento,
    ejercicioId: ejercicioId || undefined,
    estadoPeriodo: estadoPeriodo !== 'todos' ? estadoPeriodo : undefined,
  }), [
    ambito, empresaClave, parametros.empresa_nombre, desde, hasta, agrupacion,
    columnasVisibles, soloContabilizados, tipoCompId, cuentaId, centroId,
    auxiliarId, busqueda, monedaVista, nivelCuentas, claseCuenta,
    naturalezaCuenta, soloCuentasActivas, nivelBalance, incluirSinMovimiento,
    ejercicioId, estadoPeriodo,
  ]);

  // Ejecución síncrona del motor de datos
  const reporte = useMemo(() => {
    if (!fuente) return null;
    return generarReporteContableDinamico(fuente, config);
  }, [fuente, config]);

  // Opciones de selector de cuentas
  const opcionesCuentas = useMemo(() => {
    if (!fuente) return [];
    return fuente.cuentas
      .filter((c) => c.activa)
      .map((c) => ({ value: c.id, label: `${c.codigo} · ${c.nombre}` }));
  }, [fuente]);

  // Acciones de exportación
  const ejecutarExportacionPdf = async (formato: 'resumen' | 'detallado' | 'hibrido') => {
    if (!reporte) return;
    setExportando(true);
    setModalExportarPdf(false);
    try {
      await exportarReporteContablePdf(reporte, formato);
      toast('Vista previa del PDF generada.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al exportar PDF.', 'error');
    } finally {
      setExportando(false);
    }
  };

  const ejecutarExportacionExcel = async () => {
    if (!reporte) return;
    setExportando(true);
    try {
      await exportarReporteContableExcel(reporte, 'hibrido');
      toast('Vista previa del Excel generada.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al exportar Excel.', 'error');
    } finally {
      setExportando(false);
    }
  };

  if (cargando) return <p className="muted">Cargando el centro de reportes contables…</p>;
  if (!fuente || !reporte) return <EmptyState icon="📊" message="No se pudo inicializar la fuente de datos." />;

  const r = reporte.resumen;
  const camposDisponibles = obtenerCamposPorAmbito(ambito);
  const cols = camposDisponibles.filter((c) => columnasVisibles.includes(c.clave));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* 1. Selector de Ámbito Principal */}
      <div className="card" style={{ padding: '.85rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.8rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <span>📊</span> Centro de Reportes Contables Dinámicos
            </h2>
            <p className="muted hint" style={{ margin: '.2rem 0 0', fontSize: '.82rem' }}>
              Consolidación multidimensional bimoneda a la medida para <strong>{parametros.empresa_nombre}</strong>.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setModalColumnas(true)}
              title="Personalizar columnas visibles en pantalla y exportación"
            >
              ⚙ Columnas ({columnasVisibles.length})
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setModalExportarPdf(true)}
              disabled={exportando}
              title="Exportar a documento PDF oficial"
            >
              📄 Exportar PDF
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void ejecutarExportacionExcel()}
              disabled={exportando}
              title="Exportar a hoja de cálculo Excel nativa"
            >
              📗 Exportar Excel
            </button>
          </div>
        </div>

        {/* Cinta de Ámbitos */}
        <div className="view-toggle cont-menus" role="tablist" style={{ marginTop: '.85rem' }}>
          {AMBITOS_REPORTE_CONTABLE.map((a) => (
            <button
              key={a.id}
              role="tab"
              aria-selected={ambito === a.id}
              className={ambito === a.id ? 'active' : ''}
              onClick={() => cambiarAmbito(a.id)}
              style={{ fontWeight: 600 }}
            >
              <span style={{ marginRight: '.35rem' }}>{a.icon}</span> {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Tarjetas de Resumen y KPIs Dinámicos */}
      <div className="kpis-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {ambito === 'cuentas' ? (
          <>
            <div className="kpi">
              <div className="label">Total Cuentas</div>
              <div className="value">{fmtNum(r.totalCuentas ?? 0)}</div>
              <div className="hint">Estructura del Plan</div>
            </div>
            <div className="kpi">
              <div className="label">Cuentas Activas</div>
              <div className="value" style={{ color: '#10b981' }}>{fmtNum(r.cuentasActivas ?? 0)}</div>
              <div className="hint">Disponibles para Asientos</div>
            </div>
            <div className="kpi">
              <div className="label">Cuentas Inactivas</div>
              <div className="value" style={{ color: '#94a3b8' }}>{fmtNum(r.cuentasInactivas ?? 0)}</div>
              <div className="hint">Históricas / Bloqueadas</div>
            </div>
            <div className="kpi">
              <div className="label">De Movimiento</div>
              <div className="value" style={{ color: '#38bdf8' }}>{fmtNum(r.cuentasMovimiento ?? 0)}</div>
              <div className="hint">Imputables directamente</div>
            </div>
            <div className="kpi">
              <div className="label">Profundidad</div>
              <div className="value">{r.maxNivel ?? 1} Niveles</div>
              <div className="hint">Máscara {parametros.mascara_codigo}</div>
            </div>
          </>
        ) : ambito === 'balances' ? (
          <>
            <div className="kpi">
              <div className="label">Saldo Inicial Total</div>
              <div className="value" style={{ fontSize: '1.05rem' }}>{fmtBs(r.totalSaldoInicialVes ?? 0)}</div>
              <div className="hint" style={{ fontSize: '.75rem' }}>{fmtUsd(r.totalSaldoInicialUsd ?? 0)}</div>
            </div>
            <div className="kpi">
              <div className="label">Total Mov. Debe</div>
              <div className="value" style={{ fontSize: '1.05rem', color: '#10b981' }}>{fmtBs(r.totalDebeVes)}</div>
              <div className="hint" style={{ fontSize: '.75rem' }}>{fmtUsd(r.totalDebeUsd)}</div>
            </div>
            <div className="kpi">
              <div className="label">Total Mov. Haber</div>
              <div className="value" style={{ fontSize: '1.05rem', color: '#38bdf8' }}>{fmtBs(r.totalHaberVes)}</div>
              <div className="hint" style={{ fontSize: '.75rem' }}>{fmtUsd(r.totalHaberUsd)}</div>
            </div>
            <div className="kpi">
              <div className="label">Saldo Final Neto</div>
              <div className="value" style={{ fontSize: '1.05rem' }}>{fmtBs(r.totalSaldoFinalVes ?? 0)}</div>
              <div className="hint" style={{ fontSize: '.75rem' }}>{fmtUsd(r.totalSaldoFinalUsd ?? 0)}</div>
            </div>
            <div className="kpi">
              <div className="label">Partida Doble</div>
              <div className="value">
                {r.cuadra ? (
                  <span className="badge" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', fontWeight: 700 }}>
                    ✓ Cuadrado
                  </span>
                ) : (
                  <span className="badge" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 700 }}>
                    ⚠ Dif: {fmtBs(r.diferenciaVes)}
                  </span>
                )}
              </div>
              <div className="hint" style={{ fontSize: '.72rem' }}>Verificación en Bs y $</div>
            </div>
          </>
        ) : ambito === 'periodos' ? (
          <>
            <div className="kpi">
              <div className="label">Meses del Ejercicio</div>
              <div className="value">{reporte.filas.length}</div>
              <div className="hint">12 Meses + Cierre</div>
            </div>
            <div className="kpi">
              <div className="label">Meses Abiertos</div>
              <div className="value" style={{ color: '#10b981' }}>{r.mesesAbiertos ?? 0}</div>
              <div className="hint">Admiten Comprobantes</div>
            </div>
            <div className="kpi">
              <div className="label">Meses Cerrados</div>
              <div className="value" style={{ color: '#94a3b8' }}>{r.mesesCerrados ?? 0}</div>
              <div className="hint">Bloqueados con foto</div>
            </div>
            <div className="kpi">
              <div className="label">Diferencial AJ Acum.</div>
              <div className="value" style={{ fontSize: '1.05rem' }}>{fmtBs(r.totalDiferencialAjVes ?? 0)}</div>
              <div className="hint" style={{ fontSize: '.75rem' }}>{fmtUsd(r.totalDiferencialAjUsd ?? 0)}</div>
            </div>
            <div className="kpi">
              <div className="label">Comprobantes Totales</div>
              <div className="value" style={{ color: '#ff8a00' }}>{fmtNum(r.totalComprobantes)}</div>
              <div className="hint">En todos los períodos</div>
            </div>
          </>
        ) : (
          <>
            <div className="kpi">
              <div className="label">Comprobantes</div>
              <div className="value">{r.totalComprobantes}</div>
              <div className="hint">{r.totalAsientos} asientos contables</div>
            </div>
            <div className="kpi">
              <div className="label">Total Cargos (Debe)</div>
              <div className="value" style={{ fontSize: '1.05rem', color: '#10b981' }}>{fmtBs(r.totalDebeVes)}</div>
              <div className="hint" style={{ fontSize: '.75rem' }}>{fmtUsd(r.totalDebeUsd)}</div>
            </div>
            <div className="kpi">
              <div className="label">Total Abonos (Haber)</div>
              <div className="value" style={{ fontSize: '1.05rem', color: '#38bdf8' }}>{fmtBs(r.totalHaberVes)}</div>
              <div className="hint" style={{ fontSize: '.75rem' }}>{fmtUsd(r.totalHaberUsd)}</div>
            </div>
            <div className="kpi">
              <div className="label">Estado de Cuadre</div>
              <div className="value">
                {r.cuadra ? (
                  <span className="badge" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', fontWeight: 700 }}>
                    ✓ Cuadrado
                  </span>
                ) : (
                  <span className="badge" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 700 }}>
                    ⚠ Descuadre {fmtBs(r.diferenciaVes)}
                  </span>
                )}
              </div>
              <div className="hint" style={{ fontSize: '.72rem' }}>Partida doble verificada</div>
            </div>
          </>
        )}
      </div>

      {/* 3. Panel de Filtros Adaptable según Ámbito */}
      <div className="card" style={{ padding: '.75rem 1rem' }}>
        {ambito === 'cuentas' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.6rem', alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
              <span className="muted hint">Nivel de Profundidad</span>
              <select className="select select-sm" value={nivelCuentas ?? ''} onChange={(e) => setNivelCuentas(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">Todos los niveles (1..{parametros.niveles})</option>
                {Array.from({ length: parametros.niveles }, (_, i) => (
                  <option key={i + 1} value={i + 1}>Hasta Nivel {i + 1}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
              <span className="muted hint">Clase Contable</span>
              <select className="select select-sm" value={claseCuenta} onChange={(e) => setClaseCuenta(e.target.value)}>
                <option value="">Todas las clases</option>
                <option value="activo">Activo</option>
                <option value="pasivo">Pasivo</option>
                <option value="patrimonio">Patrimonio</option>
                <option value="ingresos">Ingresos</option>
                <option value="costos">Costos</option>
                <option value="gastos">Gastos</option>
                <option value="orden">Cuentas de Orden</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
              <span className="muted hint">Naturaleza</span>
              <select className="select select-sm" value={naturalezaCuenta} onChange={(e) => setNaturalezaCuenta(e.target.value)}>
                <option value="">Todas las naturalezas</option>
                <option value="deudora">Deudora (Debe)</option>
                <option value="acreedora">Acreedora (Haber)</option>
              </select>
            </label>

            <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
              <input
                type="search"
                className="input input-sm"
                placeholder="🔍 Buscar por código o nombre…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                style={{ flex: 1 }}
              />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.78rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={soloCuentasActivas} onChange={(e) => setSoloCuentasActivas(e.target.checked)} />
                Solo Activas
              </label>
            </div>
          </div>
        ) : ambito === 'balances' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.6rem', alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
              <span className="muted hint">Período</span>
              <select className="select select-sm" value={preset} onChange={(e) => cambiarPreset(e.target.value as PresetPeriodoContable)}>
                <option value="mes_actual">Mes Actual</option>
                <option value="mes_anterior">Mes Anterior</option>
                <option value="este_ano">Año Actual</option>
                <option value="ejercicio">Ejercicio Fiscal</option>
                <option value="todos">Todo el Historial</option>
                <option value="personalizado">Personalizado…</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
              <span className="muted hint">Desde</span>
              <input className="input input-sm" type="date" value={desde} onChange={(e) => { setDesde(e.target.value); setPreset('personalizado'); }} />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
              <span className="muted hint">Hasta</span>
              <input className="input input-sm" type="date" value={hasta} onChange={(e) => { setHasta(e.target.value); setPreset('personalizado'); }} />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
              <span className="muted hint">Nivel de Detalle</span>
              <select className="select select-sm" value={nivelBalance} onChange={(e) => setNivelBalance(Number(e.target.value))}>
                {Array.from({ length: parametros.niveles }, (_, i) => (
                  <option key={i + 1} value={i + 1}>Nivel {i + 1}</option>
                ))}
              </select>
            </label>

            <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
              <input
                type="search"
                className="input input-sm"
                placeholder="🔍 Filtrar cuenta…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                style={{ flex: 1 }}
              />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.78rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={incluirSinMovimiento} onChange={(e) => setIncluirSinMovimiento(e.target.checked)} />
                Sin Movimiento
              </label>
            </div>
          </div>
        ) : ambito === 'periodos' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.6rem', alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
              <span className="muted hint">Ejercicio Fiscal</span>
              <select className="select select-sm" value={ejercicioId} onChange={(e) => setEjercicioId(e.target.value)}>
                <option value="">Todos los ejercicios</option>
                {(fuente.ejercicios ?? []).map((ej) => (
                  <option key={ej.id} value={ej.id}>
                    {ej.fecha_inicio.slice(0, 4)} ({ej.estado.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
              <span className="muted hint">Estado del Período</span>
              <select className="select select-sm" value={estadoPeriodo} onChange={(e) => setEstadoPeriodo(e.target.value)}>
                <option value="todos">Todos los estados</option>
                <option value="abierto">Abiertos</option>
                <option value="cerrado">Cerrados</option>
              </select>
            </label>

            <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
              <input
                type="search"
                className="input input-sm"
                placeholder="🔍 Buscar mes o año…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          </div>
        ) : (
          /* Filtros de Asientos y Movimientos */
          <>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.6rem' }}>
              <span className="muted hint" style={{ fontSize: '.78rem', fontWeight: 600 }}>Agrupar por:</span>
              <div className="view-toggle" role="tablist">
                <button role="tab" aria-selected={agrupacion === 'comprobante'} className={agrupacion === 'comprobante' ? 'active' : ''} onClick={() => setAgrupacion('comprobante')}>📑 Comprobante</button>
                <button role="tab" aria-selected={agrupacion === 'cuenta'} className={agrupacion === 'cuenta' ? 'active' : ''} onClick={() => setAgrupacion('cuenta')}>📒 Cuenta</button>
                <button role="tab" aria-selected={agrupacion === 'centro'} className={agrupacion === 'centro' ? 'active' : ''} onClick={() => setAgrupacion('centro')}>🏢 Centro</button>
                <button role="tab" aria-selected={agrupacion === 'auxiliar'} className={agrupacion === 'auxiliar' ? 'active' : ''} onClick={() => setAgrupacion('auxiliar')}>👥 Auxiliar</button>
                <button role="tab" aria-selected={agrupacion === 'tipo'} className={agrupacion === 'tipo' ? 'active' : ''} onClick={() => setAgrupacion('tipo')}>🏷️ Tipo</button>
                <button role="tab" aria-selected={agrupacion === 'detallado'} className={agrupacion === 'detallado' ? 'active' : ''} onClick={() => setAgrupacion('detallado')}>📋 Detallado</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.6rem', alignItems: 'end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
                <span className="muted hint">Período</span>
                <select className="select select-sm" value={preset} onChange={(e) => cambiarPreset(e.target.value as PresetPeriodoContable)}>
                  <option value="mes_actual">Mes Actual</option>
                  <option value="mes_anterior">Mes Anterior</option>
                  <option value="este_ano">Año Actual</option>
                  <option value="ejercicio">Ejercicio Fiscal</option>
                  <option value="todos">Todo el Historial</option>
                  <option value="personalizado">Personalizado…</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
                <span className="muted hint">Desde</span>
                <input className="input input-sm" type="date" value={desde} onChange={(e) => { setDesde(e.target.value); setPreset('personalizado'); }} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
                <span className="muted hint">Hasta</span>
                <input className="input input-sm" type="date" value={hasta} onChange={(e) => { setHasta(e.target.value); setPreset('personalizado'); }} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
                <span className="muted hint">Tipo Comprobante</span>
                <select className="select select-sm" value={tipoCompId} onChange={(e) => setTipoCompId(e.target.value)}>
                  <option value="">Todos los tipos</option>
                  {(fuente.tipos ?? []).map((t) => (
                    <option key={t.id} value={t.id}>{t.codigo} · {t.nombre}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
                <span className="muted hint">Centro de Costo</span>
                <select className="select select-sm" value={centroId} onChange={(e) => setCentroId(e.target.value)}>
                  <option value="">Todos los centros</option>
                  {(fuente.centros ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
                <span className="muted hint">Tercero / Auxiliar</span>
                <select className="select select-sm" value={auxiliarId} onChange={(e) => setAuxiliarId(e.target.value)}>
                  <option value="">Todos los auxiliares</option>
                  {(fuente.auxiliares ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.codigo} · {a.nombre}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', fontSize: '.78rem' }}>
                <span className="muted hint">Moneda</span>
                <select className="select select-sm" value={monedaVista} onChange={(e) => setMonedaVista(e.target.value as 'todas' | 'VES' | 'USD')}>
                  <option value="todas">Bimoneda (Todas)</option>
                  <option value="VES">Bolívares (VES)</option>
                  <option value="USD">Dólares (USD)</option>
                </select>
              </label>
            </div>

            {/* Segunda línea de filtros: Cuenta y Búsqueda */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '.6rem', marginTop: '.6rem', alignItems: 'center' }}>
              <div>
                <span className="muted hint" style={{ fontSize: '.78rem', display: 'block', marginBottom: '.2rem' }}>Filtrar por Cuenta Contable</span>
                <SearchSelect
                  options={[{ value: '', label: 'Todas las cuentas contables…' }, ...opcionesCuentas]}
                  value={cuentaId}
                  onChange={setCuentaId}
                  placeholder="Todas las cuentas…"
                />
              </div>

              <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
                <input
                  type="search"
                  className="input input-sm"
                  placeholder="🔍 Buscar comprobante, cuenta, concepto…"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  style={{ flex: 1 }}
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.78rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={soloContabilizados} onChange={(e) => setSoloContabilizados(e.target.checked)} />
                  Solo Contabilizados
                </label>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 4. Tabla de Datos Dinámica */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {reporte.filas.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <EmptyState icon="🔎" message="No se encontraron registros contables para los filtros seleccionados." />
          </div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 600, overflowY: 'auto' }}>
            <table className="table cont-tabla-informe">
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 1 }}>
                <tr>
                  {cols.map((col) => (
                    <th key={col.clave} className={col.alineacion === 'right' ? 'num' : ''} style={{ textAlign: col.alineacion }}>
                      {col.etiqueta}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reporte.grupos.map((g) => (
                  <tr key={`group-${g.clave}`} style={{ display: 'contents' }}>
                    {agrupacion !== 'detallado' && ambito === 'asientos' && (
                      <tr className="titulo" style={{ background: 'rgba(255,138,0,0.08)' }}>
                        <td colSpan={cols.length} style={{ fontWeight: 700, color: 'var(--brand, #ff8a00)' }}>
                          ▶ {g.etiqueta}
                          {g.subetiqueta && <span className="muted hint" style={{ marginLeft: '.5rem', fontWeight: 400 }}>({g.subetiqueta})</span>}
                          <span style={{ float: 'right', fontWeight: 600, fontSize: '.76rem', color: 'var(--text)' }}>
                            {g.totalAsientos} asientos | Debe: {fmtBs(g.debe_ves)} | Haber: {fmtBs(g.haber_ves)}
                          </span>
                        </td>
                      </tr>
                    )}

                    {g.filas.map((f) => (
                      <tr key={f.id}>
                        {cols.map((col) => {
                          let celda: React.ReactNode = '—';
                          switch (col.clave) {
                            case 'fecha': celda = f.fecha; break;
                            case 'comprobante': celda = <span className="mono" style={{ fontWeight: 600 }}>{f.comprobante}</span>; break;
                            case 'tipo': celda = f.tipo; break;
                            case 'origen': celda = f.origen; break;
                            case 'referencia': celda = f.referencia; break;
                            case 'descripcion': celda = f.descripcion; break;
                            case 'cuenta_codigo': celda = <span className="mono">{f.cuenta_codigo}</span>; break;
                            case 'cuenta_nombre': celda = f.cuenta_nombre; break;
                            case 'centro': celda = f.centro; break;
                            case 'auxiliar': celda = f.auxiliar; break;
                            case 'moneda': celda = f.moneda; break;
                            case 'debe_ves': celda = f.debe_ves > 0 ? fmtBs(f.debe_ves) : '—'; break;
                            case 'haber_ves': celda = f.haber_ves > 0 ? fmtBs(f.haber_ves) : '—'; break;
                            case 'debe_usd': celda = f.debe_usd > 0 ? fmtUsd(f.debe_usd) : '—'; break;
                            case 'haber_usd': celda = f.haber_usd > 0 ? fmtUsd(f.haber_usd) : '—'; break;
                            case 'saldo_ves': celda = fmtBs(f.saldo_ves); break;
                            case 'saldo_usd': celda = fmtUsd(f.saldo_usd); break;

                            // Cuentas:
                            case 'nivel': celda = <span className="badge">{f.nivel}</span>; break;
                            case 'clase': celda = f.clase; break;
                            case 'naturaleza': celda = f.naturaleza; break;
                            case 'es_monetaria': celda = f.es_monetaria; break;
                            case 'exige_centro': celda = f.exige_centro; break;
                            case 'exige_auxiliar': celda = f.exige_auxiliar; break;
                            case 'tipo_auxiliar': celda = f.tipo_auxiliar; break;
                            case 'activa': celda = (
                              <span className="badge" style={{ background: f.activa === 'Activa' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: f.activa === 'Activa' ? '#10b981' : '#ef4444' }}>
                                {f.activa}
                              </span>
                            ); break;
                            case 'padre_codigo': celda = <span className="mono">{f.padre_codigo}</span>; break;

                            // Balances:
                            case 'saldo_inicial_ves': celda = fmtBs(f.saldo_inicial_ves ?? 0); break;
                            case 'saldo_final_ves': celda = fmtBs(f.saldo_final_ves ?? 0); break;
                            case 'saldo_inicial_usd': celda = fmtUsd(f.saldo_inicial_usd ?? 0); break;
                            case 'saldo_final_usd': celda = fmtUsd(f.saldo_final_usd ?? 0); break;

                            // Períodos:
                            case 'ejercicio': celda = f.ejercicio; break;
                            case 'periodo_numero': celda = f.periodo_numero; break;
                            case 'periodo_nombre': celda = <strong>{f.periodo_nombre}</strong>; break;
                            case 'periodo_estado': celda = (
                              <span className="badge" style={{ background: f.periodo_estado === 'Abierto' ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.15)', color: f.periodo_estado === 'Abierto' ? '#10b981' : '#94a3b8' }}>
                                {f.periodo_estado}
                              </span>
                            ); break;
                            case 'fecha_inicio': celda = f.fecha_inicio; break;
                            case 'fecha_fin': celda = f.fecha_fin; break;
                            case 'fecha_cierre': celda = f.fecha_cierre; break;
                            case 'cerrado_por': celda = f.cerrado_por; break;
                            case 'diferencial_aj_ves': celda = fmtBs(f.diferencial_aj_ves ?? 0); break;
                            case 'diferencial_aj_usd': celda = fmtUsd(f.diferencial_aj_usd ?? 0); break;
                            case 'comprobantes_count': celda = f.comprobantes_count; break;
                          }
                          return (
                            <td key={col.clave} className={col.alineacion === 'right' ? 'num' : ''} style={{ textAlign: col.alineacion }}>
                              {celda}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tr>
                ))}
              </tbody>
              {(ambito === 'asientos' || ambito === 'balances') && (
                <tfoot style={{ position: 'sticky', bottom: 0, background: 'var(--surface-2)', fontWeight: 700 }}>
                  <tr>
                    {cols.map((col, idx) => {
                      if (idx === 0) return <td key={col.clave}>TOTALES:</td>;
                      if (col.clave === 'debe_ves') return <td key={col.clave} className="num">{fmtBs(r.totalDebeVes)}</td>;
                      if (col.clave === 'haber_ves') return <td key={col.clave} className="num">{fmtBs(r.totalHaberVes)}</td>;
                      if (col.clave === 'debe_usd') return <td key={col.clave} className="num">{fmtUsd(r.totalDebeUsd)}</td>;
                      if (col.clave === 'haber_usd') return <td key={col.clave} className="num">{fmtUsd(r.totalHaberUsd)}</td>;
                      if (col.clave === 'saldo_final_ves') return <td key={col.clave} className="num">{fmtBs(r.totalSaldoFinalVes ?? 0)}</td>;
                      if (col.clave === 'saldo_final_usd') return <td key={col.clave} className="num">{fmtUsd(r.totalSaldoFinalUsd ?? 0)}</td>;
                      return <td key={col.clave} />;
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Modal: Configuración de Columnas Visibles */}
      {modalColumnas && (
        <Modal
          title={`⚙ Configurar Columnas · ${AMBITOS_REPORTE_CONTABLE.find((a) => a.id === ambito)?.label ?? ''}`}
          size="md"
          onClose={() => setModalColumnas(false)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setColumnasVisibles(obtenerColumnasDefectoPorAmbito(ambito))}
              >
                Restablecer por Defecto
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setModalColumnas(false)}>
                Listo ({columnasVisibles.length} visibles)
              </button>
            </div>
          }
        >
          <p className="muted hint" style={{ fontSize: '.82rem', margin: '0 0 .75rem' }}>
            Selecciona las columnas que deseas mostrar en pantalla y en los documentos exportados en PDF y Excel:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.5rem', maxHeight: 380, overflowY: 'auto' }}>
            {camposDisponibles.map((c) => {
              const checked = columnasVisibles.includes(c.clave);
              return (
                <label
                  key={c.clave}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '.4rem',
                    fontSize: '.82rem',
                    padding: '.35rem .5rem',
                    borderRadius: 4,
                    background: checked ? 'rgba(255,138,0,0.08)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      if (e.target.checked) setColumnasVisibles([...columnasVisibles, c.clave]);
                      else setColumnasVisibles(columnasVisibles.filter((k) => k !== c.clave));
                    }}
                  />
                  <span>{c.etiqueta}</span>
                </label>
              );
            })}
          </div>
        </Modal>
      )}

      {/* Modal: Opciones de Formato para Exportar a PDF */}
      {modalExportarPdf && (
        <Modal
          title="📄 Opciones de Exportación PDF"
          size="md"
          onClose={() => setModalExportarPdf(false)}
        >
          <p className="muted hint" style={{ fontSize: '.82rem', margin: '0 0 1rem' }}>
            Elige el formato de presentación para el documento PDF:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '.7rem .9rem' }}
              onClick={() => void ejecutarExportacionPdf('hibrido')}
            >
              <div>
                <strong>📑 Formato Híbrido (Recomendado)</strong>
                <div className="muted hint" style={{ fontSize: '.74rem' }}>Resumen ejecutivo con KPIs de control seguido del listado detallado.</div>
              </div>
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '.7rem .9rem' }}
              onClick={() => void ejecutarExportacionPdf('resumen')}
            >
              <div>
                <strong>📊 Solo Resumen Ejecutivo</strong>
                <div className="muted hint" style={{ fontSize: '.74rem' }}>Totales de control, verificación de partida doble y analítica consolidada.</div>
              </div>
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '.7rem .9rem' }}
              onClick={() => void ejecutarExportacionPdf('detallado')}
            >
              <div>
                <strong>📋 Solo Listado Detallado</strong>
                <div className="muted hint" style={{ fontSize: '.74rem' }}>Renglones contables completos organizados con la dimensión elegida.</div>
              </div>
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
