import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal as ModalUI } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { money, num, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type {
  Almacen, Caja, Existencia, Movimiento, MovimientoCaja, Producto,
  SolicitudSalida, EstadoSolicitudSalida, ScopeSalida, TipoSalida,
} from '@/shared/lib/types';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { listAlmacenes, listExistencias } from '@/modules/inventario/almacenes.repository';
import {
  listCajas, listSalidasDinero, listTrasladosDinero,
} from './cajas.repository';
import {
  listSalidasMaterial, listTrasladosMaterial,
  listSolicitudesSalida, aprobarSolicitudSalida, ejecutarSolicitudSalida, cancelarSolicitudSalida,
  editarSolicitudSalida,
} from './salidas.repository';
// descargarSalidaDineroPdf, descargarTrasladoDineroPdf y descargarOrdenSalidaPdf se importan dinámicamente (al generar) para no cargar jsPDF al abrir.
import { SalidaMaterialForm } from './SalidaMaterialForm';
import { TrasladoMaterialForm } from './TrasladoMaterialForm';
import { SalidaDineroForm } from './SalidaDineroForm';
import { TrasladoDineroForm } from './TrasladoDineroForm';
import { ConciliarMineralModal } from './ConciliarMineralModal';
import { GestionarCajasModal } from './GestionarCajasModal';
import { GestionarChoferesVehiculosModal } from './GestionarChoferesVehiculosModal';
import { SalidaMaterialDetalle } from './SalidaMaterialDetalle';
import { SalidaDineroDetalle } from './SalidaDineroDetalle';
import {
  descargarResumenSalidasPdf, descargarResumenSalidasExcel, enviarResumenSalidasPorCorreo,
  type SalidaResumenRow, type SalidaResumenGrupo, type ResumenSalidasMeta,
} from './resumenSalidasReporte';

type Scope = 'salidas' | 'traslados';
type Tipo = 'material' | 'dinero';
type Vista = 'kanban' | 'lista' | 'resumen';
type Modal =
  | { kind: 'none' }
  | { kind: 'salida-material' }
  | { kind: 'traslado-material' }
  | { kind: 'salida-dinero' }
  | { kind: 'traslado-dinero' }
  | { kind: 'conciliar'; salida: MovimientoCaja }
  | { kind: 'detalle-material'; mov: Movimiento; esTraslado: boolean }
  | { kind: 'detalle-dinero'; mov: MovimientoCaja; esTraslado: boolean }
  | { kind: 'detalle-solicitud'; sol: SolicitudSalida }
  | { kind: 'cajas' }
  | { kind: 'choferes-vehiculos' };

const SOL_COLS: { key: EstadoSolicitudSalida; label: string }[] = [
  { key: 'por_aprobar', label: 'Por aprobar' },
  { key: 'aprobada', label: 'Aprobada' },
  { key: 'ejecutada', label: 'Ejecutada' },
  { key: 'cancelada', label: 'Cancelada' },
];
const SOL_ESTADO_CLASS: Record<EstadoSolicitudSalida, string> = {
  por_aprobar: 'warning', aprobada: 'info', ejecutada: 'success', cancelada: 'danger',
};

export function SalidasPage() {
  const { can, appUser, isAdmin, role } = usePermissions();
  const canWrite = can('salidas', 'escritura');
  // Aprueban y ejecutan: el administrador, quien tenga FULL CONTROL del módulo,
  // cualquier ANALISTA y cualquier JEFE/JEFA. (Se excluye el rol de solo lectura,
  // que no debe ejecutar movimientos). El obrero solo crea solicitudes.
  const r = role ?? '';
  const puedeAprobar = isAdmin
    || can('salidas', 'full')
    || (r !== 'analista_de_lectura' && (/^analista/.test(r) || /^jef[ae]/.test(r)));
  const actor = appUser?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const [scope, setScope] = useState<Scope>('salidas');
  // El dinero se maneja directo desde Tesorería; Salidas solo opera material.
  const tipo: Tipo = 'material';
  const [vista, setVista] = useState<Vista>('kanban');
  const [modal, setModal] = useState<Modal>({ kind: 'none' });
  const [loading, setLoading] = useState(true);

  const [productos, setProductos] = useState<Producto[]>([]);
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [salMat, setSalMat] = useState<Movimiento[]>([]);
  const [trasMat, setTrasMat] = useState<Movimiento[]>([]);
  const [salDin, setSalDin] = useState<MovimientoCaja[]>([]);
  const [trasDin, setTrasDin] = useState<MovimientoCaja[]>([]);
  const [solicitudes, setSolicitudes] = useState<SolicitudSalida[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [pds, exs, alms, cjs, sm, tm, sd, td, sols] = await Promise.all([
        listProductos(),
        listExistencias().catch(() => [] as Existencia[]),
        listAlmacenes().catch(() => [] as Almacen[]),
        listCajas().catch(() => [] as Caja[]),
        listSalidasMaterial().catch(() => [] as Movimiento[]),
        listTrasladosMaterial().catch(() => [] as Movimiento[]),
        listSalidasDinero().catch(() => [] as MovimientoCaja[]),
        listTrasladosDinero().catch(() => [] as MovimientoCaja[]),
        listSolicitudesSalida().catch(() => [] as SolicitudSalida[]),
      ]);
      setProductos(pds); setExistencias(exs); setAlmacenes(alms); setCajas(cjs);
      setSalMat(sm); setTrasMat(tm); setSalDin(sd); setTrasDin(td); setSolicitudes(sols);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar el módulo', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Realtime multiusuario: stock, cajas y solicitudes se reflejan al instante.
  useRealtime(['movimientos', 'movimientos_caja', 'cajas', 'productos'], () => { void reload(); });
  useEffect(() => { void reload(); }, [reload]);


  const esMaterial = tipo === 'material';
  const esSalida = scope === 'salidas';
  const scopeSol: ScopeSalida = esSalida ? 'salida' : 'traslado';
  const tipoSol: TipoSalida = esMaterial ? 'material' : 'dinero';

  // Solicitudes del scope+tipo activo (para el kanban de trámite).
  const solsVista = useMemo(
    () => solicitudes.filter((s) => s.scope === scopeSol && s.tipo === tipoSol),
    [solicitudes, scopeSol, tipoSol],
  );

  function abrirNuevo() {
    if (esSalida && esMaterial) setModal({ kind: 'salida-material' });
    else if (!esSalida && esMaterial) setModal({ kind: 'traslado-material' });
    else if (esSalida && !esMaterial) setModal({ kind: 'salida-dinero' });
    else setModal({ kind: 'traslado-dinero' });
  }
  const btnLabel = esSalida ? '+ Nueva solicitud de salida' : '+ Nueva solicitud de traslado';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Salidas / Traslados</h1>
          <p className="muted">Toda salida o traslado de <strong>material por almacén</strong> se crea como <strong>solicitud</strong>: el obrero la registra, un analista, un jefe o el admin la aprueba, y al ejecutar se descuenta el stock.</p>
        </div>
        <div className="actions">
          {canWrite && <button className="btn btn-ghost" onClick={() => setModal({ kind: 'choferes-vehiculos' })}>🚚 Choferes / Vehículos</button>}
          {canWrite && <button className="btn btn-primary" onClick={abrirNuevo}>{btnLabel}</button>}
        </div>
      </div>

      {/* Switch principal: Salidas / Traslados (solo material; el dinero va por Tesorería) */}
      <div className="view-toggle" role="tablist" aria-label="Tipo de operación" style={{ marginBottom: '1rem' }}>
        <button className={scope === 'salidas' ? 'active' : ''} onClick={() => setScope('salidas')}>↘ Salidas</button>
        <button className={scope === 'traslados' ? 'active' : ''} onClick={() => { setScope('traslados'); setVista((v) => v === 'resumen' ? 'kanban' : v); }}>↔ Traslados</button>
      </div>

      {/* Vista: Kanban (trámite) / Lista (historial de movimientos ejecutados) */}
      <div className="view-toggle" role="tablist" aria-label="Kanban o lista" style={{ marginBottom: '1rem' }}>
        <button className={vista === 'kanban' ? 'active' : ''} onClick={() => setVista('kanban')}>🗂 Solicitudes</button>
        <button className={vista === 'lista' ? 'active' : ''} onClick={() => setVista('lista')}>📜 Historial</button>
        {esSalida && esMaterial && <button className={vista === 'resumen' ? 'active' : ''} onClick={() => setVista('resumen')}>📊 Resumen</button>}
      </div>

      {loading ? (
        <EmptyState message="Cargando…" icon="◔" />
      ) : (vista === 'resumen' && esSalida && esMaterial) ? (
        <ResumenSalidas solicitudes={solicitudes} actor={actor} />
      ) : vista === 'kanban' ? (
        <SolicitudesKanban sols={solsVista} onVer={(sol) => setModal({ kind: 'detalle-solicitud', sol })} />
      ) : (
        <Historial
          scope={scope} tipo={tipo}
          salMat={salMat} trasMat={trasMat} salDin={salDin} trasDin={trasDin}
          canWrite={canWrite}
          onConciliar={(s) => setModal({ kind: 'conciliar', salida: s })}
          onVerMaterial={(mov, esTraslado) => setModal({ kind: 'detalle-material', mov, esTraslado })}
          onVerDinero={(mov, esTraslado) => setModal({ kind: 'detalle-dinero', mov, esTraslado })}
        />
      )}

      {modal.kind === 'detalle-solicitud' && (
        <SolicitudDetalleModal
          sol={modal.sol}
          puedeAprobar={puedeAprobar}
          actor={actor}
          actorName={actorName}
          productos={productos}
          existencias={existencias}
          almacenes={almacenes}
          onClose={() => setModal({ kind: 'none' })}
          onChanged={reload}
        />
      )}

      {modal.kind === 'salida-material' && (
        <SalidaMaterialForm productos={productos} existencias={existencias}
          actor={actor} actorName={actorName} onClose={() => setModal({ kind: 'none' })} onSaved={reload} />
      )}
      {modal.kind === 'traslado-material' && (
        <TrasladoMaterialForm productos={productos} existencias={existencias} almacenesObj={almacenes}
          actor={actor} actorName={actorName} onClose={() => setModal({ kind: 'none' })} onSaved={reload} />
      )}
      {modal.kind === 'salida-dinero' && (
        <SalidaDineroForm cajas={cajas} almacenesObj={almacenes}
          actor={actor} actorName={actorName} onClose={() => setModal({ kind: 'none' })} onSaved={reload} />
      )}
      {modal.kind === 'traslado-dinero' && (
        <TrasladoDineroForm cajas={cajas}
          actor={actor} actorName={actorName} onClose={() => setModal({ kind: 'none' })} onSaved={reload} />
      )}
      {modal.kind === 'conciliar' && (
        <ConciliarMineralModal salida={modal.salida} productos={productos} almacenesObj={almacenes}
          actor={actor} actorName={actorName} onClose={() => setModal({ kind: 'none' })} onSaved={reload} />
      )}
      {modal.kind === 'cajas' && (
        <GestionarCajasModal actor={actor} actorName={actorName} onClose={() => setModal({ kind: 'none' })} onCambioAplicado={reload} />
      )}
      {modal.kind === 'choferes-vehiculos' && (
        <GestionarChoferesVehiculosModal actor={actor} onClose={() => setModal({ kind: 'none' })} onCambioAplicado={reload} />
      )}
      {modal.kind === 'detalle-material' && (
        <SalidaMaterialDetalle
          mov={modal.mov}
          esTraslado={modal.esTraslado}
          producto={productos.find((p) => p.id === modal.mov.producto_id) ?? null}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
      {modal.kind === 'detalle-dinero' && (
        <SalidaDineroDetalle
          mov={modal.mov}
          esTraslado={modal.esTraslado}
          producto={productos.find((p) => p.id === modal.mov.mineral_producto_id) ?? null}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
    </div>
  );
}

function Historial({
  scope, tipo, salMat, trasMat, salDin, trasDin, canWrite, onConciliar, onVerMaterial, onVerDinero,
}: {
  scope: Scope; tipo: Tipo;
  salMat: Movimiento[]; trasMat: Movimiento[]; salDin: MovimientoCaja[]; trasDin: MovimientoCaja[];
  canWrite: boolean;
  onConciliar: (s: MovimientoCaja) => void;
  onVerMaterial: (mov: Movimiento, esTraslado: boolean) => void;
  onVerDinero: (mov: MovimientoCaja, esTraslado: boolean) => void;
}) {
  // Material
  if (tipo === 'material') {
    const rows = scope === 'salidas' ? salMat : trasMat;
    const esTraslado = scope === 'traslados';
    return (
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead>
            <tr>
              <th>Fecha</th><th>Producto</th><th>{esTraslado ? 'Origen → Destino' : 'Origen'}</th>
              {!esTraslado && <th>Dirigido a</th>}
              <th>Realizado por</th>
              <th style={{ textAlign: 'right' }}>Cantidad</th>
              <th style={{ textAlign: 'right' }}>Precio unit.</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr><td colSpan={esTraslado ? 7 : 8}><EmptyState message={esTraslado ? 'Sin traslados de material.' : 'Sin salidas de material.'} icon="📦" /></td></tr>
            ) : rows.map((m) => {
              const cant = Math.abs(Number(m.delta) || 0);
              const precio = Number(m.precio_unitario) || 0;
              return (
                <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => onVerMaterial(m, esTraslado)} title="Ver detalle">
                  <td className="muted" style={{ fontSize: '.78rem' }}>{dateTime(m.at)}</td>
                  <td><strong>{m.producto?.nombre ?? '—'}</strong><div className="muted mono" style={{ fontSize: '.7rem' }}>{m.producto?.sku}</div></td>
                  <td>{esTraslado ? <span className="mono">{m.almacen} → {m.destino}</span> : <span className="badge">{m.almacen}</span>}</td>
                  {!esTraslado && <td>{m.destino || '—'}</td>}
                  <td>{m.solicitante || m.actor_name || m.actor || '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(cant)} {m.producto?.unidad ?? ''}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{precio ? money(precio) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{precio ? money(precio * cant) : '—'}</td>
                  <td className="muted" style={{ fontSize: '.78rem' }}>{m.detalle || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Dinero
  const rows = scope === 'salidas' ? salDin : trasDin;
  const esTraslado = scope === 'traslados';
  return (
    <div className="table-wrap">
      <table className="table" style={{ fontSize: '.85rem' }}>
        <thead>
          <tr>
            <th>Fecha</th><th>Caja</th>
            <th>{esTraslado ? 'Hacia' : 'Dirigido a'}</th>
            <th style={{ textAlign: 'right' }}>Monto</th>
            <th>Motivo</th>
            {!esTraslado && <th>Estado</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr><td colSpan={esTraslado ? 6 : 7}><EmptyState message={esTraslado ? 'Sin traslados de dinero.' : 'Sin salidas de dinero.'} icon="💵" /></td></tr>
          ) : rows.map((m) => (
            <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => onVerDinero(m, esTraslado)} title="Ver detalle">
              <td className="muted" style={{ fontSize: '.78rem' }}>{dateTime(m.at)}</td>
              <td>{m.caja?.nombre ?? '—'} <span className="badge">{m.moneda}</span></td>
              <td>{m.destino || '—'}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{money(Number(m.monto) || 0)}</td>
              <td className="muted" style={{ fontSize: '.78rem' }}>{m.motivo || '—'}</td>
              {!esTraslado && (
                <td>
                  <span className={`badge ${m.estado_mineral === 'conciliada' ? 'success' : 'warning'}`}>
                    {m.estado_mineral === 'conciliada' ? 'Conciliada' : 'Pendiente'}
                  </span>
                </td>
              )}
              <td className="actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-sm btn-ghost" onClick={() => { void import('./salidaPdf').then(({ descargarTrasladoDineroPdf, descargarSalidaDineroPdf }) => esTraslado ? descargarTrasladoDineroPdf(m) : descargarSalidaDineroPdf(m)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error')); }}>↓ PDF</button>
                {!esTraslado && canWrite && m.estado_mineral === 'pendiente' && (
                  <button className="btn btn-sm btn-primary" onClick={() => onConciliar(m)}>⛏ Recibir mineral</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────── Kanban de solicitudes (trámite de aprobación) ───────────── */

function resumenSolicitud(s: SolicitudSalida): string {
  if (s.tipo === 'material') {
    const multi = (s.items?.length ?? 0) > 1;
    const cant = multi ? `${s.items!.length} materiales` : num(Number(s.cantidad) || 0);
    if (s.scope === 'traslado') return `${cant} · ${s.almacen_origen} → ${s.almacen_destino}`;
    return `${cant} · ${s.almacen_origen} → ${s.destino ?? '—'}`;
  }
  const monto = money(Number(s.monto) || 0);
  if (s.scope === 'traslado') return `${monto} ${s.moneda ?? ''} → ${s.destino ?? '—'}`;
  return `${monto} ${s.moneda ?? ''} → ${s.destino ?? '—'}`;
}

function SolicitudesKanban({ sols, onVer }: { sols: SolicitudSalida[]; onVer: (s: SolicitudSalida) => void }) {
  if (!sols.length) return <EmptyState message="No hay solicitudes en esta vista. Creá una con el botón de arriba." icon="🗂" />;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '.75rem' }}>
      {SOL_COLS.map((col) => {
        const items = sols.filter((s) => s.estado === col.key);
        return (
          <div key={col.key} className="card" style={{ margin: 0, padding: '.6rem', background: 'var(--bg-1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
              <strong style={{ fontSize: '.82rem' }}>{col.label}</strong>
              <span className={`badge ${SOL_ESTADO_CLASS[col.key]}`}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {items.map((s) => (
                <button key={s.id} className="card" onClick={() => onVer(s)}
                  style={{ margin: 0, padding: '.55rem .65rem', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}>
                  <div className="mono" style={{ fontSize: '.72rem', color: 'var(--primary-3)' }}>{s.codigo}</div>
                  <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--text, #fff)' }}>
                    {s.tipo === 'material'
                      ? ((s.items?.length ?? 0) > 1 ? `${s.producto_nombre ?? 'Material'} +${s.items!.length - 1} más` : (s.producto_nombre ?? 'Material'))
                      : 'Dinero'}
                  </div>
                  <div className="muted" style={{ fontSize: '.74rem' }}>{resumenSolicitud(s)}</div>
                  <div style={{ fontSize: '.72rem', marginTop: '.2rem', color: 'var(--success)', fontWeight: 600 }}>
                    👤 {s.solicitante ?? '—'}
                  </div>
                  <div className="muted" style={{ fontSize: '.68rem', marginTop: '.15rem' }}>{dateTime(s.created_at)}</div>
                </button>
              ))}
              {!items.length && <div className="muted" style={{ fontSize: '.74rem', padding: '.25rem' }}>—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── Detalle + acciones de una solicitud ───────────── */

function SolicitudDetalleModal({
  sol, puedeAprobar, actor, actorName, productos, existencias, almacenes, onClose, onChanged,
}: {
  sol: SolicitudSalida;
  puedeAprobar: boolean;
  actor: string;
  actorName: string | null;
  productos: Producto[];
  existencias: Existencia[];
  almacenes: Almacen[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [motivoCancel, setMotivoCancel] = useState('');

  // Edición de la solicitud (solo material, antes de ejecutar). Reusa los datos ya
  // cargados (productos/existencias/almacenes) para los selects.
  const editable = sol.tipo === 'material' && (sol.estado === 'por_aprobar' || sol.estado === 'aprobada') && puedeAprobar;
  const [editando, setEditando] = useState(false);
  type LineaEd = { id: number; productoId: string; almacen: string; cantidad: string; precio: string };
  const initLineas = (): LineaEd[] => {
    const base = (sol.items && sol.items.length)
      ? sol.items.map((it) => ({ productoId: it.producto_id, almacen: it.almacen ?? sol.almacen_origen ?? '', cantidad: Number(it.cantidad) || 0, precio: it.precio_unit }))
      : [{ productoId: sol.producto_id ?? '', almacen: sol.almacen_origen ?? '', cantidad: Number(sol.cantidad) || 0, precio: sol.precio_unit }];
    return base.map((it, i) => ({ id: i + 1, productoId: it.productoId, almacen: it.almacen, cantidad: String(it.cantidad || 0), precio: it.precio != null ? String(it.precio) : '' }));
  };
  const [edLineas, setEdLineas] = useState<LineaEd[]>([]);
  const [edSeq, setEdSeq] = useState(1);
  const [edDestino, setEdDestino] = useState(sol.destino ?? '');
  const [edAlmacenDestino, setEdAlmacenDestino] = useState(sol.almacen_destino ?? '');
  const [edMotivo, setEdMotivo] = useState(sol.motivo ?? '');
  const [edFecha, setEdFecha] = useState(sol.fecha_entrega ?? '');
  const [edConsumo, setEdConsumo] = useState(!!sol.consumo_interno);
  const [edSolicitante, setEdSolicitante] = useState(sol.solicitante ?? '');

  const activos = useMemo(() => productos.filter((p) => p.estado === 'activo'), [productos]);
  const prodById = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const stockDe = (productoId: string, almacen: string) => Number(existencias.find((e) => e.producto_id === productoId && e.almacen === almacen)?.stock) || 0;
  const almacenesProd = (productoId: string) => existencias.filter((e) => e.producto_id === productoId && (Number(e.stock) || 0) > 0).map((e) => e.almacen);
  const almacenesActivos = useMemo(() => almacenes.filter((a) => a.estado === 'activo').map((a) => a.nombre), [almacenes]);

  function abrirEdicion() {
    const ls = initLineas();
    setEdLineas(ls);
    setEdSeq(ls.length + 1);
    setEdDestino(sol.destino ?? '');
    setEdAlmacenDestino(sol.almacen_destino ?? '');
    setEdMotivo(sol.motivo ?? '');
    setEdFecha(sol.fecha_entrega ?? '');
    setEdConsumo(!!sol.consumo_interno);
    setEdSolicitante(sol.solicitante ?? '');
    setEditando(true);
  }
  const setLinea = (id: number, patch: Partial<LineaEd>) => setEdLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLinea = () => { setEdLineas((ls) => [...ls, { id: edSeq, productoId: '', almacen: '', cantidad: '1', precio: '' }]); setEdSeq((s) => s + 1); };
  const quitarLinea = (id: number) => setEdLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

  async function guardarEdicion() {
    const items = edLineas.map((l) => {
      const p = prodById.get(l.productoId);
      return { producto_id: l.productoId, producto_nombre: p?.nombre ?? null, cantidad: Number(l.cantidad) || 0, precio_unit: l.precio !== '' ? Number(l.precio) : null, unidad: p?.unidad ?? null, almacen: l.almacen || null, observacion: null };
    });
    if (items.some((it) => !it.producto_id)) { toast('Elegí el material en cada renglón.', 'error'); return; }
    if (items.some((it) => !it.almacen)) { toast('Elegí el almacén de origen en cada renglón.', 'error'); return; }
    if (items.some((it) => it.cantidad <= 0)) { toast('Cada material debe tener cantidad mayor que 0.', 'error'); return; }
    setBusy(true);
    try {
      await editarSolicitudSalida(sol, {
        items,
        almacenDestino: sol.scope === 'traslado' ? (edAlmacenDestino || null) : undefined,
        destino: sol.scope === 'salida' ? edDestino : undefined,
        motivo: edMotivo, fechaEntrega: edFecha || null, consumoInterno: edConsumo,
        solicitante: edSolicitante,
      }, actor);
      notify(`Solicitud ${sol.codigo} actualizada`, 'success');
      setEditando(false);
      onChanged();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo editar la solicitud', 'error');
    } finally { setBusy(false); }
  }

  const ejecutarLabel =
    sol.tipo === 'dinero'
      ? (sol.scope === 'traslado' ? 'Ejecutar (traslado de caja)' : 'Ejecutar (egreso de caja)')
      : (sol.scope === 'traslado' ? 'Ejecutar (mueve stock)' : 'Ejecutar (descuenta stock)');

  async function run(fn: () => Promise<void>, okMsg: string) {
    setBusy(true);
    try {
      await fn();
      notify(okMsg, 'success');
      onChanged();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo completar la acción', 'error');
    } finally {
      setBusy(false);
    }
  }

  const footer = editando ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', justifyContent: 'flex-end', width: '100%' }}>
      <button className="btn btn-ghost" onClick={() => setEditando(false)} disabled={busy}>Cancelar edición</button>
      <button className="btn btn-primary" onClick={guardarEdicion} disabled={busy}>{busy ? 'Guardando…' : '✓ Guardar cambios'}</button>
    </div>
  ) : (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', justifyContent: 'flex-end', width: '100%' }}>
      {sol.tipo === 'material' && (
        <button className="btn btn-ghost" disabled={busy}
          onClick={() => { void import('./salidaPdf').then(({ descargarOrdenSalidaPdf }) => descargarOrdenSalidaPdf(sol)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error')); }}>
          ↓ Orden de salida (PDF)
        </button>
      )}
      {editable && (
        <button className="btn btn-ghost" disabled={busy} onClick={abrirEdicion} style={{ marginRight: 'auto' }}
          title="Editar los datos de la solicitud antes de ejecutarla">
          ✎ Editar solicitud
        </button>
      )}
      {puedeAprobar && sol.estado === 'por_aprobar' && (
        <button className="btn btn-primary" disabled={busy}
          onClick={() => run(() => aprobarSolicitudSalida(sol, actor), `Solicitud ${sol.codigo} aprobada`)}>
          ✔ Aprobar
        </button>
      )}
      {puedeAprobar && sol.estado === 'aprobada' && (
        <button className="btn btn-primary" disabled={busy}
          onClick={() => run(() => ejecutarSolicitudSalida(sol, actor, actorName), `Solicitud ${sol.codigo} ejecutada`)}>
          {ejecutarLabel}
        </button>
      )}
      {sol.estado !== 'ejecutada' && sol.estado !== 'cancelada' && (
        <button className="btn btn-danger" disabled={busy} onClick={() => setCancelOpen(true)}>Cancelar solicitud</button>
      )}
      <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cerrar</button>
    </div>
  );

  if (editando) {
    return (
      <ModalUI title={`Editar solicitud ${sol.codigo}`} size="lg" onClose={() => setEditando(false)} footer={footer}>
        <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.6rem' }}>
          {sol.scope === 'traslado' ? 'Traslado' : 'Salida'} de material · estado <strong>{SOL_COLS.find((c) => c.key === sol.estado)?.label}</strong>. Editás antes de ejecutar (todavía no tocó stock).
        </div>
        <div className="form-row">
          <label>Solicitante</label>
          <input className="input" value={edSolicitante} onChange={(e) => setEdSolicitante(e.target.value)} />
        </div>
        {sol.scope === 'salida' ? (
          <div className="form-row">
            <label>Dirigido a / unidad solicitante</label>
            <input className="input" value={edDestino} onChange={(e) => setEdDestino(e.target.value)} placeholder="Gerencia, Taller, Mina…" />
          </div>
        ) : (
          <div className="form-row">
            <label>Almacén destino</label>
            <select className="select" value={edAlmacenDestino} onChange={(e) => setEdAlmacenDestino(e.target.value)}>
              <option value="">— elegí el almacén destino —</option>
              {almacenesActivos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}

        <div className="form-row" style={{ marginTop: '.5rem', marginBottom: '.3rem' }}><label>Materiales</label></div>
        {edLineas.map((l, idx) => {
          const opcionesAlmacen = Array.from(new Set([...(almacenesProd(l.productoId)), ...(l.almacen ? [l.almacen] : [])]));
          const stock = stockDe(l.productoId, l.almacen);
          const p = prodById.get(l.productoId);
          const excede = (Number(l.cantidad) || 0) > stock;
          return (
            <div key={l.id} className="card" style={{ margin: '0 0 .6rem', padding: '.7rem .85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
                <strong className="muted" style={{ fontSize: '.78rem' }}>Material #{idx + 1}</strong>
                {edLineas.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => quitarLinea(l.id)} title="Quitar material">✕</button>}
              </div>
              <div className="form-grid">
                <div className="form-row">
                  <label>Producto</label>
                  <select className="select" value={l.productoId} onChange={(e) => { const id = e.target.value; const alms = almacenesProd(id); setLinea(l.id, { productoId: id, almacen: alms[0] ?? '' }); }}>
                    <option value="">— elegí el material —</option>
                    {activos.map((pr) => <option key={pr.id} value={pr.id}>{pr.nombre} · {pr.sku}</option>)}
                  </select>
                </div>
                <div className="form-row">
                  <label>Almacén origen</label>
                  <select className="select" value={l.almacen} onChange={(e) => setLinea(l.id, { almacen: e.target.value })}>
                    <option value="">— elegí el almacén —</option>
                    {(opcionesAlmacen.length ? opcionesAlmacen : almacenesActivos).map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <small className="muted">{l.productoId && l.almacen ? <>stock <strong className="mono">{num(stock)} {p?.unidad ?? ''}</strong></> : 'Elegí el material primero'}</small>
                </div>
                <div className="form-row">
                  <label>Cantidad{p?.unidad ? ` (${p.unidad})` : ''}</label>
                  <input className="input mono" type="number" min={0} step="any" value={l.cantidad} onChange={(e) => setLinea(l.id, { cantidad: e.target.value })} />
                  {excede && <small style={{ color: 'var(--warning)' }}>Disponible: {num(stock)} {p?.unidad ?? ''} (se valida al ejecutar).</small>}
                </div>
                <div className="form-row">
                  <label>Precio unit. (costo)</label>
                  <input className="input mono" type="number" min={0} step="any" value={l.precio} onChange={(e) => setLinea(l.id, { precio: e.target.value })} />
                </div>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn btn-sm btn-ghost" onClick={addLinea}>＋ Agregar material</button>

        <div className="form-grid" style={{ marginTop: '.8rem' }}>
          <div className="form-row">
            <label>Motivo / detalle</label>
            <input className="input" value={edMotivo} onChange={(e) => setEdMotivo(e.target.value)} placeholder="Motivo del despacho…" />
          </div>
          <div className="form-row">
            <label>Fecha de entrega</label>
            <input className="input" type="date" value={edFecha} onChange={(e) => setEdFecha(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={edConsumo} onChange={(e) => setEdConsumo(e.target.checked)} />
            Consumo interno
          </label>
        </div>
      </ModalUI>
    );
  }

  return (
    <ModalUI title={`Solicitud ${sol.codigo}`} onClose={onClose} footer={footer}>
      <table className="table" style={{ fontSize: '.85rem' }}>
        <tbody>
          <tr><td className="muted">Tipo</td><td>{sol.scope === 'traslado' ? 'Traslado' : 'Salida'} de {sol.tipo === 'dinero' ? 'dinero' : 'material'}</td></tr>
          <tr><td className="muted">Estado</td><td><span className={`badge ${SOL_ESTADO_CLASS[sol.estado]}`}>{SOL_COLS.find((c) => c.key === sol.estado)?.label}</span></td></tr>
          <tr><td className="muted">Solicitante</td><td>{sol.solicitante}</td></tr>
          {sol.tipo === 'material' ? (
            <>
              {(sol.items?.length ?? 0) > 1 ? (
                <tr><td className="muted">Materiales</td><td>
                  <table className="table" style={{ fontSize: '.8rem', margin: 0 }}>
                    <thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Observación</th></tr></thead>
                    <tbody>
                      {sol.items!.map((it, i) => (
                        <tr key={i}>
                          <td>{it.producto_nombre ?? '—'}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{num(Number(it.cantidad) || 0)} {it.unidad ?? ''}</td>
                          <td className="muted" style={{ fontSize: '.78rem' }}>{it.observacion || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td></tr>
              ) : (
                <>
                  <tr><td className="muted">Producto</td><td>{sol.producto_nombre ?? '—'}</td></tr>
                  <tr><td className="muted">Cantidad</td><td className="mono">{num(Number(sol.cantidad) || 0)}</td></tr>
                  {sol.items?.[0]?.observacion && <tr><td className="muted">Observación</td><td>{sol.items[0].observacion}</td></tr>}
                </>
              )}
              <tr><td className="muted">{sol.scope === 'traslado' ? 'Origen → Destino (almacén)' : 'Almacén origen'}</td>
                <td>{sol.scope === 'traslado' ? `${sol.almacen_origen} → ${sol.almacen_destino}` : sol.almacen_origen}</td></tr>
              {sol.scope === 'salida' && <tr><td className="muted">Dirigido a</td><td>{sol.destino ?? '—'}</td></tr>}
              {sol.direccion_despacho && <tr><td className="muted">Origen (despacho)</td><td>{sol.direccion_despacho}</td></tr>}
              {sol.direccion_destino && <tr><td className="muted">Destino (dirección)</td><td>{sol.direccion_destino}</td></tr>}
              {sol.chofer && <tr><td className="muted">Chofer / responsable</td><td>{sol.chofer}{sol.chofer_cedula ? ` · C.I. ${sol.chofer_cedula}` : ''}</td></tr>}
              {sol.vehiculo && <tr><td className="muted">Vehículo</td><td>{sol.vehiculo}{sol.vehiculo_placa ? ` · ${sol.vehiculo_placa}` : ''}</td></tr>}
              {sol.consumo_interno && <tr><td className="muted">Consumo interno</td><td><span className="badge info">🏭 Sí</span></td></tr>}
            </>
          ) : (
            <>
              <tr><td className="muted">Monto</td><td className="mono">{money(Number(sol.monto) || 0)} {sol.moneda ?? ''}</td></tr>
              <tr><td className="muted">{sol.scope === 'traslado' ? 'Hacia' : 'Dirigido a'}</td><td>{sol.destino ?? '—'}</td></tr>
            </>
          )}
          {sol.motivo && <tr><td className="muted">Motivo</td><td>{sol.motivo}</td></tr>}
          <tr><td className="muted">Creada</td><td>{dateTime(sol.created_at)}</td></tr>
          {sol.aprobada_en && <tr><td className="muted">Aprobada</td><td>{dateTime(sol.aprobada_en)} · {sol.aprobada_por ?? ''}</td></tr>}
          {sol.ejecutada_en && <tr><td className="muted">Ejecutada</td><td>{dateTime(sol.ejecutada_en)} · {sol.ejecutada_por ?? ''}</td></tr>}
        </tbody>
      </table>

      {!puedeAprobar && sol.estado !== 'ejecutada' && sol.estado !== 'cancelada' && (
        <div className="muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>
          Solo un analista, un jefe o el administrador puede aprobar y ejecutar esta solicitud.
        </div>
      )}

      {cancelOpen && (
        <div className="card" style={{ marginTop: '.75rem', borderColor: 'var(--danger)' }}>
          <label className="muted" style={{ fontSize: '.8rem' }}>Motivo de la cancelación</label>
          <textarea className="input" rows={2} value={motivoCancel} onChange={(e) => setMotivoCancel(e.target.value)} placeholder="Indicá por qué se cancela…" />
          <div className="actions" style={{ marginTop: '.5rem' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setCancelOpen(false)} disabled={busy}>Volver</button>
            <button className="btn btn-sm btn-danger" disabled={busy || !motivoCancel.trim()}
              onClick={() => run(() => cancelarSolicitudSalida(sol, actor, motivoCancel.trim()), `Solicitud ${sol.codigo} cancelada`)}>
              Confirmar cancelación
            </button>
          </div>
        </div>
      )}
    </ModalUI>
  );
}

/* ───────────── Resumen de salidas por unidad solicitante ───────────── */

const COLORES_UNIDAD = ['#3aa0ff', '#16c784', '#ff8a00', '#a78bfa', '#f25f5c', '#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#8d99ae'];

function ResumenSalidas({ solicitudes, actor }: { solicitudes: SolicitudSalida[]; actor: string }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [drill, setDrill] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [correoOpen, setCorreoOpen] = useState(false);

  // Salidas de material EJECUTADAS, en el rango de fechas (por su ejecución).
  const rows = useMemo<SalidaResumenRow[]>(() => {
    return solicitudes
      .filter((s) => s.scope === 'salida' && s.tipo === 'material' && s.estado === 'ejecutada')
      .map((s) => {
        const fecha = s.ejecutada_en || s.created_at;
        const cantidad = Number(s.cantidad) || 0;
        const precioUnit = Number(s.precio_unit) || 0;
        return {
          fecha,
          unidad: (s.destino || '').trim() || 'Sin unidad',
          solicitante: s.actor_name || s.solicitante || s.actor || '—',
          producto: s.producto_nombre || '—',
          cantidad,
          precioUnit,
          valor: Math.round(cantidad * precioUnit * 100) / 100,
        } as SalidaResumenRow;
      })
      .filter((r) => {
        const f = (r.fecha || '').slice(0, 10);
        if (desde && f && f < desde) return false;
        if (hasta && f && f > hasta) return false;
        if ((desde || hasta) && !f) return false;
        return true;
      })
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  }, [solicitudes, desde, hasta]);

  // Agrupado por unidad (gasto $).
  const grupos = useMemo<SalidaResumenGrupo[]>(() => {
    const m = new Map<string, SalidaResumenGrupo>();
    for (const r of rows) {
      const g = m.get(r.unidad) ?? { unidad: r.unidad, valor: 0, cantidad: 0, movs: 0 };
      g.valor = Math.round((g.valor + r.valor) * 100) / 100;
      g.cantidad += r.cantidad;
      g.movs += 1;
      m.set(r.unidad, g);
    }
    return [...m.values()].sort((a, b) => b.valor - a.valor);
  }, [rows]);

  const valorTotal = grupos.reduce((a, g) => a + g.valor, 0);
  const maxValor = Math.max(1, ...grupos.map((g) => g.valor));
  const meta: ResumenSalidasMeta = { desde: desde || undefined, hasta: hasta || undefined };
  const drillRows = useMemo(() => (drill ? rows.filter((r) => r.unidad === drill) : []), [rows, drill]);

  async function conReporte(fn: () => Promise<unknown>, okMsg?: string) {
    setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg, 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el reporte', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      {/* Filtros + reportes */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.7rem' }}>
        <strong style={{ fontSize: '.95rem' }}>Gasto de material por unidad solicitante</strong>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Desde <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ width: 'auto' }} />
        </label>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Hasta <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ width: 'auto' }} />
        </label>
        {(desde || hasta) && <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(''); setHasta(''); }}>✕ Fechas</button>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-ghost" disabled={busy || !rows.length} onClick={() => conReporte(() => descargarResumenSalidasPdf(grupos, rows, meta))}>↓ PDF</button>
          <button className="btn btn-sm btn-ghost" disabled={busy || !rows.length} onClick={() => conReporte(() => descargarResumenSalidasExcel(grupos, rows, meta))}>↓ Excel</button>
          <button className="btn btn-sm btn-ghost" disabled={busy || !rows.length} onClick={() => setCorreoOpen(true)}>✉ Correo</button>
        </div>
      </div>

      {/* Tarjetas resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.5rem', marginBottom: '.8rem' }}>
        <div className="card" style={{ padding: '.55rem .7rem', margin: 0 }}>
          <div className="muted" style={{ fontSize: '.72rem' }}>Gasto total</div>
          <strong className="mono" style={{ fontSize: '1.1rem', color: 'var(--text, #fff)' }}>{money(valorTotal)}</strong>
        </div>
        <div className="card" style={{ padding: '.55rem .7rem', margin: 0 }}>
          <div className="muted" style={{ fontSize: '.72rem' }}>Salidas</div>
          <strong className="mono" style={{ fontSize: '1.1rem', color: 'var(--text, #fff)' }}>{rows.length}</strong>
        </div>
        <div className="card" style={{ padding: '.55rem .7rem', margin: 0 }}>
          <div className="muted" style={{ fontSize: '.72rem' }}>Unidades</div>
          <strong className="mono" style={{ fontSize: '1.1rem', color: 'var(--text, #fff)' }}>{grupos.length}</strong>
        </div>
      </div>

      {!rows.length ? (
        <EmptyState icon="📊" message="Sin salidas de material ejecutadas para el periodo." />
      ) : (
        <>
          {/* Gráfico de barras clickeable por unidad */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', marginBottom: '.8rem' }}>
            {grupos.map((g, i) => {
              const activo = drill === g.unidad;
              const pct = Math.max(3, (g.valor / maxValor) * 100);
              const color = COLORES_UNIDAD[i % COLORES_UNIDAD.length];
              return (
                <button key={g.unidad} type="button" onClick={() => setDrill(activo ? null : g.unidad)}
                  title={`${g.unidad}: ${money(g.valor)} · ${g.movs} salida(s) · clic para ver el detalle`}
                  style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 220px) 1fr auto', alignItems: 'center', gap: '.6rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '.1rem 0' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '.85rem', fontWeight: activo ? 700 : 500, color: 'var(--text, #fff)' }}>{g.unidad}</span>
                  <span style={{ background: 'rgba(226,232,240,0.08)', borderRadius: 999, height: 20, overflow: 'hidden', outline: activo ? `2px solid ${color}` : 'none', outlineOffset: 1 }}>
                    <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: color, borderRadius: 999, opacity: activo || !drill ? 1 : 0.5, transition: 'width .3s, opacity .2s' }} />
                  </span>
                  <span className="mono" style={{ fontSize: '.85rem', fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--text, #fff)' }}>{money(g.valor)}</span>
                </button>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: '.72rem', marginBottom: '.5rem' }}>Tocá una unidad para ver el detalle de sus salidas (fecha, hora, solicitante, cantidad y monto).</div>

          {/* Drill-down: detalle de la unidad elegida */}
          {drill && (
            <div className="card" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem', flexWrap: 'wrap', gap: '.4rem' }}>
                <strong style={{ fontSize: '.88rem' }}>{drill} · {drillRows.length} salida(s) · {money(drillRows.reduce((a, r) => a + r.valor, 0))}</strong>
                <button className="btn btn-sm btn-ghost" onClick={() => setDrill(null)}>✕ Cerrar</button>
              </div>
              <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="table" style={{ fontSize: '.82rem' }}>
                  <thead><tr><th>Fecha / hora</th><th>Solicitante</th><th>Producto</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Valor ($)</th></tr></thead>
                  <tbody>
                    {drillRows.map((r, i) => (
                      <tr key={i}>
                        <td>{dateTime(r.fecha)}</td>
                        <td>{r.solicitante}</td>
                        <td>{r.producto}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{num(r.cantidad)}{r.unidadMedida ? ` ${r.unidadMedida}` : ''}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {correoOpen && (
        <EnviarResumenSalidasModal
          actor={actor}
          onClose={() => setCorreoOpen(false)}
          onSend={async (email) => { await enviarResumenSalidasPorCorreo(grupos, rows, meta, email ? [email] : undefined); }}
        />
      )}
    </div>
  );
}

function EnviarResumenSalidasModal({ actor, onClose, onSend }: {
  actor: string; onClose: () => void; onSend: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState(actor && actor.includes('@') ? actor : '');
  const [sending, setSending] = useState(false);

  async function enviar() {
    setSending(true);
    try {
      await onSend(email.trim());
      toast('Resumen enviado por correo.', 'success');
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo enviar', 'error'); setSending(false); }
  }

  return (
    <ModalUI title="Enviar resumen por correo" size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={sending}>Cancelar</button>
        <button className="btn btn-primary" onClick={enviar} disabled={sending}>{sending ? 'Enviando…' : '✉ Enviar'}</button>
      </>
    }>
      <div className="form-row">
        <label>Correo destino</label>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@empresa.com" />
        <small className="muted">Si lo dejás vacío, va a la administración / jefatura por defecto. Se adjunta el PDF del resumen.</small>
      </div>
    </ModalUI>
  );
}
