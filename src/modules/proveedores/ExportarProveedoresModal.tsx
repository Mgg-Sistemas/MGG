/* ============================================================
   Mineral Group Guayana · Proveedores · Diálogo «Descargar datos de proveedores»
   (reporte moldeable, patrón de Tesorería/Combustible · 03/11/2026)

   - Dimensión principal (en pastillas): Detallado, por Categoría, por Origen,
     por Estado o por Actividad económica.
   - Ámbito «Incluir histórico de compras»: al activarlo, por cada proveedor se
     traen sus órdenes (getOrdenesByProveedor) y se añaden N° de compras y monto
     comprado, más el KPI «Top proveedores por monto». Apagado = directorio solo
     (rápido, sin tocar Compras).
   - Columnas por casillas (incluida la Actividad económica · CIIU), KPIs/fichas,
     vista previa en vivo y exportación a PDF, Excel, CSV (con blindaje) y un
     aviso puntual por WhatsApp. Las preferencias se guardan en este navegador.
   Salen los proveedores que se están viendo (con los filtros de la pantalla).
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import type { Orden, Proveedor } from '@/shared/lib/types';
import { getOrdenesByProveedor } from './proveedores.repository';
import { listActividades } from './actividadesEconomicas.repository';
import type { ActividadEconomica } from './actividadesEconomicas';
import {
  CAMPOS_REPORTE_PROVEEDOR,
  CAMPOS_POR_DEFECTO_POR_MODO,
  calcularComprasPorProveedor,
  normalizarProveedores,
  procesarFilasReporteProveedor,
  obtenerMetricasFichaProveedor,
  textoColumnaProveedor,
  type ModoAgrupacionProveedor,
  type ResumenCompras,
  type FilaReporteProveedor,
} from './proveedoresMoldeable';
import {
  descargarProveedoresCsv,
  descargarProveedoresExcel,
  descargarProveedoresPdf,
  type OrientacionHoja,
  type DatosMoldeableProveedor,
} from './proveedoresReporte';
import { textoWhatsappProveedores } from './whatsappProveedores';

const CLAVE_CAMPOS = 'proveedores.reporte.campos.v2';
const CLAVE_AGRUPACION = 'proveedores.reporte.agrupacion.v2';
const CLAVE_ORIENTACION = 'proveedores.reporte.orientacion.v2';

const MODOS: { id: ModoAgrupacionProveedor; icon: string; label: string }[] = [
  { id: 'detallado', icon: '📇', label: 'Detallado' },
  { id: 'categoria', icon: '🏷️', label: 'Por Categoría' },
  { id: 'origen', icon: '🌎', label: 'Por Origen' },
  { id: 'estado', icon: '🔖', label: 'Por Estado' },
  { id: 'actividad', icon: '🏭', label: 'Por Actividad' },
];

const ETIQUETA_MODO: Record<ModoAgrupacionProveedor, string> = {
  detallado: 'Detallado',
  categoria: 'Por categoría',
  origen: 'Por origen',
  estado: 'Por estado',
  actividad: 'Por actividad económica',
};

function leerPrefs() {
  let agrupacion: ModoAgrupacionProveedor = 'detallado';
  try { const a = localStorage.getItem(CLAVE_AGRUPACION) as ModoAgrupacionProveedor; if (a && MODOS.some((x) => x.id === a)) agrupacion = a; } catch { /* default */ }
  let campos = CAMPOS_POR_DEFECTO_POR_MODO[agrupacion];
  try { const c = JSON.parse(localStorage.getItem(CLAVE_CAMPOS) ?? 'null'); if (Array.isArray(c) && c.length && c.every((x) => typeof x === 'string')) campos = c; } catch { /* default */ }
  let orientacion: OrientacionHoja = 'auto';
  try { const o = localStorage.getItem(CLAVE_ORIENTACION) as OrientacionHoja; if (o === 'auto' || o === 'vertical' || o === 'horizontal') orientacion = o; } catch { /* default */ }
  return { agrupacion, campos, orientacion };
}

const fmtMonto = (v: number | null | undefined) => `$ ${(Number(v) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  proveedores: Proveedor[];
  /** Cuántos hay en total en el módulo (para indicar si hay filtros activos). */
  total: number;
  filtro?: string;
  onClose: () => void;
}

export function ExportarProveedoresModal({ proveedores, total, filtro, onClose }: Props) {
  const prefs = useMemo(() => leerPrefs(), []);

  const [agrupacion, setAgrupacion] = useState<ModoAgrupacionProveedor>(prefs.agrupacion);
  const [marcados, setMarcados] = useState<string[]>(prefs.campos);
  const [orientacion, setOrientacion] = useState<OrientacionHoja>(prefs.orientacion);
  const [formatoPresentacion, setFormatoPresentacion] = useState<'fichas' | 'tabla'>('fichas');
  const [verWhatsapp, setVerWhatsapp] = useState(false);
  const [ocupado, setOcupado] = useState<'pdf' | 'xlsx' | 'csv' | null>(null);

  // Catálogo de actividades económicas (para la columna «Actividad económica»).
  const [actividades, setActividades] = useState<ActividadEconomica[]>([]);
  useEffect(() => { listActividades().then(setActividades).catch(() => undefined); }, []);

  // Ámbito «histórico de compras»: apagado por defecto (más liviano).
  const [incluirCompras, setIncluirCompras] = useState(false);
  const [cargandoCompras, setCargandoCompras] = useState(false);
  const [comprasMap, setComprasMap] = useState<Map<string, ResumenCompras> | null>(null);

  // Al activar el histórico, se traen las órdenes de cada proveedor visible.
  useEffect(() => {
    if (!incluirCompras) { setComprasMap(null); return; }
    let cancelado = false;
    setCargandoCompras(true);
    (async () => {
      try {
        const porProv = new Map<string, Orden[]>();
        // En tandas para no abrir cientos de peticiones a la vez.
        const LOTE = 8;
        for (let i = 0; i < proveedores.length; i += LOTE) {
          if (cancelado) return;
          const tanda = proveedores.slice(i, i + LOTE);
          const res = await Promise.all(tanda.map((p) => getOrdenesByProveedor(p.id).catch(() => [] as Orden[])));
          tanda.forEach((p, j) => porProv.set(p.id, res[j]));
        }
        if (!cancelado) setComprasMap(calcularComprasPorProveedor(porProv));
      } catch {
        if (!cancelado) { toast('No se pudo cargar el histórico de compras.', 'error'); setIncluirCompras(false); }
      } finally {
        if (!cancelado) setCargandoCompras(false);
      }
    })();
    return () => { cancelado = true; };
  }, [incluirCompras, proveedores]);

  const conCompras = incluirCompras && !!comprasMap;

  // Normalización → agrupación → KPIs (todo con el motor puro).
  const filasDetalle = useMemo(
    () => normalizarProveedores(proveedores, { listaActividades: actividades, comprasPorProveedor: comprasMap ?? undefined }),
    [proveedores, actividades, comprasMap],
  );
  const { filas, resumen } = useMemo(
    () => procesarFilasReporteProveedor(filasDetalle, agrupacion, { ordenarPor: conCompras && agrupacion === 'detallado' ? 'monto' : undefined }),
    [filasDetalle, agrupacion, conCompras],
  );

  // Columnas disponibles: se ocultan las de compras si el ámbito está apagado.
  const columnasDisponibles = useMemo(
    () => CAMPOS_REPORTE_PROVEEDOR.filter((c) => (c.soloCompras ? conCompras : true)),
    [conCompras],
  );
  // Columnas visibles (en orden del catálogo), descartando las no disponibles.
  const columnasVisibles = useMemo(() => {
    const set = new Set(marcados);
    return columnasDisponibles.filter((c) => set.has(c.clave));
  }, [marcados, columnasDisponibles]);

  const cambiarAgrupacion = (modo: ModoAgrupacionProveedor) => { setAgrupacion(modo); setMarcados(CAMPOS_POR_DEFECTO_POR_MODO[modo]); };
  const alternarColumna = (clave: string) => setMarcados((prev) => (prev.includes(clave) ? prev.filter((c) => c !== clave) : [...prev, clave]));

  const datosMoldeable = (): DatosMoldeableProveedor => ({
    filas,
    columnas: columnasVisibles,
    resumen,
    agrupacionEtiqueta: agrupacion === 'detallado' ? undefined : ETIQUETA_MODO[agrupacion],
  });

  const guardarPrefs = () => {
    try {
      localStorage.setItem(CLAVE_CAMPOS, JSON.stringify(marcados));
      localStorage.setItem(CLAVE_AGRUPACION, agrupacion);
      localStorage.setItem(CLAVE_ORIENTACION, orientacion);
    } catch { /* no es crítico */ }
  };

  async function descargar(formato: 'pdf' | 'xlsx' | 'csv') {
    if (!columnasVisibles.length) { toast('Marca al menos una columna.', 'warning'); return; }
    if (!filas.length) { toast('No hay proveedores con los filtros aplicados.', 'warning'); return; }
    setOcupado(formato);
    try {
      guardarPrefs();
      const datos = datosMoldeable();
      const op = { filtro, orientacion, formatoPresentacion, moldeable: datos };
      if (formato === 'csv') descargarProveedoresCsv(datos.filas, datos.columnas, { filtro });
      else if (formato === 'xlsx') await descargarProveedoresExcel(proveedores, op);
      else await descargarProveedoresPdf(proveedores, op);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el archivo', 'error');
    } finally {
      setOcupado(null);
    }
  }

  const textoWsp = useMemo(
    () => textoWhatsappProveedores(filas, { agrupacion, filtro, conCompras }),
    [filas, agrupacion, filtro, conCompras],
  );

  const surf2 = { background: 'var(--surface-2, #182230)', border: '1px solid var(--border)', borderRadius: '8px', padding: '.65rem .8rem' } as const;
  const tituloSec = { fontSize: '.84rem', fontWeight: 600, color: 'var(--text, #f1f5f9)' } as const;

  const sinColumnas = columnasVisibles.length === 0;

  return (
    <Modal
      title="⬇ Descargar datos de proveedores"
      size="lg"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '.5rem', flexWrap: 'wrap' }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>{cargandoCompras ? 'Cargando compras…' : `${filas.length} fila(s) a exportar`}</div>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={!!ocupado}>Cerrar</button>
            <button className="btn btn-ghost" onClick={() => void descargar('csv')} disabled={!!ocupado || sinColumnas || !filas.length}>{ocupado === 'csv' ? 'Generando…' : '📝 CSV'}</button>
            <button className="btn btn-ghost" onClick={() => void descargar('xlsx')} disabled={!!ocupado || sinColumnas || !filas.length}>{ocupado === 'xlsx' ? 'Generando…' : '📊 Excel'}</button>
            <button className="btn btn-ghost" onClick={() => setVerWhatsapp(true)} disabled={!!ocupado || !filas.length}>💬 WhatsApp</button>
            <button className="btn btn-primary" onClick={() => void descargar('pdf')} disabled={!!ocupado || sinColumnas || !filas.length}>{ocupado === 'pdf' ? 'Generando…' : '📄 PDF (imprimir)'}</button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
        <p className="muted" style={{ fontSize: '.84rem', margin: 0 }}>
          Salen <strong>{proveedores.length}</strong> proveedor(es)
          {proveedores.length !== total ? <> de {total}, los que deja ver el filtro aplicado</> : null}.
        </p>

        {/* Panel de WhatsApp */}
        {verWhatsapp && (
          <div style={{ ...surf2, borderColor: 'var(--primary, #25D366)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem', flexWrap: 'wrap', gap: '.4rem' }}>
              <span style={tituloSec}>💬 Enviar por WhatsApp — {ETIQUETA_MODO[agrupacion]}</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setVerWhatsapp(false)}>← Volver al reporte</button>
            </div>
            <p className="muted" style={{ fontSize: '.76rem', marginTop: 0, marginBottom: '.5rem' }}>
              Aviso directo: un proveedor por renglón{conCompras ? ', con su monto comprado' : ''}. Respeta el filtro y la dimensión actual.
            </p>
            <CompartirWhatsapp texto={textoWsp} />
          </div>
        )}

        {/* Dimensión + ámbito de compras */}
        <div style={surf2}>
          <div style={{ ...tituloSec, marginBottom: '.4rem' }}>🎯 Agrupar por</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
            {MODOS.map((m) => (
              <button key={m.id} type="button" className={`btn btn-xs ${agrupacion === m.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => cambiarAgrupacion(m.id)} style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                <span>{m.icon}</span><span>{m.label}</span>
              </button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', fontSize: '.82rem', cursor: cargandoCompras ? 'wait' : 'pointer', marginTop: '.7rem' }}>
            <input type="checkbox" checked={incluirCompras} disabled={cargandoCompras} onChange={(e) => setIncluirCompras(e.target.checked)} />
            <span><strong>Incluir histórico de compras</strong> (N° de órdenes y monto comprado por proveedor)</span>
          </label>
          {incluirCompras && (
            <p className="muted" style={{ fontSize: '.73rem', margin: '.35rem 0 0', fontStyle: 'italic' }}>
              {cargandoCompras ? 'Trayendo las órdenes de cada proveedor…' : 'Cruza con Compras: montos en $ de las órdenes que se concretaron (no cuenta canceladas ni rechazadas). Las cotizadas en Bs se cuentan pero no suman al monto en $.'}
            </p>
          )}
        </div>

        {/* KPIs */}
        <div style={{ background: 'var(--surface-1, #0f172a)', border: '1px solid var(--border)', borderRadius: '8px', padding: '.5rem .8rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '.5rem' }}>
          <div><div className="muted" style={{ fontSize: '.68rem', fontWeight: 600 }}>PROVEEDORES</div><div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f59e0b' }}>{resumen.totalProveedores}</div></div>
          <div><div className="muted" style={{ fontSize: '.68rem', fontWeight: 600 }}>ACTIVOS</div><div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#22c55e' }}>{resumen.activos} <span style={{ fontSize: '.72rem', color: '#94a3b8' }}>({resumen.pctActivos.toFixed(0)}%)</span></div></div>
          <div><div className="muted" style={{ fontSize: '.68rem', fontWeight: 600 }}>NACIONALES</div><div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#38bdf8' }}>{resumen.nacionales} <span style={{ fontSize: '.72rem', color: '#94a3b8' }}>({resumen.pctNacionales.toFixed(0)}%)</span></div></div>
          {conCompras && <div><div className="muted" style={{ fontSize: '.68rem', fontWeight: 600 }}>COMPRADO ($)</div><div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#22c55e' }}>{fmtMonto(resumen.totalMontoUsd)}</div></div>}
          {conCompras && <div><div className="muted" style={{ fontSize: '.68rem', fontWeight: 600 }}>ÓRDENES</div><div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#a855f7' }}>{resumen.totalOrdenes}</div></div>}
        </div>

        {resumen.topCategorias.length > 0 && (
          <div style={{ ...surf2, fontSize: '.78rem' }}>
            <span style={{ ...tituloSec, fontSize: '.8rem' }}>🏷️ Top categorías: </span>
            {resumen.topCategorias.map((c, i) => (
              <span key={c.nombre}>{i > 0 ? ' · ' : ' '}{c.nombre} <span className="muted">({c.valor})</span></span>
            ))}
          </div>
        )}
        {conCompras && resumen.topProveedoresMonto.length > 0 && (
          <div style={{ ...surf2, fontSize: '.78rem' }}>
            <span style={{ ...tituloSec, fontSize: '.8rem' }}>💰 Top proveedores por monto: </span>
            {resumen.topProveedoresMonto.map((p, i) => (
              <span key={p.nombre}>{i > 0 ? ' · ' : ' '}{p.nombre} <span className="muted">({fmtMonto(p.valor)})</span></span>
            ))}
          </div>
        )}

        {/* Columnas */}
        <div style={surf2}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.4rem' }}>
            <span style={tituloSec}>☑️ Columnas a mostrar ({columnasVisibles.length})</span>
            <div style={{ display: 'flex', gap: '.3rem' }}>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMarcados(CAMPOS_POR_DEFECTO_POR_MODO[agrupacion])}>Principales</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMarcados(columnasDisponibles.map((c) => c.clave))}>Todas</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMarcados([])}>Ninguna</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.3rem .6rem' }}>
            {columnasDisponibles.map((col) => {
              const marcado = marcados.includes(col.clave);
              return (
                <label key={col.clave} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.84rem', cursor: 'pointer', color: marcado ? 'var(--text, #f1f5f9)' : 'var(--text-muted, #94a3b8)' }} title={col.descripcion}>
                  <input type="checkbox" checked={marcado} onChange={() => alternarColumna(col.clave)} />
                  <span>{col.etiqueta}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Presentación + orientación */}
        <div style={{ ...surf2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <span style={{ ...tituloSec, fontSize: '.82rem' }}>🎨 Vista:</span>
            <button type="button" className={`btn btn-xs ${formatoPresentacion === 'fichas' ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.25rem .75rem' }} onClick={() => setFormatoPresentacion('fichas')}>🗂️ Fichas</button>
            <button type="button" className={`btn btn-xs ${formatoPresentacion === 'tabla' ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.25rem .75rem' }} onClick={() => setFormatoPresentacion('tabla')}>📊 Tabla</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <span style={{ ...tituloSec, fontSize: '.82rem' }}>📐 Hoja:</span>
            <select className="input" style={{ width: 'auto' }} value={orientacion} onChange={(e) => setOrientacion(e.target.value as OrientacionHoja)}>
              <option value="auto">Automática</option>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
            </select>
          </div>
        </div>

        {/* Vista previa */}
        <div style={surf2}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem', flexWrap: 'wrap', gap: '.4rem' }}>
            <span style={{ ...tituloSec, display: 'flex', alignItems: 'center', gap: '.4rem' }}>👁️ Vista previa
              <span className="badge" style={{ fontSize: '.7rem', background: 'rgba(255,255,255,0.08)', color: '#cbd5e1' }}>{filas.length} {filas.length === 1 ? 'fila' : 'filas'}</span>
            </span>
          </div>
          {sinColumnas ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--warning, #f59e0b)', fontSize: '.82rem' }}>Marca al menos una columna.</div>
          ) : !filas.length ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: '#94a3b8', fontSize: '.82rem' }}>No hay proveedores con los filtros aplicados.</div>
          ) : formatoPresentacion === 'fichas' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '.55rem', maxHeight: '280px', overflowY: 'auto', paddingRight: '.2rem' }}>
              {filas.map((f: FilaReporteProveedor) => {
                const metricas = obtenerMetricasFichaProveedor(f, marcados);
                const titulo = f.razon_social || f.rif || 'Sin nombre';
                const sub = [f.rif && f.rif !== titulo ? f.rif : null, agrupacion === 'detallado' ? f.categorias : null].filter(Boolean).join(' · ');
                return (
                  <div key={f.id} style={{ background: 'var(--surface-1, #0f172a)', border: '1px solid var(--border, #334155)', borderLeft: `4px solid ${f.estado === 'Inactivo' ? '#ef4444' : '#f59e0b'}`, borderRadius: '6px', padding: '.55rem .7rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '.86rem', color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={titulo}>{titulo}</div>
                      {sub && <div className="muted" style={{ fontSize: '.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${metricas.length}, 1fr)`, gap: '.25rem', background: 'rgba(0,0,0,0.2)', padding: '.35rem', borderRadius: '4px' }}>
                      {metricas.map((m) => (
                        <div key={m.clave}>
                          <div className="muted" style={{ fontSize: '.6rem', fontWeight: 600 }}>{m.etiqueta}</div>
                          <div style={{ fontSize: '.8rem', fontWeight: 700, color: m.colorHex, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.valor}>{m.valor}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ maxHeight: '280px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.76rem' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-1, #0f172a)', borderBottom: '1px solid var(--border)' }}>
                    {columnasVisibles.map((c) => (
                      <th key={c.clave} style={{ padding: '.4rem .55rem', textAlign: c.alineacion, color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>{c.etiqueta}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, idx) => (
                    <tr key={f.id || idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: idx % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                      {columnasVisibles.map((c) => (
                        <td key={c.clave} style={{ padding: '.35rem .55rem', textAlign: c.alineacion, whiteSpace: 'nowrap', color: c.clave === 'monto_comprado' ? '#22c55e' : '#f1f5f9' }}>{textoColumnaProveedor(f, c.clave) || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
