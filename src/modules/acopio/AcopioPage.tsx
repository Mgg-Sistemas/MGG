import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRealtime } from '@/shared/lib/useRealtime';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { money, num, hoyISO, date } from '@/shared/lib/format';
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
import { listCajas, crearMovimientoCaja, listClasificacionesAll, resumenCajaAcopio, esClasifVehiculo, consumoPorVehiculoAcopio, listMovimientosCategoria, cerrarYAbrirCaja, listCajaMovimientos, siguienteNumeroCaja, listEntrantesAcopioPorConfirmar, aceptarEntradaEnCajaAcopio, CENTRO_ACOPIO_EXTERNO, type CajaMovimientoInput, type ResumenCajaAcopio, type MovimientoCategoria } from './caja.repository';
import type { GrupoClasificacion, CajaMovimiento, TransferenciaInter } from '@/shared/lib/types';
import { listVehiculos } from '@/modules/combustible/combustible.repository';
import { ConsumoChartModal } from '@/shared/ui/ConsumoChartModal';
// descargarResumenCajaPdf / enviarResumenCajaPorCorreo se importan dinámicamente (al generar) para no cargar jsPDF al abrir.
import { CorreoReporteModal } from '@/shared/ui/CorreoReporteModal';
import type { ClasificacionAcopio } from '@/shared/lib/types';
// descargarRecepcionPdf se importa dinámicamente (al generar) para no cargar jsPDF al abrir.
import type { CajaCierre } from '@/shared/lib/types';
import {
  listResumenes, crearResumen, eliminarResumen,
  computeTotales, acopiadoMggSector, resguardoSector, esGt, sectoresPorDefecto,
  leerMetricaExterna, METRICAS_EXTERNAS, METRICAS_SECTOR, rutaDeFuente,
  type ResumenSemanal, type SectorResumen, type FuenteExterna,
} from './resumenSemanal.repository';
// descargarResumenSemanalPdf / enviarResumenSemanalPorCorreo se importan dinámicamente (al generar) para no cargar jsPDF al abrir.
import { AliadosVista } from './AliadosVista';
import { CuentasCobrarView } from './CuentasCobrarView';
import { CuentaPerdidaAliView, CuadroResumenPerdidaView } from './EsmeraldaPerdidaView';
import {
  listDestinosTraslado, ejecutarTrasladoAcopio,
  crearDestinoTraslado, actualizarDestinoTraslado, setDestinoTrasladoActivo, eliminarDestinoTraslado,
  listCajasExternas, type DestinoTrasladoInput, type CajaEspejo,
} from './destinosTraslado.repository';
import { listAliados } from './subledgers.repository';
import type { AliadoAcopio, DestinoTraslado, TipoDestinoTraslado } from '@/shared/lib/types';

const ESTADO_LABEL: Record<string, string> = {
  abierta: '● Abierta', cerrada: '✔ Cerrada', anulada: '✖ Anulada',
};
/** Filas por defecto en una recepción nueva (la plantilla original trae 25). */
const FILAS_DEFAULT = 25;
/** Sub-almacén destino fijo del mineral recibido (sede LA ESPERANZA). */
const ALMACEN_ACOPIO = 'CASITERITA';

/** Página del centro LA ESPERANZA (módulo base, sin props → compatible con el lazy router). */
export function AcopioPage() {
  return <AcopioModulo centro="LA ESPERANZA" />;
}

function AcopioModulo({ centro }: { centro: string }) {
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
  const [cerrarCajaOpen, setCerrarCajaOpen] = useState(false);
  const [cierresOpen, setCierresOpen] = useState(false);
  const [vistaAliados, setVistaAliados] = useState(false);
  const [vistaCuentas, setVistaCuentas] = useState(false);
  // LA ESMERALDA ALI: dos vistas propias de pérdida (con botón Volver).
  const [vistaPerdidaCuenta, setVistaPerdidaCuenta] = useState(false);
  const [vistaPerdidaCuadro, setVistaPerdidaCuadro] = useState(false);
  const esEsmeralda = centro === 'LA ESMERALDA ALI';
  // La tarjeta de Nómina se muestra solo en los centros que manejan nómina como
  // concepto propio (La Esperanza y Los Pijiguaos); el resto la pliega en Gastos.
  const muestraNomina = centro === 'LA ESPERANZA' || centro === 'LOS PIJIGUAOS';
  // Switch «Listar movimientos»: oculto por defecto. Apagado = solo tarjetas + Resumen/Categorías;
  // encendido = se muestra la lista de movimientos y el botón de agregar movimiento.
  const [listarMovs, setListarMovs] = useState(false);
  // Resumen único que alimenta TODAS las tarjetas (misma fuente que la tabla de movimientos).
  const [resumen, setResumen] = useState<ResumenAcopio>({ saldoKg: 0, tasa: 0, usdEntregado: 0, saldoUsd: 0, gastos: 0, nominas: 0, facturado: 0, trasladoCaja: 0 });
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
      listProductos(), listCajas(centro),
    ]);
    setProductos(ps);
    setCajas(cjs);
  }, [centro]);

  useEffect(() => {
    let cancel = false;
    reload().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'Error al cargar', 'error'); });
    return () => { cancel = true; };
  }, [reload]);
  useRealtime(['acopio_recepciones', 'acopio_recepcion_lotes', 'acopio_caja_movimientos', 'acopio_clasificaciones', 'acopio_cajas', 'acopio_costo_clases', 'acopio_cuadres', 'acopio_cuadre_movimientos', 'acopio_resumen_semanal', 'cajas', 'productos', 'existencias'], reload);

  // Caja a la que se asocian los movimientos nuevos (la ACTUALMENTE ABIERTA).
  const cajaActual = useMemo(() => cajas.find((c) => c.estado === 'abierta') ?? cajas[0] ?? null, [cajas]);

  // Vista «Aliados» (en PERAMANAL ENDER MEJIAS se titula «Compra de ORO»): pantalla propia.
  if (vistaAliados) {
    return <AliadosVista canWrite={canWrite} actor={actor} actorName={actorName} centro={centro} onVolver={() => setVistaAliados(false)} />;
  }
  // Vista «Cuentas por Cobrar»: pantalla propia dentro del módulo (con su botón Volver).
  if (vistaCuentas) {
    return <CuentasCobrarView canWrite={canWrite} actor={actor} actorName={actorName} centro={centro} onVolver={() => setVistaCuentas(false)} />;
  }
  // LA ESMERALDA ALI · vistas de pérdida (con botón Volver).
  if (vistaPerdidaCuenta) {
    return <CuentaPerdidaAliView centro={centro} canWrite={canWrite} onVolver={() => setVistaPerdidaCuenta(false)} />;
  }
  if (vistaPerdidaCuadro) {
    return <CuadroResumenPerdidaView centro={centro} canWrite={canWrite} onVolver={() => setVistaPerdidaCuadro(false)} />;
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🏭 Centro de Costo {centro}</h1>
          <p className="hint muted">Control de recepción de mineral por centro de acopio. Al cerrar una recepción, el mineral recibido suma stock al inventario.</p>
        </div>
      </div>

      {/* Inbox: dinero que llega del sistema externo (traslado inter-sistema). Se acepta acá
          por separado de Tesorería; ambos módulos registran el mismo monto. */}
      <EntradasExternasAcopioPanel canWrite={canWrite} actor={actor} actorName={actorName} onChanged={reload} />

      {/* Botones + switch «Listar movimientos», debajo del título. Apagado = solo tarjetas;
          encendido = aparece la lista de movimientos y el botón para agregar uno nuevo. */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem', marginBottom: '1.25rem' }}>
        <button className="btn btn-ghost" onClick={() => setResumenCaja(true)}>📊 Resumen caja</button>
        <button className="btn btn-ghost" onClick={() => setCierresOpen(true)}>🗂 Cierres de caja</button>
        {canWrite && <button className="btn btn-ghost" onClick={() => setCerrarCajaOpen(true)}>🔒 Cerrar caja</button>}
        <button className="btn btn-ghost" onClick={() => setCategorias(true)}>🏷 Categorías</button>
        {centro !== 'GLOBAL MINERAL TIN' && !esEsmeralda && <button className="btn btn-ghost" onClick={() => setVistaAliados(true)}>{centro === 'PERAMANAL ENDER MEJIAS' ? '🪙 Compra de ORO' : '🤝 Aliados'}</button>}
        {centro === 'PERAMANAL ENDER MEJIAS' && <button className="btn btn-ghost" onClick={() => setVistaCuentas(true)}>📥 Cuentas por Cobrar</button>}
        {esEsmeralda && <button className="btn btn-ghost" onClick={() => setVistaPerdidaCuenta(true)}>📉 Cuenta de Pérdida con Alí</button>}
        {esEsmeralda && <button className="btn btn-ghost" onClick={() => setVistaPerdidaCuadro(true)}>🧾 Cuadro Resumen Pérdida Total</button>}
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
          <div className="muted" style={{ fontSize: '.72rem', marginTop: '.3rem' }}>{muestraNomina ? '(Facturado + Gastos + Nómina) ÷ Kg cerrados' : '(Facturado + Gastos) ÷ Kg cerrados'}</div>
        </div>
        <div className="card" style={{ borderColor: 'var(--success)' }}>
          <div className="card-title"><span>💵 USD entregados</span></div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--success)' }} className="mono">{money(resumen.usdEntregado)}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>suma de lo que entra (incluye el dinero recibido del otro sistema)</div>
        </div>
        <div className="card"><div className="card-title"><span>$Usd Facturados</span></div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-3)' }} className="mono">{money(resumen.facturado)}</div><div className="muted" style={{ fontSize: '.72rem' }}>sumatoria de toda la columna $Usd Facturados</div></div>
        <div className="card"><div className="card-title"><span>Saldo de caja</span></div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: resumen.saldoUsd < 0 ? 'var(--danger)' : undefined }} className="mono">{money(resumen.saldoUsd)}</div><div className="muted" style={{ fontSize: '.72rem' }}>saldo en moneda $ Usd (corrido)</div></div>
        <div className="card"><div className="card-title"><span>Saldo en Kg</span></div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: resumen.saldoKg < 0 ? 'var(--danger)' : undefined }} className="mono">{num(resumen.saldoKg)} Kg</div><div className="muted" style={{ fontSize: '.72rem' }}>saldo de casiterita (acumulado)</div></div>
        {/* Gastos = gastos + nómina (tarjeta unificada). */}
        <div className="card"><div className="card-title"><span>Gastos</span></div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--danger)' }} className="mono">{money((Number(resumen.gastos) || 0) + (Number(resumen.nominas) || 0))}</div><div className="muted" style={{ fontSize: '.72rem' }}>incluye la nómina</div></div>
        {/* Traspaso de Caja = Σ de la columna «Traspaso de Caja» del centro. */}
        <div className="card"><div className="card-title"><span>Traspaso de Caja</span></div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-3)' }} className="mono">{money(Number(resumen.trasladoCaja) || 0)}</div><div className="muted" style={{ fontSize: '.72rem' }}>sumatoria de la columna Traspaso de Caja</div></div>
      </div>

      {/* La vista se mantiene montada (oculta cuando el switch está apagado) para que sus
          cálculos sigan alimentando las tarjetas de arriba vía onResumen. */}
      <MovimientosAcopioView onResumen={onResumenAcopio} visible={listarMovs} centro={centro} cajaId={cajaActual?.id ?? null} />

      {categorias && <CategoriasModal canWrite={canWrite} onClose={() => setCategorias(false)} />}

      {resumenCaja && <ResumenCajaModal defaultEmail={user?.email ?? ''} centro={centro} cajaId={cajaActual?.id ?? null} onClose={() => setResumenCaja(false)} />}

      {cierresOpen && <CierresCajaModal centro={centro} cajaActualId={cajaActual?.id ?? null} onClose={() => setCierresOpen(false)} />}

      {cerrarCajaOpen && (
        <CerrarCajaModal
          centro={centro}
          cajaActual={cajaActual}
          resumen={resumen}
          actor={actor}
          actorName={actorName}
          onClose={() => setCerrarCajaOpen(false)}
          onDone={async () => { setCerrarCajaOpen(false); await reload(); }}
        />
      )}

      {movAcopio && (
        <AgregarMovimientoModal
          cajaActual={cajaActual}
          actor={actor}
          actorName={actorName}
          centro={centro}
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
          centro={centro}
          onClose={() => { setNuevo(false); setEditar(null); }}
          onSaved={async () => { setNuevo(false); setEditar(null); await reload(); }}
        />
      )}
    </div>
  );
}

/**
 * Inbox del Centro de Acopio: transferencias de dinero que llegan del sistema externo
 * (puente inter-sistema). Se aceptan acá POR SEPARADO de Tesorería; cada módulo registra
 * el MISMO monto (Tesorería en su caja; el acopio como «USD entregados» del centro socio).
 */
function EntradasExternasAcopioPanel({ canWrite, actor, actorName, onChanged }: {
  canWrite: boolean; actor: string; actorName: string | null; onChanged: () => void | Promise<void>;
}) {
  const [entrantes, setEntrantes] = useState<TransferenciaInter[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const cargar = useCallback(() => {
    listEntrantesAcopioPorConfirmar().then(setEntrantes).catch(() => setEntrantes([]));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['transferencias_inter'], cargar);

  async function aceptar(t: TransferenciaInter) {
    setBusy(t.id);
    try {
      await aceptarEntradaEnCajaAcopio({ row: t, actor, actorName });
      toast(`Dinero de ${t.empresa_origen} registrado en ${CENTRO_ACOPIO_EXTERNO}`, 'success');
      cargar();
      await onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo aceptar', 'error'); }
    finally { setBusy(null); }
  }

  if (!entrantes.length) return null;
  return (
    <div className="card" style={{ marginBottom: '1.25rem', borderColor: 'var(--brand, #ff8a00)' }}>
      <div className="card-title" style={{ marginBottom: '.5rem' }}>🔗 Dinero recibido del sistema externo · por aceptar en el acopio</div>
      <div className="muted" style={{ fontSize: '.76rem', marginBottom: '.4rem' }}>
        Entra como <strong>USD entregados</strong> al centro <strong>{CENTRO_ACOPIO_EXTERNO}</strong>. Tesorería lo acepta por su lado (el mismo monto).
      </div>
      <div style={{ display: 'grid', gap: '.45rem' }}>
        {entrantes.map((t) => (
          <div key={t.id} className="card" style={{ margin: 0, padding: '.55rem .7rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.5rem' }}>
            <div style={{ flex: '1 1 240px', fontSize: '.85rem' }}>
              <strong>De {t.empresa_origen}</strong> · <span className="mono">{t.resumen}</span>
              {t.motivo ? <span className="muted"> · {t.motivo}</span> : null}
              <div className="muted" style={{ fontSize: '.72rem' }}>{date(t.created_at)}</div>
            </div>
            {canWrite && (
              <button className="btn btn-sm btn-primary" disabled={busy === t.id} onClick={() => aceptar(t)}>
                {busy === t.id ? 'Aceptando…' : '✓ Aceptar en el acopio'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sub-módulo «GLOBAL MINERAL TIN»: el mismo módulo de acopio, parametrizado por centro. */
export function GlobalMineralTinPage() {
  return <AcopioModulo centro="GLOBAL MINERAL TIN" />;
}

export function PeramanalEnderPage() {
  return <AcopioModulo centro="PERAMANAL ENDER MEJIAS" />;
}

/** Sub-módulo «LA ESMERALDA ALI»: mismo módulo de acopio, parametrizado por centro. */
export function EsmeraldaAliPage() {
  return <AcopioModulo centro="LA ESMERALDA ALI" />;
}

/** Sub-módulo «LOS PIJIGUAOS»: mismo módulo de acopio (como La Esperanza), por centro. */
export function PijiguaosPage() {
  return <AcopioModulo centro="LOS PIJIGUAOS" />;
}

/* ───────────── Agregar movimiento de caja (acopio) ───────────── */

function AgregarMovimientoModal({ cajaActual, actor, actorName, centro, onClose, onSaved }: {
  cajaActual: CajaCierre | null;
  actor: string;
  actorName: string | null;
  centro: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fecha, setFecha] = useState(hoyISO());
  // Entrada de caja / $Usd entregado (grupo «movimientos de caja»).
  const [usdEntregado, setUsdEntregado] = useState('');
  const [usdCat, setUsdCat] = useState('');
  const [descUsd, setDescUsd] = useState('');
  const [gastos, setGastos] = useState('');
  const [gastoCat, setGastoCat] = useState('');
  const [gastoVehiculo, setGastoVehiculo] = useState(''); // vehículo imputado (solo categorías de REPUESTOS-REPARACIONES-SERVICIOS)
  const [vehiculos, setVehiculos] = useState<{ value: string; label: string }[]>([]);
  const [descGastos, setDescGastos] = useState('');
  const [compraMaterial, setCompraMaterial] = useState('');
  const [descCompra, setDescCompra] = useState('');
  const [traslado, setTraslado] = useState('');
  const [descTraslado, setDescTraslado] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [destinos, setDestinos] = useState<DestinoTraslado[]>([]);
  const [gestionarDestinos, setGestionarDestinos] = useState(false);
  const [kgRecibidos, setKgRecibidos] = useState('');
  const [descKg, setDescKg] = useState('');
  const [cats, setCats] = useState<ClasificacionAcopio[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listClasificacionesAll().then(setCats).catch(() => setCats([])); }, []);
  const cargarDestinos = useCallback(() => { listDestinosTraslado(centro).then(setDestinos).catch(() => setDestinos([])); }, [centro]);
  useEffect(() => { cargarDestinos(); }, [cargarDestinos]);
  const destinosActivos = useMemo(() => destinos.filter((d) => d.activo), [destinos]);
  // Equipos/maquinaria del módulo de Combustible: alimentan el buscador cuando el gasto va anclado a un vehículo.
  useEffect(() => {
    listVehiculos()
      .then((vs) => setVehiculos(vs.filter((v) => v.estado === 'activo').map((v) => ({ value: v.nombre, label: v.nombre }))))
      .catch(() => setVehiculos([]));
  }, []);
  const gastosCats = useMemo(() => cats.filter((c) => c.grupo === 'gastos_caja' && c.activo), [cats]);
  const movCajaCats = useMemo(() => cats.filter((c) => c.grupo === 'movimientos_caja' && c.activo), [cats]);
  const gastoEsVehiculo = esClasifVehiculo(gastoCat);

  // Redondeo a 2 decimales para los montos en $.
  const r2 = (s: string) => Math.round((Number(s) || 0) * 100) / 100;

  async function guardar() {
    setError(null);
    const usd = r2(usdEntregado), gas = r2(gastos), tras = r2(traslado), cmat = r2(compraMaterial);
    const kg = Number(kgRecibidos) || 0;
    if (usd <= 0 && gas <= 0 && tras <= 0 && cmat <= 0 && kg <= 0) { setError('Ingresá al menos un monto.'); return; }
    if (usd > 0 && !usdCat) { setError('Elegí la categoría de la entrada (movimientos de caja).'); return; }
    if (gas > 0 && !gastoCat) { setError('Elegí la categoría del gasto.'); return; }
    const destino = destinosActivos.find((d) => d.id === destinoId) ?? null;
    if (tras > 0 && !destino) { setError('Elegí el destino del traslado de caja.'); return; }
    setSaving(true);
    try {
      const cajaId = cajaActual?.id ?? null;
      // Una fila por concepto: así cada monto conserva su categoría y la distribución
      // por grupo (Gastos/Nómina/Traslado) queda correcta.
      const filas: CajaMovimientoInput[] = [];
      if (usd > 0) filas.push({ fecha, usd_entregado: usd, clasif_grupo: 'movimientos_caja', clasif_valor: usdCat, descripcion: descUsd.trim() || usdCat, caja_id: cajaId });
      if (gas > 0) filas.push({ fecha, gastos: gas, clasif_grupo: 'gastos_caja', clasif_valor: gastoCat, vehiculo: gastoEsVehiculo ? (gastoVehiculo.trim() || null) : null, descripcion: descGastos.trim() || gastoCat, caja_id: cajaId });
      if (cmat > 0) filas.push({ fecha, compra_material: cmat, descripcion: descCompra.trim() || 'Compra de material', caja_id: cajaId });
      if (kg > 0) filas.push({ fecha, kg_recibidos: kg, descripcion: descKg.trim() || 'Kg recibidos por MGG', caja_id: cajaId });
      for (const f of filas) await crearMovimientoCaja(f, actor, actorName);
      // El traslado va por el orquestador: baja la caja general y refleja el monto
      // en el destino (aliado interno = $Usd entregado · externo = puente inter-sistema).
      if (tras > 0 && destino) {
        await ejecutarTrasladoAcopio({ destino, fecha, monto: tras, descripcion: descTraslado.trim() || null, cajaId }, actor, actorName);
      }
      const total = filas.length + (tras > 0 ? 1 : 0);
      toast(`${total} movimiento(s) registrado(s)`, 'success');
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
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
        Caja: <strong>{cajaActual ? `${cajaActual.numero}${cajaActual.nombre ? ` · ${cajaActual.nombre}` : ''}` : '—'}</strong>. Completá los campos que apliquen; cada concepto se registra como un movimiento.
      </p>

      <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>

      {/* Entrada de caja / $Usd entregado: monto + categoría (movimientos de caja) + descripción */}
      <div className="form-grid">
        {campoUsd('$ USD entregado', usdEntregado, setUsdEntregado)}
        <div className="form-row">
          <label>Categoría de la entrada {(Number(usdEntregado) || 0) > 0 && <span style={{ color: 'var(--danger)' }}>*</span>}</label>
          <select className="select" value={usdCat} onChange={(e) => setUsdCat(e.target.value)}>
            <option value="">— movimientos de caja —</option>
            {movCajaCats.map((c) => <option key={c.id} value={c.valor}>{c.valor}</option>)}
          </select>
        </div>
      </div>
      {campoDesc(descUsd, setDescUsd, 'Descripción de la entrada (ej.: ENTRADA DE CAJA…)')}

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

      {/* Compra de material: monto que ingresa el usuario (egreso · baja el Saldo $) */}
      <div className="form-grid">
        {campoUsd('$ Compra Material', compraMaterial, setCompraMaterial)}
        <div className="form-row" style={{ display: 'flex', alignItems: 'flex-end' }}>
          <small className="muted">Egreso por compra de material: baja el Saldo $ de la caja (no afecta el Saldo en Kg).</small>
        </div>
      </div>
      {campoDesc(descCompra, setDescCompra, 'Descripción de la compra de material')}

      {/* Traslado: monto + destino (catálogo) + descripción opcional */}
      <div className="form-grid">
        {campoUsd('$ Traslado de Caja', traslado, setTraslado)}
        <div className="form-row">
          <label>Destino {(Number(traslado) || 0) > 0 && <span style={{ color: 'var(--danger)' }}>*</span>}</label>
          <select className="select" value={destinoId} onChange={(e) => {
            const id = e.target.value;
            setDestinoId(id);
            // La descripción del traslado se autollena como «CENTRO DE ACOPIO - {destino}».
            const d = destinosActivos.find((x) => x.id === id);
            setDescTraslado(d ? `CENTRO DE ACOPIO - ${d.nombre}` : '');
          }}>
            <option value="">— elegí el destino —</option>
            {destinosActivos.map((d) => (
              <option key={d.id} value={d.id}>{d.nombre}{d.tipo === 'externo' ? ' · otro sistema' : ''}</option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.35rem' }} onClick={() => setGestionarDestinos(true)}>⚙ Gestionar destinos</button>
        </div>
      </div>
      {(() => {
        const d = destinosActivos.find((x) => x.id === destinoId);
        if (!d) return null;
        return (
          <small className="muted" style={{ display: 'block', marginTop: '-.3rem', marginBottom: '.2rem' }}>
            {d.tipo === 'externo'
              ? `Sale por el puente inter-sistema a «${d.nombre}»; el otro sistema lo confirma. El traslado baja el saldo de esta caja.`
              : `Entra como $Usd ENTREGADO en el aliado «${d.nombre}» (directo, sin confirmación). El traslado baja el saldo de esta caja.`}
          </small>
        );
      })()}
      {campoDesc(descTraslado, setDescTraslado, 'Descripción del traslado (opcional)')}

      {/* Kg recibidos por MGG: cantidad + descripción */}
      <div className="form-grid">
        <div className="form-row">
          <label>Kg Recibidos por MGG</label>
          <input className="input mono" type="number" min={0} step="any" value={kgRecibidos} onChange={(e) => setKgRecibidos(e.target.value)} placeholder="0" />
          <small className="muted">Expresado en Kg.</small>
        </div>
        {campoDesc(descKg, setDescKg, 'Kg recibidos por MGG')}
      </div>

      {gestionarDestinos && (
        <DestinosTrasladoModal actor={actor} centro={centro} onClose={() => setGestionarDestinos(false)} onChanged={cargarDestinos} />
      )}
    </Modal>
  );
}

/* ───────────── Gestión del catálogo de destinos de traslado ───────────── */

function DestinosTrasladoModal({ actor, centro, onClose, onChanged }: {
  actor: string; centro: string; onClose: () => void; onChanged: () => void;
}) {
  const [destinos, setDestinos] = useState<DestinoTraslado[]>([]);
  const [aliados, setAliados] = useState<AliadoAcopio[]>([]);
  const [cajasExt, setCajasExt] = useState<CajaEspejo[]>([]);
  const [edit, setEdit] = useState<DestinoTraslado | 'nuevo' | null>(null);

  const cargar = useCallback(() => {
    listDestinosTraslado(centro).then(setDestinos).catch(() => setDestinos([]));
  }, [centro]);
  useEffect(() => {
    cargar();
    listAliados(centro).then(setAliados).catch(() => setAliados([]));
    listCajasExternas().then(setCajasExt).catch(() => setCajasExt([]));
  }, [cargar, centro]);

  async function toggle(d: DestinoTraslado) {
    try { await setDestinoTrasladoActivo(d.id, !d.activo); cargar(); onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }
  async function borrar(d: DestinoTraslado) {
    if (!window.confirm(`¿Eliminar el destino «${d.nombre}»? (no afecta traslados ya hechos)`)) return;
    try { await eliminarDestinoTraslado(d.id); toast('Destino eliminado', 'success'); cargar(); onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <Modal title="⚙ Destinos de traslado" size="lg" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button className="btn btn-primary" onClick={() => setEdit('nuevo')}>+ Nuevo destino</button></>
    }>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
        A dónde puede ir el dinero de un «Traslado de caja». Interno = entra como $Usd entregado en un aliado de este sistema. Externo = se envía por el puente a otro sistema (lo confirman allá).
      </p>
      {!destinos.length ? <p className="hint muted">Sin destinos.</p> : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Vinculado a</th><th></th></tr></thead>
            <tbody>
              {destinos.map((d) => {
                const al = aliados.find((a) => a.id === d.aliado_id);
                const cx = cajasExt.find((c) => c.id === d.caja_externa_id);
                return (
                  <tr key={d.id} style={{ opacity: d.activo ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 600 }}>{d.nombre} {!d.activo && <span className="badge" style={{ fontSize: '.6rem' }}>inactivo</span>}</td>
                    <td>{d.tipo === 'externo' ? '🌐 Otro sistema' : '🤝 Aliado interno'}</td>
                    <td className="muted">{d.tipo === 'externo' ? (cx?.nombre ?? d.empresa_codigo ?? '—') : (al?.nombre ?? '—')}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEdit(d)}>✎</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => void toggle(d)}>{d.activo ? 'Desactivar' : 'Activar'}</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => void borrar(d)}>🗑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <DestinoTrasladoForm destino={edit === 'nuevo' ? null : edit} aliados={aliados} cajasExt={cajasExt} actor={actor} centro={centro}
          onClose={() => setEdit(null)} onSaved={() => { setEdit(null); cargar(); onChanged(); }} />
      )}
    </Modal>
  );
}

function DestinoTrasladoForm({ destino, aliados, cajasExt, actor, centro, onClose, onSaved }: {
  destino: DestinoTraslado | null; aliados: AliadoAcopio[]; cajasExt: CajaEspejo[];
  actor: string; centro: string; onClose: () => void; onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(destino?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoDestinoTraslado>(destino?.tipo ?? 'aliado_interno');
  const [aliadoId, setAliadoId] = useState(destino?.aliado_id ?? '');
  const [cajaExtId, setCajaExtId] = useState(destino?.caja_externa_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    const cx = cajasExt.find((c) => c.id === cajaExtId);
    const input: DestinoTrasladoInput = {
      nombre, tipo,
      aliadoId: tipo === 'aliado_interno' ? (aliadoId || null) : null,
      cajaExternaId: tipo === 'externo' ? (cajaExtId || null) : null,
      empresaCodigo: tipo === 'externo' ? (cx?.empresa_codigo ?? null) : null,
      centroNombre: centro,
    };
    setSaving(true);
    try {
      if (destino) await actualizarDestinoTraslado(destino.id, input);
      else await crearDestinoTraslado(input, actor);
      toast('Destino guardado', 'success'); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={destino ? `Editar ${destino.nombre}` : 'Nuevo destino'} size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? '…' : 'Guardar'}</button></>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <div className="form-row"><label>Nombre</label><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus placeholder="Ej. JUAN BODEGA" /></div>
      <div className="form-row">
        <label>Tipo</label>
        <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDestinoTraslado)}>
          <option value="aliado_interno">🤝 Aliado interno (este sistema)</option>
          <option value="externo">🌐 Otro sistema (puente)</option>
        </select>
      </div>
      {tipo === 'aliado_interno' ? (
        <div className="form-row">
          <label>Aliado destino</label>
          <select className="select" value={aliadoId} onChange={(e) => setAliadoId(e.target.value)}>
            <option value="">— elegí el aliado —</option>
            {aliados.filter((a) => a.activo).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
          <small className="muted">El monto entra como $Usd entregado en su libro de movimientos.</small>
        </div>
      ) : (
        <div className="form-row">
          <label>Caja espejo del otro sistema</label>
          <select className="select" value={cajaExtId} onChange={(e) => setCajaExtId(e.target.value)}>
            <option value="">— elegí la caja externa —</option>
            {cajasExt.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.empresa_codigo ? ` · ${c.empresa_codigo}` : ''}</option>)}
          </select>
          <small className="muted">Se envía por el puente inter-sistema; el otro sistema lo confirma.</small>
        </div>
      )}
    </Modal>
  );
}

/* ───────────── Cerrar caja (cierre + apertura automática) ───────────── */

function CerrarCajaModal({ centro, cajaActual, resumen, actor, actorName, onClose, onDone }: {
  centro: string;
  cajaActual: CajaCierre | null;
  resumen: ResumenAcopio;
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numeroNueva, setNumeroNueva] = useState('');
  const [cerrarAliados, setCerrarAliados] = useState(true);
  const [arrastrarGastos, setArrastrarGastos] = useState(false);
  const [traerAliadosAlCentro, setTraerAliadosAlCentro] = useState(true);
  const [aliadosSaldo, setAliadosSaldo] = useState<Array<{ id: string; nombre: string; saldoKg: number; recibidos: number; gastos: number }>>([]);
  const [aliadosSel, setAliadosSel] = useState<Set<string>>(new Set());
  const saldoUsd = Math.round((Number(resumen.saldoUsd) || 0) * 100) / 100;
  const saldoKg = Math.round((Number(resumen.saldoKg) || 0) * 100) / 100;
  const tasa = Number(resumen.tasa) || 0;

  // Aliados del centro que tienen saldo de casiterita > 0 (se cerrarán junto con la caja).
  useEffect(() => {
    let vivo = true;
    import('./subledgers.repository')
      .then(({ listAliadosConResumen }) => listAliadosConResumen(centro))
      .then((rs) => {
        if (!vivo) return;
        const conSaldo = rs.filter((r) => (Number(r.resumen.saldoKg) || 0) > 0).map((r) => ({ id: r.aliado.id, nombre: r.aliado.nombre, saldoKg: Number(r.resumen.saldoKg) || 0, recibidos: Number(r.resumen.totalKgRecibidos) || 0, gastos: Number(r.resumen.totalGastos) || 0 }));
        setAliadosSaldo(conSaldo);
        setAliadosSel(new Set(conSaldo.map((a) => a.id)));   // todos seleccionados por defecto
      })
      .catch(() => { /* RLS/red */ });
    return () => { vivo = false; };
  }, [centro]);
  const gastosAliados = aliadosSaldo.reduce((a, x) => a + (aliadosSel.has(x.id) ? x.gastos : 0), 0);

  // Sugerencia incremental para el número de la caja nueva (editable la 1ª vez).
  useEffect(() => {
    let vivo = true;
    siguienteNumeroCaja(centro).then((n) => { if (vivo) setNumeroNueva(n); }).catch(() => {});
    return () => { vivo = false; };
  }, [centro]);

  async function confirmar() {
    setSaving(true); setError(null);
    try {
      const res = await cerrarYAbrirCaja({ centro, actor, actorName, numeroNueva: numeroNueva.trim() || null, cerrarAliados, arrastrarGastos, traerAliadosAlCentro, aliadosSel: Array.from(aliadosSel) });
      notify(`Caja ${res.cajaCerrada.numero} cerrada · nueva ${res.cajaNueva.numero} abierta${res.aliadosCerrados ? ` · ${res.aliadosCerrados} aliado(s) cerrados` : ''}`, 'success', { link: '#/app/acopio' });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cerrar la caja.'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={() => void confirmar()} disabled={saving || !cajaActual}>{saving ? 'Cerrando…' : '🔒 Cerrar y abrir nueva'}</button>
    </>
  );

  return (
    <Modal title={`🔒 Cerrar caja · ${centro}`} size="md" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      {!cajaActual ? (
        <p className="hint muted" style={{ margin: 0 }}>No hay una caja abierta para cerrar.</p>
      ) : (
        <>
          <p className="hint muted" style={{ marginTop: 0, fontSize: '.84rem' }}>
            Se cerrará <strong>{cajaActual.numero}</strong> ({date(cajaActual.fecha_inicio)} → hoy) y se abrirá una nueva automáticamente.
          </p>
          <div className="form-row" style={{ marginBottom: '.6rem' }}>
            <label>Número de la caja nueva</label>
            <input className="input" value={numeroNueva} onChange={(e) => setNumeroNueva(e.target.value)} placeholder="Caja #1" disabled={saving} />
            <small className="muted" style={{ fontSize: '.74rem' }}>Podés ajustarlo la primera vez; luego se autoincrementa solo.</small>
          </div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.84rem' }}>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600 }}>Saldo en $ → apertura de la nueva caja</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: saldoUsd < 0 ? 'var(--danger)' : 'var(--primary-3)' }}>{money(saldoUsd)}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Saldo en Kg → Recepciones (casiterita)</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(saldoKg)} Kg</td>
                </tr>
                {saldoKg > 0 && (
                  <>
                    <tr><td className="muted">Procedencia</td><td className="mono" style={{ textAlign: 'right' }}>{centro.toUpperCase()}</td></tr>
                    <tr><td className="muted">Tasa del material</td><td className="mono" style={{ textAlign: 'right' }}>{money(tasa)}/Kg</td></tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
          <p className="hint muted" style={{ fontSize: '.76rem', marginBottom: 0 }}>
            {saldoKg > 0
              ? `Los ${num(saldoKg)} Kg pasan al módulo RECEPCIONES (procedencia «${centro.toUpperCase()}»); NO entran al inventario todavía. El saldo en $ arranca la caja nueva como «$ entregados»; lo demás se reinicia.`
              : 'No hay saldo de Kg para enviar a Recepciones. El saldo en $ arranca la caja nueva como «$ entregados»; lo demás se reinicia.'}
          </p>

          {/* Cierre de ALIADOS junto con la caja del centro */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.7rem', fontSize: '.86rem', fontWeight: 600, cursor: 'pointer' }}>
            <input type="checkbox" checked={cerrarAliados} onChange={(e) => setCerrarAliados(e.target.checked)} disabled={saving} style={{ width: 17, height: 17, accentColor: 'var(--primary)' }} />
            Cerrar también los aliados con saldo de casiterita <span className="muted" style={{ fontWeight: 400 }}>({aliadosSaldo.length})</span>
          </label>
          {cerrarAliados && aliadosSaldo.length > 0 && (
            <div style={{ marginTop: '.4rem', border: '1px solid var(--border)', borderRadius: 8, padding: '.45rem .6rem', fontSize: '.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', marginBottom: '.3rem' }}>
                <span className="muted" style={{ fontSize: '.74rem' }}>Tildá cuáles se toman para la recepción</span>
                <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .4rem', fontSize: '.72rem' }} disabled={saving}
                  onClick={() => setAliadosSel((prev) => prev.size === aliadosSaldo.length ? new Set() : new Set(aliadosSaldo.map((a) => a.id)))}>
                  {aliadosSel.size === aliadosSaldo.length ? 'Ninguno' : 'Todos'}
                </button>
              </div>
              {aliadosSaldo.map((a) => (
                <label key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'center', cursor: 'pointer', padding: '.12rem 0' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem', overflow: 'hidden' }}>
                    <input type="checkbox" checked={aliadosSel.has(a.id)} disabled={saving}
                      onChange={(e) => setAliadosSel((prev) => { const n = new Set(prev); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })}
                      style={{ width: 15, height: 15, accentColor: 'var(--primary)', flex: '0 0 auto' }} />
                    <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nombre}</span>
                  </span>
                  <span className="mono" style={{ whiteSpace: 'nowrap', opacity: aliadosSel.has(a.id) ? 1 : .45 }} title="Kg recibidos por MGG (lo que entra a la recepción)">{num(a.recibidos)} Kg{a.gastos > 0 ? ` · gastos ${money(a.gastos)}` : ''}</span>
                </label>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.45rem', paddingTop: '.4rem', borderTop: '1px solid var(--border)', fontSize: '.82rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={arrastrarGastos} onChange={(e) => setArrastrarGastos(e.target.checked)} disabled={saving} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                Arrastrar los gastos de los aliados a la recepción {gastosAliados > 0 ? <strong className="mono">({money(gastosAliados)})</strong> : ''}
              </label>
            </div>
          )}
          {cerrarAliados && aliadosSaldo.length === 0 && (
            <p className="hint muted" style={{ fontSize: '.76rem', margin: '.3rem 0 0' }}>Ningún aliado de este centro tiene saldo de casiterita pendiente.</p>
          )}

          {/* Traer los Kg recibidos de cada aliado como movimiento del centro de costo */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.7rem', fontSize: '.86rem', fontWeight: 600, cursor: 'pointer' }}>
            <input type="checkbox" checked={traerAliadosAlCentro} onChange={(e) => setTraerAliadosAlCentro(e.target.checked)} disabled={saving} style={{ width: 17, height: 17, accentColor: 'var(--primary)' }} />
            Traer los Kg de los aliados a los movimientos del centro de costo
          </label>
          <p className="hint muted" style={{ fontSize: '.76rem', margin: '.25rem 0 0' }}>
            Por cada aliado con Kg recibidos, agrega una fila <strong>«CENTRO DE ACOPIO … PARA LA RECEPCION»</strong> = Kg recibidos × su tasa (entrada+salida, neto $0; suma los Kg a la casiterita del centro). Destildá esto si NO querés esos movimientos en este cierre.
          </p>
        </>
      )}
    </Modal>
  );
}

/* ───────────── Historial de cierres de caja (buscable) ───────────── */

function CierresCajaModal({ centro, cajaActualId, onClose }: { centro: string; cajaActualId: string | null; onClose: () => void }) {
  const [cajas, setCajas] = useState<CajaCierre[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<CajaCierre | null>(null);
  const [movs, setMovs] = useState<CajaMovimiento[]>([]);
  const [cargandoMovs, setCargandoMovs] = useState(false);

  const cargar = useCallback(() => { listCajas(centro).then(setCajas).catch(() => setCajas([])); }, [centro]);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['acopio_cajas', 'acopio_caja_movimientos'], cargar);

  // Etiqueta «Cierre de caja de <inicio> a <fin>» (o «en curso» si sigue abierta).
  const etiqueta = (c: CajaCierre) => `${c.numero} · ${date(c.fecha_inicio)} → ${c.fecha_fin ? date(c.fecha_fin) : 'en curso'}`;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filtradas = useMemo(() => {
    const t = norm(q.trim());
    if (!t) return cajas;
    return cajas.filter((c) => norm(`${etiqueta(c)} ${c.nombre ?? ''} ${c.recepcion ?? ''}`).includes(t));
  }, [cajas, q]);

  function abrir(c: CajaCierre) {
    setSel(c); setCargandoMovs(true); setMovs([]);
    listCajaMovimientos(c.id).then(setMovs).catch(() => setMovs([])).finally(() => setCargandoMovs(false));
  }

  return (
    <Modal title={`🗂 Cierres de caja · ${centro}`} size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      {!sel ? (
        <>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar cierre (fecha, número, recepción…)" style={{ marginBottom: '.6rem' }} />
          {!filtradas.length ? (
            <p className="hint muted" style={{ margin: 0 }}>Sin cierres registrados.</p>
          ) : (
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.84rem' }}>
                <thead><tr><th>Caja / período</th><th>Estado</th><th style={{ textAlign: 'right' }}>Saldo final</th><th></th></tr></thead>
                <tbody>
                  {filtradas.map((c) => (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => abrir(c)} title="Ver los movimientos de este período">
                      <td style={{ fontWeight: 600 }}>{etiqueta(c)}{c.id === cajaActualId && <span className="badge" style={{ marginLeft: '.4rem', fontSize: '.62rem' }}>actual</span>}</td>
                      <td>{c.estado === 'cerrada' ? '🔒 Cerrada' : '● Abierta'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c.saldo_final != null ? money(Number(c.saldo_final)) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>›</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.6rem' }}>
            <strong>{etiqueta(sel)}</strong>
            <button className="btn btn-sm btn-ghost" onClick={() => { setSel(null); setMovs([]); }}>← Volver al listado</button>
          </div>
          {cargandoMovs ? (
            <p className="hint muted" style={{ margin: 0 }}>Cargando movimientos…</p>
          ) : !movs.length ? (
            <p className="hint muted" style={{ margin: 0 }}>Sin movimientos en este período.</p>
          ) : (
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.8rem' }}>
                <thead><tr>
                  <th>Fecha</th><th>Descripción</th>
                  <th style={{ textAlign: 'right' }}>$ Entregado</th><th style={{ textAlign: 'right' }}>Kg Cerr.</th>
                  <th style={{ textAlign: 'right' }}>Gastos</th><th style={{ textAlign: 'right' }}>Kg MGG</th>
                  <th style={{ textAlign: 'right' }}>Saldo $</th><th style={{ textAlign: 'right' }}>Saldo Kg</th>
                </tr></thead>
                <tbody>
                  {movs.map((m) => (
                    <tr key={m.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{date(m.fecha)}</td>
                      <td style={{ maxWidth: 240, whiteSpace: 'pre-wrap' }}>{m.descripcion || '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{m.usd_entregado ? money(m.usd_entregado) : ''}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{m.kg_cerrados ? num(m.kg_cerrados) : ''}</td>
                      <td className="mono" style={{ textAlign: 'right', color: ((Number(m.gastos) || 0) + (Number(m.nominas) || 0)) ? 'var(--danger)' : undefined }}>{((Number(m.gastos) || 0) + (Number(m.nominas) || 0)) ? money((Number(m.gastos) || 0) + (Number(m.nominas) || 0)) : ''}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{m.kg_recibidos ? num(m.kg_recibidos) : ''}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{money(m.saldo_usd ?? 0)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{num(m.saldo_kg ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* ───────────── Resumen de Caja (réplica de la hoja «RESUMEN CAJA PERAMANAL GT») ───────────── */

function ResumenCajaModal({ defaultEmail, centro, cajaId, onClose }: { defaultEmail: string; centro: string; cajaId?: string | null; onClose: () => void }) {
  const [r, setR] = useState<ResumenCajaAcopio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);
  const [correoOpen, setCorreoOpen] = useState(false);
  // Categoría de vehículo seleccionada para ver su consumo en $ por vehículo (gráfica).
  const [consumoCat, setConsumoCat] = useState<string | null>(null);
  // Categoría tocada para ver el DETALLE de sus movimientos (grupo + valor).
  const [detalleCat, setDetalleCat] = useState<{ grupo: GrupoClasificacion; valor: string } | null>(null);
  // Filtro por rango de fechas: el resumen se recalcula solo con los movimientos del rango.
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const hayRango = !!(desde || hasta);

  // Se recalcula desde los movimientos; en vivo cuando entra/cambia alguno (Realtime).
  const cargar = useCallback(() => {
    resumenCajaAcopio(cajaId ?? undefined, { desde: desde || null, hasta: hasta || null }, centro)
      .then(setR).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el resumen'));
  }, [desde, hasta, centro, cajaId]);
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
          try { const { descargarResumenCajaPdf } = await import('./resumenCajaPdf'); await descargarResumenCajaPdf(r); }
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

  const TablaCat = ({ titulo, filas, totalLabel, totalMonto, totalPct, color, grupo, onVerVehiculo, montoLabel = 'Monto', pctLabel = '% del total gastado' }: {
    titulo: string; filas: { valor: string; monto: number; pct: number }[]; totalLabel: string; totalMonto: number; totalPct: number; color: string;
    grupo: GrupoClasificacion;
    onVerVehiculo?: (valor: string) => void;
    montoLabel?: string; pctLabel?: string;
  }) => {
    // La barra de cada categoría es proporcional al MAYOR monto del grupo (la más alta llena la barra).
    const maxMonto = Math.max(1, ...filas.map((f) => f.monto));
    return (
    <>
      <div className="card-title" style={{ marginTop: '1rem' }}><span style={{ color }}>{titulo}</span></div>
      {!filas.length ? <p className="hint muted" style={{ margin: 0, fontSize: '.85rem' }}>Sin registros.</p> : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.8rem' }}>
            <thead><tr><th>Categoría</th><th style={{ width: '40%' }}></th><th style={{ textAlign: 'right', width: 150, whiteSpace: 'nowrap' }}>{montoLabel}</th><th style={{ textAlign: 'right', width: 120, whiteSpace: 'nowrap' }}>{pctLabel}</th></tr></thead>
            <tbody>
              {filas.map((c) => {
                const esVeh = !!onVerVehiculo && esClasifVehiculo(c.valor);
                const w = Math.max(2, (c.monto / maxMonto) * 100);
                return (
                // Toda la fila se toca para ver el DETALLE de sus movimientos.
                <tr key={c.valor} onClick={() => setDetalleCat({ grupo, valor: c.valor })}
                  style={{ cursor: 'pointer' }}
                  title="Ver el detalle de los movimientos de esta categoría">
                  <td>
                    {c.valor}
                    {esVeh && (
                      <button className="btn btn-sm btn-ghost" style={{ marginLeft: '.4rem', padding: '0 .3rem' }}
                        title="Ver consumo $ por vehículo"
                        onClick={(e) => { e.stopPropagation(); onVerVehiculo!(c.valor); }}>📊</button>
                    )}
                  </td>
                  <td style={{ minWidth: 120 }}>
                    <span style={{ display: 'block', height: 14, borderRadius: 7, background: 'var(--surface-2, rgba(255,255,255,.06))', overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${w}%`, height: '100%', background: color, borderRadius: 7 }} />
                    </span>
                  </td>
                  <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(c.monto)}</td>
                  <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{pct(c.pct)}</td>
                </tr>
                );
              })}
            </tbody>
            <tfoot><tr style={{ fontWeight: 700, borderTop: '2px solid var(--border, rgba(255,255,255,.15))' }}>
              <td>{totalLabel}</td>
              <td></td>
              <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(totalMonto)}</td>
              <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{pct(totalPct)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </>
    );
  };

  return (
    <Modal title={`📊 Resumen de Caja · ${centro}`} size="lg" onClose={onClose} footer={footer}>
      {error ? (
        <div className="card" style={{ borderColor: 'var(--danger)' }}><strong>Error:</strong> {error}</div>
      ) : !r ? (
        <p className="hint muted" style={{ margin: 0 }}>Cargando resumen…</p>
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
          {/* Bloque de cabecera «CERRADO · RESUMEN DE CAJA» — fiel a la hoja del Excel:
              Centro · Fecha de inicio · Última actualización · Días transcurridos · Saldo actual. */}
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-title"><span>🗂 Cerrado · Resumen de Caja · {centro}</span></div>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.84rem' }}>
                <tbody>
                  <tr><td style={{ fontWeight: 600, width: 280 }}>Centro de Costo</td><td>{centro}</td></tr>
                  {hayRango ? (
                    <tr><td style={{ fontWeight: 600 }}>Rango seleccionado</td><td className="mono">{desde || '—'} → {hasta || '—'}</td></tr>
                  ) : (
                    <>
                      <tr><td style={{ fontWeight: 600 }}>Fecha de inicio</td><td className="mono">{r.fechaInicio ?? '—'}</td></tr>
                      <tr><td style={{ fontWeight: 600 }}>Fecha última actualización</td><td className="mono">{r.fechaActualizacion}</td></tr>
                      <tr><td style={{ fontWeight: 600 }}>Días transcurridos</td><td className="mono">{r.dias}</td></tr>
                    </>
                  )}
                  <tr><td style={{ fontWeight: 600 }}>Movimientos</td><td className="mono">{r.movimientos}</td></tr>
                  <tr style={{ borderTop: '2px solid var(--border, rgba(255,255,255,.15))' }}>
                    <td style={{ fontWeight: 700 }}>Saldo actual de la caja {centro}</td>
                    <td className="mono" style={{ fontWeight: 800, color: r.saldoUsd < 0 ? 'var(--danger)' : 'var(--primary-3)' }}>{money(r.saldoUsd)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* KPIs principales */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.75rem' }}>
            <Kpi titulo="Saldo actual de la caja" valor={money(r.saldoUsd)} color={r.saldoUsd < 0 ? 'var(--danger)' : undefined} destacar />
            <Kpi titulo="Total entregado" valor={money(r.totalEntregado)} color="var(--success)" />
            <Kpi titulo="Total gastado" valor={money(r.totalGastado)} color="var(--danger)" />
            <Kpi titulo="Tasa del material" valor={`${money(r.tasaMaterial)} /Kg`} color="var(--primary-3)" />
          </div>

          {/* Kg de casiterita */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.75rem', marginTop: '1rem' }}>
            <Kpi titulo="Producción GT (entra)" valor={`${num(r.kgProduccion)} Kg`} color="var(--primary-3)" />
            <Kpi titulo="Enviados a MGG" valor={`${num(r.kgEnviados)} Kg`} />
            <Kpi titulo="Diferencia" valor={`${num(r.diferenciaKg)} Kg`} color={r.diferenciaKg < 0 ? 'var(--danger)' : 'var(--success)'} />
          </div>

          {/* CASITERITA por categoría (contratos): cantidad, facturado y precio promedio */}
          {r.casiteritaPorCategoria.length > 0 && (
            <>
              <div className="card-title" style={{ marginTop: '1rem' }}><span style={{ color: '#22c55e' }}>Casiterita por categoría</span></div>
              <div className="table-wrap">
                <table className="table" style={{ fontSize: '.8rem' }}>
                  <thead><tr><th>Categoría</th><th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Precio $/Kg</th><th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Cantidad cerrada (Kg)</th><th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Facturado $</th><th style={{ textAlign: 'right', width: 130, whiteSpace: 'nowrap' }}>% individual</th></tr></thead>
                  <tbody>
                    {r.casiteritaPorCategoria.map((c) => (
                      <tr key={c.valor} onClick={() => setDetalleCat({ grupo: 'contratos', valor: c.valor })} style={{ cursor: 'pointer' }} title="Ver el detalle de los movimientos de esta categoría">
                        <td>{c.valor}</td>
                        <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(c.precio)}</td>
                        <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{num(c.cantidad)}</td>
                        <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(c.facturado)}</td>
                        <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{pct(c.pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ fontWeight: 700, borderTop: '2px solid var(--border, rgba(255,255,255,.15))' }}>
                    <td>Total casiterita</td>
                    <td></td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{num(r.kgProduccion)}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(r.totalFacturado)}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{pct(1)}</td>
                  </tr></tfoot>
                </table>
              </div>
            </>
          )}

          <TablaCat titulo="Gastos por categoría (incluye nómina)" filas={r.gastosPorCategoria} totalLabel="Total gastos" totalMonto={r.totalGastado} totalPct={1} color="#ef4444" grupo="gastos_caja" onVerVehiculo={setConsumoCat} />
          <p className="hint muted" style={{ fontSize: '.74rem', marginTop: '.3rem' }}>💡 Tocá una <strong>categoría</strong> para ver el <strong>detalle de sus movimientos</strong>. En las de <strong>repuestos · reparaciones · servicios</strong>, el botón <strong>📊</strong> muestra el consumo en $ por vehículo. La <strong>nómina</strong> va incluida como una categoría más.</p>
          {/* MOVIMIENTOS DE CAJA por categoría: dinero entregado que entra a la caja */}
          <TablaCat titulo="Movimientos de caja por categoría" filas={r.movimientosPorCategoria} totalLabel="Total entregado" totalMonto={r.totalEntregado} totalPct={1} color="#3b82f6" grupo="movimientos_caja" montoLabel="Dinero entregado $" pctLabel="% del total entregado" />
        </>
      )}

      {consumoCat && (
        <ConsumoChartModal
          title={`📊 Consumo $ por vehículo · ${consumoCat}`}
          subtitle="Total gastado por vehículo/maquinaria en esta categoría (repuestos · reparaciones · servicios). Buscá un equipo por nombre."
          cargar={async (d, h) => {
            const filas = await consumoPorVehiculoAcopio(d, h, consumoCat, centro);
            return filas.map((f) => ({ id: f.id, label: f.nombre, unidad: 'compra(s)', cantidad: f.compras, valor: f.valor }));
          }}
          onClose={() => setConsumoCat(null)}
        />
      )}

      {detalleCat && (
        <DetalleCategoriaModal grupo={detalleCat.grupo} valor={detalleCat.valor} desde={desde || null} hasta={hasta || null} centro={centro} onClose={() => setDetalleCat(null)} />
      )}

      {correoOpen && r && (
        <CorreoReporteModal
          titulo={`Enviar Resumen de Caja · ${r.centro}`}
          descripcion={`Se enviará el PDF del resumen de caja al ${r.fechaActualizacion} (saldo ${money(r.saldoUsd)} · total gastado ${money(r.totalGastado)}).`}
          defaultEmail={defaultEmail}
          onEnviar={async (emails) => {
            const { enviarResumenCajaPorCorreo } = await import('./resumenCajaPdf');
            const { destinatarios } = await enviarResumenCajaPorCorreo(r, emails);
            return destinatarios;
          }}
          onClose={() => setCorreoOpen(false)}
        />
      )}
    </Modal>
  );
}

/* ───────────── Detalle de movimientos de una categoría (al tocarla en el resumen) ───────────── */

function DetalleCategoriaModal({ grupo, valor, desde, hasta, centro, onClose }: {
  grupo: GrupoClasificacion; valor: string; desde: string | null; hasta: string | null; centro: string; onClose: () => void;
}) {
  const [movs, setMovs] = useState<MovimientoCategoria[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listMovimientosCategoria(grupo, valor, { desde, hasta }, undefined, centro)
      .then(setMovs)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el detalle'));
  }, [grupo, valor, desde, hasta, centro]);
  const total = (movs ?? []).reduce((a, m) => a + m.monto, 0);
  const concepto = grupo === 'nomina' ? 'nómina'
    : grupo === 'movimientos_caja' ? 'dinero entregado'
    : grupo === 'contratos' ? 'casiterita facturada'
    : grupo === 'traslado' ? 'traslado'
    : 'gastos';
  return (
    <Modal title={`🧾 Detalle · ${valor}`} size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
        Movimientos de {concepto} en la categoría «{valor}»{(desde || hasta) ? ` · ${desde || '—'} → ${hasta || '—'}` : ''}.
      </p>
      {error ? (
        <div className="card" style={{ borderColor: 'var(--danger)' }}><strong>Error:</strong> {error}</div>
      ) : !movs ? (
        <p className="hint muted">Cargando…</p>
      ) : !movs.length ? (
        <p className="hint muted" style={{ margin: 0 }}>Sin movimientos en esta categoría.</p>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Fecha</th><th>Descripción</th><th>Vehículo</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
            <tbody>
              {movs.map((m) => (
                <tr key={m.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{date(m.fecha)}</td>
                  <td>{m.descripcion || '—'}</td>
                  <td>{m.vehiculo || '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(m.monto)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ fontWeight: 700, borderTop: '2px solid var(--border, rgba(255,255,255,.15))' }}>
              <td colSpan={3}>Total ({movs.length} mov.)</td>
              <td className="mono" style={{ textAlign: 'right' }}>{money(total)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* ───────────── Resumen Semanal Casiterita (REPORTE PRELIMINAR DE CENTROS DE ACOPIOS) ───────────── */

const fmtKg = (v: number) => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Página «Reporte Preliminar» (sub-menú de Cajas Centro de Acopio): el mismo
 *  Resumen Semanal Casiterita, pero como vista en lugar de modal. */
export function ReportePreliminarPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('acopio', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;
  return <ResumenSemanalModal asPage canWrite={canWrite} actor={actor} actorName={actorName} />;
}

function ResumenSemanalModal({ canWrite, actor, actorName, onClose, asPage }: {
  canWrite: boolean; actor: string; actorName: string | null; onClose?: () => void; asPage?: boolean;
}) {
  const hoy = hoyISO();
  const [tab, setTab] = useState<'editor' | 'historico'>('editor');
  const [titulo, setTitulo] = useState('REPORTE PRELIMINAR DE CENTROS DE ACOPIOS');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [sectores, setSectores] = useState<SectorResumen[]>(() => sectoresPorDefecto());
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historico, setHistorico] = useState<ResumenSemanal[]>([]);
  const [vinculando, setVinculando] = useState<{ si: number; ci: number; campo: 'cobrar' | 'disponible' } | null>(null);
  const [vinculandoSector, setVinculandoSector] = useState<{ si: number; campo: 'saldo' | 'precio' } | null>(null);
  const [resolviendo, setResolviendo] = useState(false);
  const [correoOpen, setCorreoOpen] = useState(false);
  const [borrar, setBorrar] = useState<ResumenSemanal | null>(null);

  const cargarHist = useCallback(() => { listResumenes().then(setHistorico).catch(() => setHistorico([])); }, []);
  useEffect(() => { cargarHist(); }, [cargarHist]);
  useRealtime(['acopio_resumen_semanal'], cargarHist);

  const totales = useMemo(() => computeTotales(sectores), [sectores]);

  // Mutadores inmutables sobre el árbol de sectores.
  const patchSector = (si: number, patch: Partial<SectorResumen>) =>
    setSectores((prev) => prev.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  const patchCentro = (si: number, ci: number, patch: Partial<{ centro: string; kg_cobrar: number; kg_disponible: number; fuente: FuenteExterna | null; fuente_cobrar: FuenteExterna | null }>) =>
    setSectores((prev) => prev.map((s, i) => i !== si ? s : {
      ...s, centros: s.centros.map((c, j) => (j === ci ? { ...c, ...patch } : c)),
    }));

  // Trae en vivo los valores de TODOS los centros vinculados a un sistema externo.
  const resolverVinculos = useCallback(async (silencioso = false) => {
    setResolviendo(true);
    let n = 0, fallidos = 0;
    const next = await Promise.all((sectores).map(async (s) => {
      const centros = await Promise.all(s.centros.map(async (c) => {
        let next = c;
        if (next.fuente) {
          try { const v = await leerMetricaExterna(next.fuente.sistema, next.fuente.metrica); n++; next = { ...next, kg_disponible: v }; }
          catch { fallidos++; }
        }
        if (next.fuente_cobrar) {
          try { const v = await leerMetricaExterna(next.fuente_cobrar.sistema, next.fuente_cobrar.metrica); n++; next = { ...next, kg_cobrar: v }; }
          catch { fallidos++; }
        }
        return next;
      }));
      let s2: SectorResumen = { ...s, centros };
      if (s.fuente_saldo) {
        try { const v = await leerMetricaExterna(s.fuente_saldo.sistema, s.fuente_saldo.metrica); n++; s2 = { ...s2, saldo_usd: v }; }
        catch { fallidos++; }
      }
      if (s.fuente_precio) {
        try { const v = await leerMetricaExterna(s.fuente_precio.sistema, s.fuente_precio.metrica); n++; s2 = { ...s2, precio_prom: v }; }
        catch { fallidos++; }
      }
      return s2;
    }));
    setSectores(next);
    setResolviendo(false);
    if (!silencioso) {
      if (fallidos) toast(`Vínculos: ${n} actualizado(s), ${fallidos} con error`, fallidos ? 'error' : 'success');
      else toast(`Vínculos actualizados (${n})`, 'success');
    }
    return { n, fallidos };
  }, [sectores]);

  // Al abrir el editor, resolvé los vínculos una vez (en silencio).
  const yaResolvio = useMemo(() => ({ done: false }), []);
  useEffect(() => {
    if (yaResolvio.done) return;
    const hay = sectores.some((s) => s.fuente_saldo || s.fuente_precio || s.centros.some((c) => c.fuente || c.fuente_cobrar));
    if (hay) { yaResolvio.done = true; void resolverVinculos(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const addCentro = (si: number) =>
    setSectores((prev) => prev.map((s, i) => i !== si ? s : { ...s, centros: [...s.centros, { centro: '', kg_cobrar: 0, kg_disponible: 0 }] }));
  const delCentro = (si: number, ci: number) =>
    setSectores((prev) => prev.map((s, i) => i !== si ? s : { ...s, centros: s.centros.filter((_, j) => j !== ci) }));
  const addSector = () =>
    setSectores((prev) => [...prev, { nombre: `SECTOR ${prev.length + 1}`, centros: [{ centro: '', kg_cobrar: 0, kg_disponible: 0 }], resguardos_gt: 0, precio_prom: 0, saldo_usd: 0, color: '#dbeafe' }]);
  const delSector = (si: number) => setSectores((prev) => prev.filter((_, i) => i !== si));

  // Input plano tipo "celda de planilla" (sin píldora) para que el grid se vea limpio.
  const cellInputStyle: React.CSSProperties = {
    width: '100%', minWidth: 76, background: 'var(--surface)', color: 'inherit',
    border: '1px solid var(--border)', borderRadius: 6, padding: '.28rem .45rem',
    fontVariantNumeric: 'tabular-nums',
  };
  const numInput = (val: number, on: (v: number) => void, ph = '0,00') => (
    <input className="mono" type="number" min={0} step="any" inputMode="decimal"
      value={val === 0 ? '' : val} placeholder={ph}
      onChange={(e) => on(Number(e.target.value) || 0)} disabled={!canWrite}
      style={{ ...cellInputStyle, textAlign: 'right' }} />
  );

  // Vincula la columna `campo` (cobrar/disponible) de un centro a una métrica y trae el valor al instante.
  async function vincular(si: number, ci: number, campo: 'cobrar' | 'disponible', m: FuenteExterna) {
    setVinculando(null);
    const fuente: FuenteExterna = { sistema: m.sistema, metrica: m.metrica, label: m.label };
    patchCentro(si, ci, campo === 'cobrar' ? { fuente_cobrar: fuente } : { fuente });
    try {
      const v = await leerMetricaExterna(m.sistema, m.metrica);
      patchCentro(si, ci, campo === 'cobrar' ? { kg_cobrar: v } : { kg_disponible: v });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo leer el dato vinculado', 'error'); }
  }

  // Ruta interna del centro al que apunta una fuente 'mgg…': cada centro/aliado lleva a
  // SU propia página (La Esperanza, GMT, Peramanal, Esmeralda ALÍ, Los Pijiguaos).
  const rutaCentroInterno = (fuente: FuenteExterna): string => rutaDeFuente(fuente);

  // Celda numérica vinculable (Kg por Cobrar / Kg Disponibles): si está vinculada muestra el
  // valor en vivo en solo-lectura (🔗, clickeable si es interno); si no, input editable + botón vincular.
  const vinculableCell = (si: number, c: SectorResumen['centros'][number], ci: number, campo: 'cobrar' | 'disponible') => {
    const eligiendo = vinculando?.si === si && vinculando?.ci === ci && vinculando?.campo === campo;
    const fuente = campo === 'cobrar' ? c.fuente_cobrar : c.fuente;
    const valor = campo === 'cobrar' ? c.kg_cobrar : c.kg_disponible;
    const color = campo === 'cobrar' ? '#60a5fa' : '#4ade80';
    const borderCol = campo === 'cobrar' ? 'rgba(96,165,250,.4)' : 'rgba(74,222,128,.4)';
    if (fuente) {
      // Interno = vive en ESTE sistema (acopio 'mgg' o un aliado 'mgg-…') → valor clickeable
      // que lleva al centro de acopio (La Esperanza). Externo (otro Supabase) queda sin enlace.
      const interno = fuente.sistema.startsWith('mgg');
      const rutaInterna = interno ? rutaCentroInterno(fuente) : null;
      const valStyle: React.CSSProperties = { ...cellInputStyle, width: 'auto', minWidth: 76, textAlign: 'right', background: 'var(--surface-2)', color, fontWeight: 700, borderColor: borderCol };
      const fuenteLabel = fuente.label ?? `${fuente.sistema} · ${fuente.metrica}`;
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem', justifyContent: 'flex-end' }} title={`Vinculado a ${fuenteLabel} — no editable`}>
          {rutaInterna ? (
            <a href={rutaInterna} className="mono" style={{ ...valStyle, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
              title="Ir a la página de este centro de acopio">{fmtKg(valor)}</a>
          ) : (
            <span className="mono" style={valStyle}>{fmtKg(valor)}</span>
          )}
          <span title={interno ? 'Valor interno en vivo · clic para ir a su centro de acopio' : 'Valor vinculado en vivo (otro sistema, no editable)'}>🔗</span>
          {canWrite && <button className="btn btn-sm btn-ghost" title="Desvincular (volver a editar a mano)" onClick={() => patchCentro(si, ci, campo === 'cobrar' ? { fuente_cobrar: null } : { fuente: null })}>✕</button>}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
        {numInput(valor, (v) => patchCentro(si, ci, campo === 'cobrar' ? { kg_cobrar: v } : { kg_disponible: v }))}
        {canWrite && !eligiendo && <button className="btn btn-sm btn-ghost" title="Vincular este dato a otro sistema / al acopio" onClick={() => setVinculando({ si, ci, campo })}>🔗</button>}
        {canWrite && eligiendo && (
          <select autoFocus className="select" style={{ fontSize: '.72rem', maxWidth: 200 }} defaultValue=""
            onChange={(e) => { const m = METRICAS_EXTERNAS.find((x) => `${x.sistema}|${x.metrica}` === e.target.value); if (m) void vincular(si, ci, campo, m); else setVinculando(null); }}
            onBlur={() => setVinculando(null)}>
            <option value="">— elegí la fuente —</option>
            {METRICAS_EXTERNAS.map((m) => <option key={`${m.sistema}|${m.metrica}`} value={`${m.sistema}|${m.metrica}`}>{m.label}</option>)}
          </select>
        )}
      </div>
    );
  };

  // Vincula la columna de SECTOR (saldo $USD / precio promedio) a una métrica en $.
  async function vincularSector(si: number, campo: 'saldo' | 'precio', m: FuenteExterna) {
    setVinculandoSector(null);
    const fuente: FuenteExterna = { sistema: m.sistema, metrica: m.metrica, label: m.label };
    patchSector(si, campo === 'saldo' ? { fuente_saldo: fuente } : { fuente_precio: fuente });
    try {
      const v = await leerMetricaExterna(m.sistema, m.metrica);
      patchSector(si, campo === 'saldo' ? { saldo_usd: v } : { precio_prom: v });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo leer el dato vinculado', 'error'); }
  }

  // Celda de SECTOR vinculable ($USD): saldo o precio promedio. Linkable a métricas en $
  // (saldo de caja / tasa del material) de ESTE sistema o de Golden Touch.
  const sectorCell = (si: number, s: SectorResumen, campo: 'saldo' | 'precio') => {
    const eligiendo = vinculandoSector?.si === si && vinculandoSector?.campo === campo;
    const fuente = campo === 'saldo' ? s.fuente_saldo : s.fuente_precio;
    const valor = campo === 'saldo' ? s.saldo_usd : s.precio_prom;
    const color = campo === 'saldo' ? '#4ade80' : '#fbbf24';
    if (fuente) {
      const interno = fuente.sistema.startsWith('mgg');
      const ruta = interno ? rutaCentroInterno(fuente) : null;
      const valStyle: React.CSSProperties = { ...cellInputStyle, width: 'auto', minWidth: 64, textAlign: 'right', background: 'var(--surface-3)', color, fontWeight: 800, borderColor: 'transparent' };
      const fuenteLabel = fuente.label ?? `${fuente.sistema} · ${fuente.metrica}`;
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.2rem', justifyContent: 'center' }} title={`Vinculado a ${fuenteLabel} — no editable`}>
          {ruta ? (
            <a href={ruta} className="mono" style={{ ...valStyle, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
              title="Ir a la página de este centro de acopio">{money(valor)}</a>
          ) : (
            <span className="mono" style={valStyle}>{money(valor)}</span>
          )}
          <span title={interno ? 'Valor interno en vivo · clic para ir a su centro de acopio' : 'Valor vinculado en vivo (Golden Touch, no editable)'}>🔗</span>
          {canWrite && <button className="btn btn-sm btn-ghost" title="Desvincular (volver a editar a mano)" onClick={() => patchSector(si, campo === 'saldo' ? { fuente_saldo: null } : { fuente_precio: null })}>✕</button>}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '.2rem', justifyContent: 'center' }}>
        {numInput(valor, (v) => patchSector(si, campo === 'saldo' ? { saldo_usd: v } : { precio_prom: v }), '$ 0,00')}
        {canWrite && !eligiendo && <button className="btn btn-sm btn-ghost" title="Vincular a saldo de caja / tasa (este sistema o Golden Touch)" onClick={() => setVinculandoSector({ si, campo })}>🔗</button>}
        {canWrite && eligiendo && (
          <select autoFocus className="select" style={{ fontSize: '.72rem', maxWidth: 200 }} defaultValue=""
            onChange={(e) => { const m = METRICAS_SECTOR.find((x) => `${x.sistema}|${x.metrica}` === e.target.value); if (m) void vincularSector(si, campo, m); else setVinculandoSector(null); }}
            onBlur={() => setVinculandoSector(null)}>
            <option value="">— elegí la fuente —</option>
            {METRICAS_SECTOR.map((m) => <option key={`${m.sistema}|${m.metrica}`} value={`${m.sistema}|${m.metrica}`}>{m.label}</option>)}
          </select>
        )}
      </div>
    );
  };

  async function archivar() {
    setError(null);
    const sinCentros = sectores.every((s) => s.centros.length === 0);
    if (!sectores.length || sinCentros) { setError('Agregá al menos un sector con centros.'); return; }
    setSaving(true);
    try {
      const r = await crearResumen({ titulo, periodo_desde: desde || null, periodo_hasta: hasta || null, fecha, filas: sectores, nota }, actor, actorName);
      notify(`Resumen semanal ${r.numero} archivado a histórico`, 'success', { link: '#/app/acopio' });
      cargarHist();
      setTab('historico');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo archivar.'); }
    finally { setSaving(false); }
  }

  // Objeto ResumenSemanal con el estado actual del editor (para PDF/Excel/correo).
  const resumenActual = (): ResumenSemanal => ({
    id: 'preview', numero: '(borrador)', titulo, periodo_desde: desde || null, periodo_hasta: hasta || null,
    fecha, filas: sectores, totales, nota: nota || null, created_by: actor, actor_name: actorName, created_at: new Date().toISOString(),
  });

  async function pdfActual() {
    try { const { descargarResumenSemanalPdf } = await import('./resumenSemanalPdf'); await descargarResumenSemanalPdf(resumenActual()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  function cargarDesdeHist(r: ResumenSemanal) {
    setTitulo(r.titulo); setDesde(r.periodo_desde ?? ''); setHasta(r.periodo_hasta ?? '');
    setFecha(r.fecha); setSectores(structuredClone(r.filas)); setNota(r.nota ?? '');
    setTab('editor');
    toast(`Reporte ${r.numero} cargado al editor (podés ajustarlo y archivar uno nuevo)`, 'info');
  }

  // Confirmación con el diálogo estilizado de la app (en vez del window.confirm nativo).
  function borrarHist(r: ResumenSemanal) {
    setBorrar(r);
  }
  async function confirmarBorrarHist() {
    const r = borrar;
    if (!r) return;
    setBorrar(null);
    try { await eliminarResumen(r.id); toast('Reporte eliminado', 'success'); cargarHist(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  const acciones = (
    <>
      {onClose && <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>}
      <button type="button" className="btn btn-ghost" onClick={() => void pdfActual()} disabled={saving}>↓ PDF</button>
      <button type="button" className="btn btn-ghost" onClick={() => setCorreoOpen(true)} disabled={saving}>✉ Correo</button>
      {canWrite && tab === 'editor' && (
        <button type="button" className="btn btn-primary" onClick={() => void archivar()} disabled={saving}>{saving ? 'Archivando…' : '🗄 Archivar a histórico'}</button>
      )}
    </>
  );

  const thKg: React.CSSProperties = { fontSize: '.66rem', textAlign: 'center', padding: '.4rem .35rem', whiteSpace: 'pre-line', verticalAlign: 'middle', background: 'var(--surface-3)', lineHeight: 1.2 };
  const colCount = canWrite ? 9 : 8;

  const cuerpo = (
    <>
      {borrar && (
        <ConfirmDialog
          title="Eliminar reporte"
          message={`¿Eliminar del histórico el reporte ${borrar.numero} (${date(borrar.fecha)})? Esta acción no se puede deshacer.`}
          confirmText="Eliminar"
          danger
          onCancel={() => setBorrar(null)}
          onConfirm={() => void confirmarBorrarHist()}
        />
      )}
      {correoOpen && (
        <CorreoReporteModal
          titulo="Enviar Reporte Preliminar"
          descripcion={`Se enviará el PDF del ${titulo || 'Reporte Preliminar de Centros de Acopio'} (fecha ${fecha}).`}
          defaultEmail={actor}
          onEnviar={async (emails) => {
            const { enviarResumenSemanalPorCorreo } = await import('./resumenSemanalPdf');
            const { destinatarios } = await enviarResumenSemanalPorCorreo(resumenActual(), emails);
            return destinatarios;
          }}
          onClose={() => setCorreoOpen(false)}
        />
      )}
      {/* Pestañas Editor / Histórico */}
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.9rem' }}>
        <button className={`btn btn-sm ${tab === 'editor' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('editor')}>📝 Editor</button>
        <button className={`btn btn-sm ${tab === 'historico' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('historico')}>🗄 Histórico ({historico.length})</button>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      {tab === 'editor' ? (
        <>
          <p className="hint muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
            Cargá por fila los <strong>Kg por Cobrar</strong> y <strong>Kg Disponibles Acopiados</strong>. Las 4 columnas de la derecha van
            <strong> combinadas por bloque</strong>: <strong>Acopiados por Sector MGG</strong> se autosuma de los disponibles del bloque; <strong>Resguardos GT</strong>, <strong>Precio Promedio</strong> y <strong>Saldo $USD</strong> se cargan una vez por bloque. Al terminar, <strong>archivá a histórico</strong>.
          </p>

          {/* Encabezado del reporte */}
          <div className="form-grid" style={{ gap: '.6rem 1rem' }}>
            <div className="form-row"><label>Título</label><input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} disabled={!canWrite} /></div>
            <div className="form-row"><label>Fecha del reporte</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={!canWrite} /></div>
            <div className="form-row"><label>Semana · desde</label><input className="input" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} disabled={!canWrite} /></div>
            <div className="form-row"><label>Semana · hasta</label><input className="input" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} disabled={!canWrite} /></div>
          </div>

          {/* Hoja: una sola tabla con celdas combinadas por bloque (tema oscuro, limpio) */}
          <div className="card" style={{ padding: '.5rem', marginTop: '.8rem' }}>
            <div style={{ textAlign: 'center', background: 'var(--surface-2)', border: '1px solid var(--border-strong)', color: 'var(--primary-3)', fontWeight: 800, padding: '.5rem', borderRadius: 8, letterSpacing: '.03em' }}>
              {titulo || 'REPORTE PRELIMINAR DE CENTROS DE ACOPIOS'}
            </div>
            <div className="table-wrap" style={{ marginTop: '.5rem' }}>
              <table className="table" style={{ fontSize: '.78rem' }}>
                <thead>
                  <tr>
                    <th style={{ ...thKg, width: 40 }}>ÍTEM</th>
                    <th style={{ ...thKg, textAlign: 'left', minWidth: 220 }}>CENTROS DE ACOPIO</th>
                    <th style={{ ...thKg, color: '#60a5fa' }}>{'Kg Casiterita\npor Cobrar'}</th>
                    <th style={{ ...thKg, color: '#4ade80' }}>{'Kg Casiterita\nDisponibles Acopiados'}</th>
                    <th style={{ ...thKg, color: '#4ade80' }}>{'Total Kg resguardos\ny Contratos GT'}</th>
                    <th style={{ ...thKg, color: '#fb923c' }}>{'Total Kg Casiterita\nAcopiados por Sector MGG'}</th>
                    <th style={{ ...thKg, color: '#fbbf24' }}>{'Precio Promedio\nde Compra por Sector'}</th>
                    <th style={{ ...thKg, color: '#4ade80' }}>{'Saldo $USD\npor Sector'}</th>
                    {canWrite && <th style={{ ...thKg, width: 30 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {sectores.map((s, si) => {
                    const base = sectores.slice(0, si).reduce((a, x) => a + x.centros.length, 0);
                    const acopiadoMgg = acopiadoMggSector(s);
                    const resg = resguardoSector(s);
                    const gt = esGt(s);
                    const n = s.centros.length;
                    const accent = s.color ?? 'var(--primary)';
                    const mergeTd: React.CSSProperties = { verticalAlign: 'middle', textAlign: 'center', background: 'var(--surface-2)', borderLeft: '1px solid var(--border-strong)', padding: '.3rem .4rem' };
                    return (
                      <Fragment key={si}>
                        {/* Cabecera del bloque: acento de color + nombre + GT + controles */}
                        <tr>
                          <td colSpan={colCount} style={{ background: 'var(--surface-3)', borderTop: '2px solid var(--border-strong)', padding: '.3rem .5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                              <span style={{ width: 12, height: 12, borderRadius: 3, background: accent, flex: '0 0 auto', boxShadow: '0 0 0 1px rgba(0,0,0,.25)' }} />
                              <input value={s.nombre} onChange={(e) => patchSector(si, { nombre: e.target.value })} disabled={!canWrite}
                                style={{ fontWeight: 800, letterSpacing: '.02em', flex: 1, background: 'transparent', border: 'none', color: 'inherit', fontSize: '.82rem', padding: '.2rem' }}
                                placeholder="Nombre del bloque / sector" />
                              {gt && <span className="badge" style={{ background: 'rgba(74,222,128,.16)', color: '#4ade80', fontSize: '.66rem', fontWeight: 700 }} title="Bloque GT (automático por el nombre): sus Disponibles autosuman a Resguardos GT, no a Acopiados MGG">GT (auto)</span>}
                              {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => addCentro(si)} title="Agregar centro al bloque">+ centro</button>}
                              {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => delSector(si)} title="Quitar bloque">🗑</button>}
                            </div>
                          </td>
                        </tr>
                        {n === 0 ? (
                          <tr>
                            <td colSpan={colCount} className="muted" style={{ fontStyle: 'italic', fontSize: '.74rem', padding: '.4rem .6rem' }}>Bloque sin centros — tocá «+ centro».</td>
                          </tr>
                        ) : s.centros.map((c, ci) => (
                          <tr key={ci}>
                            <td className="mono muted" style={{ textAlign: 'center', borderLeft: `3px solid ${accent}` }}>{base + ci + 1}</td>
                            <td><input value={c.centro} onChange={(e) => patchCentro(si, ci, { centro: e.target.value })} disabled={!canWrite} placeholder="Nombre del centro" style={{ ...cellInputStyle, minWidth: 220, textAlign: 'left', fontSize: '.7rem' }} /></td>
                            <td>{vinculableCell(si, c, ci, 'cobrar')}</td>
                            <td>{vinculableCell(si, c, ci, 'disponible')}</td>
                            {ci === 0 && (
                              <>
                                <td rowSpan={n} style={mergeTd} title={gt ? 'Autosuma de los Disponibles del bloque GT (no editable).' : undefined}>
                                  {gt
                                    ? <span className="mono" style={{ color: '#4ade80', fontWeight: 800, fontSize: '.92rem' }}>{fmtKg(resg)}</span>
                                    : numInput(s.resguardos_gt, (v) => patchSector(si, { resguardos_gt: v }))}
                                </td>
                                <td rowSpan={n} className="mono" style={{ ...mergeTd, color: '#fb923c', fontWeight: 800, fontSize: '.92rem' }} title={gt ? 'Bloque GT: no acopia para MGG (sus Kg van a Resguardos).' : 'Autosuma de los Kg Disponibles del bloque.'}>{fmtKg(acopiadoMgg)}</td>
                                <td rowSpan={n} style={mergeTd}>{sectorCell(si, s, 'precio')}</td>
                                <td rowSpan={n} style={mergeTd}>{sectorCell(si, s, 'saldo')}</td>
                              </>
                            )}
                            {canWrite && <td style={{ textAlign: 'center' }}><button className="btn btn-sm btn-ghost" onClick={() => delCentro(si, ci)} title="Quitar centro">✕</button></td>}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 800, background: 'var(--surface-2)', borderTop: '2px solid var(--primary)' }}>
                    <td colSpan={2} style={{ textAlign: 'right' }}>TOTALES</td>
                    <td className="mono" style={{ textAlign: 'right', color: '#60a5fa' }}>{`${fmtKg(totales.kg_cobrar)}`}</td>
                    <td className="mono" style={{ textAlign: 'right', color: '#4ade80' }}>{`${fmtKg(totales.kg_disponible)}`}</td>
                    <td className="mono" style={{ textAlign: 'center', color: '#4ade80' }}>{`${fmtKg(totales.kg_resguardos_gt)}`}</td>
                    <td className="mono" style={{ textAlign: 'center', color: '#fb923c' }}>{`${fmtKg(totales.kg_acopiado_mgg)}`}</td>
                    <td></td>
                    <td className="mono" style={{ textAlign: 'center', color: '#4ade80' }}>{money(totales.saldo_usd)}</td>
                    {canWrite && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '.5rem', flexWrap: 'wrap', gap: '.4rem' }}>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                {canWrite && <button className="btn btn-sm btn-ghost" onClick={addSector}>+ Agregar bloque / sector</button>}
                <button className="btn btn-sm btn-ghost" onClick={() => void resolverVinculos()} disabled={resolviendo} title="Vuelve a traer los valores 🔗 vinculados (GT / acopio)">{resolviendo ? '🔄 Actualizando…' : '🔄 Actualizar vínculos'}</button>
              </div>
              <span className="muted" style={{ fontSize: '.74rem' }}>Fecha de última actualización: <strong>{fecha}</strong></span>
            </div>
          </div>

          {/* Totales generales */}
          <div className="card" style={{ marginTop: '1rem', borderColor: 'var(--primary)' }}>
            <div className="card-title"><span>TOTALES DEL REPORTE</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.6rem' }}>
              <Tot label="Kg por Cobrar" val={`${fmtKg(totales.kg_cobrar)} Kg`} color="#2563eb" />
              <Tot label="Kg Disponibles Acopiados" val={`${fmtKg(totales.kg_disponible)} Kg`} color="#16a34a" />
              <Tot label="Resguardos y Contratos GT" val={`${fmtKg(totales.kg_resguardos_gt)} Kg`} color="#16a34a" />
              <Tot label="Acopiados por Sector MGG" val={`${fmtKg(totales.kg_acopiado_mgg)} Kg`} color="#ea580c" />
              <Tot label="Saldo $USD" val={money(totales.saldo_usd)} color="#16a34a" />
            </div>
          </div>

          <div className="form-row" style={{ marginTop: '.7rem' }}>
            <label>Nota / observaciones</label>
            <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} disabled={!canWrite} placeholder="Opcional" />
          </div>
        </>
      ) : (
        /* Histórico */
        !historico.length ? (
          <p className="hint muted" style={{ margin: 0 }}>Todavía no archivaste ningún resumen semanal. Armá uno en el editor y tocá «Archivar a histórico».</p>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead>
                <tr>
                  <th>N°</th><th>Fecha</th><th>Semana</th>
                  <th style={{ textAlign: 'right' }}>Disponibles</th>
                  <th style={{ textAlign: 'right' }}>Acopiado MGG</th>
                  <th style={{ textAlign: 'right' }}>Saldo $USD</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historico.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.numero}</td>
                    <td>{date(r.fecha)}</td>
                    <td className="muted">{r.periodo_desde ? `${date(r.periodo_desde)} → ${r.periodo_hasta ? date(r.periodo_hasta) : '—'}` : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtKg(r.totales?.kg_disponible ?? 0)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--primary-3)' }}>{fmtKg(r.totales?.kg_acopiado_mgg ?? 0)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(r.totales?.saldo_usd ?? 0)}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="btn btn-sm btn-ghost" title="Descargar PDF" onClick={() => void import('./resumenSemanalPdf').then(({ descargarResumenSemanalPdf }) => descargarResumenSemanalPdf(r)).catch((e) => toast(e instanceof Error ? e.message : 'Error PDF', 'error'))}>↓ PDF</button>
                      {canWrite && <button className="btn btn-sm btn-ghost" title="Cargar al editor" onClick={() => cargarDesdeHist(r)}>✎ Cargar</button>}
                      {canWrite && <button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => void borrarHist(r)}>🗑</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );

  if (asPage) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>📅 Reporte Preliminar</h1>
            <p className="hint muted">Resumen Semanal de Casiterita (REPORTE PRELIMINAR DE CENTROS DE ACOPIOS). Cargá los Kg por sector, vinculá datos en vivo y archivá el reporte a histórico.</p>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>{acciones}</div>
        </div>
        {cuerpo}
      </div>
    );
  }

  return (
    <Modal title="📅 Resumen semanal casiterita" size="xl" onClose={onClose ?? (() => {})} footer={acciones}>
      {cuerpo}
    </Modal>
  );
}

function Tot({ label, val, color }: { label: string; val: string; color?: string }) {
  return (
    <div className="card" style={{ background: 'var(--surface-2)', padding: '.6rem' }}>
      <div className="muted" style={{ fontSize: '.72rem' }}>{label}</div>
      <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 800, color }}>{val}</div>
    </div>
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

function RecepcionModal({ recepcion, productos, canWrite, actor, actorName, centro: centroDefault, onClose, onSaved }: {
  recepcion: RecepcionAcopio | null;
  productos: Producto[];
  canWrite: boolean;
  actor: string;
  actorName: string | null;
  centro: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const esNueva = !recepcion;
  const editable = canWrite && (esNueva || recepcion!.estado === 'abierta');

  const [fecha, setFecha] = useState(recepcion?.fecha ?? hoyISO());
  const [centro, setCentro] = useState(recepcion?.centro_acopio ?? centroDefault);
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
      const { descargarRecepcionPdf } = await import('./acopioPdf');
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
        <p className="hint muted" style={{ fontSize: '.8rem', marginTop: '.6rem' }}>
          Al cerrar se sumarán <strong className="mono">{num(cantidadStock)} {unidad}</strong> al stock de <strong>{productoSel?.nombre ?? '(elegí producto)'}</strong> en <strong>{almacen || '(elegí almacén)'}</strong>
          {totales.recepcionado <= 0 && totales.neto > 0 && ' · se usa el peso neto porque no hay peso recepcionado.'}
        </p>
      )}
    </Modal>
  );
}
