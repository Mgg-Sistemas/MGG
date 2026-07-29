import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime, money, num, relTime } from '@/shared/lib/format';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import {
  listAlertasMercadoPendientes, marcarTodasAtendidas, type AlertaMercado,
} from '@/modules/cocina/alertasMercado.repository';
import type {
  EstadoOrden,
  EventoHistorial,
  ItemOrden,
  Orden,
  PagoMetodo,
  Producto,
  Proveedor,
  Usuario,
} from '@/shared/lib/types';
import { ChatOC } from './ChatOC';
import { noLeidosPorOrden } from './ocChat.repository';
import {
  aprobarOrden,
  aprobarOcsEnLote,
  actualizarComprarItems,
  actualizarCantidadesOrden,
  anularOrden,
  cancelarOrden,
  crearOrden,
  actualizarOrden,
  actualizarOc,
  sincronizarNombreProductos,
  listSubOcs,
  adjuntarImagenOrden,
  desistirProveedor,
  reabrirOcAOfertas,
  finalizarPedido,
  getCurrentUsuario,
  getHistoricoPreciosPorSku,
  listOrdenes,
  listProductosActivos,
  listProveedoresActivos,
  listProveedores,
  nextCodigo,
  nextCodigoServicio,
  recibirOrdenParcial,
  enviarCreditoARecepcion,
  listAbonos,
  urlAdjuntoOc,
  adjuntarComprobanteOc,
  indicarMetodoPago,
  reasignarProveedorAReaprobacion,
  METODOS_PAGO,
  labelMetodoPago,
  listCatalogoPedido,
  crearCatalogoPedido,
  actualizarCatalogoPedido,
  setEstadoCatalogoPedido,
  eliminarCatalogoPedido,
  ensureUnidadSolicitante,
  type PrecioHistorico,
  type CatalogoPedido,
  type ScopeCatalogoPedido,
} from './pedidos.repository';
import { listOfertasByOrden, labelCondicionPago, descuentoEfectivo, CONDICIONES_PAGO, getPdfOfertaSignedUrl } from './ofertas.repository';
import { listCajasActivas } from '@/modules/salidas/cajas.repository';
import type { AbonoCredito, Caja } from '@/shared/lib/types';
import { listDatosPago, requiereDatos, type DatosPago } from './datosPago.repository';
import { DatosPagoFields, validarDatosPago } from '@/shared/ui/DatosPagoFields';
import { crearEvaluacion } from './evaluaciones.repository';
import { createProducto, getUnidades, getCategorias, addCategoria, siguienteSku, listProductosConStock, type ProductoConStock } from '@/modules/inventario/inventario.repository';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { listAlmacenes, nombreCortoAlmacen } from '@/modules/inventario/almacenes.repository';
import { AlmacenPicker } from '@/modules/inventario/AlmacenPicker';
import { listUsuarios } from '@/modules/usuarios/usuarios.repository';
import { listEquipos, type MaquinariaEquipo } from '@/modules/maquinaria/maquinariaEquipos.repository';
import type { Almacen } from '@/shared/lib/types';
import { OfertasComparativa } from './OfertasComparativa';
import { AsignarProveedoresModal } from './AsignarProveedoresModal';
import { AgregarOfertaModal } from './AgregarOfertaModal';
import { SolicitudMercadoModal } from './SolicitudMercadoModal';
// descargarTrazabilidadPdf / descargarOrdenCompraPdf se importan dinámicamente
// (al generar) para no cargar jsPDF al abrir Pedidos.
import { enviarTrazabilidadAMultiples } from './enviarTrazabilidad';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { CompraDirectaView } from './CompraDirectaView';
import { ServicioDirectoView } from './ServicioDirectoView';
import { OcPorLoteView } from './OcPorLoteView';

/* ============================================================
   MGG · Pedidos / Órdenes · Página principal
   Mantiene la lógica de negocio del demo (estados, historial,
   reglas de aprobación) sobre datos persistidos en Supabase.
   ============================================================ */

const VIEW_KEY = 'mgg.view.pedidos';
const SCOPE_KEY = 'mgg.scope.pedidos';
type ViewMode = 'kanban' | 'lista';
type Scope = 'pedidos' | 'oc' | 'compra_directa' | 'oc_lote' | 'servicio' | 'servicio_directo';

// Columnas del kanban según el "scope" (Pedidos vs Órdenes de Compra).
const KANBAN_COLS_PEDIDOS: { key: EstadoOrden; label: string }[] = [
  { key: 'pendiente', label: 'Pendiente' },
  { key: 'aprobada', label: 'Aprobada' },
  { key: 'recibida', label: 'Recibida' },
  { key: 'finalizada', label: 'Finalizada' },
  { key: 'cancelada', label: 'Cancelada' },
];

const KANBAN_COLS_OC: { key: EstadoOrden; label: string }[] = [
  { key: 'aprobada', label: 'Pendiente (cargar ofertas)' },              // OP aprobada → cargar cotizaciones
  { key: 'oc_creada', label: 'Pendiente por aprobación (Gerente General)' }, // oferta elegida → espera aprobación
  { key: 'cuenta_abierta', label: 'Crédito / cuentas abiertas' },        // a crédito → abonos hasta saldar
  { key: 'confirmada_metodo', label: 'Confirmada (indicar método de pago)' }, // gerente confirmó → falta método
  { key: 'oc_aprobada', label: 'Confirmada pagar' },                     // método indicado → Tesorería
  { key: 'por_recibir', label: 'Pendiente por recepción' },             // contra entrega / crédito saldado
  { key: 'pagada', label: 'Pagada' },
  { key: 'recibida', label: 'Recibida' },
  { key: 'finalizada', label: 'Finalizada' },
  { key: 'anulada', label: 'Anulada' },
  { key: 'desistida_proveedor', label: 'Proveedor desistió' },
];

// Servicios (clase='servicio'): comparten el ciclo completo de una OC, pero viven en su
// propia pestaña. El kanban cubre todo el flujo para que nada quede oculto.
const KANBAN_COLS_SERVICIO: { key: EstadoOrden; label: string }[] = [
  { key: 'pendiente', label: 'Solicitado' },
  { key: 'aprobada', label: 'Aprobado (cotizar)' },
  { key: 'oc_creada', label: 'Pendiente por aprobación' },
  { key: 'cuenta_abierta', label: 'Crédito / cuenta abierta' },
  { key: 'confirmada_metodo', label: 'Confirmado (método de pago)' },
  { key: 'oc_aprobada', label: 'Confirmado pagar' },
  { key: 'por_recibir', label: 'Pendiente por realizar' },
  { key: 'pagada', label: 'Pagado' },
  { key: 'recibida', label: 'Servicio realizado' },
  { key: 'finalizada', label: 'Finalizado' },
  { key: 'cancelada', label: 'Cancelado' },
];

// Etiqueta y clase visual de cada evento del historial (igual al demo).
function eventLabel(ev: string): string {
  return (
    {
      creada: 'Orden creada',
      aprobada: 'Aprobada',
      rechazada: 'Rechazada',
      cancelada: 'Cancelada por la empresa',
      desistida_proveedor: 'Proveedor desistió',
      proveedor_cambiado: 'Cambio de proveedor',
      editada: 'Orden editada',
      cantidades_editadas: 'Cantidades editadas',
      oc_creada: 'OC creada (oferta elegida)',
      oc_editada: 'OC editada',
      oc_reabierta_edicion: 'OC modificada · vuelve a aprobación del Gerente',
      confirmada_metodo: 'OC confirmada · indicar método de pago',
      confirmada_por_recibir: 'OC confirmada · pendiente por recepción',
      confirmada_cuenta_abierta: 'OC confirmada · crédito (cuenta abierta)',
      metodo_pago: 'Método de pago indicado · enviada a pagar',
      oc_aprobada: 'Confirmada pagar',
      abono: 'Abono registrado (crédito)',
      credito_saldado: 'Crédito saldado · pendiente por recepción',
      pagada: 'Pago registrado (Tesorería)',
      recibida: 'Recepción confirmada',
      finalizada: 'Pedido finalizado',
    } as Record<string, string>
  )[ev] ?? ev;
}
function eventClass(ev: string): string {
  return (
    {
      aprobada: 'ok',
      rechazada: 'err',
      cancelada: 'err',
      desistida_proveedor: 'warn',
      proveedor_cambiado: 'info',
      editada: 'info',
      cantidades_editadas: 'info',
      oc_creada: 'info',
      oc_editada: 'info',
      oc_reabierta_edicion: 'warn',
      confirmada_metodo: 'info',
      confirmada_por_recibir: 'info',
      confirmada_cuenta_abierta: 'warn',
      metodo_pago: 'ok',
      oc_aprobada: 'ok',
      abono: 'info',
      credito_saldado: 'ok',
      pagada: 'ok',
      recibida: 'ok',
      finalizada: 'ok',
    } as Record<string, string>
  )[ev] ?? '';
}

type ModalKind =
  | { kind: 'none' }
  | { kind: 'detail'; ordenId: string }
  | { kind: 'create' }
  | { kind: 'mercado' }
  | { kind: 'create-servicio' }
  | { kind: 'edit'; orden: Orden }
  | { kind: 'edit-oc'; orden: Orden }
  | { kind: 'asignar'; orden: Orden }
  | { kind: 'approve'; orden: Orden }
  | { kind: 'metodo-pago'; orden: Orden }
  | { kind: 'cancel'; orden: Orden }
  | { kind: 'anular-oc'; orden: Orden }
  | { kind: 'modificar-oc'; orden: Orden }
  | { kind: 'desistir'; orden: Orden }
  | { kind: 'receive'; orden: Orden }
  | { kind: 'abono'; orden: Orden }
  | { kind: 'finalizar'; orden: Orden }
  | { kind: 'price-history'; sku: string; nombre: string }
  | { kind: 'catalogo' }
  | { kind: 'add-offer'; orden: Orden };

export function PedidosPage() {
  const { user } = useSession();
  const { can } = usePermissions();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedoresAll, setProveedoresAll] = useState<Proveedor[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterText, setFilterText] = useState('');
  const [filterEstado, setFilterEstado] = useState<EstadoOrden | ''>('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(VIEW_KEY) : null;
    return saved === 'lista' ? 'lista' : 'kanban';
  });
  // Al entrar al módulo siempre arrancamos en "Órdenes de Pedido" (vista por defecto).
  const [scope, setScope] = useState<Scope>('pedidos');

  const [modal, setModal] = useState<ModalKind>({ kind: 'none' });
  const [offersReloadKey, setOffersReloadKey] = useState(0);
  // Chat interno por OC: mapa orden_id → nº de mensajes sin leer (badge 💬 en la tarjeta).
  const [noLeidos, setNoLeidos] = useState<Map<string, number>>(new Map());

  const loadNoLeidos = useCallback(async () => {
    if (!user?.id) return;
    try { setNoLeidos(await noLeidosPorOrden(user.id)); } catch { /* sin badge si falla */ }
  }, [user?.id]);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [os, pvs, pvsAll, pds, usrs] = await Promise.all([
        listOrdenes(),
        listProveedoresActivos(),
        listProveedores(),
        listProductosActivos(),
        listUsuarios().catch(() => [] as Usuario[]),
      ]);
      setOrdenes(os);
      setProveedores(pvs);
      setProveedoresAll(pvsAll);
      setProductos(pds);
      setUsuarios(usrs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar pedidos');
    }
  }, []);

  // Realtime multiusuario: las órdenes/compras se reflejan al instante entre usuarios.
  // Realtime multiusuario. Se PAUSA mientras hay un modal abierto: un refresh
  // re-renderiza el modal y, sobre un formulario, hace perder teclas de los
  // inputs controlados (se borraba el apellido/nota/finalidad al tipear).
  // Al cerrar el modal se reanuda y se pone al día con un refresh (efecto abajo).
  useRealtime(['ordenes', 'productos'], () => { void refresh(); }, { enabled: modal.kind === 'none' });

  // El chat (badges 💬) se mantiene al día SIEMPRE, también con un modal abierto:
  // así el contador baja al leer y sube si llega un mensaje mientras revisás otra OC.
  useRealtime(['oc_mensajes'], () => { void loadNoLeidos(); });
  useEffect(() => { void loadNoLeidos(); }, [loadNoLeidos]);

  // Alertas "a restablecer el mercado" enviadas desde Cocina (tarjeta para el analista).
  const [alertasMercado, setAlertasMercado] = useState<AlertaMercado[]>([]);
  const loadAlertas = useCallback(async () => {
    try { setAlertasMercado(await listAlertasMercadoPendientes()); } catch { /* sin tarjeta si falla */ }
  }, []);
  useEffect(() => { void loadAlertas(); }, [loadAlertas]);
  useRealtime(['alertas_mercado'], () => { void loadAlertas(); });

  // Al cerrar cualquier modal, traer lo que haya cambiado mientras estuvo pausado.
  const modalKindPrev = useRef(modal.kind);
  useEffect(() => {
    if (modalKindPrev.current !== 'none' && modal.kind === 'none') void refresh();
    modalKindPrev.current = modal.kind;
  }, [modal.kind, refresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [u] = await Promise.all([getCurrentUsuario()]);
      if (cancelled) return;
      setUsuario(u);
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, user?.id]);

  // Abrir el detalle de una orden desde el buscador global (?detalle=ID).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('detalle');
    if (!id || !ordenes.length) return;
    if (ordenes.some((o) => o.id === id)) {
      setModal({ kind: 'detail', ordenId: id });
      const next = new URLSearchParams(searchParams);
      next.delete('detalle');
      setSearchParams(next, { replace: true });
    }
  }, [ordenes, searchParams, setSearchParams]);

  // Callback estable para abrir el detalle: evita re-renderizar todas las tarjetas
  // del kanban en cada render (KanbanCard está memoizado).
  const openDetail = useCallback((id: string) => setModal({ kind: 'detail', ordenId: id }), []);

  const proveedorMap = useMemo(
    () => new Map(proveedoresAll.map((p) => [p.id, p])),
    [proveedoresAll]
  );
  // email → "Nombre Apellido" para mostrar personas en vez del correo.
  const personaMap = useMemo(
    () => new Map(usuarios.map((u) => [u.email.toLowerCase(), `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim() || u.email])),
    [usuarios]
  );

  // Admin o quien tenga FULL CONTROL de Pedidos/Compras puede hacer todo en el módulo.
  const isAdmin = usuario?.role === 'admin' || can('pedidos', 'full');
  // Analista y admin manejan compras (cargar ofertas, emitir OC, recibir mercancía).
  // El "aprobar" final (aceptar la oferta ganadora) sigue siendo solo del jefe/admin.
  const canManageProcurement = isAdmin || usuario?.role === 'analista';
  // El obrero solo crea solicitudes de pedido y las finaliza: sin acceso a Órdenes de Compra.
  const isObrero = usuario?.role === 'obrero';
  // Autorizar (confirmar) las Órdenes de Compra: el Gerente General (admin) y LEYDIS RENGEL
  // (jefa de administración). Cada uno firma con su propia firma en el PDF.
  const emailActual = (usuario?.email ?? user?.email ?? '').toLowerCase();
  const puedeAprobarOc = usuario?.role === 'admin' || emailActual === 'jhzgcontabilidad@gmail.com';

  // Si el obrero quedara con scope 'oc' (estado viejo), lo forzamos a 'pedidos'.
  useEffect(() => {
    if (isObrero && scope !== 'pedidos') setScope('pedidos');
  }, [isObrero, scope]);

  // El admin arranca directo en Órdenes de Compra (una sola vez, al cargar su perfil).
  const scopeDefaulted = useRef(false);
  useEffect(() => {
    if (!usuario || scopeDefaulted.current) return;
    scopeDefaulted.current = true;
    if (usuario.role === 'admin') setScope('oc');
  }, [usuario]);

  // Deep-link (Dashboard / buscador): ?scope=oc_lote abre directo esa vista y manda
  // a "aprobar por lote". Gana sobre el default del admin y se consume de la URL.
  useEffect(() => {
    const s = searchParams.get('scope');
    if (!s) return;
    const validos: Scope[] = ['pedidos', 'oc', 'oc_lote', 'compra_directa'];
    if (validos.includes(s as Scope)) {
      scopeDefaulted.current = true;
      switchScope(s as Scope);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('scope');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const filteredOrdenes = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return ordenes.filter((o) => {
      // La pestaña de Servicios muestra solo clase='servicio'; el resto, solo productos.
      const esServicio = o.clase === 'servicio';
      if (scope === 'servicio' ? !esServicio : esServicio) return false;
      if (viewMode === 'lista' && filterEstado && o.estado !== filterEstado) return false;
      if (q) {
        const prov = o.proveedor_id ? proveedorMap.get(o.proveedor_id) : undefined;
        const haystack = [
          o.codigo,
          prov?.razon_social,
          o.solicitante,
          o.solicitante_email,
          o.notas,
        ]
          .map((v) => (v ?? '').toString().toLowerCase())
          .join(' | ');
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [ordenes, filterText, filterEstado, viewMode, proveedorMap, scope]);

  function switchView(mode: ViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch {
      /* localStorage no disponible */
    }
  }

  function switchScope(next: Scope) {
    setScope(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      /* localStorage no disponible */
    }
  }

  const kanbanCols = scope === 'oc' ? KANBAN_COLS_OC : scope === 'servicio' ? KANBAN_COLS_SERVICIO : KANBAN_COLS_PEDIDOS;

  const currentDetail =
    modal.kind === 'detail' ? ordenes.find((o) => o.id === modal.ordenId) ?? null : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{scope === 'oc' ? 'Órdenes de Compra' : scope === 'compra_directa' ? 'Compra Directa' : scope === 'servicio_directo' ? 'Servicio Directo' : scope === 'oc_lote' ? 'OC por lote' : scope === 'servicio' ? 'Servicios' : 'Órdenes'}</h1>
          <p className="hint muted">
            {scope === 'oc'
              ? 'Seguimiento del ciclo de compras: emisión de OC, recepción y finalización del pedido.'
              : scope === 'oc_lote'
                ? 'Checklist de órdenes de compra pendientes por confirmar. Aprobá en lote, imprimí o enviá por correo.'
              : scope === 'compra_directa'
                ? 'Compras sin proveedor. En proceso → Finalizada: al finalizar, el material entra al inventario.'
                : isAdmin
                  ? 'Solicitudes de pedido generadas por analistas. Aprobá la mejor oferta antes de emitir la OC.'
                  : 'Crea solicitudes de pedido. El administrador aprueba antes de emitir la orden de compra.'}
          </p>
        </div>
        <div className="actions">
          <Link to="/app/pedidos/historico" className="btn btn-ghost" title="Ver histórico filtrable de órdenes">
            ⌕ Histórico
          </Link>
          {scope !== 'compra_directa' && scope !== 'oc_lote' && scope !== 'servicio_directo' && (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => setModal({ kind: 'catalogo' })}
                title="Gestionar las unidades solicitantes"
              >
                📒 Categorías
              </button>
              {scope === 'servicio' ? (
                <button
                  className="btn btn-primary"
                  onClick={() => setModal({ kind: 'create-servicio' })}
                >
                  + Nuevo servicio
                </button>
              ) : (
                <>
                  {scope === 'pedidos' && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => setModal({ kind: 'mercado' })}
                      title="Solicitud de Mercado: víveres y art. de limpieza para la cocina (urgente)"
                    >
                      🛒 Solicitud de Mercado
                    </button>
                  )}
                  <button
                    className="btn btn-primary"
                    onClick={() => setModal({ kind: 'create' })}
                  >
                    + Nueva orden
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Alerta de Cocina: hay que restablecer el mercado. El analista monta el pedido MERCADO. */}
      {alertasMercado.length > 0 && scope === 'pedidos' && (
        <div className="card" style={{ borderColor: 'var(--warning)', background: 'var(--bg-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.7rem', cursor: 'pointer' }}
          onClick={() => setModal({ kind: 'mercado' })} title="Montar la Solicitud de Mercado para reponer los víveres">
          <div>
            <strong>🛒 La cocina solicitó restablecer el mercado</strong>
            <div className="muted" style={{ fontSize: '.8rem' }}>
              {alertasMercado.length} alerta(s) · última {dateTime(alertasMercado[0].creada_en)}{alertasMercado[0].creada_por ? ` · ${alertasMercado[0].creada_por}` : ''}. Hacé clic para montar el pedido MERCADO.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '.4rem' }}>
            <button className="btn btn-ghost btn-sm" onClick={async (e) => { e.stopPropagation(); await marcarTodasAtendidas(user?.email).catch(() => {}); await loadAlertas(); }}>✓ Descartar</button>
            <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); setModal({ kind: 'mercado' }); }}>🛒 Solicitud de Mercado</button>
          </div>
        </div>
      )}

      {/* El obrero no ve la pestaña de Órdenes de Compra: solo trabaja pedidos. */}
      {!isObrero && (
        <div
          className="view-toggle"
          role="tablist"
          aria-label="Tipo de vista"
          style={{ marginBottom: '1rem', marginLeft: 0 }}
        >
          <button
            className={scope === 'pedidos' ? 'active' : ''}
            onClick={() => switchScope('pedidos')}
            title="Ver solicitudes de pedido"
          >
            ✉ Solicitud de Pedido
          </button>
          <button
            className={scope === 'oc' ? 'active' : ''}
            onClick={() => switchScope('oc')}
            title="Ver órdenes de compra"
          >
            🧾 Órdenes de Compra
          </button>
          <button
            className={scope === 'oc_lote' ? 'active' : ''}
            onClick={() => switchScope('oc_lote')}
            title="Checklist de compras pendientes por pagar"
          >
            📋 OC por lote
          </button>
          <button
            className={scope === 'compra_directa' ? 'active' : ''}
            onClick={() => switchScope('compra_directa')}
            title="Compras sin proveedor"
          >
            🛒 Compra Directa
          </button>
          <button
            className={scope === 'servicio' ? 'active' : ''}
            onClick={() => switchScope('servicio')}
            title="Solicitudes de servicio (recarga de gas, recarga de agua, mantenimiento de maquinaria…)"
          >
            🛠 Servicios
          </button>
          <button
            className={scope === 'servicio_directo' ? 'active' : ''}
            onClick={() => switchScope('servicio_directo')}
            title="Servicio sin solicitud previa: cargás la factura y el monto (paga por Tesorería, casa con Maquinaria)"
          >
            🔧 Servicio Directo
          </button>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {scope === 'oc_lote' ? (
        <OcPorLoteView />
      ) : scope === 'compra_directa' ? (
        <CompraDirectaView
          actor={usuario?.email ?? user?.email ?? 'sistema'}
          actorName={usuario?.nombre ?? null}
        />
      ) : scope === 'servicio_directo' ? (
        <ServicioDirectoView
          actor={usuario?.email ?? user?.email ?? 'sistema'}
          actorName={usuario?.nombre ?? null}
        />
      ) : (
      <>
      <div className="filterbar">
        <input
          className="search"
          placeholder="Buscar por código, proveedor, solicitante…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        <select
          className="select"
          style={{ maxWidth: 220 }}
          value={filterEstado}
          onChange={(e) => setFilterEstado(e.target.value as EstadoOrden | '')}
          disabled={viewMode === 'kanban'}
          title={viewMode === 'kanban' ? 'Filtro deshabilitado en vista Kanban' : ''}
        >
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendientes</option>
          <option value="aprobada">Aprobadas (OP)</option>
          <option value="oc_creada">OC creada</option>
          <option value="oc_aprobada">OC confirmada</option>
          <option value="pagada">Pagadas</option>
          <option value="desistida_proveedor">Proveedor desistió</option>
          <option value="recibida">Recibidas</option>
          <option value="finalizada">Finalizadas</option>
          <option value="cancelada">Canceladas</option>
        </select>
        <div className="view-toggle" role="tablist" aria-label="Modo de vista">
          <button
            className={viewMode === 'kanban' ? 'active' : ''}
            onClick={() => switchView('kanban')}
            title="Vista Kanban"
          >
            ▦ Kanban
          </button>
          <button
            className={viewMode === 'lista' ? 'active' : ''}
            onClick={() => switchView('lista')}
            title="Vista Lista"
          >
            ☰ Lista
          </button>
        </div>
      </div>

      {loading ? (
        <EmptyState message="Cargando órdenes..." icon="◔" />
      ) : viewMode === 'kanban' ? (
        <KanbanBoard
          ordenes={filteredOrdenes}
          proveedorMap={proveedorMap}
          cols={kanbanCols}
          onOpen={openDetail}
          noLeidos={noLeidos}
          // En Órdenes de Compra el tablero muestra hasta 10 por columna (el resto se ve en el
          // Histórico); «Pendiente (cargar ofertas)» queda SIN límite para no ocultar lo que falta cotizar.
          maxPorColumna={scope === 'oc' ? 10 : undefined}
          columnasSinLimite={scope === 'oc' ? ['aprobada'] : undefined}
        />
      ) : (
        <OrdenesTable
          ordenes={filteredOrdenes}
          proveedorMap={proveedorMap}
          personaMap={personaMap}
          canManageProcurement={canManageProcurement}
          noLeidos={noLeidos}
          onView={(id) => setModal({ kind: 'detail', ordenId: id })}
          onApprove={(o) => setModal({ kind: 'approve', orden: o })}
        />
      )}
      </>
      )}

      {/* Modal: detalle */}
      {modal.kind === 'detail' && currentDetail && (
        <OrdenDetailModal
          orden={currentDetail}
          proveedor={currentDetail.proveedor_id ? proveedorMap.get(currentDetail.proveedor_id) ?? null : null}
          proveedorMap={proveedorMap}
          personaMap={personaMap}
          isAdmin={isAdmin}
          puedeAprobarOc={puedeAprobarOc}
          canManageProcurement={canManageProcurement}
          enOc={scope === 'oc' || currentDetail.clase === 'servicio'}
          actorEmail={user?.email ?? ''}
          actorUserId={user?.id ?? ''}
          actorNombre={personaMap.get((user?.email ?? '').toLowerCase()) ?? user?.email ?? ''}
          offersReloadKey={offersReloadKey}
          onAddOffer={() => setModal({ kind: 'add-offer', orden: currentDetail })}
          onAcceptedOffer={async () => {
            await refresh();
            setOffersReloadKey((k) => k + 1);
          }}
          onComprobanteSaved={async () => { await refresh(); }}
          onClose={() => setModal({ kind: 'none' })}
          onApprove={() => setModal({ kind: 'approve', orden: currentDetail })}
          onEditar={() => setModal({ kind: 'edit', orden: currentDetail })}
          onEditarOc={() => setModal({ kind: 'edit-oc', orden: currentDetail })}
          onAsignar={() => setModal({ kind: 'asignar', orden: currentDetail })}
          onConfirmOc={async () => {
            if (!puedeAprobarOc) { toast('Solo el Gerente General o la Jefa de Administración pueden autorizar las órdenes de compra.', 'error'); return; }
            try {
              await aprobarOcsEnLote([currentDetail], usuario?.email ?? user?.email ?? 'sistema', null);
              notify(`OC confirmada: ${currentDetail.oc_codigo ?? currentDetail.codigo} · falta indicar el método de pago (el almacén destino se elige al recibir)`, 'success', { link: '#/app/pedidos' });
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error al confirmar', 'error');
            }
          }}
          onEnviarPagar={() => setModal({ kind: 'metodo-pago', orden: currentDetail })}
          onCancel={() => setModal({ kind: 'cancel', orden: currentDetail })}
          onAnular={() => setModal({ kind: 'anular-oc', orden: currentDetail })}
          onModificar={() => setModal({ kind: 'modificar-oc', orden: currentDetail })}
          onDesistir={() => setModal({ kind: 'desistir', orden: currentDetail })}
          onReceive={() => setModal({ kind: 'receive', orden: currentDetail })}
          onAbono={() => setModal({ kind: 'abono', orden: currentDetail })}
          onEnviarRecepcion={async () => {
            try {
              await enviarCreditoARecepcion(currentDetail, usuario?.email ?? user?.email ?? 'sistema');
              notify(`Crédito pagado · ${currentDetail.oc_codigo ?? currentDetail.codigo} → Pendiente por recepción`, 'success', { link: '#/app/pedidos' });
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo enviar a recepción', 'error'); }
          }}
          onFinalizar={() => setModal({ kind: 'finalizar', orden: currentDetail })}
          usuarioRole={usuario?.role ?? null}
          onSeePriceHistory={(sku, nombre) =>
            setModal({ kind: 'price-history', sku, nombre })
          }
        />
      )}

      {/* Modal: crear */}
      {modal.kind === 'create' && (
        <CrearOrdenModal
          productos={productos}
          usuario={usuario}
          authEmail={user?.email ?? ''}
          onClose={() => setModal({ kind: 'none' })}
          onCreated={async () => {
            setModal({ kind: 'none' });
            await refresh();
            await loadAlertas();
          }}
        />
      )}

      {/* Modal: SOLICITUD DE MERCADO (botón independiente · COCINA · urgente · Víveres y Art. de Limpieza) */}
      {modal.kind === 'mercado' && (
        <SolicitudMercadoModal
          productos={productos}
          usuario={usuario}
          authEmail={user?.email ?? ''}
          onClose={() => setModal({ kind: 'none' })}
          onCreated={async () => {
            // La Solicitud de Mercado atiende las alertas pendientes de cocina.
            await marcarTodasAtendidas(user?.email).catch(() => {});
            setModal({ kind: 'none' });
            await refresh();
            await loadAlertas();
          }}
        />
      )}

      {/* Modal: nuevo servicio (clase='servicio') */}
      {modal.kind === 'create-servicio' && (
        <NuevoServicioModal
          usuario={usuario}
          authEmail={user?.email ?? ''}
          onClose={() => setModal({ kind: 'none' })}
          onCreated={async () => { setModal({ kind: 'none' }); await refresh(); }}
        />
      )}

      {/* Modal: editar OP (solo pendiente, antes de aprobación del GG).
          Los servicios se editan con el FORMATO DE SERVICIO (no el de productos). */}
      {modal.kind === 'edit' && modal.orden.clase === 'servicio' && (
        <NuevoServicioModal
          usuario={usuario}
          authEmail={user?.email ?? ''}
          orden={modal.orden}
          onClose={() => setModal({ kind: 'none' })}
          onCreated={async () => { setModal({ kind: 'none' }); await refresh(); }}
        />
      )}
      {modal.kind === 'edit' && modal.orden.clase !== 'servicio' && (
        <CrearOrdenModal
          productos={productos}
          usuario={usuario}
          authEmail={user?.email ?? ''}
          orden={modal.orden}
          onClose={() => setModal({ kind: 'none' })}
          onCreated={async () => {
            setModal({ kind: 'none' });
            await refresh();
          }}
        />
      )}

      {/* Modal: editar OC (solo oc_creada, antes de aprobarla) */}
      {modal.kind === 'edit-oc' && (
        <EditarOcModal
          orden={modal.orden}
          proveedores={proveedores}
          proveedorMap={proveedorMap}
          productos={productos}
          actorEmail={usuario?.email ?? user?.email ?? 'sistema'}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={async () => { setModal({ kind: 'none' }); await refresh(); }}
        />
      )}

      {/* Modal: asignar proveedores por producto (OC multi-proveedor) */}
      {modal.kind === 'asignar' && (
        <AsignarProveedoresModal
          orden={modal.orden}
          proveedorMap={proveedorMap}
          actorEmail={usuario?.email ?? user?.email ?? 'sistema'}
          onClose={() => setModal({ kind: 'none' })}
          onDone={async () => { setModal({ kind: 'none' }); await refresh(); }}
        />
      )}

      {/* Modal: catálogos de pedidos (clasificación + unidad solicitante) */}
      {modal.kind === 'catalogo' && (
        <CatalogoPedidosModal
          actor={user?.email ?? ''}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}

      {/* Modal: agregar oferta */}
      {modal.kind === 'add-offer' && (
        <AddOfferGate
          orden={modal.orden}
          proveedores={proveedores}
          registradoPorEmail={user?.email ?? ''}
          onClose={() => setModal({ kind: 'detail', ordenId: modal.orden.id })}
          onCreated={() => {
            setOffersReloadKey((k) => k + 1);
            setModal({ kind: 'detail', ordenId: modal.orden.id });
          }}
        />
      )}

      {/* Modal: aprobar */}
      {modal.kind === 'approve' && (
        <ConfirmDialog
          title="Aprobar orden"
          message={`Aprobar ${modal.orden.codigo} por ${money(modal.orden.total, modal.orden.moneda)}.`}
          confirmText="Aprobar"
          onCancel={() => setModal({ kind: 'none' })}
          onConfirm={async () => {
            try {
              await aprobarOrden(modal.orden, usuario?.email ?? user?.email ?? 'sistema');
              notify(`Orden aprobada: ${modal.orden.codigo}`, 'success', { link: '#/app/pedidos' });
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error al aprobar', 'error');
            }
          }}
        />
      )}

      {/* Modal: cancelar */}
      {modal.kind === 'cancel' && (
        <MotivoModal
          title={`Cancelar ${modal.orden.codigo}`}
          confirmText="Cancelar orden"
          danger
          confirmMessage={`¿Seguro que querés cancelar la orden ${modal.orden.codigo}? Esta acción no se puede deshacer.`}
          intro="Cancelar la orden. Útil cuando el cliente solicita cancelar o la empresa desiste del proyecto."
          label="Motivo"
          onClose={() => setModal({ kind: 'none' })}
          onConfirm={async (motivo) => {
            try {
              const cancelada = modal.orden;
              await cancelarOrden(cancelada, usuario?.email ?? user?.email ?? 'sistema', motivo);
              // Servicio con repuestos del inventario: se restituye el stock que se había descontado al crear.
              if (cancelada.clase === 'servicio') {
                for (const it of (Array.isArray(cancelada.items) ? cancelada.items : [])) {
                  const qty = Number(it.repuesto_cantidad) || 0;
                  if (!it.repuesto_producto_id || qty <= 0) continue;
                  try {
                    await registrarMovimiento({
                      producto_id: it.repuesto_producto_id, tipo: 'entrada', delta: qty,
                      almacen: it.repuesto_almacen ?? undefined,
                      actor: usuario?.email ?? user?.email ?? 'sistema', actor_name: usuario?.nombre ?? null,
                      ref_tipo: 'servicio_reversa', ref_id: cancelada.id, ref_codigo: cancelada.codigo ?? undefined,
                      detalle: `Reversa de repuesto · servicio ${cancelada.codigo ?? ''} cancelado`,
                      precio_unitario: null,
                    });
                  } catch { /* la reversa no bloquea la cancelación */ }
                }
              }
              notify(`Orden cancelada: ${modal.orden.codigo}`, 'warning', { link: '#/app/pedidos' });
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error al cancelar', 'error');
            }
          }}
        />
      )}

      {/* Modal: desistir proveedor */}
      {modal.kind === 'desistir' && (
        <MotivoModal
          title={`Desistimiento · ${modal.orden.codigo}`}
          confirmText="Registrar desistimiento"
          danger
          intro="Registra que el proveedor no cumplió. La orden quedará abierta para reasignar a otro proveedor."
          label="¿Por qué no cumplió?"
          placeholder="No respondió, no entregó a tiempo, retiró la propuesta…"
          onClose={() => setModal({ kind: 'none' })}
          onConfirm={async (motivo) => {
            try {
              await desistirProveedor(
                modal.orden,
                usuario?.email ?? user?.email ?? 'sistema',
                motivo
              );
              notify(`Proveedor desistió en ${modal.orden.codigo} · abierta para reasignar`, 'warning', { link: '#/app/pedidos' });
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error', 'error');
            }
          }}
        />
      )}

      {/* Modal: anular OC (pendiente de aprobación del gerente) */}
      {modal.kind === 'anular-oc' && (
        <MotivoModal
          title={`Anular OC · ${modal.orden.oc_codigo ?? modal.orden.codigo}`}
          confirmText="Anular OC"
          danger
          confirmMessage={`¿Seguro que querés anular la OC ${modal.orden.oc_codigo ?? modal.orden.codigo}? Esta acción no se puede deshacer.`}
          intro="La OC pasa a estado ANULADA y no continúa el flujo. No mueve inventario ni caja."
          label="Motivo de la anulación"
          placeholder="Ya no se requiere, error de carga, se reemplaza por otra…"
          onClose={() => setModal({ kind: 'none' })}
          onConfirm={async (motivo) => {
            try {
              await anularOrden(modal.orden, usuario?.email ?? user?.email ?? 'sistema', motivo);
              notify(`OC anulada: ${modal.orden.oc_codigo ?? modal.orden.codigo}`, 'warning', { link: '#/app/pedidos' });
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error al anular', 'error');
            }
          }}
        />
      )}

      {/* Modal: modificar OC → vuelve a la etapa de ofertas para re-elegir */}
      {modal.kind === 'modificar-oc' && (
        <ConfirmDialog
          title={`Modificar OC · ${modal.orden.oc_codigo ?? modal.orden.codigo}`}
          message="La OC vuelve a “Pendiente · cargar ofertas”: se reabren las ofertas de los proveedores para que elijas de nuevo la ganadora. ¿Continuar?"
          confirmText="Modificar (volver a ofertas)"
          onCancel={() => setModal({ kind: 'none' })}
          onConfirm={async () => {
            try {
              await reabrirOcAOfertas(modal.orden, usuario?.email ?? user?.email ?? 'sistema');
              notify(`OC ${modal.orden.oc_codigo ?? modal.orden.codigo} reabierta para re-elegir oferta`, 'info', { link: '#/app/pedidos' });
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error al modificar', 'error');
            }
          }}
        />
      )}

      {/* Modal: indicar método de pago (multipago) → Enviar para Pagar */}
      {modal.kind === 'metodo-pago' && (
        <MetodoPagoModal
          orden={modal.orden}
          proveedores={proveedores}
          proveedorActual={modal.orden.proveedor_id ? proveedorMap.get(modal.orden.proveedor_id) ?? null : null}
          onClose={() => setModal({ kind: 'none' })}
          onSent={async (metodos, soporte, proveedorId, qr, descuentoPago) => {
            try {
              const email = usuario?.email ?? user?.email ?? 'sistema';
              const codigo = modal.orden.oc_codigo ?? modal.orden.codigo;
              // Si se cambió el proveedor, NO va a pago: vuelve a aprobación del Gerente.
              if (proveedorId && proveedorId !== modal.orden.proveedor_id) {
                await reasignarProveedorAReaprobacion(modal.orden, proveedorId, email);
                notify(`OC ${codigo} · proveedor cambiado → vuelve a Pendiente por aprobación (Gerente General)`, 'info', { link: '#/app/pedidos' });
                setModal({ kind: 'none' });
                await refresh();
                return;
              }
              await indicarMetodoPago(modal.orden, metodos, email, soporte, qr, descuentoPago);
              const extra = soporte.comprobanteTipo === 'factura' ? ' · enviada también a Retenciones' : '';
              notify(`OC ${codigo} enviada para pagar · disponible en Tesorería${extra}`, 'success', { link: '#/app/tesoreria' });
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error al enviar para pagar', 'error');
            }
          }}
        />
      )}

      {/* Modal: recepción (parcial) — confirma cuánto entró por ítem */}
      {modal.kind === 'receive' && (
        <RecepcionParcialModal
          orden={modal.orden}
          onClose={() => setModal({ kind: 'none' })}
          onConfirm={async (recepciones, nota, almacenDestino, sinInventario) => {
            try {
              await recibirOrdenParcial(
                modal.orden,
                recepciones,
                nota,
                usuario?.email ?? user?.email ?? 'sistema',
                usuario?.nombre ?? null,
                almacenDestino,
                sinInventario,
              );
              const esContra = modal.orden.condiciones_pago === 'contra_entrega';
              const omitio = sinInventario || modal.orden.sin_inventario === true;
              notify(
                esContra
                  ? `Recepción confirmada · ${modal.orden.codigo} · indicá el método para pagar lo recibido`
                  : omitio
                    ? `Recepción confirmada · ${modal.orden.codigo} · sin sumar al inventario (carga manual)`
                    : `Mercancía recibida · ${modal.orden.codigo} · stock actualizado`,
                'success', { link: esContra || omitio ? '#/app/pedidos' : '#/app/inventario' },
              );
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error al recibir', 'error');
            }
          }}
        />
      )}

      {/* Modal: registrar abono / ver crédito (cuenta abierta) */}
      {modal.kind === 'abono' && (
        <AbonosModal
          orden={modal.orden}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}

      {/* Modal: finalizar pedido + evaluación de recepción (calidad/puntualidad/comentario) */}
      {modal.kind === 'finalizar' && (
        <FinalizarPedidoModal
          orden={modal.orden}
          rolEvaluador={usuario?.role === 'obrero' ? 'almacenista' : 'jefe'}
          onClose={() => setModal({ kind: 'none' })}
          onConfirm={async ({ calidad, puntualidadDias, comentario, factura }) => {
            const actor = usuario?.email ?? user?.email ?? 'sistema';
            // Registrar la evaluación (queda en la trazabilidad PDF y en el correo).
            if (modal.orden.proveedor_id) {
              await crearEvaluacion({
                orden_id: modal.orden.id,
                proveedor_id: modal.orden.proveedor_id,
                calidad,
                puntualidad_dias: puntualidadDias,
                comentario: comentario || null,
                evaluado_por_email: actor,
                evaluado_por_rol: usuario?.role === 'obrero' ? 'almacenista' : 'jefe',
              });
            }
            await finalizarPedido(modal.orden, actor, factura);
            notify(`Pedido finalizado · ${modal.orden.codigo}`, 'success', { link: '#/app/pedidos' });
            setModal({ kind: 'none' });
            await refresh();
          }}
        />
      )}

      {/* Modal: histórico de precios (FASE 1) */}
      {modal.kind === 'price-history' && (
        <HistoricoPreciosModal
          sku={modal.sku}
          nombre={modal.nombre}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Gate: carga ofertas existentes y abre AgregarOfertaModal
   ───────────────────────────────────────────── */
function AddOfferGate({
  orden,
  proveedores,
  registradoPorEmail,
  onClose,
  onCreated,
}: {
  orden: Orden;
  proveedores: Proveedor[];
  registradoPorEmail: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [ya, setYa] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    listOfertasByOrden(orden.id)
      .then((rows) => { if (!cancelled) setYa(new Set(rows.map((r) => r.proveedor_id))); })
      .catch(() => { if (!cancelled) setYa(new Set()); });
    return () => { cancelled = true; };
  }, [orden.id]);

  if (!ya) return null;
  return (
    <AgregarOfertaModal
      orden={orden}
      proveedores={proveedores}
      proveedoresYaOfertados={ya}
      registradoPorEmail={registradoPorEmail}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

/* ─────────────────────────────────────────────
   Modal: finalizar pedido + evaluación de recepción
   ───────────────────────────────────────────── */
function FinalizarPedidoModal({
  orden,
  rolEvaluador,
  onClose,
  onConfirm,
}: {
  orden: Orden;
  rolEvaluador: 'almacenista' | 'jefe';
  onClose: () => void;
  onConfirm: (data: { calidad: number; puntualidadDias: number; comentario: string; factura: File | null }) => Promise<void>;
}) {
  const [factura, setFactura] = useState<File | null>(null);
  const [calidad, setCalidad] = useState(5);
  const [puntualidad, setPuntualidad] = useState<'por_fecha' | 'en_fecha' | 'adelantado' | 'atrasado'>('por_fecha');
  const [dias, setDias] = useState('1');
  const [comentario, setComentario] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fecha prometida (de la oferta elegida) vs fecha de recibido → calcula los días.
  const hoyISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
  const [fechaPrometida, setFechaPrometida] = useState('');
  const [fechaRecibido, setFechaRecibido] = useState(hoyISO);
  useEffect(() => {
    listOfertasByOrden(orden.id)
      .then((ofs) => {
        // La oferta elegida es la que casó con el proveedor de la orden (aceptada).
        const elegida = ofs.find((o) => o.estado === 'aceptada' && o.proveedor_id === orden.proveedor_id)
          ?? ofs.find((o) => o.proveedor_id === orden.proveedor_id)
          ?? ofs.find((o) => o.fecha_entrega_prometida);
        if (elegida?.fecha_entrega_prometida) setFechaPrometida(elegida.fecha_entrega_prometida.slice(0, 10));
      })
      .catch(() => { /* sin oferta: el usuario coloca la fecha prometida a mano */ });
  }, [orden.id, orden.proveedor_id]);

  // Días (firmado): + adelantado (recibido antes de lo prometido), − atrasado.
  const diasPorFecha = (() => {
    if (!fechaPrometida || !fechaRecibido) return null;
    const p = new Date(`${fechaPrometida}T00:00:00`).getTime();
    const r = new Date(`${fechaRecibido}T00:00:00`).getTime();
    if (isNaN(p) || isNaN(r)) return null;
    return Math.round((p - r) / 86_400_000);
  })();

  const CALIDAD_LABEL: Record<number, string> = {
    5: '5 · Excelente', 4: '4 · Buena', 3: '3 · Aceptable', 2: '2 · Deficiente', 1: '1 · Muy mala',
  };

  async function handle() {
    setError(null);
    let puntualidadDias: number;
    if (puntualidad === 'por_fecha') {
      if (diasPorFecha == null) { setError('Indicá la fecha prometida y la de recibido.'); return; }
      puntualidadDias = diasPorFecha;
    } else {
      const d = Math.max(0, Math.floor(Number(dias) || 0));
      puntualidadDias = puntualidad === 'en_fecha' ? 0 : puntualidad === 'adelantado' ? d : -d;
    }
    setSaving(true);
    try {
      await onConfirm({ calidad, puntualidadDias, comentario: comentario.trim(), factura });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo finalizar');
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Finalizar pedido · ${orden.codigo}`}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={handle} disabled={saving}>
            {saving ? 'Finalizando…' : 'Finalizar'}
          </button>
        </>
      }
    >
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
        Confirmá que recibiste todo correctamente y evaluá la recepción
        {orden.proveedor_id ? ' del proveedor' : ''}. Esta evaluación queda en la
        <strong> trazabilidad PDF</strong> y en el correo.
      </p>

      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      <div className="form-row">
        <label>Calidad a evaluar *</label>
        <select className="select" value={calidad} onChange={(e) => setCalidad(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{CALIDAD_LABEL[n]}</option>)}
        </select>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>Puntualidad *</label>
          <select className="select" value={puntualidad} onChange={(e) => setPuntualidad(e.target.value as typeof puntualidad)}>
            <option value="por_fecha">Por fecha prometida</option>
            <option value="en_fecha">En la fecha prometida</option>
            <option value="adelantado">Adelantado</option>
            <option value="atrasado">Atrasado</option>
          </select>
        </div>
        {(puntualidad === 'adelantado' || puntualidad === 'atrasado') && (
          <div className="form-row">
            <label>Días {puntualidad === 'adelantado' ? 'de adelanto' : 'de atraso'}</label>
            <input className="input mono" type="number" min={0} step={1} value={dias} onChange={(e) => setDias(e.target.value)} />
          </div>
        )}
      </div>

      {/* Por fecha prometida: fecha de la oferta vs. fecha de recibido → calcula los días */}
      {puntualidad === 'por_fecha' && (
        <>
          <div className="form-grid">
            <div className="form-row">
              <label>Fecha prometida (de la oferta)</label>
              <input className="input" type="date" value={fechaPrometida} onChange={(e) => setFechaPrometida(e.target.value)} />
              <small className="muted">{fechaPrometida ? 'Tomada de la oferta del proveedor; podés ajustarla.' : 'La oferta no tiene fecha prometida: colocala acá.'}</small>
            </div>
            <div className="form-row">
              <label>Fecha de recibido</label>
              <input className="input" type="date" value={fechaRecibido} onChange={(e) => setFechaRecibido(e.target.value)} />
              <small className="muted">Por defecto, hoy.</small>
            </div>
          </div>
          {diasPorFecha != null && (
            <div className="card" style={{ margin: '.1rem 0 .6rem' }}>
              {diasPorFecha === 0
                ? <>✓ Recibido <strong>en la fecha prometida</strong>.</>
                : diasPorFecha > 0
                  ? <>✓ Recibido <strong>{diasPorFecha} día(s) antes</strong> de lo prometido (adelantado).</>
                  : <>⚠ Recibido <strong>{Math.abs(diasPorFecha)} día(s) después</strong> de lo prometido (atrasado).</>}
            </div>
          )}
        </>
      )}

      {/* Cargar la factura al finalizar (queda en la calificación del proveedor). */}
      <div className="form-row">
        <label>CARGAR FACTURA {orden.factura_path ? '(reemplaza la actual)' : ''}</label>
        <input className="input" type="file" accept="application/pdf,image/*"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f && f.size > 10 * 1024 * 1024) { setError('La factura no puede superar 10 MB.'); e.target.value = ''; return; }
            setError(null); setFactura(f);
          }} />
        {factura
          ? <small className="muted">✓ {factura.name} ({(factura.size / 1024).toFixed(0)} KB)</small>
          : <small className="muted">PDF o imagen · máx. 10 MB.</small>}
      </div>

      <div className="form-row">
        <label>Comentario adicional (opcional)</label>
        <textarea className="input" rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)}
          placeholder="Observaciones de la recepción…" />
      </div>
      <small className="muted">Evaluador: {rolEvaluador === 'jefe' ? 'Jefe / analista' : 'Almacenista'}.</small>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Modal: indicar método de pago (multipago) y enviar a pagar
   ───────────────────────────────────────────── */
/** Moneda implícita según el método de pago (ya no se elige a mano). */
function monedaPorMetodo(metodo: string): string {
  if (metodo === 'efectivo_bs' || metodo === 'transferencia' || metodo === 'pago_movil') return 'Bs';
  if (metodo === 'binance_usdt') return 'USDT';
  return 'USD'; // divisas_efectivo, zelle, otro
}
/** Monto con su moneda ($ para USD, "Bs 1.000,00" para el resto). */
function fmtMonto(n: number, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

function MetodoPagoModal({
  orden,
  proveedores,
  proveedorActual,
  onClose,
  onSent,
}: {
  orden: Orden;
  proveedores: Proveedor[];
  proveedorActual: Proveedor | null;
  onClose: () => void;
  onSent: (metodos: PagoMetodo[], soporte: { comprobanteTipo: 'nota_entrega' | 'factura'; retencionModo: 'se_paga_despues' | 'completo_reembolso' | null }, proveedorId: string, qr: File | null, descuentoPago: number | null) => Promise<void> | void;
}) {
  const [legs, setLegs] = useState<PagoMetodo[]>([{ metodo: 'divisas_efectivo', moneda: monedaPorMetodo('divisas_efectivo'), monto: 0 }]);
  const [qr, setQr] = useState<File | null>(null); // imagen / QR de pago (ej. QR de Binance) para Tesorería
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Datos de pago del proveedor ya guardados (para precargar por método).
  const [datosGuardados, setDatosGuardados] = useState<Record<string, DatosPago>>({});
  // Proveedor de la OC: se puede cambiar acá (la orden ya está aprobada; solo se reasigna).
  const [proveedorId, setProveedorId] = useState<string>(orden.proveedor_id ?? '');
  const proveedorCambiado = !!orden.proveedor_id && proveedorId !== orden.proveedor_id;
  // Lista para el selector: activos + el actual (aunque esté inactivo), sin duplicar.
  const proveedoresSel = useMemo(() => {
    const out = [...proveedores];
    if (proveedorActual && !out.some((p) => p.id === proveedorActual.id)) out.unshift(proveedorActual);
    return out;
  }, [proveedores, proveedorActual]);
  // Contra entrega: ya se recibió y verificó; se confirma la Nota de entrega antes de pagar.
  const esContraEntrega = orden.condiciones_pago === 'contra_entrega';
  const [notaEntrega, setNotaEntrega] = useState(false);
  // Soporte: Nota de entrega → directo a Tesorería. Factura → además pasa por Retenciones.
  const [comprobanteTipo, setComprobanteTipo] = useState<'nota_entrega' | 'factura'>('nota_entrega');
  const [retencionModo, setRetencionModo] = useState<'se_paga_despues' | 'completo_reembolso'>('se_paga_despues');
  // Descuento en el pago (opcional): reduce el monto a pagar en Tesorería (no el total OC).
  // Se puede indicar en % (sobre el total) o como monto manual.
  const [incluyeDesc, setIncluyeDesc] = useState(false);
  const [descModo, setDescModo] = useState<'monto' | 'pct'>('monto');
  const [descStr, setDescStr] = useState('');
  const monedaOrden = orden.moneda ?? 'USD';
  const baseTotal = esContraEntrega && orden.recibido_total != null ? Number(orden.recibido_total) : Number(orden.total);
  const descPct = incluyeDesc && descModo === 'pct' ? Math.max(0, Math.min(100, Number(descStr) || 0)) : 0;
  const descNum = !incluyeDesc ? 0
    : descModo === 'pct'
      ? Math.round(baseTotal * descPct) / 100                              // total × % , a 2 decimales
      : Math.max(0, Math.round((Number(descStr) || 0) * 100) / 100);       // monto manual
  const netoAPagar = Math.round(Math.max(0, baseTotal - descNum) * 100) / 100;

  // Precarga los datos de pago guardados del proveedor SELECCIONADO (no del original).
  useEffect(() => {
    if (!proveedorId) { setDatosGuardados({}); return; }
    listDatosPago(proveedorId).then(setDatosGuardados).catch(() => setDatosGuardados({}));
  }, [proveedorId]);

  // Al cambiar de proveedor, los datos de cuenta cargados ya no aplican: se reinician los métodos.
  function cambiarProveedor(id: string) {
    setProveedorId(id);
    setLegs([{ metodo: 'divisas_efectivo', moneda: monedaPorMetodo('divisas_efectivo'), monto: 0 }]);
  }

  function setLeg(i: number, patch: Partial<PagoMetodo>) {
    setLegs((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  }
  // Al cambiar de método, precarga los datos guardados del proveedor para ese método.
  function cambiarMetodo(i: number, metodo: string) {
    setLeg(i, { metodo, moneda: monedaPorMetodo(metodo), datos: requiereDatos(metodo) ? (datosGuardados[metodo] ?? {}) : undefined });
  }
  function addLeg() { setLegs((ls) => [...ls, { metodo: 'transferencia', moneda: monedaPorMetodo('transferencia'), monto: 0, datos: datosGuardados['transferencia'] ?? {} }]); }
  function removeLeg(i: number) { setLegs((ls) => ls.filter((_, k) => k !== i)); }

  const validos = legs.filter((l) => l.metodo && l.moneda);
  // Multipago = 2+ métodos: ahí sí se indica desde la OC cuánto va por cada moneda.
  const esMultipago = validos.length > 1;
  // Total indicado por moneda (informa a Tesorería el reparto previsto).
  const totalesPorMoneda = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of validos) if ((l.monto ?? 0) > 0) m.set(l.moneda, Math.round(((m.get(l.moneda) ?? 0) + Number(l.monto)) * 100) / 100);
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs]);

  async function handleSend() {
    setError(null);
    if (!proveedorId) { setError('Indicá el proveedor.'); return; }
    // Si cambió el proveedor, la OC vuelve a aprobación del Gerente: no se exige método de pago.
    if (!proveedorCambiado) {
      if (!validos.length) { setError('Indicá al menos un método de pago.'); return; }
      // En multipago, cada método/moneda debe llevar su monto (es el reparto que define la OC).
      if (esMultipago && validos.some((l) => !((l.monto ?? 0) > 0))) {
        setError('En multipago, indicá el monto por cada método/moneda.'); return;
      }
      if (esContraEntrega && !notaEntrega) { setError('Confirmá la Nota de entrega (verificaste lo recibido) antes de enviar a pagar.'); return; }
      if (incluyeDesc) {
        if (descNum <= 0) { setError('Indicá el monto del descuento o desmarcá «El pago incluye descuento».'); return; }
        if (descNum > baseTotal) { setError('El descuento no puede superar el total de la OC.'); return; }
      }
      // Validar datos del proveedor en los métodos que los requieren.
      for (const l of validos) {
        if (requiereDatos(l.metodo)) {
          const err = validarDatosPago(l.metodo, l.datos ?? {});
          if (err) { setError(`${METODOS_PAGO.find((m) => m.value === l.metodo)?.label}: ${err}`); return; }
        }
      }
    }
    setSaving(true);
    try { await onSent(validos, { comprobanteTipo, retencionModo: comprobanteTipo === 'factura' ? retencionModo : null }, proveedorId, qr, incluyeDesc && descNum > 0 ? descNum : null); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo enviar'); setSaving(false); }
  }

  return (
    <Modal
      title={orden.clase === 'servicio' ? `Método de pago · SERVICIO ${orden.codigo}` : `Método de pago · OC ${orden.oc_codigo ?? orden.codigo}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSend} disabled={saving}>
            {saving ? 'Enviando…' : proveedorCambiado ? '↩ Reenviar a aprobación del Gerente' : '💳 Enviar para Pagar'}
          </button>
        </>
      }
    >
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
        Indicá <strong>con qué método(s)</strong> se va a pagar la OC ({orden.condiciones_pago === 'contra_entrega' && orden.recibido_total != null
          ? <>recibido <strong>{money(orden.recibido_total)}</strong></>
          : <>total <strong>{money(orden.total)}</strong></>}). Podés combinar
        varios (<strong>multipago</strong>); en ese caso <strong>indicá cuánto va por cada método/moneda</strong>. Con un solo método, el monto lo define Tesorería al pagar. Al enviar pasa a <strong>Confirmada pagar</strong> y aparece en Tesorería.
      </p>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      {/* Proveedor: la OC ya está aprobada; acá se puede reasignar a otro proveedor (solo cambia el proveedor). */}
      <div className="card" style={{ margin: '0 0 .75rem', padding: '.7rem .85rem', borderColor: proveedorCambiado ? 'var(--brand, #ff8a00)' : 'var(--border)' }}>
        <div className="card-title" style={{ marginBottom: '.45rem' }}>Proveedor</div>
        <select className="select" value={proveedorId} onChange={(e) => cambiarProveedor(e.target.value)}>
          {!proveedorId && <option value="">— Elegí el proveedor —</option>}
          {proveedoresSel.map((p) => (
            <option key={p.id} value={p.id}>{p.razon_social}{p.rif ? ` · ${p.rif}` : ''}</option>
          ))}
        </select>
        {proveedorCambiado && (
          <small className="muted" style={{ display: 'block', marginTop: '.4rem', color: 'var(--brand, #ff8a00)' }}>
            ⚠️ Cambiarás el proveedor de la OC (de <strong>{proveedorActual?.razon_social ?? '—'}</strong>). Al cambiarlo, la OC <strong>vuelve a “Pendiente por aprobación (Gerente General)”</strong> para que el gerente la confirme de nuevo; el método de pago se indicará después. Los ítems y montos se conservan.
          </small>
        )}
      </div>

      {proveedorCambiado ? (
        <div className="card" style={{ margin: 0, padding: '.85rem 1rem', borderColor: 'var(--brand, #ff8a00)' }}>
          <strong>No hace falta indicar el método de pago.</strong> Al cambiar el proveedor, la OC vuelve a aprobación del Gerente; el método se indicará cuando él la confirme de nuevo.
        </div>
      ) : (
      <>
      {/* Soporte: Nota de entrega (directo a Tesorería) vs Factura (pasa por Retenciones) */}
      <div className="card" style={{ margin: '0 0 .75rem', padding: '.7rem .85rem' }}>
        <div className="card-title" style={{ marginBottom: '.45rem' }}>Tipo de soporte</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.5rem' }}>
          <label className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', margin: 0, padding: '.55rem .7rem', cursor: 'pointer', borderColor: comprobanteTipo === 'nota_entrega' ? 'var(--brand, #ff8a00)' : 'var(--border)' }}>
            <input type="radio" name="comprobante" checked={comprobanteTipo === 'nota_entrega'} onChange={() => setComprobanteTipo('nota_entrega')} style={{ marginTop: '.2rem' }} />
            <span style={{ fontSize: '.86rem' }}><strong>Nota de entrega</strong></span>
          </label>
          <label className="card" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', margin: 0, padding: '.55rem .7rem', cursor: 'pointer', borderColor: comprobanteTipo === 'factura' ? 'var(--brand, #ff8a00)' : 'var(--border)' }}>
            <input type="radio" name="comprobante" checked={comprobanteTipo === 'factura'} onChange={() => setComprobanteTipo('factura')} style={{ marginTop: '.2rem' }} />
            <span style={{ fontSize: '.86rem' }}><strong>Factura</strong></span>
          </label>
        </div>
        {comprobanteTipo === 'factura' && (
          <div style={{ marginTop: '.6rem', borderTop: '1px dashed var(--border)', paddingTop: '.6rem' }}>
            <div className="muted" style={{ fontSize: '.74rem', marginBottom: '.4rem' }}>Retención</div>
            <div style={{ display: 'grid', gap: '.35rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.86rem' }}>
                <input type="radio" name="ret-modo" checked={retencionModo === 'se_paga_despues'} onChange={() => setRetencionModo('se_paga_despues')} />
                Se paga después
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.86rem' }}>
                <input type="radio" name="ret-modo" checked={retencionModo === 'completo_reembolso'} onChange={() => setRetencionModo('completo_reembolso')} />
                Se paga completo y luego se reembolsa
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Imagen / QR de pago (opcional): ej. el QR de Binance para pagar por cripto.
          Se muestra en Tesorería al pagar, para escanear y pagar directo. */}
      <div className="card" style={{ margin: '0 0 .75rem', padding: '.7rem .85rem' }}>
        <div className="card-title" style={{ marginBottom: '.35rem' }}>Imagen / QR de pago <span className="muted" style={{ fontWeight: 400, fontSize: '.78rem' }}>(opcional · lo ve Tesorería al pagar)</span></div>
        <div className="muted" style={{ fontSize: '.76rem', marginBottom: '.5rem' }}>
          Subí una imagen (ej. el <strong>QR de Binance</strong> del pago en cripto): Tesorería la <strong>escanea y paga</strong> directo.
        </div>
        <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" accept="image/*" onChange={(e) => setQr(e.target.files?.[0] ?? null)} />
          {qr && (
            <>
              <img src={URL.createObjectURL(qr)} alt="QR de pago" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setQr(null)}>✕ Quitar</button>
            </>
          )}
        </div>
      </div>

      {/* Descuento en el pago (opcional): reduce el monto a pagar en Tesorería (el total OC no cambia). */}
      <div className="card" style={{ margin: '0 0 .75rem', padding: '.7rem .85rem', borderColor: incluyeDesc ? 'var(--brand, #ff8a00)' : 'var(--border)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={incluyeDesc} onChange={(e) => setIncluyeDesc(e.target.checked)} />
          <strong style={{ fontSize: '.9rem' }}>El pago incluye descuento</strong>
          <span className="muted" style={{ fontSize: '.76rem' }}>(se resta del monto a pagar en Tesorería)</span>
        </label>
        {incluyeDesc && (
          <div style={{ marginTop: '.6rem', borderTop: '1px dashed var(--border)', paddingTop: '.6rem' }}>
            <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.5rem' }}>
              <button type="button" className={descModo === 'monto' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                onClick={() => { setDescModo('monto'); setDescStr(''); }}>Monto ({monedaOrden})</button>
              <button type="button" className={descModo === 'pct' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                onClick={() => { setDescModo('pct'); setDescStr(''); }}>Porcentaje (%)</button>
            </div>
            <div className="form-row" style={{ margin: 0, maxWidth: 220 }}>
              <label>{descModo === 'pct' ? 'Descuento (%)' : `Descuento (${monedaOrden})`}</label>
              <input className="input mono" type="number" min={0} step="any" max={descModo === 'pct' ? 100 : undefined} value={descStr}
                onChange={(e) => setDescStr(e.target.value)} placeholder={descModo === 'pct' ? '0' : '0,00'} />
            </div>
            <div className="card" style={{ margin: '.6rem 0 0', padding: '.5rem .75rem', borderColor: 'var(--brand, #ff8a00)' }}>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span className="muted" style={{ fontSize: '.8rem' }}>Total OC <strong className="mono">{money(baseTotal)}</strong></span>
                <span className="muted" style={{ fontSize: '.8rem' }}>− Descuento <strong className="mono">{money(descNum)}</strong>{descModo === 'pct' && descPct > 0 ? ` (${descPct}%)` : ''}</span>
                <span style={{ fontSize: '.92rem' }}>A pagar <strong className="mono" style={{ color: 'var(--success)' }}>{money(netoAPagar)}</strong></span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: '.6rem' }}>
        {legs.map((l, i) => (
          <div key={i} className="card" style={{ margin: 0, padding: '.7rem' }}>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
                <label>Método</label>
                <select className="select" value={l.metodo} onChange={(e) => cambiarMetodo(i, e.target.value)}>
                  {METODOS_PAGO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              {esMultipago && (
                <div className="form-row" style={{ margin: 0, flex: '0 1 170px' }}>
                  <label>Monto ({l.moneda}) *</label>
                  <input className="input mono" type="number" min={0} step="any"
                    value={l.monto ? String(l.monto) : ''}
                    onChange={(e) => setLeg(i, { monto: Number(e.target.value) || 0 })}
                    placeholder="0,00" />
                </div>
              )}
              {legs.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeLeg(i)}>✕ Quitar</button>}
            </div>
            {requiereDatos(l.metodo) && (
              <div style={{ marginTop: '.6rem', borderTop: '1px dashed var(--border)', paddingTop: '.6rem' }}>
                <div className="muted" style={{ fontSize: '.74rem', marginBottom: '.4rem' }}>Datos del proveedor para pagarle (se guardan para próximas compras)</div>
                <DatosPagoFields metodo={l.metodo} value={l.datos ?? {}} onChange={(d) => setLeg(i, { datos: d })} />
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.5rem' }} onClick={addLeg}>+ Agregar método (multipago)</button>
      {esMultipago && totalesPorMoneda.length > 0 && (
        <div className="card" style={{ margin: '.6rem 0 0', padding: '.55rem .75rem', borderColor: 'var(--brand, #ff8a00)' }}>
          <div className="muted" style={{ fontSize: '.74rem', marginBottom: '.25rem' }}>Reparto indicado (lo confirma Tesorería al pagar)</div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {totalesPorMoneda.map(([m, v]) => (
              <strong key={m} className="mono" style={{ fontSize: '.9rem' }}>{fmtMonto(v, m)}</strong>
            ))}
          </div>
        </div>
      )}
      {esContraEntrega && (
        <label className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', marginTop: '.6rem', padding: '.55rem .7rem', cursor: 'pointer', borderColor: notaEntrega ? 'var(--success)' : 'var(--warning)' }}>
          <input type="checkbox" checked={notaEntrega} onChange={(e) => setNotaEntrega(e.target.checked)} style={{ marginTop: '.2rem' }} />
          <span style={{ fontSize: '.86rem' }}>
            <strong>Confirmo que la mercancía se recibió y verificó contra lo solicitado. Recién entonces se paga (contra entrega).</strong>
          </span>
        </label>
      )}
      <small className="muted" style={{ display: 'block', marginTop: '.4rem' }}>
        Si el método es <strong>en efectivo</strong> (divisas o Bs), en Tesorería <strong>no se exigirá comprobante</strong>.
      </small>
      </>
      )}
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Recepción parcial: confirma cuánto entró por ítem (≤ pedido) + nota
   ───────────────────────────────────────────── */
function RecepcionParcialModal({
  orden,
  onClose,
  onConfirm,
}: {
  orden: Orden;
  onClose: () => void;
  onConfirm: (recepciones: { sku: string; cantidad_recibida: number }[], nota: string | null, almacenDestino: string, sinInventario: boolean) => Promise<void> | void;
}) {
  const [recs, setRecs] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    orden.items.forEach((it) => { m[it.sku] = String(it.cantidad); });
    return m;
  });
  const [nota, setNota] = useState('');
  // "Sin inventario": los productos ya se ingresaron manualmente, no sumar stock al recibir.
  const [sinInv, setSinInv] = useState<boolean>(orden.sin_inventario === true);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  // Un SERVICIO no se almacena por sede: entra directo al inventario General (sin elegir almacén).
  const esServicio = orden.clase === 'servicio';
  const [almacen, setAlmacen] = useState<string>(esServicio ? 'General' : (orden.almacen_destino ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (esServicio) return; // los servicios no eligen almacén
    listAlmacenes().then((as) => {
      setAlmacenes(as);
      // Si la OC ya traía un destino, se respeta; si no, se preselecciona el primero.
      setAlmacen((prev) => prev || orden.almacen_destino || as[0]?.nombre || '');
    }).catch(() => setAlmacenes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setRec(sku: string, cantPedida: number, v: string) {
    const n = Number(v);
    if (Number.isFinite(n) && n > cantPedida) { setRecs((r) => ({ ...r, [sku]: String(cantPedida) })); return; }
    setRecs((r) => ({ ...r, [sku]: v }));
  }

  // Opciones del almacén destino agrupadas por SEDE, con cada subalmacén anidado
  // bajo su almacén padre (sangría con ↳). Así se ve el almacén y, unidos, sus subalmacenes.
  const gruposAlmacen = useMemo(() => {
    const activos = almacenes.filter((a) => a.estado === 'activo');
    const hijosDe = (pid: string | null) => activos
      .filter((a) => (a.parent_id ?? null) === pid)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const ids = new Set(activos.map((a) => a.id));
    // Recorre en profundidad desde las raíces para que cada sub salga debajo de su padre.
    const ordenar = (pid: string | null, nivel: number, acc: { a: Almacen; nivel: number }[]) => {
      for (const a of hijosDe(pid)) { acc.push({ a, nivel }); ordenar(a.id, nivel + 1, acc); }
    };
    const porSede = new Map<string, { a: Almacen; nivel: number }[]>();
    for (const sede of [...new Set(activos.map((a) => a.sede?.trim() || 'Sin sede'))].sort((x, y) => x.localeCompare(y, 'es'))) {
      const delaSede = activos.filter((a) => (a.sede?.trim() || 'Sin sede') === sede);
      const setSede = new Set(delaSede.map((a) => a.id));
      // raíces de la sede: sin padre, o cuyo padre no está en la sede.
      const acc: { a: Almacen; nivel: number }[] = [];
      for (const r of delaSede.filter((a) => !a.parent_id || !setSede.has(a.parent_id) || !ids.has(a.parent_id)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))) {
        acc.push({ a: r, nivel: 0 });
        ordenar(r.id, 1, acc);
      }
      porSede.set(sede, acc);
    }
    return [...porSede.entries()];
  }, [almacenes]);

  const recibidoTotal = orden.items.reduce((a, it) => a + (Number(recs[it.sku]) || 0) * Number(it.precio), 0);
  const hayDiferencia = orden.items.some((it) => (Number(recs[it.sku]) || 0) < Number(it.cantidad));

  async function handleConfirm() {
    setError(null);
    const recepciones = orden.items.map((it) => ({ sku: it.sku, cantidad_recibida: Number(recs[it.sku]) || 0 }));
    if (recepciones.every((r) => r.cantidad_recibida <= 0)) { setError('Indicá al menos una cantidad recibida.'); return; }
    if (!esServicio && !almacen.trim()) { setError('Elegí el almacén destino al que entra la mercancía.'); return; }
    if (hayDiferencia && !nota.trim()) { setError('Recibiste menos de lo pedido: indicá una nota explicando la diferencia.'); return; }
    setSaving(true);
    try { await onConfirm(recepciones, nota.trim() || null, almacen.trim(), sinInv); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo confirmar'); setSaving(false); }
  }

  return (
    <Modal
      title={`Confirmar recepción · ${orden.oc_codigo ?? orden.codigo}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={saving}>
            {saving ? 'Confirmando…' : '📦 Confirmar recepción'}
          </button>
        </>
      }
    >
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
        Confirmá cuánto entró realmente al almacén por ítem. Solo lo recibido se suma al inventario.
        Si llegó menos de lo pedido, dejá una <strong>nota</strong>; la orden cierra sin saldo pendiente.
      </p>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>SKU</th><th>Producto</th><th style={{ textAlign: 'right' }}>Pedido</th><th style={{ textAlign: 'right' }}>Recibido</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
          <tbody>
            {orden.items.map((it) => {
              const rec = Number(recs[it.sku]) || 0;
              const falta = rec < Number(it.cantidad);
              return (
                <tr key={it.sku}>
                  <td className="mono">{it.sku}</td>
                  <td>{it.nombre}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <input className="input mono" type="number" min={0} max={it.cantidad} step="any"
                      value={recs[it.sku]} onChange={(e) => setRec(it.sku, Number(it.cantidad), e.target.value)}
                      style={{ width: 90, textAlign: 'right', borderColor: falta ? 'var(--warning)' : undefined }} />
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(rec * Number(it.precio))}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td colSpan={4} style={{ textAlign: 'right', fontWeight: 600 }}>Total recibido</td><td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(recibidoTotal)}</td></tr>
          </tfoot>
        </table>
      </div>

      {esServicio ? (
        <div className="form-row" style={{ marginTop: '.5rem' }}>
          <small className="muted">🔧 Es un <strong>servicio</strong>: no se elige almacén — lo recibido entra directo al <strong>inventario General</strong>.</small>
        </div>
      ) : (
      <div className="form-row" style={{ marginTop: '.5rem' }}>
        <label>Almacén destino *</label>
        <select className="select" value={almacen} onChange={(e) => setAlmacen(e.target.value)} required>
          <option value="">— elegí el almacén —</option>
          {gruposAlmacen.map(([sede, items]) => (
            <optgroup key={sede} label={sede}>
              {items.map(({ a, nivel }) => (
                <option key={a.id} value={a.nombre}>
                  {nivel > 0 ? `${'  '.repeat(nivel)}↳ ` : ''}{nombreCortoAlmacen(a, almacenes)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <small className="muted">La mercancía entra a este almacén (o subalmacén) y queda en la trazabilidad final.</small>
      </div>
      )}

      <div className="form-row" style={{ marginTop: '.5rem' }}>
        <label>Nota de recepción {hayDiferencia && <span style={{ color: 'var(--warning)' }}>(obligatoria · llegó menos de lo pedido)</span>}</label>
        <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)}
          placeholder="Diferencias, faltantes, observaciones de la recepción…" />
      </div>

      <div className="form-row" style={{ marginTop: '.5rem' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={sinInv} onChange={(e) => setSinInv(e.target.checked)} style={{ cursor: 'pointer' }} />
          <span>No sumar al inventario (productos ya ingresados manualmente)</span>
        </label>
        {sinInv && (
          <small className="muted" style={{ display: 'block', color: 'var(--warning)' }}>
            ⚠ Esta orden se recibirá y cerrará, pero <strong>no</strong> generará entradas de stock (evita duplicar lo cargado a mano).
          </small>
        )}
      </div>
      {orden.condiciones_pago === 'contra_entrega' && (
        <small className="muted" style={{ display: 'block' }}>
          Contra entrega: luego se indicará el método para pagar <strong>{money(recibidoTotal)}</strong> (lo recibido) en Tesorería.
        </small>
      )}
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Abonos de crédito: traza + nuevo abono (egreso real de caja)
   ───────────────────────────────────────────── */
function AbonosModal({
  orden,
  onClose,
}: {
  orden: Orden;
  onClose: () => void;
}) {
  const [abonos, setAbonos] = useState<AbonoCredito[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [ab, cj] = await Promise.all([
        listAbonos(orden.id),
        listCajasActivas().catch(() => [] as Caja[]),
      ]);
      setAbonos(ab); setCajas(cj);
    } finally { setLoading(false); }
  }, [orden.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const abonado = Number(orden.abonado_total) || abonos.reduce((a, b) => a + Number(b.monto), 0);
  const saldo = Math.round((Number(orden.total) - abonado) * 100) / 100;

  async function verComprobante(b: AbonoCredito) {
    if (!b.comprobante_path) return;
    try { await previewFileUrl(await urlAdjuntoOc(b.comprobante_path), b.comprobante_nombre ?? 'comprobante', 'Comprobante del abono'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el comprobante', 'error'); }
  }

  return (
    <Modal title={`Crédito · OC ${orden.oc_codigo ?? orden.codigo}`} size="lg" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div className="m-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.6rem', marginBottom: '.75rem' }}>
        <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
          <div className="muted" style={{ fontSize: '.7rem' }}>TOTAL</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{money(orden.total)}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
          <div className="muted" style={{ fontSize: '.7rem' }}>ABONADO</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary-3)' }}>{money(abonado)}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
          <div className="muted" style={{ fontSize: '.7rem' }}>SALDO</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: saldo > 0 ? 'var(--warning)' : 'var(--success)' }}>{money(saldo)}</div>
        </div>
      </div>

      {/* Los abonos se registran en Tesorería; acá es solo consulta. */}
      <div className="card" style={{ padding: '.65rem .8rem', marginBottom: '.75rem', borderColor: saldo <= 0 ? 'var(--success)' : 'var(--brand, #ff8a00)' }}>
        <small style={{ fontSize: '.84rem' }}>
          {saldo <= 0
            ? <>✅ <strong>Crédito pagado en su totalidad.</strong> Desde el detalle de la orden podés enviarla a <strong>Pendiente por recepción</strong> o finalizarla si ya llegó.</>
            : <>💳 Los <strong>abonos se registran en Tesorería</strong> → <strong>Cuentas por pagar (créditos)</strong>. Acá ves el historial.</>}
        </small>
      </div>

      {/* Traza de abonos */}
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr><th>Fecha</th><th style={{ textAlign: 'right' }}>Monto</th><th style={{ textAlign: 'right' }}>Comisión banc.</th><th>Caja</th><th style={{ textAlign: 'right' }}>Saldo</th><th>Comprobante</th><th>Nota</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="muted">Cargando…</td></tr>
            ) : !abonos.length ? (
              <tr><td colSpan={7}><EmptyState message="Sin abonos todavía." icon="💵" /></td></tr>
            ) : abonos.map((b) => (
              <tr key={b.id}>
                <td className="muted" style={{ fontSize: '.78rem' }}>{dateTime(b.at)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(Number(b.monto))} {b.moneda}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{Number(b.comision_monto) > 0 ? `${money(Number(b.comision_monto))} ${b.comision_moneda || 'Bs'}` : '—'}</td>
                <td>{cajas.find((c) => c.id === b.caja_id)?.nombre ?? '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{b.saldo_restante != null ? money(Number(b.saldo_restante)) : '—'}</td>
                <td>{b.comprobante_path
                  ? <button className="btn btn-sm btn-ghost" onClick={() => void verComprobante(b)} title="Ver comprobante (vista previa)" style={{ padding: 0 }}>📎 Ver</button>
                  : <span className="muted">—</span>}</td>
                <td className="muted" style={{ fontSize: '.78rem' }}>{b.nota || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Sub-componente: tabla (vista Lista)
   ───────────────────────────────────────────── */
interface OrdenesTableProps {
  ordenes: Orden[];
  proveedorMap: Map<string, Proveedor>;
  /** email → nombre completo, para mostrar el nombre del solicitante (no la unidad). */
  personaMap: Map<string, string>;
  /** Quién puede aprobar la Solicitud de Pedido: administrador o analista de compras. */
  canManageProcurement: boolean;
  noLeidos: Map<string, number>;
  onView: (id: string) => void;
  onApprove: (o: Orden) => void;
}
function OrdenesTable({ ordenes, proveedorMap, personaMap, canManageProcurement, noLeidos, onView, onApprove }: OrdenesTableProps) {
  if (!ordenes.length) {
    return (
      <div className="card">
        <EmptyState message="Sin órdenes que coincidan." icon="✉" />
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Código</th>
            <th>Proveedor</th>
            <th>Solicitante</th>
            <th style={{ textAlign: 'right' }}>Ítems</th>
            <th style={{ textAlign: 'right' }}>Total</th>
            <th>Estado</th>
            <th>Fecha</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {ordenes.map((o) => {
            const prov = o.proveedor_id ? proveedorMap.get(o.proveedor_id) : undefined;
            const canApprove = canManageProcurement && o.estado === 'pendiente';
            const cambios = (o.historial ?? []).filter((h) => h.evento === 'proveedor_cambiado').length;
            return (
              <tr key={o.id} className="row-selectable" style={{ cursor: 'pointer' }} onClick={() => onView(o.id)} title="Ver detalle">
                <td className="mono">
                  {o.codigo}
                  {o.urgente && <span className="badge" style={{ marginLeft: '.35rem', background: 'var(--danger)', color: '#fff', fontSize: '.6rem', padding: '.05rem .35rem' }}>🚨 URGENTE</span>}
                  {(noLeidos.get(o.id) ?? 0) > 0 && (
                    <span className="badge" title={`${noLeidos.get(o.id)} mensaje(s) sin leer`} style={{ marginLeft: '.35rem', background: 'var(--primary)', color: '#fff', fontSize: '.6rem', padding: '.05rem .4rem' }}>💬 {noLeidos.get(o.id)}</span>
                  )}
                </td>
                <td>
                  <div>{prov?.razon_social ?? '—'}</div>
                  {cambios > 0 && (
                    <div className="muted" style={{ fontSize: '.72rem' }}>
                      ↻ {cambios} cambio(s) de proveedor
                    </div>
                  )}
                </td>
                <td>
                  <div>{o.solicitante_persona ?? o.ci_solicitante ?? persona(o.solicitante_email, personaMap)}</div>
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{o.items.length}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(o.total, o.moneda)}</td>
                <td><StatusBadge estado={o.estado} /></td>
                <td className="muted" style={{ fontSize: '.82rem' }}>{dateTime(o.created_at)}</td>
                <td className="actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-sm btn-ghost" onClick={() => onView(o.id)}>Ver</button>
                  {canApprove && (
                    <button className="btn btn-sm btn-success" onClick={() => onApprove(o)}>Aprobar</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Sub-componente: Kanban
   ───────────────────────────────────────────── */
interface KanbanBoardProps {
  ordenes: Orden[];
  proveedorMap: Map<string, Proveedor>;
  cols: { key: EstadoOrden; label: string }[];
  onOpen: (id: string) => void;
  noLeidos: Map<string, number>;
  /** Máximo de tarjetas por columna (el resto se consulta en el Histórico). Sin definir = sin límite. */
  maxPorColumna?: number;
  /** Columnas exentas del límite (se muestran completas). */
  columnasSinLimite?: EstadoOrden[];
}
function KanbanBoard({ ordenes, proveedorMap, cols, onOpen, noLeidos, maxPorColumna, columnasSinLimite }: KanbanBoardProps) {
  const byState = useMemo(() => {
    const map = new Map<EstadoOrden, Orden[]>();
    cols.forEach((c) => map.set(c.key, []));
    ordenes.forEach((o) => {
      const list = map.get(o.estado);
      if (list) list.push(o);
    });
    return map;
  }, [ordenes, cols]);
  const sinLimite = useMemo(() => new Set(columnasSinLimite ?? []), [columnasSinLimite]);

  return (
    <div className="kanban">
      {cols.map((col) => {
        const items = byState.get(col.key) ?? [];
        // Cap por columna: se muestran las primeras `maxPorColumna`; el resto queda en el Histórico.
        const limitada = maxPorColumna != null && !sinLimite.has(col.key) && items.length > maxPorColumna;
        const visibles = limitada ? items.slice(0, maxPorColumna) : items;
        const ocultas = items.length - visibles.length;
        return (
          <div className="kanban-col" data-state={col.key} key={col.key}>
            <div className="kanban-col-head">
              <span className="title">{col.label}</span>
              <span className="count">{items.length}</span>
            </div>
            <div className="kanban-col-body">
              {items.length === 0 ? (
                <div className="kanban-empty">Sin órdenes</div>
              ) : (
                <>
                  {visibles.map((o) => (
                    <KanbanCard
                      key={o.id}
                      orden={o}
                      proveedor={o.proveedor_id ? proveedorMap.get(o.proveedor_id) ?? null : null}
                      onOpen={onOpen}
                      sinLeer={noLeidos.get(o.id) ?? 0}
                    />
                  ))}
                  {ocultas > 0 && (
                    <Link to="/app/pedidos/historico" className="kanban-empty" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }} title="Ver las órdenes restantes en el Histórico">
                      + {ocultas} más · ver en el Histórico →
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const KanbanCard = memo(function KanbanCard({
  orden,
  proveedor,
  onOpen,
  sinLeer,
}: {
  orden: Orden;
  proveedor: Proveedor | null;
  onOpen: (id: string) => void;
  sinLeer: number;
}) {
  const changes = (orden.historial ?? []).filter((h) => h.evento === 'proveedor_cambiado').length;
  // Crédito pagado en su totalidad (cuenta abierta saldada) → tarjeta resaltada.
  const creditoPagado = orden.estado === 'cuenta_abierta' && (Number(orden.abonado_total) || 0) >= Number(orden.total) - 0.01;
  return (
    <div
      className="kanban-card"
      tabIndex={0}
      onClick={() => onOpen(orden.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(orden.id);
      }}
      style={orden.urgente
        ? { borderColor: 'var(--danger)', boxShadow: '0 0 0 1px var(--danger)' }
        : creditoPagado ? { borderColor: 'var(--success)', boxShadow: '0 0 0 1px var(--success)' } : undefined}
    >
      <div className="code" style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
        {orden.codigo}
        {orden.urgente && <span className="badge" style={{ background: 'var(--danger)', color: '#fff', fontSize: '.6rem', padding: '.05rem .35rem' }}>🚨 URGENTE</span>}
        {sinLeer > 0 && (
          <span className="badge" title={`${sinLeer} mensaje${sinLeer !== 1 ? 's' : ''} sin leer`}
            style={{ background: 'var(--primary)', color: '#fff', fontSize: '.6rem', padding: '.05rem .4rem', marginLeft: 'auto' }}>
            💬 {sinLeer}
          </span>
        )}
      </div>
      <div className="prov">
        {proveedor?.razon_social
          ?? ((orden.solicitante_persona ?? orden.ci_solicitante ?? orden.solicitante)
            ? `Solicita: ${orden.solicitante_persona ?? orden.ci_solicitante ?? orden.solicitante}`
            : 'Sin proveedor asignado')}
      </div>
      <div className="meta">
        <span>{orden.items.length} ítem{orden.items.length !== 1 ? 's' : ''}</span>
        {creditoPagado && (
          <span className="badge success" style={{ fontSize: '.62rem', padding: '.05rem .35rem' }}>
            ✓ Pagado · {orden.recibida_en ? 'finalizar' : 'a recepción'}
          </span>
        )}
        {changes > 0 && (
          <span className="badge warning" style={{ fontSize: '.65rem', padding: '.05rem .35rem' }}>
            ↻ {changes}
          </span>
        )}
      </div>
      <div className="meta" style={{ fontSize: '.72rem', marginTop: '.15rem' }} title="Solicitante y fecha de creación">
        <span>👤 {orden.solicitante_persona ?? orden.ci_solicitante ?? orden.solicitante ?? orden.solicitante_email ?? '—'}
          {(orden.solicitante_persona ?? orden.ci_solicitante) && orden.solicitante ? <span className="muted"> · {orden.solicitante}</span> : null}
        </span>
        <span className="muted">· {dateTime(orden.created_at)}</span>
      </div>
      <div className="foot">
        <span className="total">{money(orden.total, orden.moneda)}</span>
        <span className="when" title={dateTime(orden.created_at)}>{relTime(orden.created_at)}</span>
      </div>
    </div>
  );
});

/* ─────────────────────────────────────────────
   Modal: Detalle de la orden + historial
   ───────────────────────────────────────────── */
interface OrdenDetailModalProps {
  orden: Orden;
  proveedor: Proveedor | null;
  proveedorMap: Map<string, Proveedor>;
  personaMap: Map<string, string>;
  isAdmin: boolean;
  /** Puede autorizar (confirmar) la OC: Gerente General o Jefa de Administración (LEYDIS). */
  puedeAprobarOc: boolean;
  canManageProcurement: boolean;
  /** true cuando se abre desde la pestaña Órdenes de Compra (allí se gestionan ofertas/proveedor). */
  enOc: boolean;
  actorEmail: string;
  actorUserId: string;
  actorNombre: string;
  onClose: () => void;
  onApprove: () => void;
  onEditar: () => void;
  onEditarOc: () => void;
  onAsignar: () => void;
  onConfirmOc: () => void;
  onEnviarPagar: () => void;
  onCancel: () => void;
  onAnular: () => void;
  onModificar: () => void;
  onDesistir: () => void;
  onReceive: () => void;
  onAbono: () => void;
  onEnviarRecepcion: () => void;
  onFinalizar: () => void;
  onSeePriceHistory: (sku: string, nombre: string) => void;
  onAddOffer: () => void;
  onAcceptedOffer: () => void;
  onComprobanteSaved: () => Promise<void> | void;
  offersReloadKey: number;
  usuarioRole: string | null;
}
function OrdenDetailModal({
  orden: o,
  proveedor,
  proveedorMap,
  personaMap,
  isAdmin,
  puedeAprobarOc,
  canManageProcurement,
  enOc,
  actorEmail,
  actorUserId,
  actorNombre,
  onClose,
  onApprove,
  onEditar,
  onEditarOc,
  onAsignar,
  onConfirmOc,
  onEnviarPagar,
  onCancel,
  onAnular,
  onModificar,
  onDesistir,
  onReceive,
  onAbono,
  onEnviarRecepcion,
  onFinalizar,
  onSeePriceHistory,
  onAddOffer,
  onAcceptedOffer,
  onComprobanteSaved,
  offersReloadKey,
  usuarioRole,
}: OrdenDetailModalProps) {
  const isPendiente = o.estado === 'pendiente';
  // La OP la aprueba quien gestiona compras (admin o analista); al aprobarla pasa a
  // Órdenes de Compra. La elección de la oferta ganadora sí queda solo para el jefe/admin.
  const canApprove = canManageProcurement && isPendiente;  // Aprobar Orden de Pedido
  // Editar la OP mientras NO tenga OC creada (pendiente o aprobada): quien gestiona
  // compras o el propio solicitante que la creó. Con OC ya creada se usa «Editar OC».
  const canEditar = (isPendiente || o.estado === 'aprobada') && !o.oc_codigo
    && (canManageProcurement || o.solicitante_email === actorEmail);
  // Editar las CANTIDADES (inline) mientras la OC todavía no fue aprobada por el
  // Gerente: en la OP (pendiente/aprobada) y también en la OC recién creada sin
  // confirmar (oc_creada). Al guardar, se re-sincronizan las ofertas pendientes.
  const canEditarCant = (['pendiente', 'aprobada', 'oc_creada'].includes(o.estado))
    && (canManageProcurement || o.solicitante_email === actorEmail);
  const isOcCreada = o.estado === 'oc_creada';      // oferta elegida, sin confirmar
  const isConfirmadaMetodo = o.estado === 'confirmada_metodo'; // gerente confirmó → falta método de pago
  const isOcAprobada = o.estado === 'oc_aprobada';  // método indicado → Tesorería
  const isPagada = o.estado === 'pagada';
  const isOcEmitida = o.estado === 'oc_emitida';    // legado
  const isRecibida = o.estado === 'recibida';
  const isPorRecibir = o.estado === 'por_recibir';      // contra entrega / crédito saldado
  const isCuentaAbierta = o.estado === 'cuenta_abierta'; // a crédito, abonos abiertos
  const esContraEntrega = o.condiciones_pago === 'contra_entrega';
  // Contra entrega: tras recibir falta indicar método para pagar lo recibido.
  const contraEntregaPorPagar = isRecibida && esContraEntrega && !(o.metodo_pago && o.metodo_pago.length);
  // Contra entrega: ya pagó (tras recibir) → se puede finalizar.
  const contraEntregaFinalizar = isPagada && esContraEntrega && !!o.recibida_en;
  const canCancel = ['pendiente', 'aprobada'].includes(o.estado);

  const puedeTrazabilidad = ['recibida', 'finalizada', 'pagada'].includes(o.estado);
  const isFinalizada = o.estado === 'finalizada';
  // Las ofertas (añadir proveedor) se gestionan SOLO desde la pestaña Órdenes de Compra.
  const mostrarOfertas = enOc && ['aprobada', 'desistida_proveedor', 'oc_creada', 'confirmada_metodo', 'oc_aprobada', 'pagada'].includes(o.estado);

  // Crédito: ¿está totalmente pagado? (los abonos se hacen en Tesorería).
  const creditoSaldadoDet = isCuentaAbierta && (Number(o.abonado_total) || 0) >= Number(o.total) - 0.01;
  // Crédito saldado y ya recibido (entró antes de pagar) → se puede finalizar.
  const creditoFinalizable = creditoSaldadoDet && !!o.recibida_en;

  // Anticipado/contado/crédito finalizan desde 'recibida'. Contra entrega recibe
  // ANTES de pagar, así que NO finaliza en 'recibida' (debe pagar primero) sino en 'pagada'.
  const finalizableRecibida = isRecibida && !esContraEntrega;
  const canFinalizarOrden = (finalizableRecibida || contraEntregaFinalizar || creditoFinalizable) && (isAdmin || usuarioRole === 'analista');
  const canCerrarSolicitudObrero = finalizableRecibida && usuarioRole === 'obrero';

  const [enviarOpen, setEnviarOpen] = useState(false);
  const [comprobanteOpen, setComprobanteOpen] = useState(false);

  // Sub-OC por proveedor (si la OP se repartió entre varios proveedores).
  const [subOcs, setSubOcs] = useState<Orden[]>([]);
  useEffect(() => {
    if (o.parent_orden_id) { setSubOcs([]); return; }
    let cancel = false;
    listSubOcs(o.id).then((r) => { if (!cancel) setSubOcs(r); }).catch(() => { if (!cancel) setSubOcs([]); });
    return () => { cancel = true; };
  }, [o.id, o.parent_orden_id, offersReloadKey]);

  // Ítems de la OP madre que TODAVÍA no se asignaron a ninguna sub-OC (lo que falta por
  // comprar). Mientras queden, la SP madre sigue en "Pendiente (cargar ofertas)".
  const itemsPendientesAsignar = useMemo(() => {
    if (!subOcs.length) return [];
    const cubiertos = new Set(subOcs.flatMap((h) => (h.items ?? []).map((it) => it.sku)));
    return o.items.filter((it) => it.comprar !== false && !cubiertos.has(it.sku));
  }, [subOcs, o.items]);

  // Marca/desmarca un ítem como "a comprar" en la etapa OP (antes de tener precio).
  // Así una OP con 4 productos puede quedar con solo 2 aprobados para comprar.
  const [togglingSku, setTogglingSku] = useState<string | null>(null);
  async function toggleComprar(sku: string, comprar: boolean) {
    setTogglingSku(sku);
    try {
      await actualizarComprarItems(o, { [sku]: comprar }, actorEmail || 'sistema');
      await onAcceptedOffer(); // refresca la orden en el listado
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo actualizar el ítem', 'error');
    } finally {
      setTogglingSku(null);
    }
  }

  // Edición inline de CANTIDADES de la OP (etapa de selección de proveedores, antes
  // de elegir oferta): el analista corrige cuántas unidades pide de cada producto.
  // Al guardar se recalcula el total y se re-sincronizan las cotizaciones cargadas.
  const [editandoCant, setEditandoCant] = useState(false);
  const [cantDraft, setCantDraft] = useState<Record<string, string>>({});
  const [savingCant, setSavingCant] = useState(false);
  function abrirEdicionCant() {
    const d: Record<string, string> = {};
    o.items.forEach((it) => { d[it.sku] = String(it.cantidad ?? 0); });
    setCantDraft(d);
    setEditandoCant(true);
  }
  async function guardarCantidades() {
    const mapa: Record<string, number> = {};
    for (const it of o.items) {
      const v = Number(cantDraft[it.sku]);
      if (!Number.isFinite(v) || v <= 0) { toast(`La cantidad de "${it.nombre}" debe ser mayor que 0.`, 'error'); return; }
      mapa[it.sku] = v;
    }
    setSavingCant(true);
    try {
      await actualizarCantidadesOrden(o, mapa, actorEmail || 'sistema');
      toast('Cantidades actualizadas · comparativa recalculada', 'success');
      setEditandoCant(false);
      await onAcceptedOffer(); // refresca la orden + recarga las ofertas
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron actualizar las cantidades', 'error');
    } finally {
      setSavingCant(false);
    }
  }

  async function handleDownloadPdf() {
    try {
      // Carga jsPDF solo al generar (no al abrir la página).
      const { descargarTrazabilidadPdf } = await import('./trazabilidadPdf');
      await descargarTrazabilidadPdf(o.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error');
    }
  }
  function handleOcPdf() {
    import('./ordenCompraPdf')
      .then(({ descargarOrdenCompraPdf }) => descargarOrdenCompraPdf(o.id))
      .catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar', 'error'));
  }
  async function handleComprobante() {
    if (!o.factura_path) return;
    try {
      const url = await urlAdjuntoOc(o.factura_path);
      await previewFileUrl(url, o.factura_nombre ?? 'comprobante', 'Comprobante de la OC');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el comprobante', 'error');
    }
  }

  const buttons = (
    <>
      {/* Etapa OP: solo Aprobar / Rechazar Orden de Pedido + PDF de la OP. */}
      {isPendiente && (
        <button className="btn btn-ghost" onClick={handleDownloadPdf} title="Descargar la Orden de Pedido en PDF">
          ↓ PDF de la OP
        </button>
      )}
      {puedeTrazabilidad && (
        <button className="btn btn-ghost" onClick={handleDownloadPdf} title="Descargar trazabilidad en PDF">
          ↓ Trazabilidad PDF
        </button>
      )}
      {isFinalizada && (
        <button
          className="btn btn-ghost"
          onClick={() => setEnviarOpen(true)}
          title="Enviar la trazabilidad por correo"
        >
          📧 Enviar por correo
        </button>
      )}
      {isFinalizada && canManageProcurement && (
        <button
          className="btn btn-primary"
          onClick={() => setComprobanteOpen(true)}
          title="Cargar la factura o la nota de entrega (PDF o imagen). Al subirla, la OC entra a Retenciones."
        >
          📎 {o.factura_path ? 'Reemplazar factura / nota' : 'Cargar factura / nota de entrega'}
        </button>
      )}
      {canCancel && (
        <button className="btn btn-danger" onClick={onCancel}>Cancelar orden</button>
      )}
      {(o.estado === 'aprobada' || o.estado === 'asignada') && canManageProcurement && (
        <button className="btn btn-primary" onClick={onAsignar} title="Repartir los productos entre varios proveedores (una OC por proveedor)">
          🧩 Asignar por producto (multi-proveedor)
        </button>
      )}
      {/* Etapa OC: oferta ya elegida (sin confirmar). Se confirma individual o en lote (checklist). */}
      {isOcCreada && canManageProcurement && (
        <>
          <button className="btn btn-ghost" onClick={onDesistir} title="Proveedor no cumplió">⚠ Proveedor desistió</button>
          <button className="btn btn-ghost" onClick={onEditarOc} title="Editar cantidades, precios y condiciones de la OC antes de aprobarla">✎ Editar OC</button>
          <button className="btn btn-ghost" onClick={onModificar} title="Volver a la etapa de ofertas para re-elegir la oferta ganadora">↩ Re-elegir oferta</button>
          <button className="btn btn-ghost" onClick={handleOcPdf} title="Descargar la OC en PDF">↓ OC PDF</button>
          <button className="btn btn-danger" onClick={onAnular} title="Anular esta OC (queda en estado Anulada)">⊘ Anular OC</button>
        </>
      )}
      {/* Autorizar la OC = confirmación del Gerente General o de la Jefa de Administración
          (LEYDIS RENGEL). Cada uno firma con su propia firma en el PDF. */}
      {isOcCreada && puedeAprobarOc && (
        <button className="btn btn-success" onClick={onConfirmOc} title="Autorizar esta OC de forma puntual (sin pasar por el lote)">
          ✔ Aprobar OC
        </button>
      )}
      {/* Confirmada por el gerente: falta indicar el método de pago y enviar a pagar. */}
      {isConfirmadaMetodo && canManageProcurement && (
        <>
          <button className="btn btn-ghost" onClick={handleOcPdf} title="Descargar la OC en PDF">↓ OC PDF</button>
          <button className="btn btn-ghost" onClick={onEditarOc} title="Editar la OC. Al guardar, vuelve a aprobación del Gerente General">✎ Modificar OC</button>
          <button className="btn btn-primary" onClick={onEnviarPagar} title="Indicar método de pago y enviar a Tesorería">
            💳 Indicar método de pago / Enviar para Pagar
          </button>
          <button className="btn btn-danger" onClick={onAnular} title="Anular esta OC (aún no se pagó ni recibió)">⊘ Anular OC</button>
        </>
      )}
      {/* OC confirmada pagar: el pago se hace en Tesorería → Órdenes pendientes por pagar. */}
      {isOcAprobada && (
        <>
          <button className="btn btn-ghost" onClick={handleOcPdf} title="Descargar la OC en PDF">↓ OC PDF</button>
          {canManageProcurement && (
            <button className="btn btn-ghost" onClick={onEditarOc} title="Editar los precios de la OC. El nuevo total se sincroniza con Tesorería sin sacar la OC de pago; queda en la trazabilidad.">✎ Editar precios</button>
          )}
          {canManageProcurement && (
            <button className="btn btn-danger" onClick={onAnular} title="Anular esta OC (aún no se pagó en Tesorería)">⊘ Anular OC</button>
          )}
        </>
      )}
      {/* Crédito · cuenta abierta. Los abonos se registran en TESORERÍA; acá el
          analista hace seguimiento y mueve la orden según corresponda. */}
      {isCuentaAbierta && canManageProcurement && (
        <>
          <button className="btn btn-ghost" onClick={handleOcPdf} title="Descargar la OC en PDF">↓ OC PDF</button>
          <button className="btn btn-ghost" onClick={onAbono} title="Ver la cuenta del crédito y el historial de abonos">
            📋 Ver crédito / historial
          </button>
          {/* La mercancía llegó antes de terminar de pagar. */}
          {!o.recibida_en && !creditoSaldadoDet && (
            <button className="btn btn-ghost" onClick={onReceive} title="La mercancía llegó: recibir en inventario aunque el crédito siga pendiente">
              📦 Recibir (crédito pendiente)
            </button>
          )}
          {/* Pagado en su totalidad y aún sin recibir → a Pendiente por recepción. */}
          {creditoSaldadoDet && !o.recibida_en && (
            <button className="btn btn-primary" onClick={onEnviarRecepcion} title="Crédito pagado: enviar a Pendiente por recepción">
              📦 Enviar a Pendiente por recepción
            </button>
          )}
          {/* Crédito sin abonos todavía: se puede anular. */}
          {!(Number(o.abonado_total) || 0) && (
            <button className="btn btn-danger" onClick={onAnular} title="Anular esta OC a crédito (aún sin abonos)">⊘ Anular OC</button>
          )}
        </>
      )}
      {/* Pendiente por recepción (contra entrega / crédito saldado): confirmar lo recibido. */}
      {isPorRecibir && canManageProcurement && (
        <>
          <button className="btn btn-ghost" onClick={handleOcPdf} title="Descargar la OC en PDF">↓ OC PDF</button>
          <button className="btn btn-primary" onClick={onReceive}>📦 Confirmar recepción</button>
          {!o.recibida_en && (
            <button className="btn btn-danger" onClick={onAnular} title="Anular esta OC (aún no se recibió)">⊘ Anular OC</button>
          )}
        </>
      )}
      {/* Contra entrega ya recibida: indicar método para pagar SOLO lo recibido. */}
      {contraEntregaPorPagar && canManageProcurement && (
        <button className="btn btn-primary" onClick={onEnviarPagar} title="Indicar método de pago y enviar a Tesorería (paga lo recibido)">
          💳 Indicar método de pago (pagar lo recibido)
        </button>
      )}
      {/* Comprobante de pago cargado en Tesorería (disponible desde que la OC está pagada). */}
      {o.factura_path && (
        <button className="btn btn-ghost" onClick={handleComprobante} title={o.factura_nombre ?? 'Comprobante de pago'}>
          ↓ Comprobante de pago
        </button>
      )}
      {/* OC pagada y aún no recibida (anticipado/contado): ya se puede recibir.
          En contra entrega la recepción ocurrió ANTES del pago, así que no se repite. */}
      {isPagada && !o.recibida_en && canManageProcurement && (
        <>
          <button className="btn btn-ghost" onClick={handleOcPdf} title="Descargar la OC en PDF">↓ OC PDF</button>
          <button className="btn btn-primary" onClick={onReceive}>Marcar recibida</button>
        </>
      )}
      {/* Contra entrega pagada (ya recibida): solo queda el PDF; finaliza con el botón de abajo. */}
      {isPagada && o.recibida_en && canManageProcurement && (
        <button className="btn btn-ghost" onClick={handleOcPdf} title="Descargar la OC en PDF">↓ OC PDF</button>
      )}
      {isOcEmitida && canManageProcurement && (
        <>
          <button className="btn btn-ghost" onClick={onDesistir} title="Proveedor no cumplió">⚠ Proveedor desistió</button>
          <button className="btn btn-ghost" onClick={handleOcPdf} title="Volver a descargar el PDF de la OC">↓ OC PDF</button>
          <button className="btn btn-primary" onClick={onReceive}>Marcar recibida</button>
        </>
      )}
      {canFinalizarOrden && (
        <button className="btn btn-primary" onClick={onFinalizar} title="Marcar la orden como finalizada">
          ✓ Finalizar orden
        </button>
      )}
      {canCerrarSolicitudObrero && (
        <button className="btn btn-primary" onClick={onFinalizar} title="Confirmar recepción y cerrar tu solicitud">
          ✓ Cerrar solicitud
        </button>
      )}
      {canEditar && (
        <button className="btn btn-ghost" onClick={onEditar} title="Editar la orden antes de su aprobación">
          ✎ Editar orden
        </button>
      )}
      {canApprove && (
        <button className="btn btn-success" onClick={onApprove} title="Aprobar la Orden de Pedido">
          Aprobar Orden de Pedido
        </button>
      )}
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
    </>
  );

  return (
    <>
    <Modal title={`Orden ${o.codigo}${o.urgente ? ' · 🚨 URGENTE' : ''}`} size="lg" onClose={onClose} footer={buttons}>
      {o.urgente && (
        <div className="card" style={{ borderColor: 'var(--danger)', background: 'rgba(239,68,68,.08)', margin: '0 0 .75rem', padding: '.5rem .8rem', fontWeight: 700, color: 'var(--danger)' }}>
          🚨 ORDEN URGENTE — solicitud marcada como prioritaria.
        </div>
      )}
      {o.imagen_path && (
        <div className="detail-row">
          <div className="k">Imagen de referencia</div>
          <div className="v">
            <button className="btn btn-sm btn-ghost" onClick={async () => {
              try { const url = await urlAdjuntoOc(o.imagen_path!); window.open(url, '_blank', 'noopener'); }
              catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir la imagen', 'error'); }
            }}>📷 Ver imagen</button>
          </div>
        </div>
      )}
      <div className="detail-row">
        <div className="k">Código</div>
        <div className="v mono">{o.codigo}</div>
      </div>
      <div className="detail-row">
        <div className="k">Estado</div>
        <div className="v">
          <StatusBadge estado={o.estado} />
          {isCuentaAbierta && o.recibida_en && (
            <span className="badge warning" style={{ marginLeft: '.4rem' }}>📦 Recibido · pendiente por pagar</span>
          )}
        </div>
      </div>
      <div className="detail-row">
        <div className="k">Proveedor actual</div>
        <div className="v">
          {proveedor?.razon_social ?? '—'}{' '}
          <span className="muted mono">{proveedor?.rif ?? ''}</span>
        </div>
      </div>
      <div className="detail-row">
        <div className="k">Unidad solicitante</div>
        <div className="v">{o.solicitante ?? '—'}</div>
      </div>
      <div className="detail-row">
        <div className="k">Solicitante</div>
        <div className="v">
          {o.solicitante_persona ?? o.ci_solicitante ?? persona(o.solicitante_email, personaMap)}
        </div>
      </div>
      <div className="detail-row">
        <div className="k">Creada</div>
        <div className="v">{dateTime(o.created_at)}</div>
      </div>
      {o.notas?.trim() && (
        <div className="detail-row">
          <div className="k">Nota</div>
          <div className="v">{o.notas}</div>
        </div>
      )}
      {o.aprobada_en && (
        <div className="detail-row">
          <div className="k">Aprobada</div>
          <div className="v">
            {dateTime(o.aprobada_en)} <span className="muted">por {persona(o.aprobada_por, personaMap)}</span>
          </div>
        </div>
      )}
      {o.rechazada_en && (
        <div className="detail-row">
          <div className="k">Rechazada</div>
          <div className="v">{dateTime(o.rechazada_en)} · {o.motivo_rechazo ?? ''}</div>
        </div>
      )}
      {o.oc_codigo && (
        <div className="detail-row">
          <div className="k">Código OC</div>
          <div className="v mono">{o.oc_codigo}</div>
        </div>
      )}
      {o.oc_creada_en && (
        <div className="detail-row">
          <div className="k">OC creada</div>
          <div className="v">{dateTime(o.oc_creada_en)} <span className="muted">por {persona(o.oc_creada_por, personaMap)}</span></div>
        </div>
      )}
      {o.oc_aprobada_en && (
        <div className="detail-row">
          <div className="k">OC confirmada</div>
          <div className="v">{dateTime(o.oc_aprobada_en)} <span className="muted">por {persona(o.oc_aprobada_por, personaMap)}</span></div>
        </div>
      )}
      {o.oc_codigo && (
        <div className="detail-row">
          <div className="k">Condición de pago</div>
          <div className="v">
            <span className="badge" style={{ background: 'var(--primary-2)', color: '#fff', fontWeight: 600 }}>
              {o.condiciones_pago ? labelCondicionPago(o.condiciones_pago) : 'Contado / anticipado'}
            </span>
          </div>
        </div>
      )}
      {o.oc_codigo && (() => {
        // Datos de la oferta elegida (snapshot): técnicos, logística y precio BCV/efectivo.
        const d = o.oferta_detalle;
        // El descuento ya está aplicado en `total`; el BCV original se conserva para el ahorro.
        const bcvRef = o.oferta_precio_bcv ?? o.total;
        const ahorro = descuentoEfectivo(bcvRef, o.oferta_precio_efectivo);
        const labLog = (v?: string | null) => v === 'incluido' ? 'incluido' : v === 'por_cuenta' ? 'por cuenta del comprador' : null;
        const tecn = ([
          ['Marca', d?.marca], ['Modelo', d?.modelo], ['Procedencia', d?.procedencia],
          ['Materiales', d?.materiales], ['Dimensiones', d?.dimensiones], ['Peso', d?.peso], ['Calidad', d?.calidad],
        ] as [string, string | null | undefined][]).filter(([, v]) => v && String(v).trim());
        const log = ([
          ['Flete', d?.logistica?.flete], ['Transporte', d?.logistica?.transporte],
          ['Embalaje', d?.logistica?.embalaje], ['Seguros', d?.logistica?.seguros],
        ] as [string, string | null | undefined][]).map(([k, v]) => [k, labLog(v)] as const).filter(([, v]) => v);
        if (!tecn.length && !log.length && !ahorro) return null;
        return (
          <div className="detail-row">
            <div className="k">Datos de la oferta</div>
            <div className="v" style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem .6rem', fontSize: '.84rem' }}>
              {tecn.map(([k, v]) => <span key={k} className="muted"><strong>{k}:</strong> {v}</span>)}
              {log.map(([k, v]) => <span key={k} className="muted">🚚 <strong>{k}:</strong> {v}</span>)}
              {ahorro && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
                  💵 <strong>Efectivo:</strong> {money(o.oferta_precio_efectivo!)}
                  <span className="badge success">−{ahorro.pct.toFixed(2)}%</span>
                  <span className="muted">(BCV {money(bcvRef)})</span>
                </span>
              )}
            </div>
          </div>
        );
      })()}
      {(o.oferta_motivo || (o.oferta_motivo_adjuntos && o.oferta_motivo_adjuntos.length > 0)) && (
        <div className="detail-row">
          <div className="k">📝 Motivo de elección</div>
          <div className="v" style={{ fontSize: '.86rem' }}>
            {o.oferta_motivo && <div style={{ whiteSpace: 'pre-wrap' }}>{o.oferta_motivo}</div>}
            {o.oferta_motivo_adjuntos && o.oferta_motivo_adjuntos.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', marginTop: '.35rem' }}>
                {o.oferta_motivo_adjuntos.map((a, i) => (
                  <button key={a.path ?? i} type="button" className="btn btn-sm btn-ghost" style={{ padding: '.1rem .4rem' }}
                    onClick={() => getPdfOfertaSignedUrl(a.path).then((u) => window.open(u, '_blank', 'noopener')).catch(() => toast('No se pudo abrir el adjunto', 'error'))}
                    title={a.filename}>📎 {a.filename ?? `Adjunto ${i + 1}`}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {o.metodo_pago && o.metodo_pago.length > 0 && (
        <div className="detail-row">
          <div className="k">Método de pago</div>
          <div className="v">
            {o.metodo_pago.map((m, i) => (
              <div key={i} className="mono" style={{ fontSize: '.86rem' }}>
                {labelMetodoPago(m.metodo)} · {m.monto > 0 ? `${money(m.monto)} ${m.moneda}` : m.moneda}
              </div>
            ))}
            {o.metodo_pago_en && <span className="muted" style={{ fontSize: '.74rem' }}>indicado {dateTime(o.metodo_pago_en)} por {persona(o.metodo_pago_por, personaMap)}</span>}
          </div>
        </div>
      )}
      {(Number(o.descuento_pago) || 0) > 0 && (
        <div className="detail-row">
          <div className="k">Descuento en el pago</div>
          <div className="v">
            <span className="badge success">− {money(Number(o.descuento_pago), o.moneda)}</span>{' '}
            <span className="mono">A pagar {money(Math.round((Number(o.total) - Number(o.descuento_pago)) * 100) / 100, o.moneda)}</span>{' '}
            <span className="muted" style={{ fontSize: '.74rem' }}>· total OC {money(o.total, o.moneda)} (no cambia)</span>
          </div>
        </div>
      )}
      {o.abonado_total != null && o.abonado_total > 0 && (
        <div className="detail-row">
          <div className="k">Abonado (crédito)</div>
          <div className="v mono">{money(o.abonado_total, o.moneda)} <span className="muted">de {money(o.total, o.moneda)}</span></div>
        </div>
      )}
      {o.recibida_en && (
        <div className="detail-row">
          <div className="k">Recepción</div>
          <div className="v">
            {dateTime(o.recibida_en)} <span className="muted">por {persona(o.recibida_por, personaMap)}</span>
            {o.recibido_total != null && <div className="mono" style={{ fontSize: '.84rem' }}>Total recibido: {money(o.recibido_total, o.moneda)}{o.recibido_total < o.total && <span className="muted"> · de {money(o.total, o.moneda)}</span>}</div>}
          </div>
        </div>
      )}
      {o.almacen_destino && (
        <div className="detail-row">
          <div className="k">Almacén destino</div>
          <div className="v">📦 {o.almacen_destino}</div>
        </div>
      )}
      {o.nota_recepcion && (
        <div className="detail-row">
          <div className="k">Nota de recepción</div>
          <div className="v">{o.nota_recepcion}</div>
        </div>
      )}
      {o.pagada_en && (
        <div className="detail-row">
          <div className="k">Pagada</div>
          <div className="v">{dateTime(o.pagada_en)} <span className="muted">por {persona(o.pagada_por, personaMap)}</span></div>
        </div>
      )}
      {o.motivo && (
        <div className="detail-row">
          <div className="k">Motivo</div>
          <div className="v">{o.motivo}</div>
        </div>
      )}
      {o.finalidad && (
        <div className="detail-row">
          <div className="k">Finalidad</div>
          <div className="v">{o.finalidad}</div>
        </div>
      )}

      {subOcs.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="card-title"><span>🧩 Sub-órdenes por proveedor ({subOcs.length})</span></div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead><tr><th>OC</th><th>Proveedor</th><th style={{ textAlign: 'right' }}>Productos</th><th style={{ textAlign: 'right' }}>Total</th><th>Estado</th></tr></thead>
              <tbody>
                {subOcs.map((h) => (
                  <tr key={h.id}>
                    <td className="mono">{h.oc_codigo ?? h.codigo}</td>
                    <td>{h.proveedor_id ? (proveedorMap.get(h.proveedor_id)?.razon_social ?? '—') : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{(h.items ?? []).length}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(h.total)}</td>
                    <td><StatusBadge estado={h.estado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint muted" style={{ fontSize: '.76rem', margin: '.4rem 0 0' }}>Cada sub-OC se confirma, paga y recibe por separado (método de pago por proveedor).</p>
          {itemsPendientesAsignar.length > 0 && (
            <div className="card" style={{ borderColor: 'var(--warning)', background: 'var(--bg-1)', marginTop: '.6rem', padding: '.55rem .8rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '.25rem' }}>⚠️ {itemsPendientesAsignar.length} ítem(s) sin asignar — la SP sigue en «Pendiente (cargar ofertas)»</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '.8rem' }}>
                {itemsPendientesAsignar.map((it) => (
                  <li key={it.sku}>{it.nombre}{it.cantidad ? <span className="muted"> · {num(it.cantidad)} {it.unidad ?? ''}</span> : null}</li>
                ))}
              </ul>
              {canManageProcurement && (
                <button className="btn btn-sm btn-primary" style={{ marginTop: '.5rem' }} onClick={onAsignar}>🧩 Asignar / cargar ofertas de lo que falta</button>
              )}
            </div>
          )}
        </div>
      )}

      {mostrarOfertas && (
        <OfertasComparativa
          orden={o}
          proveedorMap={proveedorMap}
          canDecidir={canManageProcurement}
          canCrearOferta={canManageProcurement}
          actorEmail={actorEmail}
          reloadKey={offersReloadKey}
          onAccepted={onAcceptedOffer}
          onAddOferta={onAddOffer}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginTop: '1rem' }}>
        <h4 style={{ margin: 0 }}>
          Ítems
          {o.sin_inventario === true && (
            <span className="badge warning" style={{ marginLeft: '.5rem', fontWeight: 600 }} title="Al recibir no suma stock: los productos se ingresaron manualmente">
              📦 Sin inventario
            </span>
          )}
        </h4>
        {/* Editar cantidades antes de aprobar la OC (OP y OC creada sin confirmar). */}
        {canEditarCant && (editandoCant ? (
          <span style={{ display: 'inline-flex', gap: '.4rem' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditandoCant(false)} disabled={savingCant}>Cancelar</button>
            <button className="btn btn-sm btn-primary" onClick={guardarCantidades} disabled={savingCant}>{savingCant ? 'Guardando…' : '✓ Guardar cantidades'}</button>
          </span>
        ) : (
          <button className="btn btn-sm btn-ghost" onClick={abrirEdicionCant} title="Editar las cantidades de la SP antes de elegir el proveedor">
            ✎ Cantidades
          </button>
        ))}
      </div>
      {/* En etapa OP (sin oferta aceptada) no hay precio: se oculta Precio/Subtotal
          y se marca cuáles se compran. Con oferta aceptada (total>0) se muestra todo. */}
      {(() => {
        const conPrecio = Number(o.total) > 0;
        // En etapa OP (sin precio) quien gestiona compras puede marcar/desmarcar
        // qué ítems se aprueban para comprar.
        const puedeEditarComprar = !conPrecio && canManageProcurement;
        return (
      <div className="table-wrap">
      <table className="items-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Producto</th>
            <th>Categoría</th>
            <th>Subcategoría</th>
            <th className="num">Cantidad</th>
            {conPrecio ? (
              <>
                <th className="num">Precio</th>
                <th className="num">Subtotal</th>
              </>
            ) : (
              <th className="num">Comprar</th>
            )}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((it, idx) => (
            <tr key={`${it.sku}-${idx}`} style={{ opacity: !conPrecio && it.comprar === false ? 0.5 : 1 }}>
              <td className="mono">{it.sku}</td>
              <td>
                {it.nombre}
                {[it.marca, it.modelo].filter(Boolean).length > 0 && (
                  <div className="muted" style={{ fontSize: '.74rem' }}>🏷️ {[it.marca, it.modelo].filter(Boolean).join(' · ')}</div>
                )}
              </td>
              <td style={{ fontSize: '.84rem' }}>{it.servicio_categoria?.trim() ? it.servicio_categoria : <span className="muted">—</span>}</td>
              <td style={{ fontSize: '.84rem' }}>{it.servicio_tipo?.trim() ? it.servicio_tipo : <span className="muted">—</span>}</td>
              <td className="num">
                {editandoCant ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', justifyContent: 'flex-end' }}>
                    <input
                      type="number" min="0" step="any" className="input mono"
                      value={cantDraft[it.sku] ?? ''}
                      disabled={savingCant}
                      onChange={(e) => setCantDraft((d) => ({ ...d, [it.sku]: e.target.value }))}
                      style={{ width: 80, textAlign: 'right', padding: '.15rem .35rem' }}
                    />
                    {it.unidad ? <span className="muted" style={{ fontSize: '.78rem' }}>{it.unidad}</span> : null}
                  </span>
                ) : (
                  <>{num(it.cantidad)}{it.unidad ? ` ${it.unidad}` : ''}</>
                )}
              </td>
              {conPrecio ? (
                <>
                  <td className="num">{money(it.precio, o.moneda)}</td>
                  <td className="num">{money(it.cantidad * it.precio, o.moneda)}</td>
                </>
              ) : (
                <td className="num">
                  {puedeEditarComprar ? (
                    <input
                      type="checkbox"
                      checked={it.comprar !== false}
                      disabled={togglingSku === it.sku}
                      title={it.comprar === false ? 'Marcar para comprar' : 'Quitar de la compra'}
                      onChange={(e) => toggleComprar(it.sku, e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                  ) : (
                    it.comprar === false ? '—' : '✓'
                  )}
                </td>
              )}
              <td>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => onSeePriceHistory(it.sku, it.nombre)}
                  title="Comparativa histórica de precios"
                >
                  ⌁ histórico
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        {conPrecio && (
          <tfoot>
            {Number(o.descuento_obtenido) > 0 && (() => {
              const desc = Number(o.descuento_obtenido) || 0;
              const sub = Math.round((Number(o.total) + desc) * 100) / 100;
              return (
                <>
                  <tr><td colSpan={6} className="num">Subtotal</td><td className="num">{money(sub, o.moneda)}</td><td></td></tr>
                  <tr><td colSpan={6} className="num" style={{ color: 'var(--success)' }}>Descuento obtenido</td><td className="num" style={{ color: 'var(--success)' }}>− {money(desc, o.moneda)}</td><td></td></tr>
                </>
              );
            })()}
            <tr>
              <td colSpan={6} className="num">TOTAL</td>
              <td className="num">{money(o.total, o.moneda)}</td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>
      </div>
        );
      })()}

      <h4 style={{ marginTop: '1.25rem' }}>Historial</h4>
      <Timeline historial={o.historial ?? []} proveedorMap={proveedorMap} personaMap={personaMap} />

      <ChatOC
        ordenId={o.id}
        ordenCodigo={o.oc_codigo ?? o.codigo}
        userId={actorUserId}
        autorEmail={actorEmail}
        autorNombre={actorNombre}
        personaMap={personaMap}
      />
    </Modal>
    {enviarOpen && (
      <EnviarPorCorreoModal
        ordenId={o.id}
        ordenCodigo={o.codigo}
        defaultEmail={actorEmail}
        onClose={() => setEnviarOpen(false)}
      />
    )}
    {comprobanteOpen && (
      <ComprobanteOcModal
        orden={o}
        onClose={() => setComprobanteOpen(false)}
        onSaved={async () => { setComprobanteOpen(false); await onComprobanteSaved(); }}
      />
    )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Cargar la factura / nota de entrega de una OC finalizada.
   Al subirla, la OC queda con su comprobante y entra a Retenciones.
   ───────────────────────────────────────────── */
function ComprobanteOcModal({ orden, onClose, onSaved }: {
  orden: Orden; onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const [tipo, setTipo] = useState<'factura' | 'nota_entrega'>((orden.comprobante_tipo as 'factura' | 'nota_entrega') ?? 'factura');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!file) { setError('Elegí el archivo (PDF o imagen).'); return; }
    setSaving(true); setError(null);
    try {
      await adjuntarComprobanteOc(orden.id, file, tipo);
      toast(`${tipo === 'factura' ? 'Factura' : 'Nota de entrega'} cargada · la OC entró a Retenciones`, 'success');
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo subir el comprobante'); setSaving(false); }
  }

  async function verActual() {
    if (!orden.factura_path) return;
    try {
      const url = await urlAdjuntoOc(orden.factura_path);
      await previewFileUrl(url, orden.factura_nombre ?? 'comprobante', 'Comprobante de la OC');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir', 'error'); }
  }

  return (
    <Modal title={`📎 Comprobante · OC ${orden.oc_codigo ?? orden.codigo}`} size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving || !file}>{saving ? 'Subiendo…' : 'Subir comprobante'}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      {orden.factura_path && (
        <div className="card" style={{ margin: '0 0 .75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
          <span className="muted" style={{ fontSize: '.85rem' }}>Ya hay un comprobante cargado: <strong>{orden.factura_nombre}</strong></span>
          <button className="btn btn-sm btn-ghost" onClick={() => void verActual()}>👁 Vista previa</button>
        </div>
      )}
      <div className="form-row">
        <label>Tipo de comprobante</label>
        <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as 'factura' | 'nota_entrega')}>
          <option value="factura">Factura</option>
          <option value="nota_entrega">Nota de entrega</option>
        </select>
      </div>
      <div className="form-row">
        <label>Archivo <span className="muted" style={{ fontWeight: 400 }}>(PDF o imagen · máx. 10 MB)</span></label>
        <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (error) setError(null); }} />
      </div>
      <small className="muted">Al subir el comprobante, la orden aparece en <strong>Retenciones</strong> para cargar los certificados (IVA / ISLR / Municipal).</small>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Chat interno por OC (seguimiento gerente ↔ analista)
   Embebido en el detalle. Realtime propio (no se pausa con el modal).
   ───────────────────────────────────────────── */
function EnviarPorCorreoModal({
  ordenId,
  ordenCodigo,
  defaultEmail,
  onClose,
}: {
  ordenId: string;
  ordenCodigo: string;
  defaultEmail: string;
  onClose: () => void;
}) {
  const [incluirPropio, setIncluirPropio] = useState(true);
  const [extra, setExtra] = useState('');
  const [enviando, setEnviando] = useState(false);

  const propio = defaultEmail.trim().toLowerCase();
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function handleEnviar() {
    const lista: string[] = [];
    if (incluirPropio && propio) lista.push(propio);
    const extraClean = extra.trim().toLowerCase();
    if (extraClean) {
      if (!emailRx.test(extraClean)) {
        toast('El correo adicional no es válido', 'error');
        return;
      }
      lista.push(extraClean);
    }
    if (!lista.length) {
      toast('Marcá al menos un destinatario', 'error');
      return;
    }
    setEnviando(true);
    try {
      const { enviados, fallidos } = await enviarTrazabilidadAMultiples(ordenId, lista);
      if (fallidos.length) {
        const detalle = fallidos.map((f) => `${f.email} (${f.motivo})`).join(' · ');
        notify(`Enviado a ${enviados.join(', ')}. Falló: ${detalle}`, 'warning', { link: '#/app/pedidos' });
      } else {
        notify(`Trazabilidad enviada a ${enviados.join(', ')}`, 'success', { link: '#/app/pedidos' });
      }
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar', 'error');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={`Enviar trazabilidad · ${ordenCodigo}`}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={enviando}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleEnviar} disabled={enviando}>
            {enviando ? 'Enviando…' : '📧 Enviar'}
          </button>
        </>
      }
    >
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
        Se enviará el PDF de trazabilidad de la orden a los destinatarios seleccionados.
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '.6rem',
          padding: '.7rem .85rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: incluirPropio ? 'rgba(255,138,0,0.06)' : 'transparent',
          cursor: propio ? 'pointer' : 'not-allowed',
          marginBottom: '.6rem',
        }}
      >
        <input
          type="checkbox"
          checked={incluirPropio}
          disabled={!propio}
          onChange={(e) => setIncluirPropio(e.target.checked)}
        />
        <div>
          <div style={{ fontWeight: 600 }}>Tu correo</div>
          <div className="mono" style={{ fontSize: '.82rem' }}>{propio || '—'}</div>
        </div>
      </label>

      <div className="form-row" style={{ marginTop: '.4rem' }}>
        <label>Correo adicional (opcional)</label>
        <input
          className="input"
          type="email"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="otro@correo.com"
          maxLength={120}
        />
        <small className="muted">Podés mandarlo a un segundo destinatario al mismo tiempo.</small>
      </div>
    </Modal>
  );
}

/** Muestra el nombre de la persona a partir de su email; si no está, el propio email. */
function persona(email: string | null | undefined, map: Map<string, string>): string {
  if (!email) return '—';
  return map.get(email.toLowerCase()) ?? email;
}

function Timeline({
  historial,
  proveedorMap,
  personaMap,
}: {
  historial: EventoHistorial[];
  proveedorMap: Map<string, Proveedor>;
  personaMap: Map<string, string>;
}) {
  if (!historial.length) return <p className="hint muted">Sin eventos registrados.</p>;
  // Mostrar en orden cronológico inverso (más reciente arriba).
  const items = [...historial].reverse();
  return (
    <div className="timeline">
      {items.map((h, i) => {
        const ext = h as EventoHistorial & {
          proveedorAnteriorId?: string;
          proveedorNuevoId?: string;
        };
        const anterior = ext.proveedorAnteriorId ? proveedorMap.get(ext.proveedorAnteriorId) : null;
        const nuevo = ext.proveedorNuevoId ? proveedorMap.get(ext.proveedorNuevoId) : null;
        let extra = '';
        if (h.motivo) extra = ` · ${h.motivo}`;
        if (anterior && nuevo) {
          extra = ` · de ${anterior.razon_social} → ${nuevo.razon_social}${
            h.motivo ? ' · ' + h.motivo : ''
          }`;
        }
        return (
          <div className="tl-item" key={`${h.at}-${i}`}>
            <div className={`tl-dot ${eventClass(h.evento)}`}></div>
            <div className="tl-body">
              <div className="tl-title">
                {eventLabel(h.evento)}
                {extra}
              </div>
              {h.documentos && h.documentos.length > 0 && (
                <div className="tl-meta" style={{ marginTop: '.15rem' }}>
                  📄 Documentos: {h.documentos.join(' · ')}
                </div>
              )}
              <div className="tl-meta">{dateTime(h.at)} · {persona(h.actor, personaMap)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Modal: Crear orden
   ───────────────────────────────────────────── */
/* ───────────── Editar OC (oc_creada, antes de aprobarla) ───────────── */
function EditarOcModal({ orden, proveedores = [], proveedorMap, productos = [], actorEmail, onClose, onSaved }: {
  orden: Orden; proveedores?: Proveedor[]; proveedorMap?: Map<string, Proveedor>; productos?: Producto[]; actorEmail: string; onClose: () => void; onSaved: () => void;
}) {
  const [items, setItems] = useState<ItemOrden[]>(orden.items.map((i) => ({ ...i })));
  const [cond, setCond] = useState(orden.condiciones_pago ?? '');
  const [notas, setNotas] = useState(orden.notas ?? '');
  const [proveedorId, setProveedorId] = useState<string>(orden.proveedor_id ?? '');
  // Descuento OBTENIDO (negociado), opcional: reduce el total → total = Σ ítems − descuento.
  const [descuentoStr, setDescuentoStr] = useState(orden.descuento_obtenido != null ? String(orden.descuento_obtenido) : '');
  const [nuevoProd, setNuevoProd] = useState('');   // producto a agregar (id)
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selector de proveedor: activos + el actual (aunque esté inactivo), sin duplicar.
  const proveedorActual = orden.proveedor_id ? proveedorMap?.get(orden.proveedor_id) ?? null : null;
  const proveedoresSel = useMemo(() => {
    const out = [...proveedores];
    if (proveedorActual && !out.some((p) => p.id === proveedorActual.id)) out.unshift(proveedorActual);
    return out;
  }, [proveedores, proveedorActual]);
  const proveedorCambiado = proveedorId !== (orden.proveedor_id ?? '');

  // Productos del catálogo que aún no están en la OC (para agregar uno nuevo).
  const skusEnOc = useMemo(() => new Set(items.map((i) => i.sku)), [items]);
  const productosDisponibles = useMemo(
    () => productos.filter((p) => p.estado === 'activo' && !skusEnOc.has(p.sku)),
    [productos, skusEnOc],
  );

  const subtotal = items.reduce((a, i) => a + (Number(i.cantidad) || 0) * (Number(i.precio) || 0), 0);
  const descuentoObt = Math.max(0, Math.round((Number(descuentoStr) || 0) * 100) / 100);
  const total = Math.round(Math.max(0, subtotal - descuentoObt) * 100) / 100;
  const upd = (idx: number, patch: Partial<ItemOrden>) =>
    setItems((prev) => prev.map((it, k) => (k === idx ? { ...it, ...patch } : it)));
  const quitarItem = (idx: number) => setItems((prev) => prev.filter((_, k) => k !== idx));
  function agregarProducto() {
    const p = productos.find((x) => x.id === nuevoProd);
    if (!p) return;
    setItems((prev) => [...prev, { sku: p.sku, nombre: p.nombre, cantidad: 1, precio: Number(p.precio) || 0, productoId: p.id, unidad: p.unidad, comprar: true }]);
    setNuevoProd('');
  }

  async function guardar() {
    setError(null); setSaving(true);
    try {
      await actualizarOc(orden, { items, condiciones_pago: cond || null, notas, proveedorId: proveedorId || null, descuentoObtenido: descuentoObt }, actorEmail);
      // Sincroniza con inventario los nombres que cambiaron respecto al original.
      const orig = new Map(orden.items.map((i) => [i.sku, i.nombre]));
      const cambios = items
        .filter((i) => (i.nombre ?? '').trim() && i.nombre !== orig.get(i.sku))
        .map((i) => ({ productoId: i.productoId, sku: i.sku, nombre: i.nombre }));
      if (cambios.length) await sincronizarNombreProductos(cambios).catch(() => { /* no bloquear el guardado */ });
      toast(`OC actualizada${cambios.length ? ` · ${cambios.length} nombre(s) sincronizado(s) con inventario` : ''}`, 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={`Editar OC ${orden.oc_codigo ?? orden.codigo}`} size="lg" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button></>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.84rem' }}>
        {orden.estado === 'oc_aprobada'
          ? <>Ajustá <strong>precios y cantidades</strong>: el nuevo total se <strong>sincroniza con Tesorería</strong> y la OC <strong>sigue en «Confirmada pagar»</strong> (queda en la trazabilidad). Si cambiás el <strong>proveedor</strong>, la OC vuelve a aprobación del Gerente General.</>
          : <>Ajustá el proveedor, cantidades, precios y la condición de pago. El total se recalcula solo. Si cambiás algo, la OC vuelve a aprobación del Gerente General.</>}
      </p>
      {proveedoresSel.length > 0 && (
        <div className="form-row" style={{ marginBottom: '.6rem' }}>
          <label>Proveedor</label>
          <select className="select" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            {!proveedorId && <option value="">— elegí el proveedor —</option>}
            {proveedoresSel.map((p) => <option key={p.id} value={p.id}>{p.razon_social}{p.rif ? ` · ${p.rif}` : ''}</option>)}
          </select>
          {proveedorCambiado && (
            <small className="muted" style={{ color: 'var(--brand, #ff8a00)' }}>
              ⚠️ Cambiás el proveedor: la OC vuelve a aprobación del Gerente General.
            </small>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Producto</th><th style={{ textAlign: 'right', width: 110 }}>Cantidad</th><th style={{ textAlign: 'right', width: 130 }}>Precio unit.</th><th style={{ textAlign: 'right', width: 130 }}>Subtotal</th><th style={{ width: 40 }}></th></tr></thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.sku ?? idx}>
                <td>
                  <input className="input" value={it.nombre} onChange={(e) => upd(idx, { nombre: e.target.value.toUpperCase() })}
                    title="Editar nombre (se sincroniza con el inventario al guardar)" />
                  <span className="muted mono" style={{ fontSize: '.72rem' }}>{it.sku}</span>
                </td>
                <td><input className="input mono" type="number" min={0} step="any" value={it.cantidad} onChange={(e) => upd(idx, { cantidad: Number(e.target.value) || 0 })} style={{ textAlign: 'right' }} /></td>
                <td><input className="input mono" type="number" min={0} step="any" value={it.precio} onChange={(e) => upd(idx, { precio: Number(e.target.value) || 0 })} style={{ textAlign: 'right' }} /></td>
                <td className="mono" style={{ textAlign: 'right' }}>{money((Number(it.cantidad) || 0) * (Number(it.precio) || 0))}</td>
                <td style={{ textAlign: 'center' }}>{items.length > 1 && <button type="button" className="btn btn-sm btn-ghost" title="Quitar producto" onClick={() => quitarItem(idx)}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {descuentoObt > 0 && (
              <>
                <tr><td colSpan={3} style={{ textAlign: 'right' }}>Subtotal</td><td className="mono" style={{ textAlign: 'right' }}>{money(subtotal)}</td><td></td></tr>
                <tr><td colSpan={3} style={{ textAlign: 'right', color: 'var(--success)' }}>Descuento obtenido</td><td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>− {money(descuentoObt)}</td><td></td></tr>
              </>
            )}
            <tr style={{ fontWeight: 700 }}><td colSpan={3} style={{ textAlign: 'right' }}>Total</td><td className="mono" style={{ textAlign: 'right' }}>{money(total)}</td><td></td></tr>
          </tfoot>
        </table>
      </div>
      <div className="form-row" style={{ marginTop: '.5rem' }}>
        <label>Descuento obtenido (opcional)</label>
        <input className="input mono" type="number" min={0} step="any" value={descuentoStr}
          onChange={(e) => setDescuentoStr(e.target.value)} placeholder="0,00" style={{ maxWidth: 200 }} />
        <small className="muted">Descuento negociado que se le resta al total (la factura a pagar). Se sincroniza con Tesorería y se ve en el PDF y la trazabilidad.</small>
      </div>
      {/* Agregar un producto nuevo a la OC (del catálogo de inventario). */}
      <div className="form-row" style={{ marginTop: '.5rem' }}>
        <label>Agregar producto</label>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px' }}>
            <SearchSelect value={nuevoProd} onChange={setNuevoProd}
              options={productosDisponibles.map((p) => ({ value: p.id, label: `${p.nombre} · ${p.sku} · ${money(Number(p.precio) || 0)}` }))}
              placeholder="Buscar producto del inventario…" emptyText="Sin productos disponibles." />
          </div>
          <button type="button" className="btn btn-ghost" disabled={!nuevoProd} onClick={agregarProducto}>＋ Agregar</button>
        </div>
        <small className="muted">El precio viene del inventario; podés ajustarlo en la tabla. Agregar/quitar productos reabre la OC a aprobación del Gerente.</small>
      </div>
      <div className="form-row" style={{ marginTop: '.6rem' }}>
        <label>Condición de pago</label>
        <select className="select" value={cond} onChange={(e) => setCond(e.target.value)}>
          <option value="">— sin especificar —</option>
          {CONDICIONES_PAGO.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <div className="form-row"><label>Nota</label><textarea className="input" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
    </Modal>
  );
}

/* ───────────── Nuevo Servicio (clase='servicio') ───────────── */
interface LineaServicio { id: number; categoria: string; tipo: string; equipoId: string; electro: string; cantidad: string; precio: string; bombonas: string; kg: string; repuestoId: string; repuestoCant: string; }

/** ¿La categoría es de recarga (gas / oxígeno / extintores)? → pide bombonas + KG. */
function esRecargaGas(cat: string): boolean {
  return /gas|ox[ií]geno|extintor|bombona/i.test(cat);
}

/** ¿La categoría es de recarga de AGUA? (botellones, garrafones o cisterna) → cantidad × litros. */
function esRecargaAgua(cat: string): boolean {
  return /\bagua\b|botell[oó]n|garraf|cisterna/i.test(cat);
}

/** Recarga en general (gas O agua): ambas piden cantidad + medida (KG o litros). */
function esRecarga(cat: string): boolean {
  return esRecargaGas(cat) || esRecargaAgua(cat);
}

/** ¿El equipo es una MOTO/motocicleta? (evita falsos positivos como motoniveladora/motobomba). */
function esMoto(e: MaquinariaEquipo): boolean {
  return /\bmotos?\b|motocicleta/i.test(`${e.tipo ?? ''} ${e.equipo ?? ''}`);
}

/** Un equipo es VEHÍCULO si su tipo es carro, camión, camioneta o vehículo (y NO una moto); el resto es maquinaria. */
function esVehiculo(e: MaquinariaEquipo): boolean {
  return /carro|cami[oó]n|camioneta|veh[ií]culo|auto/i.test(e.tipo ?? '') && !esMoto(e);
}

/**
 * Para una categoría de servicio de mantenimiento, qué lista de equipos aplica:
 *  - 'motos'      → Control de Motos (motos / motocicletas)
 *  - 'vehiculos'  → Control de Vehículos (carro / camión / camioneta…)
 *  - 'maquinaria' → Control de Maquinaria (todo lo demás: grúas, plantas, montacargas…)
 *  - null         → no es mantenimiento de equipo (no pide equipo)
 */
function tipoMantenimiento(cat: string): 'maquinaria' | 'vehiculos' | 'motos' | null {
  if (/\bmotos?\b|motocicleta/i.test(cat)) return 'motos';
  if (/veh[ií]culo/i.test(cat)) return 'vehiculos';
  if (/maquinaria|planta/i.test(cat)) return 'maquinaria';
  return null;
}

/** ¿La categoría se casa con un equipo de Control de Maquinaria/Vehículos? */
function esMantenimientoEquipo(cat: string): boolean {
  return tipoMantenimiento(cat) !== null;
}

/** ¿La categoría es mantenimiento de electrodomésticos? → elige un artículo de la lista. */
function esMantenimientoElectrodomestico(cat: string): boolean {
  return /electrodom/i.test(cat);
}

/** Lista base de electrodomésticos (con íconos). El usuario puede escribir uno nuevo (allowCreate). */
const ELECTRODOMESTICOS: { value: string; label: string }[] = [
  { value: 'COCINA', label: '🍳 Cocina' },
  { value: 'NEVERA', label: '🧊 Nevera' },
  { value: 'CONGELADOR', label: '🧊 Congelador' },
  { value: 'LAVADORA', label: '🧺 Lavadora' },
  { value: 'SECADORA', label: '🌀 Secadora' },
  { value: 'MICROONDAS', label: '📡 Microondas' },
  { value: 'AIRE ACONDICIONADO', label: '❄️ Aire acondicionado' },
  { value: 'VENTILADOR', label: '💨 Ventilador' },
  { value: 'TELEVISOR', label: '📺 Televisor' },
  { value: 'LICUADORA', label: '🥤 Licuadora' },
  { value: 'CAFETERA', label: '☕ Cafetera' },
  { value: 'FREIDORA', label: '🍟 Freidora' },
  { value: 'CALENTADOR / TERMO', label: '🚿 Calentador / termo' },
  { value: 'CAMPANA EXTRACTORA', label: '🌫️ Campana extractora' },
  { value: 'LAVAPLATOS', label: '🍽️ Lavaplatos' },
  { value: 'PLANCHA', label: '👕 Plancha' },
  { value: 'OTRO', label: '• Otro electrodoméstico' },
];

/** Filtra los equipos según el tipo de mantenimiento de la categoría (por el tipo del equipo). */
function equiposDeTipo(equipos: MaquinariaEquipo[], tipo: 'maquinaria' | 'vehiculos' | 'motos' | null): MaquinariaEquipo[] {
  if (tipo === 'motos') return equipos.filter(esMoto);
  if (tipo === 'vehiculos') return equipos.filter(esVehiculo);
  if (tipo === 'maquinaria') return equipos.filter((e) => !esVehiculo(e) && !esMoto(e));
  return equipos;
}

/** Tipos de servicio de mantenimiento sugeridos (lista base con íconos). El usuario
 *  igual puede escribir uno nuevo (allowCreate) y queda guardado en el catálogo. */
const TIPOS_SERVICIO_MANT: { value: string; label: string }[] = [
  { value: 'CAMBIO DE ACEITE', label: '🛢️ Cambio de aceite' },
  { value: 'CAMBIO DE FILTRO', label: '🧯 Cambio de filtro' },
  { value: 'CAMBIO DE CAUCHOS / NEUMÁTICOS', label: '🛞 Cambio de cauchos / neumáticos' },
  { value: 'REPUESTOS', label: '🛠️ Repuestos' },
  { value: 'CAMBIO DE PIEZA', label: '⚙️ Cambio de pieza' },
  { value: 'PINTURA / LATONERÍA', label: '🎨 Pintura / latonería' },
  { value: 'FRENOS', label: '🛑 Frenos' },
  { value: 'BATERÍA', label: '🔋 Batería' },
  { value: 'SISTEMA ELÉCTRICO', label: '💡 Sistema eléctrico' },
  { value: 'SISTEMA HIDRÁULICO', label: '💧 Sistema hidráulico' },
  { value: 'SOLDADURA', label: '🔥 Soldadura' },
  { value: 'ENGRASE / LUBRICACIÓN', label: '🧴 Engrase / lubricación' },
  { value: 'REFRIGERANTE', label: '❄️ Refrigerante' },
  { value: 'SERVICIO / PREVENTIVO', label: '🔧 Servicio / preventivo' },
  { value: 'REPARACIÓN', label: '🛠️ Reparación' },
  { value: 'INSPECCIÓN', label: '🔍 Inspección' },
  { value: 'LECTURA DE HORÓMETRO', label: '⏱️ Lectura de horómetro' },
  { value: 'OTRO', label: '• Otro' },
];

function NuevoServicioModal({ usuario, authEmail, orden, onClose, onCreated }: {
  usuario: Usuario | null; authEmail: string; orden?: Orden | null; onClose: () => void; onCreated: () => void | Promise<void>;
}) {
  const esEdicion = !!orden;
  // Reconstruye las líneas de servicio desde los ítems de una orden (para editar).
  const lineasDeOrden = (o: Orden): LineaServicio[] => {
    const its = Array.isArray(o.items) ? o.items : [];
    const out = its.map((it, i): LineaServicio => {
      const cat = it.servicio_categoria ?? '';
      // tipo: el guardado en servicio_tipo; si no, se infiere del nombre (ítems viejos).
      let tipo = it.servicio_tipo ?? '';
      if (!tipo) {
        if (esMantenimientoEquipo(cat) && it.equipo_nombre) {
          const pref = `${cat} · ${it.equipo_nombre}`.toUpperCase();
          const full = String(it.nombre ?? '').toUpperCase();
          tipo = full.startsWith(pref) ? full.slice(pref.length).replace(/^\s*·\s*/, '') : '';
        } else if (!esMantenimientoEquipo(cat)) {
          tipo = it.nombre ?? '';
        }
      }
      // tipo para electrodomésticos (ítems viejos): el nombre sin el prefijo "CAT · ARTÍCULO".
      if (!it.servicio_tipo && esMantenimientoElectrodomestico(cat) && it.equipo_nombre) {
        const pref = `${cat} · ${it.equipo_nombre}`.toUpperCase();
        const full = String(it.nombre ?? '').toUpperCase();
        tipo = full.startsWith(pref) ? full.slice(pref.length).replace(/^\s*·\s*/, '') : tipo;
      }
      const electro = esMantenimientoElectrodomestico(cat) ? (it.equipo_nombre ?? '') : '';
      return { id: i + 1, categoria: cat, tipo, equipoId: it.equipo_id ?? '', electro, cantidad: String(it.cantidad ?? 1), precio: String(it.precio ?? ''), bombonas: String(it.bombonas ?? ''), kg: String(it.kg_recarga ?? ''), repuestoId: it.repuesto_producto_id ?? '', repuestoCant: it.repuesto_cantidad != null ? String(it.repuesto_cantidad) : '1' };
    });
    return out.length ? out : [{ id: 1, categoria: '', tipo: '', equipoId: '', electro: '', cantidad: '1', precio: '', bombonas: '', kg: '', repuestoId: '', repuestoCant: '1' }];
  };

  const [codigo, setCodigo] = useState(orden?.codigo ?? 'SV-…');
  const [categorias, setCategorias] = useState<CatalogoPedido[]>([]);
  const [tipos, setTipos] = useState<CatalogoPedido[]>([]);
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [unidades, setUnidades] = useState<string[]>([]);
  const [unidadSol, setUnidadSol] = useState(esEdicion ? (orden!.solicitante ?? '') : '');
  const [nuevaUnidad, setNuevaUnidad] = useState('');
  const [solicitantePersona, setSolicitantePersona] = useState(esEdicion ? (orden!.solicitante_persona ?? '') : '');
  const [nota, setNota] = useState(esEdicion ? (orden!.notas ?? '') : '');
  // Moneda del servicio ($ o Bs): los precios estimados se cargan en esta moneda.
  const [moneda, setModeda] = useState<'USD' | 'Bs'>(esEdicion && orden!.moneda === 'Bs' ? 'Bs' : 'USD');
  const monedaSym = moneda === 'USD' ? '$' : 'Bs';
  // Conversión de moneda a la tasa (BCV del día o la que ponga el usuario).
  const [tasaConv, setTasaConv] = useState('');
  const [tasaBcv, setTasaBcv] = useState(0);
  useEffect(() => { getTasaHoy().then((t) => { const v = Number(t.usd) || 0; if (v > 0) { setTasaBcv(v); setTasaConv((p) => p || String(v)); } }).catch(() => { /* sin tasa */ }); }, []);
  const [lineas, setLineas] = useState<LineaServicio[]>(esEdicion ? lineasDeOrden(orden!) : [{ id: 1, categoria: '', tipo: '', equipoId: '', electro: '', cantidad: '1', precio: '', bombonas: '', kg: '', repuestoId: '', repuestoCant: '1' }]);
  const [productosStock, setProductosStock] = useState<ProductoConStock[]>([]);
  useEffect(() => { listProductosConStock().then(setProductosStock).catch(() => setProductosStock([])); }, []);
  const [seq, setSeq] = useState(() => (esEdicion ? lineasDeOrden(orden!).length + 1 : 2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!esEdicion) nextCodigoServicio().then(setCodigo).catch(() => setCodigo('SV-?'));
    listCatalogoPedido('servicio_categoria', true).then(setCategorias).catch(() => { /* sin catálogo */ });
    listCatalogoPedido('servicio_tipo', true).then(setTipos).catch(() => { /* sin catálogo */ });
    listEquipos().then(setEquipos).catch(() => setEquipos([]));
    listCatalogoPedido('unidad_solicitante', true).then((u) => setUnidades(u.map((x) => x.nombre))).catch(() => { /* sin catálogo */ });
  }, [esEdicion]);

  const addLinea = () => { setLineas((ls) => [...ls, { id: seq, categoria: '', tipo: '', equipoId: '', electro: '', cantidad: '1', precio: '', bombonas: '', kg: '', repuestoId: '', repuestoCant: '1' }]); setSeq((s) => s + 1); };
  const setLinea = (id: number, patch: Partial<Omit<LineaServicio, 'id'>>) => setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const delLinea = (id: number) => setLineas((ls) => ls.filter((l) => l.id !== id));

  const total = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0);

  // Convierte los precios estimados a la otra moneda ($↔Bs) a la tasa y cambia la moneda.
  function convertirMoneda() {
    const r = Number(tasaConv) || 0;
    if (r <= 0) { setError('Colocá la tasa (Bs por $) para convertir.'); return; }
    const toBs = moneda === 'USD';
    const conv = (n: number) => Math.round((toBs ? n * r : n / r) * 100) / 100;
    setLineas((ls) => ls.map((l) => { const p = Number(l.precio) || 0; return p > 0 ? { ...l, precio: String(conv(p)) } : l; }));
    setModeda(toBs ? 'Bs' : 'USD');
    setError(null);
    toast(`Precios convertidos a ${toBs ? 'Bs' : '$'} a la tasa ${r.toLocaleString('es-VE')}`, 'success');
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    const unidad = (nuevaUnidad.trim() || unidadSol).trim().toUpperCase();
    if (!unidad) { setError('Indicá la unidad solicitante.'); return; }

    const items: ItemOrden[] = [];
    const tiposNuevos: string[] = [];
    for (const l of lineas) {
      const cat = l.categoria.trim();
      if (!cat) continue;
      const aguaCat = esRecargaAgua(cat);
      const recargaCat = esRecargaGas(cat) || aguaCat;
      // Recarga (gas / oxígeno / extintores / AGUA): la "cantidad" es el nº de unidades
      // (bombonas o botellones/cisternas); la medida por unidad × unidades da el total
      // (KG para gas, litros para agua).
      const bombonas = recargaCat ? (Number(l.bombonas) || 0) : 0;
      const medidaPorUnidad = recargaCat ? (Number(l.kg) || 0) : 0;
      const kgTotal = Math.round(bombonas * medidaPorUnidad * 100) / 100;
      const cant = recargaCat ? bombonas : (Number(l.cantidad) || 0);
      if (cant <= 0) { setError(recargaCat ? (aguaCat ? 'Indicá la cantidad (botellones o cisternas; 1 si es una cisterna).' : 'Indicá la cantidad de bombonas.') : 'Cada servicio debe tener cantidad mayor que 0.'); return; }
      const precio = Number(l.precio) || 0;
      const recarga = recargaCat ? { bombonas, kg_recarga: kgTotal } : {};
      // Sufijo visible (tablero + PDF): gas "· 2 BOMBONA(S) · 86 KG" · agua "· 100 L DE AGUA (5 UND)".
      const recargaSuf = recargaCat
        ? (aguaCat ? ` · ${kgTotal} L DE AGUA${bombonas > 1 ? ` (${bombonas} UND)` : ''}` : ` · ${bombonas} BOMBONA(S) · ${kgTotal} KG`)
        : '';
      if (esMantenimientoEquipo(cat) || esMantenimientoElectrodomestico(cat)) {
        const esElectro = esMantenimientoElectrodomestico(cat);
        let equipoId: string | null = null;
        let equipoNombre: string;
        if (esElectro) {
          equipoNombre = l.electro.trim();
          if (!equipoNombre) { setError(`Elegí el electrodoméstico de "${cat}".`); return; }
        } else {
          const eq = equipos.find((x) => x.id === l.equipoId);
          if (!eq) { setError(`Elegí el equipo de "${cat}".`); return; }
          equipoId = eq.id; equipoNombre = eq.equipo;
        }
        const desc = l.tipo.trim();
        // Repuesto del inventario (opcional): si el repuesto sale del stock, se valida y se descuenta.
        const prod = l.repuestoId ? productosStock.find((p) => p.id === l.repuestoId) ?? null : null;
        const prodCant = prod ? (Number(l.repuestoCant) || 0) : 0;
        if (prod && prodCant <= 0) { setError(`Indicá cuántas unidades de "${prod.nombre}" se toman del inventario.`); return; }
        if (prod && prodCant > prod.stock) { setError(`Solo hay ${prod.stock} ${prod.unidad} de "${prod.nombre}" en el inventario.`); return; }
        // equipo_id mantiene el vínculo con Control de Maquinaria (null en electrodomésticos: no son equipos del módulo).
        items.push({ sku: `SRV-${items.length + 1}`, nombre: `${cat} · ${equipoNombre}${desc ? ` · ${desc}` : ''}${recargaSuf}${prod && prodCant ? ` · ${prodCant} ${prod.nombre} (inventario)` : ''}`.toUpperCase(), cantidad: cant, precio, servicio_categoria: cat, servicio_tipo: desc.toUpperCase() || null, equipo_id: equipoId, equipo_nombre: equipoNombre, ...recarga, comprar: true, repuesto_producto_id: prod?.id ?? null, repuesto_nombre: prod?.nombre ?? null, repuesto_cantidad: prod ? prodCant : null, repuesto_almacen: prod?.almacen ?? null });
        // El tipo de servicio elegido/escrito acá también alimenta el catálogo compartido.
        if (desc && !tipos.some((t) => t.nombre.toLowerCase() === desc.toLowerCase())) tiposNuevos.push(desc.toUpperCase());
      } else {
        const tipo = l.tipo.trim();
        if (!recargaCat && !tipo) { setError(`Indicá el servicio de "${cat}".`); return; }
        const nombre = recargaCat ? `${cat}${tipo ? ` · ${tipo}` : ''}${recargaSuf}`.toUpperCase() : tipo.toUpperCase();
        items.push({ sku: `SRV-${items.length + 1}`, nombre, cantidad: cant, precio, servicio_categoria: cat, servicio_tipo: tipo.toUpperCase() || null, ...recarga, comprar: true });
        if (tipo && !tipos.some((t) => t.nombre.toLowerCase() === tipo.toLowerCase())) tiposNuevos.push(tipo.toUpperCase());
      }
    }
    if (!items.length) { setError('Agregá al menos un servicio con su categoría.'); return; }

    setSaving(true);
    try {
      for (const t of Array.from(new Set(tiposNuevos))) {
        try { await crearCatalogoPedido('servicio_tipo', t, authEmail); } catch { /* duplicado: no bloquea */ }
      }
      try { await ensureUnidadSolicitante(unidad, authEmail); } catch { /* ya existe */ }
      if (esEdicion) {
        await actualizarOrden(orden!, {
          items,
          notas: nota.trim() || null,
          solicitante: unidad,
          solicitante_persona: solicitantePersona.trim() || null,
          ci_solicitante: orden!.ci_solicitante ?? null,
          moneda,
        }, authEmail);
        toast(`Servicio ${codigo} actualizado`, 'success');
      } else {
        const nueva = await crearOrden({
          clase: 'servicio',
          proveedor_id: null,
          items,
          moneda,
          solicitante_email: authEmail,
          solicitante: unidad,
          solicitante_persona: solicitantePersona.trim() || null,
          ci_solicitante: usuario?.ci ?? null,
          notas: nota.trim() || null,
          clasificacion: ['Servicios'],
        });
        // Repuestos tomados del inventario: se descuentan del stock (salida en el kardex).
        for (const it of items) {
          const qty = Number(it.repuesto_cantidad) || 0;
          if (!it.repuesto_producto_id || qty <= 0) continue;
          try {
            await registrarMovimiento({
              producto_id: it.repuesto_producto_id, tipo: 'salida', delta: -qty,
              almacen: it.repuesto_almacen ?? undefined,
              actor: authEmail, actor_name: usuario?.nombre ?? null,
              ref_tipo: 'servicio', ref_id: nueva.id, ref_codigo: nueva.codigo ?? undefined,
              detalle: `Servicio · repuesto de mantenimiento · ${nueva.codigo ?? codigo}`,
              precio_unitario: null,
            });
          } catch { /* el descuento no bloquea la creación del servicio */ }
        }
        toast(`Servicio ${codigo} creado`, 'success');
      }
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el servicio.');
    } finally { setSaving(false); }
  }

  return (
    <Modal title={esEdicion ? `Editar servicio · ${codigo}` : `Nuevo servicio · ${codigo}`} size="lg" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={(e) => void submit(e as unknown as FormEvent)} disabled={saving}>
          {saving ? 'Guardando…' : (esEdicion ? '🛠 Guardar cambios' : '🛠 Crear servicio')}
        </button>
      </>
    }>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Mismo flujo que una Solicitud de Pedido pero para <strong>servicios</strong> (recarga de gas, oxígeno,
        recarga de agua —botellones o cisterna—, mantenimiento de maquinaria, recarga de extintores…). Correlativo <strong className="mono">{codigo}</strong>. Luego se aprueba,
        se cotiza y se paga como cualquier OC. <strong>Mantenimiento de maquinaria</strong> lista los equipos de Maquinaria y Plantas Eléctricas; <strong>mantenimiento de vehículos</strong> lista los vehículos. En ambos se casa con el equipo de Control de Maquinaria/Vehículos.
      </p>

      <div className="form-row">
        <label>Unidad solicitante</label>
        <SearchSelect value={unidadSol} onChange={(v) => { setUnidadSol(v); setNuevaUnidad(''); }}
          options={unidades.map((u) => ({ value: u, label: u }))}
          placeholder="🔎 Elegí o buscá la unidad…" emptyText="Sin unidades. Escribí una nueva abajo." />
        <input className="input" style={{ marginTop: '.4rem' }} value={nuevaUnidad}
          onChange={(e) => { setNuevaUnidad(e.target.value.toUpperCase()); if (e.target.value) setUnidadSol(''); }}
          placeholder="¿No está? Escribí una nueva…" />
        <small className="muted" style={{ fontSize: '.72rem' }}>La unidad nueva queda guardada en el catálogo (Categorías → Unidad solicitante).</small>
      </div>

      <div className="form-row">
        <label>Quién lo solicita</label>
        <input className="input" value={solicitantePersona}
          onChange={(e) => setSolicitantePersona(e.target.value.toUpperCase())}
          placeholder="Nombre de la persona que pide el servicio…" />
        <small className="muted" style={{ fontSize: '.72rem' }}>La persona que solicita (queda registrada en la solicitud y se ve en Control de Mantenimiento).</small>
      </div>

      <div className="form-row">
        <label>Moneda del servicio</label>
        <div className="view-toggle" role="tablist" style={{ margin: 0 }}>
          <button type="button" className={moneda === 'USD' ? 'active' : ''} onClick={() => setModeda('USD')}>$ Dólares</button>
          <button type="button" className={moneda === 'Bs' ? 'active' : ''} onClick={() => setModeda('Bs')}>Bs Bolívares</button>
        </div>
        <small className="muted" style={{ fontSize: '.72rem' }}>Los precios estimados se cargan en esta moneda. Se puede cambiar al editar.</small>
        {/* Convertir los precios a la otra moneda a la tasa (del día o la que ponga el usuario). */}
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.45rem' }}>
          <span className="muted" style={{ fontSize: '.78rem' }}>Tasa (Bs/$)</span>
          <input className="input mono" type="number" min={0} step="any" style={{ maxWidth: 140 }} value={tasaConv} onChange={(e) => setTasaConv(e.target.value)} placeholder="0,00" />
          {tasaBcv > 0 && Number(tasaConv) !== tasaBcv && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTasaConv(String(tasaBcv))}>↻ Hoy ({tasaBcv.toLocaleString('es-VE')})</button>}
          <button type="button" className="btn btn-sm btn-primary" onClick={convertirMoneda}>⇄ Convertir a {moneda === 'USD' ? 'Bs' : '$'}</button>
        </div>
        <small className="muted" style={{ fontSize: '.72rem' }}>Convierte los precios cargados a {moneda === 'USD' ? 'Bs' : '$'} a esa tasa. El total va a Tesorería en esa moneda.</small>
      </div>

      <div className="form-row">
        <label>Servicios</label>
        <small className="muted" style={{ display: 'block', margin: '-.3rem 0 .5rem' }}>Podés agregar <strong>varios servicios de distinto tipo</strong> en la misma solicitud (mantenimiento, recarga de gas/agua, electrodoméstico…).</small>
        <div style={{ display: 'grid', gap: '.5rem' }}>
          {lineas.map((l, idx) => {
            const mantTipo = tipoMantenimiento(l.categoria);
            const mant = mantTipo !== null;
            const electro = esMantenimientoElectrodomestico(l.categoria);
            const equiposLista = equiposDeTipo(equipos, mantTipo);
            return (
              <div key={l.id} className="card" style={{ margin: 0, padding: '.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.45rem' }}>
                  <span className="badge primary">Servicio #{idx + 1}</span>
                  {lineas.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => delLinea(l.id)} title="Quitar este servicio">✕ Quitar</button>}
                </div>
                <div className="form-grid">
                  <div className="form-row" style={{ margin: 0 }}>
                    <label style={{ fontSize: '.74rem' }}>Categoría</label>
                    <SearchSelect value={l.categoria} onChange={(v) => setLinea(l.id, { categoria: v, equipoId: '', tipo: '' })}
                      options={categorias.map((c) => ({ value: c.nombre, label: c.nombre }))}
                      placeholder="🔎 Elegí o buscá categoría…" emptyText="Sin categorías." />
                  </div>
                  {mant ? (
                    <div className="form-row" style={{ margin: 0 }}>
                      <label style={{ fontSize: '.74rem' }}>{mantTipo === 'vehiculos' ? 'Vehículo (Control de Vehículos)' : mantTipo === 'motos' ? 'Moto (Control de Motos)' : 'Equipo (Control de Maquinaria)'}</label>
                      <SearchSelect value={l.equipoId} onChange={(v) => setLinea(l.id, { equipoId: v })}
                        options={equiposLista.map((eq) => ({ value: eq.id, label: `${eq.equipo}${eq.placa ? ` · ${eq.placa}` : ''}` }))}
                        placeholder={mantTipo === 'vehiculos' ? '🔎 Elegí o buscá el vehículo…' : mantTipo === 'motos' ? '🔎 Elegí o buscá la moto…' : '🔎 Elegí o buscá el equipo…'}
                        emptyText={mantTipo === 'vehiculos' ? 'Sin vehículos en ese grupo.' : mantTipo === 'motos' ? 'Sin motos registradas.' : 'Sin equipos.'} />
                    </div>
                  ) : electro ? (
                    <div className="form-row" style={{ margin: 0 }}>
                      <label style={{ fontSize: '.74rem' }}>Electrodoméstico</label>
                      <SearchSelect allowCreate value={l.electro} onChange={(v) => setLinea(l.id, { electro: v.toUpperCase() })}
                        options={ELECTRODOMESTICOS}
                        placeholder="🔎 Elegí (cocina, nevera, lavadora, microondas…)" emptyText="Escribí uno nuevo." />
                    </div>
                  ) : (
                    <div className="form-row" style={{ margin: 0 }}>
                      <label style={{ fontSize: '.74rem' }}>Servicio</label>
                      <input className="input" list={`servicio-tipos-${l.id}`} value={l.tipo}
                        onChange={(e) => setLinea(l.id, { tipo: e.target.value.toUpperCase() })}
                        placeholder="Elegí o escribí uno nuevo…" disabled={!l.categoria} />
                      <datalist id={`servicio-tipos-${l.id}`}>
                        {tipos.map((t) => <option key={t.id} value={t.nombre} />)}
                      </datalist>
                    </div>
                  )}
                </div>
                {(mant || electro) && (
                  <div className="form-row" style={{ marginTop: '.4rem' }}>
                    <label style={{ fontSize: '.74rem' }}>Tipo de servicio</label>
                    <SearchSelect value={l.tipo} onChange={(v) => setLinea(l.id, { tipo: v.toUpperCase() })}
                      options={[
                        ...TIPOS_SERVICIO_MANT,
                        ...tipos.filter((t) => !TIPOS_SERVICIO_MANT.some((x) => x.value === t.nombre.trim().toUpperCase())).map((t) => ({ value: t.nombre, label: t.nombre })),
                      ]}
                      placeholder="🔎 Elegí el tipo (caucho, repuesto, aceite, pintura…)" emptyText="Escribí uno nuevo." allowCreate />
                    <small className="muted" style={{ fontSize: '.72rem' }}>Lista base + catálogo. Si escribís uno nuevo, queda guardado.</small>
                  </div>
                )}
                {(mant || electro) && (() => {
                  const prod = l.repuestoId ? productosStock.find((p) => p.id === l.repuestoId) ?? null : null;
                  return (
                    <div className="form-grid" style={{ marginTop: '.4rem' }}>
                      <div className="form-row" style={{ margin: 0 }}>
                        <label style={{ fontSize: '.74rem' }}>Repuesto del inventario</label>
                        <SearchSelect value={l.repuestoId} onChange={(v) => setLinea(l.id, { repuestoId: v })}
                          options={productosStock.map((p) => ({ value: p.id, label: `${p.nombre} · ${p.sku} · stock ${num(p.stock)} ${p.unidad}${p.almacen ? ` · ${p.almacen}` : ''}` }))}
                          placeholder="🔎 Buscá el repuesto (caucho, filtro…) si sale del inventario" emptyText="Sin productos con stock." />
                        <small className="muted" style={{ fontSize: '.72rem' }}>Si el repuesto está en el inventario, se descuenta del stock al crear el servicio. Dejalo en blanco si no aplica.</small>
                      </div>
                      {prod && (() => {
                        const enTope = (Number(l.repuestoCant) || 0) >= prod.stock;
                        return (
                        <div className="form-row" style={{ margin: 0 }}>
                          <label style={{ fontSize: '.74rem' }}>Cantidad a tomar del inventario</label>
                          <input className="input mono" type="number" min={1} step="any" max={prod.stock}
                            value={l.repuestoCant}
                            onChange={(e) => {
                              const v = e.target.value;
                              setLinea(l.id, { repuestoCant: (Number(v) || 0) > prod.stock ? String(prod.stock) : v });
                            }} />
                          <small className="muted" style={{ fontSize: '.72rem', color: enTope ? 'var(--warning)' : undefined }}>
                            Disponible: {num(prod.stock)} {prod.unidad}{prod.almacen ? ` · ${prod.almacen}` : ''}{enTope ? ' · tope alcanzado' : ''}.
                          </small>
                        </div>
                        );
                      })()}
                    </div>
                  );
                })()}
                {esRecarga(l.categoria) ? (
                  <>
                    <div className="form-grid" style={{ marginTop: '.4rem' }}>
                      <div className="form-row" style={{ margin: 0 }}>
                        <label style={{ fontSize: '.74rem' }}>{esRecargaAgua(l.categoria) ? '🚰 Botellones / cisternas (cantidad)' : '🛢️ Cantidad de bombonas'}</label>
                        <input className="input mono" type="number" min={0} step="any" value={l.bombonas} onChange={(e) => setLinea(l.id, { bombonas: e.target.value })} placeholder={esRecargaAgua(l.categoria) ? 'N° de botellones/cisternas (1 = cisterna)' : 'N° de bombonas'} />
                      </div>
                      <div className="form-row" style={{ margin: 0 }}>
                        <label style={{ fontSize: '.74rem' }}>{esRecargaAgua(l.categoria) ? '💧 Litros por unidad' : '⚖️ KG por bombona'}</label>
                        <input className="input mono" type="number" min={0} step="any" value={l.kg} onChange={(e) => setLinea(l.id, { kg: e.target.value })} placeholder={esRecargaAgua(l.categoria) ? 'Litros de cada uno' : 'Kg de cada una'} />
                      </div>
                    </div>
                    <div className="form-grid" style={{ marginTop: '.4rem', alignItems: 'end' }}>
                      <div className="form-row" style={{ margin: 0 }}>
                        <label style={{ fontSize: '.74rem' }}>Total recarga</label>
                        <div className="card mono" style={{ margin: 0, padding: '.45rem .7rem', fontWeight: 700 }}>
                          {esRecargaAgua(l.categoria)
                            ? <>{Math.round((Number(l.bombonas) || 0) * (Number(l.kg) || 0) * 100) / 100} L de agua{(Number(l.bombonas) || 0) > 1 ? ` · ${(Number(l.bombonas) || 0)} und` : ''}</>
                            : <>{(Number(l.bombonas) || 0)} bombona(s) · {Math.round((Number(l.bombonas) || 0) * (Number(l.kg) || 0) * 100) / 100} KG</>}
                        </div>
                      </div>
                      <div className="form-row" style={{ margin: 0 }}>
                        <label style={{ fontSize: '.74rem' }}>Precio estimado ({monedaSym}, opcional)</label>
                        <input className="input mono" type="number" min={0} step="any" value={l.precio} onChange={(e) => setLinea(l.id, { precio: e.target.value })} placeholder="0,00" />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="form-grid" style={{ marginTop: '.4rem', alignItems: 'end' }}>
                    <div className="form-row" style={{ margin: 0 }}>
                      <label style={{ fontSize: '.74rem' }}>Cantidad</label>
                      <input className="input mono" type="number" min={0} step="any" value={l.cantidad} onChange={(e) => setLinea(l.id, { cantidad: e.target.value })} />
                    </div>
                    <div className="form-row" style={{ margin: 0 }}>
                      <label style={{ fontSize: '.74rem' }}>Precio estimado ({monedaSym}, opcional)</label>
                      <input className="input mono" type="number" min={0} step="any" value={l.precio} onChange={(e) => setLinea(l.id, { precio: e.target.value })} placeholder="0,00" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" className="btn btn-ghost" style={{ marginTop: '.5rem', width: '100%', borderStyle: 'dashed' }} onClick={addLinea}>＋ Agregar otro servicio (puede ser de otro tipo)</button>
        {total > 0 && (
          <div className="card" style={{ margin: '.5rem 0 0', display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Total estimado</span><strong className="mono">{fmtMonto(total, moneda)}</strong>
          </div>
        )}
      </div>

      <div className="form-row">
        <label>Nota (opcional)</label>
        <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Detalle / referencia del servicio…" />
      </div>

      {total > 0 && <div className="muted" style={{ textAlign: 'right', fontSize: '.85rem' }}>Total estimado: <strong className="mono">{money(total)}</strong></div>}
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginTop: '.5rem' }}><strong>Error:</strong> {error}</div>}
    </Modal>
  );
}

interface CrearOrdenModalProps {
  productos: Producto[];
  usuario: Usuario | null;
  authEmail: string;
  /** Si viene, el modal edita esa OP (pendiente) en vez de crear una nueva. */
  orden?: Orden | null;
  onClose: () => void;
  onCreated: () => void;
}
function CrearOrdenModal({
  productos,
  usuario,
  authEmail,
  orden,
  onClose,
  onCreated,
}: CrearOrdenModalProps) {
  const esEdicion = !!orden;
  const [items, setItems] = useState<ItemOrden[]>(orden?.items ?? []);
  // Texto crudo de cada cantidad (permite escribir decimales como 0,5 sin perder el punto).
  const [cantEdit, setCantEdit] = useState<Record<string, string>>({});
  const [notaOp, setNotaOp] = useState(orden?.notas ?? '');
  // Unidad solicitante: desplegable desde el catálogo + alta al vuelo (se guarda en el catálogo).
  const [unidadesSol, setUnidadesSol] = useState<string[]>([]);
  const [nuevaUnidad, setNuevaUnidad] = useState('');
  const [addingUnidad, setAddingUnidad] = useState(false);
  useEffect(() => {
    listCatalogoPedido('unidad_solicitante', true)
      .then((rows) => setUnidadesSol(rows.map((r) => r.nombre)))
      .catch(() => setUnidadesSol([]));
  }, []);
  async function handleAddUnidad() {
    const n = nuevaUnidad.trim();
    if (!n) { toast('Escribí el nombre de la unidad', 'error'); return; }
    const existente = unidadesSol.find((u) => u.toLowerCase() === n.toLowerCase());
    if (existente) { setSolicitanteNombre(existente); setNuevaUnidad(''); toast(`La unidad "${existente}" ya existe — se seleccionó`, 'warning'); return; }
    setAddingUnidad(true);
    try {
      await crearCatalogoPedido('unidad_solicitante', n, usuario?.email ?? authEmail);
      setUnidadesSol((prev) => [...prev, n].sort((a, b) => a.localeCompare(b, 'es')));
      setSolicitanteNombre(n);
      setNuevaUnidad('');
      toast(`Unidad "${n}" agregada al catálogo`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar la unidad', 'error'); }
    finally { setAddingUnidad(false); }
  }
  // Productos del inventario + los nuevos creados al vuelo en este modal.
  const [extraProductos, setExtraProductos] = useState<Producto[]>([]);
  const allProductos = useMemo(() => [...productos, ...extraProductos], [productos, extraProductos]);
  const [prodSelectId, setProdSelectId] = useState<string>(productos[0]?.id ?? '');
  const [codigo, setCodigo] = useState<string>('…');
  const [submitting, setSubmitting] = useState(false);

  // Refs a los inputs (no controlados): en el submit leemos el DOM —la verdad—
  // y no el estado, que puede ir atrasado si los re-renders del modal van lentos.
  const solicitanteRef = useRef<HTMLInputElement>(null);
  const notaRef = useRef<HTMLTextAreaElement>(null);
  const finalidadRef = useRef<Record<string, string>>({});
  const [urgente, setUrgente] = useState(orden?.urgente ?? false);
  const [imagen, setImagen] = useState<File | null>(null);

  // Alta rápida de un producto que aún no existe en inventario (datos mínimos;
  // el resto se completa luego desde el módulo de inventario).
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoCategoria, setNuevoCategoria] = useState('GENERAL');
  const [nuevoUnidad, setNuevoUnidad] = useState('UNIDAD');
  const [nuevoAlmacen, setNuevoAlmacen] = useState('');
  const [medidas, setMedidas] = useState<string[]>([]);
  const [categoriasInv, setCategoriasInv] = useState<string[]>([]);
  const [creandoNuevo, setCreandoNuevo] = useState(false);

  // Lista de medidas (unidades) y de CATEGORÍAS del inventario para el "Producto nuevo".
  // Las categorías se comparten con el inventario (misma taxonomía): al crear una nueva
  // acá queda guardada y sincronizada con el módulo de inventario.
  useEffect(() => {
    getUnidades(productos).then(setMedidas).catch(() => { /* usa defaults del repo */ });
    getCategorias(productos).then(setCategoriasInv).catch(() => setCategoriasInv([]));
  }, [productos]);

  async function crearProductoNuevo() {
    const nombre = nuevoNombre.trim().toUpperCase();
    if (!nombre) { toast('Escribí el nombre del producto', 'error'); return; }
    setCreandoNuevo(true);
    try {
      // SKU correlativo por categoría: 3 primeras letras (o el prefijo ya usado en esa
      // categoría) + secuencia. Ej.: PROTEINA → PRO-001. (Antes usaba NEW-<slug>-<rand>.)
      const categoria = nuevoCategoria.trim().toUpperCase() || 'GENERAL';
      // Si la categoría es nueva, se registra en la taxonomía del inventario (sincroniza la lista).
      if (categoria && !categoriasInv.some((c) => c.toLowerCase() === categoria.toLowerCase())) {
        try { await addCategoria(categoria, authEmail); setCategoriasInv((prev) => [...prev, categoria]); } catch { /* duplicado/red: no bloquea */ }
      }
      const sku = siguienteSku(categoria, allProductos);
      const creado = await createProducto({
        sku,
        nombre,
        categoria,
        unidad: nuevoUnidad.trim() || 'und',
        stock: 0,
        stock_min: 0,
        precio: 0,
        almacen: nuevoAlmacen.trim() || 'General',
        estado: 'activo',
      });
      setExtraProductos((prev) => [...prev, creado]);
      setProdSelectId(creado.id);
      // Agregar de una vez a la solicitud.
      setItems((prev) => prev.some((i) => i.productoId === creado.id)
        ? prev
        : [...prev, { productoId: creado.id, sku: creado.sku, nombre: creado.nombre, cantidad: 1, precio: 0, unidad: creado.unidad, comprar: true }]);
      toast(`Producto "${creado.nombre}" creado en inventario · completá el resto luego`, 'success');
      setNuevoNombre('');
      setNuevoOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear el producto', 'error');
    } finally {
      setCreandoNuevo(false);
    }
  }

  // Unidad solicitante (departamento) arranca VACÍA: la escribe quien crea la OP.
  // El Solicitante (nombre) viene precargado con el NOMBRE COMPLETO (nombre + apellido)
  // del usuario logueado pero es editable (un analista puede crear la solicitud a
  // nombre de otra persona).
  const nombreCompletoUsuario = `${usuario?.nombre ?? ''} ${usuario?.apellido ?? ''}`.trim();
  const [solicitanteNombre, setSolicitanteNombre] = useState(orden?.solicitante ?? '');
  const [solicitanteCi, setSolicitanteCi] = useState(orden?.ci_solicitante ?? nombreCompletoUsuario);

  useEffect(() => {
    // En edición el código ya existe; al crear se reserva el siguiente.
    if (esEdicion) { setCodigo(orden!.codigo); return; }
    nextCodigo().then(setCodigo).catch(() => setCodigo('OP-?'));
  }, [esEdicion, orden]);

  // El prefill del solicitante se hace SOLO en el valor inicial (useState arriba).
  // Antes había un useEffect que reprecargaba al cargar `usuario` async: ese
  // setState caía a mitad del tipeo (el Solicitante se llena primero, apenas se
  // abre el modal) y hacía perder las teclas del campo (quedaba solo el nombre,
  // sin apellido). Sin ese efecto, el input se comporta como los demás.

  function addItem() {
    const p = allProductos.find((x) => x.id === prodSelectId);
    if (!p) return;
    // El número manda tras (re)agregar: olvidamos el texto crudo de esa cantidad.
    setCantEdit((m) => { const n = { ...m }; delete n[p.id]; return n; });
    setItems((prev) => {
      const ex = prev.find((i) => i.productoId === p.id);
      if (ex) {
        return prev.map((i) =>
          i.productoId === p.id ? { ...i, cantidad: i.cantidad + 1 } : i
        );
      }
      // Precio inicia en 0; el precio real lo fija la oferta del proveedor.
      // comprar=true por defecto: se puede desmarcar para no comprarlo.
      return [
        ...prev,
        { productoId: p.id, sku: p.sku, nombre: p.nombre, cantidad: 1, precio: 0, unidad: p.unidad, comprar: true },
      ];
    });
  }

  function updateItem(idx: number, patch: Partial<ItemOrden>) {
    setItems((prev) => prev.map((i, k) => (k === idx ? { ...i, ...patch } : i)));
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, k) => k !== idx));
  }

  async function handleSubmit() {
    if (!items.length) {
      toast('Añade al menos un producto', 'error');
      return;
    }
    if (!items.some((i) => i.comprar !== false)) {
      toast('Marcá al menos un artículo a comprar', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const email = usuario?.email ?? authEmail;
      // Leemos el DOM (refs), no el estado, que puede ir atrasado por re-renders.
      const ciValor = (solicitanteRef.current?.value ?? solicitanteCi).trim();
      const notaValor = (notaRef.current?.value ?? notaOp).trim();
      const itemsValor = items.map((i) => ({
        ...i,
        finalidad: (finalidadRef.current[i.sku] ?? i.finalidad ?? '').trim() || undefined,
      }));
      // La unidad solicitante tipeada se guarda en el catálogo (botón Categorías).
      await ensureUnidadSolicitante(solicitanteNombre, email);
      if (esEdicion) {
        const saved = await actualizarOrden(orden!, {
          items: itemsValor,
          notas: notaValor || null,
          solicitante: solicitanteNombre.trim() || null,
          ci_solicitante: ciValor || null,
          urgente,
        }, email);
        // Sincroniza con inventario los nombres editados.
        const orig = new Map((orden!.items ?? []).map((i) => [i.sku, i.nombre]));
        const cambios = itemsValor
          .filter((i) => (i.nombre ?? '').trim() && i.nombre !== orig.get(i.sku))
          .map((i) => ({ productoId: i.productoId, sku: i.sku, nombre: i.nombre }));
        if (cambios.length) await sincronizarNombreProductos(cambios).catch(() => { /* no bloquear */ });
        if (imagen) {
          try { await adjuntarImagenOrden(saved.id, imagen); }
          catch (e) { toast(`Orden guardada, pero no se pudo subir la imagen: ${e instanceof Error ? e.message : ''}`, 'warning'); }
        }
        notify(`Orden ${saved.codigo} editada${urgente ? ' · URGENTE' : ''}`, 'success', { link: '#/app/pedidos' });
        onCreated();
        return;
      }
      const saved = await crearOrden({
        // proveedor_id se asigna luego por el admin durante el flujo de sourcing.
        proveedor_id: null,
        items: itemsValor,
        notas: notaValor || null,
        motivo: null,
        finalidad: null,
        clasificacion: [],
        solicitante_email: email,
        solicitante: solicitanteNombre.trim() || null,
        ci_solicitante: ciValor || null,
        urgente,
      });
      if (imagen) {
        try { await adjuntarImagenOrden(saved.id, imagen); }
        catch (e) { toast(`Orden creada, pero no se pudo subir la imagen: ${e instanceof Error ? e.message : ''}`, 'warning'); }
      }
      notify(`Nueva orden de pedido ${saved.codigo}${urgente ? ' · URGENTE' : ''} enviada para aprobación`, 'success', { link: '#/app/pedidos', destino: 'admin' });
      onCreated();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al crear', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={esEdicion ? `Editar orden de pedido ${orden!.codigo}` : 'Nueva orden de pedido'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Guardando…' : (esEdicion ? 'Guardar cambios' : 'Crear solicitud')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-row">
          <label>Unidad solicitante</label>
          <SearchSelect
            value={solicitanteNombre}
            onChange={setSolicitanteNombre}
            options={unidadesSol.map((u) => ({ value: u, label: u }))}
            placeholder="Departamento / unidad que solicita"
            emptyText="Sin unidades en el catálogo. Agregá una abajo."
          />
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem' }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="¿No está? Escribí la unidad nueva…"
              value={nuevaUnidad}
              onChange={(e) => setNuevaUnidad(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddUnidad(); } }}
              maxLength={60}
            />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void handleAddUnidad()} disabled={addingUnidad}>
              {addingUnidad ? 'Añadiendo…' : '+ Añadir'}
            </button>
          </div>
          <small className="muted" style={{ fontSize: '.72rem' }}>La unidad nueva queda guardada en el catálogo (Categorías → Unidad solicitante).</small>
        </div>
        <div className="form-row">
          <label>Código</label>
          <input className="input mono" value={codigo} disabled />
        </div>
      </div>

      <div className="form-row">
        <label>Solicitante</label>
        {/* No controlado (defaultValue): inmune a re-renders de fondo que, sobre
            un input controlado, revertían el texto y "borraban" lo tecleado. */}
        <input
          ref={solicitanteRef}
          className="input"
          defaultValue={nombreCompletoUsuario}
          onChange={(e) => setSolicitanteCi(e.target.value)}
          placeholder="Nombre del solicitante"
        />
      </div>

      <div className="form-row">
        <label>Productos solicitados</label>
        <div className="muted" style={{ fontSize: '.74rem', marginBottom: '.3rem' }}>
          Marcá los artículos a comprar e indicá la finalidad de cada uno. Los desmarcados quedan en la solicitud pero no se cotizan.
        </div>
        {/* Buscador SIEMPRE arriba: se pueden agregar todos los productos que haga falta (sin tope). */}
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.5rem' }}>
          <SearchSelect
            style={{ flex: 1 }}
            value={prodSelectId}
            onChange={setProdSelectId}
            options={allProductos.map((p) => ({ value: p.id, label: `${p.sku} · ${p.nombre}` }))}
            placeholder="Buscar producto por nombre o SKU…"
            emptyText="Ningún producto coincide"
          />
          <button type="button" className="btn btn-ghost" onClick={addItem}>+ Añadir</button>
        </div>
        <div className="line-picker head" style={{ gridTemplateColumns: '30px minmax(0, 1.4fr) 130px 34px' }}>
          <div title="Comprar">✓</div>
          <div>Producto</div>
          <div>Cantidad</div>
          <div></div>
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {items.map((it, idx) => {
            const comprar = it.comprar !== false;
            return (
            <div key={`${it.sku}-${idx}`} style={{ opacity: comprar ? 1 : 0.5, marginBottom: '.4rem' }}>
            <div className="line-picker" style={{ gridTemplateColumns: '30px minmax(0, 1.4fr) 130px 34px', marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={comprar}
                title={comprar ? 'Se comprará' : 'No se comprará'}
                onChange={(e) => updateItem(idx, { comprar: e.target.checked })}
                style={{ alignSelf: 'center' }}
              />
              <div>
                <input className="input" style={{ fontSize: '.9rem' }} value={it.nombre}
                  onChange={(e) => updateItem(idx, { nombre: e.target.value.toUpperCase() })}
                  title="Editar nombre (se sincroniza con el inventario al guardar)" />
                <div className="muted mono" style={{ fontSize: '.72rem' }}>{it.sku}</div>
              </div>
              {/* Cantidad + unidad de medida del producto (KG, L, und…). */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                <input
                  className="input mono"
                  type="number"
                  min={0}
                  step="any"
                  style={{ flex: 1, minWidth: 0, fontSize: '1.1rem', fontWeight: 700, textAlign: 'center' }}
                  value={cantEdit[it.sku] ?? String(it.cantidad)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setCantEdit((m) => ({ ...m, [it.sku]: raw }));
                    const n = Number(raw.replace(',', '.'));
                    if (raw !== '' && Number.isFinite(n) && n > 0) updateItem(idx, { cantidad: n });
                  }}
                  onBlur={() => {
                    const n = Number((cantEdit[it.sku] ?? String(it.cantidad)).replace(',', '.'));
                    const val = Number.isFinite(n) && n > 0 ? n : 1;
                    updateItem(idx, { cantidad: val });
                    setCantEdit((m) => ({ ...m, [it.sku]: String(val) }));
                  }}
                />
                {/* Unidad de medida editable (bulto, caja, KG, und…) con sugerencias del inventario. */}
                <input
                  className="input mono"
                  list="item-medidas"
                  style={{ width: 72, fontSize: '.78rem' }}
                  placeholder="unidad"
                  value={it.unidad ?? ''}
                  onChange={(e) => updateItem(idx, { unidad: e.target.value })}
                  title="Unidad de medida (bulto, caja, KG, und…)"
                />
              </div>
              <button
                type="button"
                className="rm"
                title="Quitar"
                onClick={() => removeItem(idx)}
              >
                ✕
              </button>
            </div>
            {/* Finalidad de la compra de este producto (solo si se va a comprar). */}
            {comprar && (
              <input
                className="input"
                style={{ marginLeft: 34, width: 'calc(100% - 34px)', fontSize: '.82rem' }}
                placeholder="Finalidad de este producto (¿para qué se compra?)"
                defaultValue={it.finalidad ?? ''}
                onChange={(e) => { finalidadRef.current[it.sku] = e.target.value; updateItem(idx, { finalidad: e.target.value }); }}
              />
            )}
            </div>
            );
          })}
          {/* Sugerencias de unidades de medida (del inventario) para los renglones de arriba. */}
          <datalist id="item-medidas">
            {medidas.map((u) => <option key={u} value={u} />)}
          </datalist>
        </div>

        <div style={{ marginTop: '.5rem' }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNuevoOpen((v) => !v)}>
            {nuevoOpen ? '× Cerrar' : '+ Producto nuevo (no existe en inventario)'}
          </button>
          {nuevoOpen && (
            <div className="card" style={{ padding: '.65rem', marginTop: '.4rem', display: 'grid', gap: '.5rem' }}>
              <div className="muted" style={{ fontSize: '.78rem' }}>
                Datos mínimos. Se crea en inventario y lo completás luego (stock, precio…).
              </div>
              <input
                className="input"
                placeholder="Nombre del producto *"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value.toUpperCase())}
              />
              <div className="form-grid">
                <div>
                  <input className="input" list="nuevo-prod-categorias" placeholder="Categoría (elegí o escribí una nueva)"
                    value={nuevoCategoria} onChange={(e) => setNuevoCategoria(e.target.value.toUpperCase())} />
                  <datalist id="nuevo-prod-categorias">
                    {categoriasInv.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <select className="select" value={nuevoUnidad} onChange={(e) => setNuevoUnidad(e.target.value)}>
                  {!medidas.includes(nuevoUnidad) && nuevoUnidad && <option value={nuevoUnidad}>{nuevoUnidad}</option>}
                  {medidas.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <AlmacenPicker
                value={nuevoAlmacen}
                onChange={setNuevoAlmacen}
                sedeLabel="Sede"
                label="Almacén destino"
              />
              <div>
                <button type="button" className="btn btn-sm btn-primary" onClick={crearProductoNuevo} disabled={creandoNuevo}>
                  {creandoNuevo ? 'Creando…' : 'Crear y añadir a la solicitud'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <label className="card" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', margin: '0 0 .8rem', padding: '.6rem .8rem', cursor: 'pointer', borderColor: urgente ? 'var(--danger)' : 'var(--border)', background: urgente ? 'rgba(239,68,68,.08)' : undefined }}>
        <input type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} />
        <span style={{ fontWeight: 700, color: urgente ? 'var(--danger)' : undefined }}>🚨 ORDEN: URGENTE</span>
        <span className="muted" style={{ fontSize: '.78rem', fontWeight: 400 }}>Marca la orden como prioritaria (se refleja en el PDF y en toda la trazabilidad).</span>
      </label>

      <div className="form-row">
        <label>Nota <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
        <textarea
          className="textarea"
          placeholder="Cualquier observación o aclaratoria sobre la solicitud (opcional)…"
          ref={notaRef}
          defaultValue=""
          onChange={(e) => setNotaOp(e.target.value)}
        />
      </div>

      <div className="form-row" style={{ marginTop: '.2rem' }}>
        <label>Imagen de referencia <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
        <input type="file" accept="image/*" className="input" onChange={(e) => setImagen(e.target.files?.[0] ?? null)} />
        {imagen && <small className="muted">📎 {imagen.name} ({(imagen.size / 1024 / 1024).toFixed(2)} MB)</small>}
        <small className="muted">Foto del repuesto/modelo a comprar. Se adjunta a la orden y queda en su trazabilidad.</small>
      </div>

      <p className="hint muted" style={{ fontSize: '.78rem', marginTop: '.75rem' }}>
        El precio lo fijará el proveedor al cargar su oferta. La solicitud queda sin monto hasta entonces.
      </p>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Modal: Catálogos de pedidos (switch Clasificación / Unidad solicitante)
   Agregar · filtrar · editar · habilitar/deshabilitar.
   ───────────────────────────────────────────── */
const CATALOGO_TABS: { key: ScopeCatalogoPedido; label: string; singular: string; placeholder: string }[] = [
  { key: 'unidad_solicitante', label: 'Unidad solicitante', singular: 'unidad solicitante', placeholder: 'Gerencia, Taller, Mina…' },
  { key: 'servicio_categoria', label: 'Categorías de servicio', singular: 'categoría de servicio', placeholder: 'Recarga de gas, Mantenimiento…' },
  { key: 'servicio_tipo', label: 'Tipos de servicio', singular: 'tipo de servicio', placeholder: 'Recarga 20kg, Cambio de aceite…' },
];

function CatalogoPedidosModal({ actor, onClose }: { actor: string; onClose: () => void }) {
  const [tab, setTab] = useState<ScopeCatalogoPedido>('unidad_solicitante');
  const [items, setItems] = useState<CatalogoPedido[]>([]);
  const [filtro, setFiltro] = useState('');
  const [nombre, setNombre] = useState('');
  const [edit, setEdit] = useState<{ id: string; nombre: string } | null>(null);
  const [borrar, setBorrar] = useState<CatalogoPedido | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    try { setItems(await listCatalogoPedido(tab)); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); }
  }, [tab]);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { setNombre(''); setFiltro(''); setEdit(null); }, [tab]);
  // Realtime: si otro usuario (o el form de OP / Salidas) agrega una unidad, se refleja al instante.
  useRealtime(['catalogos_pedido'], () => { void cargar(); });

  const meta = CATALOGO_TABS.find((t) => t.key === tab)!;
  const filtrados = items.filter((i) => i.nombre.toLowerCase().includes(filtro.trim().toLowerCase()));

  async function agregar() {
    if (!nombre.trim()) { toast('Escribí el nombre', 'error'); return; }
    setBusy(true);
    try {
      await crearCatalogoPedido(tab, nombre, actor);
      setNombre('');
      await cargar();
      toast('Agregado', 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error'); }
    finally { setBusy(false); }
  }
  async function guardarEdit() {
    if (!edit || !edit.nombre.trim()) { toast('Indicá el nombre', 'error'); return; }
    setBusy(true);
    try { await actualizarCatalogoPedido(edit.id, edit.nombre); setEdit(null); await cargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setBusy(false); }
  }
  async function toggle(it: CatalogoPedido) {
    try { await setEstadoCatalogoPedido(it.id, it.estado === 'activo' ? 'inactivo' : 'activo'); await cargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }
  async function eliminar() {
    const it = borrar;
    if (!it) return;
    setBorrar(null);
    try { await eliminarCatalogoPedido(it.id); await cargar(); toast('Eliminado', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <Modal title="📒 Categorías de pedidos" size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="view-toggle" role="tablist" style={{ marginBottom: '.8rem', marginLeft: 0 }}>
        {CATALOGO_TABS.map((t) => (
          <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title"><span>Agregar {meta.singular}</span></div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end' }}>
          <input
            className="input"
            style={{ flex: 1 }}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={meta.placeholder}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregar(); } }}
          />
          <button className="btn btn-primary" onClick={() => void agregar()} disabled={busy}>+ Agregar</button>
        </div>
      </div>

      <input
        className="input"
        placeholder={`Buscar ${meta.singular}…`}
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        style={{ marginBottom: '.5rem' }}
      />

      <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
        <table className="table">
          <thead><tr><th>{meta.label}</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {!filtrados.length && <tr><td colSpan={3} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin resultados.</td></tr>}
            {filtrados.map((it) => (
              <tr key={it.id} style={{ opacity: it.estado === 'activo' ? 1 : 0.55 }}>
                <td>{it.nombre}</td>
                <td>{it.estado === 'activo' ? '🟢 Activo' : '⚪ Inactivo'}</td>
                <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEdit({ id: it.id, nombre: it.nombre })}>✎ Editar</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => void toggle(it)}>{it.estado === 'activo' ? 'Deshabilitar' : 'Habilitar'}</button>
                  <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(it)} title="Eliminar definitivamente">🗑 Eliminar</button>
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
              onKeyDown={(e) => { if (e.key === 'Enter') void guardarEdit(); }} />
          </div>
        </Modal>
      )}

      {borrar && (
        <ConfirmDialog
          title={`Eliminar ${meta.singular}`}
          message={`¿Eliminar definitivamente «${borrar.nombre}» del catálogo? Esta acción no se puede deshacer.`}
          confirmText="Eliminar"
          danger
          onCancel={() => setBorrar(null)}
          onConfirm={() => void eliminar()}
        />
      )}
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Modal: Captura de motivo (rechazo / cancelación / desistimiento)
   ───────────────────────────────────────────── */
interface MotivoModalProps {
  title: string;
  confirmText: string;
  label: string;
  intro?: string;
  placeholder?: string;
  danger?: boolean;
  /** Si se indica, antes de ejecutar muestra un «¿Seguro?» con este mensaje. */
  confirmMessage?: string;
  onClose: () => void;
  onConfirm: (motivo: string) => void | Promise<void>;
}
function MotivoModal({
  title,
  confirmText,
  label,
  intro,
  placeholder,
  danger,
  confirmMessage,
  onClose,
  onConfirm,
}: MotivoModalProps) {
  const [motivo, setMotivo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  async function ejecutar() {
    setConfirmar(false);
    setSubmitting(true);
    try {
      await onConfirm(motivo.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancelar</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={submitting || !motivo.trim()}
            onClick={() => { if (confirmMessage) setConfirmar(true); else void ejecutar(); }}
          >
            {confirmText}
          </button>
        </>
      }
    >
      {intro && <p className="hint muted">{intro}</p>}
      <div className="form-row">
        <label>{label}</label>
        <textarea
          className="textarea"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder={placeholder}
          required
        />
      </div>
      {confirmar && (
        <ConfirmDialog
          title={title}
          message={confirmMessage as string}
          confirmText={confirmText}
          danger
          onConfirm={() => void ejecutar()}
          onCancel={() => setConfirmar(false)}
        />
      )}
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Modal: Comparativa histórica de precios por SKU (FASE 1)
   ───────────────────────────────────────────── */
interface HistoricoPreciosModalProps {
  sku: string;
  nombre: string;
  onClose: () => void;
}
function HistoricoPreciosModal({ sku, nombre, onClose }: HistoricoPreciosModalProps) {
  const [rows, setRows] = useState<PrecioHistorico[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHistoricoPreciosPorSku(sku)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Error');
      });
    return () => {
      cancelled = true;
    };
  }, [sku]);

  // Agrupar por proveedor y calcular min/promedio/max.
  const resumen = useMemo(() => {
    if (!rows) return [];
    const grupos = new Map<string, { nombre: string; precios: number[] }>();
    rows.forEach((r) => {
      const g = grupos.get(r.proveedor_id) ?? { nombre: r.proveedor_nombre, precios: [] };
      g.precios.push(r.precio);
      grupos.set(r.proveedor_id, g);
    });
    return Array.from(grupos.entries()).map(([id, g]) => {
      const min = Math.min(...g.precios);
      const max = Math.max(...g.precios);
      const avg = g.precios.reduce((a, b) => a + b, 0) / g.precios.length;
      return { id, nombre: g.nombre, min, max, avg, n: g.precios.length };
    });
  }, [rows]);

  return (
    <Modal
      title={`Histórico de precios · ${sku}`}
      size="lg"
      onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}
    >
      <p className="hint muted">{nombre}</p>
      {err && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <strong>Error:</strong> {err}
        </div>
      )}
      {!rows && !err && <EmptyState message="Cargando…" icon="◔" />}
      {rows && rows.length === 0 && (
        <EmptyState message="No hay órdenes anteriores con este SKU." icon="◇" />
      )}
      {rows && rows.length > 0 && (
        <>
          <h4 style={{ marginTop: '1rem' }}>Resumen por proveedor</h4>
          <div className="table-wrap">
          <table className="items-table">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th className="num">Mín</th>
                <th className="num">Promedio</th>
                <th className="num">Máx</th>
                <th className="num">Compras</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((r) => (
                <tr key={r.id}>
                  <td>{r.nombre}</td>
                  <td className="num">{money(r.min)}</td>
                  <td className="num">{money(r.avg)}</td>
                  <td className="num">{money(r.max)}</td>
                  <td className="num">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <h4 style={{ marginTop: '1.25rem' }}>Detalle</h4>
          <div className="table-wrap">
          <table className="items-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Orden</th>
                <th>Proveedor</th>
                <th>Estado</th>
                <th className="num">Cantidad</th>
                <th className="num">Precio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.codigo_orden}-${i}`}>
                  <td className="muted" style={{ fontSize: '.82rem' }}>{dateTime(r.fecha)}</td>
                  <td className="mono">{r.codigo_orden}</td>
                  <td>{r.proveedor_nombre}</td>
                  <td><StatusBadge estado={r.estado_orden} /></td>
                  <td className="num">{num(r.cantidad)}</td>
                  <td className="num">{money(r.precio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </Modal>
  );
}
