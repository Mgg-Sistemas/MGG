/* ============================================================
   Devoluciones de Maquinaria · lado del almacén (12-11-2026, de GT).
   Cuando Maquinaria RECHAZA una entrega, el material vuelve: aparece aquí
   (en el teléfono de Inventario, filtrado por el almacén elegido, y arriba
   en Salidas de la PC) y el almacenista le da entrada al inventario. La
   entrada la hace la base (entrega_mantenimiento_dar_entrada), al mismo
   almacén del que salió. No sale nada si no hay devoluciones pendientes.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { dateTime } from '@/shared/lib/format';
import { devolucionesDeAlmacen, lineaItem, type EntregaAlmacen } from './entregasAlmacen';
import { darEntradaDevolucion, listDevolucionesPendientes } from './entregasAlmacen.repository';
import { FotosSalidaEntrega } from './EntregasAlmacenPanel';

export function DevolucionesMaquinaria({ origen, almacen, puedeDarEntrada = true, compacto = false }: {
  /** Solo las de ese origen (sin origen: todas). */
  origen?: 'telefono' | 'pc';
  /** Teléfono: solo las del almacén elegido arriba. */
  almacen?: string | null;
  puedeDarEntrada?: boolean;
  compacto?: boolean;
}) {
  const [todas, setTodas] = useState<EntregaAlmacen[]>([]);
  const [sel, setSel] = useState<EntregaAlmacen | null>(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const cargar = useCallback(async () => {
    try { setTodas(await listDevolucionesPendientes(origen)); } catch { setTodas([]); }
  }, [origen]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_entregas_almacen'], () => { void cargar(); });
  const lista = useMemo(() => devolucionesDeAlmacen(todas, almacen), [todas, almacen]);

  async function recibir(e: EntregaAlmacen) {
    setGuardando(true);
    try {
      await darEntradaDevolucion(e.id, nota.trim() || null);
      toast(`Devolución ${e.codigo} recibida: el material volvió al inventario.`, 'success');
      setNota('');
      void cargar();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo dar entrada', 'error');
    } finally { setGuardando(false); }
  }

  if (!lista.length) return null;
  return (
    <div className="card" style={{ borderLeft: '4px solid var(--warning)', margin: compacto ? '.6rem 0' : '0 0 1rem', padding: compacto ? '.6rem .75rem' : undefined }}>
      <div style={{ fontWeight: 700, marginBottom: '.5rem' }}>↩ Devoluciones de Maquinaria por recibir · {lista.length}</div>
      <div style={{ display: 'grid', gap: '.6rem' }}>
        {lista.map((e) => (
          <div key={e.id} style={{ borderTop: '1px dashed var(--border)', paddingTop: '.5rem' }}>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <strong className="mono">{e.codigo}</strong>
              <span>{e.equipo_nombre}</span>
              {e.ref_codigo && <span className="muted mono" style={{ fontSize: '.78rem' }}>{e.ref_codigo}</span>}
              <span className="muted" style={{ fontSize: '.78rem', marginLeft: 'auto' }}>{e.atendida_en ? dateTime(e.atendida_en) : ''}</span>
            </div>
            <div style={{ fontSize: '.85rem', margin: '.2rem 0' }}>{e.items.map(lineaItem).join(' · ')}</div>
            <div className="muted" style={{ fontSize: '.82rem' }}>
              Rechazó {e.atendida_por_nombre || e.atendida_por || 'Maquinaria'}: <em>{e.rechazo_motivo}</em>
            </div>
            {!compacto && <FotosSalidaEntrega entrega={e} />}
            {puedeDarEntrada && (
              <div style={{ textAlign: 'right', marginTop: '.4rem' }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={guardando} onClick={() => setSel(e)}>📥 Dar entrada</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {sel && (
        <ConfirmDialog
          title={`Dar entrada · ${sel.codigo}`}
          confirmText="Sí, dar entrada" success
          message={<>
            <p style={{ marginTop: 0 }}>Vuelve al inventario (al mismo almacén del que salió) todo lo que se entregó para <strong>{sel.equipo_nombre}</strong>:</p>
            <ul style={{ margin: '0 0 .6rem', paddingLeft: '1.1rem' }}>{sel.items.map((i, k) => <li key={k}>{lineaItem(i)}{i.almacen ? ` · ${i.almacen}` : ''}</li>)}</ul>
            <input className="input" value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder="Nota (opcional)" aria-label="Nota de la devolución" />
          </>}
          onCancel={() => { setSel(null); setNota(''); }}
          onConfirm={() => { const e = sel; setSel(null); void recibir(e); }}
        />
      )}
    </div>
  );
}
