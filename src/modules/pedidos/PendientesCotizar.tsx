import { DetalleCompraTarjeta } from './DetalleCompraTarjeta';
import { ContextoCompraTarjeta, type OrdenTarjeta } from './ContextoCompraTarjeta';
import { PaginasCompras, POR_PAGINA_COMPRAS } from './ComprasListaCompacta';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { mensajeError } from '@/shared/lib/errores';
import { useRealtime } from '@/shared/lib/useRealtime';
import { Modal } from '@/shared/ui/Modal';
import type { ItemOrden } from '@/shared/lib/types';

interface PendienteCotizar {
  id: string;
  codigo: string;
  items: ItemOrden[];
  notas: string | null;
  cotizacion_pendiente_origen_id: string | null;
  created_at: string;
}

export function PendientesCotizar({ origenId, compacto = false }: { origenId?: string; compacto?: boolean }) {
  const [open, setOpen] = useState(false);
  const [ordenesOrigen, setOrdenesOrigen] = useState<Record<string, OrdenTarjeta>>({});
  const [lista, setLista] = useState<PendienteCotizar[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const filas = await todasLasFilas<PendienteCotizar>((desde, hasta) =>
        supabase.rpc('compras_pendientes_cotizar')
          .order('created_at', { ascending: false }).order('id').range(desde, hasta));
      const seleccionadas = origenId ? filas.filter(f => f.cotizacion_pendiente_origen_id === origenId) : filas;
      const ids = [...new Set(seleccionadas.flatMap(f => f.cotizacion_pendiente_origen_id ? [f.cotizacion_pendiente_origen_id] : []))];
      const origenes: OrdenTarjeta[] = [];
      for (let n = 0; n < ids.length; n += 50) {
        const { data, error: errorOrigen } = await supabase.from('ordenes').select('*,proveedores(razon_social)').in('id', ids.slice(n, n + 50));
        if (errorOrigen) throw errorOrigen;
        origenes.push(...(data || []) as OrdenTarjeta[]);
      }
      setOrdenesOrigen(Object.fromEntries(origenes.map(o => [o.id, o])));
      setLista(seleccionadas);
      setError('');
    } catch (e) { setError(mensajeError(e, 'No se pudieron cargar los pendientes de cotizar')); }
    finally { setLoading(false); }
  }, [origenId]);

  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['ordenes'], () => { void cargar(); });

  const visibles = useMemo(() => {
    const texto = buscar.trim().toLocaleLowerCase();
    return texto ? lista.filter(f =>
      [f.codigo, f.notas, ...f.items.map(i => i.sku + ' ' + i.nombre)]
        .join(' ').toLocaleLowerCase().includes(texto)) : lista;
  }, [buscar, lista]);

  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(visibles.length / POR_PAGINA_COMPRAS)));
  const inicio = (paginaActual - 1) * POR_PAGINA_COMPRAS;

  return <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
    <button className={compacto ? "badge warning" : "btn btn-ghost"} style={compacto ? { cursor: 'pointer' } : undefined} onClick={(e) => { e.stopPropagation(); setOpen(true); }} onKeyDown={(e) => e.stopPropagation()}>
      {compacto ? 'Cotizar pendientes' : 'Pendientes de cotizar'}{!loading && !error ? ' (' + lista.reduce((total, f) => total + f.items.length, 0) + ' productos)' : ''}
    </button>
    {open && <Modal title="Pendientes de cotizar" onClose={() => setOpen(false)}>
      <div className="compras-panel">
      <p className="muted">Solo productos no comprados o no recibidos de una OC. Abre una solicitud para cargar las ofertas.</p>
      <div className="compras-barra">
      <input className="input" placeholder="Buscar solicitud, OC o producto…" value={buscar} onChange={e => { setBuscar(e.target.value); setPagina(1); }} aria-label="Buscar pendientes de cotizar" />
      <button className="btn btn-ghost" disabled={loading} onClick={() => void cargar()}>Actualizar</button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      {loading && <p>Cargando…</p>}
      {!loading && !error && !visibles.length && <p>No hay pendientes que coincidan.</p>}
      <div className="compras-tarjetas">{visibles.slice(inicio, inicio + POR_PAGINA_COMPRAS).map(f => <article className="card compras-tarjeta" key={f.id}>
        <header><strong>{f.codigo}</strong><span className="badge warning">{f.items.length} productos</span><span className="muted">Por cotizar</span></header>
        <DetalleCompraTarjeta orden={ordenesOrigen[f.cotizacion_pendiente_origen_id || '']} titulo={"Pendientes de cotizar · " + f.codigo}>
        <ContextoCompraTarjeta orden={ordenesOrigen[f.cotizacion_pendiente_origen_id || '']} titulo="Productos pendientes de cotizar" estado={'Por cotizar · ' + f.codigo} detalle={[...f.items.map(i => `${i.sku} · ${i.nombre} · Pendiente ${i.cantidad} ${i.unidad}`), 'Motivo del almacenista: ' + (ordenesOrigen[f.cotizacion_pendiente_origen_id || '']?.nota_recepcion || 'Sin observación registrada')]} />
        {ordenesOrigen[f.cotizacion_pendiente_origen_id || '']?.nota_recepcion && <p className="compras-motivo"><strong>👷 Motivo del almacenista:</strong> {ordenesOrigen[f.cotizacion_pendiente_origen_id || ''].nota_recepcion}</p>}
        <div className="compras-detalle">
        {f.notas && <p>{f.notas}</p>}
        <details className="compras-fila" open><summary>📦 Productos pendientes</summary><table className="compras-productos"><thead><tr><th>Producto</th><th>Cantidad</th></tr></thead><tbody>{f.items.map((i, n) => <tr key={n}><td>{i.nombre}<small>{i.sku}</small></td><td>{i.cantidad} {i.unidad}</td></tr>)}</tbody></table></details>
        <div className="compras-acciones">
        <Link className="btn btn-primary" to={'/app/pedidos?tab=oc&detalle=' + f.id} onClick={() => setOpen(false)}>Abrir solicitud para cotizar</Link>
        {f.cotizacion_pendiente_origen_id && <Link className="btn btn-ghost" to={'/app/pedidos?tab=oc&detalle=' + f.cotizacion_pendiente_origen_id} onClick={() => setOpen(false)}>Ver OC de origen</Link>}
        </div></div>
      </DetalleCompraTarjeta></article>)}</div>
      <PaginasCompras total={visibles.length} pagina={paginaActual} onChange={setPagina} />
      </div>
    </Modal>}
  </span>;
}
