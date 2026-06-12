import { useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { notify } from '@/shared/lib/notify';
import { money } from '@/shared/lib/format';
import type { Almacen, Caja } from '@/shared/lib/types';
import { crearSolicitudSalida } from './salidas.repository';
import { DestinoSelect } from './DestinoSelect';

export function SalidaDineroForm({
  cajas, almacenesObj, actor, actorName, onClose, onSaved,
}: {
  cajas: Caja[];
  almacenesObj: Almacen[];
  actor: string;
  actorName?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activas = useMemo(() => cajas.filter((c) => c.estado === 'activo'), [cajas]);

  const [cajaId, setCajaId] = useState(activas[0]?.id ?? '');
  const [destino, setDestino] = useState('');
  const [motivo, setMotivo] = useState('');
  const [monto, setMonto] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const caja = activas.find((c) => c.id === cajaId) ?? null;
  const saldo = Number(caja?.saldo) || 0;
  const montoNum = Number(monto) || 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cajaId) { setError('Elegí la caja.'); return; }
    if (montoNum <= 0) { setError('El monto debe ser mayor que 0.'); return; }
    if (montoNum > saldo) { setError(`Saldo insuficiente. Disponible: ${money(saldo)} ${caja?.moneda}.`); return; }
    if (!destino.trim()) { setError('Indicá a quién va dirigido el dinero.'); return; }
    setSaving(true);
    try {
      await crearSolicitudSalida({
        scope: 'salida', tipo: 'dinero',
        cajaId, monto: montoNum, moneda: caja?.moneda ?? null, destino: destino.trim(),
        motivo: motivo.trim() || null, solicitante: actorName || actor, actor, actorName,
      });
      notify(`Solicitud de salida de dinero creada: ${money(montoNum)} ${caja?.moneda} → ${destino} · queda Por aprobar`, 'success', { link: '#/app/salidas' });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la solicitud.');
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="salida-dinero-form" className="btn btn-primary" disabled={saving}>
        {saving ? 'Creando…' : 'Crear solicitud'}
      </button>
    </>
  );

  return (
    <Modal title="Nueva solicitud de salida de dinero" size="lg" onClose={onClose} footer={footer}>
      <form id="salida-dinero-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <div className="card" style={{ padding: '.6rem .85rem', marginBottom: '.75rem', background: 'var(--bg-1)', borderLeft: '3px solid var(--primary)' }}>
          <div className="muted" style={{ fontSize: '.78rem' }}>
            La salida de dinero es un anticipo: queda <strong>pendiente</strong> hasta conciliarla con la recepción del mineral equivalente.
          </div>
        </div>

        <div className="form-row">
          <label>Caja</label>
          <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
            {!activas.length && <option value="">— sin cajas activas —</option>}
            {activas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.moneda} · saldo {money(Number(c.saldo) || 0)}</option>)}
          </select>
          {caja && <small className="muted">Saldo disponible: <strong className="mono">{money(saldo)} {caja.moneda}</strong></small>}
        </div>

        <DestinoSelect value={destino} onChange={setDestino} almacenes={almacenesObj} label="A quién va dirigido el dinero" permitirAlmacen={false} />

        <div className="form-grid">
          <div className="form-row">
            <label>Monto ({caja?.moneda ?? '—'})</label>
            <input className="input mono" type="number" min={0} step="any" value={monto} onChange={(e) => setMonto(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Saldo resultante</label>
            <input className="input mono" value={money(Math.max(0, saldo - montoNum))} readOnly tabIndex={-1} />
          </div>
        </div>

        <div className="form-row">
          <label>Motivo</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la salida de dinero…" />
        </div>
      </form>
    </Modal>
  );
}
