/* ============================================================
   MGG · Retenciones · «🧾 OC por retener» (flujo nuevo de compras, 30-10-2026)

   Dos colas, según lo que marcó Compras al indicar el método de pago:
     · Retener ANTES de pagar   → la OC espera acá; al marcarla hecha pasa a Tesorería.
     · Retener DESPUÉS de pagar → Tesorería ya la pagó; falta la retención.
   «✓ Retención hecha» (con nota opcional) llama a `compras_marcar_retencion`.
   Realtime sobre `ordenes`: lo que marca otro usuario o paga Tesorería se ve al instante.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { money, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { listOcPorRetener, marcarRetencionHecha, type ColasOcPorRetener, type OcPorRetener } from './ocPorRetener.repository';

export function OcPorRetenerPanel({ canWrite }: { canWrite: boolean }) {
  const [colas, setColas] = useState<ColasOcPorRetener>({ antes: [], despues: [] });
  const [loading, setLoading] = useState(true);
  const [marcando, setMarcando] = useState<OcPorRetener | null>(null);

  const reload = useCallback(async () => {
    try { setColas(await listOcPorRetener()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron cargar las OC por retener', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useRealtime(['ordenes'], () => { void reload(); });

  if (loading) return <div className="muted" style={{ padding: '1rem' }}>Cargando OC por retener…</div>;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <p className="muted" style={{ margin: 0, fontSize: '.86rem' }}>
        Compras indica al mandar a pagar si la OC se retiene <strong>antes</strong> o <strong>después</strong> de pagar.
        Las de <strong>antes</strong> no aparecen en Tesorería hasta que acá se marque la retención hecha.
      </p>
      <Cola
        titulo="Retener ANTES de pagar"
        ayuda="Al marcarla hecha, la OC pasa a Tesorería para pagar."
        filas={colas.antes}
        vacio="No hay OC esperando retención antes de pagar."
        canWrite={canWrite}
        onMarcar={setMarcando}
      />
      <Cola
        titulo="Retener DESPUÉS de pagar"
        ayuda="Tesorería ya las pagó; falta hacer la retención."
        filas={colas.despues}
        vacio="No hay OC pagadas esperando retención."
        canWrite={canWrite}
        onMarcar={setMarcando}
      />
      {marcando && (
        <MarcarRetencionModal
          fila={marcando}
          onClose={() => setMarcando(null)}
          onDone={async () => { setMarcando(null); await reload(); }}
        />
      )}
    </div>
  );
}

function Cola({ titulo, ayuda, filas, vacio, canWrite, onMarcar }: {
  titulo: string; ayuda: string; filas: OcPorRetener[]; vacio: string; canWrite: boolean;
  onMarcar: (f: OcPorRetener) => void;
}) {
  return (
    <section className="card" style={{ margin: 0 }}>
      <div className="card-title">{titulo}{filas.length ? ` (${filas.length})` : ''}</div>
      <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.5rem' }}>{ayuda}</div>
      {filas.length === 0 ? <EmptyState message={vacio} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>OC</th>
                <th>Proveedor</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Fecha</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const o = f.orden;
                const fecha = o.retencion_momento === 'despues' ? (o.pagada_en ?? o.metodo_pago_en) : o.metodo_pago_en;
                return (
                  <tr key={o.id}>
                    <td className="mono">{o.oc_codigo ?? o.codigo}</td>
                    <td>{f.proveedorNombre}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(o.total, o.moneda)}</td>
                    <td>{fecha ? dateTime(fecha) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {canWrite && (
                        <button className="btn btn-sm btn-primary" onClick={() => onMarcar(f)}>✓ Retención hecha</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MarcarRetencionModal({ fila, onClose, onDone }: {
  fila: OcPorRetener; onClose: () => void; onDone: () => Promise<void> | void;
}) {
  const o = fila.orden;
  const codigo = o.oc_codigo ?? o.codigo;
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);

  async function confirmar() {
    setSaving(true);
    try {
      await marcarRetencionHecha(o.id, nota);
      toast(o.retencion_momento === 'antes'
        ? `OC ${codigo} · retención hecha: ya está en Tesorería para pagar`
        : `OC ${codigo} · retención hecha`, 'success');
      await onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo marcar la retención', 'error');
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Retención hecha · OC ${codigo}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => void confirmar()} disabled={saving}>
            {saving ? 'Guardando…' : '✓ Retención hecha'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        <strong>{fila.proveedorNombre}</strong> · {money(o.total, o.moneda)}
      </p>
      <p className="muted" style={{ fontSize: '.86rem' }}>
        {o.retencion_momento === 'antes'
          ? 'Al confirmar, la OC pasa a Tesorería para pagar.'
          : 'La OC ya está pagada; al confirmar sale de esta lista.'}
      </p>
      <div className="form-row" style={{ margin: 0 }}>
        <label>Nota <span className="muted" style={{ fontWeight: 400 }}>(opcional · ej. «no aplica»)</span></label>
        <input className="input" value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: comprobante 2026-10-000123" />
      </div>
    </Modal>
  );
}
