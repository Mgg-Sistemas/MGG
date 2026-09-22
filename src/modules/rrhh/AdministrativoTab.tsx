import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { money, date } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Personal, RrhhEvento } from '@/shared/lib/types';
import { listPersonal } from './personal.repository';
import { listEventos, crearEvento, eliminarEvento, type EventoInput } from './eventos.repository';
import { EMPRESA_POR_DEFECTO, type Empresa } from './empresa';

const TIPOS: { key: RrhhEvento['tipo']; label: string; conMonto?: boolean; conDias?: boolean }[] = [
  { key: 'vacacion', label: 'Vacaciones', conDias: true },
  { key: 'permiso', label: 'Permiso', conDias: true },
  { key: 'utilidad', label: 'Utilidad / Aguinaldo', conMonto: true },
  { key: 'nota', label: 'Nota / Historial' },
];
const labelTipo = (t: string) => TIPOS.find((x) => x.key === t)?.label ?? t;

const VACIO: EventoInput = { personal_id: '', tipo: 'vacacion', fecha_desde: '', fecha_hasta: '', dias: null, monto: null, descripcion: '' };

/** Días inclusivos entre dos fechas (yyyy-mm-dd). 10/06 → 24/06 = 15 días. */
function diasInclusive(desde?: string | null, hasta?: string | null): number {
  if (!desde || !hasta) return 0;
  const [ay, am, ad] = desde.split('-').map(Number);
  const [by, bm, bd] = hasta.split('-').map(Number);
  if (!ay || !by) return 0;
  const a = new Date(ay, am - 1, ad), b = new Date(by, bm - 1, bd);
  const d = Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
  return d > 0 ? d : 0;
}

export function AdministrativoTab({ canWrite, actor, actorName, empresa = EMPRESA_POR_DEFECTO }: {
  canWrite: boolean; actor: string; actorName: string | null; empresa?: Empresa;
}) {
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [lista, setLista] = useState<RrhhEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<EventoInput>(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<string>('');
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');

  const recargar = useCallback(async () => {
    setLoading(true);
    const [ps, ev] = await Promise.all([
      listPersonal(false, empresa).catch((e) => { toast(e instanceof Error ? e.message : 'No se pudo cargar el personal', 'error'); return [] as Personal[]; }),
      listEventos(undefined, undefined, empresa).catch(() => [] as RrhhEvento[]),
    ]);
    setPersonal(ps); setLista(ev);
    setLoading(false);
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['rrhh_eventos', 'personal'], () => { void recargar(); });

  const nombre = (id?: string | null) => {
    const p = personal.find((x) => x.id === id);
    return p ? `${p.nombre} ${p.apellido}`.trim() : '—';
  };
  const tipoCfg = TIPOS.find((t) => t.key === form.tipo);

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.personal_id) { setError('Elegí el trabajador.'); return; }
    setGuardando(true);
    try {
      await crearEvento(form, actor, actorName);
      toast('Registrado', 'success');
      setForm({ ...VACIO, tipo: form.tipo });
      await recargar();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); }
    finally { setGuardando(false); }
  }
  // El cartel del navegador se reemplaza por el diálogo del sistema.
  const [porBorrar, setPorBorrar] = useState<RrhhEvento | null>(null);
  async function confirmarBorrado() {
    if (!porBorrar) return;
    try { await eliminarEvento(porBorrar.id); setPorBorrar(null); await recargar(); toast('Eliminado', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); setPorBorrar(null); }
  }

  // Filtro por fecha: un registro entra si su período [desde, hasta] se solapa con
  // el rango elegido. Sirve para día puntual (mismo desde/hasta), mes o rango libre.
  function enRango(e: RrhhEvento): boolean {
    if (!fDesde && !fHasta) return true;
    const ed = e.fecha_desde || e.fecha_hasta;
    if (!ed) return false; // sin fecha no puede filtrarse por fecha
    const eh = e.fecha_hasta || e.fecha_desde || ed;
    if (fDesde && eh < fDesde) return false;
    if (fHasta && ed > fHasta) return false;
    return true;
  }
  const visibles = lista.filter((e) => (!filtroTipo || e.tipo === filtroTipo) && enRango(e));

  function rangoMesActual() {
    const n = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    const y = n.getFullYear(), m = n.getMonth();
    const ultimo = new Date(y, m + 1, 0).getDate();
    setFDesde(`${y}-${p(m + 1)}-01`);
    setFHasta(`${y}-${p(m + 1)}-${p(ultimo)}`);
  }
  function rangoHoy() {
    const n = new Date();
    const iso = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    setFDesde(iso); setFHasta(iso);
  }
  const hayFiltroFecha = !!(fDesde || fHasta);

  // Al cambiar una fecha, recalcula automáticamente los días del rango (inclusive).
  function cambiarFecha(campo: 'fecha_desde' | 'fecha_hasta', valor: string) {
    setForm((f) => {
      const next = { ...f, [campo]: valor };
      const d = diasInclusive(next.fecha_desde, next.fecha_hasta);
      if (d > 0) next.dias = d;
      return next;
    });
  }
  const diasRango = diasInclusive(form.fecha_desde, form.fecha_hasta);

  return (
    <div>
      {canWrite && (
        <form onSubmit={guardar} style={{ marginBottom: '1rem' }}>
          {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
          <div className="card" style={{ padding: '.85rem' }}>
            <div className="card-title" style={{ marginBottom: '.5rem' }}>Registrar (vacaciones · permisos · utilidades · notas)</div>
            <div className="form-grid">
              <div className="form-row">
                <label>Trabajador</label>
                <select className="select" value={form.personal_id} onChange={(e) => setForm((f) => ({ ...f, personal_id: e.target.value }))} required>
                  <option value="">— elegir —</option>
                  {personal.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>Tipo</label>
                <select className="select" value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as RrhhEvento['tipo'] }))}>
                  {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-row"><label>Desde</label><input className="input" type="date" value={form.fecha_desde ?? ''} max={form.fecha_hasta || undefined} onChange={(e) => cambiarFecha('fecha_desde', e.target.value)} /></div>
              <div className="form-row"><label>Hasta</label><input className="input" type="date" value={form.fecha_hasta ?? ''} min={form.fecha_desde || undefined} onChange={(e) => cambiarFecha('fecha_hasta', e.target.value)} /></div>
              {tipoCfg?.conDias && <div className="form-row"><label>Días</label><input className="input mono" type="number" min={0} step="any" value={form.dias ?? ''} onChange={(e) => setForm((f) => ({ ...f, dias: e.target.value === '' ? null : Number(e.target.value) }))} /></div>}
              {tipoCfg?.conMonto && <div className="form-row"><label>Monto (USD)</label><input className="input mono" type="number" min={0} step="any" value={form.monto ?? ''} onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value === '' ? null : Number(e.target.value) }))} /></div>}
              <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Descripción</label><input className="input" value={form.descripcion ?? ''} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} placeholder="Detalle del registro" /></div>
            </div>
            {diasRango > 0 && (
              <div className="muted" style={{ marginTop: '.4rem', fontSize: '.84rem' }}>
                📅 <strong>{diasRango}</strong> día(s) seleccionados en el rango.
              </div>
            )}
            <div style={{ marginTop: '.5rem' }}><button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : '+ Registrar'}</button></div>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label style={{ fontSize: '.7rem' }}>Desde</label>
          <input className="input" type="date" value={fDesde} max={fHasta || undefined} onChange={(e) => setFDesde(e.target.value)} style={{ width: 'auto' }} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label style={{ fontSize: '.7rem' }}>Hasta</label>
          <input className="input" type="date" value={fHasta} min={fDesde || undefined} onChange={(e) => setFHasta(e.target.value)} style={{ width: 'auto' }} />
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={rangoHoy} title="Solo hoy">Hoy</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={rangoMesActual} title="Mes en curso">Este mes</button>
        {hayFiltroFecha && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setFDesde(''); setFHasta(''); }} title="Quitar filtro de fecha">✕ fecha</button>}
        <select className="select" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      {hayFiltroFecha && (
        <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.4rem' }}>
          Mostrando registros que caen en {fDesde ? <strong>{date(fDesde)}</strong> : '…'} → {fHasta ? <strong>{date(fHasta)}</strong> : '…'} · {visibles.length} resultado(s).
        </div>
      )}

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Trabajador</th><th>Tipo</th><th>Período</th><th style={{ textAlign: 'right' }}>Días</th><th style={{ textAlign: 'right' }}>Monto</th><th>Descripción</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !visibles.length && <tr><td colSpan={7}><EmptyState message="Sin registros administrativos" icon="🗂" /></td></tr>}
            {!loading && visibles.map((e) => (
              <tr key={e.id}>
                <td>{nombre(e.personal_id)}</td>
                <td><span className="badge">{labelTipo(e.tipo)}</span></td>
                <td className="muted">{e.fecha_desde ? `${date(e.fecha_desde)}${e.fecha_hasta ? ` → ${date(e.fecha_hasta)}` : ''}` : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{e.dias != null ? e.dias : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{e.monto != null ? money(e.monto) : '—'}</td>
                <td className="muted">{e.descripcion || '—'}</td>
                {canWrite && <td style={{ textAlign: 'center' }}><button className="btn btn-sm btn-ghost" onClick={() => setPorBorrar(e)} title="Eliminar" style={{ color: 'var(--danger)' }}>🗑</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {porBorrar && (
        <ConfirmDialog
          title="Eliminar registro"
          message="¿Eliminar este registro del histórico administrativo?"
          confirmText="Eliminar" danger
          onConfirm={() => void confirmarBorrado()}
          onCancel={() => setPorBorrar(null)} />
      )}
    </div>
  );
}
