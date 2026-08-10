/* ============================================================
   MGG · Grilla de ANÁLISIS QUÍMICO de laboratorio (reutilizable)
   Metales en FILAS, lecturas (A, B, C…) en COLUMNAS, agrupadas por
   procedencia. PROM por metal = promedio de sus lecturas de esa
   procedencia (2 decimales). El CRUD se INYECTA, así la misma grilla
   sirve para Recepciones (recepcion_analisis) y Fundición (colada_analisis).
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import type { RecepcionMineral, RecepcionAnalisis, ValorMineral } from '@/modules/recepciones/recepciones.repository';

/* es-VE: 2 decimales con redondeo half-up. */
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
function n2(n: number | null | undefined): string {
  if (n == null || isNaN(n as number)) return '—';
  return round2(Number(n)).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/**
 * Parser de las casillas del LABORATORIO (leyes/%: valores chicos). El punto Y la coma
 * son separador DECIMAL: `0.48` y `0,48` valen ambos 0,48. El ÚLTIMO separador es el
 * decimal; cualquier otro punto/coma se ignora.
 */
function parseNumCell(s: string): number | null {
  const raw = String(s ?? '').trim().replace(/\s/g, '');
  if (raw === '') return null;
  const sep = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
  const t = sep >= 0
    ? raw.slice(0, sep).replace(/[.,]/g, '') + '.' + raw.slice(sep + 1).replace(/[.,]/g, '')
    : raw;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
/** Etiqueta de columna de lectura: 0→A, 25→Z, 26→AA… */
function colLetra(i: number): string {
  let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
/** Lee una lectura tolerando datos viejos {a,b,c,prom}. */
function lecturaNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') {
    const o = v as ValorMineral;
    if (o.prom != null && Number.isFinite(Number(o.prom))) return Number(o.prom);
    const xs = [o.a, o.b, o.c].filter((x) => x != null && Number.isFinite(Number(x))).map(Number);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }
  return null;
}

/** Una lectura = una columna (un registro de análisis). id null = nueva (sin guardar). */
type LecturaCol = { id: string | null; vals: Record<string, string>; numeros: string; procedencia: string };
function buildCols(analisis: RecepcionAnalisis[]): LecturaCol[] {
  return [...analisis].sort((a, b) => a.n_analisis - b.n_analisis).map((a) => {
    const vals: Record<string, string> = {};
    for (const [clave, v] of Object.entries(a.valores ?? {})) { const n = lecturaNum(v); if (n != null) vals[clave] = String(n); }
    return { id: a.id, vals, numeros: a.numeros ?? '', procedencia: (a.procedencia ?? '').trim().toUpperCase() };
  });
}
const SIN_PROC = '— Sin procedencia —';

/** Payload para crear/actualizar una lectura (lo resuelve el CRUD inyectado del contenedor). */
export interface LabAnalisisInput {
  n_analisis: number;
  valores: Record<string, ValorMineral>;
  numeros: string;
  procedencia: string | null;
}

export interface LabAnalisisGridProps {
  minerales: RecepcionMineral[];
  analisis: RecepcionAnalisis[];
  canWrite: boolean;
  onReload: () => Promise<void>;
  onConfig?: () => void;
  procOpciones?: Array<{ nombre: string; color: string | null }>;
  /** Persistencia inyectada (cierra sobre grupoId/produccionId + actor). */
  crear: (input: LabAnalisisInput) => Promise<void>;
  actualizar: (id: string, patch: { valores: Record<string, ValorMineral>; numeros: string; procedencia: string | null }) => Promise<void>;
  eliminar: (id: string) => Promise<void>;
}

export function LabAnalisisGrid({ minerales, analisis, canWrite, onReload, onConfig, procOpciones = [], crear, actualizar, eliminar }: LabAnalisisGridProps) {
  const [cols, setCols] = useState<LecturaCol[]>(() => buildCols(analisis));
  const [delIds, setDelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Re-sincroniza al cambiar el set de IDs guardados (alta/baja/recarga); preserva ediciones locales si no cambió.
  const idsKey = analisis.map((a) => a.id).join(',');
  const lastIds = useRef(idsKey);
  useEffect(() => {
    if (lastIds.current !== idsKey) { lastIds.current = idsKey; setCols(buildCols(analisis)); setDelIds([]); }
  }, [idsKey, analisis]);

  if (!minerales.length) return <EmptyState message="Sin minerales configurados. Usá «⚙ Configurar minerales»." icon="🧪" />;

  const mitad = Math.ceil(minerales.length / 2);
  const bloques = minerales.length > mitad ? [minerales.slice(0, mitad), minerales.slice(mitad)] : [minerales];

  const setCell = (ci: number, clave: string, val: string) => setCols((cs) => cs.map((c, j) => (j === ci ? { ...c, vals: { ...c.vals, [clave]: val } } : c)));
  const setNumeros = (ci: number, val: string) => setCols((cs) => cs.map((c, j) => (j === ci ? { ...c, numeros: val } : c)));
  const addCol = (procedencia: string) => setCols((cs) => [...cs, { id: null, vals: {}, numeros: '', procedencia }]);
  const removeCol = (ci: number) => setCols((cs) => { const c = cs[ci]; if (c?.id) setDelIds((d) => [...d, c.id!]); return cs.filter((_, j) => j !== ci); });

  // PROM por metal SOLO sobre las lecturas de la procedencia indicada (índices globales gis).
  const promMetal = (clave: string, gis: number[]): number | null => {
    const xs = gis.map((gi) => parseNumCell(cols[gi]?.vals[clave])).filter((x): x is number => x != null);
    return xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  const colorDe = (n: string) => procOpciones.find((o) => o.nombre === n)?.color ?? null;

  // Agrupa las lecturas por procedencia, preservando el índice GLOBAL de cada columna.
  const grupos: Array<{ proc: string; gis: number[] }> = (() => {
    const orden: string[] = [];
    const map = new Map<string, number[]>();
    cols.forEach((c, gi) => {
      const key = c.procedencia || SIN_PROC;
      if (!map.has(key)) { map.set(key, []); orden.push(key); }
      map.get(key)!.push(gi);
    });
    // Ordena: primero las del catálogo (en su orden), luego extras alfabéticas, y SIN_PROC al final.
    const catOrden = procOpciones.map((o) => o.nombre);
    orden.sort((a, b) => {
      if (a === SIN_PROC) return 1; if (b === SIN_PROC) return -1;
      const ia = catOrden.indexOf(a), ib = catOrden.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1; if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return orden.map((proc) => ({ proc, gis: map.get(proc)! }));
  })();

  async function guardar() {
    setSaving(true);
    try {
      for (const id of delIds) await eliminar(id);
      let n = analisis.reduce((m, a) => Math.max(m, a.n_analisis), 0);
      for (const c of cols) {
        const vacia = minerales.every((m) => parseNumCell(c.vals[m.clave]) == null) && !c.numeros.trim();
        if (!c.id && vacia) continue; // no creamos lecturas vacías
        const valores: Record<string, ValorMineral> = {};
        for (const m of minerales) valores[m.clave] = { prom: parseNumCell(c.vals[m.clave]) };
        const procedencia = c.procedencia.trim() || null;
        if (c.id) await actualizar(c.id, { valores, numeros: c.numeros, procedencia });
        else { n += 1; await crear({ n_analisis: n, valores, numeros: c.numeros, procedencia }); }
      }
      setDelIds([]);
      toast('Análisis químicos guardados', 'success');
      await onReload();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setSaving(false); }
  }

  // Una tabla (mitad de minerales) para las columnas gis de una procedencia.
  const tabla = (bloque: RecepcionMineral[], gis: number[], key: number) => (
    <div className="table-wrap" key={key} style={{ overflowX: 'auto' }}>
      <table className="table" style={{ fontSize: '.82rem', margin: 0 }}>
        <thead>
          <tr>
            <th style={{ minWidth: 150 }}>Metal</th>
            {gis.map((gi, k) => (
              <th key={gi} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                {colLetra(k)}{canWrite && <button className="btn btn-sm btn-ghost" style={{ padding: '0 .25rem', marginLeft: '.15rem' }} onClick={() => removeCol(gi)} title="Quitar lectura">✕</button>}
              </th>
            ))}
            <th style={{ textAlign: 'center' }}>PROM.</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ fontWeight: 700 }} title="Números de la lectura (podés poner varios, ej. 34, 34, 645)"># <span className="muted" style={{ fontSize: '.68rem', fontWeight: 500 }}>(nºs)</span></td>
            {gis.map((gi) => (
              <td key={gi} style={{ padding: 2 }}>
                {canWrite ? (
                  <input className="input mono" style={{ width: 84, textAlign: 'center', padding: '.2rem .25rem' }}
                    value={cols[gi].numeros} onChange={(e) => setNumeros(gi, e.target.value)} placeholder="34, 34, 645" />
                ) : <span className="mono">{cols[gi].numeros || '—'}</span>}
              </td>
            ))}
            <td style={{ background: 'var(--surface-2, #f1f1f1)' }} />
          </tr>
          {bloque.map((m) => {
            const prom = promMetal(m.clave, gis);
            return (
              <tr key={m.id}>
                <td style={{ fontWeight: 700, background: m.color ?? undefined, color: m.color ? '#1a1a1a' : undefined }}>
                  {m.nombre}{m.subtitulo ? <span style={{ fontSize: '.72rem', fontWeight: 500 }}> · {m.subtitulo}</span> : null}
                </td>
                {gis.map((gi) => (
                  <td key={gi} style={{ padding: 2 }}>
                    {canWrite ? (
                      <input className="input mono" style={{ width: 64, textAlign: 'center', padding: '.2rem .25rem' }} inputMode="decimal"
                        value={cols[gi].vals[m.clave] ?? ''} onChange={(e) => setCell(gi, m.clave, e.target.value)} placeholder="—" />
                    ) : <span className="mono">{cols[gi].vals[m.clave] || '—'}</span>}
                  </td>
                ))}
                <td className="mono" style={{ textAlign: 'center', fontWeight: 800, background: m.color ? `${m.color}33` : undefined }}>{prom != null ? `${n2(prom)}%` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // Procedencias del catálogo para el desplegable «+ lectura en…».
  const procParaAgregar = procOpciones.map((o) => o.nombre);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', marginBottom: '.6rem' }}>
        <span className="muted" style={{ fontSize: '.78rem' }}>Valores en <strong>%</strong>, agrupados <strong>por procedencia</strong>. Cada metal es una fila; las lecturas (A, B, C…) son columnas. <strong>PROM</strong> = promedio de las lecturas de esa procedencia (2 decimales).</span>
        {canWrite && (
          <span style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {onConfig && <button className="btn btn-sm btn-ghost" onClick={onConfig}>⚙ Configurar minerales</button>}
            <AddLecturaProc procedencias={procParaAgregar} onAdd={addCol} />
            <button className="btn btn-sm btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : '💾 Guardar análisis'}</button>
          </span>
        )}
      </div>
      {!cols.length && <p className="hint muted" style={{ fontSize: '.8rem', margin: '0 0 .6rem' }}>Sin lecturas. {canWrite ? 'Agregá una eligiendo la procedencia en «+ Añadir lectura en…».' : '—'}</p>}
      {grupos.map(({ proc, gis }) => {
        const sinProc = proc === SIN_PROC;
        const col = sinProc ? null : colorDe(proc);
        return (
          <div key={proc} style={{ marginBottom: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', margin: '0 0 .45rem', paddingBottom: '.3rem', borderBottom: '2px solid var(--border,#3a3a3a)' }}>
              <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, flexShrink: 0, background: col ?? 'transparent', border: col ? 'none' : '1px dashed var(--border,#3a3a3a)' }} />
              <strong style={{ letterSpacing: '.03em', color: sinProc ? 'var(--muted,#888)' : undefined }}>{proc}</strong>
              <span className="muted" style={{ fontSize: '.72rem' }}>· {gis.length} lectura{gis.length === 1 ? '' : 's'}</span>
              {canWrite && !sinProc && <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => addCol(proc)}>+ lectura</button>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '1rem', alignItems: 'start' }}>
              {bloques.map((b, i) => tabla(b, gis, i))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Desplegable «+ Añadir lectura en <procedencia>» para el análisis químico. */
function AddLecturaProc({ procedencias, onAdd }: { procedencias: string[]; onAdd: (proc: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <span style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center' }}>
      <select className="select" style={{ padding: '.2rem .4rem', fontSize: '.8rem' }} value={val} onChange={(e) => setVal(e.target.value)}>
        <option value="">+ Añadir lectura en…</option>
        {procedencias.map((p) => <option key={p} value={p}>{p}</option>)}
        <option value="__sin__">(sin procedencia)</option>
      </select>
      <button className="btn btn-sm btn-ghost" disabled={!val} onClick={() => { onAdd(val === '__sin__' ? '' : val); setVal(''); }}>Agregar</button>
    </span>
  );
}
