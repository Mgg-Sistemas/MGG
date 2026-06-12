import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRealtime } from '@/shared/lib/useRealtime';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { money, num } from '@/shared/lib/format';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { MovimientosAcopioView, type ResumenAcopio } from './MovimientosAcopioView';
// Vistas «Por aliado» y «Cuentas por cobrar»: backend listo y datos importados;
// se ocultan del front por ahora (se mostrarán de otra manera). Los componentes
// AliadosAcopioView / CuentasCobrarView siguen en el código para reactivarlos.
import { CategoriasModal } from './CategoriasModal';
import { listProductos } from '@/modules/inventario/inventario.repository';
import type { Producto, RecepcionAcopio } from '@/shared/lib/types';
import {
  createRecepcion,
  updateRecepcion,
  cerrarRecepcion,
  anularRecepcion,
  deleteRecepcion,
  type RecepcionInput,
  type LoteInput,
} from './acopio.repository';
import { listCajas, crearMovimientoCaja, listClasificacionesAll, resumenCajaAcopio, esClasifVehiculo, consumoPorVehiculoAcopio, type CajaMovimientoInput, type ResumenCajaAcopio } from './caja.repository';
import { listVehiculos } from '@/modules/combustible/combustible.repository';
import { ConsumoChartModal } from '@/shared/ui/ConsumoChartModal';
import { descargarResumenCajaPdf, enviarResumenCajaPorCorreo } from './resumenCajaPdf';
import { CorreoReporteModal } from '@/shared/ui/CorreoReporteModal';
import type { ClasificacionAcopio } from '@/shared/lib/types';
import { descargarRecepcionPdf } from './acopioPdf';
import type { CajaCierre } from '@/shared/lib/types';

const ESTADO_LABEL: Record<string, string> = {
  abierta: '● Abierta', cerrada: '✔ Cerrada', anulada: '✖ Anulada',
};
/** Filas por defecto en una recepción nueva (la plantilla original trae 25). */
const FILAS_DEFAULT = 25;
/** Sub-almacén destino fijo del mineral recibido (sede LA ESPERANZA). */
const ALMACEN_ACOPIO = 'CASITERITA';

export function AcopioPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('acopio', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;

  const [productos, setProductos] = useState<Producto[]>([]);
  const [cajas, setCajas] = useState<CajaCierre[]>([]);
  const [editar, setEditar] = useState<RecepcionAcopio | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [movAcopio, setMovAcopio] = useState(false);
  const [categorias, setCategorias] = useState(false);
  const [resumenCaja, setResumenCaja] = useState(false);
  // Switch «Listar movimientos»: oculto por defecto. Apagado = solo tarjetas + Resumen/Categorías;
  // encendido = se muestra la lista de movimientos y el botón de agregar movimiento.
  const [listarMovs, setListarMovs] = useState(false);
  // Resumen único que alimenta TODAS las tarjetas (misma fuente que la tabla de movimientos).
  const [resumen, setResumen] = useState<ResumenAcopio>({ saldoKg: 0, tasa: 0, usdEntregado: 0, saldoUsd: 0, gastos: 0, nominas: 0, facturado: 0 });
  const onResumenAcopio = useCallback((r: ResumenAcopio) => { setResumen(r); }, []);

  // Tendencia de la TASA: ▲ verde si subió, ▼ rojo si bajó (vs. el último valor visto).
  const [tasaTrend, setTasaTrend] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    const t = resumen.tasa;
    if (!t) return;
    const key = 'gt_acopio_tasa_prev';
    const prevRaw = localStorage.getItem(key);
    const prev = prevRaw == null ? null : Number(prevRaw);
    if (prev != null && Number.isFinite(prev) && Math.abs(prev - t) > 0.0001) {
      setTasaTrend(t > prev ? 'up' : 'down');
      localStorage.setItem(key, String(t));
    } else if (prev == null || !Number.isFinite(prev)) {
      localStorage.setItem(key, String(t));
    }
  }, [resumen.tasa]);

  const reload = useCallback(async () => {
    const [ps, cjs] = await Promise.all([
      listProductos(), listCajas(),
    ]);
    setProductos(ps);
    setCajas(cjs);
  }, []);

  useEffect(() => {
    let cancel = false;
    reload().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'Error al cargar', 'error'); });
    return () => { cancel = true; };
  }, [reload]);
  useRealtime(['acopio_recepciones', 'acopio_recepcion_lotes', 'acopio_caja_movimientos', 'acopio_clasificaciones', 'acopio_cajas', 'acopio_costo_clases', 'acopio_cuadres', 'acopio_cuadre_movimientos', 'cajas', 'productos', 'existencias'], reload);

  // Caja a la que se asocian los movimientos nuevos (la ACTUALMENTE ABIERTA).
  const cajaActual = useMemo(() => cajas.find((c) => c.estado === 'abierta') ?? cajas[0] ?? null, [cajas]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🏭 Centro de Acopio LA ESPERANZA</h1>
          <p className="muted">Control de recepción de mineral por centro de acopio. Al cerrar una recepción, el mineral recibido suma stock al inventario.</p>
        </div>
      </div>

      {/* Botones + switch «Listar movimientos», debajo del título. Apagado = solo tarjetas;
          encendido = aparece la lista de movimientos y el botón para agregar uno nuevo. */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem', marginBottom: '1.25rem' }}>
        <button className="btn btn-ghost" onClick={() => setResumenCaja(true)}>📊 Resumen caja</button>
        <button className="btn btn-ghost" onClick={() => setCategorias(true)}>🏷 Categorías</button>
        <label className="switch-row" style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
          <span className="switch">
            <input type="checkbox" checked={listarMovs} onChange={(e) => setListarMovs(e.target.checked)} />
            <span className="slider-toggle" />
          </span>
          <strong style={{ letterSpacing: '.02em' }}>📋 Listar movimientos</strong>
        </label>
        {listarMovs && canWrite && (
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setMovAcopio(true)}>+ Agregar Movimiento</button>
        )}
      </div>

      {/* Tarjeta protagonista: TASA ACTUAL DEL MATERIAL (varía con los gastos) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <div className="card" style={{ borderColor: 'var(--primary)', background: 'linear-gradient(135deg, var(--surface-2), var(--surface))' }}>
          <div className="card-title"><span>💲 Tasa actual del material</span></div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '.5rem', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary-3)' }} className="mono">{money(resumen.tasa)}<span style={{ fontSize: '.9rem', fontWeight: 500 }}> /Kg</span></div>
            {tasaTrend && (
              <span style={{ fontWeight: 800, fontSize: '.9rem', color: tasaTrend === 'up' ? 'var(--success)' : 'var(--danger)' }}
                title={tasaTrend === 'up' ? 'La tasa subió respecto al valor anterior' : 'La tasa bajó respecto al valor anterior'}>
                {tasaTrend === 'up' ? '▲ SUBIÓ' : '▼ BAJÓ'}
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: '.72rem', marginTop: '.3rem' }}>(Facturado + Gastos + Nóminas) ÷ Kg cerrados</div>
        </div>
        <div className="card" style={{ borderColor: 'var(--success)' }}>
          <div className="card-title"><span>💵 USD entregados</span></div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--success)' }} className="mono">{money(resumen.usdEntregado)}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>suma de lo que entra (incluye el dinero recibido del otro sistema)</div>
        </div>
        <div className="card"><div className="card-title"><span>$Usd Facturados</span></div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-3)' }} className="mono">{money(resumen.facturado)}</div><div className="muted" style={{ fontSize: '.72rem' }}>sumatoria de toda la columna $Usd Facturados</div></div>
        <div className="card"><div className="card-title"><span>Saldo de caja</span></div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: resumen.saldoUsd < 0 ? 'var(--danger)' : undefined }} className="mono">{money(resumen.saldoUsd)}</div><div className="muted" style={{ fontSize: '.72rem' }}>saldo en moneda $ Usd (corrido)</div></div>
        <div className="card"><div className="card-title"><span>Saldo en Kg</span></div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: resumen.saldoKg < 0 ? 'var(--danger)' : undefined }} className="mono">{num(resumen.saldoKg)} Kg</div><div className="muted" style={{ fontSize: '.72rem' }}>saldo de casiterita (acumulado)</div></div>
        <div className="card"><div className="card-title"><span>Gastos</span></div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--danger)' }} className="mono">{money(resumen.gastos)}</div></div>
        <div className="card"><div className="card-title"><span>Nóminas</span></div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--danger)' }} className="mono">{money(resumen.nominas)}</div></div>
      </div>

      {/* La vista se mantiene montada (oculta cuando el switch está apagado) para que sus
          cálculos sigan alimentando las tarjetas de arriba vía onResumen. */}
      <MovimientosAcopioView onResumen={onResumenAcopio} visible={listarMovs} />

      {categorias && <CategoriasModal canWrite={canWrite} onClose={() => setCategorias(false)} />}

      {resumenCaja && <ResumenCajaModal defaultEmail={user?.email ?? ''} onClose={() => setResumenCaja(false)} />}


      {movAcopio && (
        <AgregarMovimientoModal
          cajaActual={cajaActual}
          actor={actor}
          actorName={actorName}
          onClose={() => setMovAcopio(false)}
          onSaved={async () => { setMovAcopio(false); await reload(); }}
        />
      )}

      {(nuevo || editar) && (
        <RecepcionModal
          recepcion={editar}
          productos={productos}
          canWrite={canWrite}
          actor={actor}
          actorName={actorName}
          onClose={() => { setNuevo(false); setEditar(null); }}
          onSaved={async () => { setNuevo(false); setEditar(null); await reload(); }}
        />
      )}
    </div>
  );
}

/* ───────────── Agregar movimiento de caja (acopio) ───────────── */

function AgregarMovimientoModal({ cajaActual, actor, actorName, onClose, onSaved }: {
  cajaActual: CajaCierre | null;
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [gastos, setGastos] = useState('');
  const [gastoCat, setGastoCat] = useState('');
  const [gastoVehiculo, setGastoVehiculo] = useState(''); // vehículo imputado (solo categorías de REPUESTOS-REPARACIONES-SERVICIOS)
  const [vehiculos, setVehiculos] = useState<{ value: string; label: string }[]>([]);
  const [descGastos, setDescGastos] = useState('');
  const [nominas, setNominas] = useState('');
  const [nominaCat, setNominaCat] = useState('');
  const [descNominas, setDescNominas] = useState('');
  const [traslado, setTraslado] = useState('');
  const [descTraslado, setDescTraslado] = useState('');
  const [kgRecibidos, setKgRecibidos] = useState('');
  const [descKg, setDescKg] = useState('');
  const [cats, setCats] = useState<ClasificacionAcopio[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listClasificacionesAll().then(setCats).catch(() => setCats([])); }, []);
  // Equipos/maquinaria del módulo de Combustible: alimentan el buscador cuando el gasto va anclado a un vehículo.
  useEffect(() => {
    listVehiculos()
      .then((vs) => setVehiculos(vs.filter((v) => v.estado === 'activo').map((v) => ({ value: v.nombre, label: v.nombre }))))
      .catch(() => setVehiculos([]));
  }, []);
  const gastosCats = useMemo(() => cats.filter((c) => c.grupo === 'gastos_caja' && c.activo), [cats]);
  const nominaCats = useMemo(() => cats.filter((c) => c.grupo === 'nomina' && c.activo), [cats]);
  const gastoEsVehiculo = esClasifVehiculo(gastoCat);

  // Redondeo a 2 decimales para los montos en $.
  const r2 = (s: string) => Math.round((Number(s) || 0) * 100) / 100;

  async function guardar() {
    setError(null);
    const gas = r2(gastos), nom = r2(nominas), tras = r2(traslado);
    const kg = Number(kgRecibidos) || 0;
    if (gas <= 0 && nom <= 0 && tras <= 0 && kg <= 0) { setError('Ingresá al menos un monto.'); return; }
    if (gas > 0 && !gastoCat) { setError('Elegí la categoría del gasto.'); return; }
    if (nom > 0 && !nominaCat) { setError('Elegí la categoría de la nómina.'); return; }
    setSaving(true);
    try {
      const cajaId = cajaActual?.id ?? null;
      // Una fila por concepto: así cada monto conserva su categoría y la distribución
      // por grupo (Gastos/Nómina/Traslado) queda correcta.
      const filas: CajaMovimientoInput[] = [];
      if (gas > 0) filas.push({ fecha, gastos: gas, clasif_grupo: 'gastos_caja', clasif_valor: gastoCat, vehiculo: gastoEsVehiculo ? (gastoVehiculo.trim() || null) : null, descripcion: descGastos.trim() || gastoCat, caja_id: cajaId });
      if (nom > 0) filas.push({ fecha, nominas: nom, clasif_grupo: 'nomina', clasif_valor: nominaCat, descripcion: descNominas.trim() || nominaCat, caja_id: cajaId });
      if (tras > 0) filas.push({ fecha, traslado: tras, clasif_grupo: 'traslado', descripcion: descTraslado.trim() || 'Traslado de caja', caja_id: cajaId });
      if (kg > 0) filas.push({ fecha, kg_recibidos: kg, descripcion: descKg.trim() || 'Kg recibidos por MGG', caja_id: cajaId });
      for (const f of filas) await crearMovimientoCaja(f, actor, actorName);
      toast(`${filas.length} movimiento(s) registrado(s)`, 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'Registrar'}</button>
    </>
  );

  // Campo monto en $ con 2 decimales.
  const campoUsd = (label: string, val: string, set: (v: string) => void) => (
    <div className="form-row">
      <label>{label}</label>
      <input className="input mono" type="number" min={0} step="0.01" value={val} onChange={(e) => set(e.target.value)} placeholder="0.00" />
    </div>
  );

  // Descripción del concepto → es lo que se muestra en la columna «Descripción» de la tabla.
  const campoDesc = (val: string, set: (v: string) => void, placeholder: string) => (
    <div className="form-row">
      <label>Descripción</label>
      <input className="input" value={val} onChange={(e) => set(e.target.value)} placeholder={placeholder} />
    </div>
  );

  return (
    <Modal title="Agregar movimiento" size="md" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <p className="muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
        Caja: <strong>{cajaActual ? `${cajaActual.numero}${cajaActual.nombre ? ` · ${cajaActual.nombre}` : ''}` : '—'}</strong>. Completá los campos que apliquen; cada concepto se registra como un movimiento.
      </p>

      <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>

      {/* Gastos GT: monto + categoría + descripción */}
      <div className="form-grid">
        {campoUsd('$ Gastos', gastos, setGastos)}
        <div className="form-row">
          <label>Categoría del gasto</label>
          <select className="select" value={gastoCat} onChange={(e) => setGastoCat(e.target.value)}>
            <option value="">— elegí el gasto —</option>
            {gastosCats.map((c) => <option key={c.id} value={c.valor}>{c.valor}</option>)}
          </select>
        </div>
      </div>
      {/* Vehículo/maquinaria: solo cuando la categoría es de REPUESTOS - REPARACIONES - SERVICIOS (opcional). */}
      {gastoEsVehiculo && (
        <div className="form-row">
          <label>🚜 Vehículo / maquinaria <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
          <SearchSelect value={gastoVehiculo} onChange={setGastoVehiculo}
            options={vehiculos} placeholder="🔎 Buscá el equipo del catálogo de Combustible…"
            emptyText="Sin equipos. Agregalos en Combustible → Catálogo → Equipos." />
          <small className="muted">El gasto queda imputado a este equipo y se ve en el consumo $ por vehículo del resumen.</small>
        </div>
      )}
      {campoDesc(descGastos, setDescGastos, gastoCat || 'Descripción del gasto')}

      {/* Nómina: monto + categoría + descripción */}
      <div className="form-grid">
        {campoUsd('$ Nómina', nominas, setNominas)}
        <div className="form-row">
          <label>Categoría de nómina</label>
          <select className="select" value={nominaCat} onChange={(e) => setNominaCat(e.target.value)}>
            <option value="">— elegí la nómina —</option>
            {nominaCats.map((c) => <option key={c.id} value={c.valor}>{c.valor}</option>)}
          </select>
        </div>
      </div>
      {campoDesc(descNominas, setDescNominas, nominaCat || 'Descripción de la nómina')}

      {/* Traslado: monto + descripción */}
      <div className="form-grid">
        {campoUsd('$ Traslado de Caja', traslado, setTraslado)}
        {campoDesc(descTraslado, setDescTraslado, 'Traslado de caja')}
      </div>

      {/* Kg recibidos por MGG: cantidad + descripción */}
      <div className="form-grid">
        <div className="form-row">
          <label>Kg Recibidos por MGG</label>
          <input className="input mono" type="number" min={0} step="any" value={kgRecibidos} onChange={(e) => setKgRecibidos(e.target.value)} placeholder="0" />
          <small className="muted">Expresado en Kg.</small>
        </div>
        {campoDesc(descKg, setDescKg, 'Kg recibidos por MGG')}
      </div>
    </Modal>
  );
}

/* ───────────── Resumen de Caja (réplica de la hoja «RESUMEN CAJA PERAMANAL GT») ───────────── */

function ResumenCajaModal({ defaultEmail, onClose }: { defaultEmail: string; onClose: () => void }) {
  const [r, setR] = useState<ResumenCajaAcopio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);
  const [correoOpen, setCorreoOpen] = useState(false);
  // Categoría de vehículo seleccionada para ver su consumo en $ por vehículo (gráfica).
  const [consumoCat, setConsumoCat] = useState<string | null>(null);
  // Filtro por rango de fechas: el resumen se recalcula solo con los movimientos del rango.
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const hayRango = !!(desde || hasta);

  // Se recalcula desde los movimientos; en vivo cuando entra/cambia alguno (Realtime).
  const cargar = useCallback(() => {
    resumenCajaAcopio(undefined, { desde: desde || null, hasta: hasta || null })
      .then(setR).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el resumen'));
  }, [desde, hasta]);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['acopio_caja_movimientos', 'acopio_contratos'], cargar);

  const pct = (v: number) => `${(v * 100).toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button className="btn btn-ghost" disabled={!r} onClick={() => setCorreoOpen(true)}>✉ Correo</button>
      <button className="btn btn-primary" disabled={!r || bajando}
        onClick={async () => {
          if (!r) return;
          setBajando(true);
          try { await descargarResumenCajaPdf(r); }
          catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
          finally { setBajando(false); }
        }}>{bajando ? 'Generando…' : '↓ PDF'}</button>
    </>
  );

  const Kpi = ({ titulo, valor, color, destacar }: { titulo: string; valor: string; color?: string; destacar?: boolean }) => (
    <div className="card" style={destacar ? { borderColor: 'var(--primary)', borderWidth: 2, background: 'linear-gradient(135deg, var(--surface-2), var(--surface))' } : undefined}>
      <div className="card-title"><span>{titulo}</span></div>
      <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, color }}>{valor}</div>
    </div>
  );

  const TablaCat = ({ titulo, filas, totalLabel, totalMonto, totalPct, color, onVerVehiculo }: {
    titulo: string; filas: { valor: string; monto: number; pct: number }[]; totalLabel: string; totalMonto: number; totalPct: number; color: string;
    onVerVehiculo?: (valor: string) => void;
  }) => (
    <>
      <div className="card-title" style={{ marginTop: '1rem' }}><span style={{ color }}>{titulo}</span></div>
      {!filas.length ? <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>Sin registros.</p> : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.8rem' }}>
            <thead><tr><th>Categoría</th><th style={{ textAlign: 'right' }}>Monto</th><th style={{ textAlign: 'right' }}>% del total gastado</th></tr></thead>
            <tbody>
              {filas.map((c) => {
                const esVeh = !!onVerVehiculo && esClasifVehiculo(c.valor);
                return (
                <tr key={c.valor} onClick={esVeh ? () => onVerVehiculo!(c.valor) : undefined}
                  style={esVeh ? { cursor: 'pointer' } : undefined}
                  title={esVeh ? 'Ver consumo en $ por vehículo' : undefined}>
                  <td>{c.valor}{esVeh && <span className="muted" style={{ marginLeft: '.4rem' }} title="Ver consumo $ por vehículo">📊</span>}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(c.monto)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{pct(c.pct)}</td>
                </tr>
                );
              })}
            </tbody>
            <tfoot><tr style={{ fontWeight: 700, borderTop: '2px solid var(--border, rgba(255,255,255,.15))' }}>
              <td>{totalLabel}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{money(totalMonto)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{pct(totalPct)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </>
  );

  return (
    <Modal title="📊 Resumen de Caja · LA ESPERANZA" size="lg" onClose={onClose} footer={footer}>
      {error ? (
        <div className="card" style={{ borderColor: 'var(--danger)' }}><strong>Error:</strong> {error}</div>
      ) : !r ? (
        <p className="muted" style={{ margin: 0 }}>Cargando resumen…</p>
      ) : (
        <>
          {/* Filtro por rango de fechas: recalcula el resumen solo con los movimientos del rango. */}
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
              Desde <input className="input" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} style={{ width: 'auto' }} />
            </label>
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
              Hasta <input className="input" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} style={{ width: 'auto' }} />
            </label>
            {hayRango && <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(''); setHasta(''); }}>✕ Limpiar rango</button>}
            {hayRango && <span className="badge" style={{ fontSize: '.72rem' }}>Mostrando solo el rango seleccionado</span>}
          </div>
          <p className="muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
            {hayRango
              ? <>Rango <strong>{desde || '—'}</strong> → <strong>{hasta || '—'}</strong> · {r.movimientos} movimiento(s) en el rango</>
              : <>Inicio <strong>{r.fechaInicio ?? '—'}</strong> · Última actualización <strong>{r.fechaActualizacion}</strong> · <strong>{r.dias}</strong> días transcurridos · {r.movimientos} movimiento(s)</>}
          </p>

          {/* KPIs principales */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.75rem' }}>
            <Kpi titulo="Saldo actual de la caja" valor={money(r.saldoUsd)} color={r.saldoUsd < 0 ? 'var(--danger)' : undefined} destacar />
            <Kpi titulo="Total entregado" valor={money(r.totalEntregado)} color="var(--success)" />
            <Kpi titulo="Total gastado" valor={money(r.totalGastado)} color="var(--danger)" />
            <Kpi titulo="Tasa del material" valor={`${money(r.tasaMaterial)} /Kg`} color="var(--primary-3)" />
          </div>

          {/* % Gastos vs % Nómina */}
          <div className="card" style={{ marginTop: '1rem' }}>
            <div className="card-title"><span>Distribución de lo gastado</span></div>
            <div style={{ display: 'flex', height: 16, borderRadius: 6, overflow: 'hidden', background: 'var(--surface-2)' }}>
              <div title={`Gastos ${pct(r.pctGastos)}`} style={{ width: `${r.pctGastos * 100}%`, background: '#ef4444' }} />
              <div title={`Nómina ${pct(r.pctNomina)}`} style={{ width: `${r.pctNomina * 100}%`, background: '#a855f7' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.4rem', fontSize: '.82rem' }}>
              <span><span style={{ color: '#ef4444' }}>■</span> Gastos <strong>{pct(r.pctGastos)}</strong> · {money(r.totalGastos)}</span>
              <span><span style={{ color: '#a855f7' }}>■</span> Nómina <strong>{pct(r.pctNomina)}</strong> · {money(r.totalNominas)}</span>
            </div>
          </div>

          {/* Kg de casiterita */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.75rem', marginTop: '1rem' }}>
            <Kpi titulo="Producción GT (entra)" valor={`${num(r.kgProduccion)} Kg`} color="var(--primary-3)" />
            <Kpi titulo="Enviados a MGG" valor={`${num(r.kgEnviados)} Kg`} />
            <Kpi titulo="Diferencia" valor={`${num(r.diferenciaKg)} Kg`} color={r.diferenciaKg < 0 ? 'var(--danger)' : 'var(--success)'} />
          </div>

          <TablaCat titulo="Gastos por categoría" filas={r.gastosPorCategoria} totalLabel="Total gastos" totalMonto={r.totalGastos} totalPct={r.pctGastos} color="#ef4444" onVerVehiculo={setConsumoCat} />
          <p className="muted" style={{ fontSize: '.74rem', marginTop: '.3rem' }}>💡 Las categorías de <strong>repuestos · reparaciones · servicios</strong> (📊) se pueden tocar para ver el <strong>consumo en $ por vehículo</strong>.</p>
          <TablaCat titulo="Nómina por categoría" filas={r.nominaPorCategoria} totalLabel="Total nómina" totalMonto={r.totalNominas} totalPct={r.pctNomina} color="#a855f7" />
        </>
      )}

      {consumoCat && (
        <ConsumoChartModal
          title={`📊 Consumo $ por vehículo · ${consumoCat}`}
          subtitle="Total gastado por vehículo/maquinaria en esta categoría (repuestos · reparaciones · servicios). Buscá un equipo por nombre."
          cargar={async (d, h) => {
            const filas = await consumoPorVehiculoAcopio(d, h, consumoCat);
            return filas.map((f) => ({ id: f.id, label: f.nombre, unidad: 'compra(s)', cantidad: f.compras, valor: f.valor }));
          }}
          onClose={() => setConsumoCat(null)}
        />
      )}

      {correoOpen && r && (
        <CorreoReporteModal
          titulo={`Enviar Resumen de Caja · ${r.centro}`}
          descripcion={`Se enviará el PDF del resumen de caja al ${r.fechaActualizacion} (saldo ${money(r.saldoUsd)} · total gastado ${money(r.totalGastado)}).`}
          defaultEmail={defaultEmail}
          onEnviar={async (emails) => {
            const { destinatarios } = await enviarResumenCajaPorCorreo(r, emails);
            return destinatarios;
          }}
          onClose={() => setCorreoOpen(false)}
        />
      )}
    </Modal>
  );
}

/* ───────────── Editor / detalle (réplica del formato Excel) ───────────── */

interface FilaLote {
  nro_lote: string;
  cantidad_bolsas: string;
  peso_bolsa_kg: string;
  peso_neto_kg: string;
  precinto_inicio: string;
  peso_recepcionado_kg: string;
  precinto_final: string;
}

const filaVacia = (n: number): FilaLote => ({
  nro_lote: String(n), cantidad_bolsas: '', peso_bolsa_kg: '', peso_neto_kg: '',
  precinto_inicio: '', peso_recepcionado_kg: '', precinto_final: '',
});

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** Verf. = IF(precinto_inicio = precinto_final, "V", "F") del Excel. */
const verf = (f: FilaLote) => f.precinto_inicio.trim() === f.precinto_final.trim();

function RecepcionModal({ recepcion, productos, canWrite, actor, actorName, onClose, onSaved }: {
  recepcion: RecepcionAcopio | null;
  productos: Producto[];
  canWrite: boolean;
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const esNueva = !recepcion;
  const editable = canWrite && (esNueva || recepcion!.estado === 'abierta');

  const [fecha, setFecha] = useState(recepcion?.fecha ?? new Date().toISOString().slice(0, 10));
  const [centro, setCentro] = useState(recepcion?.centro_acopio ?? 'La Esperanza');
  const [aliado, setAliado] = useState(recepcion?.aliado ?? '');
  const [productoId, setProductoId] = useState(recepcion?.producto_id ?? '');
  // El stock de la recepción va DIRECTO al sub-almacén CASITERITA (sede LA ESPERANZA).
  const [almacen] = useState(recepcion?.almacen ?? ALMACEN_ACOPIO);
  const [entNombre, setEntNombre] = useState(recepcion?.entregado_nombre ?? '');
  const [entCi, setEntCi] = useState(recepcion?.entregado_ci ?? '');
  const [recNombre, setRecNombre] = useState(recepcion?.recibido_nombre ?? '');
  const [recCi, setRecCi] = useState(recepcion?.recibido_ci ?? '');
  const [obs, setObs] = useState(recepcion?.observaciones ?? '');
  const [filas, setFilas] = useState<FilaLote[]>(() => {
    const ls = recepcion?.lotes ?? [];
    if (!ls.length) return Array.from({ length: FILAS_DEFAULT }, (_, i) => filaVacia(i + 1));
    return ls.map((l) => ({
      nro_lote: l.nro_lote ?? '',
      cantidad_bolsas: l.cantidad_bolsas ? String(l.cantidad_bolsas) : '',
      peso_bolsa_kg: l.peso_bolsa_kg ? String(l.peso_bolsa_kg) : '',
      peso_neto_kg: l.peso_neto_kg ? String(l.peso_neto_kg) : '',
      precinto_inicio: l.precinto_inicio ?? '',
      peso_recepcionado_kg: l.peso_recepcionado_kg ? String(l.peso_recepcionado_kg) : '',
      precinto_final: l.precinto_final ?? '',
    }));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setFila(i: number, patch: Partial<FilaLote>) {
    setFilas((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function addFila() { setFilas((prev) => [...prev, filaVacia(prev.length + 1)]); }
  function delFila(i: number) { setFilas((prev) => prev.filter((_, idx) => idx !== i)); }

  const totales = useMemo(() => filas.reduce((a, f) => {
    const bruto = n(f.cantidad_bolsas) * n(f.peso_bolsa_kg);
    return {
      bolsas: a.bolsas + n(f.cantidad_bolsas), bruto: a.bruto + bruto,
      neto: a.neto + n(f.peso_neto_kg), recepcionado: a.recepcionado + n(f.peso_recepcionado_kg),
    };
  }, { bolsas: 0, bruto: 0, neto: 0, recepcionado: 0 }), [filas]);

  const cantidadStock = totales.recepcionado > 0 ? totales.recepcionado : totales.neto;
  const productoSel = productos.find((p) => p.id === productoId) ?? null;
  const unidad = productoSel?.unidad || 'Kg';

  function buildInput(): RecepcionInput {
    const lotes: LoteInput[] = filas.map((f) => ({
      nro_lote: f.nro_lote, cantidad_bolsas: n(f.cantidad_bolsas), peso_bolsa_kg: n(f.peso_bolsa_kg),
      peso_neto_kg: n(f.peso_neto_kg), precinto_inicio: f.precinto_inicio,
      peso_recepcionado_kg: n(f.peso_recepcionado_kg), precinto_final: f.precinto_final,
    }));
    return {
      fecha, centro_acopio: centro, aliado, producto_id: productoId || null, almacen,
      entregado_nombre: entNombre, entregado_ci: entCi, recibido_nombre: recNombre, recibido_ci: recCi,
      observaciones: obs, lotes,
    };
  }

  async function guardar() {
    setError(null);
    if (!fecha) { setError('Indicá la fecha.'); return; }
    setSaving(true);
    try {
      if (esNueva) {
        const r = await createRecepcion(buildInput(), actor, actorName);
        notify(`Recepción ${r.numero} creada (borrador)`, 'success', { link: '#/app/acopio' });
      } else {
        await updateRecepcion(recepcion!.id, buildInput());
        toast('Recepción actualizada', 'success');
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar.'); setSaving(false); }
  }

  async function guardarYCerrar() {
    setError(null);
    if (!productoId) { setError('Elegí el producto (mineral) al que se suma el stock.'); return; }
    if (!almacen.trim()) { setError('Elegí el almacén destino del stock.'); return; }
    if (cantidadStock <= 0) { setError('El peso recibido debe ser mayor que 0.'); return; }
    setSaving(true);
    try {
      let id = recepcion?.id;
      if (esNueva) { id = (await createRecepcion(buildInput(), actor, actorName)).id; }
      else { await updateRecepcion(recepcion!.id, buildInput()); }
      const cerrada = await cerrarRecepcion(id!, actor, actorName);
      notify(`Recepción ${cerrada.numero} cerrada · +${num(cantidadStock)} ${unidad} a ${almacen}`, 'success', { link: '#/app/acopio' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo cerrar.'); setSaving(false); }
  }

  async function anular() {
    if (!recepcion) return;
    if (!window.confirm(`¿Anular la recepción ${recepcion.numero}? Si estaba cerrada, se revierte el stock sumado.`)) return;
    setSaving(true);
    try {
      await anularRecepcion(recepcion.id, actor, actorName);
      notify(`Recepción ${recepcion.numero} anulada`, 'info', { link: '#/app/acopio' });
      onSaved();
    } catch (err) { toast(err instanceof Error ? err.message : 'No se pudo anular', 'error'); setSaving(false); }
  }

  async function eliminar() {
    if (!recepcion) return;
    if (!window.confirm(`¿Eliminar el borrador ${recepcion.numero}? Esta acción no se puede deshacer.`)) return;
    setSaving(true);
    try { await deleteRecepcion(recepcion.id); toast('Borrador eliminado', 'success'); onSaved(); }
    catch (err) { toast(err instanceof Error ? err.message : 'No se pudo eliminar', 'error'); setSaving(false); }
  }

  async function pdf() {
    try {
      const r: RecepcionAcopio = recepcion ? { ...recepcion } : {
        ...buildInput(), id: 'preview', numero: '(borrador)', estado: 'abierta', created_at: new Date().toISOString(),
        lotes: filas.map((f, i) => ({
          id: String(i), recepcion_id: 'preview', orden: i, nro_lote: f.nro_lote,
          cantidad_bolsas: n(f.cantidad_bolsas), peso_bolsa_kg: n(f.peso_bolsa_kg),
          peso_bruto_total: n(f.cantidad_bolsas) * n(f.peso_bolsa_kg), peso_neto_kg: n(f.peso_neto_kg),
          dif_bruto_neto: n(f.cantidad_bolsas) * n(f.peso_bolsa_kg) - n(f.peso_neto_kg),
          precinto_inicio: f.precinto_inicio, peso_recepcionado_kg: n(f.peso_recepcionado_kg),
          dif_neto_recepcionado: n(f.peso_neto_kg) - n(f.peso_recepcionado_kg),
          precinto_final: f.precinto_final, verificado: verf(f),
        })),
      } as RecepcionAcopio;
      await descargarRecepcionPdf(r);
    } catch (err) { toast(err instanceof Error ? err.message : 'No se pudo generar el PDF', 'error'); }
  }

  const estado = recepcion?.estado ?? 'abierta';
  const titulo = esNueva ? 'Nueva recepción de mineral' : `Recepción ${recepcion!.numero} · ${ESTADO_LABEL[estado] ?? estado}`;
  const ro = !editable;
  // Estilos de "hoja" (réplica del Excel con el front del sistema).
  const thStyle: React.CSSProperties = { fontSize: '.68rem', lineHeight: 1.15, textAlign: 'center', verticalAlign: 'bottom', whiteSpace: 'pre-line', padding: '.35rem .3rem' };
  const calcCol: React.CSSProperties = { background: 'var(--surface-2)', textAlign: 'right', fontWeight: 600 };
  const cellNum = { width: 66 };

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>
      <button type="button" className="btn btn-ghost" onClick={pdf} disabled={saving}>↓ PDF</button>
      {!esNueva && estado === 'abierta' && canWrite && (<button type="button" className="btn btn-danger" onClick={eliminar} disabled={saving}>Eliminar</button>)}
      {estado === 'cerrada' && canWrite && (<button type="button" className="btn btn-danger" onClick={anular} disabled={saving}>Anular (revierte stock)</button>)}
      {editable && (
        <>
          <button type="button" className="btn btn-ghost" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar borrador'}</button>
          <button type="button" className="btn btn-primary" onClick={() => void guardarYCerrar()} disabled={saving}>{saving ? '…' : 'Cerrar y sumar stock'}</button>
        </>
      )}
    </>
  );

  return (
    <Modal title={titulo} size="xl" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      {/* ── Hoja estilo Excel ── */}
      <div className="card" style={{ padding: '1rem' }}>
        <h3 style={{ textAlign: 'center', margin: '0 0 1rem', letterSpacing: '.02em', fontSize: '1rem' }}>
          CONTROL DE RECEPCIÓN DE MINERAL POR CENTRO DE ACOPIO
        </h3>

        {/* Encabezado: Fecha / Centro de Acopio / Aliado */}
        <div className="form-grid" style={{ gap: '.6rem 1rem' }}>
          <div className="form-row"><label>FECHA</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={ro} /></div>
          <div className="form-row"><label>CENTRO DE ACOPIO</label><input className="input" value={centro} onChange={(e) => setCentro(e.target.value)} disabled={ro} /></div>
          <div className="form-row"><label>ALIADO</label><input className="input" value={aliado} onChange={(e) => setAliado(e.target.value)} placeholder="Nombre del aliado" disabled={ro} /></div>
        </div>

        {/* Vínculo de inventario (no está en el Excel; es lo que suma stock) */}
        <div className="form-grid" style={{ gap: '.6rem 1rem', marginTop: '.4rem', padding: '.5rem .6rem', border: '1px dashed var(--border-strong)', borderRadius: 8 }}>
          <div className="form-row">
            <label>📦 Producto (mineral) que suma stock al cerrar</label>
            <SearchSelect value={productoId} onChange={setProductoId} disabled={ro} placeholder="🔍 Buscar producto…"
              options={productos.map((p) => ({ value: p.id, label: `${p.nombre} ${p.sku ? `(${p.sku})` : ''}`.trim() }))} />
          </div>
          <div className="form-row">
            <label>Almacén destino del stock</label>
            <input className="input" value={`LA ESPERANZA › ${almacen}`} readOnly disabled
              title="El stock recibido entra directo al sub-almacén CASITERITA de LA ESPERANZA." />
            <small className="muted">Fijo: el mineral entra directo al sub-almacén <strong>{almacen}</strong> (sede LA ESPERANZA).</small>
          </div>
        </div>

        {/* Tabla de lotes — títulos idénticos al Excel */}
        <div className="table-wrap" style={{ marginTop: '.8rem' }}>
          <table className="table" style={{ fontSize: '.8rem' }}>
            <thead>
              <tr>
                <th colSpan={7} style={{ textAlign: 'center', fontSize: '.72rem', background: 'var(--surface-3)' }}>DATOS DEL LOTE EN EL CENTRO DE ACOPIO</th>
                <th colSpan={4} style={{ textAlign: 'center', fontSize: '.72rem', background: 'var(--primary)', color: '#1c1f24' }}>RECEPCIÓN LA ESPERANZA · PUERTO ORDAZ</th>
              </tr>
              <tr>
                <th style={thStyle}>{'N° de Lote\nAsignado'}</th>
                <th style={thStyle}>{'Cantidad\nde Bolsas'}</th>
                <th style={thStyle}>{'Peso de Cada\nBolsa Kg'}</th>
                <th style={thStyle}>{'Peso Bruto\nTotal Kg 🧮'}</th>
                <th style={thStyle}>{'Peso Neto\n(Real Pesado Kg)'}</th>
                <th style={thStyle}>{'Diferencia Kg\n(Bruto − Neto) 🧮'}</th>
                <th style={thStyle}>{'Nro. precinto\n(inicio)'}</th>
                <th style={thStyle}>{'Peso Recepcionado\n(C.A. Pto. Ordaz)'}</th>
                <th style={thStyle}>{'Diferencia Kg\n(Neto − Recep.) 🧮'}</th>
                <th style={thStyle}>{'Nro. precinto\n(final)'}</th>
                <th style={thStyle}>{'Verf.\n🧮'}</th>
                {editable && <th style={{ width: 28 }}></th>}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                const bruto = n(f.cantidad_bolsas) * n(f.peso_bolsa_kg);
                const dif1 = bruto - n(f.peso_neto_kg);
                const dif2 = n(f.peso_neto_kg) - n(f.peso_recepcionado_kg);
                const v = verf(f);
                const algo = f.cantidad_bolsas || f.peso_neto_kg || f.precinto_inicio || f.peso_recepcionado_kg;
                return (
                  <tr key={i}>
                    <td><input className="input" style={{ width: 52, textAlign: 'center' }} value={f.nro_lote} onChange={(e) => setFila(i, { nro_lote: e.target.value })} disabled={ro} /></td>
                    <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.cantidad_bolsas} onChange={(e) => setFila(i, { cantidad_bolsas: e.target.value })} disabled={ro} /></td>
                    <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.peso_bolsa_kg} onChange={(e) => setFila(i, { peso_bolsa_kg: e.target.value })} disabled={ro} /></td>
                    <td className="mono" style={{ ...calcCol, color: 'var(--primary-3)' }}>{num(bruto)}</td>
                    <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.peso_neto_kg} onChange={(e) => setFila(i, { peso_neto_kg: e.target.value })} disabled={ro} /></td>
                    <td className="mono" style={calcCol}>{num(dif1)}</td>
                    <td><input className="input" style={{ width: 80 }} value={f.precinto_inicio} onChange={(e) => setFila(i, { precinto_inicio: e.target.value })} disabled={ro} /></td>
                    <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.peso_recepcionado_kg} onChange={(e) => setFila(i, { peso_recepcionado_kg: e.target.value })} disabled={ro} /></td>
                    <td className="mono" style={calcCol}>{num(dif2)}</td>
                    <td><input className="input" style={{ width: 80 }} value={f.precinto_final} onChange={(e) => setFila(i, { precinto_final: e.target.value })} disabled={ro} /></td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: algo ? (v ? 'var(--success)' : 'var(--danger)') : 'var(--muted)' }}>{algo ? (v ? 'V' : 'F') : '—'}</td>
                    {editable && <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => delFila(i)} title="Quitar fila">✕</button></td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td style={{ textAlign: 'right' }}>TOTALES</td>
                <td className="mono" style={{ textAlign: 'right' }}>{num(totales.bolsas)}</td>
                <td></td>
                <td className="mono" style={{ ...calcCol, color: 'var(--primary-3)' }}>{num(totales.bruto)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{num(totales.neto)}</td>
                <td></td><td></td>
                <td className="mono" style={{ textAlign: 'right' }}>{num(totales.recepcionado)}</td>
                <td></td><td></td><td></td>{editable && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>
        {editable && <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.5rem' }} onClick={addFila}>+ Agregar lote</button>}

        {/* Firmas */}
        <div className="form-grid" style={{ marginTop: '1rem' }}>
          <div className="card" style={{ background: 'var(--surface-2)' }}>
            <div className="card-title" style={{ justifyContent: 'center' }}><span>Conforme Entregado</span></div>
            <div className="form-row"><label>Nombres y Apellidos</label><input className="input" value={entNombre} onChange={(e) => setEntNombre(e.target.value)} disabled={ro} /></div>
            <div className="form-row"><label>N° C.I.</label><input className="input" value={entCi} onChange={(e) => setEntCi(e.target.value)} disabled={ro} /></div>
          </div>
          <div className="card" style={{ background: 'var(--surface-2)' }}>
            <div className="card-title" style={{ justifyContent: 'center' }}><span>Conforme Recibido por LA ESPERANZA</span></div>
            <div className="form-row"><label>Nombres y Apellidos</label><input className="input" value={recNombre} onChange={(e) => setRecNombre(e.target.value)} disabled={ro} /></div>
            <div className="form-row"><label>N° C.I.</label><input className="input" value={recCi} onChange={(e) => setRecCi(e.target.value)} disabled={ro} /></div>
          </div>
        </div>
        <div className="form-row" style={{ marginTop: '.6rem' }}>
          <label>Observaciones</label>
          <textarea className="input" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} disabled={ro} />
        </div>
      </div>

      {estado === 'cerrada' && (
        <div className="card" style={{ borderColor: 'var(--primary)', marginTop: '.75rem', fontSize: '.85rem' }}>
          ✔ Recepción cerrada · sumó <strong className="mono">{num(recepcion?.mov_cantidad ?? 0)}</strong> al inventario ({recepcion?.mov_almacen}).
        </div>
      )}
      {editable && (
        <p className="muted" style={{ fontSize: '.8rem', marginTop: '.6rem' }}>
          Al cerrar se sumarán <strong className="mono">{num(cantidadStock)} {unidad}</strong> al stock de <strong>{productoSel?.nombre ?? '(elegí producto)'}</strong> en <strong>{almacen || '(elegí almacén)'}</strong>
          {totales.recepcionado <= 0 && totales.neto > 0 && ' · se usa el peso neto porque no hay peso recepcionado.'}
        </p>
      )}
    </Modal>
  );
}
