import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum, dateTime } from '@/shared/lib/format';
import { validarLectura, etiquetaOrigenLectura } from './flota';
import { registrarLectura, getLectura, editarLectura, type LecturaVigente, type LecturaMaquinaria } from './flota.repository';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

/** «2026-10-09T14:30» en hora local, para el input datetime-local. */
function ahoraLocal(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const n = (v: string): number | null => {
  const x = Number(v.trim().replace(',', '.'));
  return v.trim() && Number.isFinite(x) ? x : null;
};

/**
 * Registrar horómetro / km desde Maquinaria. La lectura queda como contador vigente y el
 * próximo surtido del equipo en Combustible arranca desde ella (HI / km inicial). No puede
 * bajar de la vigente; un administrador puede corregirla hacia abajo con motivo.
 *
 * Con `lecturaId` edita una lectura ya registrada desde Maquinaria: sin ser administrador
 * tiene que quedar entre la lectura anterior y la siguiente (lo valida la base).
 */
export function LecturaModal({ equipo, vigente, isAdmin, lecturaId, onClose, onSaved }: {
  equipo: MaquinariaEquipo;
  vigente: LecturaVigente;
  isAdmin: boolean;
  /** La lectura a editar (si no viene, se registra una nueva). */
  lecturaId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [horo, setHoro] = useState('');
  const [km, setKm] = useState('');
  const [fecha, setFecha] = useState(ahoraLocal());
  const [nota, setNota] = useState('');
  const [correccion, setCorreccion] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<LecturaMaquinaria | null>(null);
  const editando = !!lecturaId;
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  useEffect(() => {
    if (!lecturaId) return;
    getLectura(lecturaId).then((l) => {
      if (!l) { toast('La lectura ya no existe.', 'warning'); cerrar.current(); return; }
      setOriginal(l);
      setHoro(l.horometro != null ? String(l.horometro) : '');
      setKm(l.kilometraje != null ? String(l.kilometraje) : '');
      setFecha(ahoraLocal(l.fecha));
      setNota(l.nota ?? '');
      setCorreccion(l.es_correccion);
      setMotivo(l.motivo_correccion ?? '');
    }).catch((e) => { toast(e instanceof Error ? e.message : 'No se pudo cargar la lectura', 'error'); cerrar.current(); });
  }, [lecturaId]);

  const nueva = { horometro: n(horo), kilometraje: n(km) };
  // Al editar, la vigente incluye a esta misma lectura: el rango lo valida la base.
  const problema = editando
    ? (!original ? 'Cargando…'
      : nueva.horometro == null && nueva.kilometraje == null ? 'Indica el horómetro o el kilometraje.'
      : correccion && motivo.trim().length < 3 ? 'Escribe el motivo de la corrección.' : null)
    : validarLectura(nueva, vigente, { correccion, admin: isAdmin, motivo });
  const sinVinculo = !(equipo.combustible_equipo ?? '').trim();

  async function guardar() {
    if (problema) { toast(problema, 'warning'); return; }
    setSaving(true);
    try {
      if (lecturaId) {
        await editarLectura(lecturaId, {
          horometro: nueva.horometro, kilometraje: nueva.kilometraje, fecha: new Date(fecha).toISOString(),
          nota: nota.trim() || null, motivo: correccion ? motivo.trim() : null,
        });
        toast(`Lectura de ${equipo.equipo} corregida: el contador vigente se recalculó.`, 'success');
      } else {
        await registrarLectura({
          equipo_id: equipo.id, horometro: nueva.horometro, kilometraje: nueva.kilometraje,
          fecha: new Date(fecha).toISOString(), nota: nota.trim() || null, correccion, motivo: correccion ? motivo.trim() : null,
        });
        toast(`Contador de ${equipo.equipo} actualizado${sinVinculo ? '' : ': el próximo surtido arranca desde esta lectura'}.`, 'success');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : (e as { message?: string })?.message || 'No se pudo registrar la lectura', 'error');
    } finally { setSaving(false); }
  }

  return (
    <Modal title={`${editando ? '✎ Editar lectura' : '⏱️ Registrar horómetro / km'} · ${equipo.equipo}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className={`btn ${correccion ? 'btn-danger' : 'btn-primary'}`} onClick={() => void guardar()} disabled={saving || !!problema}>
          {saving ? 'Guardando…' : editando ? 'Guardar cambios' : correccion ? 'Guardar corrección' : 'Registrar lectura'}
        </button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.8rem' }}>
        <div className="flo-contador-mini">
          <div><small>Horómetro vigente</small><strong>{vigente.horometro != null ? `${fmtNum(vigente.horometro)} h` : '—'}</strong>
            <span>{vigente.horometro_fecha ? `${dateTime(vigente.horometro_fecha)} · ${etiquetaOrigenLectura(vigente.horometro_origen)}` : 'sin lectura'}</span></div>
          <div><small>Km vigente</small><strong>{vigente.kilometraje != null ? `${fmtNum(vigente.kilometraje)} km` : '—'}</strong>
            <span>{vigente.km_fecha ? `${dateTime(vigente.km_fecha)} · ${etiquetaOrigenLectura(vigente.km_origen)}` : 'sin lectura'}</span></div>
        </div>
        <div className="flo-form2">
          <div className="form-row"><label htmlFor="lec-horo">Horómetro (h)</label>
            <input id="lec-horo" className="input" inputMode="decimal" value={horo} onChange={(e) => setHoro(e.target.value)} placeholder={vigente.horometro != null ? `≥ ${fmtNum(vigente.horometro)}` : 'Lectura'} autoFocus />
          </div>
          <div className="form-row"><label htmlFor="lec-km">Kilometraje (km)</label>
            <input id="lec-km" className="input" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder={vigente.kilometraje != null ? `≥ ${fmtNum(vigente.kilometraje)}` : 'Lectura'} />
          </div>
          <div className="form-row"><label htmlFor="lec-fecha">Fecha y hora</label>
            <input id="lec-fecha" className="input" type="datetime-local" value={fecha} max={ahoraLocal()} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div className="form-row"><label htmlFor="lec-nota">Nota</label>
            <input id="lec-nota" className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
          </div>
        </div>
        {editando && correccion && <div className="aviso info sm"><span className="aviso-icono">🛠</span><div>Esta lectura es una <strong>corrección</strong> (solo un administrador la cambia).</div></div>}
        {isAdmin && !editando && (
          <label style={{ display: 'flex', gap: '.45rem', alignItems: 'center', fontSize: '.85rem', minHeight: 44 }}>
            <input type="checkbox" checked={correccion} onChange={(e) => setCorreccion(e.target.checked)} /> Es una corrección hacia abajo (cambio de horómetro u odómetro, error de carga)
          </label>
        )}
        {correccion && (
          <div className="form-row" style={{ marginBottom: 0 }}><label htmlFor="lec-motivo">Motivo de la corrección</label>
            <input id="lec-motivo" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: se cambió el horómetro" />
          </div>
        )}
        {problema && (nueva.horometro != null || nueva.kilometraje != null) && <div className="aviso warning sm"><span className="aviso-icono">⚠️</span><div>{problema}</div></div>}
        <VistaPrevia titulo={editando ? 'Se guarda así' : 'Se va a registrar'}>
          <Dato label="Equipo">{equipo.equipo}</Dato>
          <Dato label="Horómetro">{nueva.horometro != null ? `${fmtNum(nueva.horometro)} h` : undefined}</Dato>
          <Dato label="Kilometraje">{nueva.kilometraje != null ? `${fmtNum(nueva.kilometraje)} km` : undefined}</Dato>
          <Dato label="En Combustible">{sinVinculo ? 'Este equipo no está vinculado a Combustible: la lectura queda solo en Maquinaria.' : `El próximo surtido de «${equipo.combustible_equipo}» arranca desde esta lectura.`}</Dato>
        </VistaPrevia>
      </div>
    </Modal>
  );
}
