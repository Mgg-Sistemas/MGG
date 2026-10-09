/* ============================================================
   MGG · RRHH · «📊 Resumen de nómina» (09-10-2026)
   Una tabla con lo que cobró cada persona —por una nómina o en general
   (todas, con rango de fechas y estado)— eligiendo con casillas qué
   columnas salen, con totales al pie, y en Excel o PDF para imprimir.
   La cuenta es la del recibo (`calcularRecibo`): acá no se recalcula nada.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { NominaRenglon, Personal } from '@/shared/lib/types';
import { listCajas } from '@/modules/salidas/cajas.repository';
import { listNominas, listRenglones, type NominaPeriodoResumen } from './nomina.repository';
import { listPersonal } from './personal.repository';
import type { Empresa } from './empresa';
import {
  COLUMNAS_BASICO, COLUMNAS_RESUMEN, COLUMNAS_TODAS, GRUPOS_COLUMNA, agruparPorEmpleado, construirFilas,
  estadoPeriodo, etiquetaPeriodo, filtrarPeriodos, formatearValor, labelEstadoPeriodo, ordenarPeriodos,
  tablaResumen, textoAlcance, type EstadoPeriodo, type ModoResumen,
} from './resumenNomina';

const CLAVE_COLUMNAS = 'mgg.rrhh.resumen.columnas';
type Orientacion = 'auto' | 'vertical' | 'horizontal';

/** Lo último que marcó este usuario en este navegador (solo comodidad). */
function columnasGuardadas(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_COLUMNAS) ?? 'null');
    if (Array.isArray(v)) {
      const validas = v.filter((k) => COLUMNAS_RESUMEN.some((c) => c.key === k));
      if (validas.length) return validas;
    }
  } catch { /* sin almacenamiento: se usan las básicas */ }
  return [...COLUMNAS_BASICO];
}

/** Todos los renglones de la empresa, por páginas (Supabase corta en 1.000 sin avisar). */
async function listRenglonesEmpresa(empresa: Empresa): Promise<NominaRenglon[]> {
  return todasLasFilas<NominaRenglon>((d, h) =>
    supabase.from('nomina_renglones').select('*').eq('empresa', empresa).order('created_at', { ascending: true }).order('id').range(d, h));
}

export function ResumenNominaModal({ empresa, onClose }: { empresa: Empresa; onClose: () => void }) {
  const [periodos, setPeriodos] = useState<NominaPeriodoResumen[]>([]);
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [cajas, setCajas] = useState<{ id: string; nombre: string }[]>([]);
  const [cargando, setCargando] = useState(true);

  const [modo, setModo] = useState<ModoResumen>('periodo');
  const [periodoId, setPeriodoId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [estado, setEstado] = useState<EstadoPeriodo | 'todos'>('todos');
  const [agrupar, setAgrupar] = useState(false);

  const [columnas, setColumnas] = useState<string[]>(columnasGuardadas);
  const [orientacion, setOrientacion] = useState<Orientacion>('auto');
  const [generando, setGenerando] = useState<'excel' | 'pdf' | null>(null);

  /** Renglones ya traídos: por período (clave = id) o todos (clave 'todos'). */
  const [renglones, setRenglones] = useState<Record<string, NominaRenglon[]>>({});
  const [cargandoRenglones, setCargandoRenglones] = useState(false);
  const [version, setVersion] = useState(0);

  // Las nóminas, el personal (cédulas) y las cajas (nombre de la caja que pagó).
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    Promise.all([listNominas(empresa), listPersonal(false, empresa), listCajas().catch(() => [])])
      .then(([ps, pers, cjs]) => {
        if (!vivo) return;
        const ord = ordenarPeriodos(ps);
        setPeriodos(ord);
        setPersonal(pers);
        setCajas(cjs.map((c) => ({ id: c.id, nombre: c.nombre })));
        setPeriodoId((id) => id || ord[0]?.id || '');
      })
      .catch((e) => toast(e instanceof Error ? e.message : 'No se pudo cargar la nómina', 'error'))
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [empresa, version]);
  // Si alguien paga o carga una nómina mientras el resumen está abierto, se refresca solo.
  useRealtime(['nomina_periodos', 'nomina_renglones'], () => { setRenglones({}); setVersion((v) => v + 1); });

  // Los renglones del alcance elegido, una sola vez por clave.
  const clave = modo === 'periodo' ? periodoId : 'todos';
  useEffect(() => {
    if (!clave || renglones[clave]) return;
    let vivo = true;
    setCargandoRenglones(true);
    (modo === 'periodo' ? listRenglones(clave) : listRenglonesEmpresa(empresa))
      .then((rs) => { if (vivo) setRenglones((m) => ({ ...m, [clave]: rs })); })
      .catch((e) => toast(e instanceof Error ? e.message : 'No se pudieron cargar los renglones', 'error'))
      .finally(() => { if (vivo) setCargandoRenglones(false); });
    return () => { vivo = false; };
  }, [clave, modo, empresa, renglones]);

  const periodoSel = periodos.find((p) => p.id === periodoId) ?? null;
  const filtro = useMemo(() => ({ desde, hasta, estado }), [desde, hasta, estado]);
  const periodosAlcance = useMemo(
    () => (modo === 'periodo' ? (periodoSel ? [periodoSel] : []) : filtrarPeriodos(periodos, filtro)),
    [modo, periodoSel, periodos, filtro],
  );
  const filas = useMemo(() => {
    const base = construirFilas({ periodos: periodosAlcance, renglones: renglones[clave] ?? [], personal, cajas });
    return modo === 'general' && agrupar ? agruparPorEmpleado(base) : base;
  }, [periodosAlcance, renglones, clave, personal, cajas, modo, agrupar]);
  const alcance = textoAlcance({ modo, periodo: periodoSel, filtro, agrupado: modo === 'general' && agrupar });
  const tabla = useMemo(() => tablaResumen(filas, columnas), [filas, columnas]);

  const marcada = (k: string) => columnas.includes(k);
  function toggle(k: string) {
    setColumnas((cs) => (cs.includes(k) ? cs.filter((x) => x !== k) : [...cs, k]));
  }
  function grupoEntero(g: string, on: boolean) {
    const ks = COLUMNAS_RESUMEN.filter((c) => c.grupo === g).map((c) => c.key);
    setColumnas((cs) => (on ? [...new Set([...cs, ...ks])] : cs.filter((x) => !ks.includes(x))));
  }
  function cambiarModo(m: ModoResumen) {
    setModo(m);
    // En general cada fila es persona × nómina: la columna de la nómina hace falta para leerla.
    if (m === 'general') setColumnas((cs) => (cs.includes('periodo') ? cs : [...cs, 'periodo']));
  }

  async function generar(tipo: 'excel' | 'pdf') {
    if (!columnas.length) { toast('Marcá al menos una columna.', 'error'); return; }
    if (!filas.length) { toast('No hay renglones en ese alcance.', 'error'); return; }
    try { localStorage.setItem(CLAVE_COLUMNAS, JSON.stringify(columnas)); } catch { /* opcional */ }
    setGenerando(tipo);
    try {
      const m = await import('./resumenNominaArchivos');
      if (tipo === 'excel') await m.descargarResumenNominaExcel(filas, columnas, { alcance });
      else await m.descargarResumenNominaPdf(filas, columnas, { alcance }, orientacion);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el archivo', 'error');
    } finally { setGenerando(null); }
  }

  const opcionesPeriodo = periodos.map((p) => ({
    value: p.id,
    label: etiquetaPeriodo(p),
    hint: `${labelEstadoPeriodo(estadoPeriodo(p))} · ${p.pagados}/${p.total_renglones}`,
    keywords: [p.codigo],
  }));
  const MUESTRA = 8;
  const ocupado = cargando || cargandoRenglones;

  return (
    <Modal title="📊 Resumen de nómina" size="xl" onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={!!generando}>Cerrar</button>
          <button className="btn btn-ghost" onClick={() => void generar('excel')} disabled={!!generando || ocupado}>{generando === 'excel' ? 'Generando…' : '📊 Excel'}</button>
          <button className="btn btn-primary" onClick={() => void generar('pdf')} disabled={!!generando || ocupado}>{generando === 'pdf' ? 'Generando…' : '🖨 PDF (imprimir)'}</button>
        </>
      }>
      <div className="form-row">
        <label>¿De qué?</label>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
            <input type="radio" checked={modo === 'periodo'} onChange={() => cambiarModo('periodo')} />Por período (una nómina)
          </label>
          <label style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
            <input type="radio" checked={modo === 'general'} onChange={() => cambiarModo('general')} />General (todas las nóminas)
          </label>
        </div>
      </div>

      {modo === 'periodo' ? (
        <div className="form-row">
          <label>Nómina</label>
          {cargando && !periodos.length ? <div className="muted">Cargando nóminas…</div>
            : !periodos.length ? <div className="muted">No hay nóminas cargadas.</div>
              : <SearchSelect id="resumen-periodo" options={opcionesPeriodo} value={periodoId} onChange={setPeriodoId} placeholder="🔍 Buscar nómina…" />}
          <small className="hint muted">Las más nuevas primero, con su estado y cuántos renglones van pagados.</small>
        </div>
      ) : (
        <div className="form-row">
          <label>Filtros <span className="muted" style={{ fontWeight: 400 }}>(opcionales; vacío = todo)</span></label>
          <div style={{ display: 'flex', gap: '.8rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-row" style={{ margin: 0 }}>
              <label style={{ fontSize: '.72rem' }}>Desde (fecha de la nómina)</label>
              <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <label style={{ fontSize: '.72rem' }}>Hasta</label>
              <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <label style={{ fontSize: '.72rem' }}>Estado de la nómina</label>
              <select className="select" value={estado} onChange={(e) => setEstado(e.target.value as EstadoPeriodo | 'todos')}>
                <option value="todos">Todas</option>
                <option value="cargada">Cargadas (sin pagos)</option>
                <option value="en_pago">En pago</option>
                <option value="pagada">Pagadas</option>
              </select>
            </div>
            <label style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center', paddingBottom: '.45rem' }}>
              <input type="checkbox" checked={agrupar} onChange={(e) => setAgrupar(e.target.checked)} />
              Agrupar por trabajador
            </label>
          </div>
          <small className="hint muted">
            Sin agrupar sale una fila por persona y por nómina. Agrupado, cada persona queda en una sola fila con la suma de todas sus nóminas del rango (los Bs se suman como salieron en cada recibo, con su tasa; por eso la tasa queda vacía).
            {' '}{periodosAlcance.length} nómina{periodosAlcance.length === 1 ? '' : 's'} en el rango.
          </small>
        </div>
      )}

      <div className="form-row">
        <label>Hoja del PDF</label>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {([['auto', 'Automática (se acuesta si hay muchas columnas)'], ['vertical', 'Vertical'], ['horizontal', 'Horizontal']] as const).map(([k, l]) => (
            <label key={k} style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
              <input type="radio" checked={orientacion === k} onChange={() => setOrientacion(k)} />{l}
            </label>
          ))}
        </div>
      </div>

      <div className="form-row">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <label style={{ margin: 0 }}>¿Qué columnas? <span className="muted" style={{ fontWeight: 400 }}>({columnas.length} marcada{columnas.length === 1 ? '' : 's'})</span></label>
          <span style={{ display: 'flex', gap: '.3rem' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setColumnas([...COLUMNAS_BASICO])}>Básico</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setColumnas([...COLUMNAS_TODAS])}>Marcar todos</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setColumnas([])}>Ninguno</button>
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '.6rem', marginTop: '.4rem' }}>
          {GRUPOS_COLUMNA.map((g) => {
            const del = COLUMNAS_RESUMEN.filter((c) => c.grupo === g.key);
            const todas = del.every((c) => marcada(c.key));
            return (
              <div key={g.key} className="card" style={{ padding: '.5rem .7rem', margin: 0 }}>
                <label style={{ display: 'flex', gap: '.35rem', alignItems: 'center', fontWeight: 600, marginBottom: '.3rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={todas} onChange={(e) => grupoEntero(g.key, e.target.checked)} />
                  {g.label}
                </label>
                {del.map((c) => (
                  <label key={c.key} style={{ display: 'flex', gap: '.35rem', alignItems: 'center', fontSize: '.85rem', cursor: 'pointer', padding: '.1rem 0' }}>
                    <input type="checkbox" checked={marcada(c.key)} onChange={() => toggle(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <small className="hint muted">«Neto en Bs» es lo que se paga en bolívares (sueldo 20 % + extras − deducciones de ley); «Bono neto» es el 80 % menos préstamos y anticipos, en divisas; «Total recibido» suma los dos. Es la misma cuenta del recibo.</small>
      </div>

      <div className="form-row">
        <label>
          Así va a salir
          <span className="muted" style={{ fontWeight: 400 }}>
            {' '}· {alcance} · {tabla.personas} persona{tabla.personas === 1 ? '' : 's'} · {filas.length} fila{filas.length === 1 ? '' : 's'}
            {filas.length > MUESTRA ? ` (se muestran las primeras ${MUESTRA})` : ''}
          </span>
        </label>
        {ocupado && <div className="muted" style={{ padding: '.6rem', textAlign: 'center' }}>Cargando…</div>}
        {!ocupado && !filas.length && <div className="muted" style={{ padding: '.6rem', textAlign: 'center' }}>No hay renglones en ese alcance.</div>}
        {!ocupado && filas.length > 0 && columnas.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
            <table className="table" style={{ fontSize: '.78rem' }}>
              <thead><tr>{tabla.head.map((h, j) => <th key={h} style={{ textAlign: j > 0 && tabla.columnas[j - 1].tipo !== 'texto' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
              <tbody>
                {tabla.filas.slice(0, MUESTRA).map((f, i) => (
                  <tr key={i}>{f.map((v, j) => {
                    const col = j === 0 ? null : tabla.columnas[j - 1];
                    const txt = formatearValor(col, v);
                    return <td key={j} className={col && col.tipo !== 'texto' ? 'mono' : undefined} style={{ textAlign: col && col.tipo !== 'texto' ? 'right' : 'left' }}>{txt || <span className="muted">—</span>}</td>;
                  })}</tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>{tabla.totales.map((v, j) => {
                  const col = j === 0 ? null : tabla.columnas[j - 1];
                  return <td key={j} className={col && col.tipo !== 'texto' ? 'mono' : undefined} style={{ textAlign: col && col.tipo !== 'texto' ? 'right' : 'left' }}>{formatearValor(col, v)}</td>;
                })}</tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
