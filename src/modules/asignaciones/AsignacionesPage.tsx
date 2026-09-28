/* ============================================================
   MGG · Asignaciones · La pantalla

   Arriba, lo que hay que saber de un vistazo: cuántas cosas están sin
   devolver y cuántas personas las tienen. Las dos tarjetas se abren y
   muestran el detalle, porque «hay 14 pendientes» no sirve de nada si
   no se puede ver cuáles.

   Abajo, la lista con todos los filtros y, por trabajador, el histórico
   completo en PDF: el papel que se firma al entrar y al liquidar.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { listPersonal } from '@/modules/rrhh/personal.repository';
import { numeroFicha } from '@/modules/rrhh/fichaPersonal';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { listExistencias } from '@/modules/inventario/almacenes.repository';
import type { Asignacion, Existencia, Personal, Producto } from '@/shared/lib/types';
import {
  ESTADOS_ASIGNACION, FILTRO_ASIGNACIONES_VACIO, TIPOS_ASIGNACION,
  estaPendiente, filtrarAsignaciones, hayFiltro, iconoTipo, labelTipo,
  pendientesPorPersona, rangosRapidos, resumenAsignaciones, textoEstado,
  type EstadoAsignacion, type FiltroAsignaciones,
} from './asignaciones';
import {
  actualizarAsignacion, crearAsignacion, devolverAsignacion, eliminarAsignacion,
  listAsignaciones, reabrirAsignacion, type AsignacionInput,
} from './asignaciones.repository';
import { AsignacionFormModal } from './AsignacionFormModal';
import { verConsolidadoAsignacionesPdf, verHistorialAsignacionesPdf } from './asignacionesPdf';

function hoyIso(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function AsignacionesPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('asignaciones', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const [lista, setLista] = useState<Asignacion[]>([]);
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [loading, setLoading] = useState(true);

  const [filtro, setFiltro] = useState<FiltroAsignaciones>(FILTRO_ASIGNACIONES_VACIO);
  const [masFiltros, setMasFiltros] = useState(false);

  const [form, setForm] = useState<{ abierto: boolean; editando: Asignacion | null } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [devolviendo, setDevolviendo] = useState<Asignacion | null>(null);
  const [porBorrar, setPorBorrar] = useState<Asignacion | null>(null);
  const [porReabrir, setPorReabrir] = useState<Asignacion | null>(null);
  const [verLista, setVerLista] = useState<'pendientes' | 'personas' | null>(null);
  const [historialDe, setHistorialDe] = useState<Personal | null>(null);

  const recargar = useCallback(async () => {
    setLoading(true);
    const [as, ps, pr, ex] = await Promise.all([
      listAsignaciones().catch((e) => { toast(e instanceof Error ? e.message : 'No se pudieron cargar las asignaciones', 'error'); return [] as Asignacion[]; }),
      listPersonal().catch(() => [] as Personal[]),
      listProductos().catch(() => [] as Producto[]),
      listExistencias().catch(() => [] as Existencia[]),
    ]);
    setLista(as); setPersonal(ps); setProductos(pr); setExistencias(ex);
    setLoading(false);
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['asignaciones', 'personal', 'existencias'], () => { void recargar(); });

  const personaPorId = useMemo(() => new Map(personal.map((p) => [p.id, p])), [personal]);
  const nombreDe = useCallback((id: string | null | undefined) => {
    const p = personaPorId.get(id ?? '');
    return p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : '—';
  }, [personaPorId]);

  const visibles = useMemo(
    () => filtrarAsignaciones(lista, filtro, nombreDe),
    [lista, filtro, nombreDe],
  );

  // Las tarjetas miran TODO, no lo filtrado: son el estado de la empresa, no el
  // de la búsqueda de turno. Lo filtrado tiene su propia tarjeta.
  const resumenTotal = useMemo(() => resumenAsignaciones(lista), [lista]);
  const resumenFiltrado = useMemo(() => resumenAsignaciones(visibles), [visibles]);
  const deudores = useMemo(() => pendientesPorPersona(lista), [lista]);
  const pendientesTodos = useMemo(() => lista.filter(estaPendiente), [lista]);

  const rangos = useMemo(() => rangosRapidos(), []);

  async function guardar(input: AsignacionInput) {
    setGuardando(true);
    try {
      const quien = nombreDe(input.personal_id);
      if (form?.editando) {
        await actualizarAsignacion(form.editando.id, input, quien, { actor, actorName });
        toast('Asignación corregida', 'success');
      } else {
        await crearAsignacion(input, quien, { actor, actorName });
        toast('Asignación registrada', 'success');
      }
      setForm(null);
      await recargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    } finally { setGuardando(false); }
  }

  async function confirmarBorrado() {
    if (!porBorrar) return;
    const fila = porBorrar;
    setPorBorrar(null);
    try {
      await eliminarAsignacion(fila.id, nombreDe(fila.personal_id), { actor, actorName });
      toast(fila.descontado ? 'Eliminada · el material volvió al almacén' : 'Eliminada', 'success');
      await recargar();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  async function confirmarReapertura() {
    if (!porReabrir) return;
    const fila = porReabrir;
    setPorReabrir(null);
    try {
      await reabrirAsignacion(fila.id, nombreDe(fila.personal_id), { actor, actorName });
      toast('Asignación reabierta', 'success');
      await recargar();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo reabrir', 'error'); }
  }

  async function verHistorialPdf(persona: Personal) {
    const suyas = lista.filter((a) => a.personal_id === persona.id
      && (!filtro.desde || (a.fecha_asignacion ?? '') >= filtro.desde)
      && (!filtro.hasta || (a.fecha_asignacion ?? '') <= filtro.hasta));
    try {
      await verHistorialAsignacionesPdf(persona, suyas, { desde: filtro.desde, hasta: filtro.hasta });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function verConsolidado() {
    try {
      await verConsolidadoAsignacionesPdf(visibles, nombreDe, { desde: filtro.desde, hasta: filtro.hasta });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🎒 Asignaciones</h1>
          <p className="hint muted">
            Lo que la empresa le entrega a cada trabajador: dotación, líneas telefónicas, equipos y material de oficina.
            Lo que <strong>sale del inventario</strong> se descuenta del almacén; lo <strong>retornable</strong> queda pendiente hasta que lo devuelvan.
          </p>
        </div>
      </div>

      {/* ── Las tres tarjetas ── */}
      <div className="cards-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>
        <button
          type="button"
          className="card"
          onClick={() => setVerLista('pendientes')}
          style={{ textAlign: 'left', cursor: 'pointer', borderLeft: '3px solid var(--danger)' }}
        >
          <div className="muted" style={{ fontSize: '.72rem', letterSpacing: '.04em' }}>PENDIENTES POR DEVOLVER</div>
          <div style={{ fontSize: '1.9rem', fontWeight: 700, color: 'var(--danger)' }}>{resumenTotal.pendientes}</div>
          <div className="hint muted" style={{ fontSize: '.76rem' }}>cosa(s) sin devolver · tocá para ver el detalle</div>
        </button>

        <button
          type="button"
          className="card"
          onClick={() => setVerLista('personas')}
          style={{ textAlign: 'left', cursor: 'pointer', borderLeft: '3px solid var(--warning)' }}
        >
          <div className="muted" style={{ fontSize: '.72rem', letterSpacing: '.04em' }}>TRABAJADORES CON PENDIENTES</div>
          <div style={{ fontSize: '1.9rem', fontWeight: 700, color: 'var(--warning)' }}>{resumenTotal.personasConPendientes}</div>
          <div className="hint muted" style={{ fontSize: '.76rem' }}>persona(s) · tocá para ver la lista</div>
        </button>

        <div className="card" style={{ borderLeft: '3px solid var(--border)' }}>
          <div className="muted" style={{ fontSize: '.72rem', letterSpacing: '.04em' }}>EN LO FILTRADO</div>
          <div style={{ fontSize: '1.9rem', fontWeight: 700 }}>{resumenFiltrado.total}</div>
          <div className="hint muted" style={{ fontSize: '.76rem' }}>
            {resumenFiltrado.pendientes} por devolver · {resumenFiltrado.cerradas} cerrada(s)
          </div>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label>Buscar</label>
            <input
              value={filtro.texto}
              onChange={(e) => setFiltro((f) => ({ ...f, texto: e.target.value }))}
              placeholder="Trabajador, descripción, serial o línea…" />
          </div>
          <div className="form-group">
            <label>Trabajador</label>
            <select value={filtro.personalId} onChange={(e) => setFiltro((f) => ({ ...f, personalId: e.target.value }))}>
              <option value="">— todos —</option>
              {personal.map((p) => (
                <option key={p.id} value={p.id}>{`${p.nombre} ${p.apellido ?? ''}`.trim()}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Tipo</label>
            <select value={filtro.tipo} onChange={(e) => setFiltro((f) => ({ ...f, tipo: e.target.value }))}>
              <option value="">Todos</option>
              {TIPOS_ASIGNACION.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Estado</label>
            <select value={filtro.estado} onChange={(e) => setFiltro((f) => ({ ...f, estado: e.target.value }))}>
              <option value="">Todos</option>
              {ESTADOS_ASIGNACION.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Desde</label>
            <input type="date" value={filtro.desde} onChange={(e) => setFiltro((f) => ({ ...f, desde: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Hasta</label>
            <input type="date" value={filtro.hasta} onChange={(e) => setFiltro((f) => ({ ...f, hasta: e.target.value }))} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {rangos.map((r) => (
            <button key={r.label} className="btn btn-ghost btn-sm"
              onClick={() => setFiltro((f) => ({ ...f, desde: r.desde, hasta: r.hasta }))}>{r.label}</button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setMasFiltros((v) => !v)}>
            {masFiltros ? '▴' : '▾'} Más filtros
          </button>
          {hayFiltro(filtro) && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFiltro(FILTRO_ASIGNACIONES_VACIO)}>✕ Limpiar</button>
          )}
          <span className="hint muted" style={{ marginLeft: 'auto', fontSize: '.8rem' }}>
            {visibles.length} de {lista.length}
          </span>
        </div>

        {masFiltros && (
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.85rem' }}>
              <input type="checkbox" checked={filtro.soloPendientes}
                onChange={(e) => setFiltro((f) => ({ ...f, soloPendientes: e.target.checked }))} />
              Solo pendientes por devolver
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.85rem' }}>
              <input type="checkbox" checked={filtro.soloHistoricas}
                onChange={(e) => setFiltro((f) => ({ ...f, soloHistoricas: e.target.checked }))} />
              Solo cargas históricas
            </label>
          </div>
        )}
      </div>

      {/* ── Acciones ── */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setForm({ abierto: true, editando: null })}>
            + Registrar asignación
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => void verConsolidado()}>📄 Consolidado en PDF</button>
      </div>

      {/* ── La tabla ── */}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Trabajador</th>
              <th>Tipo</th>
              <th>Lo asignado</th>
              <th>Almacén</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((a) => {
              const persona = personaPorId.get(a.personal_id) ?? null;
              const pendiente = estaPendiente(a);
              return (
                <tr key={a.id}>
                  <td>{date(a.fecha_asignacion)}</td>
                  <td>
                    {nombreDe(a.personal_id)}
                    {persona?.numero_ficha && (
                      <div className="muted" style={{ fontSize: '.72rem' }}>{numeroFicha(persona.numero_ficha)}</div>
                    )}
                  </td>
                  <td>{iconoTipo(a.tipo)} {labelTipo(a.tipo)}</td>
                  <td>
                    {a.descripcion}
                    {(a.serial || a.numero_linea || Number(a.cantidad) > 1) && (
                      <div className="muted" style={{ fontSize: '.72rem' }}>
                        {[
                          a.serial ? `S/N ${a.serial}` : '',
                          a.numero_linea ? `Línea ${a.numero_linea}` : '',
                          Number(a.cantidad) > 1 ? `${num(Number(a.cantidad))} ${a.unidad ?? 'und'}` : '',
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {a.historico && <span className="badge" title="Ya existía antes del sistema: no tocó el inventario">histórico</span>}
                  </td>
                  <td>{a.almacen ?? '—'}</td>
                  <td>
                    <span style={{ color: pendiente ? 'var(--danger)' : undefined }}>
                      {textoEstado(a.estado, a.retornable)}
                    </span>
                    {a.fecha_retorno && (
                      <div className="muted" style={{ fontSize: '.72rem' }}>{date(a.fecha_retorno)}</div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {persona && (
                      <button className="btn btn-icon btn-ghost" title="Histórico de esta persona en PDF"
                        onClick={() => void verHistorialPdf(persona)}>📄</button>
                    )}
                    {canWrite && pendiente && (
                      <button className="btn btn-icon btn-ghost" title="Registrar la devolución"
                        onClick={() => setDevolviendo(a)}>↩</button>
                    )}
                    {canWrite && a.estado !== 'asignado' && (
                      <button className="btn btn-icon btn-ghost" title="Reabrir: se cerró por error"
                        onClick={() => setPorReabrir(a)}>⟲</button>
                    )}
                    {canWrite && (
                      <button className="btn btn-icon btn-ghost" title="Corregir"
                        onClick={() => setForm({ abierto: true, editando: a })}>✎</button>
                    )}
                    {canWrite && (
                      <button className="btn btn-icon btn-ghost" title="Eliminar"
                        onClick={() => setPorBorrar(a)}>🗑</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !visibles.length && (
          <EmptyState icon="🎒" message={hayFiltro(filtro) ? 'Ninguna asignación con esos filtros' : 'Todavía no hay asignaciones registradas'} />
        )}
        {loading && <div className="muted" style={{ padding: '1rem' }}>Cargando…</div>}
      </div>

      {form?.abierto && (
        <AsignacionFormModal
          editando={form.editando}
          personal={personal}
          productos={productos}
          existencias={existencias}
          guardando={guardando}
          onGuardar={(input) => void guardar(input)}
          onClose={() => setForm(null)}
        />
      )}

      {devolviendo && (
        <DevolverModal
          asignacion={devolviendo}
          quien={nombreDe(devolviendo.personal_id)}
          onHecho={async (cierre) => {
            try {
              await devolverAsignacion(devolviendo.id, cierre, nombreDe(devolviendo.personal_id), { actor, actorName });
              toast(cierre.estado === 'devuelto' && devolviendo.descontado
                ? 'Devuelta · el material volvió al almacén'
                : 'Asignación cerrada', 'success');
              setDevolviendo(null);
              await recargar();
            } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cerrar', 'error'); }
          }}
          onClose={() => setDevolviendo(null)}
        />
      )}

      {verLista === 'pendientes' && (
        <Modal title="🎒 Pendientes por devolver" size="lg" onClose={() => setVerLista(null)}>
          {!pendientesTodos.length
            ? <EmptyState icon="✔" message="No hay nada pendiente de devolución" />
            : (
              <table className="table">
                <thead><tr><th>Trabajador</th><th>Tipo</th><th>Lo asignado</th><th>Desde</th></tr></thead>
                <tbody>
                  {pendientesTodos.map((a) => (
                    <tr key={a.id} style={{ cursor: 'pointer' }}
                      onClick={() => { setFiltro({ ...FILTRO_ASIGNACIONES_VACIO, personalId: a.personal_id }); setVerLista(null); }}>
                      <td>{nombreDe(a.personal_id)}</td>
                      <td>{iconoTipo(a.tipo)} {labelTipo(a.tipo)}</td>
                      <td>{a.descripcion}</td>
                      <td>{date(a.fecha_asignacion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </Modal>
      )}

      {verLista === 'personas' && (
        <ListaDeudores
          deudores={deudores}
          personaPorId={personaPorId}
          onElegir={(id) => { setFiltro({ ...FILTRO_ASIGNACIONES_VACIO, personalId: id }); setVerLista(null); }}
          onPdf={(p) => void verHistorialPdf(p)}
          onClose={() => setVerLista(null)}
        />
      )}

      {historialDe && (
        <Modal title={`📄 Histórico de ${historialDe.nombre}`} size="lg" onClose={() => setHistorialDe(null)}>
          <button className="btn btn-primary" onClick={() => void verHistorialPdf(historialDe)}>Ver en PDF</button>
        </Modal>
      )}

      {porBorrar && (
        <ConfirmDialog
          title="Eliminar asignación"
          message={porBorrar.descontado
            ? `¿Eliminar «${porBorrar.descripcion}» de ${nombreDe(porBorrar.personal_id)}?\n\nComo salió del inventario, el material vuelve al almacén ${porBorrar.almacen ?? ''}.`
            : `¿Eliminar «${porBorrar.descripcion}» de ${nombreDe(porBorrar.personal_id)}?\n\nEsta acción no se puede deshacer.`}
          confirmText="Eliminar" danger
          onConfirm={() => void confirmarBorrado()}
          onCancel={() => setPorBorrar(null)} />
      )}

      {porReabrir && (
        <ConfirmDialog
          title="Reabrir asignación"
          message={porReabrir.estado === 'devuelto' && porReabrir.producto_id && !porReabrir.historico
            ? `¿Reabrir «${porReabrir.descripcion}»?\n\nVuelve a quedar en poder de ${nombreDe(porReabrir.personal_id)} y el material sale otra vez del almacén.`
            : `¿Reabrir «${porReabrir.descripcion}»?\n\nVuelve a quedar en poder de ${nombreDe(porReabrir.personal_id)}.`}
          confirmText="Reabrir"
          onConfirm={() => void confirmarReapertura()}
          onCancel={() => setPorReabrir(null)} />
      )}
    </div>
  );
}

/** La lista buscable de quiénes deben algo. Es lo que se mira al liquidar a alguien. */
function ListaDeudores({ deudores, personaPorId, onElegir, onPdf, onClose }: {
  deudores: { personalId: string; pendientes: number }[];
  personaPorId: Map<string, Personal>;
  onElegir: (id: string) => void;
  onPdf: (p: Personal) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const filtrados = deudores.filter((d) => {
    if (!q.trim()) return true;
    const p = personaPorId.get(d.personalId);
    return plano(`${p?.nombre ?? ''} ${p?.apellido ?? ''} ${p?.cedula ?? ''}`).includes(plano(q.trim()));
  });

  return (
    <Modal title="👥 Trabajadores con pendientes" size="lg" onClose={onClose}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona…" style={{ marginBottom: '.6rem' }} />
      {!filtrados.length
        ? <EmptyState icon="✔" message={deudores.length ? 'Nadie con ese nombre' : 'Nadie tiene nada pendiente'} />
        : (
          <table className="table">
            <thead><tr><th>Trabajador</th><th>Ficha</th><th>Pendientes</th><th /></tr></thead>
            <tbody>
              {filtrados.map((d) => {
                const p = personaPorId.get(d.personalId);
                return (
                  <tr key={d.personalId}>
                    <td style={{ cursor: 'pointer' }} onClick={() => onElegir(d.personalId)}>
                      {p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : '—'}
                    </td>
                    <td className="muted">{numeroFicha(p?.numero_ficha)}</td>
                    <td><strong style={{ color: 'var(--danger)' }}>{d.pendientes}</strong></td>
                    <td style={{ textAlign: 'right' }}>
                      {p && <button className="btn btn-icon btn-ghost" title="Histórico en PDF" onClick={() => onPdf(p)}>📄</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </Modal>
  );
}

/** Cerrar una asignación: devuelta, perdida o dañada. */
function DevolverModal({ asignacion, quien, onHecho, onClose }: {
  asignacion: Asignacion;
  quien: string;
  onHecho: (cierre: { fecha_retorno: string; estado: EstadoAsignacion; condicion_retorno?: string | null }) => void;
  onClose: () => void;
}) {
  const [fecha, setFecha] = useState(hoyIso());
  const [estado, setEstado] = useState<EstadoAsignacion>('devuelto');
  const [condicion, setCondicion] = useState('');

  const reingresa = asignacion.descontado && estado === 'devuelto';

  return (
    <Modal
      title="↩ Registrar devolución"
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary"
            onClick={() => onHecho({ fecha_retorno: fecha, estado, condicion_retorno: condicion })}>
            Cerrar asignación
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        <strong>{asignacion.descripcion}</strong><br />
        <span className="muted">Asignada a {quien} el {date(asignacion.fecha_asignacion)}</span>
      </p>

      <div className="form-row">
        <div className="form-group">
          <label>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Cómo se cierra</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoAsignacion)}>
            <option value="devuelto">Devuelto</option>
            <option value="perdido">Perdido</option>
            <option value="danado">Dañado</option>
          </select>
        </div>
      </div>

      <div className="form-group">
        <label>En qué condición volvió <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
        <input value={condicion} onChange={(e) => setCondicion(e.target.value)}
          placeholder="Ej.: funcionando, con cargador · pantalla rayada" />
      </div>

      <p className="hint muted" style={{ fontSize: '.8rem', margin: 0 }}>
        {reingresa
          ? <>El material <strong>vuelve al almacén {asignacion.almacen}</strong> con una entrada al inventario.</>
          : asignacion.descontado
          ? <>Lo <strong>perdido</strong> y lo <strong>dañado</strong> no reingresan al inventario: no están.</>
          : <>Esta asignación no salió del inventario, así que no se mueve stock.</>}
      </p>
    </Modal>
  );
}
