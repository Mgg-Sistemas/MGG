/* ============================================================
   MGG · RRHH · «⬇ Exportar datos» (05-10-2026)
   Casillas para elegir QUÉ datos salen (ej.: solo nombre y cédula) y
   a QUIÉNES; se ve y se baja en Excel o en PDF para imprimir.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import type { Personal } from '@/shared/lib/types';
import { CAMPOS_EXPORT, CAMPOS_POR_DEFECTO, GRUPOS_CAMPO, tablaExport } from './exportarPersonal';
import { ordenarPorFicha } from './fichaPersonal';

type Quienes = 'visibles' | 'activos' | 'todos';
const CLAVE_CAMPOS = 'mgg.rrhh.exportar.campos';

/** Lo último que marcó este usuario en este navegador (solo comodidad). */
function camposGuardados(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_CAMPOS) ?? 'null');
    if (Array.isArray(v)) {
      const validos = v.filter((k) => CAMPOS_EXPORT.some((c) => c.key === k));
      if (validos.length) return validos;
    }
  } catch { /* sin almacenamiento: se usan los de por defecto */ }
  return [...CAMPOS_POR_DEFECTO];
}

export function ExportarPersonalModal({ todos, visibles, hayFiltros, onClose }: {
  todos: Personal[]; visibles: Personal[]; hayFiltros: boolean; onClose: () => void;
}) {
  const [campos, setCampos] = useState<string[]>(camposGuardados);
  const [quienes, setQuienes] = useState<Quienes>(hayFiltros ? 'visibles' : 'activos');
  const [generando, setGenerando] = useState<'excel' | 'pdf' | null>(null);

  const activos = useMemo(() => ordenarPorFicha(todos.filter((p) => p.activo)), [todos]);
  const todosOrd = useMemo(() => ordenarPorFicha([...todos]), [todos]);
  const personas = quienes === 'visibles' ? visibles : quienes === 'activos' ? activos : todosOrd;
  const titulo = quienes === 'visibles' ? (hayFiltros ? 'Filtrado' : 'Listado') : quienes === 'activos' ? 'Activos' : 'Todo el personal';

  const marcado = (k: string) => campos.includes(k);
  function toggle(k: string) {
    setCampos((cs) => (cs.includes(k) ? cs.filter((x) => x !== k) : [...cs, k]));
  }
  function grupoEntero(g: string, on: boolean) {
    const ks = CAMPOS_EXPORT.filter((c) => c.grupo === g).map((c) => c.key);
    setCampos((cs) => (on ? [...new Set([...cs, ...ks])] : cs.filter((x) => !ks.includes(x))));
  }

  async function generar(tipo: 'excel' | 'pdf') {
    if (!campos.length) { toast('Marcá al menos un dato para exportar.', 'error'); return; }
    if (!personas.length) { toast('No hay personas en esa selección.', 'error'); return; }
    try { localStorage.setItem(CLAVE_CAMPOS, JSON.stringify(campos)); } catch { /* opcional */ }
    setGenerando(tipo);
    try {
      const m = await import('./exportarPersonalArchivos');
      if (tipo === 'excel') await m.descargarPersonalExcel(personas, campos, titulo);
      else await m.descargarPersonalPdf(personas, campos, titulo);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el archivo', 'error');
    } finally { setGenerando(null); }
  }

  // Muestra de las 3 primeras filas, para ver qué va a salir antes de generar.
  const muestra = useMemo(() => tablaExport(personas.slice(0, 3), campos), [personas, campos]);

  return (
    <Modal title="⬇ Exportar datos del personal" size="lg" onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={!!generando}>Cerrar</button>
          <button className="btn btn-ghost" onClick={() => void generar('excel')} disabled={!!generando}>{generando === 'excel' ? 'Generando…' : '📊 Excel'}</button>
          <button className="btn btn-primary" onClick={() => void generar('pdf')} disabled={!!generando}>{generando === 'pdf' ? 'Generando…' : '📄 PDF para imprimir'}</button>
        </>
      }>
      <div className="form-row">
        <label>¿A quiénes?</label>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
            <input type="radio" checked={quienes === 'visibles'} onChange={() => setQuienes('visibles')} />
            {hayFiltros ? 'Los que se ven con los filtros' : 'Los que se ven en la lista'} ({visibles.length})
          </label>
          <label style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
            <input type="radio" checked={quienes === 'activos'} onChange={() => setQuienes('activos')} />
            Solo activos ({activos.length})
          </label>
          <label style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
            <input type="radio" checked={quienes === 'todos'} onChange={() => setQuienes('todos')} />
            Todo el personal ({todos.length})
          </label>
        </div>
      </div>

      <div className="form-row">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <label style={{ margin: 0 }}>¿Qué datos? <span className="muted" style={{ fontWeight: 400 }}>({campos.length} marcado{campos.length === 1 ? '' : 's'})</span></label>
          <span style={{ display: 'flex', gap: '.3rem' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCampos([...CAMPOS_POR_DEFECTO])}>Solo nombre y cédula</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCampos([])}>Ninguno</button>
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '.6rem', marginTop: '.4rem' }}>
          {GRUPOS_CAMPO.map((g) => {
            const del = CAMPOS_EXPORT.filter((c) => c.grupo === g.key);
            const todosG = del.every((c) => marcado(c.key));
            return (
              <div key={g.key} className="card" style={{ padding: '.5rem .7rem', margin: 0 }}>
                <label style={{ display: 'flex', gap: '.35rem', alignItems: 'center', fontWeight: 600, marginBottom: '.3rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={todosG} onChange={(e) => grupoEntero(g.key, e.target.checked)} />
                  {g.label}
                </label>
                {del.map((c) => (
                  <label key={c.key} style={{ display: 'flex', gap: '.35rem', alignItems: 'center', fontSize: '.85rem', cursor: 'pointer', padding: '.1rem 0' }}>
                    <input type="checkbox" checked={marcado(c.key)} onChange={() => toggle(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {campos.length > 0 && personas.length > 0 && (
        <div className="form-row">
          <label>Así va a salir <span className="muted" style={{ fontWeight: 400 }}>(primeras {Math.min(3, personas.length)} de {personas.length})</span></label>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead><tr>{muestra.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {muestra.filas.map((f, i) => <tr key={i}>{f.map((v, j) => <td key={j}>{String(v) || <span className="muted">—</span>}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
