import { useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { notify } from '@/shared/lib/notify';
import { toast } from '@/shared/ui/Toast';
import { date, money, num } from '@/shared/lib/format';
import { recibirOrdenParcial } from '@/modules/pedidos/pedidos.repository';
import { recibirCompraDirecta, anularCompraDirecta, type CompraDirecta } from '@/modules/pedidos/compras.repository';
import { AlmacenPicker } from './AlmacenPicker';
import type { Almacen, Orden } from '@/shared/lib/types';

/** Sede a la que pertenece un almacén (por su nombre). Si no se encuentra, devuelve
 *  el propio nombre como respaldo. Se usa para mostrar la SEDE en vez del almacén. */
function sedeDeAlmacen(nombre: string | null | undefined, almacenes: Almacen[]): string {
  if (!nombre) return '';
  const a = almacenes.find((x) => x.nombre === nombre);
  return a?.sede?.trim() || nombre;
}

interface RecepcionesPendientesProps {
  ordenes: Orden[];
  /** Compras directas pagadas por Tesorería, pendientes de que el almacenista las reciba. */
  compras?: CompraDirecta[];
  almacenes: Almacen[];
  actor: string;
  actorName?: string | null;
  onRecibida: () => void | Promise<void>;
}

/**
 * Recepciones por recibir: cada orden con mercancía en camino se recibe desde acá,
 * asignando el almacén destino (principal → subalmacén) y la cantidad recibida por
 * ítem. Al confirmar, la mercancía entra al inventario (recibirOrdenParcial).
 * Debajo, las COMPRAS DIRECTAS ya pagadas por Tesorería: el almacenista les da
 * entrada eligiendo el almacén/subalmacén (recibirCompraDirecta).
 */
export function RecepcionesPendientes({ ordenes, compras = [], almacenes, actor, actorName, onRecibida }: RecepcionesPendientesProps) {
  const [recibir, setRecibir] = useState<Orden | null>(null);
  const [recibirCompra, setRecibirCompra] = useState<CompraDirecta | null>(null);
  const [anularCompra, setAnularCompra] = useState<CompraDirecta | null>(null);

  return (
    <>
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
                  <div className="mono" style={{ color: 'var(--primary-3)', fontWeight: 600 }}>{money(o.total, o.moneda)}</div>
                </div>
                {o.almacen_destino && (
                  <div className="muted" style={{ fontSize: '.72rem', marginTop: '.35rem' }}>Sugerido: 🏭 {sedeDeAlmacen(o.almacen_destino, almacenes)}</div>
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

    {/* Compras directas ya pagadas: el almacenista les da entrada eligiendo el almacén. */}
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="card-title">
        <span>🛒 Compras directas por recibir</span>
        <span className="muted mono">{num(compras.length)} compras</span>
      </div>

      {!compras.length ? (
        <EmptyState message="No hay compras directas por recibir. Cuando Tesorería pague una, aparecerá acá para darle entrada al inventario." icon="🛒" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '.75rem' }}>
          {compras.map((c) => {
            const itemsCount = c.items.length;
            const totalUnidades = c.items.reduce((a, it) => a + (Number(it.cantidad) || 0), 0);
            return (
              <div key={c.id} className="card" style={{ margin: 0, padding: '.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.5rem' }}>
                  <div>
                    <div className="mono" style={{ fontWeight: 700 }}>{c.codigo ?? '—'}</div>
                    <div className="muted" style={{ fontSize: '.75rem' }}>{date(c.created_at)}</div>
                  </div>
                  <span className="badge warning">🛒 Directo</span>
                </div>
                <div style={{ marginTop: '.5rem', fontSize: '.82rem' }}>
                  <div><strong>{c.producto_nombre}</strong>{itemsCount > 1 ? <span className="muted"> · {num(itemsCount)} materiales</span> : null}</div>
                  <div className="muted">{num(totalUnidades)} und.{c.pagada_por ? ` · pagó ${c.pagada_por}` : ''}</div>
                  <div className="mono" style={{ color: 'var(--primary-3)', fontWeight: 600 }}>{money(c.gasto, c.moneda)}</div>
                </div>
                {c.almacen && (
                  <div className="muted" style={{ fontSize: '.72rem', marginTop: '.35rem' }}>Sugerido: 🏭 {sedeDeAlmacen(c.almacen, almacenes)}</div>
                )}
                {(() => {
                  // Solo se anula si NO movió dinero: sin egreso de caja y sin cuenta por pagar.
                  const pagada = !!c.caja_mov_id || !!c.credito_cxp_id;
                  return (
                    <div style={{ display: 'flex', gap: '.35rem', marginTop: '.6rem' }}>
                      <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={() => setRecibirCompra(c)}>
                        📦 Recibir / asignar almacén
                      </button>
                      <button className="btn btn-sm btn-danger" disabled={pagada} onClick={() => setAnularCompra(c)}
                        title={pagada
                          ? 'Ya fue pagada o quedó a crédito: revertí primero el pago desde Tesorería'
                          : 'Anular esta compra directa (queda en el histórico)'}>⊘</button>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {anularCompra && (
        <AnularCompraModal
          compra={anularCompra}
          actor={actor}
          onClose={() => setAnularCompra(null)}
          onSaved={async () => { setAnularCompra(null); await onRecibida(); }}
        />
      )}

      {recibirCompra && (
        <RecibirCompraModal
          compra={recibirCompra}
          almacenes={almacenes}
          actor={actor}
          actorName={actorName}
          onClose={() => setRecibirCompra(null)}
          onSaved={async () => { setRecibirCompra(null); await onRecibida(); }}
        />
      )}
    </div>
    </>
  );
}

/* ───────── Modal: ANULAR una compra directa por recibir (deja rastro) ───────── */
function AnularCompraModal({ compra, actor, onClose, onSaved }: {
  compra: CompraDirecta; actor: string; onClose: () => void; onSaved: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!motivo.trim()) { setError('Indicá el motivo de la anulación.'); return; }
    setSaving(true);
    try {
      await anularCompraDirecta(compra, actor, motivo);
      toast(`Compra directa ${compra.codigo ?? ''} anulada`, 'success');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo anular la compra.');
    } finally { setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="anular-compra-form" className="btn btn-danger" disabled={saving || !motivo.trim()}>
        {saving ? 'Anulando…' : '⊘ Anular compra'}
      </button>
    </>
  );

  return (
    <Modal title={`Anular compra directa · ${compra.codigo ?? ''}`} size="sm" onClose={() => { if (!saving) onClose(); }} footer={footer}>
      <form id="anular-compra-form" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
        <p className="muted" style={{ marginTop: 0, fontSize: '.86rem' }}>
          <strong>{compra.producto_nombre}</strong> · {money(compra.gasto, compra.moneda)}<br />
          La compra queda en estado <strong>ANULADA</strong> y sale de “por recibir”. <strong>No</strong> mueve caja ni inventario y <strong>queda en el histórico</strong> con el motivo.
        </p>
        <div className="form-row">
          <label>Motivo de la anulación <span style={{ color: 'var(--danger)' }}>*</span></label>
          <textarea className="input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus
            placeholder="Cargada por error, ya no se requiere, se reemplaza por otra…" />
        </div>
      </form>
    </Modal>
  );
}

/* ───────── Modal: recibir una COMPRA DIRECTA (ver detalle + elegir almacén) ───────── */
function RecibirCompraModal({ compra, almacenes, actor, actorName, onClose, onSaved }: {
  compra: CompraDirecta; almacenes: Almacen[]; actor: string; actorName?: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const items = compra.items ?? [];
  // Almacén destino (Sede → Almacén): se precarga el sugerido de la compra.
  const [almacenFinal, setAlmacenFinal] = useState(compra.almacen ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!almacenFinal) { setError('Elegí la sede y el almacén destino.'); return; }
    setSaving(true);
    try {
      await recibirCompraDirecta({ compra, almacen: almacenFinal, actor, actorName });
      notify(`Compra directa ${compra.codigo ?? ''} recibida → 🏭 ${sedeDeAlmacen(almacenFinal, almacenes)}`, 'success', { link: '#/app/inventario' });
      toast('Materiales ingresados al inventario', 'success');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo recibir la compra directa.');
    } finally { setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="recibir-compra-form" className="btn btn-primary" disabled={saving || !almacenFinal}>
        {saving ? 'Recibiendo…' : 'Confirmar entrada al inventario'}
      </button>
    </>
  );

  return (
    <Modal title={`Recibir compra directa · ${compra.codigo ?? ''}`} size="lg" onClose={onClose} footer={footer}>
      <form id="recibir-compra-form" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <div className="card" style={{ marginBottom: '.6rem', fontSize: '.86rem' }}>
          <div><strong>{compra.producto_nombre}</strong>{compra.proveedor_nombre ? <span className="muted"> · {compra.proveedor_nombre}</span> : null}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>
            Total: <strong className="mono">{money(compra.gasto, compra.moneda)}</strong>{compra.pagada_por ? ` · pagó ${compra.pagada_por}` : ''}
          </div>
        </div>

        {/* Asignación de almacén: Sede → Almacén (subalmacén). Por defecto el general de la sede.
            excluirCasiterita: una compra directa nunca entra a un almacén de casiterita. */}
        <AlmacenPicker value={almacenFinal} onChange={setAlmacenFinal} almacenes={almacenes} required preferirPrincipal excluirCasiterita />
        {almacenFinal && <p className="hint muted" style={{ fontSize: '.8rem', margin: '0 0 .75rem' }}>Los materiales entrarán a: <strong>📦 {almacenFinal}</strong></p>}

        {/* Detalle de la compra: materiales, cantidad y costo unitario */}
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Costo unit.</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
            <tbody>
              {items.map((it, i) => {
                const cant = Number(it.cantidad) || 0;
                const monto = Number(it.gasto) || 0;
                const cu = cant > 0 ? monto / cant : 0;
                return (
                  <tr key={i}>
                    <td>{it.producto_nombre}{it.producto_sku ? <span className="muted"> · {it.producto_sku}</span> : null}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(cant)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(cu, compra.moneda)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(monto, compra.moneda)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </form>
    </Modal>
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
      notify(`Recepción registrada: ${orden.oc_codigo ?? orden.codigo} → 🏭 ${sedeDeAlmacen(almacenFinal, almacenes)}`, 'success', { link: '#/app/inventario' });
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

        {/* Asignación de almacén: Sede → Almacén. Por defecto el general de la sede.
            excluirCasiterita: la mercancía comprada NO puede ir a un almacén de casiterita
            (ese inventario entra por su propio flujo, directo a Los Pinos). */}
        <AlmacenPicker value={almacenFinal} onChange={setAlmacenFinal} almacenes={almacenes} required preferirPrincipal excluirCasiterita />
        {almacenFinal && <p className="hint muted" style={{ fontSize: '.8rem', margin: '0 0 .75rem' }}>La mercancía entrará a: <strong>📦 {almacenFinal}</strong></p>}

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
