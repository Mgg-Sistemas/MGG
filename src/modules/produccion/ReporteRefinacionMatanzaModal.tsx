import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { textoDeError } from '@/shared/lib/errores';
import { listRefinacionesParaReporte } from './reporteRefinacionMatanzas.repository';
import { listColadasParaReporte } from './reporteFundicionMatanzas.repository';
import { enRango, type ColadaReporte } from './reporteFundicionMatanzas';
import { filaRefinacion, totalesRefinacion, cadenas, totalesCadena, type RefinacionReporte } from './reporteRefinacionMatanzas';

const LUGAR = 'Matanzas';

const fmtFecha = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—');
};
const nDec = (v: number | null | undefined): string =>
  v == null ? '—' : Number(v).toLocaleString('es-VE', { maximumFractionDigits: 2 });

/**
 * Arma el REPORTE REFINACIÓN MATANZA (modo 'refinacion') o el informe
 * encadenado COLADA + REFINACIÓN (modo 'cadena').
 *
 * Trae las refinaciones finalizadas y deja elegir cuáles entran, por rango
 * de fechas y una por una. En el encadenado, además, el tenor con que se
 * mide el Sn teórico de la casiterita.
 */
export function ReporteRefinacionMatanzaModal({ modo, onClose }: { modo: 'refinacion' | 'cadena'; onClose: () => void }) {
  const cadena = modo === 'cadena';
  const [todas, setTodas] = useState<RefinacionReporte[]>([]);
  const [coladas, setColadas] = useState<ColadaReporte[]>([]);
  const [cargando, setCargando] = useState(true);
  const [generando, setGenerando] = useState(false);

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [tenor, setTenor] = useState('65');
  const [supervisor, setSupervisor] = useState('');
  const [equipo, setEquipo] = useState('');
  const [nota, setNota] = useState('');

  useEffect(() => {
    let vivo = true;
    Promise.all([listRefinacionesParaReporte(), cadena ? listColadasParaReporte() : Promise.resolve([] as ColadaReporte[])])
      .then(([rs, cs]) => {
        if (!vivo) return;
        setTodas(rs); setColadas(cs);
        setElegidas(new Set(rs.map((r) => r.produccion_id)));
        const primera = rs[0];
        if (primera) { setSupervisor(primera.responsable || ''); setEquipo(primera.horno || ''); }
      })
      .catch((e) => toast(textoDeError(e, 'No se pudieron cargar las refinaciones'), 'error'))
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [cadena]);

  const visibles = useMemo(() => enRango(todas, desde, hasta), [todas, desde, hasta]);
  const seleccion = useMemo(() => visibles.filter((r) => elegidas.has(r.produccion_id)), [visibles, elegidas]);
  const tenorNum = Math.max(0, Number(String(tenor).replace(',', '.')) || 0);

  const previa = useMemo(() => totalesRefinacion(seleccion.map(filaRefinacion)), [seleccion]);
  const previaCadena = useMemo(
    () => (cadena ? totalesCadena(cadenas(seleccion.map(filaRefinacion), coladas, tenorNum)) : null),
    [cadena, seleccion, coladas, tenorNum],
  );

  function alternar(id: string): void {
    setElegidas((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  }
  function todasVisibles(marcar: boolean): void {
    setElegidas((prev) => {
      const s = new Set(prev);
      visibles.forEach((r) => { if (marcar) s.add(r.produccion_id); else s.delete(r.produccion_id); });
      return s;
    });
  }

  async function generar(): Promise<void> {
    if (!seleccion.length) { toast('Elegí al menos una refinación', 'error'); return; }
    if (cadena && !(tenorNum > 0)) { toast('El tenor de Sn tiene que ser mayor que 0', 'error'); return; }
    setGenerando(true);
    try {
      const op = { lugar: LUGAR, supervisor: supervisor.trim(), equipo: equipo.trim(), nota: nota.trim() };
      const m = await import('./reporteRefinacionMatanzasPdf');
      if (cadena) await m.generarReporteColadaRefinacion(seleccion, coladas, todas, { ...op, tenorPct: tenorNum });
      else await m.generarReporteRefinacionMatanzas(seleccion, op);
    } catch (e) {
      toast(textoDeError(e, 'No se pudo generar el reporte'), 'error');
    } finally {
      setGenerando(false);
    }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={generando}>Cerrar</button>
      <button className="btn btn-primary" onClick={generar} disabled={generando || !seleccion.length}>
        {generando ? 'Generando…' : `↓ Generar reporte (${seleccion.length})`}
      </button>
    </>
  );

  const origenTxt = (r: RefinacionReporte) => r.origenes.map((o) => o.etiqueta).join(', ') || '—';

  return (
    <Modal title={cadena ? 'Reporte Colada + Refinación' : 'Reporte Refinación Matanza'} size="xl" onClose={onClose} footer={footer}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        {cadena
          ? <>Sigue el estaño de punta a punta: <strong>casiterita → estaño bruto → lingote refinado</strong>, con el rendimiento de la fundición, el de la refinación y el <strong>global</strong>. Si una refinación tomó solo una parte de una colada, la casiterita se le atribuye en proporción. Incluye el estaño bruto que todavía no se refinó.</>
          : <>El reporte formal de refinación de la planta, con el mismo formato que el de fundición: crudo cargado, refinado, dross, merma, reactivos, rendimiento, pureza y costo por kg. Elegí qué refinaciones entran.</>}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.6rem', marginBottom: '.8rem' }}>
        <div className="form-row"><label>Desde</label><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="form-row"><label>Hasta</label><input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        {cadena && (
          <div className="form-row"><label>Tenor de Sn (%) *</label><input className="input" value={tenor} onChange={(e) => setTenor(e.target.value)} inputMode="decimal" /></div>
        )}
        <div className="form-row"><label>{cadena ? 'Supervisor' : 'Supervisor de refinación'}</label><input className="input" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} placeholder="Nombre y apellido" /></div>
        <div className="form-row"><label>Equipo utilizado</label><input className="input" value={equipo} onChange={(e) => setEquipo(e.target.value)} placeholder="Crisol 1" /></div>
      </div>

      <div className="form-row" style={{ marginBottom: '.8rem' }}>
        <label>Nota metodológica adicional (opcional)</label>
        <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Criterios acordados con planta, correcciones…" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.4rem', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '.9rem' }}>Refinaciones del período</strong>
        <span className="muted" style={{ fontSize: '.78rem' }}>{visibles.length} en el rango · {seleccion.length} elegidas</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={() => todasVisibles(true)}>Marcar todas</button>
        <button className="btn btn-sm btn-ghost" onClick={() => todasVisibles(false)}>Ninguna</button>
      </div>

      {cargando ? (
        <div className="muted" style={{ padding: '1rem' }}>Cargando refinaciones…</div>
      ) : !visibles.length ? (
        <div className="muted" style={{ padding: '1rem' }}>No hay refinaciones finalizadas en ese rango de fechas.</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}></th>
                <th>Refinación</th><th>Fecha</th><th>Origen del crudo</th>
                <th style={{ textAlign: 'right' }}>Crudo</th>
                <th style={{ textAlign: 'right' }}>Refinado</th>
                <th style={{ textAlign: 'right' }}>Dross</th>
                <th style={{ textAlign: 'right' }}>Rendim.</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => {
                const marcada = elegidas.has(r.produccion_id);
                const f = filaRefinacion(r);
                return (
                  <tr key={r.produccion_id} style={{ opacity: marcada ? 1 : 0.45 }}>
                    <td><input type="checkbox" checked={marcada} onChange={() => alternar(r.produccion_id)} /></td>
                    <td><strong>#{r.refinacion_num}</strong></td>
                    <td className="mono">{fmtFecha(r.fecha)}</td>
                    <td>{origenTxt(r)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{nDec(r.crudo_kg)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{nDec(r.refinado_kg)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{nDec(r.dross_kg)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{nDec(f.rendimiento_pct)} %</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {seleccion.length > 0 && (
        <div className="card" style={{ marginTop: '.7rem', fontSize: '.82rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '.5rem' }}>
            {cadena && previaCadena ? (
              <>
                <div><span className="muted">Casiterita atribuida</span><br /><strong className="mono">{nDec(previaCadena.casiterita_kg)} kg</strong></div>
                <div><span className="muted">Sn teórico</span><br /><strong className="mono">{nDec(previaCadena.sn_teorico_kg)} kg</strong></div>
                <div><span className="muted">Rend. fundición</span><br /><strong className="mono">{nDec(previaCadena.rendimiento_fundicion_pct)} %</strong></div>
                <div><span className="muted">Rend. refinación</span><br /><strong className="mono">{nDec(previaCadena.rendimiento_refinacion_pct)} %</strong></div>
                <div><span className="muted">Refinado</span><br /><strong className="mono">{nDec(previaCadena.refinado_kg)} kg</strong></div>
                <div><span className="muted">Rendimiento global</span><br /><strong className="mono" style={{ color: 'var(--primary-3)' }}>{nDec(previaCadena.rendimiento_global_pct)} %</strong></div>
              </>
            ) : (
              <>
                <div><span className="muted">Crudo cargado</span><br /><strong className="mono">{nDec(previa.crudo_kg)} kg</strong></div>
                <div><span className="muted">Refinado</span><br /><strong className="mono">{nDec(previa.refinado_kg)} kg</strong></div>
                <div><span className="muted">Dross</span><br /><strong className="mono">{nDec(previa.dross_kg)} kg</strong></div>
                <div><span className="muted">Rendimiento</span><br /><strong className="mono">{nDec(previa.rendimiento_pct)} %</strong></div>
                <div><span className="muted">Lingotes</span><br /><strong className="mono">{nDec(previa.n_lingotes)}</strong></div>
                <div><span className="muted">Costo por kg</span><br /><strong className="mono">{nDec(previa.costo_kg)}</strong></div>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
