import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime, money, num, relTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
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
import {
  aprobarOrden,
  aprobarOcsEnLote,
  actualizarComprarItems,
  anularOrden,
  cancelarOrden,
  crearOrden,
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
  recibirOrdenParcial,
  enviarCreditoARecepcion,
  listAbonos,
  urlAdjuntoOc,
  indicarMetodoPago,
  METODOS_PAGO,
  labelMetodoPago,
  listCatalogoPedido,
  crearCatalogoPedido,
  actualizarCatalogoPedido,
  setEstadoCatalogoPedido,
  ensureUnidadSolicitante,
  type PrecioHistorico,
  type CatalogoPedido,
  type ScopeCatalogoPedido,
} from './pedidos.repository';
import { listOfertasByOrden, labelCondicionPago } from './ofertas.repository';
import { listCajasActivas } from '@/modules/salidas/cajas.repository';
import type { AbonoCredito, Caja } from '@/shared/lib/types';
import { listDatosPago, requiereDatos, type DatosPago } from './datosPago.repository';
import { DatosPagoFields, validarDatosPago } from '@/shared/ui/DatosPagoFields';
import { crearEvaluacion } from './evaluaciones.repository';
import { createProducto, getUnidades } from '@/modules/inventario/inventario.repository';
import { listAlmacenes } from '@/modules/inventario/almacenes.repository';
import { AlmacenPicker } from '@/modules/inventario/AlmacenPicker';
import { listUsuarios } from '@/modules/usuarios/usuarios.repository';
import type { Almacen } from '@/shared/lib/types';
import { OfertasComparativa } from './OfertasComparativa';
import { AgregarOfertaModal } from './AgregarOfertaModal';
import { descargarTrazabilidadPdf } from './trazabilidadPdf';
import { enviarTrazabilidadAMultiples } from './enviarTrazabilidad';
import { descargarOrdenCompraPdf } from './ordenCompraPdf';
import { CompraDirectaView } from './CompraDirectaView';
import { OcPorLoteView } from './OcPorLoteView';

/* ============================================================
   MGG · Pedidos / Órdenes · Página principal
   Mantiene la lógica de negocio del demo (estados, historial,
   reglas de aprobación) sobre datos persistidos en Supabase.
   ============================================================ */

const VIEW_KEY = 'mgg.view.pedidos';
const SCOPE_KEY = 'mgg.scope.pedidos';
type ViewMode = 'kanban' | 'lista';
type Scope = 'pedidos' | 'oc' | 'compra_directa' | 'oc_lote';

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
      oc_creada: 'OC creada (oferta elegida)',
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
      oc_creada: 'info',
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
  useRealtime(['ordenes', 'productos'], () => { void refresh(); });

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

  const isAdmin = usuario?.role === 'admin';
  // Analista y admin manejan compras (cargar ofertas, emitir OC, recibir mercancía).
  // El "aprobar" final (aceptar la oferta ganadora) sigue siendo solo del jefe/admin.
  const canManageProcurement = isAdmin || usuario?.role === 'analista';
  // El obrero solo crea solicitudes de pedido y las finaliza: sin acceso a Órdenes de Compra.
  const isObrero = usuario?.role === 'obrero';

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

  const filteredOrdenes = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return ordenes.filter((o) => {
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
  }, [ordenes, filterText, filterEstado, viewMode, proveedorMap]);

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

  const kanbanCols = scope === 'oc' ? KANBAN_COLS_OC : KANBAN_COLS_PEDIDOS;

  const currentDetail =
    modal.kind === 'detail' ? ordenes.find((o) => o.id === modal.ordenId) ?? null : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{scope === 'oc' ? 'Órdenes de Compra' : scope === 'compra_directa' ? 'Compra Directa' : scope === 'oc_lote' ? 'OC por lote' : 'Órdenes'}</h1>
          <p className="muted">
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
          {scope !== 'compra_directa' && scope !== 'oc_lote' && (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => setModal({ kind: 'catalogo' })}
                title="Gestionar las unidades solicitantes"
              >
                📒 Categorías
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setModal({ kind: 'create' })}
              >
                + Nueva orden
              </button>
            </>
          )}
        </div>
      </div>

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
            title="Ver órdenes de pedido"
          >
            ✉ Órdenes de Pedido
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
        />
      ) : (
        <OrdenesTable
          ordenes={filteredOrdenes}
          proveedorMap={proveedorMap}
          isAdmin={isAdmin}
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
          canManageProcurement={canManageProcurement}
          enOc={scope === 'oc'}
          actorEmail={user?.email ?? ''}
          offersReloadKey={offersReloadKey}
          onAddOffer={() => setModal({ kind: 'add-offer', orden: currentDetail })}
          onAcceptedOffer={async () => {
            await refresh();
            setOffersReloadKey((k) => k + 1);
          }}
          onClose={() => setModal({ kind: 'none' })}
          onApprove={() => setModal({ kind: 'approve', orden: currentDetail })}
          onConfirmOc={async () => {
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
          }}
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
          message={`Aprobar ${modal.orden.codigo} por ${money(modal.orden.total)}.`}
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
          intro="Cancelar la orden. Útil cuando el cliente solicita cancelar o la empresa desiste del proyecto."
          label="Motivo"
          onClose={() => setModal({ kind: 'none' })}
          onConfirm={async (motivo) => {
            try {
              await cancelarOrden(modal.orden, usuario?.email ?? user?.email ?? 'sistema', motivo);
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
          onClose={() => setModal({ kind: 'none' })}
          onSent={async (metodos, soporte) => {
            try {
              await indicarMetodoPago(modal.orden, metodos, usuario?.email ?? user?.email ?? 'sistema', soporte);
              const extra = soporte.comprobanteTipo === 'factura' ? ' · enviada también a Retenciones' : '';
              notify(`OC ${modal.orden.oc_codigo ?? modal.orden.codigo} enviada para pagar · disponible en Tesorería${extra}`, 'success', { link: '#/app/tesoreria' });
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
          onConfirm={async (recepciones, nota, almacenDestino) => {
            try {
              await recibirOrdenParcial(
                modal.orden,
                recepciones,
                nota,
                usuario?.email ?? user?.email ?? 'sistema',
                usuario?.nombre ?? null,
                almacenDestino,
              );
              const esContra = modal.orden.condiciones_pago === 'contra_entrega';
              notify(
                esContra
                  ? `Recepción confirmada · ${modal.orden.codigo} · indicá el método para pagar lo recibido`
                  : `Mercancía recibida · ${modal.orden.codigo} · stock actualizado`,
                'success', { link: esContra ? '#/app/pedidos' : '#/app/inventario' },
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
          onConfirm={async ({ calidad, puntualidadDias, comentario }) => {
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
            await finalizarPedido(modal.orden, actor);
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
  onConfirm: (data: { calidad: number; puntualidadDias: number; comentario: string }) => Promise<void>;
}) {
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
      await onConfirm({ calidad, puntualidadDias, comentario: comentario.trim() });
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
      <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
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

function MetodoPagoModal({
  orden,
  onClose,
  onSent,
}: {
  orden: Orden;
  onClose: () => void;
  onSent: (metodos: PagoMetodo[], soporte: { comprobanteTipo: 'nota_entrega' | 'factura'; retencionModo: 'se_paga_despues' | 'completo_reembolso' | null }) => Promise<void> | void;
}) {
  const [legs, setLegs] = useState<PagoMetodo[]>([{ metodo: 'divisas_efectivo', moneda: monedaPorMetodo('divisas_efectivo'), monto: 0 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Datos de pago del proveedor ya guardados (para precargar por método).
  const [datosGuardados, setDatosGuardados] = useState<Record<string, DatosPago>>({});
  // Contra entrega: ya se recibió y verificó; se confirma la Nota de entrega antes de pagar.
  const esContraEntrega = orden.condiciones_pago === 'contra_entrega';
  const [notaEntrega, setNotaEntrega] = useState(false);
  // Soporte: Nota de entrega → directo a Tesorería. Factura → además pasa por Retenciones.
  const [comprobanteTipo, setComprobanteTipo] = useState<'nota_entrega' | 'factura'>('nota_entrega');
  const [retencionModo, setRetencionModo] = useState<'se_paga_despues' | 'completo_reembolso'>('se_paga_despues');

  useEffect(() => {
    if (!orden.proveedor_id) return;
    listDatosPago(orden.proveedor_id).then(setDatosGuardados).catch(() => { /* sin datos previos */ });
  }, [orden.proveedor_id]);

  function setLeg(i: number, patch: Partial<PagoMetodo>) {
    setLegs((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  }
  // Al cambiar de método, precarga los datos guardados del proveedor para ese método.
  function cambiarMetodo(i: number, metodo: string) {
    setLeg(i, { metodo, moneda: monedaPorMetodo(metodo), datos: requiereDatos(metodo) ? (datosGuardados[metodo] ?? {}) : undefined });
  }
  function addLeg() { setLegs((ls) => [...ls, { metodo: 'transferencia', moneda: monedaPorMetodo('transferencia'), monto: 0, datos: datosGuardados['transferencia'] ?? {} }]); }
  function removeLeg(i: number) { setLegs((ls) => ls.filter((_, k) => k !== i)); }

  // El monto lo define Tesorería al pagar; acá solo se eligen método(s) y moneda(s).
  const validos = legs.filter((l) => l.metodo && l.moneda);

  async function handleSend() {
    setError(null);
    if (!validos.length) { setError('Indicá al menos un método de pago.'); return; }
    if (esContraEntrega && !notaEntrega) { setError('Confirmá la Nota de entrega (verificaste lo recibido) antes de enviar a pagar.'); return; }
    // Validar datos del proveedor en los métodos que los requieren.
    for (const l of validos) {
      if (requiereDatos(l.metodo)) {
        const err = validarDatosPago(l.metodo, l.datos ?? {});
        if (err) { setError(`${METODOS_PAGO.find((m) => m.value === l.metodo)?.label}: ${err}`); return; }
      }
    }
    setSaving(true);
    try { await onSent(validos, { comprobanteTipo, retencionModo: comprobanteTipo === 'factura' ? retencionModo : null }); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo enviar'); setSaving(false); }
  }

  return (
    <Modal
      title={`Método de pago · OC ${orden.oc_codigo ?? orden.codigo}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSend} disabled={saving}>
            {saving ? 'Enviando…' : '💳 Enviar para Pagar'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
        Indicá <strong>con qué método(s)</strong> se va a pagar la OC ({orden.condiciones_pago === 'contra_entrega' && orden.recibido_total != null
          ? <>recibido <strong>{money(orden.recibido_total)}</strong></>
          : <>total <strong>{money(orden.total)}</strong></>}). Podés combinar
        varios (<strong>multipago</strong>). El <strong>monto lo define Tesorería</strong> al pagar. Al enviar pasa a <strong>Confirmada pagar</strong> y aparece en Tesorería.
      </p>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

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
  onConfirm: (recepciones: { sku: string; cantidad_recibida: number }[], nota: string | null, almacenDestino: string) => Promise<void> | void;
}) {
  const [recs, setRecs] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    orden.items.forEach((it) => { m[it.sku] = String(it.cantidad); });
    return m;
  });
  const [nota, setNota] = useState('');
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [almacen, setAlmacen] = useState<string>(orden.almacen_destino ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  const recibidoTotal = orden.items.reduce((a, it) => a + (Number(recs[it.sku]) || 0) * Number(it.precio), 0);
  const hayDiferencia = orden.items.some((it) => (Number(recs[it.sku]) || 0) < Number(it.cantidad));

  async function handleConfirm() {
    setError(null);
    const recepciones = orden.items.map((it) => ({ sku: it.sku, cantidad_recibida: Number(recs[it.sku]) || 0 }));
    if (recepciones.every((r) => r.cantidad_recibida <= 0)) { setError('Indicá al menos una cantidad recibida.'); return; }
    if (!almacen.trim()) { setError('Elegí el almacén destino al que entra la mercancía.'); return; }
    if (hayDiferencia && !nota.trim()) { setError('Recibiste menos de lo pedido: indicá una nota explicando la diferencia.'); return; }
    setSaving(true);
    try { await onConfirm(recepciones, nota.trim() || null, almacen.trim()); }
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
      <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
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

      <div className="form-row" style={{ marginTop: '.5rem' }}>
        <label>Almacén destino *</label>
        <select className="select" value={almacen} onChange={(e) => setAlmacen(e.target.value)} required>
          <option value="">— elegí el almacén —</option>
          {almacenes.map((a) => <option key={a.id} value={a.nombre}>{a.nombre}</option>)}
        </select>
        <small className="muted">La mercancía entra a este almacén y queda en la trazabilidad final.</small>
      </div>

      <div className="form-row" style={{ marginTop: '.5rem' }}>
        <label>Nota de recepción {hayDiferencia && <span style={{ color: 'var(--warning)' }}>(obligatoria · llegó menos de lo pedido)</span>}</label>
        <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)}
          placeholder="Diferencias, faltantes, observaciones de la recepción…" />
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

  return (
    <Modal title={`Crédito · OC ${orden.oc_codigo ?? orden.codigo}`} size="lg" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.6rem', marginBottom: '.75rem' }}>
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
          <thead><tr><th>Fecha</th><th style={{ textAlign: 'right' }}>Monto</th><th>Caja</th><th style={{ textAlign: 'right' }}>Saldo</th><th>Nota</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="muted">Cargando…</td></tr>
            ) : !abonos.length ? (
              <tr><td colSpan={5}><EmptyState message="Sin abonos todavía." icon="💵" /></td></tr>
            ) : abonos.map((b) => (
              <tr key={b.id}>
                <td className="muted" style={{ fontSize: '.78rem' }}>{dateTime(b.at)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(Number(b.monto))} {b.moneda}</td>
                <td>{cajas.find((c) => c.id === b.caja_id)?.nombre ?? '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{b.saldo_restante != null ? money(Number(b.saldo_restante)) : '—'}</td>
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
  isAdmin: boolean;
  onView: (id: string) => void;
  onApprove: (o: Orden) => void;
}
function OrdenesTable({ ordenes, proveedorMap, isAdmin, onView, onApprove }: OrdenesTableProps) {
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
            const canApprove = isAdmin && o.estado === 'pendiente';
            const cambios = (o.historial ?? []).filter((h) => h.evento === 'proveedor_cambiado').length;
            return (
              <tr key={o.id}>
                <td className="mono">{o.codigo}</td>
                <td>
                  <div>{prov?.razon_social ?? '—'}</div>
                  {cambios > 0 && (
                    <div className="muted" style={{ fontSize: '.72rem' }}>
                      ↻ {cambios} cambio(s) de proveedor
                    </div>
                  )}
                </td>
                <td>
                  <div>{o.solicitante ?? '—'}</div>
                  <div className="muted" style={{ fontSize: '.75rem' }}>{o.solicitante_email}</div>
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{o.items.length}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(o.total)}</td>
                <td><StatusBadge estado={o.estado} /></td>
                <td className="muted" style={{ fontSize: '.82rem' }}>{dateTime(o.created_at)}</td>
                <td className="actions">
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
}
function KanbanBoard({ ordenes, proveedorMap, cols, onOpen }: KanbanBoardProps) {
  const byState = useMemo(() => {
    const map = new Map<EstadoOrden, Orden[]>();
    cols.forEach((c) => map.set(c.key, []));
    ordenes.forEach((o) => {
      const list = map.get(o.estado);
      if (list) list.push(o);
    });
    return map;
  }, [ordenes, cols]);

  return (
    <div className="kanban">
      {cols.map((col) => {
        const items = byState.get(col.key) ?? [];
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
                items.map((o) => (
                  <KanbanCard
                    key={o.id}
                    orden={o}
                    proveedor={o.proveedor_id ? proveedorMap.get(o.proveedor_id) ?? null : null}
                    onOpen={onOpen}
                  />
                ))
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
}: {
  orden: Orden;
  proveedor: Proveedor | null;
  onOpen: (id: string) => void;
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
      style={creditoPagado ? { borderColor: 'var(--success)', boxShadow: '0 0 0 1px var(--success)' } : undefined}
    >
      <div className="code">{orden.codigo}</div>
      <div className="prov">
        {proveedor?.razon_social
          ?? ((orden.ci_solicitante ?? orden.solicitante)
            ? `Solicita: ${orden.ci_solicitante ?? orden.solicitante}`
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
        <span>👤 {orden.ci_solicitante ?? orden.solicitante ?? orden.solicitante_email ?? '—'}
          {orden.ci_solicitante && orden.solicitante ? <span className="muted"> · {orden.solicitante}</span> : null}
        </span>
        <span className="muted">· {dateTime(orden.created_at)}</span>
      </div>
      <div className="foot">
        <span className="total">{money(orden.total)}</span>
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
  canManageProcurement: boolean;
  /** true cuando se abre desde la pestaña Órdenes de Compra (allí se gestionan ofertas/proveedor). */
  enOc: boolean;
  actorEmail: string;
  onClose: () => void;
  onApprove: () => void;
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
  offersReloadKey: number;
  usuarioRole: string | null;
}
function OrdenDetailModal({
  orden: o,
  proveedor,
  proveedorMap,
  personaMap,
  isAdmin,
  canManageProcurement,
  enOc,
  actorEmail,
  onClose,
  onApprove,
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
  offersReloadKey,
  usuarioRole,
}: OrdenDetailModalProps) {
  const isPendiente = o.estado === 'pendiente';
  // La OP la aprueba quien gestiona compras (admin o analista); al aprobarla pasa a
  // Órdenes de Compra. La elección de la oferta ganadora sí queda solo para el jefe/admin.
  const canApprove = canManageProcurement && isPendiente;  // Aprobar Orden de Pedido
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

  async function handleDownloadPdf() {
    try {
      await descargarTrazabilidadPdf(o.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error');
    }
  }
  function handleOcPdf() {
    descargarOrdenCompraPdf(o.id).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar', 'error'));
  }
  async function handleComprobante() {
    if (!o.factura_path) return;
    try {
      const url = await urlAdjuntoOc(o.factura_path);
      window.open(url, '_blank', 'noopener,noreferrer');
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
      {canCancel && (
        <button className="btn btn-danger" onClick={onCancel}>Cancelar orden</button>
      )}
      {/* Etapa OC: oferta ya elegida (sin confirmar). Se confirma individual o en lote (checklist). */}
      {isOcCreada && canManageProcurement && (
        <>
          <button className="btn btn-ghost" onClick={onDesistir} title="Proveedor no cumplió">⚠ Proveedor desistió</button>
          <button className="btn btn-ghost" onClick={onModificar} title="Volver a la etapa de ofertas para re-elegir la oferta ganadora">✎ Modificar OC</button>
          <button className="btn btn-ghost" onClick={handleOcPdf} title="Descargar la OC en PDF">↓ OC PDF</button>
          <button className="btn btn-danger" onClick={onAnular} title="Anular esta OC (queda en estado Anulada)">⊘ Anular OC</button>
        </>
      )}
      {isOcCreada && isAdmin && (
        <button className="btn btn-success" onClick={onConfirmOc} title="Aprobar esta OC de forma puntual (sin pasar por el lote)">
          ✔ Aprobar OC
        </button>
      )}
      {/* Confirmada por el gerente: falta indicar el método de pago y enviar a pagar. */}
      {isConfirmadaMetodo && canManageProcurement && (
        <>
          <button className="btn btn-ghost" onClick={handleOcPdf} title="Descargar la OC en PDF">↓ OC PDF</button>
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
    <Modal title={`Orden ${o.codigo}`} size="lg" onClose={onClose} footer={buttons}>
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
          {o.ci_solicitante ?? persona(o.solicitante_email, personaMap)} <span className="muted">({o.solicitante_email})</span>
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
      {o.abonado_total != null && o.abonado_total > 0 && (
        <div className="detail-row">
          <div className="k">Abonado (crédito)</div>
          <div className="v mono">{money(o.abonado_total)} <span className="muted">de {money(o.total)}</span></div>
        </div>
      )}
      {o.recibida_en && (
        <div className="detail-row">
          <div className="k">Recepción</div>
          <div className="v">
            {dateTime(o.recibida_en)} <span className="muted">por {persona(o.recibida_por, personaMap)}</span>
            {o.recibido_total != null && <div className="mono" style={{ fontSize: '.84rem' }}>Total recibido: {money(o.recibido_total)}{o.recibido_total < o.total && <span className="muted"> · de {money(o.total)}</span>}</div>}
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
      {o.notas && (
        <div className="detail-row">
          <div className="k">Notas</div>
          <div className="v">{o.notas}</div>
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

      <h4 style={{ marginTop: '1rem' }}>Ítems</h4>
      {/* En etapa OP (sin oferta aceptada) no hay precio: se oculta Precio/Subtotal
          y se marca cuáles se compran. Con oferta aceptada (total>0) se muestra todo. */}
      {(() => {
        const conPrecio = Number(o.total) > 0;
        // En etapa OP (sin precio) quien gestiona compras puede marcar/desmarcar
        // qué ítems se aprueban para comprar.
        const puedeEditarComprar = !conPrecio && canManageProcurement;
        return (
      <table className="items-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Producto</th>
            <th>Finalidad</th>
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
              <td>{it.nombre}</td>
              <td style={{ fontSize: '.84rem' }}>{it.finalidad?.trim() ? it.finalidad : <span className="muted">—</span>}</td>
              <td className="num">{num(it.cantidad)}{it.unidad ? ` ${it.unidad}` : ''}</td>
              {conPrecio ? (
                <>
                  <td className="num">{money(it.precio)}</td>
                  <td className="num">{money(it.cantidad * it.precio)}</td>
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
            <tr>
              <td colSpan={5} className="num">TOTAL</td>
              <td className="num">{money(o.total)}</td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>
        );
      })()}

      <h4 style={{ marginTop: '1.25rem' }}>Historial</h4>
      <Timeline historial={o.historial ?? []} proveedorMap={proveedorMap} personaMap={personaMap} />
    </Modal>
    {enviarOpen && (
      <EnviarPorCorreoModal
        ordenId={o.id}
        ordenCodigo={o.codigo}
        defaultEmail={actorEmail}
        onClose={() => setEnviarOpen(false)}
      />
    )}
    </>
  );
}

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
      <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
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
  if (!historial.length) return <p className="muted">Sin eventos registrados.</p>;
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
interface CrearOrdenModalProps {
  productos: Producto[];
  usuario: Usuario | null;
  authEmail: string;
  onClose: () => void;
  onCreated: () => void;
}
// [DEBUG TEMPORAL] Contador a nivel de módulo: sobrevive a un remount del modal.
// Si al abrir el modal una vez el número sube solo, es que se está remontando.
let __opModalMounts = 0;
function CrearOrdenModal({
  productos,
  usuario,
  authEmail,
  onClose,
  onCreated,
}: CrearOrdenModalProps) {
  const [items, setItems] = useState<ItemOrden[]>([]);
  // Texto crudo de cada cantidad (permite escribir decimales como 0,5 sin perder el punto).
  const [cantEdit, setCantEdit] = useState<Record<string, string>>({});
  const [notaOp, setNotaOp] = useState('');
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

  // Alta rápida de un producto que aún no existe en inventario (datos mínimos;
  // el resto se completa luego desde el módulo de inventario).
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoCategoria, setNuevoCategoria] = useState('GENERAL');
  const [nuevoUnidad, setNuevoUnidad] = useState('und');
  const [nuevoAlmacen, setNuevoAlmacen] = useState('');
  const [medidas, setMedidas] = useState<string[]>([]);
  const [creandoNuevo, setCreandoNuevo] = useState(false);

  // Lista de medidas (unidades) del inventario para el desplegable de "Producto nuevo".
  useEffect(() => {
    getUnidades(productos).then(setMedidas).catch(() => { /* usa defaults del repo */ });
  }, [productos]);

  async function crearProductoNuevo() {
    const nombre = nuevoNombre.trim().toUpperCase();
    if (!nombre) { toast('Escribí el nombre del producto', 'error'); return; }
    setCreandoNuevo(true);
    try {
      const base = nombre.replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 14) || 'PROD';
      const sufijo = Math.floor(performance.now() % 100000).toString(36).toUpperCase();
      const creado = await createProducto({
        sku: `NEW-${base}-${sufijo}`,
        nombre,
        categoria: nuevoCategoria.trim().toUpperCase() || 'GENERAL',
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
  const [solicitanteNombre, setSolicitanteNombre] = useState('');
  const [solicitanteCi, setSolicitanteCi] = useState(nombreCompletoUsuario);

  useEffect(() => {
    nextCodigo().then(setCodigo).catch(() => setCodigo('OP-?'));
  }, []);

  // [DEBUG TEMPORAL] Detecta si el modal se remonta (lo que borraría lo tecleado).
  const [mntNo] = useState(() => ++__opModalMounts);
  useEffect(() => {
    console.log(`%c[OP-DEBUG] 🟢 modal MONTADO (montaje #${mntNo})`, 'color:#22c55e;font-weight:bold');
    return () => console.log(`%c[OP-DEBUG] 🔴 modal DESMONTADO #${mntNo} (se pierde lo tecleado)`, 'color:#ef4444;font-weight:bold');
  }, [mntNo]);

  // Si el usuario carga (o cambia) después de abrir el modal y el campo sigue vacío,
  // precarga el nombre completo sin pisar lo que el usuario ya haya tecleado.
  useEffect(() => {
    if (nombreCompletoUsuario) setSolicitanteCi((prev) => prev || nombreCompletoUsuario);
  }, [nombreCompletoUsuario]);

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
      // [DEBUG TEMPORAL] Qué valores llegan REALMENTE al guardar.
      console.log('%c[OP-DEBUG] 📤 GUARDANDO con estos valores:', 'color:#f59e0b;font-weight:bold', {
        unidad_solicitante: solicitanteNombre,
        solicitante_persona: solicitanteCi,
        nota: notaOp,
        finalidades_items: items.map((i) => ({ sku: i.sku, finalidad: i.finalidad })),
      });
      // La unidad solicitante tipeada se guarda en el catálogo (botón Categorías).
      await ensureUnidadSolicitante(solicitanteNombre, email);
      const saved = await crearOrden({
        // proveedor_id se asigna luego por el admin durante el flujo de sourcing.
        proveedor_id: null,
        items,
        notas: notaOp.trim() || null,
        motivo: null,
        finalidad: null,
        clasificacion: [],
        solicitante_email: email,
        solicitante: solicitanteNombre.trim() || null,
        ci_solicitante: solicitanteCi.trim() || null,
      });
      notify(`Nueva orden de pedido ${saved.codigo} enviada para aprobación`, 'success', { link: '#/app/pedidos', destino: 'admin' });
      onCreated();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al crear', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Nueva orden de pedido"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Guardando…' : 'Crear solicitud'}
          </button>
        </>
      }
    >
      {/* [DEBUG TEMPORAL] Caja visible: muestra montaje y valores en vivo. */}
      <div style={{ border: '2px dashed #f59e0b', borderRadius: 8, padding: '.5rem .65rem', marginBottom: '.7rem', fontSize: '.72rem', lineHeight: 1.5, color: 'var(--text,#fff)', background: 'rgba(245,158,11,.08)' }}>
        <strong style={{ color: '#f59e0b' }}>🐞 DEBUG (temporal)</strong> · montaje #{mntNo} <span style={{ opacity: .7 }}>(si este número sube solo mientras llenás, el modal se está remontando)</span>
        <div>Solicitante (persona): <b>«{solicitanteCi}»</b></div>
        <div>Unidad: <b>«{solicitanteNombre}»</b> · Nota: <b>«{notaOp}»</b></div>
        <div>Finalidades ítems: <b>{items.length ? items.map((i) => `${i.sku}:«${i.finalidad ?? ''}»`).join('  ') : '(sin ítems)'}</b></div>
      </div>
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
        <input
          className="input"
          value={solicitanteCi || ''}
          onChange={(e) => setSolicitanteCi(e.target.value)}
          placeholder="Nombre del solicitante"
        />
      </div>

      <div className="form-row">
        <label>Productos solicitados</label>
        <div className="muted" style={{ fontSize: '.74rem', marginBottom: '.3rem' }}>
          Marcá los artículos a comprar e indicá la finalidad de cada uno. Los desmarcados quedan en la solicitud pero no se cotizan.
        </div>
        <div className="line-picker head" style={{ gridTemplateColumns: '34px 2fr 130px 40px' }}>
          <div title="Comprar">✓</div>
          <div>Producto</div>
          <div>Cantidad</div>
          <div></div>
        </div>
        <div>
          {items.map((it, idx) => {
            const comprar = it.comprar !== false;
            return (
            <div key={`${it.sku}-${idx}`} style={{ opacity: comprar ? 1 : 0.5, marginBottom: '.4rem' }}>
            <div className="line-picker" style={{ gridTemplateColumns: '34px 2fr 130px 40px', marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={comprar}
                title={comprar ? 'Se comprará' : 'No se comprará'}
                onChange={(e) => updateItem(idx, { comprar: e.target.checked })}
                style={{ alignSelf: 'center' }}
              />
              <div>
                <div>{it.nombre}</div>
                <div className="muted mono" style={{ fontSize: '.72rem' }}>{it.sku}</div>
              </div>
              {/* Cantidad + unidad de medida del producto (KG, L, und…). */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                <input
                  className="input mono"
                  type="number"
                  min={0}
                  step="any"
                  style={{ flex: 1, minWidth: 0 }}
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
                {it.unidad && <span className="muted mono" style={{ fontSize: '.78rem', whiteSpace: 'nowrap' }}>{it.unidad}</span>}
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
                value={it.finalidad ?? ''}
                onChange={(e) => updateItem(idx, { finalidad: e.target.value })}
              />
            )}
            </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginTop: '.5rem' }}>
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
                <input className="input" placeholder="Categoría" value={nuevoCategoria} onChange={(e) => setNuevoCategoria(e.target.value)} />
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

      <div className="form-row">
        <label>Nota <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
        <textarea
          className="textarea"
          placeholder="Cualquier observación o aclaratoria sobre la solicitud (opcional)…"
          value={notaOp}
          onChange={(e) => setNotaOp(e.target.value)}
        />
      </div>

      <p className="muted" style={{ fontSize: '.78rem', marginTop: '.75rem' }}>
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
];

function CatalogoPedidosModal({ actor, onClose }: { actor: string; onClose: () => void }) {
  const [tab, setTab] = useState<ScopeCatalogoPedido>('unidad_solicitante');
  const [items, setItems] = useState<CatalogoPedido[]>([]);
  const [filtro, setFiltro] = useState('');
  const [nombre, setNombre] = useState('');
  const [edit, setEdit] = useState<{ id: string; nombre: string } | null>(null);
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
  onClose,
  onConfirm,
}: MotivoModalProps) {
  const [motivo, setMotivo] = useState('');
  const [submitting, setSubmitting] = useState(false);
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
            onClick={async () => {
              setSubmitting(true);
              try {
                await onConfirm(motivo.trim());
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {confirmText}
          </button>
        </>
      }
    >
      {intro && <p className="muted">{intro}</p>}
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
      <p className="muted">{nombre}</p>
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

          <h4 style={{ marginTop: '1.25rem' }}>Detalle</h4>
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
        </>
      )}
    </Modal>
  );
}
