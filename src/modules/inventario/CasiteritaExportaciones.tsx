/* ============================================================
   MGG · Los Pinos · Casiterita — 🚢 Exportaciones (fase 3)
   Lotes (contenedores) agrupados por exportación: armar (con ley SGS e
   informe), despachar, deshacer, y salida a fundición desde las coladas.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  CONTENEDOR_KG, calcularLotes, errorNuevoLote, fechaTxt, hoyVE, kgTxt, leerNumero, numTxt, pctTxt, pmpTxt, saldoFinal, simularLote, usdTxt,
  type ColadaCas, type ExportacionCas, type FilaLibro, type LoteCalculado, type LoteCas,
} from './casiteritaPmp';
import {
  armarLoteCas, borrarInformeSgs, despacharLoteCas, deshacerLoteCas, faltaTabla, fundicionDesdeColadas, guardarSgsLoteCas,
  listExportacionesCas, listLotesCas, subirInformeSgs, urlInformeSgs,
} from './casiteritaPmp.repository';

interface Props {
  filas: FilaLibro[];
  canWrite: boolean;
  onCambioLibro: () => void;
}

export function ExportacionesCasiterita({ filas, canWrite, onCambioLibro }: Props) {
  const [expos, setExpos] = useState<ExportacionCas[]>([]);
  const [lotes, setLotes] = useState<LoteCas[]>([]);
  const [sinTablas, setSinTablas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armar, setArmar] = useState(false);
  const [despachar, setDespachar] = useState<LoteCalculado | null>(null);
  const [sgs, setSgs] = useState<LoteCalculado | null>(null);
  const [deshacer, setDeshacer] = useState<LoteCalculado | null>(null);
  const [anio, setAnio] = useState<string>(hoyVE().slice(0, 4));

  const cargar = useCallback(async () => {
    try {
      const [e, l] = await Promise.all([listExportacionesCas(), listLotesCas()]);
      setExpos(e); setLotes(l); setSinTablas(false); setError(null);
    } catch (err) {
      if (faltaTabla(err)) setSinTablas(true);
      else setError(err instanceof Error ? err.message : 'No se pudieron leer las exportaciones.');
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['casiterita_exportaciones', 'casiterita_lotes'], () => { void cargar(); }, { enabled: !sinTablas });

  const calc = useMemo(() => calcularLotes(lotes, filas), [lotes, filas]);
  const anios = useMemo(() => [...new Set(expos.map((e) => e.fecha.slice(0, 4)))].sort().reverse(), [expos]);
  const enGalpon = calc.filter((l) => l.estado === 'galpon');
  const delAnio = calc.filter((l) => !anio || l.fecha.slice(0, 4) === anio);
  const exposAnio = expos.filter((e) => !anio || e.fecha.slice(0, 4) === anio || calc.some((l) => l.exportacion_id === e.id && l.fecha.slice(0, 4) === anio));

  async function confirmarDeshacer() {
    if (!deshacer) return;
    try { await deshacerLoteCas(deshacer.id); toast(`Lote ${deshacer.codigo} deshecho: sus kg vuelven al libro.`, 'success'); setDeshacer(null); void cargar(); onCambioLibro(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo deshacer', 'error'); }
  }

  if (sinTablas) {
    return (
      <div className="card" style={{ borderLeft: '3px solid var(--warning)' }}>
        <strong>Falta preparar la base.</strong> Corre en Supabase <span className="mono">supabase/sql/casiterita-pmp-fase3-exportaciones.sql</span> y después su semilla con las exportaciones del Excel.
      </div>
    );
  }

  return (
    <>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}><strong>Error:</strong> {error}</div>}
      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <div className="kpi" style={{ borderTop: '3px solid var(--warning)' }}>
          <div className="icon">📦</div><div className="label">En galpón · por despachar</div>
          <div className="value" style={{ fontSize: '1.25rem' }}>{enGalpon.length} lote(s)</div>
          <div className="delta">{kgTxt(enGalpon.reduce((a, l) => a + l.kg, 0))}</div>
        </div>
        <div className="kpi">
          <div className="icon">🚢</div><div className="label">Exportaciones {anio || ''}</div>
          <div className="value" style={{ fontSize: '1.25rem' }}>{exposAnio.length}</div>
          <div className="delta">{delAnio.length} lote(s) · {kgTxt(delAnio.reduce((a, l) => a + l.kg, 0))}</div>
        </div>
        <div className="kpi">
          <div className="icon">⛏</div><div className="label">MGG exportado {anio || ''}</div>
          <div className="value" style={{ fontSize: '1.25rem' }}>{kgTxt(delAnio.reduce((a, l) => a + (l.kgMgg ?? 0), 0))}</div>
          <div className="delta">costo {usdTxt(delAnio.reduce((a, l) => a + (l.costo ?? 0), 0))}</div>
        </div>
        <div className="kpi">
          <div className="icon">🧪</div><div className="label">Estaño contenido (SGS)</div>
          <div className="value" style={{ fontSize: '1.25rem' }}>{kgTxt(delAnio.reduce((a, l) => a + (l.snKg ?? 0), 0))}</div>
          <div className="delta">{delAnio.filter((l) => l.ley_sgs).length} de {delAnio.length} lotes con ley</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="select" style={{ width: 'auto' }} value={anio} onChange={(e) => setAnio(e.target.value)}>
            <option value="">Todos los años</option>
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <span className="muted" style={{ fontSize: '.8rem' }}>Un contenedor = {numTxt(CONTENEDOR_KG, 0)} kg. Un lote se lleva de MGG la misma proporción que del galpón, al PMP.</span>
        </div>
        {canWrite && <button className="btn btn-primary" onClick={() => setArmar(true)}>🚢 Armar lote</button>}
      </div>

      {exposAnio.map((e) => {
        const ls = calc.filter((l) => l.exportacion_id === e.id).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.codigo.localeCompare(b.codigo));
        return (
          <div className="card" key={e.id} style={{ marginBottom: '.8rem' }}>
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
              <span>🚢 Exportación #{e.numero} <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>· {fechaTxt(e.fecha)}{e.comprador ? ` · ${e.comprador}` : ''}{e.destino ? ` · ${e.destino}` : ''}{e.historico ? ' · del Excel' : ''}</span></span>
              <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>{ls.length} lote(s) · {kgTxt(ls.reduce((a, l) => a + l.kg, 0))}</span>
            </div>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.8rem' }}>
                <thead><tr>
                  <th>Lote</th><th>Fecha</th><th style={{ textAlign: 'right' }}>Kg</th><th style={{ textAlign: 'right' }}>Kg MGG</th><th style={{ textAlign: 'right' }}>Resguardo</th>
                  <th style={{ textAlign: 'right' }}>PMP</th><th style={{ textAlign: 'right' }}>Costo MGG</th><th style={{ textAlign: 'right' }}>Muestras / merma</th>
                  <th style={{ textAlign: 'right' }}>Ley SGS</th><th>Precintos</th><th>Estado</th><th />
                </tr></thead>
                <tbody>
                  {ls.map((l) => (
                    <tr key={l.id}>
                      <td className="mono" style={{ fontWeight: 700 }}>{l.codigo}{l.motivo && <div className="muted" style={{ fontSize: '.7rem', fontWeight: 400, whiteSpace: 'normal' }}>{l.motivo}</div>}</td>
                      <td className="mono">{fechaTxt(l.fecha)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{numTxt(l.kg)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{l.kgMgg != null ? numTxt(l.kgMgg) : '—'}{l.pct != null && <div className="muted" style={{ fontSize: '.68rem' }}>{pctTxt(l.pct)} del galpón</div>}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{l.resguardoKg != null ? numTxt(l.resguardoKg) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{l.pmp != null ? pmpTxt(l.pmp) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{l.costo != null ? usdTxt(l.costo) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{l.muestras_kg || l.merma_kg ? `${numTxt(l.muestras_kg)} / ${numTxt(l.merma_kg)}` : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{l.ley_sgs != null ? `${numTxt(l.ley_sgs, 3)} %` : <span className="muted">—</span>}
                        {l.informe_sgs_path && <div><button className="btn btn-sm btn-ghost" style={{ padding: '0 .3rem' }} onClick={() => { void urlInformeSgs(l.informe_sgs_path!).then((u) => window.open(u, '_blank', 'noopener')).catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo abrir', 'error')); }}>📄 informe</button></div>}
                      </td>
                      <td className="mono" style={{ fontSize: '.72rem', whiteSpace: 'normal', maxWidth: 160 }}>{l.precintos ?? '—'}</td>
                      <td>{l.estado === 'galpon'
                        ? <span className="badge warning">📦 En galpón</span>
                        : <span className="badge success" title={l.despachado_por_name ?? ''}>🚢 Despachado{l.despachado_en ? ` ${fechaTxt(l.despachado_en)}` : ''}</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canWrite && l.estado === 'galpon' && <button className="btn btn-sm btn-primary" onClick={() => setDespachar(l)}>🚢 Despachar</button>}
                        {canWrite && <button className="btn btn-sm btn-ghost" title="Ley SGS, informe y precintos" onClick={() => setSgs(l)}>🧪</button>}
                        {canWrite && l.estado === 'galpon' && !l.delExcel && <button className="btn btn-sm btn-ghost" title="Deshacer el lote (armado por error)" onClick={() => setDeshacer(l)}>↩</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {!exposAnio.length && <div className="card muted" style={{ textAlign: 'center' }}>No hay exportaciones {anio ? `en ${anio}` : ''}.</div>}

      {armar && <ArmarLoteModal filas={filas} expos={expos} lotes={calc} onClose={() => setArmar(false)} onGuardado={() => { setArmar(false); void cargar(); onCambioLibro(); }} />}
      {despachar && <DespacharModal lote={despachar} onClose={() => setDespachar(null)} onGuardado={() => { setDespachar(null); void cargar(); }} />}
      {sgs && <SgsModal lote={sgs} onClose={() => setSgs(null)} onGuardado={() => { setSgs(null); void cargar(); }} />}
      {deshacer && (
        <ConfirmDialog title={`Deshacer el lote ${deshacer.codigo}`} danger confirmText="Deshacer"
          message={`Se borran del libro la salida del lote, sus muestras y su merma, y sus ${numTxt(deshacer.kg)} kg vuelven al saldo. Úsalo solo si se armó por error (todavía está en el galpón).`}
          onConfirm={() => void confirmarDeshacer()} onCancel={() => setDeshacer(null)} />
      )}
    </>
  );
}

/* ───────── Armar lote ───────── */
function ArmarLoteModal({ filas, expos, lotes, onClose, onGuardado }: {
  filas: FilaLibro[]; expos: ExportacionCas[]; lotes: LoteCalculado[]; onClose: () => void; onGuardado: () => void;
}) {
  const saldo = saldoFinal(filas);
  // Exportaciones que todavía tienen lotes en el galpón: a esas se les puede sumar otro contenedor.
  const abiertas = expos.filter((e) => lotes.some((l) => l.exportacion_id === e.id && l.estado === 'galpon'));
  const proxNum = (expos.reduce((m, e) => Math.max(m, e.numero), 0) || 0) + 1;
  const proxCod = `MGG-${String((lotes.reduce((m, l) => { const x = /^MGG-(\d+)$/.exec(l.codigo); return x ? Math.max(m, Number(x[1])) : m; }, 0) || 0) + 1).padStart(4, '0')}`;
  const [expo, setExpo] = useState<string>(abiertas[0]?.id ?? '');
  const [fecha, setFecha] = useState(hoyVE());
  const [kg, setKg] = useState(String(CONTENEDOR_KG));
  const [muestras, setMuestras] = useState('');
  const [merma, setMerma] = useState('');
  const [ley, setLey] = useState('');
  const [precintos, setPrecintos] = useState('');
  const [motivo, setMotivo] = useState('');
  const [comprador, setComprador] = useState('');
  const [destino, setDestino] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);

  const n = { fecha, kg: leerNumero(kg) ?? 0, muestras: leerNumero(muestras) ?? 0, merma: leerNumero(merma) ?? 0, motivo };
  const err = errorNuevoLote(n, filas);
  const sim = err ? null : simularLote(n, filas);
  const leyN = leerNumero(ley);
  const errLey = leyN != null && (leyN <= 0 || leyN > 100) ? 'La ley SGS va entre 0 y 100 %.' : null;
  const distinto = Math.abs(n.kg - CONTENEDOR_KG) > 0.001;

  async function guardar() {
    if (err || errLey) return;
    setGuardando(true);
    let path: string | null = null;
    try {
      if (archivo) path = await subirInformeSgs(archivo);
      await armarLoteCas({
        exportacionId: expo || null, fecha, kg: n.kg, muestras: n.muestras, merma: n.merma, ley: leyN,
        precintos: precintos || null, motivo: distinto ? motivo : null, informePath: path, comprador: comprador || null, destino: destino || null,
      });
      toast(`Lote armado${expo ? '' : ` en la exportación #${proxNum}`}: ya salió del libro y queda en el galpón por despachar.`, 'success');
      onGuardado();
    } catch (e) {
      await borrarInformeSgs(path);
      toast(e instanceof Error ? e.message : 'No se pudo armar el lote', 'error');
    } finally { setGuardando(false); }
  }

  return (
    <Modal title={`🚢 Armar lote ${proxCod}`} size="lg" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!!err || !!errLey || guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : '💾 Armar lote'}</button></>}>
      <p className="hint muted" style={{ marginTop: 0 }}>
        El código del lote y el número de exportación los pone el sistema. Al armarlo, el lote <strong>sale del libro</strong> (con sus muestras y merma) y queda <strong>📦 en galpón</strong> hasta que se despache.
        Hoy hay <strong>{kgTxt(saldo.global)}</strong> en el galpón.
      </p>
      <div className="form-grid">
        <div className="form-row"><label>Exportación</label>
          <select className="select" value={expo} onChange={(e) => setExpo(e.target.value)}>
            <option value="">＋ Nueva: exportación #{proxNum}</option>
            {abiertas.map((e) => <option key={e.id} value={e.id}>#{e.numero} · {fechaTxt(e.fecha)} (tiene lotes en galpón)</option>)}
          </select>
        </div>
        <div className="form-row"><label>Fecha en que se arma</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        {!expo && <div className="form-row"><label>Comprador (opcional)</label><input className="input" value={comprador} onChange={(e) => setComprador(e.target.value)} /></div>}
        {!expo && <div className="form-row"><label>Destino (opcional)</label><input className="input" value={destino} onChange={(e) => setDestino(e.target.value)} /></div>}
        <div className="form-row"><label>Kg del lote</label><input className="input mono" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} /></div>
        <div className="form-row"><label>Muestras (kg)</label><input className="input mono" inputMode="decimal" value={muestras} onChange={(e) => setMuestras(e.target.value)} placeholder="0" /></div>
        <div className="form-row"><label>Merma (kg)</label><input className="input mono" inputMode="decimal" value={merma} onChange={(e) => setMerma(e.target.value)} placeholder="0" /></div>
        <div className="form-row"><label>Ley SGS (% Sn)</label><input className="input mono" inputMode="decimal" value={ley} onChange={(e) => setLey(e.target.value)} placeholder="se puede cargar después" /></div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Precintos</label><input className="input mono" value={precintos} onChange={(e) => setPrecintos(e.target.value)} placeholder="ej. 36816231–36816238" /></div>
        {distinto && <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Motivo (el lote no es de {numTxt(CONTENEDOR_KG, 0)} kg)</label><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>}
        <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Informe SGS (PDF o foto, opcional)</label><input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></div>
      </div>
      <div className="card" style={{ margin: '.8rem 0 0' }}>
        {err || errLey ? <div style={{ color: 'var(--warning)', fontSize: '.85rem' }}>⚠ {err ?? errLey}</div> : sim && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.5rem', fontSize: '.82rem' }}>
            <div><div className="muted">Se lleva del galpón</div><strong className="mono">{pctTxt(sim.lote.pct ?? 0)}</strong></div>
            <div><div className="muted">Kg MGG que salen</div><strong className="mono">{kgTxt(-sim.lote.dM)}</strong></div>
            <div><div className="muted">Kg de resguardo</div><strong className="mono">{kgTxt(-sim.lote.dResg)}</strong></div>
            <div><div className="muted">Costo MGG (al PMP {pmpTxt(sim.lote.pmpAntes)})</div><strong className="mono">{usdTxt(-sim.lote.dC)}</strong></div>
            {leyN != null && !errLey && <div><div className="muted">Estaño contenido</div><strong className="mono">{kgTxt((n.kg * leyN) / 100)}</strong></div>}
            <div><div className="muted">Saldo global queda</div><strong className="mono">{kgTxt(sim.fin.global)}</strong></div>
            <div><div className="muted">Inventario MGG queda</div><strong className="mono">{kgTxt(sim.fin.mgg)}</strong></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ───────── Despachar ───────── */
function DespacharModal({ lote, onClose, onGuardado }: { lote: LoteCalculado; onClose: () => void; onGuardado: () => void }) {
  const [fecha, setFecha] = useState(hoyVE());
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    setGuardando(true);
    try { await despacharLoteCas(lote.id, fecha); toast(`Lote ${lote.codigo} despachado.`, 'success'); onGuardado(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo despachar', 'error'); }
    finally { setGuardando(false); }
  }
  return (
    <Modal title={`🚢 Despachar ${lote.codigo}`} size="sm" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!fecha || guardando} onClick={() => void guardar()}>🚢 Despachar</button></>}>
      <p className="hint muted" style={{ marginTop: 0 }}>El lote ya salió del libro al armarlo; despacharlo marca que dejó el galpón. {lote.ley_sgs == null && <strong>Todavía no tiene ley SGS.</strong>}</p>
      <div className="form-row"><label>Fecha de despacho</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
    </Modal>
  );
}

/* ───────── Ley SGS, informe y precintos ───────── */
function SgsModal({ lote, onClose, onGuardado }: { lote: LoteCalculado; onClose: () => void; onGuardado: () => void }) {
  const [ley, setLey] = useState(lote.ley_sgs != null ? String(lote.ley_sgs).replace('.', ',') : '');
  const [precintos, setPrecintos] = useState(lote.precintos ?? '');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [quitar, setQuitar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const leyN = leerNumero(ley);
  const errLey = leyN != null && (leyN <= 0 || leyN > 100) ? 'La ley SGS va entre 0 y 100 %.' : null;
  async function guardar() {
    if (errLey) return;
    setGuardando(true);
    let nuevo: string | null = null;
    try {
      if (archivo) nuevo = await subirInformeSgs(archivo);
      const path = nuevo ?? (quitar ? null : lote.informe_sgs_path);
      await guardarSgsLoteCas(lote.id, leyN, path, precintos || null);
      if ((nuevo || quitar) && lote.informe_sgs_path) await borrarInformeSgs(lote.informe_sgs_path);
      toast('Lote actualizado.', 'success'); onGuardado();
    } catch (e) {
      await borrarInformeSgs(nuevo);
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    } finally { setGuardando(false); }
  }
  return (
    <Modal title={`🧪 ${lote.codigo} · SGS y precintos`} size="md" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!!errLey || guardando} onClick={() => void guardar()}>💾 Guardar</button></>}>
      <div className="form-grid">
        <div className="form-row"><label>Ley SGS (% Sn)</label><input className="input mono" inputMode="decimal" value={ley} onChange={(e) => setLey(e.target.value)} /></div>
        <div className="form-row"><label>Estaño contenido</label><div className="mono" style={{ padding: '.45rem 0' }}>{leyN && !errLey ? kgTxt((lote.kg * leyN) / 100) : '—'}</div></div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Precintos</label><input className="input mono" value={precintos} onChange={(e) => setPrecintos(e.target.value)} /></div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>{lote.informe_sgs_path ? 'Reemplazar informe SGS' : 'Informe SGS (PDF o foto)'}</label><input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></div>
      </div>
      {errLey && <div style={{ color: 'var(--warning)', fontSize: '.85rem' }}>⚠ {errLey}</div>}
      {lote.informe_sgs_path && !archivo && (
        <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.85rem', marginTop: '.4rem' }}>
          <input type="checkbox" checked={quitar} onChange={(e) => setQuitar(e.target.checked)} /> Quitar el informe actual
        </label>
      )}
    </Modal>
  );
}

/* ───────── Fundición desde las coladas ───────── */
export function FundicionColadasModal({ coladas, filas, onClose, onGuardado }: {
  coladas: ColadaCas[]; filas: FilaLibro[]; onClose: () => void; onGuardado: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(coladas.map((c) => c.id)));
  const elegidas = coladas.filter((c) => sel.has(c.id));
  const sugerido = Math.round(elegidas.reduce((a, c) => a + c.kg, 0) * 100) / 100;
  const [kg, setKg] = useState<string>(String(sugerido).replace('.', ','));
  const [tocado, setTocado] = useState(false);
  useEffect(() => { if (!tocado) setKg(String(sugerido).replace('.', ',')); }, [sugerido, tocado]);
  const ultima = elegidas.reduce<string | null>((m, c) => (c.fecha && (!m || c.fecha > m) ? c.fecha : m), null);
  const [fecha, setFecha] = useState(ultima ?? hoyVE());
  const nums = elegidas.map((c) => c.colada_num);
  const [desc, setDesc] = useState('');
  const [guardando, setGuardando] = useState(false);
  const kgN = leerNumero(kg) ?? 0;
  const s = saldoFinal(filas);
  const err = !elegidas.length ? 'Elige al menos una colada.' : !(kgN > 0) ? 'Indica los kg.' : kgN > Math.min(s.global, s.mgg) + 0.001 ? `No hay tanto: saldo global ${kgTxt(s.global)}, inventario MGG ${kgTxt(s.mgg)}.` : !fecha ? 'Indica la fecha.' : null;
  const descFinal = desc.trim() || `Material para fundición Matanzas · colada${nums.length > 1 ? 's' : ''} ${nums.join(', ')}`;

  async function guardar() {
    if (err) return;
    setGuardando(true);
    try { await fundicionDesdeColadas(elegidas.map((c) => c.id), fecha, kgN, descFinal); toast('Salida a fundición cargada en el libro.', 'success'); onGuardado(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setGuardando(false); }
  }
  return (
    <Modal title="🔥 Salida a fundición desde las coladas" size="lg" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!!err || guardando} onClick={() => void guardar()}>💾 Cargar en el libro</button></>}>
      <p className="hint muted" style={{ marginTop: 0 }}>
        Estas coladas quemaron casiterita del inventario detallado y ninguna salida a fundición del libro las cubre. Elige las que corresponden a un mismo envío a Matanzas:
        sale del inventario MGG al PMP vigente. Los kg se proponen con lo que consumieron las coladas; ajústalos si lo enviado fue distinto.
      </p>
      <div className="table-wrap" style={{ marginBottom: '.6rem' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr><th /><th>Colada</th><th>Fecha</th><th style={{ textAlign: 'right' }}>Big bags</th><th style={{ textAlign: 'right' }}>Kg casiterita</th></tr></thead>
          <tbody>
            {coladas.map((c) => (
              <tr key={c.id}>
                <td><input type="checkbox" checked={sel.has(c.id)} onChange={(e) => setSel((x) => { const y = new Set(x); if (e.target.checked) y.add(c.id); else y.delete(c.id); return y; })} /></td>
                <td className="mono" style={{ fontWeight: 700 }}>#{c.colada_num}</td><td className="mono">{fechaTxt(c.fecha)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{c.bags}</td><td className="mono" style={{ textAlign: 'right' }}>{numTxt(c.kg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid">
        <div className="form-row"><label>Fecha del envío</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div className="form-row"><label>Kg que salieron</label><input className="input mono" inputMode="decimal" value={kg} onChange={(e) => { setTocado(true); setKg(e.target.value); }} /></div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Descripción</label><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={descFinal} /></div>
      </div>
      {err ? <div style={{ color: 'var(--warning)', fontSize: '.85rem', marginTop: '.4rem' }}>⚠ {err}</div>
        : <div className="muted" style={{ fontSize: '.82rem', marginTop: '.4rem' }}>Sale de MGG {kgTxt(kgN)} × {pmpTxt(s.pmp)} = <strong>{usdTxt(kgN * s.pmp)}</strong>.</div>}
    </Modal>
  );
}
