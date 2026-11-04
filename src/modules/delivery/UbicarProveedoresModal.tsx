/* ============================================================
   MGG · Delivery · «📍 Ubicar proveedores» (03-11-2026)

   Lista para poner en el mapa a los proveedores (primero los que tienen
   pedidos de Delivery, marcando cuáles faltan) y, para quien supervisa,
   los almacenes de entrega LOS PINOS y MATANZA. Cada uno se marca con el
   alfiler (MapaSelector). Sin proveedor ubicado no hay ruta ni distancia.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { MapaSelector } from '@/shared/ui/MapaSelector';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { esRetiro, fechaHoraVE, type PedidoDelivery } from './delivery';
import { guardarDestinoDelivery, listProveedoresUbicacion, ubicarProveedor, type ProveedorUbicacion } from './delivery.repository';
import { CLAVES_DESTINO, puntoDeDestino, type ClaveDestino, type DestinosDelivery, type Punto } from './deliveryRutas';

type Editando = { tipo: 'proveedor'; p: ProveedorUbicacion } | { tipo: 'almacen'; clave: ClaveDestino };

const msg = (e: unknown, d: string) => (e instanceof Error && e.message ? e.message : d);
const ubicado = (p: ProveedorUbicacion) => p.lat !== null && p.lng !== null;
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function UbicarProveedoresModal({ pedidos, destinos, onDestinos, puedeAlmacenes, onClose }: {
  pedidos: PedidoDelivery[];
  destinos: DestinosDelivery;
  onDestinos: (d: DestinosDelivery) => void;
  /** Admin o Delivery full: también ubica los almacenes de entrega. */
  puedeAlmacenes: boolean;
  onClose: () => void;
}) {
  const [lista, setLista] = useState<ProveedorUbicacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [alcance, setAlcance] = useState<'delivery' | 'todos'>('delivery');
  const [soloSin, setSoloSin] = useState(false);
  const [buscar, setBuscar] = useState('');
  const [editando, setEditando] = useState<Editando | null>(null);

  const cargar = useCallback(async () => {
    try { setLista(await listProveedoresUbicacion()); } catch (e) { toast(msg(e, 'No se pudieron leer los proveedores.'), 'error'); } finally { setCargando(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['proveedores'], () => { void cargar(); });

  // Cuántos pedidos de Delivery (por tomar o en curso) tiene cada proveedor.
  const pedidosDe = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pedidos) {
      if (esRetiro(p) || !p.proveedor_id) continue;
      if (!['por_tomar', 'cancelado', 'aceptado', 'en_ruta'].includes(p.estado)) continue;
      m.set(p.proveedor_id, (m.get(p.proveedor_id) ?? 0) + 1);
    }
    return m;
  }, [pedidos]);

  const visibles = useMemo(() => {
    const q = sinAcentos(buscar.trim());
    return lista
      .filter((p) => (alcance === 'delivery' ? pedidosDe.has(p.id) : p.estado !== 'inactivo' || pedidosDe.has(p.id)))
      .filter((p) => !soloSin || !ubicado(p))
      .filter((p) => !q || sinAcentos(`${p.razon_social} ${p.direccion ?? ''}`).includes(q))
      .sort((a, b) => (Number(ubicado(a)) - Number(ubicado(b))) || ((pedidosDe.get(b.id) ?? 0) - (pedidosDe.get(a.id) ?? 0))
        || a.razon_social.localeCompare(b.razon_social, 'es'));
  }, [lista, alcance, soloSin, buscar, pedidosDe]);
  const faltan = lista.filter((p) => pedidosDe.has(p.id) && !ubicado(p)).length;

  async function guardar(p: Punto | null) {
    if (!editando) return;
    try {
      if (editando.tipo === 'proveedor') {
        await ubicarProveedor(editando.p.id, p);
        toast(p ? `${editando.p.razon_social} quedó ubicado en el mapa.` : `Se quitó la ubicación de ${editando.p.razon_social}.`, 'success');
        void cargar();
      } else if (p) {
        onDestinos(await guardarDestinoDelivery(editando.clave, p));
        toast(`Almacén ${editando.clave} ubicado en el mapa.`, 'success');
      }
      setEditando(null);
    } catch (e) {
      toast(msg(e, 'No se pudo guardar la ubicación.'), 'error');
    }
  }

  const inicial: Punto | null = !editando ? null
    : editando.tipo === 'proveedor'
      ? (ubicado(editando.p) ? { lat: Number(editando.p.lat), lng: Number(editando.p.lng) } : null)
      : puntoDeDestino(destinos[editando.clave]);

  return (
    <>
      <Modal title="📍 Ubicar proveedores" size="lg" onClose={onClose}
        footer={<button type="button" className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
        <p className="muted" style={{ marginTop: 0 }}>
          Con el proveedor en el mapa, el delivery ve en su teléfono la distancia, cuál le queda más cerca y la ruta hasta él y de ahí al almacén.
          {faltan > 0 && <> <strong style={{ color: 'var(--warning)' }}>Faltan {faltan} proveedor(es) con pedidos.</strong></>}
        </p>

        {puedeAlmacenes && (
          <div className="card" style={{ marginBottom: '.75rem', padding: '.6rem .8rem' }}>
            <div className="card-title" style={{ fontSize: '.9rem' }}>🏬 Almacenes de entrega</div>
            {CLAVES_DESTINO.map((c) => {
              const d = destinos[c];
              const pt = puntoDeDestino(d);
              return (
                <div key={c} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.3rem 0', flexWrap: 'wrap' }}>
                  <strong style={{ minWidth: 110 }}>{c}</strong>
                  {!pt ? <span className="badge warning">Sin ubicar</span>
                    : d.aproximada ? <span className="badge warning">Aproximada</span> : <span className="badge success">Ubicado</span>}
                  <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
                    onClick={() => setEditando({ tipo: 'almacen', clave: c })}>
                    📍 {pt ? 'Ajustar' : 'Ubicar'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.6rem' }}>
          <button type="button" className={`chip${alcance === 'delivery' ? ' chip-active' : ''}`} aria-pressed={alcance === 'delivery'} onClick={() => setAlcance('delivery')}>
            Con pedidos de Delivery ({pedidosDe.size})
          </button>
          <button type="button" className={`chip${alcance === 'todos' ? ' chip-active' : ''}`} aria-pressed={alcance === 'todos'} onClick={() => setAlcance('todos')}>
            Todos los activos
          </button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem' }}>
            <input type="checkbox" checked={soloSin} onChange={(e) => setSoloSin(e.target.checked)} /> Solo sin ubicar
          </label>
          <input className="input" style={{ maxWidth: 240, marginLeft: 'auto' }} placeholder="Buscar proveedor…" value={buscar}
            onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar proveedor" />
        </div>

        {cargando ? <p className="muted">Cargando…</p> : !visibles.length ? (
          <p className="muted">{alcance === 'delivery' ? 'Ningún proveedor tiene pedidos de Delivery por ahora.' : 'No hay proveedores con ese filtro.'}</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr><th>Proveedor</th><th>Pedidos</th><th>Mapa</th><th /></tr></thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.razon_social}</strong>{p.direccion && <div className="muted" style={{ fontSize: '.75rem' }}>📍 {p.direccion}</div>}</td>
                    <td>{pedidosDe.get(p.id) ?? <span className="muted">—</span>}</td>
                    <td>
                      {ubicado(p)
                        ? <><span className="badge success">Ubicado</span>{p.ubicado_en && <div className="muted" style={{ fontSize: '.72rem' }}>{fechaHoraVE(p.ubicado_en)}{p.ubicado_por ? ` · ${p.ubicado_por}` : ''}</div>}</>
                        : <span className="badge warning">Sin ubicar</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditando({ tipo: 'proveedor', p })}>
                        📍 {ubicado(p) ? 'Mover' : 'Ubicar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {editando && (
        <MapaSelector
          titulo={editando.tipo === 'proveedor' ? `📍 ${editando.p.razon_social}` : `🏬 Almacén ${editando.clave}`}
          subtitulo={editando.tipo === 'proveedor' && editando.p.direccion ? `Dirección: ${editando.p.direccion}` : undefined}
          inicial={inicial}
          permitirQuitar={editando.tipo === 'proveedor'}
          onCerrar={() => setEditando(null)}
          onGuardar={guardar}
        />
      )}
    </>
  );
}
