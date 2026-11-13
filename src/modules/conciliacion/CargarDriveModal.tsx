/* ============================================================
   MGG · Conciliación · Cargar el archivo del DRIVE (12-11-2026)
   Misma validación que la importación de Inventario: Estado Validado /
   Duplicados / Error, totales, errores por columna y detalle por fila.
   Con errores no se puede subir; con duplicados se confirma.
   Antes de subir se ve qué OC van a quedar CUADRA / NO CUADRA.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import type { Orden } from '@/shared/lib/types';
import type { FilaConciliacion } from './conciliacion';
import { cruzarDrive, pagadoBsTesoreria, type AnalisisDrive, type FilaDrive, type ResultadoDrive } from './conciliacionDrive';
import { guardarDrive } from './conciliacion.repository';
import { guardarDriveEntradas } from './conciliacionEntradas.repository';

const COLOR: Record<AnalisisDrive['estado'], string> = { Validado: '#10b981', Duplicados: '#f59e0b', Error: '#ef4444' };
const ICONO: Record<AnalisisDrive['estado'], string> = { Validado: '✅', Duplicados: '⚠', Error: '❌' };
type Filtro = 'todos' | 'error' | 'duplicado' | 'valido' | 'ya_conciliada';
const FILTROS: Array<{ key: Filtro; label: string }> = [
  { key: 'todos', label: 'Todas' },
  { key: 'error', label: 'Con error' },
  { key: 'duplicado', label: 'Duplicadas' },
  { key: 'valido', label: 'Nuevas válidas' },
  { key: 'ya_conciliada', label: 'Ya conciliadas' },
];
const COLUMNA: Record<string, string> = { codigo: 'Código OC', referencia: 'Referencia', monto: 'Monto Bs' };
const fmtBs = (n: number) => (Number.isFinite(n) ? `Bs ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—');

export function CargarDriveModal({ analisis, filas, ordenes, onClose, onGuardado }: {
  analisis: AnalisisDrive;
  filas: FilaConciliacion[];
  ordenes: Map<string, Orden>;
  onClose: () => void;
  onGuardado: (ordenes: Orden[]) => void;
}) {
  const { user } = useSession();
  const [confirmando, setConfirmando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>(analisis.conError ? 'error' : analisis.duplicadas ? 'duplicado' : 'todos');
  const puedeSubir = analisis.estado !== 'Error';
  const necesitaConfirmar = analisis.estado === 'Duplicados';

  // Lo que va a quedar en la columna DRIVE (vista previa del cruce).
  const cruce = useMemo(() => {
    const porId = new Map(filas.map((f) => [f.id, f]));
    const out = new Map<string, ResultadoDrive>();
    for (const [id, d] of analisis.porOrden) {
      const f = porId.get(id);
      if (f) out.set(id, cruzarDrive(f, d, pagadoBsTesoreria(ordenes.get(id)?.historial)));
    }
    return out;
  }, [analisis, filas, ordenes]);
  const cuadran = [...cruce.values()].filter((r) => r.estado === 'CUADRA').length;
  const noCuadran = cruce.size - cuadran;
  const visibles = analisis.filas.filter((f) => {
    if (filtro === 'todos') return true;
    if (filtro === 'ya_conciliada') return f.estado === 'ya_conciliada' || f.yaConciliada;
    return f.estado === filtro;
  });

  const totalNuevas = (analisis.porOrden?.size || 0) + (analisis.porOrdenEntradas?.size || 0);

  async function subir() {
    if (necesitaConfirmar && !confirmando) { setConfirmando(true); return; }
    setAplicando(true);
    try {
      const ordenesActualizadas: Orden[] = [];
      let fallidasTotal = 0;

      if (analisis.porOrden && analisis.porOrden.size > 0) {
        const r = await guardarDrive(analisis.porOrden, user?.email ?? 'conciliacion');
        ordenesActualizadas.push(...r.guardadas);
        fallidasTotal += r.fallidas.length;
      }

      if (analisis.porOrdenEntradas && analisis.porOrdenEntradas.size > 0) {
        const rEnt = await guardarDriveEntradas(analisis.porOrdenEntradas, user?.email ?? 'conciliacion');
        ordenesActualizadas.push(...rEnt.guardadas);
        fallidasTotal += rEnt.fallidas.length;
      }

      onGuardado(ordenesActualizadas);
      const sub = fallidasTotal ? ` · ${fallidasTotal} no se pudieron guardar` : '';
      toast(`Drive cargado: ${ordenesActualizadas.length} OC cotejadas${sub}`, fallidasTotal ? 'warning' : 'success');
      if (!fallidasTotal) onClose(); else setAplicando(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar el Drive', 'error');
      setAplicando(false);
    }
  }

  return (
    <Modal title={`📥 Cargar Drive/Banco · ${analisis.archivo}`} size="xl" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={aplicando}>Cancelar</button>
      {puedeSubir ? (
        <button className={`btn ${necesitaConfirmar ? 'btn-warning' : 'btn-primary'}`} onClick={() => void subir()} disabled={aplicando || !totalNuevas}>
          {aplicando ? 'Subiendo…' : necesitaConfirmar && confirmando ? 'Sí, subir de todas formas' : totalNuevas ? `↑ Subir archivo (${totalNuevas} nuevas)` : 'Todo ya conciliado'}
        </button>
      ) : (
        <button className="btn btn-danger" disabled title="Corrige los errores en el archivo antes de subir">✖ No se puede subir</button>
      )}
    </>}>
      <div style={{ display: 'grid', gap: '.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: '1rem' }}>
        <Tarjeta big icono={ICONO[analisis.estado]} color={COLOR[analisis.estado]} titulo={`Estado: ${analisis.estado}`}
          sub={analisis.estado === 'Validado' ? 'Todas las filas son válidas. Se cruzan directo.'
            : analisis.estado === 'Duplicados' ? 'Hay OC repetidas en el archivo: se juntan (se suman sus montos).'
              : 'El archivo trae errores. Corrígelos antes de subir.'} />
        <Tarjeta icono="∑" color="#64748b" titulo="Total filas" sub={String(analisis.total)} />
        <Tarjeta icono="✓" color="#10b981" titulo="Nuevas válidas" sub={String(analisis.validas)} />
        {analisis.yaConciliadas > 0 && <Tarjeta icono="✔" color="#3b82f6" titulo="Ya conciliadas" sub={String(analisis.yaConciliadas)} />}
        <Tarjeta icono="⚠" color="#f59e0b" titulo="Duplicadas" sub={String(analisis.duplicadas)} />
        <Tarjeta icono="❌" color="#ef4444" titulo="Con error" sub={String(analisis.conError)} />
      </div>

      {puedeSubir && (
        <div className="card" style={{ padding: '.7rem 1rem', marginBottom: '1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <strong>Columna DRIVE/BANCO:</strong>
          <span className="badge success">{cuadran} CUADRA</span>
          <span className="badge danger">{noCuadran} NO CUADRA</span>
          <span className="muted" style={{ fontSize: '.78rem' }}>de {cruce.size} OC · cruce por código de OC, referencia y monto en Bs</span>
        </div>
      )}

      {confirmando && necesitaConfirmar && (
        <div className="card" style={{ borderLeft: '3px solid #f59e0b', padding: '.85rem 1rem', marginBottom: '1rem' }}>
          <strong>⚠ Hay OC repetidas en el archivo</strong>
          <p style={{ margin: '.35rem 0 0' }}>
            {analisis.duplicadas} fila(s) son de una OC que aparece más de una vez. Se cruzan <strong>juntas</strong>: se suman sus
            montos y vale cualquiera de sus referencias. ¿Quieres continuar?
          </p>
        </div>
      )}

      {Object.keys(analisis.errorPorColumna).length > 0 && (
        <div className="card" style={{ padding: '.75rem 1rem', marginBottom: '1rem' }}>
          <div className="card-title" style={{ marginBottom: '.5rem' }}>Errores por columna</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
            {Object.entries(analisis.errorPorColumna).map(([c, n]) => <span key={c} className="badge danger" style={{ padding: '.25rem .55rem' }}>{COLUMNA[c] ?? c}: {n}</span>)}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.5rem', alignItems: 'center' }}>
        <strong>Detalle de filas</strong>
        <div className="view-switch" style={{ marginTop: 0, padding: '.15rem' }}>
          {FILTROS.map((f) => (
            <button key={f.key} type="button" className={`view-switch-tab${filtro === f.key ? ' active' : ''}`} onClick={() => setFiltro(f.key)}
              style={{ padding: '.25rem .65rem', fontSize: '.74rem' }}>{f.label}</button>
          ))}
        </div>
        <span className="muted mono" style={{ marginLeft: 'auto', fontSize: '.75rem' }}>{visibles.length} fila(s)</span>
      </div>
      <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.78rem' }}>
          <thead><tr><th style={{ width: 50 }}>Fila</th><th>Código OC</th><th>Referencia</th><th style={{ textAlign: 'right' }}>Monto Bs</th><th>Estado</th><th>DRIVE/BANCO</th></tr></thead>
          <tbody>
            {visibles.map((f) => <FilaDriveTr key={f.fila} f={f} r={f.ordenId ? cruce.get(f.ordenId) : undefined} />)}
            {!visibles.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin filas para este filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint muted" style={{ fontSize: '.75rem', marginTop: '.75rem' }}>
        Columnas del archivo: <strong>Código OC</strong>, <strong>Referencia</strong> y <strong>Monto Bs</strong> (Excel o CSV).
        CUADRA si la referencia es la de la OC (Tesorería o Conciliación) y el monto en Bs coincide con lo pagado; si no, NO CUADRA.
        Lo cargado queda en el historial de cada OC.
      </p>
    </Modal>
  );
}

function FilaDriveTr({ f, r }: { f: FilaDrive; r?: ResultadoDrive }) {
  const badge = f.estado === 'error' ? <span className="badge danger">Error</span>
    : f.estado === 'duplicado' ? <span className="badge warning">Duplicada</span>
    : f.estado === 'ya_conciliada' || f.yaConciliada ? <span className="badge info" style={{ background: '#dbeafe', color: '#1e40af' }}>Ya conciliada</span>
    : <span className="badge success">Válida</span>;
  return (
    <tr>
      <td className="mono">{f.fila}</td>
      <td className="mono">
        {f.codigo || '—'}
        {f.tipo === 'reintegro' && (
          <span className="badge" style={{ marginLeft: '.35rem', fontSize: '.65rem', background: '#f3e8ff', color: '#6b21a8' }}>
            Reintegro{f.tipoRetencion ? ` (${f.tipoRetencion})` : ''}
          </span>
        )}
      </td>
      <td className="mono">{f.referencia || '—'}</td>
      <td className="mono" style={{ textAlign: 'right' }}>{fmtBs(f.montoBs)}</td>
      <td>
        {badge}
        {f.errores.length > 0 && <div style={{ color: 'var(--danger, #dc2626)', fontSize: '.72rem' }}>{f.errores.join(' · ')}</div>}
        {f.duplicado && <div className="muted" style={{ fontSize: '.72rem' }}>OC repetida en el archivo: se suman</div>}
        {(f.estado === 'ya_conciliada' || f.yaConciliada) && <div className="muted" style={{ fontSize: '.72rem' }}>No se duplica ni se suma monto</div>}
      </td>
      <td>
        {f.estado === 'ya_conciliada' || f.yaConciliada ? (
          <>
            <span className="badge success">CUADRA</span>
            <div className="muted" style={{ fontSize: '.7rem' }}>Conciliada previamente</div>
          </>
        ) : r ? (
          <>
            <span className={`badge ${r.estado === 'CUADRA' ? 'success' : 'danger'}`}>{r.estado}</span>
            {r.estado === 'NO CUADRA' && <div className="muted" style={{ fontSize: '.7rem', maxWidth: 260, whiteSpace: 'normal' }}>{r.motivo}</div>}
          </>
        ) : <span className="muted">—</span>}
      </td>
    </tr>
  );
}

function Tarjeta({ icono, color, titulo, sub, big }: { icono: string; color: string; titulo: string; sub: string; big?: boolean }) {
  return (
    <div className="card" style={{ borderLeft: `3px solid ${color}`, padding: big ? '.85rem 1rem' : '.6rem .85rem', margin: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <div style={{ fontSize: big ? '1.4rem' : '1.05rem' }}>{icono}</div>
        <div>
          <div style={{ fontWeight: 600, color }}>{titulo}</div>
          <div className={big ? '' : 'muted'} style={{ fontSize: big ? '.78rem' : '1.05rem', fontWeight: big ? 400 : 600 }}>{sub}</div>
        </div>
      </div>
    </div>
  );
}
