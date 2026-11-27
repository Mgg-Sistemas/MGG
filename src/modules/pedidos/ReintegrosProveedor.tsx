import { useCallback, useEffect, useState } from 'react';
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
  ordenes: { codigo: string; oc_codigo: string | null };
}

export function ReintegrosProveedor({ tesoreria = false, canWrite }: { tesoreria?: boolean; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="btn btn-ghost" onClick={() => setOpen(true)}>↩ Reintegros de proveedores</button>
    {open && <PanelReintegros tesoreria={tesoreria} canWrite={canWrite} onClose={() => setOpen(false)} />}
  </>;
}

function PanelReintegros({ tesoreria, canWrite, onClose }: { tesoreria: boolean; canWrite: boolean; onClose: () => void }) {
  const [lista, setLista] = useState<Reintegro[]>([]);
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
        .select('*, ordenes(codigo, oc_codigo)').order('created_at', { ascending: false }).order('id').range(desde, hasta).returns<Reintegro[]>());
      setLista(reintegros);
      if (!tesoreria) {
        const recibidas = await todasLasFilas<Orden>((desde, hasta) => supabase.from('ordenes')
          .select('*').not('recibida_en', 'is', null).or('clase.eq.producto,clase.is.null')
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
  }, [tesoreria]);

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
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    {!tesoreria && faltantes.length > 0 && <section className="card" style={{ padding: '1rem' }}>
      <h3>Faltantes registrados por Almacén en las OC</h3>
      {faltantes.map(o => <div key={o.id} style={{ marginBottom: '1rem' }}>
        <strong>{o.oc_codigo || o.codigo}</strong>
        <ul>{o.items.filter(i => i.cantidad_recibida != null && Number(i.cantidad_recibida) < Number(i.cantidad)).map((i, n) =>
          <li key={n}>{i.sku} · {i.nombre} · Pedidos {i.cantidad} · Recibidos {i.cantidad_recibida ?? 0} · Faltan {Number(i.cantidad) - Number(i.cantidad_recibida ?? 0)}</li>)}</ul>
        <p>{o.nota_recepcion}</p>
        {reposiciones[o.id] && <p>Solicitud para cotizar <Link to={"/app/pedidos?detalle=" + reposiciones[o.id].id} onClick={onClose}>{reposiciones[o.id].codigo}</Link> · Reposición vinculada a esta OC.</p>}
        {canWrite && !reposiciones[o.id] && <button className="btn" disabled={saving} onClick={() => void recotizar(o)}>Cotizar faltantes</button>}
        {canWrite && o.items.some((_, indice) => cantidadSinReintegro(o, indice) > 0) && <button className="btn btn-ghost" disabled={saving} onClick={() => {
          setOrden(o); setOpciones([]); setMonto(''); setMoneda(o.moneda || 'USD');
          setCantidades(Object.fromEntries(o.items.map((_, n) => [n, String(cantidadSinReintegro(o, n))])));
        }}>Solicitar reintegro</button>}
      </div>)}
    </section>}
    {!tesoreria && canWrite && <section className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
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
    <button className="btn btn-ghost" onClick={() => void cargar()} disabled={saving || loading}>Actualizar</button>
    {loading && <p>Cargando…</p>}
    {!loading && !lista.length && <p>No hay reintegros registrados.</p>}
    {lista.map(r => <section key={r.id} className="card" style={{ padding: '1rem', marginTop: '.7rem' }}>
      <strong>{r.ordenes.oc_codigo || r.ordenes.codigo} · {Number(r.monto).toFixed(2)} {r.moneda}</strong>
      <p>{r.estado === 'recibido' ? 'Recibido en Tesorería' : 'Pendiente de devolución'} · {r.motivo}</p>
      {r.generado_por_recepcion && <p className="muted">Generado automáticamente al recibir. Importe de los faltantes al precio unitario de la OC.</p>}
      <ul>{r.detalle.map(d => <li key={d.indice}>{d.sku} · {d.nombre} · {d.cantidad}</li>)}</ul>
      {r.referencia && <p>Referencia {r.referencia}</p>}
      {r.comprobante_url && <button className="btn btn-ghost" onClick={() => void verComprobante(r.comprobante_url!)}>Ver comprobante</button>}
      {tesoreria && canWrite && r.estado === 'pendiente' && <button className="btn btn-primary" disabled={saving} onClick={() => {
        setRecibir(r); setCaja(''); setCuenta('general'); setArchivo(null); setReferencia('');
      }}>Registrar dinero recibido</button>}
      {recibir?.id === r.id && <>
        <label>Caja / cuenta de ingreso ({r.moneda})
          <select className="input" value={caja} onChange={e => setCaja(e.target.value)}>
            <option value="">Seleccionar</option>
            {cajas.filter(c => c.moneda === r.moneda && !c.externo && c.tipo !== 'centro_acopio').map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>Cuenta<select className="input" value={cuenta} onChange={e => setCuenta(e.target.value)}>
          {cuentas.map(c => <option key={c}>{c}</option>)}
        </select></label>
        <label>Referencia<input className="input" value={referencia} onChange={e => setReferencia(e.target.value)} /></label>
        <label>Comprobante (imagen o PDF)<input type="file" accept="image/*,application/pdf" onChange={e => setArchivo(e.target.files?.[0] ?? null)} /></label>
        <button className="btn btn-primary" disabled={saving || !cuentas.length} onClick={() => void confirmar()}>{saving ? 'Registrando…' : 'Confirmar ingreso'}</button>
        <button className="btn btn-ghost" disabled={saving} onClick={() => setRecibir(null)}>Volver</button>
      </>}
    </section>)}
  </Modal>;
}
