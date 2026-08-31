import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal as ModalUI } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
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
  listSolicitudesSalida, aprobarSolicitudSalida, ejecutarSolicitudSalida, cerrarSolicitudSinDescontar, cancelarSolicitudSalida,
  editarSolicitudSalida, editarNotaSolicitudSalida,
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
import { SalidasTemporalesView } from './SalidasTemporalesView';
import { SalidaDineroDetalle } from './SalidaDineroDetalle';
import { ClientePicker } from './ClientePicker';
import { useSectorizacion } from '@/modules/inventario/useSectorizacion';
import type { Cliente } from '@/modules/ventas/clientes.repository';
import {
  descargarResumenSalidasPdf, descargarResumenSalidasExcel, enviarResumenSalidasPorCorreo,
  type SalidaResumenRow, type SalidaResumenGrupo, type ResumenSalidasMeta,
} from './resumenSalidasReporte';

type Scope = 'salidas' | 'traslados' | 'temporales';
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

// Columnas del kanban. «Ejecutada» se parte en dos: la que SÍ descontó stock/caja y la
// que se cerró «sin descontar» (mov_ref = 'manual_externo', el descuento se hizo por fuera).
// Es la misma fila de la base (estado 'ejecutada'): la diferencia vive en mov_ref, no en un
// estado nuevo. Los almacenistas confundían ambos botones porque el kanban las mezclaba.
type SolColKey = EstadoSolicitudSalida | 'ejecutada_sin_descuento';
const SOL_COLS: { key: SolColKey; label: string; labelTraslado?: string; badge: string; match: (s: SolicitudSalida) => boolean }[] = [
  { key: 'por_aprobar', label: 'Por aprobar', badge: 'warning', match: (s) => s.estado === 'por_aprobar' },
  { key: 'aprobada', label: 'Aprobada', badge: 'info', match: (s) => s.estado === 'aprobada' },
  { key: 'ejecutada', label: 'Ejecutada (descontó)', labelTraslado: 'Ejecutada (movió stock)', badge: 'success', match: (s) => s.estado === 'ejecutada' && s.mov_ref !== 'manual_externo' },
  { key: 'ejecutada_sin_descuento', label: 'Cerrada sin descontar', labelTraslado: 'Cerrada sin mover', badge: 'warning', match: (s) => s.estado === 'ejecutada' && s.mov_ref === 'manual_externo' },
  { key: 'cancelada', label: 'Cancelada', badge: 'danger', match: (s) => s.estado === 'cancelada' },
];
/** Columna (etiqueta + color) que le corresponde a una solicitud. */
const colDe = (s: SolicitudSalida) => SOL_COLS.find((c) => c.match(s));
/** Etiqueta de la columna según la pestaña: en Traslados el stock se «mueve», no se «descuenta». */
const etiquetaCol = (col: (typeof SOL_COLS)[number] | undefined, scope: ScopeSalida): string => (scope === 'traslado' && col?.labelTraslado) || col?.label || '';
const etiquetaDe = (s: SolicitudSalida): string => etiquetaCol(colDe(s), s.scope);

export function SalidasPage() {
  const { can, appUser, isAdmin, role } = usePermissions();
  const canWrite = can('salidas', 'escritura');
  // Aprueban y ejecutan: el administrador, quien tenga FULL CONTROL del módulo,
  // cualquier ANALISTA y cualquier JEFE/JEFA. El obrero solo crea solicitudes.
  // Excepción DURA (nunca aprueban ni ejecutan, aunque tengan full): el Analista
  // de Compras (key 'analista') y el Analista de Lectura ('analista_de_lectura').
  const r = role ?? '';
  const NO_APRUEBA_SALIDAS = r === 'analista' || r === 'analista_de_lectura';
  const puedeAprobar = !NO_APRUEBA_SALIDAS
    && (isAdmin || can('salidas', 'full') || /^analista/.test(r) || /^jef[ae]/.test(r));
  // EJECUTAR (descuenta/mueve stock) es más amplio que APROBAR: además de quienes aprueban,
  // cualquier usuario con permiso de ESCRITURA puede ejecutar una solicitud ya aprobada
  // (pero NO aprobarla — eso queda para full control / admin / jefe / analista).
  const puedeEjecutar = !NO_APRUEBA_SALIDAS && (puedeAprobar || canWrite);
  const actor = appUser?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const [scope, setScope] = useState<Scope>('salidas');
  // Señal para abrir el formulario de "Nueva salida temporal" desde el botón del encabezado
  // (el modal vive dentro de SalidasTemporalesView; el header solo dispara la apertura).
  const [temporalNuevoNonce, setTemporalNuevoNonce] = useState(0);
  // El dinero se maneja directo desde Tesorería; Salidas solo opera material.
  const tipo: Tipo = 'material';
  const [vista, setVista] = useState<Vista>('kanban');
  const [modal, setModal] = useState<Modal>({ kind: 'none' });
  const [loading, setLoading] = useState(true);
  // Filtros del tablero de solicitudes: por USUARIO (quien la hizo, actor) y por SOLICITANTE.
  const [fUsuario, setFUsuario] = useState('');
  const [fSolicitante, setFSolicitante] = useState('');

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
  useRealtime(['movimientos', 'movimientos_caja', 'cajas', 'productos', 'existencias'], () => { void reload(); });
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
  // Opciones de filtro (según lo que exista en el scope activo).
  const usuariosOpc = useMemo(() => {
    const m = new Map<string, string>(); // actor(email) → nombre para mostrar
    for (const s of solsVista) { const a = (s.actor ?? '').trim(); if (a) m.set(a, s.actor_name?.trim() || a); }
    return Array.from(m.entries()).sort((x, y) => x[1].localeCompare(y[1]));
  }, [solsVista]);
  const solicitantesOpc = useMemo(
    () => Array.from(new Set(solsVista.map((s) => (s.solicitante ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [solsVista],
  );
  // Solicitudes filtradas por usuario y/o solicitante (para el tablero).
  const solsFiltradas = useMemo(() => solsVista.filter((s) =>
    (!fUsuario || (s.actor ?? '') === fUsuario) &&
    (!fSolicitante || (s.solicitante ?? '') === fSolicitante),
  ), [solsVista, fUsuario, fSolicitante]);

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
          <p className="hint muted">Toda salida o traslado de <strong>material por almacén</strong> se crea como <strong>solicitud</strong>: el obrero la registra, un analista, un jefe o el admin la aprueba, y al ejecutar se descuenta el stock.</p>
        </div>
        <div className="actions">
          {canWrite && <button className="btn btn-ghost" onClick={() => setModal({ kind: 'choferes-vehiculos' })}>🚚 Choferes / Vehículos</button>}
          {canWrite && scope !== 'temporales' && <button className="btn btn-primary" onClick={abrirNuevo}>{btnLabel}</button>}
          {canWrite && scope === 'temporales' && <button className="btn btn-primary" onClick={() => setTemporalNuevoNonce((n) => n + 1)}>+ Nueva salida temporal</button>}
        </div>
      </div>

      {/* Switch principal: Salidas / Traslados (solo material; el dinero va por Tesorería) */}
      <div className="view-toggle" role="tablist" aria-label="Tipo de operación" style={{ marginBottom: '1rem' }}>
        <button className={scope === 'salidas' ? 'active' : ''} onClick={() => setScope('salidas')}>↘ Salidas</button>
        <button className={scope === 'traslados' ? 'active' : ''} onClick={() => { setScope('traslados'); setVista((v) => v === 'resumen' ? 'kanban' : v); }}>↔ Traslados</button>
        <button className={scope === 'temporales' ? 'active' : ''} onClick={() => setScope('temporales')}>🔧 Salidas temporales</button>
      </div>

      {scope === 'temporales' ? (
        <SalidasTemporalesView nuevoNonce={temporalNuevoNonce} />
      ) : (<>
      {/* Vista: Kanban (trámite) / Lista (historial de movimientos ejecutados) */}
      <div className="view-toggle" role="tablist" aria-label="Kanban o lista" style={{ marginBottom: '1rem' }}>
        <button className={vista === 'kanban' ? 'active' : ''} onClick={() => setVista('kanban')}>🗂 Solicitudes</button>
        <button className={vista === 'lista' ? 'active' : ''} onClick={() => setVista('lista')}>📜 Historial</button>
        {esSalida && esMaterial && <button className={vista === 'resumen' ? 'active' : ''} onClick={() => setVista('resumen')}>📊 Resumen</button>}
      </div>

      {vista === 'kanban' && !loading && (
        <div className="filterbar" style={{ gap: '.6rem', marginBottom: '.8rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-row" style={{ margin: 0 }}>
            <label style={{ fontSize: '.72rem' }}>👤 Usuario (quien la hizo)</label>
            <select className="select" value={fUsuario} onChange={(e) => setFUsuario(e.target.value)}>
              <option value="">Todos</option>
              {usuariosOpc.map(([email, nombre]) => <option key={email} value={email}>{nombre}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label style={{ fontSize: '.72rem' }}>🏷 Solicitante</label>
            <select className="select" value={fSolicitante} onChange={(e) => setFSolicitante(e.target.value)}>
              <option value="">Todos</option>
              {solicitantesOpc.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {(fUsuario || fSolicitante) && (
            <button className="btn btn-sm btn-ghost" onClick={() => { setFUsuario(''); setFSolicitante(''); }}>✕ Limpiar</button>
          )}
          <span className="muted" style={{ fontSize: '.8rem', marginLeft: 'auto' }}>{solsFiltradas.length} de {solsVista.length} solicitud(es)</span>
        </div>
      )}

      {loading ? (
        <EmptyState message="Cargando…" icon="◔" />
      ) : (vista === 'resumen' && esSalida && esMaterial) ? (
        <ResumenSalidas solicitudes={solicitudes} actor={actor} />
      ) : vista === 'kanban' ? (
        <SolicitudesKanban sols={solsFiltradas} scope={scopeSol} onVer={(sol) => setModal({ kind: 'detalle-solicitud', sol })} />
      ) : (
        <Historial
          key={`${scope}-${tipo}`}
          scope={scope} tipo={tipo}
          salMat={salMat} trasMat={trasMat} salDin={salDin} trasDin={trasDin}
          canWrite={canWrite}
          onConciliar={(s) => setModal({ kind: 'conciliar', salida: s })}
          onVerMaterial={(mov, esTraslado) => setModal({ kind: 'detalle-material', mov, esTraslado })}
          onVerDinero={(mov, esTraslado) => setModal({ kind: 'detalle-dinero', mov, esTraslado })}
        />
      )}
      </>)}

      {modal.kind === 'detalle-solicitud' && (
        <SolicitudDetalleModal
          sol={modal.sol}
          puedeAprobar={puedeAprobar}
          puedeEjecutar={puedeEjecutar}
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
  // Filtro del historial: texto (producto/motivo/destino…) + rango de fechas + unidad
  // solicitante + producto. Con unidad y producto se responde «¿cuántos guantes le
  // despachamos a Fundición?» con la línea de totales de abajo.
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [fUnidad, setFUnidad] = useState('');
  const [fProducto, setFProducto] = useState('');
  const hayFiltro = !!(q || desde || hasta || fUnidad || fProducto);
  const limpiar = () => { setQ(''); setDesde(''); setHasta(''); setFUnidad(''); setFProducto(''); };
  const enRango = (iso: string) => {
    const t = iso ? iso.slice(0, 10) : '';
    if (desde && t < desde) return false;
    if (hasta && t > hasta) return false;
    return true;
  };
  const matchTxt = (...campos: (string | null | undefined)[]) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return campos.some((c) => (c ?? '').toLowerCase().includes(s));
  };
  const FilterBar = (
    <div className="filterbar" style={{ gap: '.5rem', marginBottom: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <input className="input" placeholder="🔎 Buscar (producto, motivo, destino…)" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
      <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>Desde <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
      <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>Hasta <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      {hayFiltro && <button className="btn btn-sm btn-ghost" onClick={limpiar}>✕ Limpiar</button>}
    </div>
  );

  // Material
  if (tipo === 'material') {
    const esTraslado = scope === 'traslados';
    const base = scope === 'salidas' ? salMat : trasMat;
    // Filas que pasan los filtros comunes (fecha + texto). De acá salen las dos listas.
    const baseComun = base.filter((m) => enRango(m.at) && matchTxt(m.producto?.nombre, m.producto?.sku, m.almacen, m.destino, m.solicitante, m.actor_name, m.actor, m.detalle));
    const unidadDe = (m: Movimiento) => (m.destino ?? '').trim();
    // Listas FACETADAS: cada desplegable ofrece solo lo que existe con el OTRO filtro puesto,
    // así ninguna opción devuelve una tabla vacía. Antes se armaban con todo el histórico y
    // ofrecían unidades sin un solo registro en el rango elegido.
    const opcionesUnidad = (() => {
      const conteo = new Map<string, number>();
      for (const m of baseComun) {
        if (fProducto && m.producto?.sku !== fProducto) continue;
        const u = unidadDe(m);
        if (u) conteo.set(u, (conteo.get(u) ?? 0) + 1);
      }
      const opts = [...conteo.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'es'))
        .map(([u, n]) => ({ value: u, label: `${u} (${n})` }));
      // El valor elegido se conserva aunque el resto de filtros lo deje sin filas: si no,
      // desaparecería del cuadro y no habría cómo quitarlo.
      if (fUnidad && !conteo.has(fUnidad)) opts.push({ value: fUnidad, label: `${fUnidad} (0)` });
      // «Todas» primero: SearchSelect no tiene botón de limpiar, sin esta opción el
      // filtro se quedaría puesto para siempre. El número son los RENGLONES que se verían
      // al quitar el filtro (como el resto de la lista), no cuántas unidades hay: si contara
      // unidades, «Todas (14)» quedaría por debajo de «FUNDICION (228)».
      const filasSinFiltro = baseComun.filter((m) => !fProducto || m.producto?.sku === fProducto).length;
      return [{ value: '', label: `Todas (${filasSinFiltro})` }, ...opts];
    })();
    const opcionesProducto = (() => {
      const conteo = new Map<string, { nombre: string; n: number }>();
      for (const m of baseComun) {
        if (fUnidad && unidadDe(m) !== fUnidad) continue;
        const sku = m.producto?.sku;
        if (!sku) continue;
        const prev = conteo.get(sku);
        conteo.set(sku, { nombre: m.producto?.nombre ?? sku, n: (prev?.n ?? 0) + 1 });
      }
      const opts = [...conteo.entries()]
        .sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es'))
        .map(([sku, v]) => ({ value: sku, label: `${v.nombre} · ${sku} (${v.n})` }));
      if (fProducto && !conteo.has(fProducto)) opts.push({ value: fProducto, label: `${fProducto} (0)` });
      const filasSinFiltro = baseComun.filter((m) => !fUnidad || unidadDe(m) === fUnidad).length;
      return [{ value: '', label: `Todos (${filasSinFiltro})` }, ...opts];
    })();
    const rows = baseComun.filter((m) =>
      (!fUnidad || unidadDe(m) === fUnidad)
      && (!fProducto || m.producto?.sku === fProducto));
    // Totales de lo filtrado: despachos, unidades (solo tiene sentido con un producto) y $.
    const totalCant = rows.reduce((a, m) => a + Math.abs(Number(m.delta) || 0), 0);
    const totalUsd = rows.reduce((a, m) => a + Math.abs(Number(m.delta) || 0) * (Number(m.precio_unitario) || 0), 0);
    // Un renglón = un producto de una salida; una misma solicitud puede tener varios.
    const sinPrecio = rows.filter((m) => !(Number(m.precio_unitario) > 0)).length;
    const unidadProd = fProducto ? (rows[0]?.producto?.unidad ?? '') : '';
    return (
      <>
      {FilterBar}
      <div className="filterbar" style={{ gap: '.5rem', marginBottom: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Buscadores (SearchSelect): con muchas unidades y cientos de productos, escribir
            es más rápido que desplegar. Cada opción muestra cuántos renglones tiene. */}
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          {esTraslado ? '🏭 Destino' : '🏷 Dirigido a / unidad'}
          <SearchSelect
            value={fUnidad}
            onChange={setFUnidad}
            options={opcionesUnidad}
            sinPreseleccion
            placeholder="Escribí para buscar…"
            emptyText="Ninguna unidad coincide"
            style={{ minWidth: 230 }}
          />
        </label>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          📦 Producto
          <SearchSelect
            value={fProducto}
            onChange={setFProducto}
            options={opcionesProducto}
            sinPreseleccion
            placeholder="Escribí para buscar…"
            emptyText="Ningún producto coincide"
            style={{ minWidth: 260 }}
          />
        </label>
        {(fUnidad || fProducto) && (
          <span className="chip chip-active" style={{ cursor: 'default' }}>
            <strong>{rows.length}</strong>&nbsp;renglón(es){fUnidad ? <>&nbsp;{esTraslado ? 'hacia' : 'a'} <strong>{fUnidad}</strong></> : null}
            {fProducto && <>&nbsp;· <strong>{num(totalCant)} {unidadProd}</strong></>}
            {totalUsd > 0 && <>&nbsp;· <strong>{money(totalUsd)}</strong>{sinPrecio > 0 ? <span className="muted">&nbsp;(sin precio: {sinPrecio})</span> : null}</>}
          </span>
        )}
      </div>
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
      </>
    );
  }

  // Dinero
  const rows = (scope === 'salidas' ? salDin : trasDin).filter((m) => enRango(m.at) && matchTxt(m.caja?.nombre, m.destino, m.motivo, m.moneda));
  const esTraslado = scope === 'traslados';
  return (
    <>
    {FilterBar}
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
    </>
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

/* Columnas del kanban que el usuario decidió ocultar. Cada almacenista elige las que
   necesita ver (p. ej. solo «Aprobada» para ejecutar) y se recuerda en este navegador.
   Sin almacenamiento disponible se muestran todas: nunca se pierde nada. */
const LS_COLS_OCULTAS = 'mgg.salidas.kanban.ocultas';
function leerColsOcultas(): SolColKey[] {
  try {
    const raw = localStorage.getItem(LS_COLS_OCULTAS);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    const validas = new Set<string>(SOL_COLS.map((c) => c.key));
    return Array.isArray(arr) ? arr.filter((k): k is SolColKey => typeof k === 'string' && validas.has(k)) : [];
  } catch {
    return [];
  }
}
function guardarColsOcultas(keys: SolColKey[]) {
  try { localStorage.setItem(LS_COLS_OCULTAS, JSON.stringify(keys)); } catch { /* sin localStorage: queda solo en memoria */ }
}

function SolicitudesKanban({ sols, scope, onVer }: { sols: SolicitudSalida[]; scope: ScopeSalida; onVer: (s: SolicitudSalida) => void }) {
  const [ocultas, setOcultas] = useState<SolColKey[]>(leerColsOcultas);
  const alternar = (key: SolColKey) =>
    setOcultas((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      guardarColsOcultas(next);
      return next;
    });
  const mostrarTodas = () => { setOcultas([]); guardarColsOcultas([]); };
  const visibles = SOL_COLS.filter((c) => !ocultas.includes(c.key));
  return (
    <div>
      {/* Selector de columnas: el conteo se ve aunque la columna esté oculta, para no perder de vista lo pendiente. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.4rem', marginBottom: '.6rem' }}>
        <span className="muted" style={{ fontSize: '.78rem' }}>Mostrar:</span>
        {SOL_COLS.map((col) => {
          const activa = !ocultas.includes(col.key);
          const n = sols.filter(col.match).length;
          return (
            <button key={col.key} type="button" className={`chip ${activa ? 'chip-active' : ''}`} aria-pressed={activa}
              title={activa ? 'Ocultar esta columna' : 'Mostrar esta columna'} onClick={() => alternar(col.key)}>
              {activa ? '☑' : '☐'} {etiquetaCol(col, scope)} <span className="dim">· {n}</span>
            </button>
          );
        })}
        {ocultas.length > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={mostrarTodas}>Mostrar todas</button>
        )}
      </div>
      {!sols.length ? (
        <EmptyState message="No hay solicitudes en esta vista. Creá una con el botón de arriba." icon="🗂" />
      ) : !visibles.length ? (
        <EmptyState message="Todas las columnas están ocultas. Elegí al menos una arriba." icon="🗂" />
      ) : (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '.75rem' }}>
      {visibles.map((col) => {
        const items = sols.filter(col.match);
        return (
          <div key={col.key} className="card" style={{ margin: 0, padding: '.6rem', background: 'var(--bg-1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
              <strong style={{ fontSize: '.82rem' }}>{etiquetaCol(col, scope)}</strong>
              <span className={`badge ${col.badge}`}>{items.length}</span>
            </div>
            {/* Lista con scroll propio: la columna no empuja la página aunque tenga muchas. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', maxHeight: 'max(320px, calc(100vh - 300px))', overflowY: 'auto', paddingRight: '.15rem' }}>
              {items.map((s) => (
                <button key={s.id} className="card" onClick={() => onVer(s)}
                  style={{ margin: 0, padding: '.55rem .65rem', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.3rem' }}>
                    <span className="mono" style={{ fontSize: '.9rem', fontWeight: 800, color: 'var(--primary-3)' }} title="Correlativo del usuario">N° {s.num_usuario != null ? String(s.num_usuario).padStart(3, '0') : '—'}</span>
                    <span className="mono muted" style={{ fontSize: '.62rem' }} title="Código global">{s.codigo}</span>
                  </div>
                  {s.actor_name && <div className="muted" style={{ fontSize: '.68rem' }}>👤 {s.actor_name}</div>}
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
      )}
    </div>
  );
}

/* ───────────── Detalle + acciones de una solicitud ───────────── */

function SolicitudDetalleModal({
  sol, puedeAprobar, puedeEjecutar, actor, actorName, productos, existencias, almacenes, onClose, onChanged,
}: {
  sol: SolicitudSalida;
  puedeAprobar: boolean;
  puedeEjecutar: boolean;
  actor: string;
  actorName: string | null;
  productos: Producto[];
  existencias: Existencia[];
  almacenes: Almacen[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Sectorización: ejecutar es el ÚNICO momento en que el stock se mueve de verdad.
  // La solicitud la puede pedir cualquiera desde cualquier sede (para eso existe), pero
  // sacar el material del almacén lo hace quien responde por ese almacén. Sin esto la
  // sectorización quedaba en los formularios y el descuento real seguía siendo libre.
  const sector = useSectorizacion();
  const almacenesDeLaSolicitud = useMemo(() => {
    const set = new Set<string>();
    for (const it of sol.items ?? []) { const a = (it.almacen ?? '').trim(); if (a) set.add(a); }
    const suelto = (sol.almacen_origen ?? '').trim();
    if (!set.size && suelto) set.add(suelto);
    return Array.from(set);
  }, [sol]);
  // Se mira el ORIGEN: un traslado que entra a mi sede lo ejecuta quien saca, no quien recibe.
  const origenAjeno = useMemo(
    () => almacenesDeLaSolicitud.find((a) => !sector.puedeMover(a)) ?? null,
    [almacenesDeLaSolicitud, sector],
  );
  const bloqueoEjecutar = origenAjeno ? sector.motivo(origenAjeno) : null;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [motivoCancel, setMotivoCancel] = useState('');
  // Cierre SIN descontar (la salida ya se hizo por fuera, ej.: una salida manual de inventario).
  const [sinDescOpen, setSinDescOpen] = useState(false);
  const [motivoSinDesc, setMotivoSinDesc] = useState('');

  // Edición de la solicitud (solo material, antes de ejecutar). Reusa los datos ya
  // cargados (productos/existencias/almacenes) para los selects.
  const editable = sol.tipo === 'material' && (sol.estado === 'por_aprobar' || sol.estado === 'aprobada') && puedeAprobar;
  const [editando, setEditando] = useState(false);
  type LineaEd = { id: number; productoId: string; almacen: string; cantidad: string; precio: string };
  const initLineas = (): LineaEd[] => {
    // Almacén de origen: si el guardado no tiene stock del producto, se elige el
    // almacén con MÁS stock (para que no quede mostrando "0 und").
    const mejorAlmacen = (pid: string, saved: string): string => {
      const savedStock = Number(existencias.find((e) => e.producto_id === pid && e.almacen === saved)?.stock) || 0;
      if (saved && savedStock > 0) return saved;
      const top = existencias.filter((e) => e.producto_id === pid && (Number(e.stock) || 0) > 0)
        .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0))[0];
      return top?.almacen ?? saved;
    };
    const base = (sol.items && sol.items.length)
      ? sol.items.map((it) => ({ productoId: it.producto_id, almacen: it.almacen ?? sol.almacen_origen ?? '', cantidad: Number(it.cantidad) || 0, precio: it.precio_unit }))
      : [{ productoId: sol.producto_id ?? '', almacen: sol.almacen_origen ?? '', cantidad: Number(sol.cantidad) || 0, precio: sol.precio_unit }];
    return base.map((it, i) => ({ id: i + 1, productoId: it.productoId, almacen: mejorAlmacen(it.productoId, it.almacen), cantidad: String(it.cantidad || 0), precio: it.precio != null ? String(it.precio) : '' }));
  };
  const [edLineas, setEdLineas] = useState<LineaEd[]>([]);
  const [edSeq, setEdSeq] = useState(1);
  const [edDestino, setEdDestino] = useState(sol.destino ?? '');
  const [edAlmacenDestino, setEdAlmacenDestino] = useState(sol.almacen_destino ?? '');
  const [edMotivo, setEdMotivo] = useState(sol.motivo ?? '');
  const [edFecha, setEdFecha] = useState(sol.fecha_entrega ?? '');
  const [edConsumo, setEdConsumo] = useState(!!sol.consumo_interno);
  const [edSolicitante, setEdSolicitante] = useState(sol.solicitante ?? '');
  // Despacho (transporte).
  const [edChofer, setEdChofer] = useState(sol.chofer ?? '');
  const [edCedula, setEdCedula] = useState(sol.chofer_cedula ?? '');
  const [edVehiculo, setEdVehiculo] = useState(sol.vehiculo ?? '');
  const [edPlaca, setEdPlaca] = useState(sol.vehiculo_placa ?? '');
  const [edDirDespacho, setEdDirDespacho] = useState(sol.direccion_despacho ?? '');
  const [edDirDestino, setEdDirDestino] = useState(sol.direccion_destino ?? '');
  const [edSedeDestino, setEdSedeDestino] = useState(sol.sede_destino ?? '');
  // Cliente + cuenta por cobrar.
  const [edEsCliente, setEdEsCliente] = useState(!!sol.cliente_id);
  const [edCliente, setEdCliente] = useState<Cliente | null>(sol.cliente_id ? ({ id: sol.cliente_id, nombre: sol.cliente_nombre ?? '' } as Cliente) : null);
  const [edCxcMonto, setEdCxcMonto] = useState(sol.cxc_monto != null ? String(sol.cxc_monto) : '');
  const [edCxcMoneda, setEdCxcMoneda] = useState(sol.cxc_moneda ?? 'USD');
  // Nota adicional (se imprime en la orden).
  const [edNotaEntrega, setEdNotaEntrega] = useState(sol.nota_entrega ?? '');

  // Edición SOLO de la nota/motivo (disponible incluso FINALIZADA: no toca stock ni estado).
  const [editandoNota, setEditandoNota] = useState(false);
  const [notaMotivo, setNotaMotivo] = useState(sol.motivo ?? '');
  const [notaEntrega, setNotaEntrega] = useState(sol.nota_entrega ?? '');
  async function guardarNota() {
    setBusy(true);
    try {
      await editarNotaSolicitudSalida(sol, { motivo: notaMotivo, notaEntrega }, actor);
      notify(`Nota de ${sol.codigo} actualizada`, 'success');
      setEditandoNota(false);
      onChanged();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar la nota', 'error');
    } finally { setBusy(false); }
  }

  const activos = useMemo(() => productos.filter((p) => p.estado === 'activo'), [productos]);
  const prodById = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const stockDe = (productoId: string, almacen: string) => Number(existencias.find((e) => e.producto_id === productoId && e.almacen === almacen)?.stock) || 0;
  const almacenesProd = (productoId: string) => existencias.filter((e) => e.producto_id === productoId && (Number(e.stock) || 0) > 0).map((e) => e.almacen);
  const almacenesActivos = useMemo(() => almacenes.filter((a) => a.estado === 'activo').map((a) => a.nombre), [almacenes]);
  // Sedes / centros como en Inventario (CENTRO DE ACOPIO - …, LOS PINOS, …): destino del traslado.
  const sedes = useMemo(
    () => Array.from(new Set(almacenes.filter((a) => a.estado === 'activo').map((a) => a.sede?.trim()).filter((s): s is string => !!s)))
      .sort((a, b) => a.localeCompare(b, 'es')),
    [almacenes],
  );

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
    setEdChofer(sol.chofer ?? '');
    setEdCedula(sol.chofer_cedula ?? '');
    setEdVehiculo(sol.vehiculo ?? '');
    setEdPlaca(sol.vehiculo_placa ?? '');
    setEdDirDespacho(sol.direccion_despacho ?? '');
    setEdDirDestino(sol.direccion_destino ?? '');
    setEdSedeDestino(sol.sede_destino ?? '');
    setEdEsCliente(!!sol.cliente_id);
    setEdCliente(sol.cliente_id ? ({ id: sol.cliente_id, nombre: sol.cliente_nombre ?? '' } as Cliente) : null);
    setEdCxcMonto(sol.cxc_monto != null ? String(sol.cxc_monto) : '');
    setEdCxcMoneda(sol.cxc_moneda ?? 'USD');
    setEdNotaEntrega(sol.nota_entrega ?? '');
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
    if (edEsCliente && !edCliente) { toast('Elegí (o agregá) el cliente para la cuenta por cobrar.', 'error'); return; }
    // Si es cliente y no se puso monto, se toma el total de las líneas (cantidad × precio).
    const totalLineas = items.reduce((a, it) => a + (Number(it.cantidad) || 0) * (Number(it.precio_unit) || 0), 0);
    const cxcMonto = edEsCliente ? (Number(edCxcMonto) || totalLineas) : 0;
    if (edEsCliente && cxcMonto <= 0) { toast('El monto de la cuenta por cobrar debe ser mayor que 0.', 'error'); return; }
    setBusy(true);
    try {
      await editarSolicitudSalida(sol, {
        items,
        almacenDestino: sol.scope === 'traslado' ? (edAlmacenDestino || null) : undefined,
        destino: sol.scope === 'salida' ? edDestino : undefined,
        motivo: edMotivo, fechaEntrega: edFecha || null, consumoInterno: edConsumo,
        solicitante: edSolicitante,
        chofer: edChofer, choferCedula: edCedula,
        vehiculo: edVehiculo, vehiculoPlaca: edPlaca,
        direccionDespacho: edDirDespacho, direccionDestino: edDirDestino,
        sedeDestino: sol.scope === 'salida' ? edSedeDestino : undefined,
        clienteId: edEsCliente ? (edCliente?.id ?? null) : null,
        clienteNombre: edEsCliente ? (edCliente?.nombre ?? null) : null,
        cxcMonto: edEsCliente ? cxcMonto : null,
        cxcMoneda: edEsCliente ? edCxcMoneda : null,
        notaEntrega: edNotaEntrega,
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
  // «Cerrar sin descontar» habla de descontar en Salidas y de mover en Traslados.
  const esTraslado = sol.scope === 'traslado';
  const verboCierre = esTraslado ? 'mover' : 'descontar';
  const cerrarLabel = esTraslado ? '⚠ Cerrar sin mover stock (ya se movió a mano)' : '⚠ Cerrar sin descontar (ya se descontó a mano)';

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
      {sol.estado === 'ejecutada' && (
        <button className="btn btn-ghost" disabled={busy} style={{ marginRight: 'auto' }}
          onClick={() => { setNotaMotivo(sol.motivo ?? ''); setNotaEntrega(sol.nota_entrega ?? ''); setEditandoNota(true); }}
          title="Agregar o corregir la nota/motivo (no cambia lo despachado ni el estado)">
          ✎ Editar nota
        </button>
      )}
      {puedeAprobar && sol.estado === 'por_aprobar' && (
        <button className="btn btn-primary" disabled={busy}
          onClick={() => run(() => aprobarSolicitudSalida(sol, actor), `Solicitud ${sol.codigo} aprobada`)}>
          ✔ Aprobar
        </button>
      )}
      {puedeEjecutar && sol.estado === 'aprobada' && (
        <button className="btn btn-primary" disabled={busy || !!bloqueoEjecutar}
          title={bloqueoEjecutar ?? undefined}
          onClick={() => run(() => ejecutarSolicitudSalida(sol, actor, actorName), `Solicitud ${sol.codigo} ejecutada`)}>
          {busy ? 'Ejecutando…' : ejecutarLabel}
        </button>
      )}
      {puedeEjecutar && sol.estado === 'aprobada' && (
        <button className="btn btn-ghost" disabled={busy || !!bloqueoEjecutar} onClick={() => setSinDescOpen(true)}
          title={`NO ${esTraslado ? 'mueve' : 'descuenta'} stock. Solo para cerrar la solicitud cuando el ${esTraslado ? 'movimiento' : 'descuento'} ya se hizo a mano en Inventario`}>
          {cerrarLabel}
        </button>
      )}
      {sol.estado !== 'ejecutada' && sol.estado !== 'cancelada' && (
        <button className="btn btn-danger" disabled={busy} onClick={() => setCancelOpen(true)}>Cancelar solicitud</button>
      )}
      <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cerrar</button>
    </div>
  );

  if (editandoNota) {
    const notaFooter = (
      <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', width: '100%' }}>
        <button className="btn btn-ghost" onClick={() => setEditandoNota(false)} disabled={busy}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardarNota} disabled={busy}>{busy ? 'Guardando…' : '✓ Guardar nota'}</button>
      </div>
    );
    return (
      <ModalUI title={`Editar nota · ${sol.codigo}`} size="md" onClose={() => setEditandoNota(false)} footer={notaFooter}>
        <div className="card" style={{ marginBottom: '.7rem', fontSize: '.82rem' }}>
          Esta solicitud ya está cerrada (<strong>{etiquetaDe(sol)}</strong>). Solo se edita la <strong>nota / motivo</strong> (una anotación adicional);
          <strong> no cambia</strong> lo despachado, el stock ni el estado.
        </div>
        <div className="form-row">
          <label>Motivo / detalle</label>
          <textarea className="input" rows={2} value={notaMotivo} onChange={(e) => setNotaMotivo(e.target.value)} placeholder="Motivo del despacho…" />
        </div>
        <div className="form-row">
          <label>Nota adicional</label>
          <textarea className="input" rows={3} value={notaEntrega} onChange={(e) => setNotaEntrega(e.target.value)} placeholder="Nota / observación adicional…" />
        </div>
      </ModalUI>
    );
  }

  if (editando) {
    return (
      <ModalUI title={`Editar solicitud ${sol.codigo}`} size="lg" onClose={() => setEditando(false)} footer={footer}>
        <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.6rem' }}>
          {sol.scope === 'traslado' ? 'Traslado' : 'Salida'} de material · estado <strong>{etiquetaDe(sol)}</strong>. Editás antes de ejecutar (todavía no tocó stock).
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
              <option value="">— elegí la sede / centro destino —</option>
              {Array.from(new Set([...sedes, ...(edAlmacenDestino ? [edAlmacenDestino] : [])])).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <small className="muted">Sede o centro de acopio destino (como en Inventario). Es lo que se imprime en la orden.</small>
          </div>
        )}

        {sol.scope === 'salida' && (
          <div className="form-row">
            <label>Sede / destino (opcional)</label>
            <select className="select" value={edSedeDestino} onChange={(e) => setEdSedeDestino(e.target.value)}>
              <option value="">— sin sede —</option>
              {Array.from(new Set([...sedes, ...(edSedeDestino ? [edSedeDestino] : [])])).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        {/* Despacho (transporte). Se imprime en la orden de salida. */}
        <div className="form-row" style={{ marginTop: '.5rem', marginBottom: '.3rem' }}><label>Despacho (transporte)</label></div>
        <div className="form-grid">
          <div className="form-row">
            <label>Chofer / responsable</label>
            <input className="input" value={edChofer} onChange={(e) => setEdChofer(e.target.value)} placeholder="Nombre del chofer…" />
          </div>
          <div className="form-row">
            <label>Cédula</label>
            <input className="input mono" value={edCedula} onChange={(e) => setEdCedula(e.target.value)} placeholder="C.I." />
          </div>
          <div className="form-row">
            <label>Vehículo</label>
            <input className="input" value={edVehiculo} onChange={(e) => setEdVehiculo(e.target.value)} placeholder="Marca / modelo…" />
          </div>
          <div className="form-row">
            <label>Placa</label>
            <input className="input mono" value={edPlaca} onChange={(e) => setEdPlaca(e.target.value)} placeholder="Placa" />
          </div>
          <div className="form-row">
            <label>Dirección de despacho</label>
            <input className="input" value={edDirDespacho} onChange={(e) => setEdDirDespacho(e.target.value)} placeholder="Desde dónde sale…" />
          </div>
          <div className="form-row">
            <label>Dirección de destino</label>
            <input className="input" value={edDirDestino} onChange={(e) => setEdDirDestino(e.target.value)} placeholder="A dónde llega…" />
          </div>
        </div>

        <div className="form-row" style={{ marginTop: '.5rem', marginBottom: '.3rem' }}><label>Materiales</label></div>
        {edLineas.map((l, idx) => {
          // Todos los almacenes activos (incluye subalmacenes como Los Pinos), no solo
          // los que ya tienen stock del producto; el aviso de stock se muestra abajo.
          const opcionesAlmacen = Array.from(new Set([...almacenesActivos, ...(l.almacen ? [l.almacen] : [])]));
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
                  <SearchSelect value={l.productoId}
                    onChange={(id) => { const alms = almacenesProd(id); setLinea(l.id, { productoId: id, almacen: alms[0] ?? '' }); }}
                    options={activos.map((pr) => ({ value: pr.id, label: `${pr.nombre} · ${pr.sku}` }))}
                    placeholder="🔎 Buscá el material (nombre o SKU)…" emptyText="Sin productos." />
                </div>
                {sol.scope === 'traslado' ? (
                  <div className="form-row">
                    <label>Se descuenta de (automático)</label>
                    <input className="input" value={l.almacen || '—'} disabled style={{ opacity: .8 }} />
                    <small className="muted">{l.productoId && l.almacen ? <>El sistema descuenta del almacén con stock: <strong>{l.almacen}</strong> · <strong className="mono">{num(stock)} {p?.unidad ?? ''}</strong></> : 'Elegí el material; el almacén de origen se asigna solo.'}</small>
                  </div>
                ) : (
                <div className="form-row">
                  <label>Almacén origen</label>
                  <select className="select" value={l.almacen} onChange={(e) => setLinea(l.id, { almacen: e.target.value })}>
                    <option value="">— elegí el almacén —</option>
                    {(opcionesAlmacen.length ? opcionesAlmacen : almacenesActivos)
                      .map((a) => ({ a, st: stockDe(l.productoId, a) }))
                      .sort((x, y) => y.st - x.st || x.a.localeCompare(y.a, 'es'))
                      .map(({ a, st }) => (
                        <option key={a} value={a}>{a}{l.productoId ? ` — ${num(st)} ${p?.unidad ?? 'und'}` : ''}</option>
                      ))}
                  </select>
                  <small className="muted">{l.productoId && l.almacen ? <>stock en {l.almacen}: <strong className="mono">{num(stock)} {p?.unidad ?? ''}</strong></> : 'Elegí el material primero'}</small>
                </div>
                )}
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

        {/* Cliente + cuenta por cobrar: al ejecutar se le genera la CxC. */}
        <div className="form-row">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={edEsCliente} onChange={(e) => setEdEsCliente(e.target.checked)} />
            Es para un cliente (genera cuenta por cobrar)
          </label>
        </div>
        {edEsCliente && (
          <div className="card" style={{ padding: '.7rem .85rem', margin: '0 0 .6rem' }}>
            <ClientePicker value={edCliente} onChange={setEdCliente} actor={actor} actorName={actorName} />
            <div className="form-grid" style={{ marginTop: '.5rem' }}>
              <div className="form-row">
                <label>Monto por cobrar</label>
                <input className="input mono" type="number" min={0} step="any" value={edCxcMonto} onChange={(e) => setEdCxcMonto(e.target.value)}
                  placeholder="Se toma el total de las líneas si lo dejás vacío" />
              </div>
              <div className="form-row">
                <label>Moneda</label>
                <select className="select" value={edCxcMoneda} onChange={(e) => setEdCxcMoneda(e.target.value)}>
                  <option value="USD">USD ($)</option>
                  <option value="Bs">Bs</option>
                </select>
              </div>
            </div>
          </div>
        )}

        <div className="form-row">
          <label>Nota adicional (se imprime en la orden)</label>
          <textarea className="input" rows={2} value={edNotaEntrega} onChange={(e) => setEdNotaEntrega(e.target.value)} placeholder="Nota / observación adicional…" />
        </div>
      </ModalUI>
    );
  }

  return (
    <ModalUI title={`Solicitud ${sol.codigo}`} onClose={onClose} footer={footer}>
      <table className="table" style={{ fontSize: '.85rem' }}>
        <tbody>
          <tr><td className="muted">Tipo</td><td>{sol.scope === 'traslado' ? 'Traslado' : 'Salida'} de {sol.tipo === 'dinero' ? 'dinero' : 'material'}</td></tr>
          <tr><td className="muted">Estado</td><td><span className={`badge ${colDe(sol)?.badge ?? 'info'}`}>{etiquetaDe(sol)}</span></td></tr>
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
          {sol.nota_entrega && <tr><td className="muted">Nota</td><td>{sol.nota_entrega}</td></tr>}
          <tr><td className="muted">Creada</td><td>{dateTime(sol.created_at)}</td></tr>
          {sol.aprobada_en && <tr><td className="muted">Aprobada</td><td>{dateTime(sol.aprobada_en)} · {sol.aprobada_por ?? ''}</td></tr>}
          {sol.ejecutada_en && <tr><td className="muted">{sol.mov_ref === 'manual_externo' ? 'Cerrada' : 'Ejecutada'}</td><td>{dateTime(sol.ejecutada_en)} · {sol.ejecutada_por ?? ''}</td></tr>}
          {sol.estado === 'ejecutada' && sol.mov_ref === 'manual_externo' && (
            <tr><td className="muted">Traza</td><td>⚠️ Cerrada <strong>sin {esTraslado ? 'mover stock' : 'descontar'}</strong> — {esTraslado ? 'el movimiento se hizo por fuera (ej.: traslado manual de inventario)' : 'el descuento se hizo por fuera (ej.: salida manual de inventario)'}.</td></tr>
          )}
        </tbody>
      </table>

      {!puedeAprobar && sol.estado === 'por_aprobar' && (
        <div className="muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>
          Solo full control (analista, jefe o administrador) puede <strong>aprobar</strong> esta solicitud.{puedeEjecutar ? ' Una vez aprobada, vos podés ejecutarla.' : ''}
        </div>
      )}
      {!puedeEjecutar && sol.estado === 'aprobada' && (
        <div className="muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>
          Solo un usuario con permiso de escritura (o full control) puede <strong>ejecutar</strong> esta solicitud.
        </div>
      )}

      {sinDescOpen && (
        <div className="card" style={{ marginTop: '.75rem', borderColor: 'var(--primary, #ff8a00)' }}>
          <strong style={{ fontSize: '.85rem' }}>⚠ Cerrar SIN {verboCierre} stock</strong>
          <p className="muted" style={{ fontSize: '.78rem', margin: '.3rem 0 .5rem' }}>
            Usá esto <strong>solo</strong> si el stock <strong>ya se {esTraslado ? 'movió' : 'descontó'} a mano</strong> (por ejemplo, con {esTraslado ? <>un <strong>traslado manual de inventario</strong></> : <>una <strong>salida manual de inventario</strong></>}).
            La solicitud pasa a <strong>{esTraslado ? 'Cerrada sin mover' : 'Cerrada sin descontar'}</strong> para la traza, pero <strong>no</strong> mueve stock ni caja.
            Si el stock todavía <strong>no</strong> se {esTraslado ? 'movió' : 'descontó'}, volvé y usá <strong>«{ejecutarLabel}»</strong>.
          </p>
          <label className="muted" style={{ fontSize: '.8rem' }}>Motivo / referencia (queda en el historial)</label>
          <textarea className="input" rows={2} value={motivoSinDesc} onChange={(e) => setMotivoSinDesc(e.target.value)}
            placeholder="Ej.: se descontó con una salida manual de inventario del ALMACEN el 13/07…" />
          <div className="actions" style={{ marginTop: '.5rem' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setSinDescOpen(false)} disabled={busy}>Volver</button>
            <button className="btn btn-sm btn-primary" disabled={busy || !motivoSinDesc.trim()}
              onClick={() => run(() => cerrarSolicitudSinDescontar(sol, motivoSinDesc.trim(), actor), `Solicitud ${sol.codigo} cerrada SIN ${verboCierre} stock`)}>
              ⚠ Cerrar sin {verboCierre}
            </button>
          </div>
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
