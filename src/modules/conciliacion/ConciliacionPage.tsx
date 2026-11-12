/* ============================================================
   MGG · Conciliación (12-11-2026) · SOLO LECTURA

   Tarjetas (clickeables) → detalle → la OC se abre en Compras.
   Tabla: ítem, código OC, proveedor, monto ($ y Bs a la tasa con que
   se pagó), referencia de pago (Tesorería), retención (Retenciones),
   factura (delivery / almacén, con vista previa) y status (Compras).
   Reporte dinámico con vista previa en PDF y mensaje de WhatsApp.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { FacturasOrdenModal } from '@/modules/pedidos/FacturasOrdenModal';
import type { Orden } from '@/shared/lib/types';
import { cargarConciliacion, type DatosConciliacion } from './conciliacion.repository';
import {
  COLUMNAS_CONCILIACION, bsTxt, diaCaracas, filtrar, tarjetas, textoReferenciaPago, textoRetencion, textoWhatsappConciliacion, usdTxt,
  type ColumnaConciliacion, type FilaConciliacion, type FiltrosConciliacion, type GrupoEstado,
} from './conciliacion';
import { vistaPreviaConciliacionPdf } from './conciliacionPdf';
import { vistaPreviaConciliacionExcel } from './conciliacionExcel';

type Tarjeta = 'total' | 'pagado' | 'retencion';

const GRUPOS: { value: GrupoEstado | ''; label: string }[] = [
  { value: '', label: 'Todos los status' },
  { value: 'por_aprobar', label: 'Por aprobar' },
  { value: 'esperando_pago', label: 'Esperando pago' },
  { value: 'credito', label: 'Crédito · por pagar' },
  { value: 'pagada', label: 'Pagada' },
  { value: 'recibida', label: 'Recibida' },
  { value: 'finalizada', label: 'Finalizada' },
];

const fechaCorta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-VE', { timeZone: 'America/Caracas' }) : '—');
const TAMANOS_PAGINA = [10, 25, 50, 100];

/** Números de página a mostrar: primera, última y vecinas de la actual (null = «…»). */
function paginasVisibles(actual: number, total: number): Array<number | null> {
  const set = new Set([1, total, actual - 1, actual, actual + 1].filter((n) => n >= 1 && n <= total));
  const nums = [...set].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  nums.forEach((n, i) => { if (i > 0 && n - nums[i - 1] > 1) out.push(null); out.push(n); });
  return out;
}

const fechaDia = (d?: string) => (d ? d.split('-').reverse().join('/') : '…');

/** Rangos rápidos para el reporte (días de Venezuela). */
function rangoRapido(r: 'hoy' | '7d' | 'mes' | 'mes_ant'): { desde: string; hasta: string } {
  const hoy = diaCaracas(new Date());
  const [y, m] = hoy.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (r === 'hoy') return { desde: hoy, hasta: hoy };
  if (r === '7d') { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 6); return { desde: d.toISOString().slice(0, 10), hasta: hoy }; }
  if (r === 'mes') return { desde: `${y}-${pad(m)}-01`, hasta: hoy };
  const ya = m === 1 ? y - 1 : y, ma = m === 1 ? 12 : m - 1;
  const fin = new Date(Date.UTC(ya, ma, 0)).getUTCDate();
  return { desde: `${ya}-${pad(ma)}-01`, hasta: `${ya}-${pad(ma)}-${pad(fin)}` };
}

/** Resumen legible de los filtros activos (para el PDF y el WhatsApp). */
function textoFiltros(f: FiltrosConciliacion): string {
  const p: string[] = [];
  if (f.grupo) p.push(`Status: ${GRUPOS.find((g) => g.value === f.grupo)?.label}`);
  if (f.pago === 'pagadas') p.push('Solo pagadas'); else if (f.pago === 'sin_pagar') p.push('Sin pagar');
  if (f.retencion === 'si') p.push('Con retención'); else if (f.retencion === 'no') p.push('Sin retención');
  if (f.referencia === 'con') p.push('Con referencia'); else if (f.referencia === 'sin') p.push('Sin referencia');
  if (f.desde || f.hasta) p.push(`${f.fechaBase === 'pago' ? 'Pagadas' : 'OC'} del ${fechaDia(f.desde)} al ${fechaDia(f.hasta)}`);
  if (f.texto?.trim()) p.push(`Búsqueda: «${f.texto.trim()}»`);
  return p.join(' · ');
}

export function ConciliacionPage() {
  const navigate = useNavigate();
  const [datos, setDatos] = useState<DatosConciliacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<FiltrosConciliacion>({});
  const [tarjeta, setTarjeta] = useState<Tarjeta | null>(null);
  const [verFacturas, setVerFacturas] = useState<Orden | null>(null);
  const [reporte, setReporte] = useState(false);
  const [porPagina, setPorPagina] = useState(10);
  const [pagina, setPagina] = useState(1);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try { setDatos(await cargarConciliacion()); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la conciliación.'); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const filas = useMemo(() => filtrar(datos?.filas ?? [], filtros), [datos, filtros]);
  const t = useMemo(() => tarjetas(filas), [filas]);
  // El reporte trae su propio rango de fechas: parte de los demás filtros de la pantalla.
  const baseReporte = useMemo(() => filtrar(datos?.filas ?? [], { ...filtros, desde: '', hasta: '' }), [datos, filtros]);
  useEffect(() => { setPagina(1); }, [filtros, porPagina]);
  const totalPaginas = Math.max(1, Math.ceil(filas.length / porPagina));
  const paginaActual = Math.min(pagina, totalPaginas);
  const desde = (paginaActual - 1) * porPagina;
  const filasPagina = filas.slice(desde, desde + porPagina);

  const setF = (patch: Partial<FiltrosConciliacion>) => setFiltros((f) => ({ ...f, ...patch }));
  const hayFiltros = Object.values(filtros).some((v) => !!v);
  const abrirOc = (id: string) => navigate(`/app/pedidos?detalle=${encodeURIComponent(id)}`);

  const detalle: FilaConciliacion[] = useMemo(() => {
    if (!tarjeta) return [];
    const ids = new Set(tarjeta === 'total' ? t.totalOc.ids : tarjeta === 'pagado' ? t.pagado.ids : t.conRetencion.ids);
    return filas.filter((f) => ids.has(f.id));
  }, [tarjeta, t, filas]);

  const card = (k: Tarjeta, icono: string, titulo: string, valor: string, sub: string, color: string) => (
    <button type="button" onClick={() => setTarjeta(tarjeta === k ? null : k)} className="card"
      style={{ textAlign: 'left', cursor: 'pointer', margin: 0, padding: '.85rem 1rem', borderTop: `3px solid ${color}`, outline: tarjeta === k ? `2px solid ${color}` : 'none', font: 'inherit', color: 'inherit' }}
      title="Ver el detalle">
      <div className="muted" style={{ fontSize: '.72rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>{icono} {titulo}</div>
      <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '.25rem' }}>{valor}</div>
      <div className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>{sub}</div>
      <div style={{ fontSize: '.72rem', marginTop: '.4rem', color }}>{tarjeta === k ? '▾ ocultar detalle' : '▸ ver detalle'}</div>
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>🧮 Conciliación</h1>
          <p className="hint muted" style={{ margin: '.25rem 0 0' }}>
            Solo lectura: cada OC con su pago (Tesorería), su retención (Retenciones), su factura (delivery / almacén) y su status (Compras).
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => void cargar()} disabled={cargando}>{cargando ? 'Cargando…' : '↻ Actualizar'}</button>
          <button className="btn btn-primary" onClick={() => setReporte(true)} disabled={!datos}>📊 Reporte dinámico</button>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}><strong>Error:</strong> {error}</div>}
      {datos && !datos.conLibroFiscal && (
        <div className="card" style={{ borderLeft: '3px solid var(--warning)', marginBottom: '1rem', fontSize: '.84rem' }}>
          No tienes acceso al libro fiscal de Retenciones: el tipo de retención se ve, pero no su N° de comprobante.
        </div>
      )}

      {/* Tarjetas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        {card('total', '🧾', 'Total de OC', `${t.totalOc.cantidad}`, `${usdTxt(t.totalOc.usd)} · ${bsTxt(t.totalOc.bs)}`, 'var(--primary, #ff8a00)')}
        {card('pagado', '💵', 'Total pagado', usdTxt(t.pagado.usd), `${bsTxt(t.pagado.bs)} · ${t.pagado.cantidad} OC (Bs a la tasa con que se pagó)`, 'var(--success, #29c081)')}
        {card('retencion', '🏛', 'OC con retención', `${t.conRetencion.cantidad}`, `${usdTxt(t.conRetencion.usd)} en esas OC`, 'var(--info, #4aa8ff)')}
      </div>

      {/* Detalle de la tarjeta */}
      {tarjeta && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
            <span>{tarjeta === 'total' ? '🧾 Todas las OC' : tarjeta === 'pagado' ? '💵 OC pagadas' : '🏛 OC con retención'} · {detalle.length}</span>
            <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>Toca una OC para abrirla en Compras</span>
          </div>
          <div style={{ display: 'grid', gap: '.4rem', maxHeight: 360, overflowY: 'auto' }}>
            {detalle.map((f) => (
              <button key={f.id} type="button" onClick={() => abrirOc(f.id)} className="card"
                style={{ margin: 0, padding: '.55rem .75rem', display: 'grid', gridTemplateColumns: 'minmax(120px,auto) 1fr auto', gap: '.25rem .9rem', alignItems: 'center', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <strong className="mono">{f.codigo}</strong>
                <span style={{ fontSize: '.84rem' }}>
                  {f.proveedor}
                  <span className="muted" style={{ display: 'block', fontSize: '.74rem' }}>
                    {tarjeta === 'pagado' ? `Pagada ${fechaCorta(f.pagadaEn)} · ref. ${textoReferenciaPago(f.referencia) || '—'}`
                      : tarjeta === 'retencion' ? `Retención: ${textoRetencion(f.retencion)}`
                        : `OC ${fechaCorta(f.fechaOc)}`}
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <span className="mono" style={{ fontWeight: 700 }}>{usdTxt(tarjeta === 'pagado' ? f.pagadoUsd : f.montoUsd)}</span>
                  <span style={{ display: 'block' }}><span className={`badge ${f.estado.className}`} style={{ fontSize: '.66rem' }}>{f.estado.label}</span></span>
                </span>
              </button>
            ))}
            {!detalle.length && <div className="muted" style={{ padding: '.75rem' }}>No hay OC en esta tarjeta con los filtros actuales.</div>}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ flex: '1 1 220px' }} placeholder="🔎 Código OC, proveedor, referencia, N° de retención…" value={filtros.texto ?? ''} onChange={(e) => setF({ texto: e.target.value })} />
        <select className="select" style={{ width: 'auto' }} value={filtros.grupo ?? ''} onChange={(e) => setF({ grupo: e.target.value as GrupoEstado | '' })}>
          {GRUPOS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={filtros.pago ?? ''} onChange={(e) => setF({ pago: e.target.value as FiltrosConciliacion['pago'] })}>
          <option value="">Pagadas y sin pagar</option><option value="pagadas">Solo pagadas</option><option value="sin_pagar">Sin pagar</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={filtros.retencion ?? ''} onChange={(e) => setF({ retencion: e.target.value as FiltrosConciliacion['retencion'] })}>
          <option value="">Con y sin retención</option><option value="si">Con retención</option><option value="no">Sin retención</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={filtros.referencia ?? ''} onChange={(e) => setF({ referencia: e.target.value as FiltrosConciliacion['referencia'] })}>
          <option value="">Con y sin referencia</option><option value="con">Con referencia</option><option value="sin">Sin referencia</option>
        </select>
        <label className="muted" style={{ fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}>Desde <input className="input" type="date" value={filtros.desde ?? ''} onChange={(e) => setF({ desde: e.target.value })} /></label>
        <label className="muted" style={{ fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}>Hasta <input className="input" type="date" value={filtros.hasta ?? ''} onChange={(e) => setF({ hasta: e.target.value })} /></label>
        {hayFiltros && <button className="btn btn-sm btn-ghost" onClick={() => setFiltros({})}>✕ Limpiar</button>}
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-title">Órdenes de compra · {filas.length}{datos && filas.length !== datos.filas.length ? ` de ${datos.filas.length}` : ''}</div>
        {cargando && !datos ? <div className="muted" style={{ padding: '1rem' }}>Cargando…</div> : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>Ítem</th><th>Código OC</th><th>Proveedor</th>
                  <th style={{ textAlign: 'right' }}>Monto de la OC</th><th>Referencia de pago</th><th>Retención</th><th>Factura</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filasPagina.map((f) => (
                  <tr key={f.id}>
                    <td className="mono muted" style={{ textAlign: 'center' }}>{f.item}</td>
                    <td>
                      <button type="button" className="btn btn-sm btn-ghost mono" style={{ padding: '.1rem .35rem', fontWeight: 700 }} onClick={() => abrirOc(f.id)} title="Abrir la OC en Compras">{f.codigo}</button>
                      <div className="muted mono" style={{ fontSize: '.7rem' }}>{f.sp} · {fechaCorta(f.fechaOc)}</div>
                    </td>
                    <td style={{ whiteSpace: 'normal', minWidth: 160 }}>{f.proveedor}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontWeight: 700 }}>{usdTxt(f.montoUsd)}</div>
                      <div className="mono muted" style={{ fontSize: '.74rem' }} title={f.tasa ? `Tasa ${f.tasa}${f.tasaEsDeHoy ? ' (de hoy: la OC no se ha pagado)' : ' (BCV del día en que se pagó)'}` : 'Sin tasa registrada'}>
                        {f.montoBs != null ? bsTxt(f.montoBs) : 'Bs —'}{f.tasaEsDeHoy && f.montoBs != null ? ' · hoy' : ''}
                      </div>
                    </td>
                    <td className="mono">
                      {f.referencia.bs && <div>Bs …{f.referencia.bs}</div>}
                      {f.referencia.binance && <div>Binance …{f.referencia.binance}</div>}
                      {!f.referencia.bs && !f.referencia.binance && <span className="muted">{f.pagado ? 'sin referencia' : '—'}</span>}
                    </td>
                    <td style={{ whiteSpace: 'normal', minWidth: 130 }}>
                      {f.retencion.lleva ? (
                        <>
                          <div>{f.retencion.tipos.map((x) => <span key={x} className="badge info" style={{ fontSize: '.66rem', marginRight: '.2rem' }}>{x}</span>)}{!f.retencion.tipos.length && <span className="badge info" style={{ fontSize: '.66rem' }}>Sí</span>}</div>
                          <div className="mono muted" style={{ fontSize: '.72rem' }}>{f.retencion.codigos.length ? `N° ${f.retencion.codigos.join(', ')}` : f.retencion.hecha ? 'hecha' : 'pendiente'}</div>
                        </>
                      ) : <span className="muted">No</span>}
                    </td>
                    <td>
                      {f.facturas > 0
                        ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => { const o = datos?.ordenes.get(f.id); if (o) setVerFacturas(o); }}>🧾 Ver ({f.facturas})</button>
                        : <span className="muted" style={{ fontSize: '.78rem' }}>Sin factura</span>}
                    </td>
                    <td><span className={`badge ${f.estado.className}`}>{f.estado.label}</span></td>
                  </tr>
                ))}
                {!filas.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>No hay OC con esos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {filas.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', marginTop: '.75rem' }}>
            <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.82rem' }}>
              Mostrar
              <select className="select" style={{ width: 'auto' }} value={porPagina} onChange={(e) => setPorPagina(Number(e.target.value))}>
                {TAMANOS_PAGINA.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              por página
            </label>
            <span className="muted" style={{ fontSize: '.82rem' }}>{desde + 1}–{desde + filasPagina.length} de {filas.length} OC</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
              <button type="button" className="btn btn-sm btn-ghost" disabled={paginaActual <= 1} onClick={() => setPagina(1)} title="Primera página">«</button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={paginaActual <= 1} onClick={() => setPagina(paginaActual - 1)}>‹ Anterior</button>
              {paginasVisibles(paginaActual, totalPaginas).map((n, i) => n === null
                ? <span key={`s${i}`} className="muted" style={{ padding: '0 .2rem' }}>…</span>
                : <button key={n} type="button" className={`btn btn-sm ${n === paginaActual ? 'btn-primary' : 'btn-ghost'}`} style={{ minWidth: 32 }} onClick={() => setPagina(n)}>{n}</button>)}
              <button type="button" className="btn btn-sm btn-ghost" disabled={paginaActual >= totalPaginas} onClick={() => setPagina(paginaActual + 1)}>Siguiente ›</button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={paginaActual >= totalPaginas} onClick={() => setPagina(totalPaginas)} title="Última página">»</button>
            </div>
          </div>
        )}
      </div>

      {verFacturas && <FacturasOrdenModal orden={verFacturas} onClose={() => setVerFacturas(null)} />}
      {reporte && <ReporteConciliacionModal base={baseReporte} filtros={filtros} onClose={() => setReporte(false)} />}
    </div>
  );
}

/* ───────── Reporte dinámico: columnas, vista previa PDF y WhatsApp ───────── */
function ReporteConciliacionModal({ base, filtros, onClose }: { base: FilaConciliacion[]; filtros: FiltrosConciliacion; onClose: () => void }) {
  const [desde, setDesde] = useState(filtros.desde ?? '');
  const [hasta, setHasta] = useState(filtros.hasta ?? '');
  const [fechaBase, setFechaBase] = useState<'oc' | 'pago'>(filtros.fechaBase ?? 'oc');
  const filas = useMemo(() => filtrar(base, { desde, hasta, fechaBase }), [base, desde, hasta, fechaBase]);
  const filtroTexto = textoFiltros({ ...filtros, desde, hasta, fechaBase });
  const rangoInvalido = !!(desde && hasta && desde > hasta);
  const aplicarRango = (r: Parameters<typeof rangoRapido>[0]) => { const x = rangoRapido(r); setDesde(x.desde); setHasta(x.hasta); };
  const [cols, setCols] = useState<ColumnaConciliacion[]>(COLUMNAS_CONCILIACION.filter((c) => c.porDefecto).map((c) => c.clave));
  const [conTarjetas, setConTarjetas] = useState(true);
  const [orientacion, setOrientacion] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [generando, setGenerando] = useState<null | 'pdf' | 'excel'>(null);
  const toggle = (c: ColumnaConciliacion) => setCols((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
  const fecha = new Date().toLocaleDateString('es-VE', { timeZone: 'America/Caracas' });
  const texto = useMemo(() => textoWhatsappConciliacion(filas, { columnas: cols, filtroTexto, fecha }), [filas, cols, filtroTexto, fecha]);

  async function vistaPrevia(tipo: 'pdf' | 'excel') {
    setGenerando(tipo);
    try {
      if (tipo === 'pdf') await vistaPreviaConciliacionPdf(filas, { columnas: cols, filtroTexto, conTarjetas, orientacion });
      else await vistaPreviaConciliacionExcel(filas, { columnas: cols, filtroTexto, conTarjetas });
    } catch (e) { toast(e instanceof Error ? e.message : `No se pudo generar el ${tipo === 'pdf' ? 'PDF' : 'Excel'}`, 'error'); }
    finally { setGenerando(null); }
  }
  const sinGenerar = !!generando || !cols.length || !filas.length || rangoInvalido;

  return (
    <Modal title="📊 Reporte dinámico · Conciliación" size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-ghost" onClick={() => void vistaPrevia('excel')} disabled={sinGenerar}>{generando === 'excel' ? 'Generando…' : '📗 Vista previa Excel'}</button>
        <button className="btn btn-primary" onClick={() => void vistaPrevia('pdf')} disabled={sinGenerar}>{generando === 'pdf' ? 'Generando…' : '👁 Vista previa PDF'}</button>
      </>}>
      <div className="card" style={{ margin: '0 0 .75rem' }}>
        <div className="card-title" style={{ marginBottom: '.45rem' }}>📅 Rango de fechas</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem .8rem', alignItems: 'flex-end' }}>
          <label className="muted" style={{ fontSize: '.8rem', display: 'grid', gap: '.2rem' }}>
            Según
            <select className="select" style={{ width: 'auto' }} value={fechaBase} onChange={(e) => setFechaBase(e.target.value as 'oc' | 'pago')}>
              <option value="oc">Fecha de la OC</option><option value="pago">Fecha de pago</option>
            </select>
          </label>
          <label className="muted" style={{ fontSize: '.8rem', display: 'grid', gap: '.2rem' }}>
            Desde<input type="date" className="input" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="muted" style={{ fontSize: '.8rem', display: 'grid', gap: '.2rem' }}>
            Hasta<input type="date" className="input" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => aplicarRango('hoy')}>Hoy</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => aplicarRango('7d')}>Últimos 7 días</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => aplicarRango('mes')}>Este mes</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => aplicarRango('mes_ant')}>Mes pasado</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setDesde(''); setHasta(''); }} disabled={!desde && !hasta}>Todas</button>
          </div>
        </div>
        {rangoInvalido && <p className="hint" style={{ color: 'var(--danger, #dc2626)', margin: '.45rem 0 0' }}>La fecha «desde» es posterior a «hasta».</p>}
        <p className="hint muted" style={{ margin: '.5rem 0 0' }}>
          Sale con <strong>{filas.length} OC</strong>{filtroTexto ? <> ({filtroTexto})</> : ' (sin filtros)'}.
          {fechaBase === 'pago' && (desde || hasta) ? ' Por fecha de pago solo entran las OC ya pagadas.' : ''}
        </p>
      </div>
      <div className="card" style={{ margin: '0 0 .75rem' }}>
        <div className="card-title" style={{ marginBottom: '.45rem' }}>Columnas</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem .9rem' }}>
          {COLUMNAS_CONCILIACION.map((c) => (
            <label key={c.clave} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer', fontSize: '.86rem' }}>
              <input type="checkbox" checked={cols.includes(c.clave)} onChange={() => toggle(c.clave)} /> {c.label}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '.6rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.86rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={conTarjetas} onChange={(e) => setConTarjetas(e.target.checked)} /> Tarjetas de resumen en el PDF
          </label>
          <label className="muted" style={{ fontSize: '.84rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
            Hoja
            <select className="select" style={{ width: 'auto' }} value={orientacion} onChange={(e) => setOrientacion(e.target.value as typeof orientacion)}>
              <option value="auto">Automática</option><option value="portrait">Vertical</option><option value="landscape">Horizontal</option>
            </select>
          </label>
        </div>
      </div>
      <div className="card" style={{ margin: 0 }}>
        <div className="card-title" style={{ marginBottom: '.45rem' }}>💬 Mensaje de WhatsApp</div>
        <textarea className="input mono" readOnly value={texto} style={{ width: '100%', minHeight: 220, fontSize: '.78rem', whiteSpace: 'pre' }} />
        <div style={{ marginTop: '.5rem' }}><CompartirWhatsapp texto={texto} /></div>
      </div>
    </Modal>
  );
}
