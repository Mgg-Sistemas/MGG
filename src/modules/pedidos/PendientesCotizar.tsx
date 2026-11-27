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

export function PendientesCotizar({ origenId }: { origenId?: string }) {
  const [open, setOpen] = useState(false);
  const [lista, setLista] = useState<PendienteCotizar[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [buscar, setBuscar] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const filas = await todasLasFilas<PendienteCotizar>((desde, hasta) =>
        supabase.rpc('compras_pendientes_cotizar')
          .order('created_at', { ascending: false }).order('id').range(desde, hasta));
      setLista(origenId ? filas.filter(f => f.cotizacion_pendiente_origen_id === origenId) : filas);
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

  return <>
    <button className="btn btn-ghost" onClick={() => setOpen(true)}>
      Pendientes de cotizar{!loading && !error ? ' (' + lista.reduce((total, f) => total + f.items.length, 0) + ' productos)' : ''}
    </button>
    {open && <Modal title="Pendientes de cotizar" onClose={() => setOpen(false)}>
      <p>Productos que quedan por comprar. Abre la solicitud para cargar o elegir una cotización.</p>
      <input className="input" placeholder="Buscar solicitud, OC o producto…" value={buscar} onChange={e => setBuscar(e.target.value)} aria-label="Buscar pendientes de cotizar" />
      <button className="btn btn-ghost" disabled={loading} onClick={() => void cargar()}>Actualizar</button>
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      {loading && <p>Cargando…</p>}
      {!loading && !error && !visibles.length && <p>No hay pendientes que coincidan.</p>}
      {visibles.map(f => <section className="card" key={f.id} style={{ padding: '1rem', marginTop: '.6rem' }}>
        <strong>{f.codigo}</strong>
        {f.notas && <p>{f.notas}</p>}
        <ul>{f.items.map((i, n) => <li key={n}>{i.sku} · {i.nombre} · {i.cantidad} {i.unidad}</li>)}</ul>
        <Link className="btn btn-primary" to={'/app/pedidos?detalle=' + f.id} onClick={() => setOpen(false)}>Abrir solicitud para cotizar</Link>
        {f.cotizacion_pendiente_origen_id && <Link className="btn btn-ghost" to={'/app/pedidos?detalle=' + f.cotizacion_pendiente_origen_id} onClick={() => setOpen(false)}>Ver OC de origen</Link>}
      </section>)}
    </Modal>}
  </>;
}
