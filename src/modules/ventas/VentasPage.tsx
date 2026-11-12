/* ============================================================
   MGG · (traído de Golden Touch 11-11-2026) · Ventas · Pantalla principal (cuatro pestañas)

   Ventas · Permutas · Por cobrar · Reportes.

   El tablero agrupa por ESTADO porque el estado es lo que manda qué se puede
   hacer con el documento, y en este módulo cada transición mueve algo real:

     · borrador      → no movió nada. Se edita, se envía a autorizar o se borra.
     · por_autorizar → espera a LEYDIS RENGEL o JESUS LOZADA. Se edita o se cancela.
     · autorizada    → ya la aprobaron. Se confirma (o, si se edita, vuelve a
                       borrador y hay que pedir otra autorización).
     · confirmada → YA MOVIÓ Dinero (caja o cuenta por cobrar). Falta entregar.
     · entregada  → YA MOVIÓ MATERIAL (kardex). El documento está cumplido.
     · anulada    → se deshizo. Queda con su motivo, no se borra nunca.

   TRES COSAS QUE NO SE TOCAN
   ──────────────────────────
   1. La GANANCIA se muestra aquí (es un tablero interno) y NUNCA en el
      comprobante del cliente. Los PDF ya la excluyen: lo único que hay que
      cuidar desde aquí es no pasarles datos de más.

   2. ANULAR una venta confirmada o entregada es solo del administrador: ya
      movió dinero o material y devolver eso no es un botón más de la fila. Una
      venta por autorizar o autorizada todavía no movió nada: la puede CANCELAR
      (con motivo) quien tiene escritura en Ventas.

   3. El cobro de una cuenta por cobrar NO se escribe aquí. Se llama a
      `registrarCobro` de Tesorería, que es el único camino por el que la
      dinero entra a una caja. Dos caminos = dos verdades sobre el mismo saldo.

   Los números de los reportes en pantalla salen de los MISMOS agrupadores
   puros que usan los PDF (`agruparGananciaPor*`, `filasCuentasPorCobrar`): si
   la pantalla y el PDF no coinciden, no hay forma de saber cuál miente.
   ============================================================ */
import { Quien } from '@/shared/ui/Quien';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog, Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { date, dateTime, montoMoneda, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { listCajas, listCajasActivas } from '@/modules/salidas/cajas.repository';
import {
  listCuentasPorCobrar, registrarCobro,
  type CuentaPorCobrar,
} from '@/modules/tesoreria/cuentasPorCobrar.repository';
import type { Caja, CuentaCaja } from '@/shared/lib/types';
import { round2 } from './ventasCalculos';
import {
  anularVenta, borrarBorrador, confirmarVenta, entregarVenta, enviarVentaAAutorizar, getVenta,
  listMovimientosCajaDeVenta, listRenglonesDeVentas, listVentas, resolverAutorizacionVenta,
  DOCUMENTO_LABEL, ESTADOS_EDITABLES,
  type EstadoVenta, type EventoVenta, type MovimientoCajaDeVenta, type Venta, type VentaCompleta,
} from './ventas.repository';
import { AUTORIZADORES_VENTAS_TEXTO, puedeAutorizarVentas } from './ventasAutorizadores';
import { useAutorizados } from '@/modules/usuarios/autorizados.repository';
import { TableroVentas } from './TableroVentas';
import { VentaForm } from './VentaForm';
import { PermutaForm } from './PermutaForm';
import { descargarComprobanteVentaPdf } from './comprobanteVentaPdf';
import { descargarComprobantePermutaPdf } from './comprobantePermutaPdf';
import {
  agruparGananciaPorCategoria, agruparGananciaPorCliente, agruparGananciaPorProducto,
  descargarCuentasPorCobrarPdf, descargarGananciaPorClientePdf,
  descargarGananciaPorProductoPdf, descargarVentasDelPeriodoPdf,
  filasCuentasPorCobrar,
  type FilaCuentaPorCobrar, type FilaGananciaCategoria,
  type FilaGananciaCliente, type FilaGananciaProducto,
} from './ventasReportes';

/* ─────────────────────────── Constantes de pantalla ─────────────────────────── */

type Vista = 'ventas' | 'permutas' | 'cobrar' | 'reportes';

/** Orden del tablero: el trabajo pendiente primero, lo cerrado al final. */
const COLUMNAS: { estado: EstadoVenta; label: string; ayuda: string }[] = [
  { estado: 'por_autorizar', label: 'Por autorizar', ayuda: `Esperan a ${AUTORIZADORES_VENTAS_TEXTO}. No movieron nada.` },
  { estado: 'autorizada', label: 'Autorizadas', ayuda: 'Aprobadas. Falta confirmar: ahí se mueve el dinero.' },
  { estado: 'borrador', label: 'Borradores', ayuda: 'Todavía no se enviaron a autorizar.' },
  { estado: 'confirmada', label: 'Confirmadas', ayuda: 'Ya se cobró (o quedó a crédito). Falta entregar el material.' },
  { estado: 'entregada', label: 'Entregadas', ayuda: 'Material entregado. El documento está cumplido.' },
  { estado: 'anulada', label: 'Anuladas', ayuda: 'Se deshicieron. Quedan con su motivo.' },
];

const ESTADO_BADGE: Record<EstadoVenta, { label: string; clase: string }> = {
  borrador: { label: 'Borrador', clase: 'badge' },
  por_autorizar: { label: 'Por autorizar', clase: 'badge warning' },
  autorizada: { label: 'Autorizada', clase: 'badge info' },
  confirmada: { label: 'Confirmada', clase: 'badge info' },
  entregada: { label: 'Entregada', clase: 'badge success' },
  anulada: { label: 'Anulada', clase: 'badge danger' },
};

function EstadoBadge({ estado }: { estado: EstadoVenta }) {
  const b = ESTADO_BADGE[estado];
  return <span className={b?.clase ?? 'badge'}>{b?.label ?? estado}</span>;
}

function DocumentoBadge({ venta }: { venta: Venta }) {
  const factura = venta.documento === 'factura';
  return (
    <span className={factura ? 'badge info' : 'badge'} title={factura && venta.numero_factura ? `Factura Nº ${venta.numero_factura}` : undefined}>
      {factura ? '🧾 Factura' : '📋 Nota de entrega'}
    </span>
  );
}

/** Todavía no movió dinero ni material: se cancela sin reversar nada. */
const SIN_MOVIMIENTO: EstadoVenta[] = ['por_autorizar', 'autorizada'];

/** Texto de cada evento del historial, en el idioma de quien lo lee. */
const EVENTO_LABEL: Record<string, { icono: string; texto: string }> = {
  creada: { icono: '🆕', texto: 'Creada' },
  editada: { icono: '✏️', texto: 'Editada' },
  enviada_a_autorizar: { icono: '📤', texto: 'Enviada a autorizar · despacho pedido' },
  autorizada: { icono: '✅', texto: 'Autorizada · despacho aprobado' },
  rechazada: { icono: '✖', texto: 'Rechazada' },
  devuelta_a_borrador: { icono: '↩', texto: 'Vuelve a borrador' },
  confirmada: { icono: '💵', texto: 'Confirmada (se movió el dinero)' },
  entregada: { icono: '📦', texto: 'Entregada (salió el material)' },
  anulada: { icono: '⊘', texto: 'Anulada / cancelada' },
};

/** El texto que hace visible el signo de la ganancia sin leer el número. */
function colorGanancia(n: number): string | undefined {
  if (n > 0) return 'var(--success)';
  if (n < 0) return 'var(--danger)';
  return undefined;
}

/* ─────────────────────────── Página ─────────────────────────── */

type ModalKind =
  | { kind: 'none' }
  | { kind: 'nueva'; tipo: 'venta' | 'permuta' }
  | { kind: 'editar'; datos: VentaCompleta }
  | { kind: 'detalle'; datos: VentaCompleta }
  | { kind: 'enviar'; venta: Venta }
  | { kind: 'autorizar'; venta: Venta }
  | { kind: 'rechazar'; venta: Venta }
  | { kind: 'confirmar'; venta: Venta }
  | { kind: 'entregar'; venta: Venta }
  | { kind: 'anular'; venta: Venta }
  | { kind: 'borrar'; venta: Venta };

export function VentasPage() {
  const { user } = useSession();
  const { can, isAdmin, appUser } = usePermissions();
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;

  // Escribir el módulo: admin o quien tenga `escritura` sobre Ventas.
  const puedeEscribir = isAdmin || can('ventas', 'escritura');
  const fullVentas = isAdmin || can('ventas', 'full');
  // Anular lo que ya movió dinero o material: solo el administrador. Cancelar lo
  // que todavía no movió nada (por autorizar / autorizada): quien escribe Ventas.
  const puedeAnular = useCallback(
    (v: Venta) => v.estado !== 'anulada' && v.estado !== 'borrador'
      && (fullVentas || (puedeEscribir && SIN_MOVIMIENTO.includes(v.estado))),
    [fullVentas, puedeEscribir],
  );
  // 10/11/2026: aprueban despachos (y autorizan permutas) los administradores y la
  // lista «Usuarios autorizados › Aprobar despachos de ventas». La base lo vuelve a comprobar.
  const autorizados = useAutorizados();
  const puedeAutorizar = puedeAutorizarVentas(user?.email, isAdmin, autorizados);

  const [vista, setVista] = useState<Vista>('ventas');
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [cajasActivas, setCajasActivas] = useState<Caja[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>({ kind: 'none' });
  const [trabajando, setTrabajando] = useState(false);

  const [texto, setTexto] = useState('');
  const [fEstado, setFEstado] = useState<EstadoVenta | ''>('');

  /* ── Carga ── */
  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [vs, cs, ca] = await Promise.all([
        listVentas(),
        listCajas().catch(() => [] as Caja[]),
        listCajasActivas().catch(() => [] as Caja[]),
      ]);
      setVentas(vs);
      setCajas(cs);
      setCajasActivas(ca);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las ventas.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Realtime multiusuario sobre las tres tablas del módulo. El hook central ya
  // difiere el refresh mientras alguien teclea, así que un cambio de otro
  // usuario no le borra lo escrito a nadie a mitad de un formulario.
  useRealtime(['ventas', 'ventas_renglones', 'ventas_recibidos'], () => { void refresh(); });

  /**
   * Nombre de cada caja por id. Las patas de pago guardan el uuid; sin este
   * mapa el comprobante imprime el uuid en vez de «Caja Bs». Se arma con TODAS
   * las cajas (incluidas las deshabilitadas): una venta vieja puede haberse
   * cobrado en una caja que hoy ya no se usa.
   */
  const nombresDeCaja = useMemo<Record<string, string>>(
    () => Object.fromEntries(cajas.map((c) => [c.id, c.nombre])),
    [cajas],
  );

  /* ── Filtro del tablero ── */
  const tipoVista = vista === 'permutas' ? 'permuta' : 'venta';
  const filtradas = useMemo(() => {
    const q = texto.trim().toLowerCase();
    return ventas.filter((v) => {
      if (v.tipo !== tipoVista) return false;
      if (fEstado && v.estado !== fEstado) return false;
      if (!q) return true;
      return `${v.codigo} ${v.cliente_nombre ?? ''} ${v.nota ?? ''}`.toLowerCase().includes(q);
    });
  }, [ventas, tipoVista, fEstado, texto]);

  const porEstado = useMemo(() => {
    const mapa: Record<EstadoVenta, Venta[]> = {
      borrador: [], por_autorizar: [], autorizada: [], confirmada: [], entregada: [], anulada: [],
    };
    for (const v of filtradas) mapa[v.estado]?.push(v);
    return mapa;
  }, [filtradas]);

  /* ── Acciones ── */

  const abrirDetalle = useCallback(async (v: Venta) => {
    try {
      const datos = await getVenta(v.id);
      if (!datos) { toast('Esa venta ya no existe.', 'error'); await refresh(); return; }
      setModal({ kind: 'detalle', datos });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir la venta.', 'error');
    }
  }, [refresh]);

  /** Editar SIEMPRE con el documento completo: `PermutaForm` necesita `recibidos`. */
  const abrirEditar = useCallback(async (v: Venta) => {
    try {
      const datos = await getVenta(v.id);
      if (!datos) { toast('Esa venta ya no existe.', 'error'); await refresh(); return; }
      setModal({ kind: 'editar', datos });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir la venta para editarla.', 'error');
    }
  }, [refresh]);

  /** El comprobante necesita el documento completo y el mapa de cajas. */
  const abrirComprobante = useCallback(async (v: Venta) => {
    try {
      const datos = await getVenta(v.id);
      if (!datos) { toast('Esa venta ya no existe.', 'error'); return; }
      const opciones = { cajas: nombresDeCaja };
      if (datos.venta.tipo === 'permuta') await descargarComprobantePermutaPdf(datos, opciones);
      else await descargarComprobanteVentaPdf(datos, opciones);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el comprobante.', 'error');
    }
  }, [nombresDeCaja]);

  async function ejecutar(accion: () => Promise<string>) {
    setTrabajando(true);
    try {
      const mensaje = await accion();
      setModal({ kind: 'none' });
      notify(mensaje, 'success', { link: '#/app/ventas' });
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo completar la operación.', 'error');
    } finally {
      setTrabajando(false);
    }
  }

  const cerrarForm = useCallback(() => setModal({ kind: 'none' }), []);
  const trasGuardar = useCallback(async (guardada: VentaCompleta) => {
    setModal({ kind: 'none' });
    await refresh();
    // Una permuta recién guardada se sigue trabajando en su detalle. Una venta
    // vuelve al tablero: su tarjeta ya está en la columna que le toca.
    if (guardada.venta.tipo === 'permuta') setModal({ kind: 'detalle', datos: guardada });
  }, [refresh]);

  /* ─────────────────────────── Render ─────────────────────────── */

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>🧾 Ventas</h1>
          <p className="muted hint" style={{ margin: '.25rem 0 0' }}>
            {vista === 'permutas'
              ? <>Al <strong>confirmar</strong> se mueve el dinero; al <strong>entregar</strong>, el material.</>
              : <>Cotización → despacho por aprobar → despachada → facturada → cobrada.</>}
          </p>
        </div>
        <div className="view-toggle" role="tablist" aria-label="Vista de ventas">
          <button className={vista === 'ventas' ? 'active' : ''} onClick={() => setVista('ventas')}>🧾 Ventas</button>
          <button className={vista === 'permutas' ? 'active' : ''} onClick={() => setVista('permutas')}>🔁 Permutas</button>
          <button className={vista === 'cobrar' ? 'active' : ''} onClick={() => setVista('cobrar')}>💰 Por cobrar</button>
          <button className={vista === 'reportes' ? 'active' : ''} onClick={() => setVista('reportes')}>📊 Reportes</button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : vista === 'cobrar' ? (
        <PorCobrarPanel cajas={cajasActivas} actor={actor} actorName={actorName} puedeEscribir={puedeEscribir} />
      ) : vista === 'reportes' ? (
        <ReportesPanel ventas={ventas} />
      ) : vista === 'ventas' ? (
        <TableroVentas
          ventas={ventas.filter((v) => v.tipo === 'venta')}
          actor={actor}
          actorName={actorName}
          puedeEscribir={puedeEscribir}
          puedeAprobar={puedeAutorizar}
          puedeAnular={puedeAnular}
          cajas={cajasActivas}
          onNueva={() => setModal({ kind: 'nueva', tipo: 'venta' })}
          onEditar={(v) => void abrirEditar(v)}
          onBorrar={(v) => setModal({ kind: 'borrar', venta: v })}
          onAnular={(v) => setModal({ kind: 'anular', venta: v })}
          onComprobante={(v) => void abrirComprobante(v)}
          onFicha={(v) => void abrirDetalle(v)}
          onCambio={refresh}
        />
      ) : (
        <>
          <div className="filterbar">
            <input
              className="input search"
              placeholder={`🔍 Buscar por código, cliente o nota…`}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
            <select className="select" value={fEstado} onChange={(e) => setFEstado(e.target.value as EstadoVenta | '')}>
              <option value="">Todos los estados</option>
              {COLUMNAS.map((c) => <option key={c.estado} value={c.estado}>{c.label}</option>)}
            </select>
            {puedeEscribir && (
              <button className="btn btn-primary" onClick={() => setModal({ kind: 'nueva', tipo: tipoVista })}>
                ＋ {tipoVista === 'permuta' ? 'Nueva permuta' : 'Nueva venta'}
              </button>
            )}
          </div>

          {!filtradas.length ? (
            <EmptyState message={
              texto || fEstado
                ? 'Ningún documento coincide con el filtro.'
                : tipoVista === 'permuta'
                  ? 'Todavía no hay permutas. Una permuta es una venta que se paga (en parte o del todo) con material.'
                  : 'Todavía no hay ventas cargadas.'
            } />
          ) : (
            COLUMNAS.map((col) => {
              const filas = porEstado[col.estado];
              if (!filas.length) return null;
              return (
                <TableroEstado
                  key={col.estado}
                  titulo={col.label}
                  ayuda={col.ayuda}
                  ventas={filas}
                  puedeEscribir={puedeEscribir}
                  puedeAnular={puedeAnular}
                  puedeAutorizar={puedeAutorizar}
                  onDetalle={(v) => void abrirDetalle(v)}
                  onEditar={(v) => void abrirEditar(v)}
                  onComprobante={(v) => void abrirComprobante(v)}
                  onEnviar={(v) => setModal({ kind: 'enviar', venta: v })}
                  onAutorizar={(v) => setModal({ kind: 'autorizar', venta: v })}
                  onRechazar={(v) => setModal({ kind: 'rechazar', venta: v })}
                  onConfirmar={(v) => setModal({ kind: 'confirmar', venta: v })}
                  onEntregar={(v) => setModal({ kind: 'entregar', venta: v })}
                  onAnular={(v) => setModal({ kind: 'anular', venta: v })}
                  onBorrar={(v) => setModal({ kind: 'borrar', venta: v })}
                />
              );
            })
          )}
        </>
      )}

      {/* ── Alta / edición ──
          VentaForm y PermutaForm YA SON ventanas (traen su propio <Modal> con pie de
          botones). Envolverlas en otro <Modal> dejaba DOS ventanas a pantalla completa:
          la de afuera se dibujaba encima y tapaba el formulario («Nueva venta» en blanco). */}
      {modal.kind === 'nueva' && (
        modal.tipo === 'permuta'
          ? <PermutaForm onSaved={(v) => void trasGuardar(v)} onCancel={cerrarForm} />
          : <VentaForm onSaved={(v) => void trasGuardar(v)} onCancel={cerrarForm} />
      )}

      {modal.kind === 'editar' && (
        modal.datos.venta.tipo === 'permuta'
          ? <PermutaForm venta={modal.datos} onSaved={(v) => void trasGuardar(v)} onCancel={cerrarForm} />
          : <VentaForm venta={modal.datos} onSaved={(v) => void trasGuardar(v)} onCancel={cerrarForm} />
      )}

      {/* ── Detalle ── */}
      {modal.kind === 'detalle' && (
        <DetalleVentaModal
          datos={modal.datos}
          nombresDeCaja={nombresDeCaja}
          puedeEscribir={puedeEscribir}
          puedeAnular={puedeAnular}
          puedeAutorizar={puedeAutorizar}
          onClose={cerrarForm}
          onEditar={(v) => void abrirEditar(v)}
          onComprobante={(v) => void abrirComprobante(v)}
          onEnviar={(v) => setModal({ kind: 'enviar', venta: v })}
          onAutorizar={(v) => setModal({ kind: 'autorizar', venta: v })}
          onRechazar={(v) => setModal({ kind: 'rechazar', venta: v })}
          onConfirmar={(v) => setModal({ kind: 'confirmar', venta: v })}
          onEntregar={(v) => setModal({ kind: 'entregar', venta: v })}
          onAnular={(v) => setModal({ kind: 'anular', venta: v })}
        />
      )}

      {/* ── Transiciones ── */}
      {modal.kind === 'enviar' && (
        <ConfirmDialog
          title={`Enviar ${modal.venta.codigo} a autorizar`}
          message={`${DOCUMENTO_LABEL[modal.venta.documento]} por ${montoMoneda(modal.venta.total, modal.venta.moneda)}${modal.venta.cliente_nombre ? ` a ${modal.venta.cliente_nombre}` : ''}. Le llega un aviso a ${AUTORIZADORES_VENTAS_TEXTO}. No se mueve dinero ni material hasta que la autoricen y se confirme.`}
          confirmText={trabajando ? 'Enviando…' : 'Sí, enviar'}
          onCancel={cerrarForm}
          onConfirm={() => void ejecutar(async () => {
            const v = await enviarVentaAAutorizar(modal.venta.id, actor, actorName ?? actor);
            return `${v.codigo} enviada a autorizar`;
          })}
        />
      )}

      {modal.kind === 'autorizar' && (
        <ConfirmDialog
          title={`Autorizar ${modal.venta.codigo}`}
          message={`${DOCUMENTO_LABEL[modal.venta.documento]} por ${montoMoneda(modal.venta.total, modal.venta.moneda)}${modal.venta.cliente_nombre ? ` a ${modal.venta.cliente_nombre}` : ''}${modal.venta.condicion === 'credito' ? ' · A CRÉDITO' : ''}. Con tu autorización ya se puede confirmar; tu nombre queda en el historial.`}
          confirmText={trabajando ? 'Autorizando…' : '✅ Sí, autorizar'}
          onCancel={cerrarForm}
          onConfirm={() => void ejecutar(async () => {
            const v = await resolverAutorizacionVenta(modal.venta.id, true, actor, actorName ?? actor);
            return `${v.codigo} autorizada`;
          })}
        />
      )}

      {modal.kind === 'rechazar' && (
        <MotivoModal
          titulo={`✖ Rechazar ${modal.venta.codigo}`}
          explicacion="La venta vuelve a borrador para que la corrijan. El motivo le llega a quien la cargó y queda en el historial."
          etiqueta="Motivo del rechazo"
          boton="Rechazar la venta"
          trabajando={trabajando}
          onCancel={cerrarForm}
          onAceptar={(motivo) => void ejecutar(async () => {
            const v = await resolverAutorizacionVenta(modal.venta.id, false, actor, actorName ?? actor, motivo);
            return `${v.codigo} rechazada: vuelve a borrador`;
          })}
        />
      )}

      {modal.kind === 'confirmar' && (
        <ConfirmDialog
          title={`Confirmar ${modal.venta.codigo} (autorizada${modal.venta.autorizada_por ? ` por ${modal.venta.autorizada_por}` : ''})`}
          message={
            modal.venta.condicion === 'credito'
              ? `Se le va a cargar ${montoMoneda(modal.venta.diferencia, modal.venta.moneda)} a la cuenta corriente de ${modal.venta.cliente_nombre || 'el cliente'}. El material NO sale todavía: eso pasa al entregar.`
              : `Va a ENTRAR ${montoMoneda(modal.venta.diferencia, modal.venta.moneda)} a las cajas indicadas en el documento. El material NO sale todavía: eso pasa al entregar.`
          }
          confirmText={trabajando ? 'Confirmando…' : 'Sí, confirmar'}
          onCancel={cerrarForm}
          onConfirm={() => void ejecutar(async () => {
            const v = await confirmarVenta(modal.venta.id, actor, actorName ?? actor);
            return `${v.codigo} confirmada · ${montoMoneda(v.diferencia, v.moneda)}`;
          })}
        />
      )}

      {modal.kind === 'entregar' && (
        <ConfirmDialog
          title={`Entregar ${modal.venta.codigo}`}
          message="Va a SALIR del inventario todo el material del documento (y, si es permuta, va a entrar el material recibido). Si falta stock, no se entrega nada."
          confirmText={trabajando ? 'Entregando…' : 'Sí, entregar'}
          onCancel={cerrarForm}
          onConfirm={() => void ejecutar(async () => {
            const v = await entregarVenta(modal.venta.id, actor, actorName ?? actor);
            return `${v.codigo} entregada · material descargado del inventario`;
          })}
        />
      )}

      {modal.kind === 'borrar' && (
        <ConfirmDialog
          title={`Borrar el borrador ${modal.venta.codigo}`}
          message="Un borrador no movió dinero ni material, así que se borra de verdad. Una venta ya enviada a autorizar se CANCELA (queda con su motivo) y una confirmada o entregada se ANULA."
          confirmText={trabajando ? 'Borrando…' : 'Sí, borrar'}
          danger
          onCancel={cerrarForm}
          onConfirm={() => void ejecutar(async () => {
            await borrarBorrador(modal.venta.id);
            return `Borrador ${modal.venta.codigo} eliminado`;
          })}
        />
      )}

      {modal.kind === 'anular' && (
        <AnularModal
          venta={modal.venta}
          trabajando={trabajando}
          onCancel={cerrarForm}
          onAnular={(motivo) => void ejecutar(async () => {
            const cancelar = SIN_MOVIMIENTO.includes(modal.venta.estado);
            const v = await anularVenta(modal.venta.id, actor, actorName ?? actor, motivo);
            return cancelar ? `${v.codigo} cancelada` : `${v.codigo} anulada`;
          })}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Tablero por estado ─────────────────────────── */

interface TableroProps {
  titulo: string;
  ayuda: string;
  ventas: Venta[];
  puedeEscribir: boolean;
  puedeAnular: (v: Venta) => boolean;
  puedeAutorizar: boolean;
  onDetalle: (v: Venta) => void;
  onEditar: (v: Venta) => void;
  onComprobante: (v: Venta) => void;
  onEnviar: (v: Venta) => void;
  onAutorizar: (v: Venta) => void;
  onRechazar: (v: Venta) => void;
  onConfirmar: (v: Venta) => void;
  onEntregar: (v: Venta) => void;
  onAnular: (v: Venta) => void;
  onBorrar: (v: Venta) => void;
}

function TableroEstado({
  titulo, ayuda, ventas, puedeEscribir, puedeAnular, puedeAutorizar,
  onDetalle, onEditar, onComprobante, onEnviar, onAutorizar, onRechazar, onConfirmar, onEntregar, onAnular, onBorrar,
}: TableroProps) {
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div className="card-title" style={{ display: 'flex', alignItems: 'baseline', gap: '.5rem', flexWrap: 'wrap' }}>
        <span>{titulo}</span>
        <span className="badge">{ventas.length}</span>
        <span className="muted" style={{ fontSize: '.78rem', fontWeight: 400 }}>{ayuda}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Cliente</th>
              <th>Documento</th>
              <th>Fecha</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'right' }}>Ganancia</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id}>
                <td>
                  <button className="btn btn-sm btn-ghost mono" title="Ver el detalle" onClick={() => onDetalle(v)}>
                    {v.codigo}
                  </button>
                  {v.condicion === 'credito' && <span className="badge warning" style={{ marginLeft: '.3rem' }}>Crédito</span>}
                </td>
                <td>{v.cliente_nombre || <span className="muted">—</span>}</td>
                <td><DocumentoBadge venta={v} /></td>
                <td className="muted">{date(v.created_at)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{montoMoneda(v.total, v.moneda)}</td>
                <td className="mono" style={{ textAlign: 'right', color: colorGanancia(v.ganancia_total) }}>
                  {montoMoneda(v.ganancia_total, v.moneda)}
                </td>
                <td><EstadoBadge estado={v.estado} /></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {ESTADOS_EDITABLES.includes(v.estado) && puedeEscribir && (
                    <button className="btn btn-sm btn-ghost" title={v.estado === 'borrador' ? 'Editar' : 'Editar: vuelve a borrador y hay que pedir otra autorización'} onClick={() => onEditar(v)}>✏️ Editar</button>
                  )}
                  {v.estado === 'borrador' && puedeEscribir && (
                    <>
                      <button className="btn btn-sm btn-primary" title={`Enviar a ${AUTORIZADORES_VENTAS_TEXTO}`} onClick={() => onEnviar(v)}>📤 Enviar a autorizar</button>
                      <button className="btn btn-sm btn-danger" title="Borrar el borrador" onClick={() => onBorrar(v)}>🗑</button>
                    </>
                  )}
                  {v.estado === 'por_autorizar' && puedeAutorizar && (
                    <>
                      <button className="btn btn-sm btn-primary" title="Autorizar la venta" onClick={() => onAutorizar(v)}>✅ Autorizar</button>
                      <button className="btn btn-sm btn-danger" title="Rechazar: vuelve a borrador con el motivo" onClick={() => onRechazar(v)}>✖ Rechazar</button>
                    </>
                  )}
                  {v.estado === 'autorizada' && puedeEscribir && (
                    <button className="btn btn-sm btn-primary" title="Confirmar: mueve el dinero" onClick={() => onConfirmar(v)}>✔ Confirmar</button>
                  )}
                  {v.estado === 'confirmada' && puedeEscribir && (
                    <button className="btn btn-sm btn-primary" title="Entregar: mueve el material" onClick={() => onEntregar(v)}>📦 Entregar</button>
                  )}
                  {v.estado !== 'borrador' && (
                    <button className="btn btn-sm btn-ghost" title="Comprobante en PDF (vista previa)" onClick={() => onComprobante(v)}>📄</button>
                  )}
                  {puedeAnular(v) && (
                    SIN_MOVIMIENTO.includes(v.estado)
                      ? <button className="btn btn-sm btn-danger" title="Cancelar: todavía no movió dinero ni material" onClick={() => onAnular(v)}>⊘ Cancelar</button>
                      : <button className="btn btn-sm btn-danger" title="Anular (solo administradores)" onClick={() => onAnular(v)}>⊘ Anular</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Detalle ─────────────────────────── */

interface DetalleProps {
  datos: VentaCompleta;
  nombresDeCaja: Record<string, string>;
  puedeEscribir: boolean;
  puedeAnular: (v: Venta) => boolean;
  puedeAutorizar: boolean;
  onClose: () => void;
  onEditar: (v: Venta) => void;
  onComprobante: (v: Venta) => void;
  onEnviar: (v: Venta) => void;
  onAutorizar: (v: Venta) => void;
  onRechazar: (v: Venta) => void;
  onConfirmar: (v: Venta) => void;
  onEntregar: (v: Venta) => void;
  onAnular: (v: Venta) => void;
}

function DetalleVentaModal({
  datos, nombresDeCaja, puedeEscribir, puedeAnular, puedeAutorizar,
  onClose, onEditar, onComprobante, onEnviar, onAutorizar, onRechazar, onConfirmar, onEntregar, onAnular,
}: DetalleProps) {
  const { venta, renglones, recibidos } = datos;
  const [movs, setMovs] = useState<MovimientoCajaDeVenta[]>([]);
  const [cargandoMovs, setCargandoMovs] = useState(true);

  // A qué cajas fue el dinero de esta venta: el otro lado del vínculo con
  // Tesorería. Incluye la reversa si la venta se anuló.
  useEffect(() => {
    let vivo = true;
    setCargandoMovs(true);
    listMovimientosCajaDeVenta(venta.id)
      .then((r) => { if (vivo) setMovs(r); })
      .catch(() => { if (vivo) setMovs([]); })
      .finally(() => { if (vivo) setCargandoMovs(false); });
    return () => { vivo = false; };
  }, [venta.id]);

  const esPermuta = venta.tipo === 'permuta';

  return (
    <Modal
      title={`${esPermuta ? '🔁' : '🧾'} ${venta.codigo}`}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          {venta.estado !== 'borrador' && (
            <button className="btn btn-ghost" onClick={() => onComprobante(venta)}>📄 Comprobante</button>
          )}
          {ESTADOS_EDITABLES.includes(venta.estado) && puedeEscribir && (
            <button className="btn btn-ghost" onClick={() => onEditar(venta)}>✏️ Editar</button>
          )}
          {/* Las ventas se piden y se aprueban desde el tablero («¿Se despacha?»);
              aquí quedan esos botones solo para las permutas. */}
          {venta.estado === 'borrador' && puedeEscribir && esPermuta && (
            <button className="btn btn-primary" onClick={() => onEnviar(venta)}>📤 Enviar a autorizar</button>
          )}
          {venta.estado === 'por_autorizar' && puedeAutorizar && esPermuta && (
            <>
              <button className="btn btn-danger" onClick={() => onRechazar(venta)}>✖ Rechazar</button>
              <button className="btn btn-primary" onClick={() => onAutorizar(venta)}>✅ Autorizar</button>
            </>
          )}
          {venta.estado === 'autorizada' && puedeEscribir && (
            <button className="btn btn-primary" onClick={() => onConfirmar(venta)}>✔ Confirmar</button>
          )}
          {venta.estado === 'confirmada' && puedeEscribir && (
            <button className="btn btn-primary" onClick={() => onEntregar(venta)}>📦 Entregar</button>
          )}
          {puedeAnular(venta) && (
            <button className="btn btn-danger" onClick={() => onAnular(venta)}>
              {SIN_MOVIMIENTO.includes(venta.estado) ? '⊘ Cancelar' : '⊘ Anular'}
            </button>
          )}
        </>
      }
    >
      {/* ── Cabecera ── */}
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.7rem' }}>
        <EstadoBadge estado={venta.estado} />
        <DocumentoBadge venta={venta} />
        {venta.documento === 'factura' && (venta.numero_factura || venta.numero_control) && (
          <span className="mono muted" style={{ fontSize: '.8rem' }}>
            {venta.numero_factura ? `Nº ${venta.numero_factura}` : ''}{venta.numero_control ? ` · Control ${venta.numero_control}` : ''}
          </span>
        )}
        <span className={venta.condicion === 'credito' ? 'badge warning' : 'badge info'}>
          {venta.condicion === 'credito' ? 'A crédito' : 'De contado'}
        </span>
        <span className="muted">{dateTime(venta.created_at)}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.6rem', marginBottom: '.9rem' }}>
        <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
          <div className="muted" style={{ fontSize: '.7rem' }}>CLIENTE</div>
          <div style={{ fontWeight: 700 }}>{venta.cliente_nombre || '—'}</div>
          {venta.cliente_rif && <div className="mono muted" style={{ fontSize: '.78rem' }}>{venta.cliente_rif}</div>}
        </div>
        <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
          <div className="muted" style={{ fontSize: '.7rem' }}>TOTAL</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{montoMoneda(venta.total, venta.moneda)}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>
            Base {montoMoneda(round2(venta.subtotal - venta.descuento), venta.moneda)}
            {venta.iva_pct > 0 ? ` · IVA ${venta.iva_pct}% ${montoMoneda(venta.iva_monto, venta.moneda)}` : ' · sin IVA'}
            {venta.igtf_pct > 0 ? ` · IGTF ${venta.igtf_pct}% ${montoMoneda(venta.igtf_monto, venta.moneda)}` : ''}
          </div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
          <div className="muted" style={{ fontSize: '.7rem' }}>GANANCIA (INTERNA)</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: colorGanancia(venta.ganancia_total) }}>
            {montoMoneda(venta.ganancia_total, venta.moneda)}
          </div>
          <div className="muted" style={{ fontSize: '.72rem' }}>No aparece en el comprobante del cliente.</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
          <div className="muted" style={{ fontSize: '.7rem' }}>{esPermuta ? 'DIFERENCIA A COBRAR' : 'A COBRAR'}</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{montoMoneda(venta.diferencia, venta.moneda)}</div>
          {esPermuta && (
            <div className="muted" style={{ fontSize: '.72rem' }}>
              Material recibido {montoMoneda(venta.valor_recibido, venta.moneda)}
            </div>
          )}
        </div>
      </div>

      {venta.estado === 'borrador' && venta.rechazo_motivo && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.8rem' }}>
          <strong>Rechazada</strong>{venta.rechazada_por ? <> por <Quien correo={venta.rechazada_por} /></> : ''}{venta.rechazada_at ? ` el ${dateTime(venta.rechazada_at)}` : ''}.
          <div className="muted" style={{ marginTop: '.25rem' }}>Motivo: {venta.rechazo_motivo}. Corrígela y vuelve a enviarla a autorizar.</div>
        </div>
      )}
      {venta.estado === 'por_autorizar' && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.8rem' }}>
          <strong>Esperando autorización</strong> de {AUTORIZADORES_VENTAS_TEXTO}
          {venta.enviada_por ? ` · la envió ${venta.enviada_por}` : ''}{venta.enviada_at ? ` el ${dateTime(venta.enviada_at)}` : ''}.
        </div>
      )}
      {venta.autorizada_por && venta.estado !== 'borrador' && (
        <p className="muted" style={{ margin: '0 0 .8rem' }}>
          ✅ Autorizada por <strong>{venta.autorizada_por}</strong>{venta.autorizada_at ? ` el ${dateTime(venta.autorizada_at)}` : ''}.
        </p>
      )}

      {venta.estado === 'anulada' && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.8rem' }}>
          <strong>Anulada</strong> {venta.anulada_at ? `el ${dateTime(venta.anulada_at)}` : ''}
          {venta.anulada_por ? ` por ${venta.anulada_por}` : ''}.
          <div className="muted" style={{ marginTop: '.25rem' }}>Motivo: {venta.motivo_anulacion || '—'}</div>
        </div>
      )}

      {/* ── Lo que sale ── */}
      <strong style={{ fontSize: '.84rem' }}>{esPermuta ? 'Material que entrego' : 'Renglones'}</strong>
      <div className="table-wrap" style={{ marginTop: '.3rem', marginBottom: '.8rem' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead>
            <tr>
              <th>Producto</th>
              <th style={{ textAlign: 'right' }}>Cantidad</th>
              <th style={{ textAlign: 'right' }}>Precio</th>
              <th style={{ textAlign: 'right' }}>Costo</th>
              <th style={{ textAlign: 'right' }}>Subtotal</th>
              <th style={{ textAlign: 'right' }}>Ganancia</th>
            </tr>
          </thead>
          <tbody>
            {!renglones.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center' }}>Sin renglones.</td></tr>}
            {renglones.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className="mono muted">{r.producto_sku ?? '—'}</span> {r.producto_nombre ?? '—'}
                  {r.costo_unit <= 0 && (
                    <span className="badge warning" style={{ marginLeft: '.35rem' }}>sin costo: la ganancia no es real</span>
                  )}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{num(r.cantidad)} {r.unidad ?? ''}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(r.precio_unit, venta.moneda)}</td>
                <td className="mono muted" style={{ textAlign: 'right' }}>{montoMoneda(r.costo_unit, venta.moneda)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(r.subtotal, venta.moneda)}</td>
                <td className="mono" style={{ textAlign: 'right', color: colorGanancia(r.ganancia) }}>{montoMoneda(r.ganancia, venta.moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Lo que entra (permuta) ── */}
      {esPermuta && (
        <>
          <strong style={{ fontSize: '.84rem' }}>Material que recibo</strong>
          <div className="table-wrap" style={{ marginTop: '.3rem', marginBottom: '.8rem' }}>
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th style={{ textAlign: 'right' }}>Valor por unidad</th>
                  <th style={{ textAlign: 'right' }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {!recibidos.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Sin material recibido.</td></tr>}
                {recibidos.map((r) => (
                  <tr key={r.id}>
                    <td><span className="mono muted">{r.producto_sku ?? '—'}</span> {r.producto_nombre ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(r.cantidad)} {r.unidad ?? ''}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(r.valor_unit, venta.moneda)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(r.subtotal, venta.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── A qué cajas fue el dinero ── */}
      <strong style={{ fontSize: '.84rem' }}>A qué cajas fue el dinero</strong>
      <div className="table-wrap" style={{ marginTop: '.3rem' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Caja</th>
              <th>Cuenta</th>
              <th>Concepto</th>
              <th style={{ textAlign: 'right' }}>Monto</th>
            </tr>
          </thead>
          <tbody>
            {cargandoMovs && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!cargandoMovs && !movs.length && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: 'center' }}>
                  {venta.condicion === 'credito'
                    ? 'A crédito: el dinero no entró a caja todavía. Se cobra desde «Por cobrar».'
                    : 'Sin movimientos de caja: todavía no se confirmó.'}
                </td>
              </tr>
            )}
            {movs.map((m) => (
              <tr key={m.movimiento_id}>
                <td className="muted">{dateTime(m.at)}</td>
                <td>{m.caja_nombre || nombresDeCaja[m.caja_id ?? ''] || <span className="muted">—</span>}</td>
                <td className="muted">{m.cuenta || '—'}</td>
                <td>
                  {m.categoria === 'reverso_venta'
                    ? <span className="badge danger">Reverso de anulación</span>
                    : <span className="badge success">Cobro de venta</span>}
                  <div className="muted" style={{ fontSize: '.75rem' }}>{m.motivo || ''}</div>
                </td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{montoMoneda(m.monto, m.moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {venta.nota && (
        <p className="muted" style={{ marginTop: '.8rem', marginBottom: 0 }}><strong>Nota:</strong> {venta.nota}</p>
      )}

      <HistorialVenta historial={venta.historial} moneda={venta.moneda} />
    </Modal>
  );
}

/* ─────────────────────────── Trazabilidad ─────────────────────────── */

/** El rastro que escribe la base (trigger), del paso más nuevo al más viejo. */
function HistorialVenta({ historial, moneda }: { historial: EventoVenta[]; moneda: string }) {
  const eventos = [...(historial ?? [])].reverse();
  return (
    <div style={{ marginTop: '1rem' }}>
      <strong style={{ fontSize: '.84rem' }}>🕓 Trazabilidad</strong>
      {!eventos.length ? (
        <p className="muted" style={{ margin: '.3rem 0 0', fontSize: '.8rem' }}>Sin eventos registrados.</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: '.3rem' }}>
          <table className="table" style={{ fontSize: '.8rem' }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Paso</th>
                <th>Quién</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {eventos.map((e, i) => {
                const l = EVENTO_LABEL[e.evento] ?? { icono: '•', texto: e.evento };
                return (
                  <tr key={`${e.at}-${i}`}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateTime(e.at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{l.icono} {l.texto}</td>
                    <td><Quien nombre={e.actor_name} correo={e.actor} vacio="—" /></td>
                    <td className="muted">
                      {e.motivo ? <>Motivo: {e.motivo}</> : null}
                      {e.total_antes != null && e.total != null && e.total_antes !== e.total
                        ? <>{e.motivo ? ' · ' : ''}Total {montoMoneda(e.total_antes, moneda)} → {montoMoneda(e.total, moneda)}</>
                        : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Motivo (rechazo) ─────────────────────────── */

function MotivoModal({
  titulo, explicacion, etiqueta, boton, trabajando, onCancel, onAceptar,
}: {
  titulo: string; explicacion: string; etiqueta: string; boton: string;
  trabajando: boolean; onCancel: () => void; onAceptar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const listo = motivo.trim().length >= 4;
  return (
    <Modal
      title={titulo}
      compact
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel} disabled={trabajando}>Cancelar</button>
          <button className="btn btn-danger" disabled={!listo || trabajando} onClick={() => onAceptar(motivo.trim())}>
            {trabajando ? 'Guardando…' : boton}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{explicacion}</p>
      <div className="form-row">
        <label>{etiqueta} <span className="muted">(obligatorio)</span></label>
        <textarea className="input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        {!listo && motivo.length > 0 && <small className="muted">Escribe un motivo un poco más claro (al menos 4 caracteres).</small>}
      </div>
    </Modal>
  );
}

/* ─────────────────────────── Anular ─────────────────────────── */

function AnularModal({
  venta, trabajando, onCancel, onAnular,
}: { venta: Venta; trabajando: boolean; onCancel: () => void; onAnular: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('');
  const listo = motivo.trim().length >= 4;
  const cancelar = SIN_MOVIMIENTO.includes(venta.estado);
  return (
    <Modal
      title={`⊘ ${cancelar ? 'Cancelar' : 'Anular'} ${venta.codigo}`}
      compact
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel} disabled={trabajando}>Cancelar</button>
          <button className="btn btn-danger" disabled={!listo || trabajando} onClick={() => onAnular(motivo.trim())}>
            {trabajando ? (cancelar ? 'Cancelando…' : 'Anulando…') : (cancelar ? 'Cancelar la venta' : 'Anular la venta')}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        {cancelar
          ? 'Esta venta todavía no movió dinero ni material: se cancela sin reversar nada. Queda en «Anuladas» con su motivo y su historial.'
          : venta.estado === 'entregada'
            ? 'El material va a VOLVER al inventario y el dinero cobrado se va a reversar en las cajas.'
            : 'El dinero cobrado se va a reversar en las cajas.'}
        {!cancelar && venta.condicion === 'credito' && ' Si la venta quedó a crédito, se le resta a la cuenta corriente del cliente; si esa cuenta ya tiene cobros, la anulación se rechaza y primero hay que devolver ese dinero.'}
        {!cancelar && venta.tipo === 'permuta' && venta.estado === 'entregada' && ' El material que entregó el cliente sale del inventario.'}
      </p>
      <div className="form-row">
        <label>Motivo {cancelar ? 'de la cancelación' : 'de la anulación'} <span className="muted">(obligatorio)</span></label>
        <textarea
          className="input"
          rows={3}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Por qué se anula este documento…"
        />
        {!listo && motivo.length > 0 && <small className="muted">Escribe un motivo un poco más claro (al menos 4 caracteres).</small>}
      </div>
    </Modal>
  );
}

/* ─────────────────────────── Por cobrar ─────────────────────────── */

/**
 * El dinero entra por UN solo camino: `registrarCobro` de Tesorería. Aquí no se
 * escribe lógica de cobro nueva —ni el movimiento de caja, ni el saldo, ni el
 * estado de la cuenta—, solo se llama a esa función. La cuenta por cobrar es
 * CORRIENTE por cliente: acumula varias ventas, así que el saldo que se ve no
 * es el de una venta sino el del cliente entero.
 */
function PorCobrarPanel({
  cajas, actor, actorName, puedeEscribir,
}: { cajas: Caja[]; actor: string; actorName: string | null; puedeEscribir: boolean }) {
  const [cuentas, setCuentas] = useState<CuentaPorCobrar[]>([]);
  const [soloAbiertas, setSoloAbiertas] = useState(true);
  const [selId, setSelId] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorCobro, setErrorCobro] = useState<string | null>(null);

  const [cajaId, setCajaId] = useState('');
  const [cuentaCaja, setCuentaCaja] = useState<CuentaCaja>('general');
  const [montoStr, setMontoStr] = useState('');
  const [tasaStr, setTasaStr] = useState('');
  const [nota, setNota] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const cs = await listCuentasPorCobrar(soloAbiertas);
      setCuentas(cs);
      setSelId((prev) => (prev && cs.some((c) => c.id === prev)) ? prev : (cs[0]?.id ?? ''));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron cargar las cuentas por cobrar.', 'error');
    } finally { setCargando(false); }
  }, [soloAbiertas]);

  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(
    ['cuentas_por_cobrar', 'cuentas_por_cobrar_cargos', 'cuentas_por_cobrar_abonos'],
    () => { void cargar(); },
  );

  useEffect(() => { if (!cajaId && cajas.length) setCajaId(cajas[0].id); }, [cajas, cajaId]);

  const sel = cuentas.find((c) => c.id === selId) ?? null;
  // Bs entra a jurídica/personal; el resto de las monedas a general (mismo
  // criterio que usa Tesorería para no ensuciar las cuentas en Bs).
  useEffect(() => { if (sel) setCuentaCaja(sel.moneda === 'Bs' ? 'juridica' : 'general'); }, [sel]);

  const filas = useMemo<FilaCuentaPorCobrar[]>(() => filasCuentasPorCobrar(cuentas), [cuentas]);
  const saldo = sel ? round2(Number(sel.monto) - (Number(sel.abonado) || 0)) : 0;
  const esBs = sel?.moneda === 'Bs';

  async function cobrar() {
    if (!sel) return;
    setErrorCobro(null);
    const monto = Number(montoStr) || 0;
    if (monto <= 0) { setErrorCobro('Indica el monto a cobrar.'); return; }
    if (!cajaId) { setErrorCobro('Elige la caja que recibe el dinero.'); return; }
    if (!esBs && (Number(tasaStr) || 0) <= 0) { setErrorCobro(`Indica la tasa (Bs por ${sel.moneda}).`); return; }
    setGuardando(true);
    try {
      const r = await registrarCobro({
        cuenta: sel, cajaId, cuentaCaja, monto,
        tasaBs: esBs ? 1 : (Number(tasaStr) || 0),
        nota: nota.trim() || null, actor, actorName,
      });
      notify(
        r.cuenta.estado === 'saldada'
          ? `Cuenta saldada · ${sel.contraparte}`
          : `Cobro ${montoMoneda(monto, sel.moneda)} · ${sel.contraparte}`,
        'success', { link: '#/app/ventas' },
      );
      setMontoStr(''); setNota('');
      await cargar();
    } catch (e) {
      setErrorCobro(e instanceof Error ? e.message : 'No se pudo registrar el cobro.');
    } finally { setGuardando(false); }
  }

  return (
    <>
      <div className="filterbar">
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
          <input type="checkbox" checked={soloAbiertas} onChange={(e) => setSoloAbiertas(e.target.checked)} />
          Solo cuentas abiertas
        </label>
        <button
          className="btn btn-ghost"
          title="Reporte de cuentas por cobrar en PDF (vista previa)"
          onClick={() => { void descargarCuentasPorCobrarPdf({ soloAbiertas }).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error')); }}
        >📄 Reporte PDF</button>
      </div>

      <p className="muted hint" style={{ marginTop: 0 }}>
        La cuenta por cobrar es <strong>corriente por cliente</strong>: acumula todas sus ventas a crédito.
        El cobro entra a la caja por el mismo camino que usa Tesorería.
      </p>

      {cargando ? <p className="muted">Cargando…</p> : !filas.length ? (
        <EmptyState message="No hay cuentas por cobrar." icon="💰" />
      ) : (
        <>
          <div className="card">
            <div className="card-title"><span>Cuentas ({filas.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Cliente / Proveedor</th>
                    <th>Tipo</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                    <th style={{ textAlign: 'right' }}>Cobrado</th>
                    <th style={{ textAlign: 'right' }}>Saldo</th>
                    <th style={{ textAlign: 'right' }}>Antigüedad</th>
                    <th>Desde</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr
                      key={f.id}
                      onClick={() => setSelId(f.id)}
                      style={{ cursor: 'pointer', outline: f.id === selId ? '2px solid var(--primary)' : undefined }}
                    >
                      <td>{f.contraparte}</td>
                      <td className="muted">{f.tipo}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(f.monto, f.moneda)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(f.cobrado, f.moneda)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: f.saldo > 0 ? 'var(--warning)' : 'var(--success)' }}>
                        {montoMoneda(f.saldo, f.moneda)}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{f.antiguedadDias} d</td>
                      <td className="muted">{date(f.desde)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {puedeEscribir && sel && saldo > 0.01 && (
            <div className="card">
              <div className="card-title"><span>Registrar cobro de «{sel.contraparte}» (entra a caja)</span></div>
              {errorCobro && (
                <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.5rem' }}>
                  <strong>Error:</strong> {errorCobro}
                </div>
              )}
              <div className="form-row" style={{ marginBottom: '.6rem' }}>
                <label>Cuenta a cobrar</label>
                <SearchSelect
                  value={selId}
                  onChange={setSelId}
                  placeholder="🔍 Buscar cuenta…"
                  options={cuentas.map((c) => ({
                    value: c.id,
                    label: `${c.tipo === 'proveedor' ? '🏭' : '👤'} ${c.contraparte} · saldo ${montoMoneda(round2(Number(c.monto) - (Number(c.abonado) || 0)), c.moneda)}`,
                  }))}
                />
              </div>
              <div className="form-grid">
                <div className="form-row">
                  <label>Caja que recibe</label>
                  <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                    {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                {esBs ? (
                  <div className="form-row">
                    <label>Cuenta (Bs)</label>
                    <select className="select" value={cuentaCaja} onChange={(e) => setCuentaCaja(e.target.value as CuentaCaja)}>
                      <option value="juridica">Jurídica</option>
                      <option value="personal">Personal</option>
                    </select>
                  </div>
                ) : (
                  <div className="form-row">
                    <label>Tasa (Bs por {sel.moneda})</label>
                    <input className="input mono" type="number" min={0} step="any" value={tasaStr}
                      onChange={(e) => setTasaStr(e.target.value)} placeholder="0.00" />
                  </div>
                )}
                <div className="form-row">
                  <label>Monto a cobrar ({sel.moneda})</label>
                  <input className="input mono" type="number" min={0} step="any" value={montoStr}
                    onChange={(e) => setMontoStr(e.target.value)} placeholder="0.00" />
                  <small className="muted">Máx. {montoMoneda(saldo, sel.moneda)}</small>
                </div>
                <div className="form-row">
                  <label>Nota <span className="muted">(opcional)</span></label>
                  <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota del cobro" />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '.5rem' }}>
                <button className="btn btn-primary" disabled={guardando} onClick={() => void cobrar()}>
                  {guardando ? 'Registrando…' : '＋ Registrar cobro'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ─────────────────────────── Reportes ─────────────────────────── */

/**
 * Los cuatro reportes, con vista previa en pantalla ANTES del PDF. Los números
 * de la pantalla salen de los mismos agrupadores puros que usan los PDF
 * (`agruparGananciaPor*`, `filasCuentasPorCobrar`): la cuenta está escrita una
 * sola vez y no puede divergir.
 *
 * La ganancia de los reportes es la GUARDADA en cada renglón (congelada al
 * confirmar), nunca una cuenta nueva contra el costo de hoy.
 */
function ReportesPanel({ ventas }: { ventas: Venta[] }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [cargando, setCargando] = useState(false);
  const [porProducto, setPorProducto] = useState<FilaGananciaProducto[]>([]);
  const [porCategoria, setPorCategoria] = useState<FilaGananciaCategoria[]>([]);
  const [porCliente, setPorCliente] = useState<FilaGananciaCliente[]>([]);
  const [cuentas, setCuentas] = useState<CuentaPorCobrar[]>([]);

  // El mismo rango que reciben los PDF, para que pantalla y papel filtren igual.
  const rango = useMemo(() => ({
    desde: desde ? `${desde}T00:00:00.000Z` : null,
    hasta: hasta ? `${hasta}T23:59:59.999Z` : null,
  }), [desde, hasta]);

  const enRango = useCallback((iso: string) => (
    (!rango.desde || iso >= rango.desde) && (!rango.hasta || iso <= rango.hasta)
  ), [rango]);

  /** Ventas del período: confirmadas y entregadas, igual que el PDF por defecto. */
  const delPeriodo = useMemo(
    () => ventas.filter((v) => (v.estado === 'confirmada' || v.estado === 'entregada') && enRango(v.created_at)),
    [ventas, enRango],
  );

  /** Solo las ENTREGADAS alimentan la ganancia: es material que ya salió. */
  const entregadas = useMemo(
    () => ventas.filter((v) => v.estado === 'entregada' && enRango(v.created_at)),
    [ventas, enRango],
  );
  const claveEntregadas = useMemo(() => entregadas.map((v) => v.id).join(','), [entregadas]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    (async () => {
      const ids = claveEntregadas ? claveEntregadas.split(',') : [];
      const [renglones, productos, cxc] = await Promise.all([
        listRenglonesDeVentas(ids).catch(() => []),
        listProductos().catch(() => []),
        listCuentasPorCobrar(true).catch(() => [] as CuentaPorCobrar[]),
      ]);
      if (!vivo) return;
      const catPorProducto = new Map(productos.map((p) => [p.id, (p.categoria ?? '').trim()]));
      const filasProd = agruparGananciaPorProducto(
        renglones, (id) => catPorProducto.get(id)?.trim() || '(sin categoría)',
      );
      setPorProducto(filasProd);
      setPorCategoria(agruparGananciaPorCategoria(filasProd));
      setPorCliente(agruparGananciaPorCliente(entregadas, renglones));
      setCuentas(cxc);
    })()
      .catch((e) => { if (vivo) toast(e instanceof Error ? e.message : 'No se pudo armar el reporte.', 'error'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
    // `entregadas` se resume en `claveEntregadas`: dependemos de los ids, no del
    // array nuevo que crea cada refresh de realtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveEntregadas]);

  const filasCxC = useMemo<FilaCuentaPorCobrar[]>(() => filasCuentasPorCobrar(cuentas), [cuentas]);

  const bajar = (fn: () => Promise<void>) => {
    void fn().catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'));
  };

  const pct = (n: number | null) => (n == null ? '—' : `${num(n)} %`);

  return (
    <>
      <div className="filterbar">
        <label className="muted">Desde</label>
        <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <label className="muted">Hasta</label>
        <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        {(desde || hasta) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setDesde(''); setHasta(''); }}>Limpiar</button>
        )}
      </div>

      {/* 1 · Ventas del período */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
          <span>1 · Ventas del período <span className="muted" style={{ fontWeight: 400 }}>(confirmadas y entregadas)</span></span>
          <button className="btn btn-sm btn-ghost" onClick={() => bajar(() => descargarVentasDelPeriodoPdf({ desde: rango.desde, hasta: rango.hasta }))}>📄 Ver PDF</button>
        </div>
        {!delPeriodo.length ? <p className="muted">No hay ventas en el período elegido.</p> : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.84rem' }}>
              <thead>
                <tr>
                  <th>Código</th><th>Fecha</th><th>Cliente</th><th>Condición</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Ganancia</th>
                </tr>
              </thead>
              <tbody>
                {delPeriodo.slice(0, 20).map((v) => (
                  <tr key={v.id}>
                    <td className="mono">{v.codigo}</td>
                    <td className="muted">{date(v.created_at)}</td>
                    <td>{v.cliente_nombre || '—'}</td>
                    <td className="muted">{v.condicion === 'credito' ? 'Crédito' : 'Contado'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(v.total, v.moneda)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: colorGanancia(v.ganancia_total) }}>{montoMoneda(v.ganancia_total, v.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {delPeriodo.length > 20 && <p className="muted" style={{ marginBottom: 0 }}>…y {delPeriodo.length - 20} más. El PDF las trae todas, con los totales por moneda.</p>}
      </div>

      {/* 2 · Ganancia por producto y categoría */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
          <span>2 · Ganancia por producto y categoría <span className="muted" style={{ fontWeight: 400 }}>(ventas entregadas, importes sin IVA)</span></span>
          <button className="btn btn-sm btn-ghost" onClick={() => bajar(() => descargarGananciaPorProductoPdf(rango))}>📄 Ver PDF</button>
        </div>
        {cargando ? <p className="muted">Calculando…</p> : !porProducto.length ? (
          <p className="muted">No hay ventas entregadas con renglones en el período elegido.</p>
        ) : (
          <>
            <div className="table-wrap" style={{ marginBottom: '.7rem' }}>
              <table className="table" style={{ fontSize: '.84rem' }}>
                <thead>
                  <tr>
                    <th>Categoría</th><th style={{ textAlign: 'right' }}>Productos</th>
                    <th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Costo</th>
                    <th style={{ textAlign: 'right' }}>Ganancia</th><th style={{ textAlign: 'right' }}>Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {porCategoria.map((c) => (
                    <tr key={c.categoria}>
                      <td>{c.categoria}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c.productos}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(c.venta, 'USD')}</td>
                      <td className="mono muted" style={{ textAlign: 'right' }}>{montoMoneda(c.costo, 'USD')}</td>
                      <td className="mono" style={{ textAlign: 'right', color: colorGanancia(c.ganancia) }}>{montoMoneda(c.ganancia, 'USD')}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{pct(c.margenPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.84rem' }}>
                <thead>
                  <tr>
                    <th>Producto</th><th style={{ textAlign: 'right' }}>Cantidad</th>
                    <th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Costo</th>
                    <th style={{ textAlign: 'right' }}>Ganancia</th><th style={{ textAlign: 'right' }}>Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {porProducto.slice(0, 15).map((f) => (
                    <tr key={f.producto_id}>
                      <td><span className="mono muted">{f.sku}</span> {f.nombre}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(f.cantidad)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(f.venta, 'USD')}</td>
                      <td className="mono muted" style={{ textAlign: 'right' }}>{montoMoneda(f.costo, 'USD')}</td>
                      <td className="mono" style={{ textAlign: 'right', color: colorGanancia(f.ganancia) }}>{montoMoneda(f.ganancia, 'USD')}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{pct(f.margenPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {porProducto.length > 15 && <p className="muted" style={{ marginBottom: 0 }}>…y {porProducto.length - 15} productos más en el PDF.</p>}
          </>
        )}
      </div>

      {/* 3 · Ganancia por cliente */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
          <span>3 · Ganancia por cliente <span className="muted" style={{ fontWeight: 400 }}>(ventas entregadas, importes sin IVA)</span></span>
          <button className="btn btn-sm btn-ghost" onClick={() => bajar(() => descargarGananciaPorClientePdf(rango))}>📄 Ver PDF</button>
        </div>
        {cargando ? <p className="muted">Calculando…</p> : !porCliente.length ? (
          <p className="muted">No hay ventas entregadas en el período elegido.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.84rem' }}>
                <thead>
                  <tr>
                    <th>Cliente</th><th style={{ textAlign: 'right' }}>Documentos</th>
                    <th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Costo</th>
                    <th style={{ textAlign: 'right' }}>Ganancia</th><th style={{ textAlign: 'right' }}>Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {porCliente.slice(0, 15).map((f) => (
                    <tr key={f.clienteKey}>
                      <td>{f.cliente}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{f.documentos}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(f.venta, 'USD')}</td>
                      <td className="mono muted" style={{ textAlign: 'right' }}>{montoMoneda(f.costo, 'USD')}</td>
                      <td className="mono" style={{ textAlign: 'right', color: colorGanancia(f.ganancia) }}>{montoMoneda(f.ganancia, 'USD')}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{pct(f.margenPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {porCliente.length > 15 && <p className="muted" style={{ marginBottom: 0 }}>…y {porCliente.length - 15} clientes más en el PDF.</p>}
          </>
        )}
      </div>

      {/* 4 · Cuentas por cobrar */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
          <span>4 · Cuentas por cobrar <span className="muted" style={{ fontWeight: 400 }}>(abiertas, al día de hoy)</span></span>
          <button className="btn btn-sm btn-ghost" onClick={() => bajar(() => descargarCuentasPorCobrarPdf({ soloAbiertas: true }))}>📄 Ver PDF</button>
        </div>
        {!filasCxC.length ? <p className="muted">No hay cuentas por cobrar abiertas.</p> : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.84rem' }}>
              <thead>
                <tr>
                  <th>Cliente / Proveedor</th><th>Tipo</th>
                  <th style={{ textAlign: 'right' }}>Monto</th><th style={{ textAlign: 'right' }}>Cobrado</th>
                  <th style={{ textAlign: 'right' }}>Saldo</th><th style={{ textAlign: 'right' }}>Antigüedad</th>
                </tr>
              </thead>
              <tbody>
                {filasCxC.map((f) => (
                  <tr key={f.id}>
                    <td>{f.contraparte}</td>
                    <td className="muted">{f.tipo}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(f.monto, f.moneda)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(f.cobrado, f.moneda)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{montoMoneda(f.saldo, f.moneda)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{f.antiguedadDias} d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
