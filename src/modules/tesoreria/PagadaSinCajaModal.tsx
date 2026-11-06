/* ============================================================
   MGG · Tesorería · Marcar OC pagada SIN descontar de caja (06-11-2026)
   Con el motivo (obligatorio) y, si hay, el comprobante. No mueve ninguna caja;
   la orden sigue el flujo de siempre (delivery y recepción en el almacén).
   ============================================================ */
import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import type { Orden } from '@/shared/lib/types';
import { errorPagoSinCaja, marcarPagadaSinCaja } from '@/modules/pedidos/pedidos.repository';

const MOTIVOS = [
  'La pagó otra empresa del grupo',
  'La pagó un tercero / la persona que la pidió',
  'Ya estaba pagada fuera del sistema',
  'Pago con material / intercambio',
];

export function PagadaSinCajaModal({ orden, actor, onClose, onHecho }: {
  orden: Orden; actor: string; onClose: () => void; onHecho: (o: Orden, motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [factura, setFactura] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codigo = orden.oc_codigo ?? orden.codigo;

  async function confirmar() {
    const e = errorPagoSinCaja(motivo);
    if (e) { setError(e); return; }
    setSaving(true); setError(null);
    try {
      const o = await marcarPagadaSinCaja({ orden, motivo, factura, actorEmail: actor });
      onHecho(o, motivo.trim());
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo marcar pagada'); setSaving(false); }
  }

  return (
    <Modal title={`Marcar pagada sin descontar de caja · ${codigo}`} size="md" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={() => void confirmar()} disabled={saving || !!errorPagoSinCaja(motivo)}>
        {saving ? 'Guardando…' : '✓ Marcar pagada sin caja'}
      </button>
    </>}>
      <div className="aviso info" style={{ marginBottom: '.8rem' }}>
        <span className="aviso-icono">ℹ</span>
        <div>
          La orden queda <strong>pagada</strong> pero <strong>no se descuenta dinero de ninguna caja</strong>. Sigue el flujo de siempre:
          va al delivery (o a carga pesada) y se recibe en el almacén. Queda escrito el motivo en su trazabilidad.
        </div>
      </div>
      <div className="form-row">
        <label>¿Por qué no se descuenta de una caja? *</label>
        <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginBottom: '.4rem' }}>
          {MOTIVOS.map((m) => (
            <button key={m} type="button" className={`btn btn-sm ${motivo === m ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMotivo(m)}>{m}</button>
          ))}
        </div>
        <textarea className="input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Escribe el motivo…" />
      </div>
      <div className="form-row">
        <label>Comprobante (opcional)</label>
        <input className="input" type="file" accept="image/*,application/pdf" onChange={(e) => setFactura(e.target.files?.[0] ?? null)} />
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: '.85rem' }}>{error}</p>}
    </Modal>
  );
}
