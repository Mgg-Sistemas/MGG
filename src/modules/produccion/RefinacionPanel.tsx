/* ============================================================
   MGG · Panel de Refinación en el detalle de la orden (MGG-FR-002).
   Muestra el origen del estaño crudo (coladas), los parámetros y las etapas.
   En curso: se pueden editar/registrar las etapas de temperatura. Botón para el
   reporte formal. Los resultados y el balance de masa se cargan al finalizar.
   ============================================================ */
import { useEffect, useState, type CSSProperties } from 'react';
import { toast } from '@/shared/ui/Toast';
import { num } from '@/shared/lib/format';
import type { ProduccionRefinacion, RefinacionEtapa } from '@/shared/lib/types';
import { getRefinacion, actualizarRefinacionDatos } from './refinacion.repository';
import { ColadaAnalisisQuimico } from './ColadaAnalisisQuimico';

const secStyle: CSSProperties = { margin: '0 0 .7rem', padding: '.65rem .8rem', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-1)' };
const tituloSec: CSSProperties = { fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, color: 'var(--primary-3)', marginBottom: '.5rem' };
const numInput: CSSProperties = { textAlign: 'right' };

export function RefinacionPanel({ produccionId, editable }: { produccionId: string; editable: boolean }) {
  const [ref, setRef] = useState<ProduccionRefinacion | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [etapas, setEtapas] = useState<RefinacionEtapa[]>([]);

  useEffect(() => {
    let cancel = false;
    getRefinacion(produccionId).then((r) => {
      if (cancel) return;
      setRef(r);
      setEtapas(r?.datos?.etapas ?? []);
    }).catch(() => { if (!cancel) setRef(null); }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [produccionId]);

  const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s));
  const setEtapa = (i: number, patch: Partial<RefinacionEtapa>) =>
    setEtapas((prev) => prev.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const addEtapa = () => setEtapas((prev) => [...prev, { etapa: '', hora: '', temp_bano: null, temp_quemador: null, accion: '' }]);
  const delEtapa = (i: number) => setEtapas((prev) => prev.filter((_, k) => k !== i));

  async function guardar() {
    setSaving(true);
    try {
      await actualizarRefinacionDatos(produccionId, { etapas });
      toast('Refinación actualizada', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    } finally { setSaving(false); }
  }

  async function pdf() {
    try { const { descargarRefinacionPdf } = await import('./refinacionPdf'); await descargarRefinacionPdf(produccionId); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el reporte', 'error'); }
  }

  if (loading) return null;
  if (!ref) return null;
  const d = ref.datos ?? {};
  const coladas = d.coladas ?? [];

  return (
    <div className="card" style={{ padding: '.85rem', marginTop: '.75rem', borderLeft: '3px solid var(--primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <strong>⚗️ Refinación N° {ref.refinacion_num} <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>· MGG-FR-002</span></strong>
        <button type="button" className="btn btn-sm btn-ghost" onClick={pdf}>↓ Reporte de refinación (PDF)</button>
      </div>

      {/* Origen del material a refinar */}
      <div style={secStyle}>
        <div style={tituloSec}>Origen del material a refinar</div>
        {!coladas.length ? (
          <div className="muted" style={{ fontSize: '.82rem' }}>Sin orígenes registrados.</div>
        ) : (
          <div className="mono" style={{ fontSize: '.82rem', lineHeight: 1.6 }}>
            {coladas.map((c) => (
              <div key={c.produccion_id}>{c.etiqueta ?? `Colada #${c.colada_num || 's/n'}`}{c.origen === 'refinacion' ? ' ♻' : ''} · {num(c.estano_kg)} kg <span className="muted">({c.producto_nombre})</span></div>
            ))}
            <div style={{ marginTop: '.3rem' }}>Material cargado: <strong>{num(d.estano_crudo_kg ?? 0)} kg</strong>{d.pureza_inicial != null ? <> · pureza inicial {num(d.pureza_inicial)} %</> : null}</div>
          </div>
        )}
      </div>

      {/* Análisis químico de laboratorio de la refinación (desplegable, realtime) */}
      <ColadaAnalisisQuimico produccionId={produccionId} editable={editable} modulo="refinacion" />

      {/* Parámetros */}
      {(d.metodo_agitacion || d.desespumado) && (
        <div style={secStyle}>
          <div style={tituloSec}>Parámetros de operación</div>
          <div className="mono" style={{ fontSize: '.82rem', lineHeight: 1.6 }}>
            {d.metodo_agitacion ? <>Agitación: <strong>{d.metodo_agitacion}</strong><br /></> : null}
            {d.desespumado ? <>Desespumado: <strong>{d.desespumado}</strong></> : null}
          </div>
        </div>
      )}

      {/* Etapas / control de temperatura */}
      <div style={secStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={tituloSec}>Control de temperatura y etapas</div>
          {editable && <button type="button" className="btn btn-sm btn-ghost" onClick={addEtapa}>＋ Etapa</button>}
        </div>
        {!etapas.length ? (
          <div className="muted" style={{ fontSize: '.82rem', padding: '.25rem 0' }}>Sin etapas registradas.</div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead><tr>
                <th style={{ width: 24 }}>N°</th><th>Hora</th>
                <th style={{ textAlign: 'right' }}>T. baño (°C)</th>
                <th style={{ textAlign: 'right' }}>T. quemador (°C)</th>
                <th>Acción / reactivo</th>{editable && <th></th>}
              </tr></thead>
              <tbody>
                {etapas.map((et, i) => (
                  <tr key={i}>
                    <td className="mono">{i + 1}</td>
                    <td>{editable
                      ? <input className="input" value={et.hora ?? ''} onChange={(e) => setEtapa(i, { hora: e.target.value })} placeholder="HH:MM" style={{ minWidth: 72 }} />
                      : (et.hora || '—')}</td>
                    <td style={{ textAlign: 'right' }}>{editable
                      ? <input className="input mono" type="number" step="any" value={et.temp_bano ?? ''} onChange={(e) => setEtapa(i, { temp_bano: toNum(e.target.value) })} style={{ ...numInput, width: 84 }} />
                      : (et.temp_bano ?? '—')}</td>
                    <td style={{ textAlign: 'right' }}>{editable
                      ? <input className="input mono" type="number" step="any" value={et.temp_quemador ?? ''} onChange={(e) => setEtapa(i, { temp_quemador: toNum(e.target.value) })} style={{ ...numInput, width: 84 }} />
                      : (et.temp_quemador ?? '—')}</td>
                    <td>{editable
                      ? <input className="input" value={et.accion ?? ''} onChange={(e) => setEtapa(i, { accion: e.target.value })} placeholder="Acción / reactivo" />
                      : (et.accion || '—')}</td>
                    {editable && <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => delEtapa(i)} style={{ color: 'var(--danger)' }}>✕</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Resultados (si ya finalizó) */}
      {d.estano_refinado_kg != null && (
        <div style={{ ...secStyle, marginBottom: editable ? '.7rem' : 0 }}>
          <div style={tituloSec}>Resultados y balance de masa</div>
          <div className="mono" style={{ fontSize: '.84rem', lineHeight: 1.7 }}>
            Estaño refinado: <strong>{num(d.estano_refinado_kg)} kg</strong> · Lingotes: <strong>{d.n_lingotes ?? '—'}</strong>{d.peso_prom_lingote != null ? <> ({num(d.peso_prom_lingote)} kg c/u)</> : null}<br />
            Dross: {d.dross_kg != null ? `${num(d.dross_kg)} kg` : '—'} · Rendimiento: {d.rendimiento != null ? `${num(d.rendimiento)} %` : '—'} · Merma: {d.merma_kg != null ? `${num(d.merma_kg)} kg` : '—'}<br />
            Pureza final: {d.pureza_final != null ? `${num(d.pureza_final)} % Sn` : '—'}{d.n_precinto ? <> · Precinto/lote: {d.n_precinto}</> : null}
          </div>
        </div>
      )}

      {editable && (
        <div style={{ textAlign: 'right' }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar refinación'}</button>
        </div>
      )}
    </div>
  );
}
