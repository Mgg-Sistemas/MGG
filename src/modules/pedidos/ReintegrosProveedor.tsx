import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { mensajeReintegroRecibido } from './mensajeReintegroRecibido';
import { CompraYReintegroDetalle } from './CompraYReintegroDetalle';
import { DetalleCompraTarjeta } from './DetalleCompraTarjeta';
import { useRealtime } from '@/shared/lib/useRealtime';
import { ComprobantesReintegro, type ComprobanteReintegro } from './ComprobantesReintegro';
import { ContextoCompraTarjeta, type OrdenTarjeta } from './ContextoCompraTarjeta';
import { PaginasCompras, POR_PAGINA_COMPRAS } from './ComprasListaCompacta';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { mensajeError } from '@/shared/lib/errores';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Orden, Caja } from '@/shared/lib/types';
import { listCajasActivas } from '@/modules/salidas/cajas.repository';
import { urlAdjuntoOc } from './pedidos.repository';

interface Reintegro {
  id: string;
  orden_id: string;
  detalle: { indice: number; sku: string; nombre: string; cantidad: number }[];
  monto: number;
  moneda: string;
  motivo: string;
  estado: string;
  referencia: string | null;
  comprobante_url: string | null;
  generado_por_recepcion: boolean;
  comprobantes_compras: ComprobanteReintegro[];
  ordenes: OrdenTarjeta;
}

export function ReintegrosProveedor({ tesoreria = false, canWrite }: { tesoreria?: boolean; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [pendientes, setPendientes] = useState<number | null>(null);
  const [errorContador, setErrorContador] = useState(false);
  const cargarPendientes = useCallback(async () => {
    const { count, error } = await supabase.from('compras_reintegros').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
    setErrorContador(!!error);
    if (!error) setPendientes(count || 0);
  }, []);
  useEffect(() => {
    void cargarPendientes();
    const timer = setInterval(() => { if (!document.hidden) void cargarPendientes(); }, 30000);
    return () => clearInterval(timer);
  }, [cargarPendientes]);
  useRealtime(['compras_reintegros'], () => { void cargarPendientes(); });
  return <div className="compras-acceso-reintegros">
    <button className="btn btn-ghost" style={pendientes && pendientes > 0 ? { background: 'var(--warning, #ffb51b)', color: '#111', borderColor: 'transparent', fontWeight: 700 } : undefined}
      title={errorContador ? 'No se pudo actualizar el contador. Abre la vista para consultar los reintegros.' : 'Consultar reintegros de proveedores'} onClick={() => setOpen(true)}>
      ↩ Reintegros de proveedores <span aria-live="polite">{pendientes !== null ? `(${pendientes})` : ''}</span>
    </button>
    {open && <PanelReintegros tesoreria={tesoreria} canWrite={canWrite} onPendientes={setPendientes} onClose={() => { setOpen(false); void cargarPendientes(); }} />}
  </div>;
}

function PanelReintegros({ tesoreria, canWrite, onClose, onPendientes }: { tesoreria: boolean; canWrite: boolean; onClose: () => void; onPendientes: (n: number) => void }) {
  const [avisoRecibido, setAvisoRecibido] = useState<{ texto: string; archivos: File[]; enlaces: string[] } | null>(null);
  const [lista, setLista] = useState<Reintegro[]>([]);
  const [vista, setVista] = useState<'faltantes' | 'reintegros' | 'nuevo'>(tesoreria ? 'reintegros' : 'faltantes');
  const [filtro, setFiltro] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('pendiente');
  const [pagina, setPagina] = useState(1);
  const [orden, setOrden] = useState<Orden | null>(null);
  const [faltantes, setFaltantes] = useState<Orden[]>([]);
  const [reposiciones, setReposiciones] = useState<Record<string, { id: string; codigo: string }>>({});
  const [buscar, setBuscar] = useState('');
  const [opciones, setOpciones] = useState<Orden[]>([]);
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
  const [monto, setMonto] = useState('');
  const [moneda, setMoneda] = useState('USD');
  const [motivo, setMotivo] = useState('');
  const [recibir, setRecibir] = useState<Reintegro | null>(null);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [cuentas, setCuentas] = useState<string[]>([]);
  const [caja, setCaja] = useState('');
  const [cuenta, setCuenta] = useState('general');
  const [referencia, setReferencia] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const reintegros = await todasLasFilas<Reintegro>((desde, hasta) => supabase.from('compras_reintegros')
        .select('*, ordenes(*,proveedores(razon_social))').order('created_at', { ascending: false }).order('id').range(desde, hasta).returns<Reintegro[]>());
      setLista(reintegros);
      onPendientes(reintegros.filter(r => r.estado === 'pendiente').length);
      if (!tesoreria) {
        const recibidas = await todasLasFilas<Orden>((desde, hasta) => supabase.from('ordenes')
          .select('*,proveedores(razon_social)').not('recibida_en', 'is', null).or('clase.eq.producto,clase.is.null')
          .order('recibida_en', { ascending: false }).order('id').range(desde, hasta));
        const solicitudes = await todasLasFilas<{ id: string; codigo: string; reposicion_origen_id: string }>((desde, hasta) =>
          supabase.from('ordenes').select('id,codigo,reposicion_origen_id')
            .not('reposicion_origen_id', 'is', null).order('id').range(desde, hasta));
        setReposiciones(Object.fromEntries(solicitudes.map(s => [s.reposicion_origen_id, { id: s.id, codigo: s.codigo }])));
        setFaltantes(recibidas.filter(o =>
          o.items.some(i => i.cantidad_recibida != null && Number(i.cantidad_recibida) < Number(i.cantidad))));
      }
      setError('');
    } catch (e) { setError(mensajeError(e, 'No se pudo completar la operación')); }
    finally { setLoading(false); }
  }, [tesoreria, onPendientes]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    if (!tesoreria) return;
    void listCajasActivas().then(setCajas).catch(() => setError('No se pudieron cargar las cajas'));
  }, [tesoreria]);
  useEffect(() => {
    let vigente = true;
    setCuentas([]);
    if (caja && recibir) {
      void supabase.from('caja_saldos').select('cuenta').eq('caja_id', caja).eq('moneda', recibir.moneda)
        .then(({ data, error: e }) => {
          if (!vigente) return;
          if (e) { setError(e.message); return; }
          const valores = data?.length ? data.map(r => String(r.cuenta)) : ['general'];
          setCuentas(valores);
          setCuenta(valores[0]);
        });
    }
    return () => { vigente = false; };
  }, [caja, recibir]);

  const texto = filtro.trim().toLocaleLowerCase();
  const faltantesVisibles = useMemo(() => faltantes.filter(o =>
    [o.oc_codigo, o.codigo, o.nota_recepcion, ...o.items.map(i => i.sku + ' ' + i.nombre)].join(' ').toLocaleLowerCase().includes(texto)), [faltantes, texto]);
  const reintegrosVisibles = useMemo(() => lista.filter(r =>
    (!estadoFiltro || r.estado === estadoFiltro) &&
    [r.ordenes.oc_codigo, r.ordenes.codigo, r.motivo, r.referencia, ...r.detalle.map(i => i.sku + ' ' + i.nombre)].join(' ').toLocaleLowerCase().includes(texto)), [lista, texto, estadoFiltro]);
  const totalVisible = vista === 'faltantes' ? faltantesVisibles.length : reintegrosVisibles.length;
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(totalVisible / POR_PAGINA_COMPRAS)));
  const inicio = (paginaActual - 1) * POR_PAGINA_COMPRAS;

  async function buscarOrden() {
    setError('');
    const codigo = buscar.trim().replace(/[^a-zA-Z0-9-]/g, '');
    if (codigo.length < 3) { setError('Escribe al menos tres caracteres del código de la orden'); return; }
    const { data, error: e } = await supabase.from('ordenes').select('*')
      .in('estado', ['pagada', 'por_recibir', 'recibida', 'finalizada', 'reasignada'])
      .or('oc_codigo.ilike.%' + codigo + '%,codigo.ilike.%' + codigo + '%').limit(30);
    if (e) setError(e.message);
    else { setOpciones((data ?? []) as Orden[]); if (!data?.length) setError('No hay órdenes pagadas con ese código'); }
  }

  async function solicitar() {
    if (!orden) return;
    const detalle = Object.entries(cantidades).filter(([, v]) => Number(v) > 0)
      .map(([indice, cantidad]) => ({ indice: Number(indice), cantidad: Number(cantidad) }));
    if (!detalle.length || !(Number(monto) > 0) || !motivo.trim()) {
      setError('Selecciona cantidades e indica el importe y el motivo'); return;
    }
    setSaving(true); setError('');
    try {
      const { error: e } = await supabase.rpc('compras_solicitar_reintegro', {
        p_orden: orden.id, p_detalle: detalle, p_monto: Number(monto), p_moneda: moneda, p_motivo: motivo,
      });
      if (e) throw e;
      setOrden(null); setOpciones([]); setCantidades({}); setMonto(''); setMotivo('');
      setVista('reintegros'); setEstadoFiltro('pendiente'); setFiltro(''); setPagina(1);
      toast('Reintegro pendiente en Tesorería', 'success');
      await cargar();
    } catch (e) { setError(mensajeError(e, 'No se pudo completar la operación')); }
    finally { setSaving(false); }
  }

  async function confirmar() {
    if (!recibir || !caja || !cuenta || !referencia.trim() || !archivo) {
      setError('Selecciona cuenta, referencia y comprobante del ingreso'); return;
    }
    setSaving(true); setError('');
    try {
      if (!(archivo.type.startsWith('image/') || archivo.type === 'application/pdf') || archivo.size > 10 * 1024 * 1024) {
        throw new Error('Adjunta una imagen o PDF de hasta 10 MB');
      }
      const path = recibir.orden_id + '/reintegro-' + crypto.randomUUID() + '-' + archivo.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const { error: errorArchivo } = await supabase.storage.from('compras-oc').upload(path, archivo, { upsert: false });
      if (errorArchivo) throw errorArchivo;
      const { error: e } = await supabase.rpc('tesoreria_recibir_reintegro', {
        p_id: recibir.id, p_caja: caja, p_cuenta: cuenta, p_referencia: referencia, p_comprobante: path,
      });
      if (e) throw e;
      const enlacesComprobante = await urlAdjuntoOc(path).then(url => [url]).catch(() => [] as string[]);
      setAvisoRecibido({
        texto: mensajeReintegroRecibido({ codigo: recibir.ordenes.oc_codigo || recibir.ordenes.codigo,
          proveedor: recibir.ordenes.proveedores?.razon_social || 'Sin proveedor asignado', monto: recibir.monto,
          moneda: recibir.moneda, caja: cajas.find(c => c.id === caja)?.nombre || caja, cuenta,
          referencia: referencia.trim(), motivo: recibir.motivo, fecha: new Date().toISOString(), productos: recibir.detalle }),
        archivos: [archivo], enlaces: enlacesComprobante,
      });
      setRecibir(null); setArchivo(null);
      toast('Ingreso registrado y reintegro recibido', 'success');
      await cargar();
    } catch (e) { setError(mensajeError(e, 'No se pudo completar la operación')); }
    finally { setSaving(false); }
  }

  async function verComprobante(path: string) {
    try {
      const url = await urlAdjuntoOc(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch { setError('No se pudo abrir el comprobante'); }
  }

  async function recotizar(o: Orden) {
    setSaving(true); setError('');
    try {
      const { data, error: e } = await supabase.rpc('compras_recotizar_faltantes', { p_orden: o.id });
      if (e) throw e;
      const { data: nueva, error: errorOrden } = await supabase.from('ordenes').select('codigo').eq('id', data).single();
      if (errorOrden) throw errorOrden;
      toast('Faltantes en cotización · ' + nueva.codigo, 'success');
      await cargar();
    } catch (e) { setError(mensajeError(e, 'No se pudo completar la operación')); }
    finally { setSaving(false); }
  }

  function cantidadSinReintegro(o: Orden, indice: number): number {
    const item = o.items[indice];
    if (item.cantidad_recibida == null) return 0;
    const solicitada = lista.filter(r => r.orden_id === o.id).flatMap(r => r.detalle)
      .filter(d => d.indice === indice).reduce((total, d) => total + Number(d.cantidad), 0);
    return Math.max(0, Number(item.cantidad) - Number(item.cantidad_recibida) - solicitada);
  }

  return <Modal title="Reintegros de proveedores" onClose={onClose}>
    <div className="compras-panel">
    <nav className="compras-tabs" aria-label="Secciones de reintegros">
      {!tesoreria && <button className="btn btn-ghost" aria-pressed={vista === 'faltantes'} onClick={() => { setVista('faltantes'); setPagina(1); }}>Faltantes ({faltantes.length})</button>}
      <button className="btn btn-ghost" aria-pressed={vista === 'reintegros'} onClick={() => { setVista('reintegros'); setPagina(1); }}>Reintegros ({lista.filter(r => r.estado === 'pendiente').length} pendientes)</button>
      {!tesoreria && canWrite && <button className="btn btn-ghost" aria-pressed={vista === 'nuevo'} onClick={() => setVista('nuevo')}>+ Solicitar reintegro</button>}
    </nav>
    {vista !== 'nuevo' && <div className="compras-barra">
      <input className="input" aria-label="Buscar OC o producto" placeholder="Buscar OC, producto o referencia…" value={filtro} onChange={e => { setFiltro(e.target.value); setPagina(1); }} />
      {vista === 'reintegros' && <select className="input" aria-label="Estado del reintegro" value={estadoFiltro} onChange={e => { setEstadoFiltro(e.target.value); setPagina(1); }}>
        <option value="pendiente">Pendientes</option><option value="recibido">Recibidos</option><option value="">Todos los estados</option>
      </select>}
      <button className="btn btn-ghost" onClick={() => void cargar()} disabled={saving || loading}>Actualizar</button>
    </div>}
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    {!tesoreria && vista === 'faltantes' && <section>
      <p className="muted">Órdenes con diferencias de recepción. Revisa los datos de la compra, la observación de Almacén y los faltantes.</p>
      <div className="compras-tarjetas">{faltantesVisibles.slice(inicio, inicio + POR_PAGINA_COMPRAS).map(o => <article className="card compras-tarjeta" key={o.id}>
        <header><strong>{o.oc_codigo || o.codigo}</strong><span className="badge warning">{o.items.filter(i => i.cantidad_recibida != null && Number(i.cantidad_recibida) < Number(i.cantidad)).length} productos faltantes</span><span className="muted">{reposiciones[o.id] ? 'En cotización' : 'Por gestionar'}</span></header>
        <DetalleCompraTarjeta orden={o} titulo={"Faltantes · " + (o.oc_codigo || o.codigo)}>
        <ContextoCompraTarjeta orden={o} titulo="Faltantes de recepción" estado={reposiciones[o.id] ? 'En cotización · ' + reposiciones[o.id].codigo : 'Por gestionar'} detalle={[...o.items.filter(i => i.cantidad_recibida != null && Number(i.cantidad_recibida) < Number(i.cantidad)).map(i => `${i.sku} · ${i.nombre} · Pedido ${i.cantidad} · Recibido ${i.cantidad_recibida} · Faltan ${Number(i.cantidad) - Number(i.cantidad_recibida)}`), 'Motivo del almacenista: ' + (o.nota_recepcion || 'Sin observación registrada')]} />
        <p className="compras-motivo"><strong>👷 Motivo del almacenista:</strong> {o.nota_recepcion || 'Sin observación registrada'}</p>
        <details className="compras-fila" open><summary>📦 Productos faltantes</summary>
        <div className="compras-detalle">
        <table className="compras-productos"><thead><tr><th>Producto</th><th>Pedido</th><th>Recibido</th><th>Falta</th></tr></thead><tbody>{o.items.filter(i => i.cantidad_recibida != null && Number(i.cantidad_recibida) < Number(i.cantidad)).map((i, n) =>
          <tr key={n}><td>{i.nombre}<small>{i.sku}</small></td><td>{i.cantidad}</td><td>{i.cantidad_recibida ?? 0}</td><td><strong>{Number(i.cantidad) - Number(i.cantidad_recibida ?? 0)}</strong></td></tr>)}</tbody></table>

        {reposiciones[o.id] && <p>Solicitud para cotizar <Link to={"/app/pedidos?tab=oc&detalle=" + reposiciones[o.id].id} onClick={onClose}>{reposiciones[o.id].codigo}</Link> · Reposición vinculada a esta OC.</p>}
        {canWrite && !reposiciones[o.id] && <button className="btn" disabled={saving} onClick={() => void recotizar(o)}>Cotizar faltantes</button>}
        {canWrite && o.items.some((_, indice) => cantidadSinReintegro(o, indice) > 0) && <button className="btn btn-ghost" disabled={saving} onClick={() => {
          setVista('nuevo'); setOrden(o); setOpciones([]); setMonto(''); setMoneda(o.moneda || 'USD');
          setCantidades(Object.fromEntries(o.items.map((_, n) => [n, String(cantidadSinReintegro(o, n))])));
        }}>Solicitar reintegro</button>}
      </div></details>
      <Link className="btn btn-ghost" to={"/app/pedidos?tab=oc&detalle=" + o.id} onClick={onClose}>Abrir OC</Link>
      </DetalleCompraTarjeta></article>)}</div>
    </section>}
    {!tesoreria && canWrite && vista === 'nuevo' && <section className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
      <h3>Solicitar reintegro</h3>
      <label>Código de la orden
        <input className="input" value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Ej. 0306" />
      </label>
      <button className="btn" onClick={() => void buscarOrden()} disabled={saving}>Buscar orden pagada</button>
      {opciones.map(o => <button className="btn btn-ghost" key={o.id} onClick={() => {
        setOrden(o); setCantidades({}); setMonto(''); setMoneda(o.moneda || 'USD');
      }}>{o.oc_codigo || o.codigo}</button>)}
      {orden && <>
        <h4>{orden.oc_codigo || orden.codigo} · Productos no suministrados</h4>
        {orden.items.map((item, i) => <label key={i} style={{ display: 'block', marginBottom: '.5rem' }}>
          {item.sku} · {item.nombre} · Comprados {item.cantidad}
          <input aria-label={'Cantidad no suministrada de ' + item.nombre} className="input" type="number" min="0" max={item.cantidad} step="any"
            value={cantidades[i] || ''} onChange={e => setCantidades({ ...cantidades, [i]: e.target.value })} />
        </label>)}
        <p className="muted">Los productos quedan identificados para su compra pendiente. Registra en la recepción únicamente lo entregado.</p>
        <label>Importe que devolverá el proveedor
          <input className="input" type="number" min="0.01" step="0.01" value={monto} onChange={e => setMonto(e.target.value)} />
        </label>
        <label>Moneda
          <select className="input" value={moneda} onChange={e => setMoneda(e.target.value)}>
            {['USD', 'Bs', 'USDT', 'COP', 'EUR', 'BRL'].map(m => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label>Motivo<textarea className="input" value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={saving} onClick={() => void solicitar()}>{saving ? 'Guardando…' : 'Enviar a Tesorería'}</button>
      </>}
    </section>}
    {loading && <p>Cargando…</p>}
    {!loading && vista !== 'nuevo' && !totalVisible && <p className="compras-vacio">No hay órdenes que coincidan con estos filtros.</p>}
    {vista === 'reintegros' && <div className="compras-tarjetas">{reintegrosVisibles.slice(inicio, inicio + POR_PAGINA_COMPRAS).map(r => <article key={r.id} className="card compras-tarjeta">
      <header><strong>{r.ordenes.oc_codigo || r.ordenes.codigo}</strong><span>{Number(r.monto).toFixed(2)} {r.moneda}</span><span className={'badge ' + (r.estado === 'recibido' ? 'success' : 'warning')}>{r.estado === 'recibido' ? 'Recibido' : 'Pendiente'}</span></header>
      <DetalleCompraTarjeta orden={r.ordenes} titulo={"Reintegro · " + (r.ordenes.oc_codigo || r.ordenes.codigo)}>
      <h3>↩️ Importe del reintegro: {Number(r.monto).toFixed(2)} {r.moneda} · {r.estado === 'recibido' ? 'Recibido' : 'Pendiente'}</h3>
      <ContextoCompraTarjeta orden={r.ordenes} titulo="Reintegro de proveedor" estado={r.estado === 'recibido' ? 'Recibido en Tesorería' : 'Pendiente de devolución'} detalle={[`Importe del reintegro: ${Number(r.monto).toFixed(2)} ${r.moneda}`, 'Motivo del reintegro: ' + r.motivo, 'Motivo del almacenista: ' + (r.ordenes.nota_recepcion || 'Sin observación registrada'), ...r.detalle.map(i => `${i.sku} · ${i.nombre} · Cantidad ${i.cantidad}`), ...(r.referencia ? ['Referencia: ' + r.referencia] : [])]} />
      <div className="compras-detalle">
      <p className="compras-motivo"><strong>📝 Motivo del reintegro:</strong> {r.motivo}</p>
      <p className="compras-motivo"><strong>👷 Motivo del almacenista:</strong> {r.ordenes.nota_recepcion || 'Sin observación registrada'}</p>
      {r.generado_por_recepcion && <p className="muted">Generado automáticamente al recibir. Importe de los faltantes al precio unitario de la OC.</p>}
      <ul>{r.detalle.map(d => <li key={d.indice}>{d.sku} · {d.nombre} · {d.cantidad}</li>)}</ul>
      <CompraYReintegroDetalle orden={r.ordenes} monto={r.monto} moneda={r.moneda} estado={r.estado} />
      <ComprobantesReintegro id={r.id} ordenId={r.orden_id} archivos={r.comprobantes_compras || []} canUpload={!tesoreria && canWrite} onSaved={cargar} />
      {r.referencia && <p>Referencia {r.referencia}</p>}
      {r.comprobante_url && <button className="btn btn-ghost" onClick={() => void verComprobante(r.comprobante_url!)}>Ver comprobante de ingreso de Tesorería</button>}
      {tesoreria && canWrite && r.estado === 'pendiente' && recibir?.id !== r.id && <button className="btn btn-primary" disabled={saving} onClick={() => {
        setRecibir(r); setCaja(''); setCuenta('general'); setArchivo(null); setReferencia('');
      }}>Registrar dinero recibido</button>}
      {recibir?.id === r.id && <form className="card compras-ingreso-reintegro" onSubmit={e => { e.preventDefault(); void confirmar(); }}>
        <div className="card-title">💳 Registrar ingreso del reintegro</div>
        {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
        <p className="muted">Importe a recibir: <strong>{Number(r.monto).toFixed(2)} {r.moneda}</strong></p>
        <div className="form-grid">
          <div className="form-row"><label htmlFor={'reintegro-caja-' + r.id}>Caja de ingreso ({r.moneda})</label>
            <select id={'reintegro-caja-' + r.id} className="select" value={caja} required onChange={e => setCaja(e.target.value)}>
              <option value="">Seleccionar caja</option>
              {cajas.filter(c => c.moneda === r.moneda && !c.externo && c.tipo !== 'centro_acopio').map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="form-row"><label htmlFor={'reintegro-cuenta-' + r.id}>Cuenta</label>
            <select id={'reintegro-cuenta-' + r.id} className="select" value={cuenta} required disabled={!caja || !cuentas.length} onChange={e => setCuenta(e.target.value)}>
              {cuentas.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-row"><label htmlFor={'reintegro-ref-' + r.id}>Referencia del ingreso</label>
            <input id={'reintegro-ref-' + r.id} className="input" value={referencia} required placeholder="Número de referencia" onChange={e => setReferencia(e.target.value)} />
          </div>
          <div className="form-row"><label htmlFor={'reintegro-soporte-' + r.id}>Comprobante del ingreso (imagen o PDF)</label>
            <input id={'reintegro-soporte-' + r.id} className="input" type="file" required accept="image/*,application/pdf" onChange={e => setArchivo(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div className="compras-acciones" style={{ marginTop: '1rem' }}>
          <button type="submit" className="btn btn-primary" disabled={saving || !cuentas.length}>{saving ? 'Registrando…' : '✓ Confirmar ingreso'}</button>
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setRecibir(null)}>Cancelar</button>
        </div>
      </form>}
    </div></DetalleCompraTarjeta></article>)}</div>}
    {vista !== 'nuevo' && <PaginasCompras total={totalVisible} pagina={paginaActual} onChange={setPagina} />}
    </div>
    {avisoRecibido && <Modal title="💬 Reintegro recibido · Compartir comprobante" onClose={() => setAvisoRecibido(null)}>
      <div className="compras-panel"><CompartirWhatsapp texto={avisoRecibido.texto} fotos={{ archivos: avisoRecibido.archivos, enlaces: avisoRecibido.enlaces }} /></div>
    </Modal>}
  </Modal>;
}
