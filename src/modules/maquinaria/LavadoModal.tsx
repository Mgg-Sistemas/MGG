import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum, dateTime } from '@/shared/lib/format';
import { TIPOS_LAVADO, textoHace, diasDesde, tipoLavadoValido } from './flota';
import { registrarLavado, actualizarLavado, type LavadoEquipo } from './flota.repository';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

/** «2026-10-09T14:30» en hora local, para el input datetime-local. */
function aLocal(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const OTRO = '__otro__';

/** Registrar (o con `lavado`, editar) un lavado del equipo: tipo, cuándo, quién y la lectura de ese momento. */
export function LavadoModal({ equipo, horometro, km, ultimo, actor, lavado, onClose, onSaved }: {
  equipo: MaquinariaEquipo;
  horometro: number | null;
  km: number | null;
  ultimo: LavadoEquipo | null;
  actor: { email: string; nombre: string | null };
  /** El lavado a editar (si no viene, se registra uno nuevo). */
  lavado?: LavadoEquipo | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const conocido = !lavado || TIPOS_LAVADO.some((t) => t.id === lavado.tipo);
  const [tipo, setTipo] = useState<string>(lavado ? (conocido ? lavado.tipo : OTRO) : TIPOS_LAVADO[0].id);
  const [otro, setOtro] = useState(lavado && !conocido ? lavado.tipo : '');
  const [fecha, setFecha] = useState(aLocal(lavado?.fecha));
  const [responsable, setResponsable] = useState(lavado?.responsable ?? '');
  const lect = (v: number | null | undefined) => (v != null ? String(v) : '');
  const [horo, setHoro] = useState(lavado ? lect(lavado.horometro) : lect(horometro));
  const [kms, setKms] = useState(lavado ? lect(lavado.kilometraje) : lect(km));
  const [nota, setNota] = useState(lavado?.nota ?? '');
  const [saving, setSaving] = useState(false);

  const tipoFinal = tipo === OTRO ? otro.trim() : tipo;
  const n = (v: string) => { const x = Number(v.replace(',', '.')); return v.trim() && Number.isFinite(x) ? x : null; };
  const listo = tipoLavadoValido(tipoFinal) && !!fecha;

  async function guardar() {
    if (!listo) { toast('Indica el tipo de lavado (al menos 3 letras).', 'warning'); return; }
    setSaving(true);
    try {
      const datos = { fecha: new Date(fecha).toISOString(), tipo: tipoFinal, responsable, horometro: n(horo), kilometraje: n(kms), nota };
      if (lavado) await actualizarLavado(lavado.id, datos);
      else await registrarLavado({ equipo_id: equipo.id, ...datos }, actor);
      toast(`🚿 Lavado ${tipoFinal.toLowerCase()} ${lavado ? 'actualizado' : 'registrado'} · ${equipo.equipo}`, 'success');
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : (e as { message?: string })?.message || 'No se pudo registrar el lavado', 'error');
    } finally { setSaving(false); }
  }

  return (
    <Modal title={`${lavado ? '✎ Editar lavado' : '🚿 Registrar lavado'} · ${equipo.equipo}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving || !listo}>{saving ? 'Guardando…' : lavado ? 'Guardar cambios' : 'Registrar lavado'}</button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.8rem' }}>
        <div className="flo-svc-grid" role="group" aria-label="Tipo de lavado">
          {TIPOS_LAVADO.map((t) => (
            <button key={t.id} type="button" className="flo-svc" aria-pressed={tipo === t.id} onClick={() => setTipo(t.id)}>
              <span className="ico">{t.icon}</span><strong>{t.label}</strong><span>{t.hint}</span>
            </button>
          ))}
          <button type="button" className="flo-svc" aria-pressed={tipo === OTRO} onClick={() => setTipo(OTRO)}>
            <span className="ico">✏️</span><strong>Otro</strong><span>Escribe cuál</span>
          </button>
        </div>
        {tipo === OTRO && (
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label htmlFor="lav-otro">¿Qué lavado?</label>
            <input id="lav-otro" className="input" value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="Ej.: tolva y balde" autoFocus />
          </div>
        )}
        <div className="flo-form2">
          <div className="form-row"><label htmlFor="lav-fecha">Fecha y hora</label>
            <input id="lav-fecha" className="input" type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div className="form-row"><label htmlFor="lav-resp">Lo realizó</label>
            <input id="lav-resp" className="input" value={responsable} onChange={(e) => setResponsable(e.target.value)} placeholder="Brigada o persona" />
          </div>
          <div className="form-row"><label htmlFor="lav-horo">Horómetro (h)</label>
            <input id="lav-horo" className="input" inputMode="decimal" value={horo} onChange={(e) => setHoro(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="form-row"><label htmlFor="lav-km">Kilometraje (km)</label>
            <input id="lav-km" className="input" inputMode="decimal" value={kms} onChange={(e) => setKms(e.target.value)} placeholder="Opcional" />
          </div>
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}><label htmlFor="lav-nota">Nota</label>
          <textarea id="lav-nota" className="textarea" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
        </div>
        <VistaPrevia titulo={lavado ? 'Se guarda así' : 'Se va a registrar'}>
          <Dato label="Equipo">{equipo.equipo}</Dato>
          <Dato label="Lavado">{tipoFinal || undefined}</Dato>
          <Dato label="Lectura">{[n(horo) != null ? `${fmtNum(n(horo))} h` : '', n(kms) != null ? `${fmtNum(n(kms))} km` : ''].filter(Boolean).join(' · ') || undefined}</Dato>
          <Dato label="Último lavado">{lavado ? undefined : ultimo ? `${ultimo.tipo} · ${dateTime(ultimo.fecha)} (${textoHace(diasDesde(ultimo.fecha))})` : 'sin registro'}</Dato>
        </VistaPrevia>
      </div>
    </Modal>
  );
}
