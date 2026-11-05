/* ============================================================
   MGG · RRHH · 📤 Cargar una minuta ya hecha (05-11-2026)
   ============================================================ */
import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { FechaVe } from '@/shared/ui/FechaVe';
import type { Minuta } from '@/shared/lib/types';
import { ACEPTA_ADJUNTO } from './minutaAdjuntos.repository';
import { cargarMinutaExistente, errorMinutaCargada, type MinutaACargar } from './minutaCargada.repository';

export function CargarMinutaModal({ actor, onClose, onCargada }: { actor: string; onClose: () => void; onCargada: (m: Minuta) => void }) {
  const [f, setF] = useState<MinutaACargar>({
    numero: '', fecha: '', lugar: '', hora_inicio: '', objetivo: '', participantes: '', observaciones: '', archivos: [],
  });
  const [guardando, setGuardando] = useState(false);
  const set = <K extends keyof MinutaACargar>(k: K, v: MinutaACargar[K]) => setF((x) => ({ ...x, [k]: v }));

  async function guardar() {
    const err = errorMinutaCargada(f);
    if (err) { toast(err, 'error'); return; }
    setGuardando(true);
    try {
      const m = await cargarMinutaExistente(f, actor);
      toast(`Minuta ${m.numero} cargada`, 'success');
      onCargada(m);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar la minuta', 'error'); }
    finally { setGuardando(false); }
  }

  return (
    <Modal title="📤 Cargar una minuta ya hecha" size="lg" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
      <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Cargando…' : '📤 Cargar minuta'}</button>
    </>}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Para minutas que ya existen en papel o en PDF: se guardan con su archivo, se ven en vista previa y se encuentran con los filtros.
      </p>
      <div className="form-grid">
        <div className="form-row">
          <label>N.º de la minuta</label>
          <input className="input mono" value={f.numero} onChange={(e) => set('numero', e.target.value)} placeholder="El del documento (vacío = correlativo)" />
        </div>
        <div className="form-row"><label>Fecha de la reunión *</label><FechaVe value={f.fecha} onChange={(v) => set('fecha', v)} futuro={false} /></div>
        <div className="form-row"><label>Lugar</label><input className="input" value={f.lugar} onChange={(e) => set('lugar', e.target.value)} /></div>
        <div className="form-row"><label>Hora</label><input className="input" type="time" value={f.hora_inicio} onChange={(e) => set('hora_inicio', e.target.value)} /></div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label>Tema u objetivo *</label>
          <input className="input" value={f.objetivo} onChange={(e) => set('objetivo', e.target.value)} placeholder="De qué se trató la reunión" />
        </div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label>Participantes</label>
          <textarea className="input" rows={2} value={f.participantes} onChange={(e) => set('participantes', e.target.value)} placeholder="Nombres separados por coma o uno por renglón (sirve para filtrar)" />
        </div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label>Observaciones</label>
          <textarea className="input" rows={2} value={f.observaciones} onChange={(e) => set('observaciones', e.target.value)} />
        </div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label>Archivo de la minuta * (PDF o fotos)</label>
          <input className="input" type="file" multiple accept={ACEPTA_ADJUNTO} onChange={(e) => set('archivos', Array.from(e.target.files ?? []))} />
          {f.archivos.length > 0 && <small className="muted">{f.archivos.map((a) => a.name).join(' · ')}</small>}
        </div>
      </div>
    </Modal>
  );
}
