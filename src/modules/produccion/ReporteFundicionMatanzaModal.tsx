import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { textoDeError } from '@/shared/lib/errores';
import { listColadasParaReporte } from './reporteFundicionMatanzas.repository';
import { enRango, filaColada, totalesPeriodo, type ColadaReporte } from './reporteFundicionMatanzas';
import type { OpcionesReporte } from './reporteFundicionMatanzasPdf';

const LUGAR = 'Matanzas';
const FUENTE = 'Sistema MGG · reportes de colada MGG-FR-001';

const fmtFecha = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—');
};
const nDec = (v: number | null | undefined): string =>
  v == null ? '—' : Number(v).toLocaleString('es-VE', { maximumFractionDigits: 2 });

/**
 * Arma el REPORTE FUNDICIÓN MATANZA.
 *
 * Trae todas las coladas finalizadas y deja elegir cuáles entran —por rango de
 * fechas y una por una—, con qué tenor se mide el rendimiento y qué dio el
 * ensayo XRF de cada escoria, que es lo único que el sistema no guarda.
 */
export function ReporteFundicionMatanzaModal({ onClose }: { onClose: () => void }) {
  const [todas, setTodas] = useState<ColadaReporte[]>([]);
  const [cargando, setCargando] = useState(true);
  const [generando, setGenerando] = useState(false);

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  /** Lo que declara quien arma el reporte, por colada: % Sn de su escoria y la muestra. */
  const [xrf, setXrf] = useState<Record<string, { pct: string; muestra: string }>>({});

  const [tenor, setTenor] = useState('65');
  const [porCiclo, setPorCiclo] = useState('2');
  const [supervisor, setSupervisor] = useState('');
  const [equipo, setEquipo] = useState('');
  const [nota, setNota] = useState('');

  useEffect(() => {
    let vivo = true;
    listColadasParaReporte()
      .then((cs) => {
        if (!vivo) return;
        setTodas(cs);
        // Arranca con todas marcadas: es una sola planta y lo normal es el período completo.
        setElegidas(new Set(cs.map((c) => c.produccion_id)));
        const primera = cs[0];
        if (primera) {
          setSupervisor(primera.responsable || '');
          setEquipo(primera.horno || '');
        }
      })
      .catch((e) => toast(textoDeError(e, 'No se pudieron cargar las coladas'), 'error'))
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, []);

  // El rango recorta la lista visible; los tildes deciden qué entra de verdad.
  const visibles = useMemo(() => enRango(todas, desde, hasta), [todas, desde, hasta]);

  const seleccion = useMemo<ColadaReporte[]>(() => visibles
    .filter((c) => elegidas.has(c.produccion_id))
    .map((c) => {
      const x = xrf[c.produccion_id];
      const pctNum = Number(String(x?.pct ?? '').replace(',', '.'));
      return {
        ...c,
        sn_escoria_pct: Number.isFinite(pctNum) && pctNum > 0 ? pctNum : null,
        muestra_escoria: (x?.muestra ?? '').trim(),
      };
    }), [visibles, elegidas, xrf]);

  const tenorNum = Math.max(0, Number(String(tenor).replace(',', '.')) || 0);
  const previa = useMemo(() => totalesPeriodo(seleccion.map((c) => filaColada(c, tenorNum))), [seleccion, tenorNum]);

  function alternar(id: string): void {
    setElegidas((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  function todasVisibles(marcar: boolean): void {
    setElegidas((prev) => {
      const s = new Set(prev);
      visibles.forEach((c) => { if (marcar) s.add(c.produccion_id); else s.delete(c.produccion_id); });
      return s;
    });
  }

  async function generar(): Promise<void> {
    if (!seleccion.length) { toast('Elegí al menos una colada', 'error'); return; }
    if (!(tenorNum > 0)) { toast('El tenor de Sn tiene que ser mayor que 0', 'error'); return; }
    setGenerando(true);
    try {
      const op: OpcionesReporte = {
        tenorPct: tenorNum,
        coladasPorCiclo: Math.max(1, Number(porCiclo) || 2),
        lugar: LUGAR,
        supervisor: supervisor.trim(),
        equipo: equipo.trim(),
        fuente: FUENTE,
        nota: nota.trim(),
      };
      const { generarReporteFundicionMatanzas } = await import('./reporteFundicionMatanzasPdf');
      await generarReporteFundicionMatanzas(seleccion, op);
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

  return (
    <Modal title="Reporte Fundición Matanza" size="xl" onClose={onClose} footer={footer}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        El reporte formal de producción de la planta. Elegí qué coladas entran y con qué
        tenor se mide el rendimiento. El <strong>Sn de la escoria</strong> es lo único que el
        sistema no guarda: se carga acá, del ensayo XRF, y si lo dejás vacío el reporte no
        supone ninguna recuperación.
      </p>

      {/* Parámetros del reporte */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.6rem', marginBottom: '.8rem' }}>
        <div className="form-row">
          <label>Desde</label>
          <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Hasta</label>
          <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Tenor de Sn (%) *</label>
          <input className="input" value={tenor} onChange={(e) => setTenor(e.target.value)} inputMode="decimal" />
        </div>
        <div className="form-row">
          <label>Coladas por ciclo de escoria</label>
          <input className="input" value={porCiclo} onChange={(e) => setPorCiclo(e.target.value)} inputMode="numeric" />
        </div>
        <div className="form-row">
          <label>Supervisor de fundición</label>
          <input className="input" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} placeholder="Nombre y apellido" />
        </div>
        <div className="form-row">
          <label>Equipo utilizado</label>
          <input className="input" value={equipo} onChange={(e) => setEquipo(e.target.value)} placeholder="Horno Fundición Nro. 01" />
        </div>
      </div>

      <div className="form-row" style={{ marginBottom: '.8rem' }}>
        <label>Nota metodológica adicional (opcional)</label>
        <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)}
          placeholder="Correcciones aplicadas al archivo maestro, criterios acordados con planta…" />
      </div>

      {/* Coladas */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.4rem', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '.9rem' }}>Coladas del período</strong>
        <span className="muted" style={{ fontSize: '.78rem' }}>{visibles.length} en el rango · {seleccion.length} elegidas</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={() => todasVisibles(true)}>Marcar todas</button>
        <button className="btn btn-sm btn-ghost" onClick={() => todasVisibles(false)}>Ninguna</button>
      </div>

      {cargando ? (
        <div className="muted" style={{ padding: '1rem' }}>Cargando coladas…</div>
      ) : !visibles.length ? (
        <div className="muted" style={{ padding: '1rem' }}>No hay coladas finalizadas en ese rango de fechas.</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}></th>
                <th>Colada</th>
                <th>Fecha</th>
                <th>Turno</th>
                <th style={{ textAlign: 'right' }}>Casiterita</th>
                <th style={{ textAlign: 'right' }}>Estaño</th>
                <th style={{ textAlign: 'right' }}>Escoria</th>
                <th style={{ width: 110 }}>Sn escoria %</th>
                <th style={{ width: 110 }}>Muestra N°</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => {
                const marcada = elegidas.has(c.produccion_id);
                const x = xrf[c.produccion_id] ?? { pct: '', muestra: '' };
                return (
                  <tr key={c.produccion_id} style={{ opacity: marcada ? 1 : 0.45 }}>
                    <td><input type="checkbox" checked={marcada} onChange={() => alternar(c.produccion_id)} /></td>
                    <td><strong>#{c.colada_num}</strong></td>
                    <td className="mono">{fmtFecha(c.fecha)}</td>
                    <td>{c.turno || '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{nDec(c.casiterita_kg)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{nDec(c.estano_kg)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{nDec(c.escoria_kg)}</td>
                    <td>
                      {c.escoria_kg > 0 ? (
                        <input className="input" style={{ padding: '.2rem .35rem', fontSize: '.8rem' }}
                          value={x.pct} inputMode="decimal" placeholder="12,43"
                          onChange={(e) => setXrf((p) => ({ ...p, [c.produccion_id]: { ...x, pct: e.target.value } }))} />
                      ) : <span className="muted">sin escoria</span>}
                    </td>
                    <td>
                      {c.escoria_kg > 0 ? (
                        <input className="input" style={{ padding: '.2rem .35rem', fontSize: '.8rem' }}
                          value={x.muestra} placeholder="#2752"
                          onChange={(e) => setXrf((p) => ({ ...p, [c.produccion_id]: { ...x, muestra: e.target.value } }))} />
                      ) : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Vista rápida de a dónde da el reporte antes de generarlo */}
      {seleccion.length > 0 && (
        <div className="card" style={{ marginTop: '.7rem', fontSize: '.82rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '.5rem' }}>
            <div><span className="muted">Casiterita</span><br /><strong className="mono">{nDec(previa.casiterita_kg)} kg</strong></div>
            <div><span className="muted">Sn teórico</span><br /><strong className="mono">{nDec(previa.sn_teorico_kg)} kg</strong></div>
            <div><span className="muted">Estaño obtenido</span><br /><strong className="mono">{nDec(previa.estano_kg)} kg</strong></div>
            <div><span className="muted">Rendimiento</span><br /><strong className="mono">{nDec(previa.rendimiento_pct)} %</strong></div>
            <div><span className="muted">Sn en escoria</span><br /><strong className="mono">{nDec(previa.sn_recuperable_kg)} kg</strong></div>
            <div><span className="muted">Potencial</span><br /><strong className="mono">{nDec(previa.rendimiento_potencial_pct)} %</strong></div>
          </div>
        </div>
      )}
    </Modal>
  );
}
