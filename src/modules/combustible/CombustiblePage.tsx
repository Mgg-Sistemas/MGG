import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime, money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { AlmacenPicker } from '@/modules/inventario/AlmacenPicker';
import type { Combustible, SolicitudCombustible, Tanque, VehiculoMaquina, TransferenciaCombustibleInter, PlantaMovimiento, CatalogoCombustible, TanqueMovimiento, TipoMovimientoTanque } from '@/shared/lib/types';
import {
  listCombustibles,
  listSolicitudesCombustible,
  crearCombustible,
  renombrarCombustible,
  setEstadoCombustible,
  actualizarCombustible,
  crearSolicitudCombustible,
  aprobarSolicitudCombustible,
  finalizarSolicitudCombustible,
  cancelarSolicitudCombustible,
  consumoCombustiblePorEquipo,
  movimientosDeEquipo,
  listTanques,
  crearTanque,
  actualizarTanque,
  eliminarTanque,
  listVehiculos,
  crearVehiculo,
  actualizarVehiculo,
  setEstadoVehiculo,
  listPlantaMovimientos,
  crearPlantaMovimiento,
  PLANTA_ALERTA_LITROS,
  listCatalogo,
  crearCatalogo,
  actualizarCatalogo,
  setEstadoCatalogo,
  crearTanqueMovimiento,
  actualizarTanqueMovimiento,
  eliminarTanqueMovimiento,
  listSedesCombustible,
  renombrarSedeCombustible,
  type SedeCombustible,
  listTanqueMovimientos,
  ultimoHorometroEquipo,
  ultimoContadorTanque,
  TIPO_TANQUE_LABEL,
  type TablaCatalogo,
} from './combustible.repository';
import { ConsumoChartModal } from '@/shared/ui/ConsumoChartModal';
import { enviarReportePdf } from '@/shared/lib/enviarReporte';
import { descargarSolicitudCombustiblePdf } from './combustiblePdf';
import { enviarCombustibleAMultiples } from './enviarCombustible';
import {
  listTransferenciasCombustible,
  confirmarTransferenciaCombustibleEntrante,
  reintentarTransferenciaCombustible,
} from './transferenciasCombustibleInter.repository';
import { litrosCilindroHorizontal, longitudDesdeCapacidad, capacidadCilindro, tablaCubicacion, litrosRectangular, capacidadRectangular, tablaCubicacionRect } from './cubicacion';

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

// Sedes del combustible. Por ahora solo LOS PINOS y MGG (Matanzas).
// `key` = valor guardado en BD (combustibles.sede / tanques.sede).
const SEDES_COMBUSTIBLE: { key: string; tarjeta: string; titulo: string }[] = [
  { key: 'LOS PINOS', tarjeta: 'LOS PINOS', titulo: 'COMBUSTIBLE LOS PINOS' },
  { key: 'MATANZAS', tarjeta: 'MGG', titulo: 'COMBUSTIBLE MGG - MATANZAS' },
];
const SEDE_POR_DEFECTO = 'MATANZAS'; // los datos legados (sin sede) cuentan acá.
function sedeDe(x: { sede?: string | null }): string { return (x.sede || '').trim() || SEDE_POR_DEFECTO; }
// Tipos de movimiento de tanque (suman / restan).
const TIPOS_MOVIMIENTO: { value: TipoMovimientoTanque; label: string; signo: '+' | '−' }[] = [
  { value: 'ingreso', label: 'Ingreso (carga al tanque)', signo: '+' },
  { value: 'consumo', label: 'Consumo (uso de equipo)', signo: '−' },
  { value: 'retorno', label: 'Retorno (devolución al tanque)', signo: '+' },
  { value: 'merma', label: 'Merma (pérdida)', signo: '−' },
];

/* ───────────── Origen físico (tanques · se reflejan en inventario) ───────────── */
// Tanques activos del combustible elegido (o sin combustible asignado).
function tanquesDelCombustible(tanques: Tanque[], combustibleId: string): Tanque[] {
  return tanques.filter((t) => t.estado === 'activo' && (!t.combustible_id || t.combustible_id === combustibleId));
}
// (Selector combinado tanque/almacén eliminado: la salida ahora usa solo tanques.)

/* ───────────── Combo buscador estilizado (input + lista filtrada con el tema) ─────────────
   Reemplaza al <datalist> nativo (que el navegador no deja estilizar): muestra
   una lista propia, filtrada en vivo, con hover/scroll y los colores del sistema. */
function ComboBuscador({ value, onChange, opciones, placeholder, icono }: {
  value: string; onChange: (v: string) => void;
  opciones: { value: string; label: string; sub?: string | null }[];
  placeholder: string; icono?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(value);
  const filtradas = (q ? opciones.filter((o) => norm(o.label).includes(q) || norm(o.sub).includes(q)) : opciones).slice(0, 60);

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setAbierto(true); }}
        onFocus={() => setAbierto(true)}
        onBlur={() => window.setTimeout(() => setAbierto(false), 150)}
      />
      {abierto && filtradas.length > 0 && (
        <div style={{
          position: 'absolute', zIndex: 60, top: 'calc(100% + 4px)', left: 0, right: 0,
          maxHeight: 260, overflowY: 'auto',
          background: 'var(--card, #161d2b)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 10px 28px rgba(0,0,0,.45)',
        }}>
          {filtradas.map((o) => (
            <button
              type="button"
              key={o.value}
              onMouseEnter={() => setHover(o.value)}
              onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setAbierto(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '.5rem .7rem',
                background: hover === o.value ? 'var(--primary-2, rgba(255,138,0,.16))' : 'transparent',
                border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text, #e6edf3)', cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '.86rem', fontWeight: value === o.value ? 700 : 400 }}>{icono ? `${icono} ` : ''}{o.label}</div>
              {o.sub && <div className="muted" style={{ fontSize: '.72rem' }}>{o.sub}</div>}
            </button>
          ))}
        </div>
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
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<Vista>('kanban');
  const [modal, setModal] = useState<'none' | 'solicitud' | 'movimiento' | 'movimientos' | 'gestionar' | 'consumo' | 'tanque' | 'catalogo' | 'planta'>('none');
  const [detalle, setDetalle] = useState<SolicitudCombustible | null>(null);
  const [tanqueEdit, setTanqueEdit] = useState<Tanque | null>(null);
  const [combEdit, setCombEdit] = useState<Combustible | null>(null);
  // Histórico de movimientos: null = todos los tanques; id = filtra por ese tanque.
  const [movTanqueId, setMovTanqueId] = useState<string | null>(null);
  // Sede seleccionada: null = pantalla con las dos tarjetas; valor = clave de esa sede.
  const [sedeActiva, setSedeActiva] = useState<string | null>(null);
  // Sedes (tarjetas) editables; arrancan con los valores por defecto hasta cargar la BD.
  const [sedes, setSedes] = useState<SedeCombustible[]>(
    SEDES_COMBUSTIBLE.map((s, i) => ({ id: s.key, clave: s.key, nombre: s.tarjeta, titulo: s.titulo, orden: i })),
  );
  const [sedeEdit, setSedeEdit] = useState<SedeCombustible | null>(null);

  const reload = useCallback(async () => {
    const [cs, ss, ts, vs, trs, sd] = await Promise.all([
      listCombustibles(),
      listSolicitudesCombustible(),
      listTanques(),
      listVehiculos(),
      listTransferenciasCombustible().catch(() => [] as TransferenciaCombustibleInter[]),
      listSedesCombustible().catch(() => [] as SedeCombustible[]),
    ]);
    setCombustibles(cs);
    setSolicitudes(ss);
    setTanques(ts);
    setVehiculos(vs);
    setTransfers(trs);
    if (sd.length) setSedes(sd);
  }, []);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reload().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'Error al cargar', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);

  // Realtime multiusuario: combustibles, solicitudes y tanques se reflejan al instante.
  useRealtime(['combustibles', 'combustible_solicitudes', 'combustible_tanques', 'combustible_vehiculos', 'transferencias_combustible_inter', 'combustible_tanque_movimientos', 'combustible_autorizados', 'combustible_ubicaciones'], () => { void reload(); });

  // Litros REALES de cada combustible = suma de los litros de sus tanques (los
  // movimientos de tanque mandan; el total sube/baja con los tanques).
  const litrosPorComb = useMemo(() => {
    const m = new Map<string, number>();
    tanques.forEach((t) => { if (t.combustible_id) m.set(t.combustible_id, (m.get(t.combustible_id) ?? 0) + (Number(t.litros) || 0)); });
    return m;
  }, [tanques]);
  const litrosDe = useCallback((c: Combustible) => litrosPorComb.get(c.id) ?? 0, [litrosPorComb]);

  // Vista por sede: solo el combustible/tanques/solicitudes de la sede activa.
  const combSede = useMemo(() => (sedeActiva ? combustibles.filter((c) => sedeDe(c) === sedeActiva) : combustibles), [combustibles, sedeActiva]);
  const tanquesSede = useMemo(() => (sedeActiva ? tanques.filter((t) => sedeDe(t) === sedeActiva) : tanques), [tanques, sedeActiva]);
  const activos = useMemo(() => combSede.filter((c) => c.estado === 'activo'), [combSede]);
  const valorTotal = useMemo(() => combSede.reduce((a, c) => a + litrosDe(c) * (Number(c.costo_litro) || 0), 0), [combSede, litrosDe]);
  const litrosTotal = useMemo(() => combSede.reduce((a, c) => a + litrosDe(c), 0), [combSede, litrosDe]);
  const hoyStr = new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Totales por sede para las dos tarjetas grandes de la pantalla inicial.
  const totalesPorSede = useMemo(() => sedes.map((s) => {
    const list = combustibles.filter((c) => sedeDe(c) === s.clave);
    const litros = list.reduce((a, c) => a + (litrosPorComb.get(c.id) ?? 0), 0);
    const valor = list.reduce((a, c) => a + (litrosPorComb.get(c.id) ?? 0) * (Number(c.costo_litro) || 0), 0);
    return { ...s, litros, valor, nTanques: tanques.filter((t) => sedeDe(t) === s.clave).length };
  }), [sedes, combustibles, tanques, litrosPorComb]);

  const solicitudesSede = useMemo(() => {
    if (!sedeActiva) return solicitudes;
    const ids = new Set(combSede.map((c) => c.id));
    return solicitudes.filter((s) => !s.combustible_id || ids.has(s.combustible_id));
  }, [solicitudes, combSede, sedeActiva]);

  const porEstado = useMemo(() => {
    const m: Record<string, SolicitudCombustible[]> = { por_aprobar: [], aprobada: [], finalizada: [], cancelada: [] };
    solicitudesSede.forEach((s) => { (m[s.estado] ??= []).push(s); });
    return m;
  }, [solicitudesSede]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>⛽ {sedeActiva ? sedes.find((s) => s.clave === sedeActiva)?.titulo ?? 'Combustible' : 'Combustible'}</h1>
          <p className="muted">
            {sedeActiva
              ? <>← <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { setSedeActiva(null); setModal('none'); }}>Volver a las sedes</span> · Por aprobar → Aprobada → Finalizada (descuenta litros).</>
              : 'Elegí una sede para ver y gestionar su combustible, tanques y solicitudes.'}
          </p>
        </div>
        {sedeActiva && (
          <div className="actions" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => setModal('consumo')} title="Gráfica de consumo de combustible por tipo">📊 Consumo</button>
            <button className="btn btn-ghost" onClick={() => { setMovTanqueId(null); setModal('movimientos'); }} title="Histórico de movimientos de tanque (por mes)">🗒 Movimientos</button>
            {canWrite && (
              <>
                {/* Sin combustibles, este es el ÚNICO botón que crea el primero: lo resaltamos. */}
                <button className={activos.length ? 'btn btn-ghost' : 'btn btn-primary'} onClick={() => setModal('gestionar')}>⛽ Combustibles</button>
                <button className="btn btn-ghost" onClick={() => setModal('tanque')}>🛢 Agregar Tanque</button>
                <button className="btn btn-ghost" onClick={() => setModal('catalogo')}>📒 Catálogo</button>
                <button className="btn btn-ghost" onClick={() => setModal('planta')}>⚡ Planta Eléctrica</button>
                <button className="btn btn-ghost" onClick={() => setModal('movimiento')} disabled={!tanquesSede.length} title={!tanquesSede.length ? 'Creá primero un tanque con "🛢 Agregar Tanque"' : undefined}>⬇ Registrar Movimiento</button>
                <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setModal('solicitud')} disabled={!activos.length} title={!activos.length ? 'Creá primero un combustible con "⛽ Combustibles"' : undefined}>+ Nueva solicitud de salida</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Pantalla inicial: dos tarjetas grandes por sede */}
      {sedeActiva === null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginTop: '1rem' }}>
          {totalesPorSede.map((s) => (
            <div
              key={s.clave}
              className="card"
              style={{ cursor: 'pointer', padding: '1.6rem', borderColor: 'var(--primary)', borderWidth: 1 }}
              onClick={() => setSedeActiva(s.clave)}
              title={`Ver el combustible de ${s.nombre}`}
            >
              <div className="card-title" style={{ fontSize: '1.15rem' }}>
                <span>⛽ {s.nombre}</span>
                <span style={{ display: 'inline-flex', gap: '.5rem', alignItems: 'center' }}>
                  {canWrite && <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '.1rem .4rem' }} title="Renombrar sede" onClick={(e) => { e.stopPropagation(); setSedeEdit(s); }}>✎</button>}
                  <span className="muted" style={{ fontSize: '.8rem' }}>entrar →</span>
                </span>
              </div>
              <div className="mono" style={{ fontSize: '2.4rem', fontWeight: 800, marginTop: '.4rem' }}>{num(s.litros)} <span style={{ fontSize: '1rem', fontWeight: 400 }} className="muted">L</span></div>
              <div style={{ marginTop: '.4rem', fontSize: '1.05rem' }}>Total: <strong className="mono" style={{ color: 'var(--primary-3)' }}>{money(s.valor)}</strong></div>
              <div className="muted" style={{ fontSize: '.82rem', marginTop: '.5rem' }}>{s.nTanques} tanque(s) · al {hoyStr}</div>
            </div>
          ))}
        </div>
      )}

      {sedeActiva !== null && (
      <>{/* ── Vista de la sede activa ── */}

      {/* Litros pendientes por recepción (puente inter-sistema) */}
      <RecepcionCombustibleInterPanel
        transfers={transfers} tanques={tanquesSede} canWrite={canWrite}
        actor={actor} actorName={miNombre} onChanged={reload}
      />

      {/* Tarjetas de inventario */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        {combSede.map((c) => {
          const litros = litrosDe(c);
          const costo = Number(c.costo_litro) || 0;
          return (
            <div key={c.id} className="card" style={{ opacity: c.estado === 'activo' ? 1 : 0.55, cursor: canWrite ? 'pointer' : 'default' }}
              onClick={() => { if (canWrite) setCombEdit(c); }} title={canWrite ? 'Editar combustible (nombre / costo por litro)' : undefined}>
              <div className="card-title"><span>⛽ {c.nombre}</span>{canWrite ? <span className="muted" style={{ fontSize: '.8rem' }}>✎</span> : c.estado !== 'activo' && <span className="badge">inactivo</span>}</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }} className="mono">{num(litros)} L</div>
              <div className="muted" style={{ fontSize: '.82rem', marginTop: '.4rem' }}>
                <div>Costo por litro: <strong className="mono">{money(costo)}</strong></div>
                <div>Valor total: <strong className="mono" style={{ color: 'var(--primary-3)' }}>{money(litros * costo)}</strong></div>
                <div style={{ marginTop: '.3rem', color: 'var(--text)' }}>Al {hoyStr} hay: <strong className="mono">{num(litros)} L</strong> · <strong className="mono" style={{ color: 'var(--primary-3)' }}>{money(litros * costo)}</strong></div>
              </div>
            </div>
          );
        })}
        {combSede.length > 0 && (
          <div className="card" style={{ borderColor: 'var(--primary)' }}>
            <div className="card-title"><span>TOTAL GENERAL</span></div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }} className="mono">{num(litrosTotal)} L</div>
            <div className="muted" style={{ fontSize: '.82rem', marginTop: '.4rem' }}>
              <div>Valor: <strong className="mono" style={{ color: 'var(--primary-3)' }}>{money(valorTotal)}</strong></div>
              <div style={{ marginTop: '.3rem', color: 'var(--text)' }}>Al {hoyStr} hay: <strong className="mono">{num(litrosTotal)} L</strong> · <strong className="mono" style={{ color: 'var(--primary-3)' }}>{money(valorTotal)}</strong></div>
            </div>
          </div>
        )}
        {!combSede.length && !loading && (
          <div className="card"><p className="muted" style={{ margin: 0 }}>Sin combustibles en esta sede. Creá uno con "⛽ Combustibles".</p></div>
        )}
      </div>

      {/* Tanques (depósitos físicos) */}
      {tanquesSede.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 .6rem' }}>🛢 Tanques</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
            {tanquesSede.map((t) => {
              const cap = Number(t.capacidad_litros) || 0;
              const lit = Number(t.litros) || 0;
              const pct = cap > 0 ? Math.min(100, Math.round((lit / cap) * 100)) : 0;
              const color = pct >= 60 ? 'var(--success, #2ea043)' : pct >= 25 ? 'var(--warning, #ffae00)' : 'var(--danger, #e5484d)';
              return (
                <div key={t.id} className="card" style={{ opacity: t.estado === 'activo' ? 1 : 0.55, cursor: 'pointer' }}
                  onClick={() => { setMovTanqueId(t.id); setModal('movimientos'); }} title="Ver histórico de movimientos de este tanque">
                  <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                    <span>🛢 {t.nombre}</span>
                    {t.estado !== 'activo' && <span className="badge">inactivo</span>}
                    {canWrite && (
                      <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto', padding: '.1rem .4rem' }}
                        onClick={(e) => { e.stopPropagation(); setTanqueEdit(t); }} title="Editar tanque">✎</button>
                    )}
                  </div>
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
      ) : !solicitudesSede.length ? (
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
              {solicitudesSede.map((s) => (
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

      </>
      )}

      {modal === 'solicitud' && (
        <SolicitudModal combustibles={activos} tanques={tanquesSede} vehiculos={vehiculos} actor={actor} defaultSolicitante={miNombre}
          onClose={() => setModal('none')} onSaved={async () => { setModal('none'); await reload(); }} />
      )}
      {modal === 'catalogo' && (
        <CatalogoModal vehiculos={vehiculos} actor={actor}
          onClose={() => setModal('none')} onChanged={reload} />
      )}
      {modal === 'planta' && (
        <PlantaModal tanques={tanquesSede} vehiculos={vehiculos} actor={actor} actorName={miNombre}
          onClose={() => setModal('none')} onChanged={reload} />
      )}
      {modal === 'movimiento' && (
        <RegistrarMovimientoModal tanques={tanquesSede} vehiculos={vehiculos} combustibles={combSede} actor={actor} actorName={miNombre}
          onClose={() => setModal('none')} onSaved={async () => { setModal('none'); await reload(); }} />
      )}
      {modal === 'movimientos' && (
        <MovimientosModal tanques={tanquesSede} vehiculos={vehiculos} tanqueId={movTanqueId} actor={actor} actorName={miNombre} canWrite={canWrite} onChanged={reload}
          onClose={() => { setModal('none'); setMovTanqueId(null); }} />
      )}
      {combEdit && (
        <EditarCombustibleModal combustible={combEdit}
          onClose={() => setCombEdit(null)} onSaved={async () => { setCombEdit(null); await reload(); }} />
      )}
      {modal === 'gestionar' && (
        <GestionarModal combustibles={combSede} sede={sedeActiva} actor={actor}
          onClose={() => setModal('none')} onChanged={reload} />
      )}
      {(modal === 'tanque' || tanqueEdit) && (
        <TanqueModal
          tanque={tanqueEdit}
          combustibles={combSede}
          sede={sedeActiva}
          actor={actor}
          onClose={() => { setModal('none'); setTanqueEdit(null); }}
          onSaved={async () => { setModal('none'); setTanqueEdit(null); await reload(); }}
        />
      )}
      {modal === 'consumo' && (
        <ConsumoChartModal
          title="Consumo de combustible"
          subtitle="Litros consumidos por equipo/vehículo en el período. Cambiá entre cantidad (litros) y valor en $. El valor usa el costo por litro de cada movimiento."
          cargar={async (desde, hasta) => {
            const items = await consumoCombustiblePorEquipo(desde, hasta);
            return items.map((x) => ({ id: x.id, label: x.nombre, unidad: 'Lt', cantidad: x.cantidad, valor: x.valor }));
          }}
          reporte={{ asunto: 'Consumo de combustible · MGG', archivo: 'consumo-combustible' }}
          enviarReporte={(base64, filename, emails) => enviarReportePdf(base64, filename, 'Consumo de combustible · MGG', emails)}
          cargarDetalle={async (row, desde, hasta) => {
            const movs = await movimientosDeEquipo(row.id, desde, hasta);
            return movs.map((m) => ({
              fecha: m.fecha,
              tipo: m.tipo,
              cantidad: m.litros,
              unidad: 'Lt',
              valor: m.valor,
              detalle: [m.tanque_nombre && `🛢 ${m.tanque_nombre}`, m.destino && `→ ${m.destino}`, m.autorizado_por && `Autoriza: ${m.autorizado_por}`, m.observacion].filter(Boolean).join(' · '),
            }));
          }}
          onClose={() => setModal('none')}
        />
      )}
      {detalle && (
        <DetalleModal solicitud={detalle} canWrite={canWrite} actor={actor}
          onClose={() => setDetalle(null)} onChanged={async () => { await reload(); setDetalle(null); }} />
      )}
      {sedeEdit && (
        <SedeRenombrarModal sede={sedeEdit}
          onClose={() => setSedeEdit(null)}
          onSaved={async () => { setSedeEdit(null); await reload(); }} />
      )}
    </div>
  );
}

/* ───────────── Renombrar una sede de combustible (tarjeta) ───────────── */
function SedeRenombrarModal({ sede, onClose, onSaved }: {
  sede: SedeCombustible; onClose: () => void; onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(sede.nombre);
  const [titulo, setTitulo] = useState(sede.titulo);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return; }
    setSaving(true); setError(null);
    try {
      await renombrarSedeCombustible(sede.id, nombre, titulo);
      toast('Sede renombrada', 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title="✎ Renombrar sede" size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <div className="form-row">
        <label>Nombre de la tarjeta</label>
        <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus placeholder="LOS PINOS, MGG…" />
      </div>
      <div className="form-row">
        <label>Título de la vista <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
        <input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={`COMBUSTIBLE ${nombre || '…'}`} />
      </div>
      <small className="muted">Solo cambia el nombre visible; los combustibles y tanques de esta sede no se tocan. Los litros y el total siguen saliendo de los tanques.</small>
    </Modal>
  );
}

/* ───────────── Modales ───────────── */

function SolicitudModal({ combustibles, tanques, vehiculos, actor, defaultSolicitante, onClose, onSaved }: {
  combustibles: Combustible[]; tanques: Tanque[]; vehiculos: VehiculoMaquina[]; actor: string; defaultSolicitante: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [combustibleId, setCombustibleId] = useState(combustibles[0]?.id ?? '');
  const [solicitante, setSolicitante] = useState(defaultSolicitante);
  const [destino, setDestino] = useState<string>('');
  const vehiculosAct = useMemo(() => vehiculos.filter((v) => v.estado === 'activo'), [vehiculos]);
  const [litros, setLitros] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comb = combustibles.find((c) => c.id === combustibleId) ?? null;
  const litrosNum = Number(litros) || 0;
  // Litros REALES disponibles = suma de los tanques del combustible (lo mismo que muestra
  // la tarjeta). El campo `combustibles.litros` puede estar desfasado: los tanques mandan.
  const litrosRealPorComb = useMemo(() => {
    const m = new Map<string, number>();
    tanques.forEach((t) => { if (t.combustible_id) m.set(t.combustible_id, (m.get(t.combustible_id) ?? 0) + (Number(t.litros) || 0)); });
    return m;
  }, [tanques]);
  const litrosReal = useCallback((id: string) => litrosRealPorComb.get(id) ?? 0, [litrosRealPorComb]);
  const excede = comb ? litrosNum > litrosReal(comb.id) : false;
  // Origen: SOLO tanques registrados (activos) del combustible elegido.
  const tanquesDisp = useMemo(() => tanquesDelCombustible(tanques, combustibleId), [tanques, combustibleId]);
  const [tanqueId, setTanqueId] = useState(tanquesDisp[0]?.id ?? '');
  useEffect(() => { setTanqueId(tanquesDelCombustible(tanques, combustibleId)[0]?.id ?? ''); }, [combustibleId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!combustibleId) { setError('Elegí el combustible.'); return; }
    if (litrosNum <= 0) { setError('Indicá los litros solicitados.'); return; }
    if (!solicitante.trim()) { setError('Indicá quién solicita.'); return; }
    if (!tanqueId) { setError('Elegí el tanque de donde sale (no hay tanques para este combustible).'); return; }
    if (!destino.trim()) { setError('Indicá a dónde va.'); return; }
    const tq = tanques.find((t) => t.id === tanqueId) ?? null;
    setSaving(true);
    try {
      const s = await crearSolicitudCombustible({
        combustibleId, combustibleNombre: comb?.nombre ?? '', solicitante, destino,
        almacen: comb?.home_almacen || 'General', tanqueId, tanqueNombre: tq?.nombre ?? null,
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
              {combustibles.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {num(litrosReal(c.id))} L disp.</option>)}
            </select>
            {comb && <small className="muted">Disponible: <strong className="mono">{num(litrosReal(comb.id))} L</strong></small>}
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
        <div className="form-grid">
          <div className="form-row">
            <label>De qué tanque sale</label>
            <select className="select" value={tanqueId} onChange={(e) => setTanqueId(e.target.value)} required>
              {!tanquesDisp.length && <option value="">— sin tanques para este combustible —</option>}
              {tanquesDisp.map((t) => <option key={t.id} value={t.id}>🛢 {t.nombre} · {num(t.litros)}/{num(t.capacidad_litros)} L{t.ubicacion ? ` · ${t.ubicacion}` : ''}</option>)}
            </select>
            <small className="muted">Solo tanques registrados. Al finalizar, los litros salen de ese tanque y se reflejan en el inventario.</small>
          </div>
          <div className="form-row">
            <label>A dónde va ese combustible</label>
            <ComboBuscador value={destino} onChange={setDestino}
              opciones={vehiculosAct.map((v) => ({ value: v.nombre, label: v.nombre }))}
              placeholder="🔎 Buscá el vehículo / máquina…" icono="🚜" />
            <small className="muted">Elegí el vehículo o máquina que recibe el combustible. ¿Falta uno? Agregalo en 📒 Catálogo.</small>
          </div>
        </div>
        <div className="form-row">
          <label>Motivo / detalle (opcional)</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Referencia, equipo, etc." />
        </div>
      </form>
    </Modal>
  );
}

/* ───────────── Registrar Movimiento de tanque (reemplaza "Registrar ingreso") ───────────── */
function RegistrarMovimientoModal({ tanques, vehiculos, combustibles, actor, actorName, onClose, onSaved }: {
  tanques: Tanque[]; vehiculos: VehiculoMaquina[]; combustibles: Combustible[]; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const activosTq = useMemo(() => tanques.filter((t) => t.estado === 'activo'), [tanques]);
  const [tanqueId, setTanqueId] = useState(activosTq[0]?.id ?? '');
  const [tipo, setTipo] = useState<TipoMovimientoTanque>('ingreso');
  const ahora = new Date();
  const [fecha, setFecha] = useState(() => ahora.toLocaleDateString('en-CA')); // YYYY-MM-DD local
  const [hora, setHora] = useState(() => ahora.toTimeString().slice(0, 5)); // HH:MM
  const [litros, setLitros] = useState('');
  const [tasa, setTasa] = useState(''); // tasa (costo por litro) de la carga · solo ingreso
  const [equipo, setEquipo] = useState('');
  const [hi, setHi] = useState('');
  const [hf, setHf] = useState('');
  const [ci, setCi] = useState('');
  const [cf, setCf] = useState('');
  // HI/CI quedan BLOQUEADOS cuando se autocompletan con la lectura previa (encadenado).
  // Solo editables la primera vez de ese equipo/tanque (cuando no hay lectura previa).
  const [hiBloqueado, setHiBloqueado] = useState(false);
  const [ciBloqueado, setCiBloqueado] = useState(false);
  const [autorizado, setAutorizado] = useState('');
  const [destino, setDestino] = useState('');
  const [observacion, setObservacion] = useState('');
  const [autorizados, setAutorizados] = useState<CatalogoCombustible[]>([]);
  const [ubicaciones, setUbicaciones] = useState<CatalogoCombustible[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCatalogo('combustible_autorizados').then((r) => setAutorizados(r.filter((x) => x.estado === 'activo'))).catch(() => setAutorizados([]));
    listCatalogo('combustible_ubicaciones').then((r) => setUbicaciones(r.filter((x) => x.estado === 'activo'))).catch(() => setUbicaciones([]));
  }, []);
  // El contador inicial (CI) se precarga con el último contador final (CF) del tanque (totalizador del surtidor).
  useEffect(() => {
    setCi(''); setCf(''); setCiBloqueado(false);
    if (tanqueId) ultimoContadorTanque(tanqueId).then((c) => { if (c != null) { setCi(String(c)); setCiBloqueado(true); } }).catch(() => {});
  }, [tanqueId]);

  const tq = tanques.find((t) => t.id === tanqueId) ?? null;
  const vehiculosAct = vehiculos.filter((v) => v.estado === 'activo');
  const tipoInfo = TIPOS_MOVIMIENTO.find((t) => t.value === tipo)!;
  const litrosNum = Number(litros) || 0;

  // Combustible del tanque elegido: su costo actual sirve para previsualizar el PMP de la carga.
  const combTanque = useMemo(() => (tq?.combustible_id ? combustibles.find((c) => c.id === tq.combustible_id) ?? null : null), [combustibles, tq]);
  const tasaNum = tasa.trim() === '' ? null : Number(tasa);
  // PMP previsto = (litros_actual·costo_actual + litros_carga·tasa) / (litros_actual + litros_carga).
  const pmpPrevisto = useMemo(() => {
    if (tipo !== 'ingreso' || !combTanque || tasaNum == null || !(tasaNum >= 0) || litrosNum <= 0) return null;
    const lp = Number(combTanque.litros) || 0;
    const cp = Number(combTanque.costo_litro) || 0;
    const total = lp + litrosNum;
    if (total <= 0) return tasaNum;
    return Math.round(((lp * cp + litrosNum * tasaNum) / total) * 10000) / 10000;
  }, [tipo, combTanque, tasaNum, litrosNum]);

  // Al elegir un equipo, el HI se precarga con el último HF registrado para ese equipo.
  async function cambiarEquipo(nombre: string) {
    setEquipo(nombre);
    setHi(''); setHf(''); setHiBloqueado(false);
    if (nombre) {
      const ultimoHf = await ultimoHorometroEquipo(nombre).catch(() => null);
      if (ultimoHf != null) { setHi(String(ultimoHf)); setHiBloqueado(true); }
    }
  }
  const hiNum = Number(hi);
  const hfNum = Number(hf);
  const horasEquipo = hi !== '' && hf !== '' && hfNum > hiNum ? Math.round((hfNum - hiNum) * 100) / 100 : null;
  const ciNum = Number(ci);
  const cfNum = Number(cf);
  const contadorDif = ci !== '' && cf !== '' && cfNum >= ciNum ? Math.round((cfNum - ciNum) * 100) / 100 : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tanqueId) { setError('Elegí el tanque.'); return; }
    if (litrosNum <= 0) { setError('Indicá los litros del movimiento.'); return; }
    if (hi !== '' && hf !== '' && hfNum < hiNum) { setError('El horómetro final no puede ser menor que el inicial.'); return; }
    if (ci !== '' && cf !== '' && cfNum < ciNum) { setError('El contador final no puede ser menor que el inicial.'); return; }
    const fechaIso = fecha ? new Date(`${fecha}T${hora || '00:00'}:00`).toISOString() : new Date().toISOString();
    setSaving(true);
    try {
      await crearTanqueMovimiento({
        tanqueId, tipo, litros: litrosNum, fecha: fechaIso,
        costoLitro: tipo === 'ingreso' && tasaNum != null && tasaNum >= 0 ? tasaNum : null,
        horometroInicial: hi !== '' ? hiNum : null, horometroFinal: hf !== '' ? hfNum : null,
        contadorIni: ci !== '' ? ciNum : null, contadorFin: cf !== '' ? cfNum : null,
        equipo: equipo.trim() || null, autorizadoPor: autorizado.trim() || null,
        destino: destino.trim() || null, observacion: observacion.trim() || null,
        actor, actorName,
      });
      notify(`${TIPO_TANQUE_LABEL[tipo]} en ${tq?.nombre ?? 'tanque'}: ${tipoInfo.signo}${num(litrosNum)} L`, 'success', { link: '#/app/combustible' });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento.');
    } finally { setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cmb-mov" className="btn btn-primary" disabled={saving}>{saving ? 'Registrando…' : 'Registrar Movimiento'}</button>
    </>
  );
  return (
    <Modal title="Nuevo movimiento de tanque" size="lg" onClose={onClose} footer={footer}>
      <form id="cmb-mov" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row">
            <label>Tanque</label>
            <select className="select" value={tanqueId} onChange={(e) => setTanqueId(e.target.value)} required>
              {!activosTq.length && <option value="">— sin tanques —</option>}
              {activosTq.map((t) => <option key={t.id} value={t.id}>{t.nombre} · {num(t.litros)} L</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>Tipo de movimiento</label>
            <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovimientoTanque)}>
              {TIPOS_MOVIMIENTO.map((t) => <option key={t.value} value={t.value}>{t.signo === '+' ? '⬆' : '⬇'} {t.label}</option>)}
            </select>
            <small className="muted">{tipoInfo.signo === '+' ? 'Suma' : 'Resta'} litros al tanque seleccionado.</small>
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Fecha</label>
            <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Hora (opcional)</label>
            <input className="input" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </div>
        </div>
        {tipo === 'ingreso' ? (
          <div className="form-grid">
            <div className="form-row">
              <label>Litros</label>
              <input className="input mono" type="number" min={0} step="any" value={litros} onChange={(e) => setLitros(e.target.value)} required autoFocus />
            </div>
            <div className="form-row">
              <label>Tasa (costo por litro)</label>
              <input className="input mono no-upper" type="number" min={0} step="any" value={tasa} onChange={(e) => setTasa(e.target.value)}
                placeholder={combTanque ? num(Number(combTanque.costo_litro) || 0) : 'Costo de esta carga'} />
              {combTanque ? (
                pmpPrevisto != null
                  ? <small className="muted">Costo actual <strong className="mono">{num(Number(combTanque.costo_litro) || 0)}</strong> → PMP previsto <strong className="mono">{num(pmpPrevisto)}</strong></small>
                  : <small className="muted">Si la dejás vacía, se mantiene el costo actual ({num(Number(combTanque.costo_litro) || 0)}). El PMP la pondera con el stock existente.</small>
              ) : <small className="muted">El tanque no tiene combustible asignado: la tasa no aplica.</small>}
            </div>
          </div>
        ) : (
          <div className="form-row">
            <label>Litros</label>
            <input className="input mono" type="number" min={0} step="any" value={litros} onChange={(e) => setLitros(e.target.value)} required autoFocus />
          </div>
        )}
        <div className="form-grid">
          <div className="form-row">
            <label>Equipo</label>
            <ComboBuscador value={equipo} onChange={(v) => void cambiarEquipo(v)}
              opciones={vehiculosAct.map((v) => ({ value: v.nombre, label: v.nombre }))}
              placeholder="🔎 Buscá el equipo…" icono="🚜" />
          </div>
          <div className="form-row">
            <label>Autorizado por</label>
            <ComboBuscador value={autorizado} onChange={setAutorizado}
              opciones={autorizados.map((a) => ({ value: a.nombre, label: a.nombre }))}
              placeholder="🔎 Buscá quién autorizó…" icono="🧑‍⚖️" />
          </div>
        </div>
        {/* Horómetro por equipo: el HF queda como HI del próximo movimiento del mismo equipo. */}
        <div className="form-grid">
          <div className="form-row">
            <label>Horómetro inicial (HI){hiBloqueado && ' 🔒'}</label>
            <input className="input mono" type="number" min={0} step="any" value={hi} onChange={(e) => setHi(e.target.value)}
              readOnly={hiBloqueado}
              style={hiBloqueado ? { background: 'rgba(255,255,255,.05)', cursor: 'not-allowed', opacity: .85 } : undefined}
              placeholder={equipo ? 'Primer HI del equipo' : 'Elegí un equipo'} />
            {equipo && (hiBloqueado
              ? <small className="muted">🔒 Encadenado: es el último HF de {equipo} (no se modifica).</small>
              : <small className="muted">Primera carga de {equipo}: ingresá el HI inicial; de ahí en más se encadena solo.</small>)}
          </div>
          <div className="form-row">
            <label>Horómetro final (HF)</label>
            <input className="input mono" type="number" min={0} step="any" value={hf} onChange={(e) => setHf(e.target.value)} />
            {horasEquipo != null && <small className="muted">HRS = HF − HI = <strong className="mono">{num(horasEquipo)} h</strong></small>}
          </div>
        </div>
        {/* Contador global del surtidor (totalizador): el CI se precarga con el último CF del tanque. */}
        <div className="form-grid">
          <div className="form-row">
            <label>Contador inicial (surtidor){ciBloqueado && ' 🔒'}</label>
            <input className="input mono" type="number" min={0} step="any" value={ci} onChange={(e) => setCi(e.target.value)}
              readOnly={ciBloqueado}
              style={ciBloqueado ? { background: 'rgba(255,255,255,.05)', cursor: 'not-allowed', opacity: .85 } : undefined}
              placeholder={tanqueId ? 'Primer contador del tanque' : 'Elegí un tanque'} />
            {ciBloqueado
              ? <small className="muted">🔒 Encadenado: es el último contador final de este tanque (no se modifica).</small>
              : <small className="muted">Primer movimiento de este tanque: ingresá el contador inicial; de ahí se encadena solo.</small>}
          </div>
          <div className="form-row">
            <label>Contador final (surtidor)</label>
            <input className="input mono" type="number" min={0} step="any" value={cf} onChange={(e) => setCf(e.target.value)} />
            {contadorDif != null && <small className="muted">Diferencia = <strong className="mono">{num(contadorDif)}</strong></small>}
          </div>
        </div>
        <div className="form-row">
          <label>Destino</label>
          <ComboBuscador value={destino} onChange={setDestino}
            opciones={ubicaciones.map((u) => ({ value: u.nombre, label: u.nombre }))}
            placeholder="🔎 Buscá el destino…" icono="📍" />
          <small className="muted">¿Falta un destino? Agregalo en 📒 Catálogo → Ubicaciones.</small>
        </div>
        <div className="form-row">
          <label>Observación</label>
          <textarea className="input" rows={2} value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Suministro combustible…" />
        </div>
      </form>
    </Modal>
  );
}

/* ───────────── Editar combustible desde la tarjeta (nombre + costo por litro) ───────────── */
function EditarCombustibleModal({ combustible, onClose, onSaved }: {
  combustible: Combustible; onClose: () => void; onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(combustible.nombre);
  const [costo, setCosto] = useState(String(combustible.costo_litro ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return; }
    setSaving(true);
    try {
      await actualizarCombustible(combustible.id, { nombre: nombre.trim(), costoLitro: Number(costo) || 0 });
      notify(`Combustible "${nombre.trim()}" actualizado`, 'success', { link: '#/app/combustible' });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar.');
    } finally { setSaving(false); }
  }
  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cmb-edit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
    </>
  );
  return (
    <Modal title={`Editar combustible · ${combustible.nombre}`} size="md" onClose={onClose} footer={footer}>
      <form id="cmb-edit" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-row">
          <label>Nombre</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        </div>
        <div className="form-row">
          <label>Costo por litro (USD)</label>
          <input className="input mono" type="number" min={0} step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} />
        </div>
        <small className="muted">Los litros disponibles se calculan solos a partir de los tanques (sus movimientos). No se editan acá.</small>
      </form>
    </Modal>
  );
}

/* ───────────── Histórico de movimientos de tanque (botón "Movimientos" · por mes) ───────────── */
function MovimientosModal({ tanques, vehiculos, tanqueId, actor, actorName, canWrite, onChanged, onClose }: {
  tanques: Tanque[]; vehiculos: VehiculoMaquina[]; tanqueId: string | null; actor: string; actorName?: string | null; canWrite: boolean;
  onChanged?: () => void | Promise<void>; onClose: () => void;
}) {
  const [movs, setMovs] = useState<TanqueMovimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroTanque, setFiltroTanque] = useState<string>(tanqueId ?? '');
  const mesActual = new Date().toLocaleDateString('en-CA').slice(0, 7); // YYYY-MM
  const [mes, setMes] = useState<string>(mesActual);
  const [editMov, setEditMov] = useState<TanqueMovimiento | null>(null);
  const [borrarMov, setBorrarMov] = useState<TanqueMovimiento | null>(null);
  const [busy, setBusy] = useState(false);

  const recargar = useCallback(() => {
    listTanqueMovimientos(filtroTanque ? { tanqueId: filtroTanque } : undefined).then(setMovs).catch(() => {});
  }, [filtroTanque]);

  useEffect(() => {
    setLoading(true);
    listTanqueMovimientos(filtroTanque ? { tanqueId: filtroTanque } : undefined)
      .then(setMovs).catch(() => setMovs([])).finally(() => setLoading(false));
  }, [filtroTanque]);
  useRealtime(['combustible_tanque_movimientos'], () => { recargar(); });

  async function confirmarBorrar() {
    if (!borrarMov) return;
    setBusy(true);
    try {
      await eliminarTanqueMovimiento(borrarMov.id, actor, actorName);
      toast('Movimiento eliminado y revertido en las tarjetas', 'success');
      setBorrarMov(null);
      recargar();
      await onChanged?.();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
    finally { setBusy(false); }
  }

  const delMes = useMemo(() => movs.filter((m) => (m.fecha || '').slice(0, 7) === mes), [movs, mes]);
  const totalIng = delMes.filter((m) => m.tipo === 'ingreso' || m.tipo === 'retorno').reduce((a, m) => a + (Number(m.litros) || 0), 0);
  const totalSal = delMes.filter((m) => m.tipo === 'consumo' || m.tipo === 'merma').reduce((a, m) => a + (Number(m.litros) || 0), 0);
  const tanqueNombre = tanqueId ? (tanques.find((t) => t.id === tanqueId)?.nombre ?? '') : '';

  return (
    <Modal title={`🗒 Histórico de movimientos${tanqueNombre ? ` · ${tanqueNombre}` : ''}`} size="xl" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="filterbar" style={{ gap: '.6rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <div className="form-row" style={{ margin: 0 }}>
          <label style={{ fontSize: '.72rem' }}>Mes</label>
          <input className="input" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </div>
        {!tanqueId && (
          <div className="form-row" style={{ margin: 0 }}>
            <label style={{ fontSize: '.72rem' }}>Tanque</label>
            <select className="select" value={filtroTanque} onChange={(e) => setFiltroTanque(e.target.value)}>
              <option value="">Todos los tanques</option>
              {tanques.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </div>
        )}
        <div className="muted" style={{ marginLeft: 'auto', alignSelf: 'flex-end', fontSize: '.82rem' }}>
          {delMes.length} mov. · entra <strong className="mono" style={{ color: 'var(--success)' }}>+{num(totalIng)} L</strong> · sale <strong className="mono" style={{ color: 'var(--danger)' }}>−{num(totalSal)} L</strong>
        </div>
      </div>
      <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr>
            <th>Fecha y hora</th><th>Tanque</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Litros</th>
            <th>Equipo</th><th style={{ textAlign: 'right' }}>HI</th><th style={{ textAlign: 'right' }}>HF</th><th style={{ textAlign: 'right' }}>HRS</th>
            <th style={{ textAlign: 'right' }}>Contador</th><th>Autorizado por</th><th>Destino</th><th>Observación</th>
            {canWrite && <th></th>}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={canWrite ? 13 : 12} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !delMes.length && <tr><td colSpan={canWrite ? 13 : 12} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin movimientos en este mes.</td></tr>}
            {delMes.map((m) => {
              const suma = m.tipo === 'ingreso' || m.tipo === 'retorno';
              const hrs = m.horometro_inicial != null && m.horometro_final != null ? Math.round((Number(m.horometro_final) - Number(m.horometro_inicial)) * 100) / 100 : null;
              return (
                <tr key={m.id}>
                  <td className="muted">{dateTime(m.fecha)}</td>
                  <td>{m.tanque_nombre || '—'}</td>
                  <td><span className="badge">{TIPO_TANQUE_LABEL[m.tipo]}</span></td>
                  <td className="mono" style={{ textAlign: 'right', color: suma ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{suma ? '+' : '−'}{num(m.litros)}</td>
                  <td>{m.equipo || '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{m.horometro_inicial != null ? num(m.horometro_inicial) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{m.horometro_final != null ? num(m.horometro_final) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{hrs != null ? num(hrs) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{m.contador_global_ini != null || m.contador_global_fin != null ? `${m.contador_global_ini != null ? num(m.contador_global_ini) : '—'} → ${m.contador_global_fin != null ? num(m.contador_global_fin) : '—'}` : '—'}</td>
                  <td>{m.autorizado_por || '—'}</td>
                  <td>{m.destino || '—'}</td>
                  <td className="muted">{m.observacion || '—'}</td>
                  {canWrite && (
                    <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-ghost" title="Editar movimiento" onClick={() => setEditMov(m)}>✎</button>
                      <button className="btn btn-sm btn-ghost" title="Eliminar movimiento" onClick={() => setBorrarMov(m)}>🗑</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editMov && (
        <EditarTanqueMovModal
          mov={editMov} tanques={tanques} vehiculos={vehiculos} actor={actor} actorName={actorName}
          onClose={() => setEditMov(null)}
          onSaved={async () => { setEditMov(null); recargar(); await onChanged?.(); }}
        />
      )}
      {borrarMov && (
        <ConfirmDialog
          title="Eliminar movimiento"
          message={`¿Eliminar este movimiento de ${TIPO_TANQUE_LABEL[borrarMov.tipo]} de ${num(borrarMov.litros)} L? Se revertirá en el tanque, el combustible y el inventario.`}
          confirmText={busy ? 'Eliminando…' : 'Eliminar y revertir'}
          danger
          onCancel={() => setBorrarMov(null)}
          onConfirm={() => void confirmarBorrar()}
        />
      )}
    </Modal>
  );
}

/* ───────────── Editar un movimiento de tanque (todos los datos · recalcula balances) ───────────── */
// ISO → "YYYY-MM-DDTHH:mm" (hora local) para el input datetime-local, y de vuelta.
function isoADatetimeLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}
function numOrNull(s: string): number | null {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
}

function EditarTanqueMovModal({ mov, tanques, vehiculos, actor, actorName, onClose, onSaved }: {
  mov: TanqueMovimiento; tanques: Tanque[]; vehiculos: VehiculoMaquina[]; actor: string; actorName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const vehiculosAct = useMemo(() => vehiculos.filter((v) => v.estado === 'activo'), [vehiculos]);
  const [tanqueId, setTanqueId] = useState(mov.tanque_id ?? '');
  const [fecha, setFecha] = useState(isoADatetimeLocal(mov.fecha));
  const [tipo, setTipo] = useState<TipoMovimientoTanque>(mov.tipo);
  const [litros, setLitros] = useState(String(mov.litros ?? ''));
  const [equipo, setEquipo] = useState(mov.equipo ?? '');
  const [hi] = useState(mov.horometro_inicial != null ? String(mov.horometro_inicial) : ''); // 🔒 encadenado (solo lectura)
  const [hf, setHf] = useState(mov.horometro_final != null ? String(mov.horometro_final) : '');
  const [contIni] = useState(mov.contador_global_ini != null ? String(mov.contador_global_ini) : ''); // 🔒 encadenado
  const [contFin, setContFin] = useState(mov.contador_global_fin != null ? String(mov.contador_global_fin) : '');
  const [autorizado, setAutorizado] = useState(mov.autorizado_por ?? '');
  const [destino, setDestino] = useState(mov.destino ?? '');
  const [observacion, setObservacion] = useState(mov.observacion ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    const l = Number(litros);
    if (!Number.isFinite(l) || l <= 0) { setError('Los litros deben ser mayores que 0.'); return; }
    setSaving(true); setError(null);
    try {
      await actualizarTanqueMovimiento(mov.id, {
        tanqueId: tanqueId || undefined, litros: l, tipo, equipo, autorizadoPor: autorizado, destino, observacion,
        fecha: fecha ? new Date(fecha).toISOString() : undefined,
        horometroInicial: numOrNull(hi), horometroFinal: numOrNull(hf),
        contadorIni: numOrNull(contIni), contadorFin: numOrNull(contFin),
      }, actor, actorName);
      toast('Movimiento actualizado · tarjetas ajustadas', 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title="✎ Editar movimiento de tanque" size="lg" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <div className="form-grid">
        <div className="form-row">
          <label>Fecha y hora</label>
          <input className="input" type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Tanque</label>
          <select className="select" value={tanqueId} onChange={(e) => setTanqueId(e.target.value)}>
            {!tanqueId && <option value="">— elegí el tanque —</option>}
            {tanques.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label>Tipo</label>
          <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovimientoTanque)}>
            {TIPOS_MOVIMIENTO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>Litros</label>
          <input className="input mono" type="number" min={0} step="any" value={litros} onChange={(e) => setLitros(e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label>Equipo</label>
        <ComboBuscador value={equipo} onChange={setEquipo}
          opciones={vehiculosAct.map((v) => ({ value: v.nombre, label: v.nombre }))}
          placeholder="🔎 Buscá el equipo…" icono="🚜" />
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label>Horómetro inicial (HI) 🔒</label>
          <input className="input mono" type="number" step="any" value={hi} readOnly
            style={{ background: 'rgba(255,255,255,.05)', cursor: 'not-allowed', opacity: .85 }} />
        </div>
        <div className="form-row"><label>Horómetro final (HF)</label><input className="input mono" type="number" step="any" value={hf} onChange={(e) => setHf(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label>Contador inicial 🔒</label>
          <input className="input mono" type="number" step="any" value={contIni} readOnly
            style={{ background: 'rgba(255,255,255,.05)', cursor: 'not-allowed', opacity: .85 }} />
        </div>
        <div className="form-row"><label>Contador final</label><input className="input mono" type="number" step="any" value={contFin} onChange={(e) => setContFin(e.target.value)} /></div>
      </div>
      <small className="muted" style={{ display: 'block', marginTop: '-.3rem' }}>
        🔒 El <strong>HI</strong> y el <strong>contador inicial</strong> se <strong>encadenan automáticamente</strong> (son el final del movimiento anterior). Editá el <strong>HF</strong> / <strong>contador final</strong>; al guardar, el sistema re-sincroniza la cadena por fecha.
      </small>
      <div className="form-grid">
        <div className="form-row"><label>Autorizado por</label><input className="input" value={autorizado} onChange={(e) => setAutorizado(e.target.value)} /></div>
        <div className="form-row"><label>Destino</label><input className="input" value={destino} onChange={(e) => setDestino(e.target.value)} /></div>
      </div>
      <div className="form-row"><label>Observación</label><input className="input" value={observacion} onChange={(e) => setObservacion(e.target.value)} /></div>
      <p className="muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>
        Si cambiás el <strong>tanque</strong>, el <strong>tipo</strong> o los <strong>litros</strong>, el sistema ajusta solo los balances en el tanque, el combustible y el inventario para que todo quede cuadrado.
      </p>
    </Modal>
  );
}

function GestionarModal({ combustibles, sede, actor, onClose, onChanged }: {
  combustibles: Combustible[]; sede: string | null; actor: string; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState('');
  const [almacen, setAlmacen] = useState('');
  const [litros, setLitros] = useState('');
  const [costo, setCosto] = useState('0.50'); // tasa por defecto: 0,50 USD/L
  const [busy, setBusy] = useState(false);
  // Feedback persistente del alta (no solo el toast efímero, que dura 3,2 s y se pierde).
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [renombrando, setRenombrando] = useState<{ id: string; actual: string } | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState('');

  async function crear() {
    setOkMsg(null);
    if (!nombre.trim()) { setError('Escribí el nombre del combustible (ej.: Diésel, Gasolina 95).'); return; }
    if (!almacen.trim()) { setError('Elegí el almacén donde se registra el combustible.'); return; }
    setError(null);
    setBusy(true);
    try {
      await crearCombustible({ nombre, almacen, sede, litrosIniciales: Number(litros) || 0, costoLitro: Number(costo) || 0, actorEmail: actor });
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
          <div className="form-row"><label>Litros iniciales (opcional)</label><input className="input mono" type="number" min={0} step="any" value={litros} onChange={(e) => setLitros(e.target.value)} /></div>
          <div className="form-row"><label>Costo por litro (opcional)</label><input className="input mono" type="number" min={0} step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} /></div>
        </div>
        <AlmacenPicker value={almacen} onChange={setAlmacen} />
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
function TanqueModal({ tanque, combustibles, sede, actor, onClose, onSaved }: {
  tanque: Tanque | null; combustibles: Combustible[]; sede: string | null; actor: string;
  onClose: () => void; onSaved: () => void;
}) {
  const esEdicion = !!tanque;
  const [nombre, setNombre] = useState(tanque?.nombre ?? '');
  const [combustibleId, setCombustibleId] = useState(tanque?.combustible_id ?? '');
  const [capacidad, setCapacidad] = useState(tanque ? String(tanque.capacidad_litros) : '');
  const [litros, setLitros] = useState(tanque ? String(tanque.litros) : '');
  const [ubicacion, setUbicacion] = useState(tanque?.ubicacion ?? '');
  const [tasa, setTasa] = useState(tanque?.tasa != null ? String(tanque.tasa) : '0.50');
  const [forma, setForma] = useState<'cilindro' | 'rectangular'>((tanque?.forma as 'cilindro' | 'rectangular') ?? 'cilindro');
  const [diametro, setDiametro] = useState(tanque?.diametro_cm != null ? String(tanque.diametro_cm) : '');
  const [longitud, setLongitud] = useState(tanque?.longitud_cm != null ? String(tanque.longitud_cm) : '');
  const [ancho, setAncho] = useState(tanque?.ancho_cm != null ? String(tanque.ancho_cm) : '');
  const [altura, setAltura] = useState(tanque?.altura_cm != null ? String(tanque.altura_cm) : '');
  const [cubicacion, setCubicacion] = useState(tanque?.cubicacion ?? '');
  const [nivel, setNivel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Confirmación de borrado: hay que escribir el nombre del tanque.
  const [borrarOpen, setBorrarOpen] = useState(false);
  const [confirmNombre, setConfirmNombre] = useState('');

  const capNum = Number(capacidad) || 0;
  const litNum = Number(litros) || 0;
  const diaNum = Number(diametro) || 0;
  const anchoNum = Number(ancho) || 0;
  const alturaNum = Number(altura) || 0;
  const nivelNum = Number(nivel) || 0;
  // Largo: el indicado o, si está vacío y es cilindro, derivado de la capacidad y el diámetro.
  const largoNum = Number(longitud) || (forma === 'cilindro' && diaNum > 0 && capNum > 0 ? longitudDesdeCapacidad(capNum, diaNum) : 0);
  // Geometría suficiente según la forma.
  const geoOk = forma === 'cilindro' ? (diaNum > 0 && largoNum > 0) : (largoNum > 0 && anchoNum > 0 && alturaNum > 0);
  const nivelMax = forma === 'cilindro' ? diaNum : alturaNum;
  const litrosNivel = !geoOk ? 0 : forma === 'cilindro'
    ? litrosCilindroHorizontal(nivelNum, diaNum, largoNum)
    : litrosRectangular(nivelNum, largoNum, anchoNum, alturaNum);
  const capCalc = !geoOk ? 0 : forma === 'cilindro'
    ? capacidadCilindro(diaNum, largoNum)
    : capacidadRectangular(largoNum, anchoNum, alturaNum);
  const tabla = !geoOk ? [] : forma === 'cilindro'
    ? tablaCubicacion(diaNum, largoNum, Math.max(1, Math.round(diaNum / 8)))
    : tablaCubicacionRect(largoNum, anchoNum, alturaNum, Math.max(1, Math.round(alturaNum / 8)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) { setError('Indicá el nombre del tanque.'); return; }
    if (capNum <= 0) { setError('La capacidad debe ser mayor que 0.'); return; }
    if (litNum > capNum) { setError('Los litros actuales no pueden superar la capacidad.'); return; }
    setSaving(true);
    try {
      const geo = {
        tasa: tasa.trim() === '' ? null : Number(tasa),
        forma,
        diametroCm: forma === 'cilindro' && diametro.trim() !== '' ? diaNum : null,
        longitudCm: longitud.trim() === '' ? (largoNum || null) : Number(longitud),
        anchoCm: forma === 'rectangular' && ancho.trim() !== '' ? anchoNum : null,
        alturaCm: forma === 'rectangular' && altura.trim() !== '' ? alturaNum : null,
        cubicacion: cubicacion.trim() || null,
      };
      if (esEdicion && tanque) {
        await actualizarTanque(tanque.id, {
          nombre, combustibleId: combustibleId || null, capacidadLitros: capNum, litros: litNum, ubicacion, ...geo,
        });
        notify(`Tanque "${nombre.trim()}" actualizado`, 'success', { link: '#/app/combustible' });
      } else {
        await crearTanque({
          nombre, combustibleId: combustibleId || null, capacidadLitros: capNum,
          litrosIniciales: litNum, ubicacion, sede, ...geo, actorEmail: actor,
        });
        notify(`Tanque "${nombre.trim()}" agregado · ${num(capNum)} L de capacidad`, 'success', { link: '#/app/combustible' });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el tanque.');
    } finally { setSaving(false); }
  }

  const nombreOk = !!tanque && confirmNombre.trim() === tanque.nombre.trim();
  async function borrar() {
    if (!tanque || !nombreOk) return;
    setSaving(true);
    try { await eliminarTanque(tanque.id); notify(`Tanque "${tanque.nombre}" eliminado`, 'info', { link: '#/app/combustible' }); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar'); setSaving(false); setBorrarOpen(false); }
  }

  const footer = (
    <>
      {esEdicion && <button type="button" className="btn btn-danger" onClick={() => { setConfirmNombre(''); setBorrarOpen(true); }} disabled={saving} style={{ marginRight: 'auto' }}>Eliminar</button>}
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="tanque-form" className="btn btn-primary" disabled={saving}>
        {saving ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Agregar tanque'}
      </button>
    </>
  );

  return (
    <Modal title={esEdicion ? `Editar tanque · ${tanque?.nombre}` : 'Agregar tanque'} size="lg" onClose={onClose} footer={footer}>
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
        <div className="form-grid">
          <div className="form-row">
            <label>Ubicación</label>
            <input className="input" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Patio Matanzas, Sede Los Pinos…" />
          </div>
          <div className="form-row">
            <label>Tasa</label>
            <input className="input mono" type="number" step="any" value={tasa} onChange={(e) => setTasa(e.target.value)} placeholder="0.50" />
          </div>
        </div>

        {/* ── Cubicación: cilindro horizontal o rectangular ── */}
        <div className="card" style={{ marginTop: '.5rem' }}>
          <div className="card-title"><span>📐 Cubicación</span></div>
          <div className="view-toggle" role="tablist" aria-label="Forma del tanque" style={{ marginBottom: '.5rem', marginLeft: 0 }}>
            <button type="button" className={forma === 'cilindro' ? 'active' : ''} onClick={() => setForma('cilindro')}>⬭ Cilindro horizontal</button>
            <button type="button" className={forma === 'rectangular' ? 'active' : ''} onClick={() => setForma('rectangular')}>▭ Rectangular</button>
          </div>
          <small className="muted" style={{ display: 'block', margin: '0 0 .6rem' }}>
            {forma === 'cilindro'
              ? 'Cargá el diámetro y el largo. Con el nivel medido con varilla calculamos los litros aproximados.'
              : 'Cargá largo, ancho y altura. Litros = largo × ancho × nivel medido.'}
          </small>
          {forma === 'cilindro' ? (
            <div className="form-grid">
              <div className="form-row">
                <label>Diámetro (cm)</label>
                <input className="input mono" type="number" step="any" value={diametro} onChange={(e) => setDiametro(e.target.value)} placeholder="50" />
              </div>
              <div className="form-row">
                <label>Largo del cilindro (cm)</label>
                <input className="input mono" type="number" step="any" value={longitud} onChange={(e) => setLongitud(e.target.value)}
                  placeholder={diaNum > 0 && capNum > 0 ? `auto: ${num(largoNum)}` : 'cm'} />
                {!longitud.trim() && largoNum > 0 && <small className="muted">Derivado de la capacidad: <strong className="mono">{num(largoNum)} cm</strong></small>}
              </div>
            </div>
          ) : (
            <div className="form-grid">
              <div className="form-row">
                <label>Largo (cm)</label>
                <input className="input mono" type="number" step="any" value={longitud} onChange={(e) => setLongitud(e.target.value)} placeholder="140" />
              </div>
              <div className="form-row">
                <label>Ancho (cm)</label>
                <input className="input mono" type="number" step="any" value={ancho} onChange={(e) => setAncho(e.target.value)} placeholder="76" />
              </div>
              <div className="form-row">
                <label>Altura (cm)</label>
                <input className="input mono" type="number" step="any" value={altura} onChange={(e) => setAltura(e.target.value)} placeholder="30" />
              </div>
            </div>
          )}

          {geoOk ? (
            <>
              <div className="form-grid" style={{ alignItems: 'end' }}>
                <div className="form-row">
                  <label>Nivel medido (cm)</label>
                  <input className="input mono" type="number" min={0} max={nivelMax} step="any" value={nivel} onChange={(e) => setNivel(e.target.value)} placeholder={`0 a ${num(nivelMax)}`} />
                </div>
                <div className="form-row">
                  <label>Litros aproximados</label>
                  <div className="card" style={{ margin: 0, padding: '.5rem .7rem', borderColor: 'var(--primary)' }}>
                    <strong className="mono" style={{ fontSize: '1.25rem', color: 'var(--primary-3)' }}>{num(litrosNivel)} L</strong>
                    {capCalc > 0 && <span className="muted" style={{ fontSize: '.74rem' }}> · {Math.min(100, Math.round((litrosNivel / capCalc) * 100))}%</span>}
                  </div>
                </div>
              </div>
              <small className="muted">Capacidad teórica ({forma === 'cilindro' ? 'cilindro' : 'rectangular'}): <strong className="mono">{num(capCalc)} L</strong>.</small>
              {/* Tabla de referencia */}
              {tabla.length > 0 && (
                <div className="table-wrap" style={{ marginTop: '.5rem', maxHeight: 180, overflowY: 'auto' }}>
                  <table className="table" style={{ fontSize: '.8rem' }}>
                    <thead><tr><th>Nivel (cm)</th><th style={{ textAlign: 'right' }}>Litros</th></tr></thead>
                    <tbody>
                      {tabla.map((f) => (
                        <tr key={f.nivel}><td className="mono">{num(f.nivel)}</td><td className="mono" style={{ textAlign: 'right' }}>{num(f.litros)} L</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <small className="muted">{forma === 'cilindro' ? 'Cargá el diámetro (el largo se deriva de la capacidad) para ver la calculadora.' : 'Cargá largo, ancho y altura para ver la calculadora.'}</small>
          )}

          <div className="form-row" style={{ marginTop: '.5rem' }}>
            <label>Nota de cubicación (opcional)</label>
            <textarea className="input" rows={2} value={cubicacion} onChange={(e) => setCubicacion(e.target.value)} placeholder="Observaciones, tabla manual, referencia de la varilla…" />
          </div>
        </div>
      </form>

      {borrarOpen && tanque && (
        <Modal title="Eliminar tanque" size="md" onClose={() => { if (!saving) setBorrarOpen(false); }} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setBorrarOpen(false)} disabled={saving}>Cancelar</button>
            <button className="btn btn-danger" onClick={() => void borrar()} disabled={saving || !nombreOk}>{saving ? 'Eliminando…' : 'Eliminar tanque'}</button>
          </>
        }>
          <p style={{ marginTop: 0 }}>¿Seguro que deseás eliminar el tanque <strong>{tanque.nombre}</strong>? Esta acción no se puede deshacer.</p>
          <div className="form-row">
            <label>Para confirmar, escribí el nombre del tanque: <strong>{tanque.nombre}</strong></label>
            <input className="input" value={confirmNombre} onChange={(e) => setConfirmNombre(e.target.value)} placeholder={tanque.nombre} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && nombreOk) void borrar(); }} />
            {confirmNombre && !nombreOk && <small style={{ color: 'var(--danger)' }}>El nombre no coincide.</small>}
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/* ───────────── Modal: vehículos / máquinas ───────────── */
/* ───────────── Catálogo (switch: Vehículos/Máquinas · Autorizados · Ubicaciones) ───────────── */
function CatalogoModal({ vehiculos, actor, onClose, onChanged }: {
  vehiculos: VehiculoMaquina[]; actor: string; onClose: () => void; onChanged: () => Promise<void>;
}) {
  type Tab = 'vehiculos' | 'autorizados' | 'ubicaciones';
  const META: Record<Tab, { label: string; icon: string; tabla?: TablaCatalogo; conDesc: boolean; singular: string }> = {
    vehiculos: { label: 'Vehículos / Máquinas', icon: '🚜', conDesc: true, singular: 'vehículo / máquina' },
    autorizados: { label: 'Autorizados', icon: '🧑‍⚖️', tabla: 'combustible_autorizados', conDesc: false, singular: 'autorizado' },
    ubicaciones: { label: 'Ubicaciones', icon: '📍', tabla: 'combustible_ubicaciones', conDesc: false, singular: 'ubicación' },
  };
  const [tab, setTab] = useState<Tab>('vehiculos');
  const [autorizados, setAutorizados] = useState<CatalogoCombustible[]>([]);
  const [ubicaciones, setUbicaciones] = useState<CatalogoCombustible[]>([]);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [edit, setEdit] = useState<{ id: string; nombre: string; descripcion: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    const [a, u] = await Promise.all([
      listCatalogo('combustible_autorizados').catch(() => [] as CatalogoCombustible[]),
      listCatalogo('combustible_ubicaciones').catch(() => [] as CatalogoCombustible[]),
    ]);
    setAutorizados(a); setUbicaciones(u);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { setNombre(''); setDescripcion(''); setEdit(null); }, [tab]);

  const meta = META[tab];
  const items: { id: string; nombre: string; descripcion?: string | null; estado: string }[] =
    tab === 'vehiculos' ? vehiculos : tab === 'autorizados' ? autorizados : ubicaciones;

  async function refrescar() { await cargar(); await onChanged(); }

  async function agregar() {
    if (!nombre.trim()) { toast('Escribí el nombre', 'error'); return; }
    setBusy(true);
    try {
      if (tab === 'vehiculos') await crearVehiculo({ nombre, descripcion, actorEmail: actor });
      else await crearCatalogo(meta.tabla!, nombre, actor);
      setNombre(''); setDescripcion('');
      await refrescar();
      toast('Agregado', 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error'); }
    finally { setBusy(false); }
  }
  async function guardarEdit() {
    if (!edit) return;
    if (!edit.nombre.trim()) { toast('Indicá el nombre', 'error'); return; }
    setBusy(true);
    try {
      if (tab === 'vehiculos') await actualizarVehiculo(edit.id, { nombre: edit.nombre, descripcion: edit.descripcion });
      else await actualizarCatalogo(meta.tabla!, edit.id, edit.nombre);
      setEdit(null);
      await refrescar();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setBusy(false); }
  }
  async function toggle(it: { id: string; estado: string }) {
    const nuevo = it.estado === 'activo' ? 'inactivo' : 'activo';
    try {
      if (tab === 'vehiculos') await setEstadoVehiculo(it.id, nuevo);
      else await setEstadoCatalogo(meta.tabla!, it.id, nuevo);
      await refrescar();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }

  return (
    <Modal title="📒 Catálogo de combustible" size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="view-toggle" role="tablist" style={{ marginBottom: '.8rem', marginLeft: 0 }}>
        {(Object.keys(META) as Tab[]).map((k) => (
          <button key={k} type="button" className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{META[k].icon} {META[k].label}</button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title"><span>Agregar {meta.singular}</span></div>
        <div className={meta.conDesc ? 'form-grid' : 'form-row'}>
          <div className="form-row">
            <label>Nombre *</label>
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && !meta.conDesc) { e.preventDefault(); void agregar(); } }}
              placeholder={tab === 'vehiculos' ? 'Camión 350, Retroexcavadora…' : tab === 'autorizados' ? 'Nombre de quien autoriza' : 'Patio, Frente de trabajo…'} />
          </div>
          {meta.conDesc && (
            <div className="form-row"><label>Descripción (opcional)</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Placa, modelo, área…" /></div>
          )}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => void agregar()} disabled={busy} style={{ marginTop: '.5rem' }}>+ Agregar</button>
      </div>

      <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
        <table className="table">
          <thead><tr><th>{meta.label}</th>{meta.conDesc && <th>Descripción</th>}<th>Estado</th><th></th></tr></thead>
          <tbody>
            {!items.length && <tr><td colSpan={meta.conDesc ? 4 : 3} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin {meta.label.toLowerCase()}.</td></tr>}
            {items.map((it) => (
              <tr key={it.id} style={{ opacity: it.estado === 'activo' ? 1 : 0.55 }}>
                <td>{meta.icon} {it.nombre}</td>
                {meta.conDesc && <td className="muted">{it.descripcion || '—'}</td>}
                <td>{it.estado === 'activo' ? '🟢 Activo' : '⚪ Inactivo'}</td>
                <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEdit({ id: it.id, nombre: it.nombre, descripcion: it.descripcion ?? '' })}>✎ Editar</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => void toggle(it)}>{it.estado === 'activo' ? 'Deshabilitar' : 'Habilitar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={`Editar ${meta.singular}`} size="md" onClose={() => setEdit(null)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEdit(null)} disabled={busy}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => void guardarEdit()} disabled={busy}>Guardar</button>
          </>
        }>
          <div className="form-row">
            <label>Nombre</label>
            <input className="input" autoFocus value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && !meta.conDesc) void guardarEdit(); }} />
          </div>
          {meta.conDesc && (
            <div className="form-row">
              <label>Descripción (opcional)</label>
              <input className="input" value={edit.descripcion} onChange={(e) => setEdit({ ...edit, descripcion: e.target.value })} placeholder="Placa, modelo, área…" />
            </div>
          )}
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
  // Modal de surtido: al finalizar, el usuario confirma cuántos litros echó realmente.
  const [finalizarOpen, setFinalizarOpen] = useState(false);
  const [litrosSurtidos, setLitrosSurtidos] = useState(String(s.litros));

  async function aprobar() {
    setBusy(true);
    try { await aprobarSolicitudCombustible(s, actor); notify(`Solicitud ${s.codigo} aprobada`, 'success', { link: '#/app/combustible' }); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo aprobar', 'error'); setBusy(false); }
  }
  async function finalizar() {
    const reales = Number(litrosSurtidos.replace(',', '.'));
    if (!Number.isFinite(reales) || reales <= 0) { toast('Indicá los litros realmente surtidos.', 'error'); return; }
    setBusy(true);
    try {
      await finalizarSolicitudCombustible(s, actor, null, reales);
      notify(`Solicitud ${s.codigo} finalizada · -${num(reales)} L`, 'success', { link: '#/app/combustible' });
      setFinalizarOpen(false);
      await onChanged();
    }
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
    ['Litros solicitados', `${num(s.litros)} L`],
    ...(s.estado === 'finalizada' && s.litros_reales != null
      ? [['Litros surtidos', `${num(Number(s.litros_reales))} L${Number(s.litros_reales) !== Number(s.litros) ? ` (${Number(s.litros_reales) > Number(s.litros) ? '+' : ''}${num(Number(s.litros_reales) - Number(s.litros))} L vs solicitado)` : ''}`]] as Array<[string, string]>
      : []),
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
        {canWrite && s.estado === 'aprobada' && <button className="btn btn-primary" onClick={() => { setLitrosSurtidos(String(s.litros)); setFinalizarOpen(true); }} disabled={busy}>Finalizar (descuenta litros)</button>}
        {canWrite && s.estado !== 'finalizada' && s.estado !== 'cancelada' && <button className="btn btn-danger" onClick={() => setCancelOpen(true)} disabled={busy}>Cancelar</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>
    }>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.86rem' }}>
          <tbody>{filas.map(([k, v]) => <tr key={k}><td style={{ fontWeight: 600, width: 170 }}>{k}</td><td>{v}</td></tr>)}</tbody>
        </table>
      </div>

      {finalizarOpen && (() => {
        const reales = Number(litrosSurtidos.replace(',', '.')) || 0;
        const dif = reales - Number(s.litros);
        return (
        <Modal title="Confirmar surtido" size="sm" onClose={() => !busy && setFinalizarOpen(false)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setFinalizarOpen(false)} disabled={busy}>Cancelar</button>
            <button className="btn btn-primary" onClick={finalizar} disabled={busy}>{busy ? 'Surtiendo…' : `Surtir ${num(reales)} L`}</button>
          </>
        }>
          <p style={{ marginTop: 0 }}>
            Se solicitó <strong className="mono">{num(s.litros)} L</strong> de <strong>{s.combustible_nombre}</strong> para <strong>{s.destino}</strong>.
          </p>
          <div className="form-row">
            <label>Litros realmente surtidos</label>
            <input className="input mono" type="number" min={0} step="any" autoFocus
              value={litrosSurtidos} onChange={(e) => setLitrosSurtidos(e.target.value)} />
            <small className="muted">Indicá cuánto echaste realmente (puede ser más o menos). Se descuentan estos litros del tanque y del inventario.</small>
          </div>
          {reales > 0 && dif !== 0 && (
            <p className="mono" style={{ color: dif > 0 ? 'var(--warning)' : 'var(--primary-3)', fontSize: '.85rem' }}>
              {dif > 0 ? '▲' : '▼'} {dif > 0 ? '+' : ''}{num(dif)} L respecto a lo solicitado.
            </p>
          )}
        </Modal>
        );
      })()}

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

/* ───────────── Planta Eléctrica: movimientos por horómetro (atados a un tanque) ───────────── */
function PlantaModal({ tanques, vehiculos, actor, actorName, onClose, onChanged }: {
  tanques: Tanque[]; vehiculos: VehiculoMaquina[]; actor: string; actorName: string | null;
  onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [movs, setMovs] = useState<PlantaMovimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroTanque, setFiltroTanque] = useState('');
  const [filtroPlanta, setFiltroPlanta] = useState('');
  const [agregar, setAgregar] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try { setMovs(await listPlantaMovimientos()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['combustible_planta_movimientos'], () => { void cargar(); });

  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filtrados = movs.filter((m) =>
    (!filtroTanque || m.tanque_id === filtroTanque) &&
    (!filtroPlanta || norm(m.planta).includes(norm(filtroPlanta))));

  const totalLitros = filtrados.reduce((a, m) => a + (Number(m.litros_consumidos) || 0), 0);

  return (
    <Modal title="⚡ Planta Eléctrica · movimientos de consumo" size="xl" onClose={onClose} footer={
      <>
        <button className="btn btn-primary" onClick={() => setAgregar(true)}>+ Agregar Movimiento</button>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>
    }>
      {/* Filtros */}
      <div className="filterbar" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <input className="input" value={filtroPlanta} onChange={(e) => setFiltroPlanta(e.target.value)} placeholder="🔎 Filtrar por planta…" style={{ flex: '1 1 200px' }} />
        <select className="select" value={filtroTanque} onChange={(e) => setFiltroTanque(e.target.value)} style={{ flex: '1 1 180px' }}>
          <option value="">Todos los tanques</option>
          {tanques.map((t) => <option key={t.id} value={t.id}>🛢 {t.nombre}</option>)}
        </select>
        <span className="muted" style={{ alignSelf: 'center', fontSize: '.8rem' }}>{filtrados.length} mov · <strong className="mono">{num(totalLitros)} L</strong></span>
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.84rem' }}>
          <thead><tr>
            <th>Fecha y hora</th><th>Planta</th><th>Tanque</th>
            <th style={{ textAlign: 'right' }}>HI</th><th style={{ textAlign: 'right' }}>HF</th><th style={{ textAlign: 'right' }}>HRS</th>
            <th style={{ textAlign: 'right' }}>L/h</th><th style={{ textAlign: 'right' }}>Litros</th><th style={{ textAlign: 'right' }}>Acum.</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !filtrados.length && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>Sin movimientos.</td></tr>}
            {filtrados.map((m) => {
              const alerta = (Number(m.litros_acumulados) || 0) >= PLANTA_ALERTA_LITROS;
              return (
                <tr key={m.id}>
                  <td className="muted">{dateTime(m.fecha)}</td>
                  <td>{m.planta || '—'}</td>
                  <td>🛢 {m.tanque_nombre || '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(m.horometro_inicial)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(m.horometro_final)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(m.horas)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(m.litros_por_hora)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(m.litros_consumidos)} L</td>
                  <td className="mono" style={{ textAlign: 'right', color: alerta ? 'var(--danger)' : undefined }}>
                    {num(m.litros_acumulados ?? 0)} L{alerta ? ' ⚠' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <small className="muted" style={{ display: 'block', marginTop: '.5rem' }}>Alerta cuando el consumo acumulado de un tanque supera los {PLANTA_ALERTA_LITROS} L.</small>

      {agregar && (
        <AgregarMovimientoModal tanques={tanques} vehiculos={vehiculos} actor={actor} actorName={actorName}
          onClose={() => setAgregar(false)}
          onSaved={async () => { setAgregar(false); await cargar(); await onChanged(); }} />
      )}
    </Modal>
  );
}

function AgregarMovimientoModal({ tanques, vehiculos, actor, actorName, onClose, onSaved }: {
  tanques: Tanque[]; vehiculos: VehiculoMaquina[]; actor: string; actorName: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const tanquesActivos = tanques.filter((t) => t.estado === 'activo');
  const plantas = vehiculos.filter((v) => v.estado === 'activo' && /planta|generad/i.test(v.nombre));
  const [planta, setPlanta] = useState('');
  const [tanqueId, setTanqueId] = useState(tanquesActivos[0]?.id ?? '');
  const [hi, setHi] = useState('');
  const [hf, setHf] = useState('');
  const [litrosHora, setLitrosHora] = useState('12');
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tanque = tanquesActivos.find((t) => t.id === tanqueId) ?? null;
  const hiN = Number(hi) || 0;
  const hfN = Number(hf) || 0;
  const horas = Math.round((hfN - hiN) * 100) / 100;
  const lph = Number(litrosHora) || 0;
  const litros = horas > 0 ? Math.round(horas * lph * 100) / 100 : 0;
  const dispTanque = tanque ? Number(tanque.litros) || 0 : 0;
  const excede = litros > dispTanque;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tanqueId) { setError('Elegí el tanque.'); return; }
    if (horas <= 0) { setError('El horómetro final debe ser mayor que el inicial.'); return; }
    setSaving(true);
    try {
      const { alerta, acumulado } = await crearPlantaMovimiento({
        planta: planta.trim() || null, tanqueId,
        horometroInicial: hiN, horometroFinal: hfN, litrosPorHora: lph,
        tasa: tanque?.tasa ?? null, nota: nota.trim() || null, actor, actorName,
      });
      notify(`Movimiento de planta: ${num(horas)} h · ${num(litros)} L`, 'success', { link: '#/app/combustible' });
      if (alerta) notify(`⚠ La planta superó los ${PLANTA_ALERTA_LITROS} L acumulados (${num(acumulado)} L) en el tanque ${tanque?.nombre ?? ''}`, 'warning', { link: '#/app/combustible' });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento.');
    } finally { setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="planta-mov" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar movimiento'}</button>
    </>
  );
  return (
    <Modal title="Agregar movimiento de planta" size="lg" onClose={onClose} footer={footer}>
      <form id="planta-mov" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-row">
          <label>Fecha y hora</label>
          <input className="input" value="Se registra automáticamente al guardar" disabled />
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Planta</label>
            <ComboBuscador value={planta} onChange={setPlanta} placeholder="🔎 Buscá la planta…" icono="⚡"
              opciones={plantas.map((v) => ({ value: v.nombre, label: v.nombre, sub: v.descripcion }))} />
          </div>
          <div className="form-row">
            <label>Tanque (cap. {tanque ? num(tanque.capacidad_litros) : '—'} L)</label>
            <select className="select" value={tanqueId} onChange={(e) => setTanqueId(e.target.value)}>
              {!tanquesActivos.length && <option value="">— sin tanques —</option>}
              {tanquesActivos.map((t) => <option key={t.id} value={t.id}>🛢 {t.nombre} · {num(t.litros)}/{num(t.capacidad_litros)} L</option>)}
            </select>
            {tanque && <small className="muted">Disponible: <strong className="mono">{num(tanque.litros)} L</strong>{tanque.tasa != null ? ` · tasa ${num(tanque.tasa)}` : ''}</small>}
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Horómetro inicial (HI)</label>
            <input className="input mono" type="number" step="any" value={hi} onChange={(e) => setHi(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Horómetro final (HF)</label>
            <input className="input mono" type="number" step="any" value={hf} onChange={(e) => setHf(e.target.value)} required />
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Litros por hora</label>
            <input className="input mono" type="number" step="any" value={litrosHora} onChange={(e) => setLitrosHora(e.target.value)} />
            <small className="muted">Consumo de la planta (12 L/h por defecto).</small>
          </div>
          <div className="form-row">
            <label>HRS (HF − HI)</label>
            <input className="input mono" value={horas > 0 ? num(horas) : '—'} disabled />
          </div>
        </div>
        {/* Resumen del consumo */}
        <div className="card" style={{ marginTop: '.4rem', borderColor: excede ? 'var(--warning)' : 'var(--primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
            <span className="muted">Total litros consumido</span>
            <strong className="mono" style={{ fontSize: '1.3rem', color: 'var(--primary-3)' }}>{num(litros)} L</strong>
          </div>
          {excede && <small style={{ color: 'var(--warning)' }}>El consumo ({num(litros)} L) supera lo disponible en el tanque ({num(dispTanque)} L).</small>}
        </div>
        <div className="form-row" style={{ marginTop: '.6rem' }}>
          <label>Nota (opcional)</label>
          <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Referencia, turno, etc." />
        </div>
      </form>
    </Modal>
  );
}

