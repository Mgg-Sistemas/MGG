/* ============================================================
   MGG · Panel de Colada en el detalle de la orden de fundición.
   En curso: se cargan el control de temperatura horario y los tiempos de
   sangrado. Botón para el reporte formal MGG-FR-001. Los resultados se
   cargan al finalizar la colada.
   ============================================================ */
import { useEffect, useState, type CSSProperties } from 'react';
import { toast } from '@/shared/ui/Toast';
import { num } from '@/shared/lib/format';
import type { ColadaTemperatura, ProduccionColada } from '@/shared/lib/types';
import { getColada, actualizarColadaDatos } from './colada.repository';
import { ColadaAnalisisQuimico } from './ColadaAnalisisQuimico';

const secStyle: CSSProperties = { margin: '0 0 .7rem', padding: '.65rem .8rem', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-1)' };
const tituloSec: CSSProperties = { fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, color: 'var(--primary-3)', marginBottom: '.5rem' };
const numInput: CSSProperties = { textAlign: 'right' };

export function ColadaPanel({ produccionId, editable }: { produccionId: string; editable: boolean }) {
  const [colada, setColada] = useState<ProduccionColada | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Copia editable de los campos "en curso".
  const [temps, setTemps] = useState<ColadaTemperatura[]>([]);
  const [horaIni, setHoraIni] = useState('');
  const [horaFin, setHoraFin] = useState('');
  const [horaSangrado, setHoraSangrado] = useState('');
  const [tempColada, setTempColada] = useState('');
  const [duracion, setDuracion] = useState('');

  useEffect(() => {
    let cancel = false;
    getColada(produccionId).then((c) => {
      if (cancel) return;
      setColada(c);
      const d = c?.datos ?? {};
      setTemps(d.temperaturas ?? []);
      setHoraIni(d.hora_inicio_proceso ?? '');
      setHoraFin(d.hora_fin_proceso ?? '');
      setHoraSangrado(d.hora_sangrado ?? '');
      setTempColada(d.temp_colada == null ? '' : String(d.temp_colada));
      setDuracion(d.duracion_horas == null ? '' : String(d.duracion_horas));
    }).catch(() => { if (!cancel) setColada(null); }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [produccionId]);

  const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s));
  const setTemp = (i: number, patch: Partial<ColadaTemperatura>) =>
    setTemps((prev) => prev.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const addTemp = () => setTemps((prev) => [...prev, { hora: '', temp_int: null, temp_ext: null, obs: '' }]);
  const delTemp = (i: number) => setTemps((prev) => prev.filter((_, k) => k !== i));

  async function guardar() {
    setSaving(true);
    try {
      await actualizarColadaDatos(produccionId, {
        temperaturas: temps,
        hora_inicio_proceso: horaIni,
        hora_fin_proceso: horaFin,
        hora_sangrado: horaSangrado,
        temp_colada: toNum(tempColada),
        duracion_horas: toNum(duracion),
      });
      toast('Colada actualizada', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar la colada', 'error');
    } finally { setSaving(false); }
  }

  async function pdf() {
    try { const { descargarColadaPdf } = await import('./coladaPdf'); await descargarColadaPdf(produccionId); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el reporte', 'error'); }
  }

  if (loading) return null;
  if (!colada) return null; // esta orden no tiene reporte de colada (refinación / legado)

  return (
    <div className="card" style={{ padding: '.85rem', marginTop: '.75rem', borderLeft: '3px solid var(--primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <strong>🔥 Colada N° {colada.colada_num} <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>· MGG-FR-001</span></strong>
        <button type="button" className="btn btn-sm btn-ghost" onClick={pdf}>↓ Reporte de colada (PDF)</button>
      </div>

      {/* Control de temperatura del proceso (cada ~1 h) */}
      <div style={secStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={tituloSec}>Control de temperatura del proceso (cada ~1 h)</div>
          {editable && <button type="button" className="btn btn-sm btn-ghost" onClick={addTemp}>＋ Registrar temperatura</button>}
        </div>
        {!temps.length ? (
          <div className="muted" style={{ fontSize: '.82rem', padding: '.25rem 0' }}>Sin registros todavía.{editable ? ' Agregá con “＋ Registrar temperatura”.' : ''}</div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead><tr>
                <th style={{ width: 26 }}>N°</th><th>Hora</th>
                <th style={{ textAlign: 'right' }}>Temp. int (°C)</th>
                <th style={{ textAlign: 'right' }}>Temp. ext (°C)</th>
                <th>Observación</th>{editable && <th></th>}
              </tr></thead>
              <tbody>
                {temps.map((t, i) => (
                  <tr key={i}>
                    <td className="mono">{i + 1}</td>
                    <td>{editable
                      ? <input className="input" value={t.hora} onChange={(e) => setTemp(i, { hora: e.target.value })} placeholder="HH:MM" style={{ minWidth: 80 }} />
                      : (t.hora || '—')}</td>
                    <td style={{ textAlign: 'right' }}>{editable
                      ? <input className="input mono" type="number" step="any" value={t.temp_int ?? ''} onChange={(e) => setTemp(i, { temp_int: toNum(e.target.value) })} style={{ ...numInput, width: 90 }} />
                      : (t.temp_int ?? '—')}</td>
                    <td style={{ textAlign: 'right' }}>{editable
                      ? <input className="input mono" type="number" step="any" value={t.temp_ext ?? ''} onChange={(e) => setTemp(i, { temp_ext: toNum(e.target.value) })} style={{ ...numInput, width: 90 }} />
                      : (t.temp_ext ?? '—')}</td>
                    <td>{editable
                      ? <input className="input" value={t.obs} onChange={(e) => setTemp(i, { obs: e.target.value })} placeholder="Observación / acción" />
                      : (t.obs || '—')}</td>
                    {editable && <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => delTemp(i)} style={{ color: 'var(--danger)' }}>✕</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Análisis químico de laboratorio de la colada (desplegable, realtime) */}
      <ColadaAnalisisQuimico produccionId={produccionId} editable={editable} />

      {/* Sangrado y tiempos de colada */}
      <div style={{ ...secStyle, marginBottom: editable ? '.7rem' : 0 }}>
        <div style={tituloSec}>Sangrado y tiempos de colada</div>
        <div className="form-grid">
          <div className="form-row">
            <label>Hora inicio del proceso</label>
            <input className="input" value={horaIni} onChange={(e) => setHoraIni(e.target.value)} disabled={!editable} placeholder="Ej.: 20/03/26 6am" />
          </div>
          <div className="form-row">
            <label>Hora fin del proceso</label>
            <input className="input" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} disabled={!editable} placeholder="Ej.: 21/03/26 3am" />
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Hora de sangrado</label>
            <input className="input" value={horaSangrado} onChange={(e) => setHoraSangrado(e.target.value)} disabled={!editable} />
          </div>
          <div className="form-row">
            <label>Temp. de colada (°C)</label>
            <input className="input mono" type="number" step="any" value={tempColada} onChange={(e) => setTempColada(e.target.value)} disabled={!editable} style={numInput} />
          </div>
        </div>
        <div className="form-row" style={{ maxWidth: 240 }}>
          <label>Duración total de la colada (h)</label>
          <input className="input mono" type="number" step="any" value={duracion} onChange={(e) => setDuracion(e.target.value)} disabled={!editable} style={numInput} />
        </div>
      </div>

      {/* Resultados (si ya finalizó) */}
      {colada.datos.estano_kg != null && (
        <div style={{ ...secStyle, marginBottom: 0 }}>
          <div style={tituloSec}>Resultados</div>
          <div className="mono" style={{ fontSize: '.84rem', lineHeight: 1.7 }}>
            Estaño obtenido: <strong>{num(colada.datos.estano_kg)} kg</strong> · Lingotes: <strong>{colada.datos.n_lingotes ?? '—'}</strong><br />
            Escoria: {colada.datos.escoria_kg != null ? `${num(colada.datos.escoria_kg)} kg` : '—'} · Rendimiento: {colada.datos.rendimiento != null ? `${num(colada.datos.rendimiento)} %` : '—'}
          </div>
        </div>
      )}

      {editable && (
        <div style={{ textAlign: 'right' }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar colada'}</button>
        </div>
      )}
    </div>
  );
}
