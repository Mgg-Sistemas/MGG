/* ============================================================
   MGG · Los Pinos · Casiterita — Libro de promedios (PMP)
   Vista completa (con «← Volver») dentro de ⛏ Casiterita de Los Pinos.
   Pestañas: Tablero · Libro · Procedencias (% MGG).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  BADGE_TIPO, ETIQUETA_TIPO, calcularEntrada, calcularLibro, errorNuevoMov, fechaTxt, hoyVE, kgTxt, leerNumero, mesDe,
  nombreMes, pctTxt, pmpTxt, resumenPorMes, saldoFinal, usdTxt, numTxt, cierresPorPasar, movDePropuesta, coladasPorPasar, cerradoHasta,
  type CierreMesPmp, type CierreRecepcionPmp, type ColadaCas, type FilaLibro, type MovPmp, type NuevoMovPmp, type ProcedenciaPmp, type PropuestaEntrada, type TipoMovPmp,
} from './casiteritaPmp';
import {
  borrarMovPmp, crearMovPmp, crearMovsPmp, faltaTabla, guardarProcedenciaPmp, listCierresCasiteritaPmp, listLibroPmp, listProcedenciasPmp,
  listColadasCasiterita, listColadasCubiertas, listCierresPmp,
} from './casiteritaPmp.repository';
import { ExportacionesCasiterita, FundicionColadasModal } from './CasiteritaExportaciones';
import { CierresCasiterita, ConteoCasiterita, SimuladorCasiterita } from './CasiteritaCierres';

type Pestana = 'tablero' | 'libro' | 'exportaciones' | 'cierres' | 'conteo' | 'simulador' | 'procedencias';

interface Props {
  actorName: string | null;
  canWrite: boolean;
  /** Reabrir un mes cerrado: solo administrador (la base lo vuelve a validar). */
  esAdmin?: boolean;
  onClose: () => void;
}

export function CasiteritaPmpView({ actorName, canWrite, esAdmin = false, onClose }: Props) {
  const [movs, setMovs] = useState<MovPmp[]>([]);
  const [procs, setProcs] = useState<ProcedenciaPmp[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sinTablas, setSinTablas] = useState(false);
  const [tab, setTab] = useState<Pestana>('tablero');
  const [nuevo, setNuevo] = useState(false);
  const [cierres, setCierres] = useState<CierreRecepcionPmp[]>([]);
  const [desdeRecep, setDesdeRecep] = useState(false);
  const [coladas, setColadas] = useState<ColadaCas[]>([]);
  const [cubiertas, setCubiertas] = useState<Set<string> | null>(null);
  const [fundicion, setFundicion] = useState(false);
  const [cierresMes, setCierresMes] = useState<CierreMesPmp[]>([]);
  const [sinCierres, setSinCierres] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [m, p, c] = await Promise.all([listLibroPmp(), listProcedenciasPmp(), listCierresCasiteritaPmp().catch(() => [] as CierreRecepcionPmp[])]);
      setMovs(m); setProcs(p); setCierres(c); setError(null); setSinTablas(false);
      // Fase 3: coladas que quemaron casiterita y qué salidas a fundición las cubren (sin la tabla: no avisa).
      const [co, cu] = await Promise.all([listColadasCasiterita().catch(() => [] as ColadaCas[]), listColadasCubiertas().catch(() => null)]);
      setColadas(co); setCubiertas(cu ? new Set(cu.keys()) : null);
      // Fase 4: meses cerrados (sin la tabla: el libro funciona sin cierres).
      try { setCierresMes(await listCierresPmp()); setSinCierres(false); }
      catch (e) { setCierresMes([]); setSinCierres(faltaTabla(e)); }
    } catch (e) {
      if (faltaTabla(e)) setSinTablas(true);
      else setError(e instanceof Error ? e.message : 'No se pudo leer el libro.');
    } finally { setCargando(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['casiterita_libro', 'casiterita_procedencias_pmp', 'recepcion_cierres', 'casiterita_fundicion_coladas', 'produccion_colada', 'casiterita_cierres_pmp'], () => { void cargar(); }, { enabled: !sinTablas });

  const filas = useMemo(() => calcularLibro(movs), [movs]);
  const saldo = useMemo(() => saldoFinal(filas), [filas]);
  const porPasar = useMemo(() => cierresPorPasar(cierres, movs, procs), [cierres, movs, procs]);
  const hasta = useMemo(() => cerradoHasta(cierresMes), [cierresMes]);
  const coladasPend = useMemo(() => (cubiertas ? coladasPorPasar(coladas, cubiertas, filas) : []), [coladas, cubiertas, filas]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={onClose}>← Volver</button>
          <h2 style={{ margin: 0 }}>📒 Casiterita · Libro de promedios</h2>
          <span className="muted" style={{ fontSize: '.8rem' }}>Los Pinos · costo promedio ponderado (PMP)</span>
        </div>
        {canWrite && !sinTablas && (tab === 'tablero' || tab === 'libro') && (
          <button className="btn btn-primary" onClick={() => setNuevo(true)}>＋ Movimiento</button>
        )}
      </div>

      {sinTablas ? (
        <div className="card" style={{ borderLeft: '3px solid var(--warning)' }}>
          <strong>Falta preparar la base.</strong> Corre en Supabase <span className="mono">supabase/sql/casiterita-pmp-fase1-libro.sql</span> (crea el libro) y después la semilla con los movimientos del Excel.
        </div>
      ) : error ? (
        <div className="card" style={{ borderColor: 'var(--danger)' }}><strong>Error:</strong> {error}</div>
      ) : cargando ? (
        <div className="card muted">Cargando el libro…</div>
      ) : (
        <>
          <KpisSaldo filas={filas} />
          {porPasar.length > 0 && (
            <div className="card" style={{ borderLeft: '3px solid var(--warning)', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
              <span>📥 <strong>{porPasar.length} cierre(s) de recepción</strong> entraron casiterita al almacén y todavía no están en el libro
                <span className="muted"> ({porPasar.map((p) => `#${p.cierre.numero}`).join(', ')} · {kgTxt(porPasar.reduce((a, p) => a + p.kg, 0))})</span>.</span>
              {canWrite && <button className="btn btn-sm btn-primary" onClick={() => setDesdeRecep(true)}>Pasarlos al libro</button>}
            </div>
          )}
          {coladasPend.length > 0 && (
            <div className="card" style={{ borderLeft: '3px solid var(--danger)', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
              <span>🔥 <strong>{coladasPend.length} colada(s)</strong> quemaron casiterita del inventario detallado y no hay salida a fundición en el libro que las cubra
                <span className="muted"> ({coladasPend.map((c) => `#${c.colada_num}`).join(', ')} · {kgTxt(coladasPend.reduce((a, c) => a + c.kg, 0))})</span>.</span>
              {canWrite && <button className="btn btn-sm btn-primary" onClick={() => setFundicion(true)}>Cargar la salida a fundición</button>}
            </div>
          )}
          <div className="view-toggle" role="tablist" style={{ margin: '0 0 1rem' }}>
            <button className={tab === 'tablero' ? 'active' : ''} onClick={() => setTab('tablero')}>📊 Tablero</button>
            <button className={tab === 'libro' ? 'active' : ''} onClick={() => setTab('libro')}>📒 Libro</button>
            <button className={tab === 'exportaciones' ? 'active' : ''} onClick={() => setTab('exportaciones')}>🚢 Exportaciones</button>
            <button className={tab === 'cierres' ? 'active' : ''} onClick={() => setTab('cierres')}>🗓 Cierres y reportes</button>
            <button className={tab === 'conteo' ? 'active' : ''} onClick={() => setTab('conteo')}>⚖ Conteo físico</button>
            <button className={tab === 'simulador' ? 'active' : ''} onClick={() => setTab('simulador')}>🧮 Simulador</button>
            <button className={tab === 'procedencias' ? 'active' : ''} onClick={() => setTab('procedencias')}>⚙ % MGG por procedencia</button>
          </div>
          {tab === 'tablero' && <Tablero filas={filas} />}
          {tab === 'libro' && <Libro filas={filas} canWrite={canWrite} hasta={hasta} onCambio={cargar} />}
          {tab === 'exportaciones' && <ExportacionesCasiterita filas={filas} canWrite={canWrite} hasta={hasta} onCambioLibro={() => { void cargar(); }} />}
          {tab === 'cierres' && <CierresCasiterita filas={filas} cierres={cierresMes} canWrite={canWrite} esAdmin={esAdmin} sinTablas={sinCierres} onCambio={() => { void cargar(); }} />}
          {tab === 'conteo' && <ConteoCasiterita filas={filas} cierres={cierresMes} canWrite={canWrite} onCambio={() => { void cargar(); }} />}
          {tab === 'simulador' && <SimuladorCasiterita filas={filas} />}
          {tab === 'procedencias' && <Procedencias procs={procs} canWrite={canWrite} actorName={actorName} onCambio={cargar} />}
        </>
      )}

      {fundicion && (
        <FundicionColadasModal coladas={coladasPend} filas={filas} hasta={hasta}
          onClose={() => setFundicion(false)} onGuardado={() => { setFundicion(false); void cargar(); }} />
      )}
      {desdeRecep && (
        <DesdeRecepcionesModal propuestas={porPasar} procs={procs} filas={filas} hasta={hasta} actorName={actorName}
          onClose={() => setDesdeRecep(false)} onGuardado={() => { setDesdeRecep(false); void cargar(); }} />
      )}
      {nuevo && (
        <NuevoMovModal filas={filas} procs={procs} hasta={hasta} actorName={actorName} saldoGlobal={saldo.global}
          onClose={() => setNuevo(false)} onGuardado={() => { setNuevo(false); void cargar(); }} />
      )}
    </div>
  );
}

/* ───────── Aviso en ⛏ Casiterita: cierres de recepción que faltan en el libro ───────── */
export function AvisoCierresPorPasar({ onAbrir }: { onAbrir: () => void }) {
  const [n, setN] = useState<{ cant: number; kg: number } | null>(null);
  const cargar = useCallback(() => {
    Promise.all([listLibroPmp(), listProcedenciasPmp(), listCierresCasiteritaPmp()])
      .then(([m, p, c]) => { const r = cierresPorPasar(c, m, p); setN({ cant: r.length, kg: r.reduce((a, x) => a + x.kg, 0) }); })
      .catch(() => setN(null)); // sin la tabla o sin permiso: no avisa
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['casiterita_libro', 'recepcion_cierres'], cargar);
  if (!n || !n.cant) return null;
  return (
    <div className="card" style={{ borderLeft: '3px solid var(--warning)', marginBottom: '.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', fontSize: '.86rem' }}>
      <span>📥 <strong>{n.cant} cierre(s) de recepción</strong> ({kgTxt(n.kg)}) entraron casiterita y faltan en el <strong>libro de promedios</strong>.</span>
      <button className="btn btn-sm btn-primary" onClick={onAbrir}>Abrir el libro</button>
    </div>
  );
}

/* ───────── KPIs ───────── */
function Kpi({ icono, label, valor, sub, color }: { icono: string; label: string; valor: string; sub?: string; color?: string }) {
  return (
    <div className="kpi" style={color ? { borderTop: `3px solid ${color}` } : undefined}>
      <div className="icon">{icono}</div>
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: '1.25rem' }}>{valor}</div>
      {sub && <div className="delta">{sub}</div>}
    </div>
  );
}

export function KpisSaldo({ filas }: { filas: FilaLibro[] }) {
  const s = saldoFinal(filas);
  return (
    <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
      <Kpi icono="⚖" label="Saldo global (galpón)" valor={kgTxt(s.global)} sub={`${numTxt(s.global / 1000, 3)} t · al ${fechaTxt(s.fecha)}`} color="var(--primary, #ff8a00)" />
      <Kpi icono="⛏" label="Inventario MGG" valor={kgTxt(s.mgg)} sub={s.global > 0 ? `${pctTxt(s.mgg / s.global)} del galpón` : undefined} color="var(--success, #29c081)" />
      <Kpi icono="🤝" label="Resguardo (aliados)" valor={kgTxt(s.resguardo)} sub="sin costo para MGG" color="var(--info, #4aa8ff)" />
      <Kpi icono="💲" label="PMP vigente" valor={pmpTxt(s.pmp)} sub="$ por kg MGG" />
      <Kpi icono="💰" label="Costo total MGG" valor={usdTxt(s.costo)} sub="inventario MGG × PMP" />
    </div>
  );
}

/* ───────── Tablero ───────── */
function Tablero({ filas }: { filas: FilaLibro[] }) {
  const meses = useMemo(() => resumenPorMes(filas).reverse(), [filas]);
  const ultimos = filas.slice(-8).reverse();
  return (
    <>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title">🗓 Cierre por mes <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>(lo que eran las hojas «Cierre Promedio»)</span></div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr>
              <th>Mes</th><th style={{ textAlign: 'right' }}>Abre (global)</th><th style={{ textAlign: 'right' }}>Entró</th><th style={{ textAlign: 'right' }}>Salió</th>
              <th style={{ textAlign: 'right' }}>Exportado</th><th style={{ textAlign: 'right' }}>Cierra (global)</th><th style={{ textAlign: 'right' }}>Inv. MGG</th>
              <th style={{ textAlign: 'right' }}>Resguardo</th><th style={{ textAlign: 'right' }}>Costo MGG</th><th style={{ textAlign: 'right' }}>PMP</th>
            </tr></thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m.mes}>
                  <td style={{ fontWeight: 700 }}>{nombreMes(m.mes)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{numTxt(m.apertura.global)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{m.entradasKg ? `+${numTxt(m.entradasKg)}` : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>{m.salidasKg ? `−${numTxt(m.salidasKg)}` : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{m.exportadoKg ? numTxt(m.exportadoKg) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{numTxt(m.cierre.global)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{numTxt(m.cierre.mgg)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{numTxt(m.cierre.resguardo)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{usdTxt(m.cierre.costo)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{pmpTxt(m.cierre.pmp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-title">🕑 Últimos movimientos</div>
        <TablaLibro filas={ultimos} />
      </div>
    </>
  );
}

/* ───────── Libro ───────── */
function Libro({ filas, canWrite, hasta, onCambio }: { filas: FilaLibro[]; canWrite: boolean; hasta: string | null; onCambio: () => void }) {
  const meses = useMemo(() => [...new Set(filas.map((f) => mesDe(f.fecha)))].reverse(), [filas]);
  const [mes, setMes] = useState<string>('');
  const [tipo, setTipo] = useState<TipoMovPmp | ''>('');
  const [borrar, setBorrar] = useState<FilaLibro | null>(null);
  const vis = filas.filter((f) => (!mes || mesDe(f.fecha) === mes) && (!tipo || f.tipo === tipo));

  async function confirmarBorrar() {
    if (!borrar) return;
    try { await borrarMovPmp(borrar.id); toast('Movimiento borrado: el libro se recalculó.', 'success'); setBorrar(null); onCambio(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <select className="select" style={{ width: 'auto' }} value={mes} onChange={(e) => setMes(e.target.value)}>
          <option value="">Todos los meses</option>
          {meses.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovPmp | '')}>
          <option value="">Todos los tipos</option>
          {(Object.keys(ETIQUETA_TIPO) as TipoMovPmp[]).map((t) => <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>)}
        </select>
        <span className="muted" style={{ fontSize: '.8rem' }}>{vis.length} movimiento(s)</span>
      </div>
      <TablaLibro filas={vis} hasta={hasta} onBorrar={canWrite ? setBorrar : undefined} />
      {borrar && (
        <ConfirmDialog title="Borrar movimiento" danger confirmText="Borrar"
          message={`¿Borrar «${borrar.descripcion}» del ${fechaTxt(borrar.fecha)}? Los saldos y el PMP de lo que viene después se recalculan.`}
          onConfirm={() => void confirmarBorrar()} onCancel={() => setBorrar(null)} />
      )}
    </div>
  );
}

const signo = (v: number, d = 2) => (Math.abs(v) < 0.0005 ? '—' : `${v > 0 ? '+' : '−'}${numTxt(Math.abs(v), d)}`);

export function TablaLibro({ filas, onBorrar, hasta = null }: { filas: FilaLibro[]; onBorrar?: (f: FilaLibro) => void; hasta?: string | null }) {
  return (
    <div className="table-wrap">
      <table className="table" style={{ fontSize: '.8rem' }}>
        <thead><tr>
          <th>Fecha</th><th>Movimiento</th>
          <th style={{ textAlign: 'right' }}>Δ Global</th><th style={{ textAlign: 'right' }}>Δ MGG</th><th style={{ textAlign: 'right' }}>Costo</th>
          <th style={{ textAlign: 'right' }}>Saldo global</th><th style={{ textAlign: 'right' }}>Inv. MGG</th><th style={{ textAlign: 'right' }}>Resguardo</th>
          <th style={{ textAlign: 'right' }}>Costo MGG</th><th style={{ textAlign: 'right' }}>PMP</th>{onBorrar && <th />}
        </tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fechaTxt(f.fecha)}</td>
              <td style={{ minWidth: 220, whiteSpace: 'normal' }}>
                <span className={`badge ${BADGE_TIPO[f.tipo]}`} style={{ fontSize: '.64rem', marginRight: '.35rem' }}>{ETIQUETA_TIPO[f.tipo]}</span>
                {f.descripcion}
                <div className="muted" style={{ fontSize: '.7rem' }}>
                  {f.tipo === 'entrada' && f.pct_mgg != null ? `${numTxt(f.pct_mgg, 0)} % MGG${f.tasa ? ` · tasa ${numTxt(f.tasa, 4)}` : ''} · ` : ''}
                  {f.tipo === 'exportacion' && f.pct != null ? `se lleva ${pctTxt(f.pct)} del galpón · ${numTxt(-f.dM)} kg MGG a ${pmpTxt(f.pmpAntes)} · ` : ''}
                  {f.tipo === 'merma' && !f.afecta_mgg ? 'no bajó el inventario MGG · ' : ''}
                  {f.origen === 'excel' ? 'del Excel' : f.actor_name ?? ''}
                </div>
              </td>
              <td className="mono" style={{ textAlign: 'right', color: f.dG >= 0 ? 'var(--success)' : 'var(--danger)' }}>{signo(f.dG)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{signo(f.dM)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{Math.abs(f.dC) < 0.005 ? '—' : `${f.dC > 0 ? '+' : '−'}${usdTxt(Math.abs(f.dC))}`}</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{numTxt(f.G)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{numTxt(f.M)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{numTxt(f.resguardo)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{usdTxt(f.C)}</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{pmpTxt(f.pmp)}</td>
              {onBorrar && (
                <td>{f.origen === 'sistema' && f.tipo !== 'apertura' && !f.lote_id && !(hasta && mesDe(f.fecha) <= hasta)
                  ? <button className="btn btn-sm btn-ghost" title="Borrar" onClick={() => onBorrar(f)}>🗑</button> : null}</td>
              )}
            </tr>
          ))}
          {!filas.length && <tr><td colSpan={onBorrar ? 11 : 10} className="muted" style={{ textAlign: 'center', padding: '1.2rem' }}>Sin movimientos.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ───────── Nuevo movimiento ───────── */
type TipoManual = Exclude<TipoMovPmp, 'apertura' | 'exportacion'>;
const TIPOS_MANUALES: { t: TipoManual; label: string; ayuda: string }[] = [
  { t: 'entrada', label: '📥 Entrada', ayuda: 'Material que entra al galpón. La parte MGG (según el % de la procedencia) entra con su costo; el resto es resguardo.' },
  { t: 'recuperacion', label: '♻ Recuperación', ayuda: 'Sacudida de bolsas u otro material recuperado: entra al inventario MGG a costo 0 (baja el PMP).' },
  { t: 'muestra', label: '🧪 Muestra', ayuda: 'Sale del inventario MGG al PMP vigente.' },
  { t: 'merma', label: '📉 Merma', ayuda: 'Sale al PMP vigente. Si no se debe descontar de MGG, desmarca la casilla.' },
  { t: 'fundicion', label: '🔥 Fundición', ayuda: 'Material enviado a Matanzas para coladas: sale del inventario MGG al PMP.' },
  { t: 'ajuste', label: '⚖ Ajuste', ayuda: 'Diferencia por repesaje o conteo físico: faltante (sale) o sobrante (entra) al PMP.' },
];

function NuevoMovModal({ filas, procs, hasta, actorName, saldoGlobal, onClose, onGuardado }: {
  filas: FilaLibro[]; procs: ProcedenciaPmp[]; hasta: string | null; actorName: string | null; saldoGlobal: number; onClose: () => void; onGuardado: () => void;
}) {
  const [tipo, setTipo] = useState<TipoManual>('entrada');
  const [fecha, setFecha] = useState(hoyVE());
  const [desc, setDesc] = useState('');
  const [kg, setKg] = useState('');
  const [proc, setProc] = useState('');
  const [pct, setPct] = useState('100');
  const [tasa, setTasa] = useState('');
  const [afecta, setAfecta] = useState(true);
  const [sobra, setSobra] = useState(false);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const p = procs.find((x) => x.clave === proc) ?? null;
  useEffect(() => { if (p) setPct(String(p.pct_mgg).replace('.', ',')); }, [p]);
  const kgN = leerNumero(kg) ?? 0;
  const mov: NuevoMovPmp = tipo === 'entrada'
    ? { fecha, tipo, descripcion: desc || (p ? `Entrada · ${p.clave} ${p.nombre}` : ''), kg_global: kgN, pct_mgg: leerNumero(pct), tasa: leerNumero(tasa), procedencia: proc || null }
    : { fecha, tipo, descripcion: desc, kg: tipo === 'ajuste' && sobra ? -kgN : kgN, afecta_mgg: tipo === 'merma' ? afecta : true };
  const err = errorNuevoMov(mov, filas, hasta);

  // Cómo queda el libro con este movimiento.
  const despues = useMemo(() => {
    if (err) return null;
    const ent = tipo === 'entrada' ? calcularEntrada(kgN, Number(mov.pct_mgg ?? 0), Number(mov.tasa ?? 0)) : null;
    const temp: MovPmp = {
      id: 'tmp', fecha, tipo, descripcion: mov.descripcion, kg: tipo === 'entrada' ? null : Number(mov.kg),
      kg_global: tipo === 'entrada' ? kgN : null, kg_mgg: ent?.kgMgg ?? null, costo: ent?.costo ?? null,
      afecta_mgg: mov.afecta_mgg !== false, procedencia: null, pct_mgg: null, tasa: null, recepcion_numero: null, cierre_id: null,
      lote_id: null, colada_id: null, origen: 'sistema', orden: Number.MAX_SAFE_INTEGER, nota: null, actor_name: null, created_at: '',
    };
    const f = calcularLibro([...filas, temp]);
    return { fila: f.find((x) => x.id === 'tmp')!, fin: saldoFinal(f), ent };
  }, [err, tipo, kgN, mov.pct_mgg, mov.tasa, mov.kg, mov.afecta_mgg, mov.descripcion, fecha, filas]);

  async function guardar() {
    if (err) { toast(err, 'warning'); return; }
    setGuardando(true);
    try { await crearMovPmp(mov, { nota }, actorName); toast('Movimiento cargado en el libro.', 'success'); onGuardado(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setGuardando(false); }
  }

  const ayuda = TIPOS_MANUALES.find((x) => x.t === tipo)?.ayuda;
  return (
    <Modal title="＋ Movimiento en el libro de promedios" size="lg" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!!err || guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : '💾 Cargar'}</button></>}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginBottom: '.6rem' }}>
        {TIPOS_MANUALES.map((x) => (
          <button key={x.t} type="button" className={`btn btn-sm ${tipo === x.t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTipo(x.t)}>{x.label}</button>
        ))}
      </div>
      {ayuda && <p className="hint muted" style={{ marginTop: 0 }}>{ayuda} Los lotes de exportación se arman en la pestaña 🚢 Exportaciones.</p>}
      <div className="form-grid">
        <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        {tipo === 'entrada' && (
          <div className="form-row"><label>Procedencia</label>
            <select className="select" value={proc} onChange={(e) => setProc(e.target.value)}>
              <option value="">— Elegir —</option>
              {procs.filter((x) => x.activo).map((x) => <option key={x.clave} value={x.clave}>{x.clave} · {x.nombre} ({numTxt(x.pct_mgg, 0)} % MGG)</option>)}
            </select>
          </div>
        )}
        <div className="form-row"><label>{tipo === 'entrada' ? 'Kg que entran (global)' : 'Kg'}</label>
          <input className="input mono" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="ej. 1.250,5" />
        </div>
        {tipo === 'entrada' && (<>
          <div className="form-row"><label>% MGG</label><input className="input mono" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></div>
          <div className="form-row"><label>Tasa ($ por kg MGG)</label><input className="input mono" inputMode="decimal" value={tasa} onChange={(e) => setTasa(e.target.value)} placeholder="ej. 15,00" /></div>
        </>)}
        {tipo === 'ajuste' && (
          <div className="form-row"><label>El ajuste es</label>
            <select className="select" value={sobra ? 'sobra' : 'falta'} onChange={(e) => setSobra(e.target.value === 'sobra')}>
              <option value="falta">Faltante (sale del libro)</option><option value="sobra">Sobrante (entra al libro)</option>
            </select>
          </div>
        )}
        <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Descripción</label>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder={tipo === 'entrada' ? 'Se arma sola con la procedencia si la dejas vacía' : tipo === 'fundicion' ? 'ej. Material para fundición Matanzas · coladas 12 a 15' : 'ej. Muestras exportación #60'} />
        </div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Nota (opcional)</label><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
      </div>
      {tipo === 'merma' && (
        <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.85rem', marginTop: '.4rem' }}>
          <input type="checkbox" checked={afecta} onChange={(e) => setAfecta(e.target.checked)} /> Descontar también del inventario MGG (lo normal)
        </label>
      )}

      <div className="card" style={{ margin: '.8rem 0 0', background: 'var(--bg-2, rgba(255,255,255,.03))' }}>
        {err ? <div style={{ color: 'var(--warning)', fontSize: '.85rem' }}>⚠ {err}</div> : despues && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.5rem', fontSize: '.82rem' }}>
            {despues.ent && <div><div className="muted">Parte MGG · costo</div><strong className="mono">{kgTxt(despues.ent.kgMgg)} · {usdTxt(despues.ent.costo)}</strong></div>}
            {despues.ent && <div><div className="muted">Resguardo (aliado)</div><strong className="mono">{kgTxt(kgN - despues.ent.kgMgg)}</strong></div>}
            {!despues.ent && <div><div className="muted">Sale de MGG · costo</div><strong className="mono">{kgTxt(-despues.fila.dM)} · {usdTxt(-despues.fila.dC)}</strong></div>}
            <div><div className="muted">Saldo global queda</div><strong className="mono">{kgTxt(despues.fin.global)}</strong> <span className="muted">(hoy {kgTxt(saldoGlobal)})</span></div>
            <div><div className="muted">Inventario MGG queda</div><strong className="mono">{kgTxt(despues.fin.mgg)}</strong></div>
            <div><div className="muted">PMP queda</div><strong className="mono">{pmpTxt(despues.fin.pmp)}</strong></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ───────── Fase 2 · Entradas desde los cierres de recepción ───────── */
interface Edicion { usar: boolean; proc: string; pct: string; tasa: string }

function DesdeRecepcionesModal({ propuestas, procs, filas, hasta, actorName, onClose, onGuardado }: {
  propuestas: PropuestaEntrada[]; procs: ProcedenciaPmp[]; filas: FilaLibro[]; hasta: string | null; actorName: string | null; onClose: () => void; onGuardado: () => void;
}) {
  const [ed, setEd] = useState<Record<string, Edicion>>(() => Object.fromEntries(propuestas.map((p) => [p.cierre.id, {
    usar: true, proc: p.procedencia?.clave ?? '', pct: String(p.pct).replace('.', ','), tasa: p.tasa ? String(p.tasa).replace('.', ',') : '',
  }])));
  const [guardando, setGuardando] = useState(false);
  const set = (id: string, patch: Partial<Edicion>) => setEd((x) => ({ ...x, [id]: { ...x[id], ...patch } }));

  const lineas = propuestas.map((p) => {
    const e = ed[p.cierre.id] ?? { usar: false, proc: '', pct: '100', tasa: '' };
    const proc = procs.find((x) => x.clave === e.proc) ?? null;
    const pct = leerNumero(e.pct) ?? 0;
    const tasa = leerNumero(e.tasa) ?? 0;
    const mov = movDePropuesta(p, proc, pct, tasa);
    const err = !e.usar ? null : !proc ? 'Elige la procedencia.' : errorNuevoMov(mov, filas, hasta);
    const { kgMgg, costo } = calcularEntrada(p.kg, pct, tasa);
    return { p, e, mov, err, kgMgg, costo };
  });
  const elegidas = lineas.filter((l) => l.e.usar);
  const hayError = elegidas.some((l) => l.err);

  async function guardar() {
    if (!elegidas.length || hayError) return;
    setGuardando(true);
    try {
      await crearMovsPmp(elegidas.map((l) => ({ m: l.mov, extra: { cierre_id: l.p.cierre.id, recepcion_numero: l.p.cierre.numero } })), actorName);
      toast(`${elegidas.length} entrada(s) pasadas al libro.`, 'success');
      onGuardado();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setGuardando(false); }
  }

  return (
    <Modal title="📥 Entradas desde los cierres de recepción" size="xl" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!elegidas.length || hayError || guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : `💾 Pasar ${elegidas.length} al libro`}</button></>}>
      <p className="hint muted" style={{ marginTop: 0 }}>
        Cada cierre trae los kg que entraron al almacén de casiterita y su tasa final. La procedencia se reconoce por el nombre del grupo de recepción y de ahí sale el % MGG:
        la parte MGG entra con costo (kg MGG × tasa) y el resto queda como resguardo. Revisa y ajusta antes de pasarlas: un cierre entra una sola vez.
      </p>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.8rem' }}>
          <thead><tr>
            <th /><th>Cierre</th><th>Fecha</th><th>Grupo de recepción</th><th style={{ textAlign: 'right' }}>Kg</th>
            <th>Procedencia</th><th style={{ textAlign: 'right' }}>% MGG</th><th style={{ textAlign: 'right' }}>Tasa</th>
            <th style={{ textAlign: 'right' }}>Kg MGG</th><th style={{ textAlign: 'right' }}>Resguardo</th><th style={{ textAlign: 'right' }}>Costo</th>
          </tr></thead>
          <tbody>
            {lineas.map(({ p, e, err, kgMgg, costo }) => (
              <tr key={p.cierre.id} style={{ opacity: e.usar ? 1 : 0.5 }}>
                <td><input type="checkbox" checked={e.usar} onChange={(ev) => set(p.cierre.id, { usar: ev.target.checked })} /></td>
                <td className="mono" style={{ fontWeight: 700 }}>#{p.cierre.numero}</td>
                <td className="mono">{fechaTxt(p.fecha)}</td>
                <td style={{ whiteSpace: 'normal' }}>{p.cierre.grupo_nombre ?? '—'}{err && <div style={{ color: 'var(--warning)', fontSize: '.72rem' }}>⚠ {err}</div>}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{numTxt(p.kg)}</td>
                <td>
                  <select className="select" style={{ width: 'auto', fontSize: '.78rem' }} value={e.proc} onChange={(ev) => {
                    const pr = procs.find((x) => x.clave === ev.target.value);
                    set(p.cierre.id, { proc: ev.target.value, ...(pr ? { pct: String(pr.pct_mgg).replace('.', ',') } : {}) });
                  }}>
                    <option value="">— Elegir —</option>
                    {procs.filter((x) => x.activo).map((x) => <option key={x.clave} value={x.clave}>{x.clave} · {x.nombre}</option>)}
                  </select>
                </td>
                <td><input className="input mono" style={{ width: 64, textAlign: 'right' }} value={e.pct} onChange={(ev) => set(p.cierre.id, { pct: ev.target.value })} /></td>
                <td><input className="input mono" style={{ width: 80, textAlign: 'right' }} value={e.tasa} onChange={(ev) => set(p.cierre.id, { tasa: ev.target.value })} placeholder="tasa" /></td>
                <td className="mono" style={{ textAlign: 'right' }}>{numTxt(kgMgg)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{numTxt(p.kg - kgMgg)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{usdTxt(costo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ───────── Procedencias ───────── */
function Procedencias({ procs, canWrite, actorName, onCambio }: { procs: ProcedenciaPmp[]; canWrite: boolean; actorName: string | null; onCambio: () => void }) {
  const [edit, setEdit] = useState<(ProcedenciaPmp & { nueva?: boolean }) | null>(null);
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    if (!edit) return;
    setGuardando(true);
    try { await guardarProcedenciaPmp(edit, actorName, !!edit.nueva); toast('Procedencia guardada.', 'success'); setEdit(null); onCambio(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setGuardando(false); }
  }
  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
        <span>⚙ % que le toca a MGG en cada procedencia</span>
        {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setEdit({ clave: '', nombre: '', pct_mgg: 100, patron: '', nota: '', activo: true, nueva: true })}>＋ Procedencia</button>}
      </div>
      <p className="hint muted" style={{ marginTop: 0 }}>Lo que no es de MGG queda como <strong>resguardo</strong> del aliado: ocupa galpón pero no tiene costo para MGG. Cambiar un % solo afecta las entradas que se carguen desde ahora.</p>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.84rem' }}>
          <thead><tr><th>Clave</th><th>Nombre</th><th style={{ textAlign: 'right' }}>% MGG</th><th>Reconoce el grupo de recepción por</th><th>Nota</th><th>Estado</th>{canWrite && <th />}</tr></thead>
          <tbody>
            {procs.map((p) => (
              <tr key={p.clave}>
                <td className="mono" style={{ fontWeight: 700 }}>{p.clave}</td><td>{p.nombre}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{numTxt(p.pct_mgg, 0)} %</td>
                <td className="mono muted">{p.patron ?? '—'}</td><td className="muted">{p.nota ?? ''}</td>
                <td>{p.activo ? <span className="badge success">Activa</span> : <span className="badge">Inactiva</span>}</td>
                {canWrite && <td><button className="btn btn-sm btn-ghost" onClick={() => setEdit({ ...p })}>✏</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.nueva ? '＋ Procedencia' : `✏ ${edit.clave}`} size="md" onClose={() => setEdit(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancelar</button><button className="btn btn-primary" disabled={guardando} onClick={() => void guardar()}>💾 Guardar</button></>}>
          <div className="form-grid">
            <div className="form-row"><label>Clave</label><input className="input mono" value={edit.clave} disabled={!edit.nueva} onChange={(e) => setEdit({ ...edit, clave: e.target.value })} placeholder="ej. P-MGG12" /></div>
            <div className="form-row"><label>Nombre</label><input className="input" value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></div>
            <div className="form-row"><label>% MGG</label><input className="input mono" inputMode="decimal" value={String(edit.pct_mgg).replace('.', ',')} onChange={(e) => setEdit({ ...edit, pct_mgg: leerNumero(e.target.value) ?? 0 })} /></div>
            <div className="form-row"><label>Palabras del grupo (separadas por |)</label><input className="input mono" value={edit.patron ?? ''} onChange={(e) => setEdit({ ...edit, patron: e.target.value })} placeholder="ej. NAVIL|VENTUARI" /></div>
            <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Nota</label><input className="input" value={edit.nota ?? ''} onChange={(e) => setEdit({ ...edit, nota: e.target.value })} /></div>
          </div>
          <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginTop: '.5rem' }}><input type="checkbox" checked={edit.activo} onChange={(e) => setEdit({ ...edit, activo: e.target.checked })} /> Activa</label>
        </Modal>
      )}
    </div>
  );
}
