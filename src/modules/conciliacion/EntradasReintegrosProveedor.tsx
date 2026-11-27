import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { useRealtime } from '@/shared/lib/useRealtime';
import { dateTime, money } from '@/shared/lib/format';
import { mensajeError } from '@/shared/lib/errores';
import { Modal } from '@/shared/ui/Modal';
import { urlAdjuntoOc } from '@/modules/pedidos/pedidos.repository';

interface EntradaReintegro {
  id: string; orden_id: string; movimiento_id: string; fecha: string; monto: number; moneda: string;
  caja: string; cuenta: string; referencia: string; oc_codigo: string; proveedor: string;
  motivo: string; nota_almacen: string | null; comprobante: string | null; conciliada_at: string | null;
  detalle: { sku: string; nombre: string; cantidad: number }[];
}

export function EntradasReintegrosProveedor() {
  const [filas, setFilas] = useState<EntradaReintegro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buscar, setBuscar] = useState('');
  const [moneda, setMoneda] = useState('');
  const [pagina, setPagina] = useState(1);
  const [detalle, setDetalle] = useState<EntradaReintegro | null>(null);
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const data = await todasLasFilas<EntradaReintegro>((a, b) => supabase.rpc('conciliacion_entradas_reintegros').order('fecha', { ascending: false }).order('id').range(a, b));
      setFilas(data); setError('');
    } catch (e) { setError(mensajeError(e, 'No se pudieron consultar las entradas por reintegro')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void cargar();
    const timer = setInterval(() => { if (!document.hidden) void cargar(); }, 30000);
    return () => clearInterval(timer);
  }, [cargar]);
  useRealtime(['compras_reintegros', 'movimientos_caja'], () => { void cargar(); });
  const filtradas = useMemo(() => filas.filter(f => (!moneda || f.moneda === moneda) &&
    [f.oc_codigo, f.proveedor, f.referencia, f.caja, f.cuenta, f.motivo].join(' ').toLocaleLowerCase().includes(buscar.trim().toLocaleLowerCase())), [filas, moneda, buscar]);
  const totales = filtradas.reduce<Record<string, number>>((r, f) => { r[f.moneda] = (r[f.moneda] || 0) + Number(f.monto); return r; }, {});
  const paginas = Math.max(1, Math.ceil(filtradas.length / 15));
  const actual = Math.min(pagina, paginas);
  async function abrirComprobante(path: string) {
    const ventana = window.open('about:blank', '_blank');
    if (ventana) ventana.opener = null;
    try {
      const url = await urlAdjuntoOc(path);
      if (ventana) ventana.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) { ventana?.close(); setError(mensajeError(e, 'No se pudo abrir el comprobante')); }
  }
  return <section>
    <h2>📥 Entradas por reintegro</h2>
    <p className="muted">Ingresos confirmados por Tesorería, vinculados al reintegro del proveedor y a su movimiento de caja.</p>
    <div className="kpi-grid">{Object.entries(totales).map(([m, total]) => <div className="card" key={m}><div className="card-title">Total recibido · {m}</div><strong>{money(total, m)}</strong></div>)}</div>
    <div className="card" style={{ padding: '1rem', margin: '1rem 0' }}><div className="form-grid">
      <div className="form-row"><label htmlFor="buscar-reintegro-conciliacion">Buscar</label><input id="buscar-reintegro-conciliacion" className="input" placeholder="OC, proveedor, referencia o cuenta…" value={buscar} onChange={e => { setBuscar(e.target.value); setPagina(1); }} /></div>
      <div className="form-row"><label htmlFor="moneda-reintegro-conciliacion">Moneda</label><select id="moneda-reintegro-conciliacion" className="select" value={moneda} onChange={e => { setMoneda(e.target.value); setPagina(1); }}><option value="">Todas</option>{[...new Set(filas.map(f => f.moneda))].sort().map(m => <option key={m}>{m}</option>)}</select></div>
    </div><button className="btn btn-ghost" style={{ marginTop: '.7rem' }} disabled={loading} onClick={() => void cargar()}>↻ Actualizar</button></div>
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    {loading && <p>Cargando entradas…</p>}
    <div className="table-wrap"><table className="table"><thead><tr><th>Fecha de ingreso</th><th>OC</th><th>Proveedor</th><th>Caja / cuenta</th><th>Referencia</th><th>Importe recibido</th><th>Cotejo bancario</th><th>Detalle</th></tr></thead><tbody>
      {filtradas.slice((actual - 1) * 15, actual * 15).map(f => <tr key={f.id}><td>{dateTime(f.fecha)}</td><td>{f.oc_codigo}</td><td>{f.proveedor}</td><td>{f.caja} · {f.cuenta}</td><td className="mono">{f.referencia}</td><td>{money(f.monto, f.moneda)}</td><td><span className={'badge ' + (f.conciliada_at ? 'success' : 'warning')}>{f.conciliada_at ? 'Conciliado' : 'Por cotejar'}</span></td><td><button className="btn btn-sm btn-ghost" onClick={() => setDetalle(f)}>👁 Ver detalle</button></td></tr>)}
    </tbody></table></div>
    {!loading && !filtradas.length && <p className="muted">No hay reintegros confirmados que coincidan con estos filtros.</p>}
    <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', marginTop: '1rem' }}><span>{filtradas.length} entradas · {actual}/{paginas}</span><button className="btn btn-ghost" disabled={actual <= 1} onClick={() => setPagina(actual - 1)}>Anterior</button><button className="btn btn-ghost" disabled={actual >= paginas} onClick={() => setPagina(actual + 1)}>Siguiente</button></div>
    {detalle && <Modal title={'📥 Reintegro · ' + detalle.oc_codigo} onClose={() => setDetalle(null)}>
      <div className="card" style={{ padding: '1rem' }}><h3>{detalle.proveedor} · {money(detalle.monto, detalle.moneda)}</h3><p>📅 Ingreso: {dateTime(detalle.fecha)}</p><p>🏦 {detalle.caja} · {detalle.cuenta}</p><p>🔎 Referencia: <strong>{detalle.referencia}</strong></p><p>📝 Motivo del reintegro: {detalle.motivo}</p><p>👷 Motivo del almacenista: {detalle.nota_almacen || 'Sin observación registrada'}</p>
        <ul>{detalle.detalle.map((i, n) => <li key={n}>{i.sku} · {i.nombre} · {i.cantidad}</li>)}</ul>
        {detalle.comprobante && <button className="btn" onClick={() => void abrirComprobante(detalle.comprobante!)}>📄 Comprobante del ingreso</button>}
        {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
    </Modal>}
  </section>;
}
