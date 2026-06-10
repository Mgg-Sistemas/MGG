import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime, money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { getNombresAlmacenes } from '@/modules/inventario/almacenes.repository';
import type { Combustible, SolicitudCombustible, Tanque, VehiculoMaquina, TransferenciaCombustibleInter } from '@/shared/lib/types';
import {
  listCombustibles,
  listSolicitudesCombustible,
  crearCombustible,
  registrarIngreso,
  renombrarCombustible,
  setEstadoCombustible,
  crearSolicitudCombustible,
  aprobarSolicitudCombustible,
  finalizarSolicitudCombustible,
  cancelarSolicitudCombustible,
  consumoCombustiblePeriodo,
  listTanques,
  crearTanque,
  actualizarTanque,
  eliminarTanque,
  listVehiculos,
  crearVehiculo,
  actualizarVehiculo,
  setEstadoVehiculo,
  eliminarVehiculo,
} from './combustible.repository';
import { ConsumoChartModal } from '@/shared/ui/ConsumoChartModal';
import { descargarSolicitudCombustiblePdf } from './combustiblePdf';
import { enviarCombustibleAMultiples } from './enviarCombustible';
import {
  listTransferenciasCombustible,
  confirmarTransferenciaCombustibleEntrante,
  reintentarTransferenciaCombustible,
} from './transferenciasCombustibleInter.repository';

type Vista = 'kanban' | 'lista';
const COLS: { key: SolicitudCombustible['estado']; label: string }[] = [
  { key: 'por_aprobar', label: 'Por aprobar' },
  { key: 'aprobada', label: 'Aprobada' },
  { key: 'finalizada', label: 'Finalizada' },
  { key: 'cancelada', label: 'Cancelada' },
];
const ESTADO_LABEL: Record<string, string> = {
  por_aprobar: '⏳ Por aprobar', aprobada: '✅ Aprobada', finalizada: '🏁 Finalizada', cancelada: '✖ Cancelada',
};

/* ───────────── Origen/destino físico (tanques · se reflejan en inventario) ───────────── */
// Tanques activos del combustible elegido (o sin combustible asignado).
function tanquesDelCombustible(tanques: Tanque[], combustibleId: string): Tanque[] {
  return tanques.filter((t) => t.estado === 'activo' && (!t.combustible_id || t.combustible_id === combustibleId));
}
// Valor por defecto del selector: primer tanque del combustible, o su almacén "casa".
function defaultOrigen(tanques: Tanque[], comb: Combustible | null, almacenes: string[], combustibleId: string): string {
  const tqs = tanquesDelCombustible(tanques, combustibleId);
  if (tqs.length) return `tnk:${tqs[0].id}`;
  return `alm:${comb?.home_almacen || almacenes[0] || ''}`;
}
// Resuelve el valor del select ('tnk:<id>' | 'alm:<nombre>') a {almacen, tanque}.
// Al ser tanque, el inventario se refleja en el almacén "casa" del combustible.
function resolverOrigen(sel: string, comb: Combustible | null, almacenes: string[], tanques: Tanque[]):
  { almacen: string; tanqueId: string | null; tanqueNombre: string | null } {
  if (sel.startsWith('tnk:')) {
    const id = sel.slice(4);
    const t = tanques.find((x) => x.id === id) ?? null;
    return { almacen: comb?.home_almacen || almacenes[0] || 'General', tanqueId: id, tanqueNombre: t?.nombre ?? null };
  }
  return { almacen: sel.replace(/^alm:/, ''), tanqueId: null, tanqueNombre: null };
}
// Selector combinado: tanques (primero) + almacenes de inventario.
function OrigenSelect({ tanques, almacenes, combustibleId, value, onChange, label, help }: {
  tanques: Tanque[]; almacenes: string[]; combustibleId: string;
  value: string; onChange: (v: string) => void; label: string; help?: string;
}) {
  const tqs = tanquesDelCombustible(tanques, combustibleId);
  return (
    <div className="form-row">
      <label>{label}</label>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} required>
        {tqs.length > 0 && (
          <optgroup label="🛢 Tanques">
            {tqs.map((t) => <option key={t.id} value={`tnk:${t.id}`}>🛢 {t.nombre} · {num(t.litros)}/{num(t.capacidad_litros)} L{t.ubicacion ? ` · ${t.ubicacion}` : ''}</option>)}
          </optgroup>
        )}
        <optgroup label="Almacenes (inventario)">
          {!almacenes.length && <option value="">— sin almacenes —</option>}
          {almacenes.map((a) => <option key={a} value={`alm:${a}`}>{a}</option>)}
        </optgroup>
      </select>
      {help && <small className="muted">{help}</small>}
    </div>
  );
}

/* ───────────── Destino de la salida: Almacén o Vehículo / Máquina ───────────── */
// Reemplaza al "Persona" genérico: aquí el combustible se entrega a un vehículo o
// máquina registrado (o a un almacén). La lista de vehículos se administra desde
// el botón "🚜 Vehículos / Máquinas" de la vista principal.
function DestinoCombustibleSelect({ value, onChange, almacenes, vehiculos, label }: {
  value: string; onChange: (v: string) => void; almacenes: string[]; vehiculos: VehiculoMaquina[]; label: string;
}) {
  const ESPECIALES = ['Consumo Interno'];
  const opcionesAlmacen = [...ESPECIALES, ...almacenes.filter((a) => !ESPECIALES.includes(a))];
  const activos = vehiculos.filter((v) => v.estado === 'activo');
  const [modo, setModo] = useState<'almacen' | 'vehiculo'>('almacen');

  function cambiarModo(next: 'almacen' | 'vehiculo') { setModo(next); onChange(''); }

  return (
    <div className="form-row">
      <label>{label}</label>
      <div className="view-toggle" role="tablist" aria-label="Tipo de destino" style={{ marginBottom: '.4rem', marginLeft: 0 }}>
        <button type="button" className={modo === 'almacen' ? 'active' : ''} onClick={() => cambiarModo('almacen')}>▣ Almacén</button>
        <button type="button" className={modo === 'vehiculo' ? 'active' : ''} onClick={() => cambiarModo('vehiculo')}>🚜 Vehículo / Máquina</button>
      </div>

      {modo === 'almacen' ? (
        <select className="select" value={opcionesAlmacen.includes(value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— elegí el almacén —</option>
          {opcionesAlmacen.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      ) : (
        <>
          {/* Buscador: escribí parte del nombre y elegí de la lista filtrada. */}
          <input className="input" list="cmb-veh-list" value={value} onChange={(e) => onChange(e.target.value)}
            placeholder="🔎 Buscá el vehículo / máquina…" autoComplete="off" />
          <datalist id="cmb-veh-list">
            {activos.map((v) => <option key={v.id} value={v.nombre}>{v.descripcion ? `🚜 ${v.descripcion}` : '🚜'}</option>)}
          </datalist>
          {!activos.length && <small className="muted">No hay vehículos / máquinas registrados. Agregalos con "🚜 Vehículos / Máquinas".</small>}
        </>
      )}
    </div>
  );
}

export function CombustiblePage() {
  const { user } = useSession();
  const { can: canPerm, appUser } = usePermissions();
  const canWrite = canPerm('combustible', 'escritura');
  const actor = user?.email ?? 'sistema';
  // Nombre de la persona logueada (no el correo) para precargar "quién solicita".
  const miNombre = appUser?.nombre?.trim() || user?.email || '';

  const [combustibles, setCombustibles] = useState<Combustible[]>([]);
  const [solicitudes, setSolicitudes] = useState<SolicitudCombustible[]>([]);
  const [tanques, setTanques] = useState<Tanque[]>([]);
  const [vehiculos, setVehiculos] = useState<VehiculoMaquina[]>([]);
  const [transfers, setTransfers] = useState<TransferenciaCombustibleInter[]>([]);
  const [almacenes, setAlmacenes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<Vista>('kanban');
  const [modal, setModal] = useState<'none' | 'solicitud' | 'ingreso' | 'gestionar' | 'consumo' | 'tanque' | 'vehiculos'>('none');
  const [detalle, setDetalle] = useState<SolicitudCombustible | null>(null);
  const [tanqueEdit, setTanqueEdit] = useState<Tanque | null>(null);

  const reload = useCallback(async () => {
    const [cs, ss, ts, vs, trs, alms] = await Promise.all([
      listCombustibles(),
      listSolicitudesCombustible(),
      listTanques(),
      listVehiculos(),
      listTransferenciasCombustible().catch(() => [] as TransferenciaCombustibleInter[]),
      getNombresAlmacenes(),
    ]);
    setCombustibles(cs);
    setSolicitudes(ss);
    setTanques(ts);
    setVehiculos(vs);
    setTransfers(trs);
    setAlmacenes(alms);
  }, []);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reload().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'Error al cargar', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);

  // Realtime multiusuario: combustibles, solicitudes y tanques se reflejan al instante.
  useRealtime(['combustibles', 'combustible_solicitudes', 'combustible_tanques', 'combustible_vehiculos', 'transferencias_combustible_inter'], () => { void reload(); });

  const activos = useMemo(() => combustibles.filter((c) => c.estado === 'activo'), [combustibles]);
  const valorTotal = useMemo(() => combustibles.reduce((a, c) => a + (Number(c.litros) || 0) * (Number(c.costo_litro) || 0), 0), [combustibles]);
  const litrosTotal = useMemo(() => combustibles.reduce((a, c) => a + (Number(c.litros) || 0), 0), [combustibles]);

  const porEstado = useMemo(() => {
    const m: Record<string, SolicitudCombustible[]> = { por_aprobar: [], aprobada: [], finalizada: [], cancelada: [] };
    solicitudes.forEach((s) => { (m[s.estado] ??= []).push(s); });
    return m;
  }, [solicitudes]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>⛽ Combustible</h1>
          <p className="muted">Inventario de combustible y solicitudes de salida. Flujo: Por aprobar → Aprobada → Finalizada (descuenta litros).</p>
        </div>
        <div className="actions" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setModal('consumo')} title="Gráfica de consumo de combustible por tipo">📊 Consumo</button>
          {canWrite && (
            <>
              {/* Sin combustibles, este es el ÚNICO botón que crea el primero: lo resaltamos. */}
              <button className={activos.length ? 'btn btn-ghost' : 'btn btn-primary'} onClick={() => setModal('gestionar')}>⛽ Combustibles</button>
              <button className="btn btn-ghost" onClick={() => setModal('tanque')}>🛢 Agregar Tanque</button>
              <button className="btn btn-ghost" onClick={() => setModal('vehiculos')}>🚜 Vehículos / Máquinas</button>
              <button className="btn btn-ghost" onClick={() => setModal('ingreso')} disabled={!activos.length} title={!activos.length ? 'Creá primero un combustible con "⛽ Combustibles"' : undefined}>⬇ Registrar ingreso</button>
              <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setModal('solicitud')} disabled={!activos.length} title={!activos.length ? 'Creá primero un combustible con "⛽ Combustibles"' : undefined}>+ Nueva solicitud de salida</button>
            </>
          )}
        </div>
      </div>

      {/* Litros pendientes por recepción (puente inter-sistema) */}
      <RecepcionCombustibleInterPanel
        transfers={transfers} tanques={tanques} canWrite={canWrite}
        actor={actor} actorName={miNombre} onChanged={reload}
      />

      {/* Tarjetas de inventario */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        {combustibles.map((c) => {
          const litros = Number(c.litros) || 0;
          const costo = Number(c.costo_litro) || 0;
          return (
            <div key={c.id} className="card" style={{ opacity: c.estado === 'activo' ? 1 : 0.55 }}>
              <div className="card-title"><span>⛽ {c.nombre}</span>{c.estado !== 'activo' && <span className="badge">inactivo</span>}</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }} className="mono">{num(litros)} L</div>
              <div className="muted" style={{ fontSize: '.82rem', marginTop: '.4rem' }}>
                <div>Costo por litro: <strong className="mono">{money(costo)}</strong></div>
                <div>Valor total: <strong className="mono" style={{ color: 'var(--primary-3)' }}>{money(litros * costo)}</strong></div>
              </div>
            </div>
          );
        })}
        {combustibles.length > 0 && (
          <div className="card" style={{ borderColor: 'var(--primary)' }}>
            <div className="card-title"><span>TOTAL GENERAL</span></div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }} className="mono">{num(litrosTotal)} L</div>
            <div className="muted" style={{ fontSize: '.82rem', marginTop: '.4rem' }}>
              Valor: <strong className="mono" style={{ color: 'var(--primary-3)' }}>{money(valorTotal)}</strong>
            </div>
          </div>
        )}
        {!combustibles.length && !loading && (
          <div className="card"><p className="muted" style={{ margin: 0 }}>Sin combustibles. Creá uno con "⛽ Combustibles".</p></div>
        )}
      </div>

      {/* Tanques (depósitos físicos) */}
      {tanques.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 .6rem' }}>🛢 Tanques</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
            {tanques.map((t) => {
              const cap = Number(t.capacidad_litros) || 0;
              const lit = Number(t.litros) || 0;
              const pct = cap > 0 ? Math.min(100, Math.round((lit / cap) * 100)) : 0;
              const color = pct >= 60 ? 'var(--success, #2ea043)' : pct >= 25 ? 'var(--warning, #ffae00)' : 'var(--danger, #e5484d)';
              return (
                <div key={t.id} className="card" style={{ opacity: t.estado === 'activo' ? 1 : 0.55, cursor: canWrite ? 'pointer' : 'default' }}
                  onClick={() => { if (canWrite) setTanqueEdit(t); }}>
                  <div className="card-title"><span>🛢 {t.nombre}</span>{t.estado !== 'activo' && <span className="badge">inactivo</span>}</div>
                  <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 700 }}>{num(lit)} <span style={{ fontSize: '.85rem', fontWeight: 400 }} className="muted">/ {num(cap)} L</span></div>
                  {/* Medidor de nivel */}
                  <div style={{ height: 10, borderRadius: 999, background: 'var(--border)', overflow: 'hidden', margin: '.5rem 0 .35rem' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width .3s' }} />
                  </div>
                  <div className="muted" style={{ fontSize: '.8rem' }}>
                    <div>Nivel: <strong style={{ color }}>{pct}%</strong></div>
                    {t.combustible_nombre && <div>Combustible: <strong>⛽ {t.combustible_nombre}</strong></div>}
                    {t.ubicacion && <div>Ubicación: <strong>{t.ubicacion}</strong></div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Solicitudes */}
      <div className="filterbar" style={{ justifyContent: 'flex-end' }}>
        <div className="view-toggle" role="tablist" aria-label="Modo de vista">
          <button className={vista === 'kanban' ? 'active' : ''} onClick={() => setVista('kanban')}>▦ Kanban</button>
          <button className={vista === 'lista' ? 'active' : ''} onClick={() => setVista('lista')}>☰ Lista</button>
        </div>
      </div>

      {loading ? (
        <EmptyState message="Cargando…" icon="◔" />
      ) : !solicitudes.length ? (
        <EmptyState message="Sin solicitudes de salida de combustible." icon="⛽" />
      ) : vista === 'kanban' ? (
        <div className="kanban">
          {COLS.map((col) => (
            <div key={col.key} className="kanban-col">
              <div className="kanban-col-head"><strong>{col.label}</strong><span className="badge">{porEstado[col.key]?.length ?? 0}</span></div>
              <div className="kanban-col-body">
                {(porEstado[col.key] ?? []).map((s) => (
                  <div key={s.id} className="card" style={{ margin: 0, cursor: 'pointer' }} onClick={() => setDetalle(s)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
                      <strong>{s.codigo}</strong><span className="badge">{num(s.litros)} L</span>
                    </div>
                    <div className="muted" style={{ fontSize: '.78rem', marginTop: '.25rem' }}>
                      ⛽ {s.combustible_nombre} · → {s.destino}
                    </div>
                    <div className="muted" style={{ fontSize: '.72rem', marginTop: '.25rem' }}>Solicita: {s.solicitante}</div>
                  </div>
                ))}
                {!(porEstado[col.key] ?? []).length && <div className="muted" style={{ padding: '.5rem' }}>—</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Código</th><th>Combustible</th><th>Solicita</th><th>Destino</th><th>Litros</th><th>Estado</th><th>Creada</th></tr></thead>
            <tbody>
              {solicitudes.map((s) => (
                <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setDetalle(s)}>
                  <td className="mono">{s.codigo}</td>
                  <td>{s.combustible_nombre}</td>
                  <td>{s.solicitante}</td>
                  <td>{s.destino}</td>
                  <td className="mono">{num(s.litros)} L</td>
                  <td>{ESTADO_LABEL[s.estado] ?? s.estado}</td>
                  <td className="muted">{dateTime(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'solicitud' && (
        <SolicitudModal combustibles={activos} almacenes={almacenes} tanques={tanques} vehiculos={vehiculos} actor={actor} defaultSolicitante={miNombre}
          onClose={() => setModal('none')} onSaved={async () => { setModal('none'); await reload(); }} />
      )}
      {modal === 'vehiculos' && (
        <VehiculosModal vehiculos={vehiculos} actor={actor}
          onClose={() => setModal('none')} onChanged={reload} />
      )}
      {modal === 'ingreso' && (
        <IngresoModal combustibles={activos} almacenes={almacenes} tanques={tanques} actor={actor}
          onClose={() => setModal('none')} onSaved={async () => { setModal('none'); await reload(); }} />
      )}
      {modal === 'gestionar' && (
        <GestionarModal combustibles={combustibles} almacenes={almacenes} actor={actor}
          onClose={() => setModal('none')} onChanged={reload} />
      )}
      {(modal === 'tanque' || tanqueEdit) && (
        <TanqueModal
          tanque={tanqueEdit}
          combustibles={combustibles}
          actor={actor}
          onClose={() => { setModal('none'); setTanqueEdit(null); }}
          onSaved={async () => { setModal('none'); setTanqueEdit(null); await reload(); }}
        />
      )}
      {modal === 'consumo' && (
        <ConsumoChartModal
          title="Consumo de combustible"
          subtitle="Litros consumidos por tipo de combustible (salidas). El valor en $ usa el costo por litro de cada salida."
          cargar={async (desde, hasta) => {
            const items = await consumoCombustiblePeriodo(desde, hasta);
            return items.map((x) => ({ id: x.id, label: x.nombre, unidad: 'Lt', cantidad: x.cantidad, valor: x.valor }));
          }}
          onClose={() => setModal('none')}
        />
      )}
      {detalle && (
        <DetalleModal solicitud={detalle} canWrite={canWrite} actor={actor}
          onClose={() => setDetalle(null)} onChanged={async () => { await reload(); setDetalle(null); }} />
      )}
    </div>
  );
}

/* ───────────── Modales ───────────── */

function SolicitudModal({ combustibles, almacenes, tanques, vehiculos, actor, defaultSolicitante, onClose, onSaved }: {
  combustibles: Combustible[]; almacenes: string[]; tanques: Tanque[]; vehiculos: VehiculoMaquina[]; actor: string; defaultSolicitante: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [combustibleId, setCombustibleId] = useState(combustibles[0]?.id ?? '');
  const [solicitante, setSolicitante] = useState(defaultSolicitante);
  const [destino, setDestino] = useState('');
  const [origenSel, setOrigenSel] = useState(() => defaultOrigen(tanques, combustibles[0] ?? null, almacenes, combustibles[0]?.id ?? ''));
  const [litros, setLitros] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comb = combustibles.find((c) => c.id === combustibleId) ?? null;
  const litrosNum = Number(litros) || 0;
  const excede = comb ? litrosNum > Number(comb.litros) : false;

  // Al cambiar de combustible, sugerimos su tanque (o almacén "casa").
  useEffect(() => { setOrigenSel(defaultOrigen(tanques, comb, almacenes, combustibleId)); }, [combustibleId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!combustibleId) { setError('Elegí el combustible.'); return; }
    if (litrosNum <= 0) { setError('Indicá los litros solicitados.'); return; }
    if (!solicitante.trim()) { setError('Indicá quién solicita.'); return; }
    const org = resolverOrigen(origenSel, comb, almacenes, tanques);
    if (!org.almacen.trim() && !org.tanqueId) { setError('Indicá de qué tanque o almacén sale.'); return; }
    if (!destino.trim()) { setError('Indicá a dónde va.'); return; }
    setSaving(true);
    try {
      const s = await crearSolicitudCombustible({
        combustibleId, combustibleNombre: comb?.nombre ?? '', solicitante, destino,
        almacen: org.almacen, tanqueId: org.tanqueId, tanqueNombre: org.tanqueNombre,
        litros: litrosNum, motivo: motivo.trim() || null, actor,
      });
      notify(`Solicitud de combustible creada: ${s.codigo} · ${num(litrosNum)} L → ${destino}`, 'success', { link: '#/app/combustible' });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la solicitud.');
    } finally { setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cmb-sol" className="btn btn-primary" disabled={saving}>{saving ? 'Creando…' : 'Crear solicitud'}</button>
    </>
  );
  return (
    <Modal title="Nueva solicitud de salida de combustible" size="lg" onClose={onClose} footer={footer}>
      <form id="cmb-sol" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row">
            <label>Combustible</label>
            <select className="select" value={combustibleId} onChange={(e) => setCombustibleId(e.target.value)}>
              {!combustibles.length && <option value="">— sin combustibles —</option>}
              {combustibles.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {num(c.litros)} L disp.</option>)}
            </select>
            {comb && <small className="muted">Disponible: <strong className="mono">{num(comb.litros)} L</strong></small>}
          </div>
          <div className="form-row">
            <label>Total de litros solicitados</label>
            <input className="input mono" type="number" min={0} step="any" value={litros} onChange={(e) => setLitros(e.target.value)} required />
            {excede && <small style={{ color: 'var(--warning)' }}>Supera el stock; se validará al finalizar.</small>}
          </div>
        </div>
        <div className="form-row">
          <label>Quién hace la solicitud</label>
          <input className="input" value={solicitante} onChange={(e) => setSolicitante(e.target.value)} placeholder="Nombre de quien solicita" required />
        </div>
        <OrigenSelect
          tanques={tanques} almacenes={almacenes} combustibleId={combustibleId}
          value={origenSel} onChange={setOrigenSel}
          label="De qué tanque / almacén sale"
          help="Al finalizar, los litros salen del tanque elegido y se reflejan en el inventario."
        />
        <DestinoCombustibleSelect value={destino} onChange={setDestino} almacenes={almacenes} vehiculos={vehiculos} label="A dónde va ese combustible" />
        <div className="form-row">
          <label>Motivo / detalle (opcional)</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Referencia, equipo, etc." />
        </div>
      </form>
    </Modal>
  );
}

function IngresoModal({ combustibles, almacenes, tanques, actor, onClose, onSaved }: {
  combustibles: Combustible[]; almacenes: string[]; tanques: Tanque[]; actor: string; onClose: () => void; onSaved: () => void;
}) {
  const [combustibleId, setCombustibleId] = useState(combustibles[0]?.id ?? '');
  const [origenSel, setOrigenSel] = useState(() => defaultOrigen(tanques, combustibles[0] ?? null, almacenes, combustibles[0]?.id ?? ''));
  const [litros, setLitros] = useState('');
  const [costo, setCosto] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const litrosNum = Number(litros) || 0;
  const costoNum = Number(costo) || 0;
  const comb = combustibles.find((c) => c.id === combustibleId) ?? null;

  // Al cambiar de combustible, sugerimos su tanque (o almacén "casa").
  useEffect(() => { setOrigenSel(defaultOrigen(tanques, comb, almacenes, combustibleId)); }, [combustibleId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!combustibleId) { setError('Elegí el combustible.'); return; }
    const org = resolverOrigen(origenSel, comb, almacenes, tanques);
    if (!org.almacen.trim()) { setError('Indicá el tanque o almacén del ingreso.'); return; }
    if (litrosNum <= 0) { setError('Indicá los litros que ingresan.'); return; }
    setSaving(true);
    try {
      await registrarIngreso({ combustibleId, almacen: org.almacen, tanqueId: org.tanqueId, litros: litrosNum, costoLitro: costoNum, actor });
      notify(`Ingreso de combustible: +${num(litrosNum)} L → ${org.tanqueNombre ?? org.almacen}`, 'success', { link: '#/app/combustible' });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el ingreso.');
    } finally { setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cmb-ing" className="btn btn-primary" disabled={saving}>{saving ? 'Registrando…' : 'Registrar ingreso'}</button>
    </>
  );
  return (
    <Modal title="Registrar ingreso de combustible" size="md" onClose={onClose} footer={footer}>
      <form id="cmb-ing" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row">
            <label>Combustible</label>
            <select className="select" value={combustibleId} onChange={(e) => setCombustibleId(e.target.value)}>
              {combustibles.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <OrigenSelect
            tanques={tanques} almacenes={almacenes} combustibleId={combustibleId}
            value={origenSel} onChange={setOrigenSel}
            label="Tanque / almacén destino"
            help="Entra al tanque elegido y se refleja como ENTRADA en el inventario."
          />
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Litros que ingresan</label>
            <input className="input mono" type="number" min={0} step="any" value={litros} onChange={(e) => setLitros(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Costo por litro (USD)</label>
            <input className="input mono" type="number" min={0} step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} />
            <small className="muted">Entra al inventario y recalcula el costo promedio (PMP).</small>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function GestionarModal({ combustibles, almacenes, actor, onClose, onChanged }: {
  combustibles: Combustible[]; almacenes: string[]; actor: string; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState('');
  const [almacen, setAlmacen] = useState(almacenes[0] ?? '');
  const [litros, setLitros] = useState('');
  const [costo, setCosto] = useState('');
  const [busy, setBusy] = useState(false);
  // Feedback persistente del alta (no solo el toast efímero, que dura 3,2 s y se pierde).
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [renombrando, setRenombrando] = useState<{ id: string; actual: string } | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState('');

  // Si el modal abre sin almacén seleccionado (carga tardía), tomamos el primero disponible.
  useEffect(() => { if (!almacen && almacenes.length) setAlmacen(almacenes[0]); }, [almacenes, almacen]);

  async function crear() {
    setOkMsg(null);
    if (!nombre.trim()) { setError('Escribí el nombre del combustible (ej.: Diésel, Gasolina 95).'); return; }
    if (!almacen.trim()) { setError('Elegí el almacén donde se registra el combustible.'); return; }
    setError(null);
    setBusy(true);
    try {
      await crearCombustible({ nombre, almacen, litrosIniciales: Number(litros) || 0, costoLitro: Number(costo) || 0, actorEmail: actor });
      const msg = `Combustible "${nombre.trim()}" registrado en ${almacen}.`;
      toast(msg, 'success');
      setOkMsg(msg);
      setNombre(''); setLitros(''); setCosto('');
      await onChanged();
    } catch (e) {
      const m = e instanceof Error ? e.message : 'No se pudo crear el combustible.';
      setError(m);
      toast(m, 'error');
    }
    finally { setBusy(false); }
  }
  function abrirRenombrar(id: string, actual: string) {
    setRenombrando({ id, actual });
    setNuevoNombre(actual);
  }
  async function confirmarRenombrar() {
    if (!renombrando) return;
    const nuevo = nuevoNombre.trim();
    if (!nuevo) { toast('Indicá el nombre', 'error'); return; }
    if (nuevo === renombrando.actual) { setRenombrando(null); return; }
    setBusy(true);
    try {
      await renombrarCombustible(renombrando.id, nuevo);
      setRenombrando(null);
      await onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo renombrar', 'error'); }
    finally { setBusy(false); }
  }
  async function toggleEstado(id: string, estado: string) {
    try { await setEstadoCombustible(id, estado === 'activo' ? 'inactivo' : 'activo'); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }

  return (
    <Modal title="Gestionar combustibles" size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title"><span>Nuevo combustible</span></div>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', margin: '0 0 .75rem' }}><strong>No se pudo crear:</strong> {error}</div>}
        {okMsg && <div className="card" style={{ borderColor: 'var(--success, var(--primary))', margin: '0 0 .75rem' }}>✅ {okMsg}</div>}
        <div className="form-grid">
          <div className="form-row"><label>Nombre</label><input className="input" value={nombre} onChange={(e) => { setNombre(e.target.value); if (error) setError(null); }} placeholder="Diésel, Gasolina 95…" autoFocus /></div>
          <div className="form-row">
            <label>Almacén</label>
            <select className="select" value={almacen} onChange={(e) => setAlmacen(e.target.value)} required>
              {!almacenes.length && <option value="">— sin almacenes —</option>}
              {almacenes.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Litros iniciales (opcional)</label><input className="input mono" type="number" min={0} step="any" value={litros} onChange={(e) => setLitros(e.target.value)} /></div>
          <div className="form-row"><label>Costo por litro (opcional)</label><input className="input mono" type="number" min={0} step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} /></div>
        </div>
        <small className="muted" style={{ display: 'block', margin: '0 0 .6rem' }}>Se registra primero en el inventario (almacén elegido) y se vincula al módulo de Combustible.</small>
        <button className="btn btn-primary btn-sm" onClick={crear} disabled={busy}>+ Crear combustible</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Combustible</th><th>Litros</th><th>Costo/L</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {!combustibles.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sin combustibles.</td></tr>}
            {combustibles.map((c) => (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td className="mono">{num(c.litros)} L</td>
                <td className="mono">{money(c.costo_litro)}</td>
                <td>{c.estado === 'activo' ? '🟢 Activo' : '⚪ Inactivo'}</td>
                <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => abrirRenombrar(c.id, c.nombre)}>✎</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => toggleEstado(c.id, c.estado)}>{c.estado === 'activo' ? 'Deshabilitar' : 'Habilitar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {renombrando && (
        <Modal
          title="Renombrar combustible"
          size="md"
          onClose={() => setRenombrando(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setRenombrando(null)} disabled={busy}>Cancelar</button>
              <button className="btn btn-primary" onClick={confirmarRenombrar} disabled={busy}>Guardar</button>
            </>
          }
        >
          <div className="form-row">
            <label>Nuevo nombre del combustible</label>
            <input
              className="input"
              autoFocus
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void confirmarRenombrar(); }}
              placeholder="Diésel, Gasolina 95…"
            />
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/* ───────────── Modal: agregar / editar tanque ───────────── */
function TanqueModal({ tanque, combustibles, actor, onClose, onSaved }: {
  tanque: Tanque | null; combustibles: Combustible[]; actor: string;
  onClose: () => void; onSaved: () => void;
}) {
  const esEdicion = !!tanque;
  const [nombre, setNombre] = useState(tanque?.nombre ?? '');
  const [combustibleId, setCombustibleId] = useState(tanque?.combustible_id ?? '');
  const [capacidad, setCapacidad] = useState(tanque ? String(tanque.capacidad_litros) : '');
  const [litros, setLitros] = useState(tanque ? String(tanque.litros) : '');
  const [ubicacion, setUbicacion] = useState(tanque?.ubicacion ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capNum = Number(capacidad) || 0;
  const litNum = Number(litros) || 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) { setError('Indicá el nombre del tanque.'); return; }
    if (capNum <= 0) { setError('La capacidad debe ser mayor que 0.'); return; }
    if (litNum > capNum) { setError('Los litros actuales no pueden superar la capacidad.'); return; }
    setSaving(true);
    try {
      if (esEdicion && tanque) {
        await actualizarTanque(tanque.id, {
          nombre, combustibleId: combustibleId || null, capacidadLitros: capNum, litros: litNum, ubicacion,
        });
        notify(`Tanque "${nombre.trim()}" actualizado`, 'success', { link: '#/app/combustible' });
      } else {
        await crearTanque({
          nombre, combustibleId: combustibleId || null, capacidadLitros: capNum,
          litrosIniciales: litNum, ubicacion, actorEmail: actor,
        });
        notify(`Tanque "${nombre.trim()}" agregado · ${num(capNum)} L de capacidad`, 'success', { link: '#/app/combustible' });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el tanque.');
    } finally { setSaving(false); }
  }

  async function borrar() {
    if (!tanque) return;
    setSaving(true);
    try { await eliminarTanque(tanque.id); notify(`Tanque "${tanque.nombre}" eliminado`, 'info', { link: '#/app/combustible' }); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar'); setSaving(false); }
  }

  const footer = (
    <>
      {esEdicion && <button type="button" className="btn btn-danger" onClick={borrar} disabled={saving} style={{ marginRight: 'auto' }}>Eliminar</button>}
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="tanque-form" className="btn btn-primary" disabled={saving}>
        {saving ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Agregar tanque'}
      </button>
    </>
  );

  return (
    <Modal title={esEdicion ? `Editar tanque · ${tanque?.nombre}` : 'Agregar tanque'} size="md" onClose={onClose} footer={footer}>
      <form id="tanque-form" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-row">
          <label>Nombre del tanque *</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tanque Principal, Tanque Patio…" autoFocus required />
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Capacidad máxima (L) *</label>
            <input className="input mono" type="number" min={0} step="any" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Litros actuales</label>
            <input className="input mono" type="number" min={0} step="any" value={litros} onChange={(e) => setLitros(e.target.value)} />
            {capNum > 0 && <small className="muted">Nivel: <strong>{Math.min(100, Math.round((litNum / capNum) * 100))}%</strong></small>}
          </div>
        </div>
        <div className="form-row">
          <label>Combustible que almacena</label>
          <select className="select" value={combustibleId} onChange={(e) => setCombustibleId(e.target.value)}>
            <option value="">— sin asignar —</option>
            {combustibles.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>Ubicación</label>
          <input className="input" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Patio Matanzas, Sede Los Pinos…" />
        </div>
      </form>
    </Modal>
  );
}

/* ───────────── Modal: vehículos / máquinas ───────────── */
function VehiculosModal({ vehiculos, actor, onClose, onChanged }: {
  vehiculos: VehiculoMaquina[]; actor: string; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id: string; nombre: string; descripcion: string } | null>(null);
  const [busqueda, setBusqueda] = useState('');

  // Búsqueda tolerante (sin acentos / mayúsculas) sobre nombre y descripción.
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(busqueda);
  const filtrados = q ? vehiculos.filter((v) => norm(v.nombre).includes(q) || norm(v.descripcion).includes(q)) : vehiculos;

  async function crear() {
    setOkMsg(null);
    if (!nombre.trim()) { setError('Escribí el nombre del vehículo o máquina (ej.: Camión 350, Retroexcavadora).'); return; }
    setError(null);
    setBusy(true);
    try {
      await crearVehiculo({ nombre, descripcion, actorEmail: actor });
      const msg = `"${nombre.trim()}" registrado.`;
      toast(msg, 'success');
      setOkMsg(msg);
      setNombre(''); setDescripcion('');
      await onChanged();
    } catch (e) {
      const m = e instanceof Error ? e.message : 'No se pudo registrar.';
      setError(m); toast(m, 'error');
    } finally { setBusy(false); }
  }
  async function guardarEdicion() {
    if (!editando) return;
    if (!editando.nombre.trim()) { toast('Indicá el nombre', 'error'); return; }
    setBusy(true);
    try {
      await actualizarVehiculo(editando.id, { nombre: editando.nombre, descripcion: editando.descripcion });
      setEditando(null);
      await onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setBusy(false); }
  }
  async function toggleEstado(v: VehiculoMaquina) {
    try { await setEstadoVehiculo(v.id, v.estado === 'activo' ? 'inactivo' : 'activo'); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }
  async function borrar(v: VehiculoMaquina) {
    try { await eliminarVehiculo(v.id); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <Modal title="Vehículos / Máquinas" size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title"><span>Nuevo vehículo / máquina</span></div>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', margin: '0 0 .75rem' }}><strong>No se pudo registrar:</strong> {error}</div>}
        {okMsg && <div className="card" style={{ borderColor: 'var(--success, var(--primary))', margin: '0 0 .75rem' }}>✅ {okMsg}</div>}
        <div className="form-grid">
          <div className="form-row"><label>Nombre *</label><input className="input" value={nombre} onChange={(e) => { setNombre(e.target.value); if (error) setError(null); }} placeholder="Camión 350, Retroexcavadora, Planta eléctrica…" autoFocus /></div>
          <div className="form-row"><label>Descripción (opcional)</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Placa, modelo, área…" /></div>
        </div>
        <small className="muted" style={{ display: 'block', margin: '0 0 .6rem' }}>Aparecerá en la lista "A dónde va ese combustible" al crear una solicitud de salida.</small>
        <button className="btn btn-primary btn-sm" onClick={crear} disabled={busy}>+ Registrar</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', margin: '0 0 .6rem' }}>
        <input className="input" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="🔎 Buscar vehículo / máquina…" style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: '.78rem', whiteSpace: 'nowrap' }}>{filtrados.length} de {vehiculos.length}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Vehículo / Máquina</th><th>Descripción</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {!vehiculos.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Sin vehículos / máquinas.</td></tr>}
            {!!vehiculos.length && !filtrados.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Sin resultados para "{busqueda}".</td></tr>}
            {filtrados.map((v) => (
              <tr key={v.id}>
                <td>🚜 {v.nombre}</td>
                <td className="muted">{v.descripcion || '—'}</td>
                <td>{v.estado === 'activo' ? '🟢 Activo' : '⚪ Inactivo'}</td>
                <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditando({ id: v.id, nombre: v.nombre, descripcion: v.descripcion ?? '' })}>✎</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => toggleEstado(v)}>{v.estado === 'activo' ? 'Deshabilitar' : 'Habilitar'}</button>
                  <button className="btn btn-sm btn-danger" onClick={() => borrar(v)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <Modal title="Editar vehículo / máquina" size="md" onClose={() => setEditando(null)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEditando(null)} disabled={busy}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardarEdicion} disabled={busy}>Guardar</button>
          </>
        }>
          <div className="form-row">
            <label>Nombre</label>
            <input className="input" autoFocus value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') void guardarEdicion(); }} placeholder="Camión 350, Retroexcavadora…" />
          </div>
          <div className="form-row">
            <label>Descripción (opcional)</label>
            <input className="input" value={editando.descripcion} onChange={(e) => setEditando({ ...editando, descripcion: e.target.value })} placeholder="Placa, modelo, área…" />
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function DetalleModal({ solicitud, canWrite, actor, onClose, onChanged }: {
  solicitud: SolicitudCombustible; canWrite: boolean; actor: string;
  onClose: () => void; onChanged: () => Promise<void>;
}) {
  const s = solicitud;
  const [busy, setBusy] = useState(false);
  const [correoOpen, setCorreoOpen] = useState(false);
  const [emails, setEmails] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [motivoCancel, setMotivoCancel] = useState('');

  async function aprobar() {
    setBusy(true);
    try { await aprobarSolicitudCombustible(s, actor); notify(`Solicitud ${s.codigo} aprobada`, 'success', { link: '#/app/combustible' }); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo aprobar', 'error'); setBusy(false); }
  }
  async function finalizar() {
    setBusy(true);
    try { await finalizarSolicitudCombustible(s, actor); notify(`Solicitud ${s.codigo} finalizada · -${num(s.litros)} L`, 'success', { link: '#/app/combustible' }); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo finalizar', 'error'); setBusy(false); }
  }
  async function cancelar() {
    const motivo = motivoCancel.trim();
    if (!motivo) { toast('Indicá el motivo de la cancelación', 'error'); return; }
    setBusy(true);
    try {
      await cancelarSolicitudCombustible(s, actor, motivo);
      notify(`Solicitud ${s.codigo} cancelada`, 'info', { link: '#/app/combustible' });
      setCancelOpen(false);
      await onChanged();
    }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cancelar', 'error'); setBusy(false); }
  }
  async function pdf() {
    try { await descargarSolicitudCombustiblePdf(s); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }
  async function enviarCorreo() {
    const lista = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!lista.length) { toast('Indicá al menos un correo', 'error'); return; }
    setEnviando(true);
    try {
      const { enviados, fallidos } = await enviarCombustibleAMultiples(s, lista);
      toast(`Enviado a: ${enviados.join(', ')}`, 'success');
      if (fallidos.length) toast(`Falló: ${fallidos.map((f) => f.email).join(', ')}`, 'error');
      setCorreoOpen(false); setEmails('');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo enviar', 'error'); }
    finally { setEnviando(false); }
  }

  const filas: Array<[string, string]> = [
    ['Código', s.codigo],
    ['Combustible', s.combustible_nombre],
    ['Quién solicita', s.solicitante],
    ['Tanque de origen', s.tanque_nombre || '—'],
    ['Almacén (inventario)', s.almacen || '—'],
    ['A dónde va', s.destino],
    ['Total de litros', `${num(s.litros)} L`],
    ['Estado', ESTADO_LABEL[s.estado] ?? s.estado],
    ['Motivo', s.motivo || '—'],
    ['Creada', dateTime(s.created_at)],
    ['Aprobada', s.aprobada_en ? `${dateTime(s.aprobada_en)} · ${s.aprobada_por ?? ''}`.trim() : '—'],
    ['Finalizada', s.finalizada_en ? `${dateTime(s.finalizada_en)} · ${s.finalizada_por ?? ''}`.trim() : '—'],
  ];

  return (
    <Modal title={`Solicitud ${s.codigo}`} size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={pdf}>↓ PDF</button>
        <button className="btn btn-ghost" onClick={() => setCorreoOpen(true)}>✉ Correo</button>
        {canWrite && s.estado === 'por_aprobar' && <button className="btn btn-primary" onClick={aprobar} disabled={busy}>Aprobar</button>}
        {canWrite && s.estado === 'aprobada' && <button className="btn btn-primary" onClick={finalizar} disabled={busy}>Finalizar (descuenta litros)</button>}
        {canWrite && s.estado !== 'finalizada' && s.estado !== 'cancelada' && <button className="btn btn-danger" onClick={() => setCancelOpen(true)} disabled={busy}>Cancelar</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>
    }>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.86rem' }}>
          <tbody>{filas.map(([k, v]) => <tr key={k}><td style={{ fontWeight: 600, width: 170 }}>{k}</td><td>{v}</td></tr>)}</tbody>
        </table>
      </div>

      {correoOpen && (
        <Modal title="Enviar solicitud por correo" size="md" onClose={() => !enviando && setCorreoOpen(false)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setCorreoOpen(false)} disabled={enviando}>Cancelar</button>
            <button className="btn btn-primary" onClick={enviarCorreo} disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar'}</button>
          </>
        }>
          <div className="form-row">
            <label>Correo(s) destinatario(s)</label>
            <input className="input" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="correo@ejemplo.com, otro@ejemplo.com" autoFocus />
            <small className="muted">Separá varios con coma o espacio. Se adjunta el reporte PDF.</small>
          </div>
        </Modal>
      )}

      {cancelOpen && (
        <Modal title={`Cancelar solicitud ${s.codigo}`} size="md" onClose={() => !busy && setCancelOpen(false)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setCancelOpen(false)} disabled={busy}>Volver</button>
            <button className="btn btn-danger" onClick={cancelar} disabled={busy}>Confirmar cancelación</button>
          </>
        }>
          <div className="form-row">
            <label>Motivo de la cancelación</label>
            <textarea className="input" rows={3} value={motivoCancel} onChange={(e) => setMotivoCancel(e.target.value)} placeholder="Indicá por qué se cancela la solicitud…" autoFocus />
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/* ───────────── Litros pendientes por recepción (puente inter-sistema) ───────────── */

const ESTADO_TRANSFER_COMB: Record<string, { label: string; color: string }> = {
  enviada: { label: 'En tránsito · esperando confirmación', color: 'var(--warning)' },
  por_confirmar: { label: 'Por confirmar', color: 'var(--warning)' },
  recibida: { label: 'Recibida ✓', color: 'var(--success)' },
  rechazada: { label: 'Rechazada', color: 'var(--danger)' },
  error: { label: 'Pendiente de entrega ⟳', color: 'var(--danger)' },
};

// Tarjeta SIEMPRE visible (igual que "Dinero por entrar"): muestra los litros que
// otro sistema traslada hacia MGG. Al confirmar, los litros entran al tanque elegido
// (que se refleja en el inventario) y se avisa al origen (ACK).
function RecepcionCombustibleInterPanel({ transfers, tanques, canWrite, actor, actorName, onChanged }: {
  transfers: TransferenciaCombustibleInter[]; tanques: Tanque[]; canWrite: boolean;
  actor: string; actorName: string | null; onChanged: () => void | Promise<void>;
}) {
  const [sel, setSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const entrantes = transfers.filter((t) => t.direccion === 'entrante' && t.estado === 'por_confirmar');
  const salientesVivas = transfers.filter((t) => t.direccion === 'saliente' && t.estado !== 'recibida');
  const tanquesActivos = tanques.filter((t) => t.estado === 'activo');
  const totalLitros = entrantes.reduce((a, t) => a + (Number(t.litros) || 0), 0);

  // Tanque sugerido por entrante: el que almacena ese combustible, si existe.
  function tanqueSugerido(t: TransferenciaCombustibleInter): string {
    const match = tanquesActivos.find((tq) => (tq.combustible_nombre || '').trim().toLowerCase() === t.combustible_nombre.trim().toLowerCase());
    return sel[t.id] ?? match?.id ?? tanquesActivos[0]?.id ?? '';
  }

  async function confirmar(t: TransferenciaCombustibleInter) {
    const tanqueId = tanqueSugerido(t);
    if (!tanqueId) { toast('Necesitás un tanque activo que reciba los litros.', 'error'); return; }
    setBusy(t.id);
    try {
      await confirmarTransferenciaCombustibleEntrante({ row: t, tanqueId, actor, actorName });
      notify(`Recepción confirmada · +${num(t.litros)} L de ${t.empresa_origen}`, 'success', { link: '#/app/combustible' });
      await onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo confirmar', 'error'); }
    finally { setBusy(null); }
  }
  async function reintentar(t: TransferenciaCombustibleInter) {
    setBusy(t.id);
    try { await reintentarTransferenciaCombustible(t); toast('Reintento enviado al otro sistema', 'success'); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Sigue sin poder entregarse', 'error'); }
    finally { setBusy(null); }
  }

  return (
    <div className="card" style={{ marginBottom: '1.25rem', borderColor: entrantes.length ? 'var(--brand, #ff8a00)' : undefined }}>
      {/* Cabecera tipo banner (siempre visible) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.9rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '2rem', lineHeight: 1 }}>⛽⬇</div>
        <div style={{ flex: '1 1 240px' }}>
          <div style={{ fontWeight: 800, letterSpacing: '.03em' }}>LITROS PENDIENTES POR RECEPCIÓN</div>
          <div className="muted" style={{ fontSize: '.84rem' }}>
            {entrantes.length
              ? `${entrantes.length} ${entrantes.length === 1 ? 'traslado' : 'traslados'} de otro sistema esperando que confirmes la recepción`
              : 'Sin recepciones pendientes'}
          </div>
        </div>
        {entrantes.length > 0 && (
          <div className="mono" style={{ fontSize: '1.7rem', fontWeight: 700, color: 'var(--primary-3)' }}>{num(totalLitros)} L</div>
        )}
      </div>

      {/* Entrantes por confirmar */}
      {entrantes.length > 0 && (
        <div style={{ display: 'grid', gap: '.45rem', marginTop: '.8rem' }}>
          {entrantes.map((t) => (
            <div key={t.id} className="card" style={{ margin: 0, padding: '.55rem .7rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.5rem' }}>
              <div style={{ flex: '1 1 240px', fontSize: '.85rem' }}>
                <strong>De {t.empresa_origen}</strong> · <span className="mono">{num(t.litros)} L</span> de ⛽ {t.combustible_nombre}
                {t.motivo ? <span className="muted"> · {t.motivo}</span> : null}
                <div className="muted" style={{ fontSize: '.72rem' }}>{dateTime(t.created_at)}</div>
              </div>
              <select className="select" value={tanqueSugerido(t)} onChange={(e) => setSel((m) => ({ ...m, [t.id]: e.target.value }))} style={{ maxWidth: 220 }}>
                {!tanquesActivos.length && <option value="">— sin tanques activos —</option>}
                {tanquesActivos.map((tq) => <option key={tq.id} value={tq.id}>🛢 {tq.nombre} · {num(tq.litros)}/{num(tq.capacidad_litros)} L</option>)}
              </select>
              {canWrite && (
                <button className="btn btn-sm btn-primary" disabled={busy === t.id || !tanquesActivos.length} onClick={() => confirmar(t)}>
                  {busy === t.id ? 'Confirmando…' : '✓ Confirmar recepción'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Salientes (litros que MGG envió a otro sistema) en tránsito / con error */}
      {salientesVivas.length > 0 && (
        <div style={{ marginTop: '.8rem' }}>
          <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.35rem' }}>Salientes (litros enviados a otro sistema)</div>
          <div style={{ display: 'grid', gap: '.4rem' }}>
            {salientesVivas.map((t) => {
              const est = ESTADO_TRANSFER_COMB[t.estado] ?? { label: t.estado, color: 'var(--muted)' };
              return (
                <div key={t.id} className="card" style={{ margin: 0, padding: '.5rem .7rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.5rem' }}>
                  <div style={{ flex: '1 1 240px', fontSize: '.84rem' }}>
                    <strong>→ {t.empresa_destino}</strong> · <span className="mono">{num(t.litros)} L</span> de ⛽ {t.combustible_nombre}
                    <div style={{ fontSize: '.72rem', color: est.color }}>{est.label}{t.mensaje_error ? ` · ${t.mensaje_error}` : ''}</div>
                  </div>
                  {canWrite && t.estado === 'error' && (
                    <button className="btn btn-sm btn-ghost" disabled={busy === t.id} onClick={() => reintentar(t)}>
                      {busy === t.id ? 'Reintentando…' : '⟳ Reintentar'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

