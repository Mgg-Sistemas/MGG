import { useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { notify } from '@/shared/lib/notify';
import { date, money, num } from '@/shared/lib/format';
import { recibirOrdenParcial } from '@/modules/pedidos/pedidos.repository';
import { AlmacenPicker } from './AlmacenPicker';
import type { Almacen, Orden } from '@/shared/lib/types';

interface RecepcionesPendientesProps {
  ordenes: Orden[];
  almacenes: Almacen[];
  actor: string;
  actorName?: string | null;
  onRecibida: () => void | Promise<void>;
}

/**
 * Recepciones por recibir: cada orden con mercancía en camino se recibe desde acá,
 * asignando el almacén destino (principal → subalmacén) y la cantidad recibida por
 * ítem. Al confirmar, la mercancía entra al inventario (recibirOrdenParcial).
 */
export function RecepcionesPendientes({ ordenes, almacenes, actor, actorName, onRecibida }: RecepcionesPendientesProps) {
  const [recibir, setRecibir] = useState<Orden | null>(null);

  return (
    <div className="card">
      <div className="card-title">
        <span>Recepciones por recibir</span>
        <span className="muted mono">{num(ordenes.length)} órdenes</span>
      </div>

      {!ordenes.length ? (
        <EmptyState message="No hay mercancía por recibir. Cuando llegue una orden, aparecerá acá para asignarle el almacén." icon="📦" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '.75rem' }}>
          {ordenes.map((o) => {
            const itemsCount = Array.isArray(o.items) ? o.items.length : 0;
            const totalUnidades = Array.isArray(o.items) ? o.items.reduce((a, it) => a + (Number(it.cantidad) || 0), 0) : 0;
            return (
              <div key={o.id} className="card" style={{ margin: 0, padding: '.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.5rem' }}>
                  <div>
                    <div className="mono" style={{ fontWeight: 700 }}>{o.oc_codigo ?? o.codigo}</div>
                    <div className="muted" style={{ fontSize: '.75rem' }}>{date(o.created_at)}</div>
                  </div>
                  <StatusBadge estado={o.estado} />
                </div>
                <div style={{ marginTop: '.5rem', fontSize: '.82rem' }}>
                  <div>{num(itemsCount)} ítem{itemsCount !== 1 ? 's' : ''} · {num(totalUnidades)} und.</div>
                  <div className="mono" style={{ color: 'var(--primary-3)', fontWeight: 600 }}>{money(o.total)}</div>
                </div>
                {o.almacen_destino && (
                  <div className="muted" style={{ fontSize: '.72rem', marginTop: '.35rem' }}>Sugerido: 📦 {o.almacen_destino}</div>
                )}
                <button className="btn btn-sm btn-primary" style={{ marginTop: '.6rem', width: '100%' }} onClick={() => setRecibir(o)}>
                  📦 Recibir / asignar almacén
                </button>
              </div>
            );
          })}
        </div>
      )}

      {recibir && (
        <RecibirModal
          orden={recibir}
          almacenes={almacenes}
          actor={actor}
          actorName={actorName}
          onClose={() => setRecibir(null)}
          onSaved={async () => { setRecibir(null); await onRecibida(); }}
        />
      )}
    </div>
  );
}

/* ───────── Modal: recibir + asignar almacén (principal → subalmacén) ───────── */
function RecibirModal({ orden, almacenes, actor, actorName, onClose, onSaved }: {
  orden: Orden; almacenes: Almacen[]; actor: string; actorName?: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const items = Array.isArray(orden.items) ? orden.items : [];

  // Almacén destino (se elige por Sede → Almacén).
  const [almacenFinal, setAlmacenFinal] = useState('');
  // Cantidad recibida por ítem (por defecto, lo pedido).
  const [recibidas, setRecibidas] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map((it) => [it.sku, String(it.cantidad ?? 0)])),
  );
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const huboDiferencia = items.some((it) => (Number(recibidas[it.sku]) || 0) !== Number(it.cantidad));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!almacenFinal) { setError('Elegí la sede y el almacén destino.'); return; }
    const recepciones = items.map((it) => ({ sku: it.sku, cantidad_recibida: Math.max(0, Number(recibidas[it.sku]) || 0) }));
    for (const it of items) {
      const rec = Number(recibidas[it.sku]) || 0;
      if (rec > Number(it.cantidad)) { setError(`No podés recibir más de lo pedido en ${it.sku}.`); return; }
    }
    if (recepciones.every((r) => r.cantidad_recibida <= 0)) { setError('Indicá al menos una cantidad recibida.'); return; }
    if (huboDiferencia && !nota.trim()) { setError('Hay diferencias con lo pedido: indicá una nota explicando.'); return; }
    setSaving(true);
    try {
      await recibirOrdenParcial(orden, recepciones, nota.trim() || null, actor, actorName ?? null, almacenFinal);
      notify(`Recepción registrada: ${orden.oc_codigo ?? orden.codigo} → 📦 ${almacenFinal}`, 'success', { link: '#/app/inventario' });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la recepción.');
    } finally { setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="recibir-form" className="btn btn-primary" disabled={saving || !almacenFinal}>
        {saving ? 'Recibiendo…' : 'Confirmar recepción'}
      </button>
    </>
  );

  return (
    <Modal title={`Recibir ${orden.oc_codigo ?? orden.codigo}`} size="lg" onClose={onClose} footer={footer}>
      <form id="recibir-form" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        {/* Asignación de almacén: Sede → Almacén */}
        <AlmacenPicker value={almacenFinal} onChange={setAlmacenFinal} almacenes={almacenes} required />
        {almacenFinal && <p className="muted" style={{ fontSize: '.8rem', margin: '0 0 .75rem' }}>La mercancía entrará a: <strong>📦 {almacenFinal}</strong></p>}

        {/* Cantidades recibidas por ítem */}
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Pedido</th><th style={{ width: 140 }}>Recibido</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.sku}>
                  <td>{it.nombre ?? it.sku}<span className="muted"> · {it.sku}</span></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(Number(it.cantidad) || 0)}</td>
                  <td>
                    <input className="input mono" type="number" min={0} max={Number(it.cantidad) || undefined} step="any"
                      value={recibidas[it.sku] ?? ''} onChange={(e) => setRecibidas((m) => ({ ...m, [it.sku]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="form-row" style={{ marginTop: '.6rem' }}>
          <label>Nota {huboDiferencia ? '(obligatoria: hay diferencia con lo pedido)' : '(opcional)'}</label>
          <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)}
            placeholder="Diferencia de cantidades, faltantes, observaciones…" />
        </div>
      </form>
    </Modal>
  );
}
