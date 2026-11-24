/* ============================================================
   Golden Touch · Retenciones · Buzón Móvil de Facturas
   Vista de teléfono optimizada para cargar y gestionar facturas
   externas y sus soportes (máx 4 imágenes, 1 o 2 PDFs).
   Incluye selector táctil de las empresas que reciben facturas (las
   guardadas en la base), botón táctil "✏ Escribir otra", resumen para
   WhatsApp y alertas de sonido.

   Si las tablas del buzón todavía no están en la base, la pantalla solo
   lo dice: no muestra formularios ni consulta nada.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { RUTA_TELEFONO } from '@/modules/auth/vistasTelefono';
import { useRealtime } from '@/shared/lib/useRealtime';
import { toast } from '@/shared/ui/Toast';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { date, money } from '@/shared/lib/format';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { completarRif, formatearRif } from '@/shared/lib/rif';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';
import { buzonDisponible } from '@/modules/libroFiscal/disponibilidad';
import { leerMonto, numeroATexto } from '@/modules/libroFiscal/validarCarga';
import { SeLeyo } from '@/modules/libroFiscal/SeLeyo';

import {
  listEmpresasReceptoras,
  type EmpresaReceptora,
} from './empresasReceptoras.repository';
import {
  listFacturasBuzon, cargarFacturaBuzon, eliminarFacturaBuzon, faltaEnFacturaBuzon,
  filtrarPorTexto, rotuloNumeroFactura, ultimaCreacionBuzon,
  TIPOS_DOCUMENTO_BUZON, type TipoDocumentoBuzon,
  type FacturaExternaBuzon, type EstatusFacturaBuzon, type NuevaFacturaBuzonInput,
} from './facturasBuzon.repository';
import {
  REGLA_BUZON, clasificarArchivos, validarAdjuntosBuzon, prepararAdjuntosBuzon, obtenerUrlAdjunto,
  type AdjuntoFacturaItem,
} from './adjuntosBuzon';
import {
  reproducirSonidoFacturaNueva, isSonidoRetencionesHabilitado, toggleSonidoRetenciones,
} from './soundRetenciones';
import {
  lanzarAvisoFactura, solicitarPermisoAvisos, isNotificacionesSoportadas, getEstadoPermisoNotificacion,
} from './notificacionesDispositivo';
import { mensajeFacturaExterna } from './mensajeFacturaExterna';
import { EmpresaEditor } from './EmpresaEditor';
import { estadoRetencionDeBuzon, badgeEstadoRetencion } from './estadoRetencion';

const ESTATUS_CONFIG: Record<EstatusFacturaBuzon, { label: string; icono: string; clase: string }> = {
  recibida: { label: 'Recibida', icono: '📥', clase: 'buzon-estatus-recibida' },
  en_revision: { label: 'En revisión', icono: '⏳', clase: 'buzon-estatus-en_revision' },
  retenida: { label: 'Retención hecha', icono: '✅', clase: 'buzon-estatus-retenida' },
  descartada: { label: 'Descartada', icono: '✖', clase: 'buzon-estatus-descartada' },
};

const estatusDe = (f: FacturaExternaBuzon) => ESTATUS_CONFIG[f.estatus] ?? ESTATUS_CONFIG.recibida;

/** El texto de un error, para mostrarlo tal cual (los repositorios ya lo dan en español). */
const motivoDe = (e: unknown, porDefecto: string) => (e instanceof Error && e.message ? e.message : porDefecto);

/** La tasa con sus decimales reales (hasta 4), no recortada a 2 como el formato de montos. */
const fmtTasa = (t: number) => Number(t).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/**
 * El monto que se muestra primero es en bolívares: es como se informa a los entes
 * fiscales. Si la factura es en dólares, el monto en dólares y la tasa van debajo.
 */
function montosDeFactura(f: FacturaExternaBuzon): { principal: string; alterno: string | null } {
  if (f.moneda === 'Bs') {
    return {
      principal: money(f.montoTotal, 'Bs'),
      alterno: f.montoUsd != null && f.tasa ? `≈ ${money(f.montoUsd, 'USD')} (tasa ${fmtTasa(f.tasa)} Bs por $)` : null,
    };
  }
  if (f.tasa && f.tasa > 0) {
    return { principal: money(f.montoBs, 'Bs'), alterno: `${money(f.montoTotal, 'USD')} a ${fmtTasa(f.tasa)} Bs por $` };
  }
  return { principal: money(f.montoTotal, 'USD'), alterno: 'Sin tasa para pasarla a bolívares' };
}

export function RetencionesMovilView() {
  const { user } = useSession();
  const { can, soloTelefono, appUser } = usePermissions();
  // Cargar facturas: basta con lectura en Retenciones (la base lo permite).
  // Empresas, cambios de estado y borrar: solo con escritura (o administrador).
  const canCargar = can('retenciones', 'lectura');
  const canWrite = can('retenciones', 'escritura');
  const actorName = appUser?.nombre?.trim() || user?.email || 'Usuario';

  // ¿Están las tablas del buzón en la base? null = preguntando.
  const [disponible, setDisponible] = useState<boolean | null>(null);

  const [empresas, setEmpresas] = useState<EmpresaReceptora[]>([]);
  const [empresaFiltro, setEmpresaFiltro] = useState<string>('todas');
  const [facturas, setFacturas] = useState<FacturaExternaBuzon[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [paso, setPaso] = useState<'lista' | 'cargar'>('lista');

  const [detalle, setDetalle] = useState<FacturaExternaBuzon | null>(null);
  const [facturaWhatsApp, setFacturaWhatsApp] = useState<FacturaExternaBuzon | null>(null);
  const [facturaABorrar, setFacturaABorrar] = useState<FacturaExternaBuzon | null>(null);
  // null = cerrado; {} = crear; { empresa } = editar esa empresa (C-l). Un solo form para ambos.
  const [empresaModal, setEmpresaModal] = useState<{ empresa?: EmpresaReceptora } | null>(null);
  const [empresaRecienCreada, setEmpresaRecienCreada] = useState<string | null>(null);
  const [sonidoHabilitado, setSonidoHabilitado] = useState(isSonidoRetencionesHabilitado());
  const [busqueda, setBusqueda] = useState('');
  const [estatusFiltro, setEstatusFiltro] = useState<string>('todas');
  // Para avisar solo cuando ENTRA una factura nueva: por el SELLO de creación más
  // reciente, no por el conteo. Si entra 1 y se borra 1 en la misma recarga el conteo
  // no cambia pero el sello sí, así el aviso no se pierde (C-i). Igual que la vista PC.
  const prevUltimaCreacionRef = useRef<string | null>(null);

  // Detector: sin las tablas del buzón no se consulta ni se suscribe a nada.
  useEffect(() => {
    let cancel = false;
    buzonDisponible()
      .then((ok) => { if (!cancel) setDisponible(ok); })
      .catch(() => { if (!cancel) setDisponible(false); });
    return () => { cancel = true; };
  }, []);

  // Se traen todas las facturas y se filtra por empresa en pantalla: así los
  // contadores de cada empresa son los de verdad.
  const cargarDatos = useCallback(async (avisarNuevas = false) => {
    try {
      const [empr, facs] = await Promise.all([listEmpresasReceptoras(), listFacturasBuzon()]);
      setEmpresas(empr);
      // Si entró una factura desde la última recarga (el sello más nuevo creció), suena
      // (si está activo), vibra y avisa en pantalla. facs[0] es la más reciente (orden desc).
      const ultima = ultimaCreacionBuzon(facs);
      if (avisarNuevas && prevUltimaCreacionRef.current !== null && ultima > prevUltimaCreacionRef.current) {
        lanzarAvisoFactura(facs[0], { conSonido: true });
        toast('🔔 Llegó una factura nueva al buzón', 'info');
      }
      prevUltimaCreacionRef.current = ultima;
      setFacturas(facs);
      setErrorCarga(null);
    } catch (e) {
      setErrorCarga(motivoDe(e, 'No se pudieron leer las facturas del buzón.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (disponible) void cargarDatos(false);
  }, [disponible, cargarDatos]);

  // Realtime para cambios en facturas externas (solo si las tablas existen): avisa de las entrantes.
  useRealtime(['retencion_facturas_externas', 'retencion_empresas_receptoras'], () => {
    void cargarDatos(true);
  }, { enabled: disponible === true });

  const toggleSonido = async () => {
    const nuevo = toggleSonidoRetenciones();
    setSonidoHabilitado(nuevo);
    if (!nuevo) { toast('Sonido silenciado 🔕', 'info'); return; }
    // Al activar los avisos se pide permiso de notificaciones, para que el banner funcione (como la vista PC).
    const estado = getEstadoPermisoNotificacion();
    if (isNotificacionesSoportadas() && estado === 'default') {
      const res = await solicitarPermisoAvisos();
      toast(
        res === 'granted'
          ? '🔔 Avisos activados: sonido y aviso en pantalla cuando entre una factura.'
          : 'Sonido activado. El navegador no dio permiso para el aviso en pantalla.',
        res === 'granted' ? 'success' : 'info',
      );
    } else if (estado === 'denied') {
      toast('Sonido activado. Los avisos en pantalla están bloqueados: toca el candado junto a la dirección para permitirlos.', 'warning');
    } else {
      toast('Sonido de facturas activado 🔔', 'info');
    }
  };

  const facturasFiltradas = useMemo(() => {
    // C-h: además del filtro por empresa (chips), búsqueda por texto y filtro de
    // estado, como la vista PC, para organizar aunque no se sepa qué se busca.
    let xs = empresaFiltro === 'todas' ? facturas : facturas.filter((f) => f.empresaId === empresaFiltro);
    if (estatusFiltro !== 'todas') xs = xs.filter((f) => f.estatus === estatusFiltro);
    return filtrarPorTexto(xs, busqueda);
  }, [facturas, empresaFiltro, estatusFiltro, busqueda]);

  const empresaSeleccionadaNombre = useMemo(() => {
    if (empresaFiltro === 'todas') return 'todas las empresas';
    const e = empresas.find((x) => x.id === empresaFiltro);
    return e?.nombreCorto || e?.nombre || 'esta empresa';
  }, [empresas, empresaFiltro]);

  const rutaVolver = soloTelefono ? RUTA_TELEFONO : '/app/retenciones';

  const cabecera = (
    <div className="buzon-head">
      <div>
        <h1>🧾 Buzón de Facturas</h1>
        <small className="muted" style={{ fontSize: '0.8rem' }}>
          Recepción externa y soportes fiscales
        </small>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {disponible && (
          <button
            type="button"
            className={`buzon-audio-toggle ${sonidoHabilitado ? 'activo' : ''}`}
            onClick={() => void toggleSonido()}
            title={sonidoHabilitado ? 'Sonido de avisos activo' : 'Sonido desactivado'}
          >
            {sonidoHabilitado ? '🔔 Con sonido' : '🔕 Silencio'}
          </button>
        )}
        {!soloTelefono && (
          <Link
            to="/app/retenciones"
            className="btn btn-ghost"
            style={{ textDecoration: 'none' }}
          >
            💻 Vista PC
          </Link>
        )}
      </div>
    </div>
  );

  // Preguntando a la base si el buzón está activo
  if (disponible === null) {
    return (
      <div className="buzon-movil">
        {cabecera}
        <div className="p-8 muted text-center">Cargando…</div>
      </div>
    );
  }

  // El buzón todavía no está en la base: solo el aviso y el enlace para volver
  if (!disponible) {
    return (
      <div className="buzon-movil">
        {cabecera}
        <div
          style={{
            textAlign: 'center',
            padding: '2.5rem 1rem',
            background: 'var(--bg-1)',
            borderRadius: 'var(--r-lg)',
            border: '1px dashed var(--border)',
          }}
        >
          <div style={{ fontSize: '2.2rem', marginBottom: '0.5rem' }}>🧾</div>
          <p style={{ fontWeight: 700, margin: '0 0 0.3rem' }}>
            El buzón de facturas todavía no está activo en la base.
          </p>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 1rem' }}>
            Cuando esté listo, aquí podrás cargar las facturas desde el teléfono.
          </p>
          <Link
            to={rutaVolver}
            className="btn primario"
            style={{ minHeight: '48px', padding: '0 1.25rem', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
          >
            ← Volver
          </Link>
        </div>
      </div>
    );
  }

  const sinEmpresas = !loading && !errorCarga && empresas.length === 0;

  return (
    <div className="buzon-movil">
      {/* Cabecera Móvil */}
      {cabecera}

      {/* Tabs principales de la vista teléfono */}
      <div className="buzon-tabs-top">
        <button
          type="button"
          className={`buzon-tab-btn ${paso === 'lista' ? 'activo' : ''}`}
          onClick={() => setPaso('lista')}
        >
          📋 Facturas ({facturasFiltradas.length})
        </button>
        {canCargar && (
          <button
            type="button"
            className={`buzon-tab-btn ${paso === 'cargar' ? 'activo' : ''}`}
            onClick={() => setPaso('cargar')}
          >
            ➕ Cargar Factura
          </button>
        )}
      </div>

      {/* Pestaña: Formulario de Carga (con lectura en Retenciones) */}
      {paso === 'cargar' && canCargar && (
        <FormularioCargaFactura
          empresas={empresas}
          empresaRecienCreada={empresaRecienCreada}
          canWrite={canWrite}
          actorName={actorName}
          onCancelar={() => setPaso('lista')}
          onGuardada={(nuevaFac) => {
            setPaso('lista');
            void cargarDatos();
            setFacturaWhatsApp(nuevaFac);
          }}
          onAbrirNuevaEmpresa={() => setEmpresaModal({})}
        />
      )}

      {/* Pestaña: Lista de Facturas */}
      {paso === 'lista' && (
        <>
          {errorCarga && (
            <div
              style={{
                padding: '0.75rem 1rem',
                marginBottom: '0.75rem',
                background: 'var(--bg-1)',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
                fontSize: '0.88rem',
              }}
            >
              {errorCarga}
              <div style={{ marginTop: '0.5rem' }}>
                <button type="button" className="btn" onClick={() => { setLoading(true); void cargarDatos(); }}>
                  Volver a intentar
                </button>
              </div>
            </div>
          )}

          {sinEmpresas ? (
            <AvisoSinEmpresas canWrite={canWrite} onAgregar={() => setEmpresaModal({})} />
          ) : (
            <>
              {/* Selector horizontal de empresas */}
              <div className="buzon-empresas-scroll">
                <button
                  type="button"
                  className={`buzon-empresa-chip ${empresaFiltro === 'todas' ? 'sel' : ''}`}
                  onClick={() => setEmpresaFiltro('todas')}
                >
                  🏢 Todas ({facturas.length})
                </button>
                {empresas.map((emp) => {
                  const cant = facturas.filter((f) => f.empresaId === emp.id).length;
                  return (
                    <button
                      key={emp.id}
                      type="button"
                      className={`buzon-empresa-chip ${empresaFiltro === emp.id ? 'sel' : ''}`}
                      onClick={() => setEmpresaFiltro(emp.id)}
                    >
                      <span style={{ color: emp.colorBadge }}>●</span> {emp.nombreCorto || emp.nombre} ({cant})
                    </button>
                  );
                })}
              </div>

              {/* C-l: editar la empresa seleccionada (con escritura). El mismo form que «Escribir otra», pre-llenado → UPDATE. */}
              {canWrite && empresaFiltro !== 'todas' && (() => {
                const emp = empresas.find((e) => e.id === empresaFiltro);
                return emp ? (
                  <div style={{ margin: '.35rem 0' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEmpresaModal({ empresa: emp })}
                      title={`Editar los datos de ${emp.nombreCorto || emp.nombre}`}
                    >
                      ✏ Editar {emp.nombreCorto || emp.nombre}
                    </button>
                  </div>
                ) : null;
              })()}

              {/* C-h: búsqueda + filtro de estado (como la vista PC) */}
              <div className="buzon-movil-filtros" style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', margin: '.5rem 0' }}>
                <input
                  type="search"
                  className="input surt-input"
                  placeholder="🔎 Buscar por proveedor, RIF, N°, empresa o descripción…"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  aria-label="Buscar facturas del buzón"
                />
                <div className="buzon-empresas-scroll" role="group" aria-label="Filtrar por estado">
                  <button
                    type="button"
                    className={`buzon-empresa-chip ${estatusFiltro === 'todas' ? 'sel' : ''}`}
                    onClick={() => setEstatusFiltro('todas')}
                  >
                    Todos los estados
                  </button>
                  {(Object.keys(ESTATUS_CONFIG) as EstatusFacturaBuzon[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`buzon-empresa-chip ${estatusFiltro === k ? 'sel' : ''}`}
                      onClick={() => setEstatusFiltro(k)}
                    >
                      {ESTATUS_CONFIG[k].icono} {ESTATUS_CONFIG[k].label}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="p-8 muted text-center">Cargando facturas…</div>
              ) : errorCarga ? null : facturasFiltradas.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '2.5rem 1rem',
                    background: 'var(--bg-1)',
                    borderRadius: 'var(--r-lg)',
                    border: '1px dashed var(--border)',
                  }}
                >
                  <div style={{ fontSize: '2.2rem', marginBottom: '0.5rem' }}>📭</div>
                  <p style={{ fontWeight: 700, margin: '0 0 0.3rem' }}>
                    No hay facturas cargadas para {empresaSeleccionadaNombre}
                  </p>
                  <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 1rem' }}>
                    Las facturas cargadas desde el teléfono o la PC aparecerán aquí al instante.
                  </p>
                  {canCargar && (
                    <button
                      type="button"
                      className="btn primario"
                      style={{ minHeight: '48px', padding: '0 1.25rem' }}
                      onClick={() => setPaso('cargar')}
                    >
                      ➕ Cargar primera factura
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  {facturasFiltradas.map((fac) => {
                    const estConfig = estatusDe(fac);
                    const fotosCount = fac.adjuntos.filter((a) => a.tipo === 'imagen').length;
                    const pdfsCount = fac.adjuntos.filter((a) => a.tipo === 'pdf').length;
                    const montos = montosDeFactura(fac);

                    return (
                      <div key={fac.id} className="buzon-card">
                        <div className="buzon-card-header">
                          <span className="buzon-card-empresa">
                            🏢 {fac.empresaNombre || 'Empresa'}
                          </span>
                          <span className={`buzon-estatus-pill ${estConfig.clase}`}>
                            {estConfig.icono} {estConfig.label}
                          </span>
                        </div>

                        {(() => {
                          const b = badgeEstadoRetencion(estadoRetencionDeBuzon(fac.estatus));
                          return <div><span className={b.className} title={b.tooltip} style={{ fontSize: '.7rem', padding: '1px 6px' }}>{b.label}</span></div>;
                        })()}

                        <div>
                          <div className="buzon-card-prov">{fac.proveedorNombre}</div>
                          <div className="buzon-card-rif">
                            {fac.proveedorRif ? `RIF: ${fac.proveedorRif}` : 'Sin RIF'} · Factura {rotuloNumeroFactura(fac.facturaNumero)}
                          </div>
                        </div>

                        {fac.descripcion && (
                          <p style={{ margin: '0', fontSize: '0.88rem', color: 'var(--text)' }}>
                            {fac.descripcion}
                          </p>
                        )}

                        <div className="buzon-card-montos">
                          <div>
                            <div className="buzon-card-monto-principal">{montos.principal}</div>
                            {montos.alterno && <div className="buzon-card-monto-alt">{montos.alterno}</div>}
                          </div>
                          <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            <div>📅 {date(fac.facturaFecha)}</div>
                            <div className="buzon-card-adjuntos-info" style={{ justifyContent: 'flex-end', marginTop: '0.2rem' }}>
                              {fotosCount > 0 && <span>🖼 {fotosCount}</span>}
                              {pdfsCount > 0 && <span>📄 {pdfsCount}</span>}
                              {fotosCount === 0 && pdfsCount === 0 && <span>📎 Sin soportes</span>}
                            </div>
                          </div>
                        </div>

                        <div className="buzon-card-acciones">
                          <button
                            type="button"
                            className="btn btn-wsp"
                            onClick={() => setFacturaWhatsApp(fac)}
                          >
                            💬 WhatsApp
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setDetalle(fac)}
                          >
                            👁 Detalle
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              className="btn btn-danger"
                              onClick={() => setFacturaABorrar(fac)}
                              title="Eliminar factura y soportes"
                            >
                              🗑
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Modal: Detalle de Factura */}
      {detalle && <DetalleFactura factura={detalle} onClose={() => setDetalle(null)} />}

      {/* Modal: Resumen WhatsApp post-carga */}
      {facturaWhatsApp && (
        <Modal
          title="Factura enviada al buzón"
          onClose={() => setFacturaWhatsApp(null)}
          size="md"
        >
          <div className="buzon-modal-whatsapp">
            <div className="buzon-aviso-exito">
              <span style={{ fontSize: '1.4rem' }}>✅</span>
              <div>
                <div>¡Factura registrada!</div>
                <small style={{ fontWeight: 400 }}>Ya está disponible en el buzón de Retenciones.</small>
              </div>
            </div>

            <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
              Puedes pasar el resumen por WhatsApp a los grupos o al personal de contabilidad:
            </p>

            <CompartirWhatsapp texto={mensajeFacturaExterna(facturaWhatsApp)} />

            <div style={{ marginTop: '1.25rem', textAlign: 'right' }}>
              <button
                type="button"
                className="btn primario"
                style={{ width: '100%', minHeight: '48px' }}
                onClick={() => setFacturaWhatsApp(null)}
              >
                Listo / Volver a la lista
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ConfirmDialog de Borrado */}
      {facturaABorrar && canWrite && (
        <ConfirmDialog
          title="¿Eliminar esta factura?"
          message={`Se eliminará permanentemente la factura ${rotuloNumeroFactura(facturaABorrar.facturaNumero)} de ${facturaABorrar.proveedorNombre} y sus soportes adjuntos.`}
          confirmText="Sí, eliminar factura"
          danger
          onCancel={() => setFacturaABorrar(null)}
          onConfirm={async () => {
            try {
              await eliminarFacturaBuzon(facturaABorrar);
              toast('Factura eliminada del buzón', 'info');
              setFacturaABorrar(null);
            } catch (e) {
              toast(motivoDe(e, 'No se pudo borrar la factura.'), 'error');
            } finally {
              void cargarDatos();
            }
          }}
        />
      )}

      {/* Modal: Crear o Editar Empresa Receptora (Móvil) — editor ÚNICO EmpresaEditor (C4b, modo rápido) */}
      {empresaModal && canWrite && (
        <Modal title={empresaModal.empresa ? '✏️ Editar empresa' : '✏️ Agregar empresa que recibe facturas'} onClose={() => setEmpresaModal(null)} size="md">
          <p className="muted" style={{ margin: '0 0 .6rem', fontSize: '.85rem' }}>
            Indica a qué empresa corresponde la compra. Lo fiscal (régimen, %, alícuotas, licencia) se completa desde la PC en Parámetros.
          </p>
          <EmpresaEditor
            modo="rapido"
            empresa={empresaModal.empresa}
            onClose={() => setEmpresaModal(null)}
            onGuardada={(emp) => {
              const eraEdicion = Boolean(empresaModal.empresa);
              setEmpresas((prev) => (prev.some((x) => x.id === emp.id) ? prev.map((x) => (x.id === emp.id ? emp : x)) : [...prev, emp]));
              if (!eraEdicion) { setEmpresaFiltro(emp.id); setEmpresaRecienCreada(emp.id); }
              setEmpresaModal(null);
              toast(eraEdicion ? `Empresa ${emp.nombreCorto || emp.nombre} actualizada` : `Empresa ${emp.nombreCorto || emp.nombre} lista para usar`, 'success');
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Aviso: todavía no hay empresas que reciban facturas
   ──────────────────────────────────────────────────────────── */
function AvisoSinEmpresas({ canWrite, onAgregar, onCancelar }: {
  canWrite: boolean;
  onAgregar: () => void;
  onCancelar?: () => void;
}) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '2.5rem 1rem',
        background: 'var(--bg-1)',
        borderRadius: 'var(--r-lg)',
        border: '1px dashed var(--border)',
        marginTop: '0.5rem',
      }}
    >
      <div style={{ fontSize: '2.2rem', marginBottom: '0.5rem' }}>🏢</div>
      <p style={{ fontWeight: 700, margin: '0 0 0.3rem' }}>
        Todavía no hay empresas que reciban facturas
      </p>
      <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 1rem' }}>
        Primero hay que cargar las empresas que reciben facturas; después podrás cargar las facturas de cada una.
        {!canWrite && ' Pídele a quien administra Retenciones que las cargue.'}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        {onCancelar && (
          <button type="button" className="btn" style={{ minHeight: '48px', padding: '0 1.25rem' }} onClick={onCancelar}>
            Volver a la lista
          </button>
        )}
        {canWrite && (
          <button
            type="button"
            className="btn primario"
            style={{ minHeight: '48px', padding: '0 1.25rem' }}
            onClick={onAgregar}
          >
            ➕ Agregar empresa
          </button>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Detalle de una factura del buzón. Los soportes se ven con
   enlaces firmados (de diez minutos) que se piden al abrirlo y se
   vuelven a pedir, frescos, cada vez que se toca una miniatura.
   ──────────────────────────────────────────────────────────── */
function DetalleFactura({ factura, onClose }: { factura: FacturaExternaBuzon; onClose: () => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const estConfig = estatusDe(factura);
  const montos = montosDeFactura(factura);

  useEffect(() => {
    let cancel = false;
    const paths = factura.adjuntos.map((a) => a.path).filter(Boolean);
    setUrls({});
    if (!paths.length) return;
    void Promise.all(
      paths.map(async (path) => {
        try {
          return { path, url: await obtenerUrlAdjunto(path), error: null };
        } catch (e) {
          return { path, url: null, error: motivoDe(e, 'No se pudo abrir el archivo.') };
        }
      }),
    ).then((resultados) => {
      if (cancel) return;
      const mapa: Record<string, string> = {};
      for (const r of resultados) if (r.url) mapa[r.path] = r.url;
      setUrls(mapa);
      const fallo = resultados.find((r) => r.error);
      if (fallo?.error) toast(fallo.error, 'error');
    });
    return () => { cancel = true; };
  }, [factura]);

  // El enlace firmado dura 10 min; al tocar una miniatura se pide SIEMPRE uno fresco
  // (el que se cargó al abrir el detalle puede haber vencido).
  const abrirSoporte = async (path: string) => {
    try {
      const url = await obtenerUrlAdjunto(path);
      setUrls((prev) => ({ ...prev, [path]: url }));
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(motivoDe(e, 'No se pudo abrir el archivo.'), 'error');
    }
  };

  return (
    <Modal
      title={`Factura ${rotuloNumeroFactura(factura.facturaNumero)} · ${factura.proveedorNombre}`}
      onClose={onClose}
      size="lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="buzon-card-empresa">
            🏢 {factura.empresaNombre || 'Empresa receptora'}
          </span>
          <span className={`buzon-estatus-pill ${estConfig.clase}`}>
            {estConfig.icono} {estConfig.label}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: 'var(--surface-2)', padding: '0.75rem', borderRadius: 'var(--r-md)' }}>
          <div>
            <small className="muted" style={{ display: 'block' }}>PROVEEDOR</small>
            <strong>{factura.proveedorNombre}</strong>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{factura.proveedorRif || 'Sin RIF'}</div>
          </div>
          <div>
            <small className="muted" style={{ display: 'block' }}>NÚMERO / CONTROL</small>
            <strong>Factura {rotuloNumeroFactura(factura.facturaNumero)}</strong>
            {factura.facturaControl && (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Control: {factura.facturaControl}</div>
            )}
          </div>
          <div>
            <small className="muted" style={{ display: 'block' }}>FECHA FACTURA</small>
            <strong>{date(factura.facturaFecha)}</strong>
          </div>
          <div>
            <small className="muted" style={{ display: 'block' }}>MONTO TOTAL</small>
            <strong style={{ fontSize: '1.1rem' }}>{montos.principal}</strong>
            {montos.alterno && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{montos.alterno}</div>
            )}
          </div>
        </div>

        {factura.descripcion && (
          <div>
            <small className="muted" style={{ display: 'block', fontWeight: 700 }}>DESCRIPCIÓN / CONCEPTO</small>
            <p style={{ margin: '0.2rem 0', background: 'var(--bg-1)', padding: '0.5rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
              {factura.descripcion}
            </p>
          </div>
        )}

        {factura.observaciones && (
          <div>
            <small className="muted" style={{ display: 'block', fontWeight: 700 }}>NOTAS</small>
            <p style={{ margin: '0.2rem 0', background: 'var(--bg-1)', padding: '0.5rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
              {factura.observaciones}
            </p>
          </div>
        )}

        <div>
          <small className="muted" style={{ display: 'block', fontWeight: 700, marginBottom: '0.4rem' }}>
            SOPORTES ADJUNTOS ({factura.adjuntos.length} de {REGLA_BUZON.maxTotal})
          </small>
          {factura.adjuntos.length === 0 ? (
            <p className="muted" style={{ fontStyle: 'italic', fontSize: '0.85rem' }}>No se subieron soportes adjuntos.</p>
          ) : (
            <div className="buzon-thumbs-grid">
              {factura.adjuntos.map((adj: AdjuntoFacturaItem) => {
                const url = urls[adj.path];
                const nombre = adj.nombreOriginal || adj.nombre || 'Soporte';
                const esImg = adj.tipo === 'imagen';
                const contenido = esImg && url ? (
                  <img src={url} alt={nombre} />
                ) : (
                  <div className="buzon-thumb-pdf">
                    <span aria-hidden>{esImg ? '🖼' : '📄'}</span>
                    <small>{nombre}</small>
                  </div>
                );
                // Siempre un botón que pide un enlace fresco al tocar: así nunca se abre uno vencido.
                return (
                  <button
                    key={adj.id}
                    type="button"
                    className="buzon-thumb-item"
                    title={nombre}
                    style={{ border: 'none', padding: 0, cursor: 'pointer', background: 'none' }}
                    onClick={() => void abrirSoporte(adj.path)}
                  >
                    {contenido}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.4rem' }}>
            📱 Resumen para WhatsApp:
          </div>
          <CompartirWhatsapp texto={mensajeFacturaExterna(factura)} />
        </div>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────
   Formulario de Carga de Factura Externa (Móvil)
   ──────────────────────────────────────────────────────────── */
function FormularioCargaFactura({
  empresas, empresaRecienCreada, canWrite, actorName, onCancelar, onGuardada, onAbrirNuevaEmpresa,
}: {
  empresas: EmpresaReceptora[];
  empresaRecienCreada: string | null;
  /** Con escritura en Retenciones se pueden agregar empresas desde aquí. */
  canWrite: boolean;
  actorName: string;
  onCancelar: () => void;
  onGuardada: (fac: FacturaExternaBuzon) => void;
  onAbrirNuevaEmpresa: () => void;
}) {
  const empresasActivas = useMemo(() => empresas.filter((e) => e.activo), [empresas]);
  const hoy = hoyVenezuela();

  const [empresaId, setEmpresaId] = useState(empresasActivas[0]?.id ?? '');
  const [proveedorNombre, setProveedorNombre] = useState('');
  const [proveedorRif, setProveedorRif] = useState('');
  const [rifAviso, setRifAviso] = useState<string | null>(null);
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumentoBuzon>('factura');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [numeroControl, setNumeroControl] = useState('');
  const [fechaFactura, setFechaFactura] = useState(hoy);
  const [moneda, setMoneda] = useState<'USD' | 'Bs'>('USD');
  const [montoTotal, setMontoTotal] = useState('');
  const [tasa, setTasa] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [observaciones, setObservaciones] = useState('');

  // Archivos seleccionados en memoria
  const [archivos, setArchivos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ id: string; file: File; url: string; tipo: 'imagen' | 'pdf' }[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [progresoMsg, setProgresoMsg] = useState('');

  const inputFotosRef = useRef<HTMLInputElement>(null);
  const inputPdfsRef = useRef<HTMLInputElement>(null);

  // Precargar la tasa del día (Banco Central) si está disponible; no pisa lo escrito.
  useEffect(() => {
    let cancel = false;
    getTasaHoy().then((th) => {
      if (!cancel && th?.usd) {
        const texto = numeroATexto(th.usd);
        setTasa((actual) => actual || texto);
      }
    }).catch(() => { /* sin tasa del día: se escribe a mano */ });
    return () => { cancel = true; };
  }, []);

  // Si la empresa elegida ya no está entre las activas, tomar la primera
  useEffect(() => {
    if (!empresasActivas.some((e) => e.id === empresaId) && empresasActivas.length > 0) {
      setEmpresaId(empresasActivas[0].id);
    }
  }, [empresasActivas, empresaId]);

  // La empresa recién creada desde el teléfono queda elegida
  useEffect(() => {
    if (empresaRecienCreada && empresasActivas.some((e) => e.id === empresaRecienCreada)) {
      setEmpresaId(empresaRecienCreada);
    }
  }, [empresaRecienCreada, empresasActivas]);

  // Actualizar previews al cambiar archivos
  useEffect(() => {
    const urlsToRevoke: string[] = [];
    const list = archivos.map((f, idx) => {
      const esImg = f.type.startsWith('image/');
      const url = esImg ? URL.createObjectURL(f) : '';
      if (url) urlsToRevoke.push(url);
      return {
        id: `${f.name}-${f.size}-${idx}`,
        file: f,
        url,
        tipo: esImg ? ('imagen' as const) : ('pdf' as const),
      };
    });
    setPreviews(list);
    return () => {
      urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [archivos]);

  const { imagenes, pdfs } = clasificarArchivos(archivos);
  const empresaSeleccionada = empresasActivas.find((e) => e.id === empresaId);

  // Lo que equivale en bolívares, mientras se escribe (es el monto que se informa)
  const montoLeido = montoTotal.trim() ? leerMonto(montoTotal) : null;
  const tasaLeida = tasa.trim() ? leerMonto(tasa) : null;
  const equivalenteBs = moneda === 'USD' && montoLeido != null && montoLeido > 0 && tasaLeida != null && tasaLeida > 0
    ? Math.round(montoLeido * tasaLeida * 100) / 100
    : null;

  const handleSeleccionarArchivos = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const candidatas = [...archivos, ...files];
    const val = validarAdjuntosBuzon(candidatas);
    if (!val.valido) {
      toast(val.error || 'Revisa los soportes: hay más archivos de los que se admiten.', 'warning');
      e.target.value = '';
      return;
    }
    setArchivos(candidatas);
    e.target.value = '';
  };

  const quitarArchivo = (index: number) => {
    setArchivos((prev) => prev.filter((_, i) => i !== index));
  };

  // Al salir del campo RIF: se completa el dígito verificador y se muestra con guiones
  const revisarRif = () => {
    const escrito = proveedorRif.trim();
    if (!escrito) { setRifAviso(null); return; }
    // Inválido = completarRif devuelve null. La letra «C» (Consejo Comunal) es VÁLIDA para el SENIAT.
    const completo = completarRif(escrito);
    if (!completo) {
      setRifAviso('Ese RIF no es válido: letra (J, G, V, E, P o C), 8 dígitos y el verificador.');
      return;
    }
    setRifAviso(null);
    setProveedorRif(formatearRif(completo));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (guardando) return;

    // El monto es opcional: si está vacío, se guarda sin monto (0). Si se escribió, tiene que entenderse.
    const monto = montoTotal.trim() ? leerMonto(montoTotal) : undefined;
    if (monto == null && montoTotal.trim()) {
      toast('No se entiende el monto total: escribe 1.234,56 o 1234,56.', 'warning');
      return;
    }
    const tasaNum = tasa.trim() ? leerMonto(tasa) : null;
    if (tasa.trim() && tasaNum == null) {
      toast('No se entiende la tasa: escribe 36,50 o 36.5.', 'warning');
      return;
    }

    // En dólares con monto, la tasa es obligatoria: la retención se informa en Bs y sin tasa
    // el equivalente en bolívares quedaría en 0. Se exige ANTES de subir los archivos.
    if (moneda === 'USD' && monto != null && monto > 0 && (tasaNum == null || tasaNum <= 0)) {
      toast('Falta la tasa del día (Bs por $): sin ella el monto no pasa a bolívares, que es como se informa. Escríbela antes de guardar.', 'warning');
      return;
    }

    // RIF opcional: si se escribió algo que no tiene arreglo, no se pierde en silencio: se avisa y se guarda sin RIF.
    const rifEscrito = proveedorRif.trim();
    // Inválido = completarRif devuelve null (NO el prefijo «C», que es un Consejo Comunal válido).
    const rifCompleto = rifEscrito ? completarRif(rifEscrito) : null;
    const rifParaGuardar = rifCompleto ? formatearRif(rifCompleto) : null;
    if (rifEscrito && !rifParaGuardar) {
      toast('El RIF escrito no es válido; la factura se guardará SIN RIF. Corrígelo si quieres incluirlo.', 'warning');
    }

    const input: NuevaFacturaBuzonInput = {
      empresaId,
      empresaNombre: empresaSeleccionada?.nombre ?? '',
      tipoDocumento,
      proveedorNombre: proveedorNombre.trim(),
      proveedorRif: rifParaGuardar,
      facturaNumero: numeroFactura.trim() || null,
      facturaControl: numeroControl.trim() || null,
      facturaFecha: fechaFactura || null,
      montoTotal: monto ?? undefined,
      moneda,
      tasa: tasaNum,
      descripcion: descripcion.trim() || null,
      observaciones: observaciones.trim() || null,
      // El autor (correo y nombre) lo pone la base: el teléfono no decide quién la cargó.
    };

    const falta = faltaEnFacturaBuzon(input);
    if (falta) {
      toast(falta, 'warning');
      return;
    }

    if (archivos.length === 0) {
      toast('Agrega al menos un soporte: una foto o un PDF de la factura.', 'warning');
      return;
    }
    const val = validarAdjuntosBuzon(archivos);
    if (!val.valido) {
      toast(val.error || 'Revisa los soportes adjuntos.', 'warning');
      return;
    }

    setGuardando(true);
    try {
      // Las imágenes se comprimen antes de subirlas; si una foto no se puede
      // convertir (p. ej. HEIC), se avisa el motivo y no se guarda nada.
      let preparados: File[] = [];
      if (archivos.length > 0) {
        setProgresoMsg(`Preparando ${archivos.length} soporte(s)…`);
        preparados = await prepararAdjuntosBuzon(archivos);
      }

      // Guarda la factura, sube los soportes y los registra; si algo falla no queda nada a medias
      const fac = await cargarFacturaBuzon(input, preparados, setProgresoMsg);

      // Confirmación para quien la cargó: un sonido corto (si el sonido está activo).
      // No se lanza aviso en pantalla a-uno-mismo: el banner «factura entrante» lo reciben
      // los demás por realtime, no quien la acaba de subir.
      reproducirSonidoFacturaNueva();

      toast('Factura cargada', 'success');
      onGuardada(fac);
    } catch (err) {
      toast(motivoDe(err, 'No se pudo guardar la factura.'), 'error');
    } finally {
      setGuardando(false);
      setProgresoMsg('');
    }
  };

  // Sin empresas activas no se puede cargar una factura
  if (empresasActivas.length === 0) {
    return <AvisoSinEmpresas canWrite={canWrite} onAgregar={onAbrirNuevaEmpresa} onCancelar={onCancelar} />;
  }

  return (
    <form onSubmit={handleSubmit} className="surt-form" style={{ marginTop: '0.5rem' }}>
      <div className="surt-form-titulo">
        <span className="icono" aria-hidden>🧾</span>
        <div>
          <strong>Cargar Factura Externa</strong>
          <small className="muted" style={{ display: 'block' }}>
            Registrada por {actorName}
          </small>
        </div>
      </div>

      {/* Empresa Receptora - Selector Táctil + Botón Escribir Otra */}
      <div className="surt-campo">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
          <label style={{ margin: 0 }}>Empresa que recibe la factura *</label>
          {empresaSeleccionada && (
            <span style={{ fontSize: '0.78rem', color: 'var(--primary-2)', fontWeight: 700 }}>
              {empresaSeleccionada.nombreCorto || empresaSeleccionada.nombre}
            </span>
          )}
        </div>

        {/* Botones táctiles grandes para selección rápida */}
        <div className="buzon-selector-tactil">
          {empresasActivas.map((emp) => {
            const esSel = emp.id === empresaId;
            return (
              <button
                key={emp.id}
                type="button"
                className={`buzon-tactil-btn ${esSel ? 'sel' : ''}`}
                onClick={() => setEmpresaId(emp.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', width: '100%' }}>
                  <span style={{ color: emp.colorBadge || 'var(--info)', fontSize: '0.9rem' }}>●</span>
                  <div className="emp-nom" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {emp.nombreCorto || emp.nombre}
                  </div>
                </div>
                <div className="emp-rif">{emp.rif || 'Sin RIF'}</div>
              </button>
            );
          })}

          {canWrite && (
            <button
              type="button"
              className="buzon-tactil-btn-otra"
              onClick={onAbrirNuevaEmpresa}
              title="Agregar otra empresa que recibe facturas"
            >
              <span style={{ fontSize: '1.2rem', marginBottom: '0.1rem' }}>✏️</span>
              <span>Escribir otra</span>
            </button>
          )}
        </div>
      </div>

      {/* Proveedor y RIF */}
      <div className="surt-grid2">
        <div className="surt-campo">
          <label>Nombre del proveedor *</label>
          <input
            type="text"
            className="input surt-input"
            placeholder="Ej. Ferretería El Tornillo C.A."
            value={proveedorNombre}
            onChange={(e) => setProveedorNombre(e.target.value)}
            required
          />
        </div>
        <div className="surt-campo">
          <label>RIF del proveedor</label>
          <input
            type="text"
            className="input surt-input"
            placeholder="Ej. J-12345678-9"
            value={proveedorRif}
            onChange={(e) => { setProveedorRif(e.target.value); setRifAviso(null); }}
            onBlur={revisarRif}
            autoCapitalize="characters"
          />
          {rifAviso && <small className="hint" style={{ color: 'var(--danger)' }}>{rifAviso}</small>}
        </div>
      </div>

      {/* Tipo de documento: Factura por defecto */}
      <div className="surt-campo">
        <label>Tipo de documento *</label>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${TIPOS_DOCUMENTO_BUZON.length}, 1fr)`, gap: '0.4rem' }}>
          {TIPOS_DOCUMENTO_BUZON.map((t) => (
            <button
              key={t.valor}
              type="button"
              className={`btn ${tipoDocumento === t.valor ? 'primario' : ''}`}
              style={{ minHeight: '48px', fontSize: '0.92rem', fontWeight: 700 }}
              onClick={() => setTipoDocumento(t.valor)}
            >
              {t.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* Número de Factura y Control */}
      <div className="surt-grid2">
        <div className="surt-campo">
          <label>Número de factura</label>
          <input
            type="text"
            className="input surt-input"
            placeholder="Ej. 00045812"
            value={numeroFactura}
            onChange={(e) => setNumeroFactura(e.target.value)}
          />
        </div>
        <div className="surt-campo">
          <label>Número de control</label>
          <input
            type="text"
            className="input surt-input"
            placeholder="Ej. 00-123456"
            value={numeroControl}
            onChange={(e) => setNumeroControl(e.target.value)}
          />
        </div>
      </div>

      {/* Fecha y Moneda/Monto */}
      <div className="surt-grid2">
        <div className="surt-campo">
          <label>Fecha de la factura</label>
          <input
            type="date"
            className="input surt-input"
            value={fechaFactura}
            max={hoy}
            onChange={(e) => setFechaFactura(e.target.value)}
          />
        </div>
        <div className="surt-campo">
          <label>Moneda *</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
            <button
              type="button"
              className={`btn ${moneda === 'USD' ? 'primario' : ''}`}
              style={{ minHeight: '56px', fontSize: '1.05rem', fontWeight: 800 }}
              onClick={() => setMoneda('USD')}
            >
              💵 Dólares ($)
            </button>
            <button
              type="button"
              className={`btn ${moneda === 'Bs' ? 'primario' : ''}`}
              style={{ minHeight: '56px', fontSize: '1.05rem', fontWeight: 800 }}
              onClick={() => setMoneda('Bs')}
            >
              🇻🇪 Bolívares (Bs)
            </button>
          </div>
        </div>
      </div>

      {/* Monto y Tasa */}
      <div className="surt-grid2">
        <div className="surt-campo">
          <label>Monto total ({moneda === 'USD' ? '$' : 'Bs'})</label>
          <input
            type="text"
            inputMode="decimal"
            className="input surt-input"
            placeholder="Ej. 1.234,56"
            value={montoTotal}
            onChange={(e) => setMontoTotal(e.target.value)}
          />
          <SeLeyo texto={montoTotal} />
          {equivalenteBs != null && (
            <small className="hint muted">Equivale a {money(equivalenteBs, 'Bs')}</small>
          )}
        </div>
        <div className="surt-campo">
          <label>Tasa del día (Bs por $)</label>
          <input
            type="text"
            inputMode="decimal"
            className="input surt-input"
            placeholder="Ej. 36,50"
            value={tasa}
            onChange={(e) => setTasa(e.target.value)}
          />
          <SeLeyo texto={tasa} decimales={4} />
        </div>
      </div>

      {/* Descripción y Notas */}
      <div className="surt-campo">
        <label>Descripción / Concepto de la compra</label>
        <textarea
          className="input surt-input"
          style={{ minHeight: '80px', paddingTop: '0.5rem' }}
          placeholder="Ej. Compra de repuestos para el tractor D8K, lubricantes y filtros..."
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </div>

      <div className="surt-campo">
        <label>Notas</label>
        <input
          type="text"
          className="input surt-input"
          placeholder="Ej. Entregado por chofer Pedro, factura original en sobre..."
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
        />
      </div>

      {/* Soportes y Adjuntos: Máximo 4 imágenes y 2 PDFs */}
      <div className="buzon-adjuntos-cont">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <strong style={{ fontSize: '0.95rem' }}>📎 Soportes y Adjuntos *</strong>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Máx {REGLA_BUZON.maxImagenes} fotos y {REGLA_BUZON.maxPdfs} PDFs
          </span>
        </div>

        {/* Inputs escondidos */}
        {/* Sin «capture»: el selector del teléfono ofrece tomar foto O elegir de la galería
            (una factura ya fotografiada se sube desde la galería). */}
        <input
          ref={inputFotosRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleSeleccionarArchivos}
        />
        <input
          ref={inputPdfsRef}
          type="file"
          accept="application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={handleSeleccionarArchivos}
        />

        <div className="buzon-adjuntos-botones">
          <button
            type="button"
            className="buzon-adjunto-btn-upload"
            onClick={() => inputFotosRef.current?.click()}
            disabled={imagenes.length >= REGLA_BUZON.maxImagenes}
          >
            <span className="icono" aria-hidden>📷</span>
            <span>Foto / Galería</span>
            <small style={{ color: imagenes.length >= REGLA_BUZON.maxImagenes ? 'var(--danger)' : 'var(--text-muted)' }}>
              ({imagenes.length}/{REGLA_BUZON.maxImagenes})
            </small>
          </button>

          <button
            type="button"
            className="buzon-adjunto-btn-upload"
            onClick={() => inputPdfsRef.current?.click()}
            disabled={pdfs.length >= REGLA_BUZON.maxPdfs}
          >
            <span className="icono" aria-hidden>📄</span>
            <span>Documento PDF</span>
            <small style={{ color: pdfs.length >= REGLA_BUZON.maxPdfs ? 'var(--danger)' : 'var(--text-muted)' }}>
              ({pdfs.length}/{REGLA_BUZON.maxPdfs})
            </small>
          </button>
        </div>

        {previews.length > 0 && (
          <div className="buzon-thumbs-grid">
            {previews.map((item, idx) => (
              <div key={item.id} className="buzon-thumb-item">
                {item.tipo === 'imagen' ? (
                  <img src={item.url} alt={item.file.name} />
                ) : (
                  <div className="buzon-thumb-pdf">
                    <span aria-hidden>📄</span>
                    <small>{item.file.name}</small>
                  </div>
                )}
                <button
                  type="button"
                  className="buzon-thumb-del"
                  onClick={() => quitarArchivo(idx)}
                  title="Quitar soporte"
                  disabled={guardando}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Botones de acción */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.6rem', marginTop: '0.5rem' }}>
        <button
          type="button"
          className="btn"
          style={{ minHeight: '62px', fontSize: '1.05rem' }}
          onClick={onCancelar}
          disabled={guardando}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="btn primario surt-guardar"
          disabled={guardando || archivos.length === 0}
          title={archivos.length === 0 ? 'Agrega al menos un soporte (foto o PDF)' : undefined}
        >
          {guardando ? progresoMsg || 'Guardando…' : '💾 Guardar y Enviar'}
        </button>
      </div>
    </form>
  );
}

