import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { SearchSelect, type SearchOption } from '@/shared/ui/SearchSelect';
import { FechaVe } from '@/shared/ui/FechaVe';
import { toast } from '@/shared/ui/Toast';
import { money, date } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Personal, RrhhEvento } from '@/shared/lib/types';
import { listPersonal } from './personal.repository';
import { listEventos, eliminarEvento } from './eventos.repository';
import { EMPRESA_POR_DEFECTO, type Empresa } from './empresa';
import { EventoTipoModal } from './EventoTipoModal';
import { SolicitudPermisoModal } from './SolicitudPermisoModal';
import { inicialSolicitudPermiso } from './permisoLaboral';
import { verSolicitudPermisoPdf } from './solicitudPermisoPdf';

const TIPOS: { key: RrhhEvento['tipo']; label: string }[] = [
  { key: 'vacacion', label: 'Vacaciones' },
  { key: 'permiso', label: 'Permiso' },
  { key: 'utilidad', label: 'Utilidad / Aguinaldo' },
  { key: 'nota', label: 'Nota / Historial' },
];
const labelTipo = (t: string) => TIPOS.find((x) => x.key === t)?.label ?? t;

type ModalState = { tipo: RrhhEvento['tipo']; evento?: RrhhEvento | null } | null;

export function AdministrativoTab({ canWrite, actor, actorName, empresa = EMPRESA_POR_DEFECTO }: {
  canWrite: boolean; actor: string; actorName: string | null; empresa?: Empresa;
}) {
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [lista, setLista] = useState<RrhhEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [personalId, setPersonalId] = useState('');
  const [tipoNuevo, setTipoNuevo] = useState<RrhhEvento['tipo']>('permiso');
  const [modal, setModal] = useState<ModalState>(null);
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
  }, [empresa]);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['rrhh_eventos', 'personal'], () => { void recargar(); });

  const nombre = (id?: string | null) => {
    const p = personal.find((x) => x.id === id);
    return p ? `${p.nombre} ${p.apellido}`.trim() : '—';
  };

  // El PDF 📄 se arma con los datos actuales de la ficha, no con un snapshot
  // viejo que pudo quedar con el nombre cortado.
  const verPdfPermiso = (e: RrhhEvento) => {
    const form = inicialSolicitudPermiso(personal, '', e.empresa || empresa, e);
    void verSolicitudPermisoPdf(form, form.empresa);
  };

  const opciones: SearchOption[] = personal.filter((p) => p.activo).map((p) => ({
    value: p.id,
    label: `${p.nombre} ${p.apellido}`.trim(),
    hint: p.numero_ficha ? `Ficha ${p.numero_ficha}` : p.cedula ?? undefined,
    keywords: [p.cedula, p.cargo, p.departamento, p.telefono].filter((x): x is string => !!x),
  }));

  function abrirFormulario() {
    if (!personalId) { setError('Elegí el trabajador de la lista.'); return; }
    setError(null);
    setModal({ tipo: tipoNuevo });
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

  return (
    <div>
      {canWrite && (
        <div style={{ marginBottom: '1rem' }}>
          {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Revisá:</strong> {error}</div>}
          <div className="card" style={{ padding: '.85rem' }}>
            <div className="card-title" style={{ marginBottom: '.5rem' }}>Registrar (vacaciones · permisos · utilidades · notas)</div>
            <div className="form-grid">
              <div className="form-row">
                <label>Trabajador</label>
                <SearchSelect
                  options={opciones}
                  value={personalId}
                  onChange={(v) => { setPersonalId(v); setError(null); }}
                  placeholder="Buscar por nombre, cédula, cargo…"
                  emptyText="Sin trabajadores para esta empresa"
                />
              </div>
              <div className="form-row">
                <label>Tipo</label>
                <select className="select" value={tipoNuevo} onChange={(e) => setTipoNuevo(e.target.value as RrhhEvento['tipo'])}>
                  {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: '.6rem' }}>
              <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} onClick={abrirFormulario}>
                Continuar → {labelTipo(tipoNuevo)}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label style={{ fontSize: '.7rem' }}>Desde</label>
          <FechaVe value={fDesde} onChange={setFDesde} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label style={{ fontSize: '.7rem' }}>Hasta</label>
          <FechaVe value={fHasta} onChange={setFHasta} />
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
                {canWrite && <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {e.tipo === 'permiso' && (
                    <>
                      {e.solicitud && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => verPdfPermiso(e)}
                          title="Ver PDF oficial de la solicitud"
                        >
                          📄
                        </button>
                      )}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModal({ tipo: 'permiso', evento: e })} title="Ver solicitud y agregar soportes">📎</button>
                    </>
                  )}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPorBorrar(e)} title="Eliminar" style={{ color: 'var(--danger)' }}>🗑</button>
                </td>}
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

      {modal?.tipo === 'permiso' && (
        <SolicitudPermisoModal
          personal={personal}
          personalId={personalId}
          empresa={empresa}
          actor={actor}
          actorName={actorName}
          evento={modal.evento}
          onClose={() => setModal(null)}
          onGuardado={() => void recargar()}
        />
      )}
      {modal && modal.tipo !== 'permiso' && (
        <EventoTipoModal
          tipo={modal.tipo}
          personal={personal}
          personalId={personalId}
          empresa={empresa}
          actor={actor}
          actorName={actorName}
          onClose={() => setModal(null)}
          onGuardado={() => void recargar()}
        />
      )}
    </div>
  );
}
