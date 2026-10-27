import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { ESTADOS_EQUIPO, estadoEfectivo, estadoExigeMotivo, statusDeEstado, type EstadoEquipo } from './flota';
import { cambiarEstadoEquipo } from './flota.repository';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

/** Qué se está haciendo: reportar avería, poner en espera, retirar o devolver a operativa. */
export type ModoEstado = 'averia' | 'espera' | 'retirar' | 'operativa';

const MOTIVOS_RETIRO = ['Vendida', 'Siniestro / accidente', 'Fin de contrato', 'Reparación mayor', 'Chatarra / fin de vida útil', 'Otro'];
const MATERIALES = [
  { id: 'caucho', label: '🛞 Caucho' }, { id: 'aceite', label: '🛢️ Aceite' }, { id: 'filtro', label: '🧴 Filtro' },
  { id: 'repuesto', label: '🔩 Repuesto' }, { id: 'otro', label: '✏️ Otro' },
];

const TITULOS: Record<ModoEstado, string> = {
  averia: '🔴 Reportar avería',
  espera: '⏳ Esperando instrucciones',
  retirar: '⬛ Retirar de servicio',
  operativa: '✅ Volver a operativa',
};

/**
 * Cambia el estado operativo del equipo con su motivo. Antes de guardar muestra
 * qué cambia (estado y status clásico), igual que las demás confirmaciones.
 */
export function EstadoEquipoModal({ equipo, modo, onClose, onSaved }: {
  equipo: MaquinariaEquipo; modo: ModoEstado; onClose: () => void; onSaved: () => void;
}) {
  const actual = estadoEfectivo(equipo);
  const [averia, setAveria] = useState<'averiada' | 'parada'>('averiada');
  const [material, setMaterial] = useState('');
  const [motivo, setMotivo] = useState('');
  const [retiro, setRetiro] = useState(MOTIVOS_RETIRO[0]);
  const [saving, setSaving] = useState(false);

  const destino: EstadoEquipo = modo === 'averia' ? averia : modo === 'espera' ? 'espera' : modo === 'retirar' ? 'retirada' : 'operativa';
  const motivoFinal = modo === 'retirar' ? [retiro, motivo.trim()].filter(Boolean).join(' · ') : motivo.trim();
  const falta = estadoExigeMotivo(destino) && motivoFinal.length < 3;

  async function guardar() {
    if (falta) { toast('Escribe el motivo (al menos 3 letras).', 'warning'); return; }
    setSaving(true);
    try {
      await cambiarEstadoEquipo(equipo.id, destino, motivoFinal || null, modo === 'averia' ? material || null : null);
      toast(`${equipo.equipo}: ${ESTADOS_EQUIPO[destino].label.toLowerCase()}.`, 'success');
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : (e as { message?: string })?.message || 'No se pudo cambiar el estado', 'error');
    } finally { setSaving(false); }
  }

  return (
    <Modal title={`${TITULOS[modo]} · ${equipo.equipo}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className={`btn ${modo === 'retirar' ? 'btn-danger' : 'btn-primary'}`} onClick={() => void guardar()} disabled={saving || falta}>
          {saving ? 'Guardando…' : modo === 'averia' ? 'Reportar' : modo === 'retirar' ? 'Retirar' : 'Confirmar'}
        </button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.8rem' }}>
        {modo === 'averia' && (
          <>
            <div className="form-row">
              <label>¿Cómo quedó el equipo?</label>
              <div className="flo-seg" role="group" aria-label="Cómo quedó el equipo">
                <button type="button" aria-pressed={averia === 'averiada'} onClick={() => setAveria('averiada')}>🔴 Averiada</button>
                <button type="button" aria-pressed={averia === 'parada'} onClick={() => setAveria('parada')}>🟡 Parada</button>
              </div>
            </div>
            <div className="form-row">
              <label>¿Qué hace falta?</label>
              <div className="flo-opt">
                {MATERIALES.map((m) => (
                  <button key={m.id} type="button" className="flo-pill" aria-pressed={material === m.id}
                    onClick={() => setMaterial(material === m.id ? '' : m.id)}>{m.label}</button>
                ))}
              </div>
            </div>
          </>
        )}
        {modo === 'retirar' && (
          <div className="form-row">
            <label>Motivo del retiro</label>
            <div className="flo-opt">
              {MOTIVOS_RETIRO.map((m) => (
                <button key={m} type="button" className="flo-pill" aria-pressed={retiro === m} onClick={() => setRetiro(m)}>{m}</button>
              ))}
            </div>
          </div>
        )}
        <div className="form-row">
          <label htmlFor="flo-motivo">{modo === 'operativa' ? 'Nota (opcional)' : modo === 'retirar' ? 'Detalle' : 'Motivo'}</label>
          <textarea id="flo-motivo" className="textarea" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder={modo === 'averia' ? 'Ej.: se le dañó el gato en operación' : modo === 'espera' ? 'Ej.: sin frente asignado' : modo === 'retirar' ? 'Opcional si el motivo ya lo dice todo' : 'Qué se resolvió'} />
        </div>
        <VistaPrevia titulo="Lo que va a cambiar">
          <Dato label="Equipo">{equipo.equipo}</Dato>
          <Dato label="Estado">{`${ESTADOS_EQUIPO[actual].label} → ${ESTADOS_EQUIPO[destino].label}`}</Dato>
          <Dato label="Status">{`${equipo.status} → ${statusDeEstado(destino)}`}</Dato>
          <Dato label="Motivo">{motivoFinal || undefined}</Dato>
          {modo === 'retirar' && <Dato label="Ojo">Queda inactivo: no se borra nada y se puede reactivar.</Dato>}
        </VistaPrevia>
        {modo === 'averia' && <p className="muted" style={{ fontSize: '.8rem', margin: 0 }}>El taller lo verá en el catálogo y podrá abrir la orden de servicio desde el expediente.</p>}
      </div>
    </Modal>
  );
}
