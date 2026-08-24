import { useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { notify } from '@/shared/lib/notify';
import { money } from '@/shared/lib/format';
import { enterAvanzaCampo } from '@/shared/lib/navegacionEnter';
import type { Caja } from '@/shared/lib/types';
import { crearSolicitudSalida } from './salidas.repository';

export function TrasladoDineroForm({
  cajas, actor, actorName, onClose, onSaved,
}: {
  cajas: Caja[];
  actor: string;
  actorName?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activas = useMemo(() => cajas.filter((c) => c.estado === 'activo'), [cajas]);

  const [origenId, setOrigenId] = useState(activas[0]?.id ?? '');
  const origen = activas.find((c) => c.id === origenId) ?? null;
  // El destino debe ser otra caja de la MISMA moneda.
  const destinos = useMemo(
    () => activas.filter((c) => c.id !== origenId && c.moneda === origen?.moneda),
    [activas, origenId, origen],
  );
  const [destinoId, setDestinoId] = useState(destinos[0]?.id ?? '');
  const [monto, setMonto] = useState('0');
  const [motivo, setMotivo] = useState('');
  const [notaOn, setNotaOn] = useState(false);
  const [notaTexto, setNotaTexto] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si cambió el origen y el destino ya no aplica, reseteamos.
  const destinoValido = destinos.some((c) => c.id === destinoId) ? destinoId : (destinos[0]?.id ?? '');
  const saldo = Number(origen?.saldo) || 0;
  const montoNum = Number(monto) || 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Enter en el último campo usa requestSubmit(), que ignora el botón deshabilitado:
    // sin esta guarda, dos Enter seguidos crearían dos traslados.
    if (saving) return;
    setError(null);
    if (!origenId || !destinoValido) { setError('Elegí caja origen y destino (misma moneda).'); return; }
    if (montoNum <= 0) { setError('El monto debe ser mayor que 0.'); return; }
    if (montoNum > saldo) { setError(`Saldo insuficiente. Disponible: ${money(saldo)} ${origen?.moneda}.`); return; }
    setSaving(true);
    try {
      const dest = activas.find((c) => c.id === destinoValido);
      await crearSolicitudSalida({
        scope: 'traslado', tipo: 'dinero',
        cajaId: origenId, cajaDestinoId: destinoValido, monto: montoNum, moneda: origen?.moneda ?? null,
        destino: dest?.nombre ?? null, motivo: motivo.trim() || null,
        notaEntrega: notaOn ? (notaTexto.trim() || null) : null,
        solicitante: actorName || actor, actor, actorName,
      });
      notify(`Solicitud de traslado de dinero creada: ${money(montoNum)} ${origen?.moneda} · ${origen?.nombre} → ${dest?.nombre} · queda Por aprobar`, 'success', { link: '#/app/salidas' });
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
      <button type="submit" form="traslado-dinero-form" className="btn btn-primary" disabled={saving}>
        {saving ? 'Creando…' : 'Crear solicitud'}
      </button>
    </>
  );

  return (
    <Modal title="Nueva solicitud de traslado de dinero" size="lg" onClose={onClose} footer={footer}>
      <form id="traslado-dinero-form" onSubmit={handleSubmit} onKeyDown={enterAvanzaCampo({ enviando: saving })}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <div className="form-grid">
          <div className="form-row">
            <label>Caja origen</label>
            <select className="select" value={origenId} onChange={(e) => setOrigenId(e.target.value)}>
              {!activas.length && <option value="">— sin cajas —</option>}
              {activas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.moneda} · {money(Number(c.saldo) || 0)}</option>)}
            </select>
            {origen && <small className="muted">Saldo: <strong className="mono">{money(saldo)} {origen.moneda}</strong></small>}
          </div>
          <div className="form-row">
            <label>Caja destino (misma moneda)</label>
            <select className="select" value={destinoValido} onChange={(e) => setDestinoId(e.target.value)}>
              {!destinos.length && <option value="">— no hay otra caja en {origen?.moneda} —</option>}
              {destinos.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {money(Number(c.saldo) || 0)}</option>)}
            </select>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Monto ({origen?.moneda ?? '—'})</label>
            <input className="input mono" type="number" min={0} step="any" value={monto} onChange={(e) => setMonto(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Motivo (opcional)</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del traslado…" />
          </div>
        </div>

        <div className="form-row">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={notaOn} onChange={(e) => setNotaOn(e.target.checked)} />
            Nota de entrega
          </label>
          {notaOn && (
            <textarea className="input" rows={2} value={notaTexto} onChange={(e) => setNotaTexto(e.target.value)}
              placeholder="Escribí el motivo / detalle de la nota de entrega…" style={{ marginTop: '.4rem' }} />
          )}
          {notaOn && <small className="muted">Este texto se imprime en el PDF del traslado como “Nota de entrega”.</small>}
        </div>
      </form>
    </Modal>
  );
}
