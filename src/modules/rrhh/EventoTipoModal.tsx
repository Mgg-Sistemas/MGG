/* ============================================================
   MGG · RRHH · Modales de Administrativo (20-11-2026)

   En Administrativo ya no se llena nada en línea: se elige trabajador y
   tipo, y este modal muestra el formulario que le toca a ese tipo.
   Fechas siempre en dd/mm/aaaa (Venezuela), con el componente FechaVe.
   ============================================================ */
import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { FechaVe } from '@/shared/ui/FechaVe';
import { toast } from '@/shared/ui/Toast';
import type { Personal } from '@/shared/lib/types';
import { crearEvento } from './eventos.repository';
import type { Empresa } from './empresa';
import { diasInclusivePermiso, hoyIsoPermiso } from './permisoLaboral';

const TITULOS: Record<'vacacion' | 'utilidad' | 'nota', string> = {
  vacacion: '🏖 Registrar vacaciones',
  utilidad: '💵 Registrar utilidad / aguinaldo',
  nota: '📝 Registrar nota / historial',
};

export function EventoTipoModal({ tipo, personal, personalId, empresa, actor, actorName, onClose, onGuardado }: {
  tipo: 'vacacion' | 'utilidad' | 'nota';
  personal: Personal[];
  personalId: string;
  empresa: Empresa;
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const trabajador = personal.find((p) => p.id === personalId);
  const [desde, setDesde] = useState(tipo === 'vacacion' ? '' : hoyIsoPermiso());
  const [hasta, setHasta] = useState('');
  const [monto, setMonto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dias = diasInclusivePermiso(desde, hasta);

  function cambiarDesde(v: string) { setDesde(v); }
  function cambiarHasta(v: string) { setHasta(v); }

  async function guardar() {
    setError(null);
    if (!trabajador) { setError('Elegí el trabajador antes de continuar.'); return; }
    if (!desde) { setError('Indicá la fecha.'); return; }
    if (tipo === 'vacacion') {
      if (!hasta) { setError('Indicá la fecha de fin.'); return; }
      if (hasta < desde) { setError('La fecha de fin no puede ser antes de la de inicio.'); return; }
    }
    if (tipo === 'utilidad' && !(Number(monto) > 0)) { setError('Indicá el monto en USD.'); return; }
    if (tipo === 'nota' && !descripcion.trim()) { setError('Escribí la nota.'); return; }

    setGuardando(true);
    try {
      await crearEvento({
        personal_id: trabajador.id,
        tipo,
        fecha_desde: desde,
        fecha_hasta: tipo === 'vacacion' ? hasta : desde,
        dias: tipo === 'vacacion' ? dias || null : null,
        monto: tipo === 'utilidad' ? Number(monto) : null,
        descripcion: descripcion.trim() || null,
      }, actor, actorName);
      toast('Registro guardado', 'success');
      onGuardado();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el registro.');
    } finally { setGuardando(false); }
  }

  return (
    <Modal
      title={TITULOS[tipo]}
      size="lg"
      onClose={() => { if (!guardando) onClose(); }}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>
          {guardando ? 'Guardando…' : '💾 Guardar registro'}
        </button>
      </>}
    >
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.7rem' }}><strong>Revisá:</strong> {error}</div>}

      <div className="card" style={{ padding: '.8rem', marginBottom: '.8rem', background: 'var(--surface-2, transparent)' }}>
        <div className="muted" style={{ fontSize: '.75rem' }}>Trabajador seleccionado</div>
        <strong>{trabajador ? `${trabajador.nombre} ${trabajador.apellido}`.trim() : '—'}</strong>
        {trabajador?.cedula && <span className="muted"> · {trabajador.cedula}</span>}
        <div className="muted" style={{ fontSize: '.75rem', marginTop: '.2rem' }}>Empresa: {empresa}</div>
      </div>

      <div className="form-grid">
        {tipo === 'vacacion' ? (
          <>
            <div className="form-row"><label>Desde</label><FechaVe value={desde} onChange={cambiarDesde} /></div>
            <div className="form-row"><label>Hasta</label><FechaVe value={hasta} onChange={cambiarHasta} /></div>
            <div className="form-row"><label>Días</label><input className="input mono" value={dias || ''} readOnly placeholder="Se calcula solo" /></div>
          </>
        ) : (
          <div className="form-row"><label>Fecha</label><FechaVe value={desde} onChange={cambiarDesde} /></div>
        )}
        {tipo === 'utilidad' && (
          <div className="form-row"><label>Monto (USD)</label><input className="input mono" type="number" min={0} step="any" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
        )}
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label>{tipo === 'nota' ? 'Nota' : 'Descripción'}</label>
          <textarea className="input" rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder={tipo === 'nota' ? 'Detalle del historial' : 'Detalle del registro (opcional)'} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: '.75rem', marginTop: '.6rem' }}>
        Las fechas se escriben como dd/mm/aaaa, como en Venezuela.
      </p>
    </Modal>
  );
}
