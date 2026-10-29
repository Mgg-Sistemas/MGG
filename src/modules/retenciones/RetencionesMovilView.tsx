/* ============================================================
   MGG · Retenciones · Buzón Móvil de Facturas
   Vista de teléfono optimizada para cargar y gestionar facturas
   externas y sus soportes (máx 4 imágenes, 1 o 2 PDFs).
   Incluye selector táctil de empresas (MGG, Golden Touch, Minería TS / MTO),
   botón táctil "✏ Escribir otra", resumen para WhatsApp y alertas de sonido.
   Alineado 1:1 con Golden Touch.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { toast } from '@/shared/ui/Toast';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { num, date, money } from '@/shared/lib/format';
import { hoyVE, getTasaHoy } from '@/modules/tesoreria/tasas.repository';

import {
  listEmpresasReceptoras, guardarEmpresaReceptora, type EmpresaReceptora,
} from './empresasReceptoras.repository';
import {
  listFacturasBuzon, crearFacturaBuzon, eliminarFacturaBuzon,
  urlPublicaAdjunto, type FacturaExternaBuzon, type EstatusFacturaBuzon,
} from './facturasBuzon.repository';
import {
  REGLA_BUZON, clasificarArchivos, validarAdjuntosBuzon, prepararAdjuntosBuzon, subirArchivoBuzon,
  type AdjuntoFacturaItem,
} from './adjuntosBuzon';
import {
  reproducirSonidoFacturaNueva, isSonidoRetencionesHabilitado, toggleSonidoRetenciones,
} from './soundRetenciones';
import { mensajeFacturaExterna } from './mensajeFacturaExterna';

const ESTATUS_CONFIG: Record<EstatusFacturaBuzon, { label: string; icono: string; clase: string }> = {
  recibida: { label: 'Recibida', icono: '📥', clase: 'buzon-estatus-recibida' },
  en_revision: { label: 'En Revisión', icono: '⏳', clase: 'buzon-estatus-en_revision' },
  retenida: { label: 'Retenida', icono: '✅', clase: 'buzon-estatus-retenida' },
  descartada: { label: 'Descartada', icono: '✖', clase: 'buzon-estatus-descartada' },
};

export function RetencionesMovilView() {
  const { user } = useSession();
  const { can, soloTelefono, appUser } = usePermissions();
  const canWrite = can('retenciones', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || 'Usuario';

  const [empresas, setEmpresas] = useState<EmpresaReceptora[]>([]);
  const [empresaFiltro, setEmpresaFiltro] = useState<string>('todas');
  const [facturas, setFacturas] = useState<FacturaExternaBuzon[]>([]);
  const [loading, setLoading] = useState(true);
  const [paso, setPaso] = useState<'lista' | 'cargar'>('lista');

  const [detalle, setDetalle] = useState<FacturaExternaBuzon | null>(null);
  const [facturaWhatsApp, setFacturaWhatsApp] = useState<FacturaExternaBuzon | null>(null);
  const [facturaABorrar, setFacturaABorrar] = useState<FacturaExternaBuzon | null>(null);
  const [modalEmpresa, setModalEmpresa] = useState(false);
  const [sonidoHabilitado, setSonidoHabilitado] = useState(isSonidoRetencionesHabilitado());

  const cargarDatos = useCallback(async () => {
    try {
      const [empr, facs] = await Promise.all([
        listEmpresasReceptoras(),
        listFacturasBuzon(empresaFiltro !== 'todas' ? { empresaId: empresaFiltro } : {}),
      ]);
      setEmpresas(empr);
      setFacturas(facs);
    } catch (e) {
      console.warn('Error al cargar datos del buzón de facturas:', e);
    } finally {
      setLoading(false);
    }
  }, [empresaFiltro]);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  // Realtime para cambios en facturas externas
  useRealtime(['retencion_facturas_externas', 'retencion_empresas_receptoras'], () => {
    void cargarDatos();
  });

  const toggleSonido = () => {
    const nuevo = toggleSonidoRetenciones();
    setSonidoHabilitado(nuevo);
    toast(nuevo ? 'Sonido de facturas activado 🔔' : 'Sonido silenciado 🔕', 'info');
  };

  const facturasFiltradas = useMemo(() => {
    if (empresaFiltro === 'todas') return facturas;
    return facturas.filter((f) => f.empresaId === empresaFiltro || f.empresa_receptora_id === empresaFiltro);
  }, [facturas, empresaFiltro]);

  const empresaSeleccionadaNombre = useMemo(() => {
    if (empresaFiltro === 'todas') return 'Todas las empresas';
    const e = empresas.find((x) => x.id === empresaFiltro);
    return e?.nombreCorto || e?.nombre || 'Empresa';
  }, [empresas, empresaFiltro]);

  return (
    <div className="buzon-movil">
      {/* Cabecera Móvil */}
      <div className="buzon-head">
        <div>
          <h1>🧾 Buzón de Facturas</h1>
          <small className="muted" style={{ fontSize: '0.8rem' }}>
            Recepción externa y soportes fiscales
          </small>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            className={`buzon-audio-toggle ${sonidoHabilitado ? 'activo' : ''}`}
            onClick={toggleSonido}
            title={sonidoHabilitado ? 'Sonido de avisos activo' : 'Sonido desactivado'}
          >
            {sonidoHabilitado ? '🔔 Con sonido' : '🔕 Silencio'}
          </button>
          {!soloTelefono && (
            <Link
              to="/app/retenciones"
              className="btn sm"
              style={{ textDecoration: 'none', fontSize: '0.78rem' }}
            >
              💻 Vista PC
            </Link>
          )}
        </div>
      </div>

      {/* Tabs principales de la vista teléfono */}
      <div className="buzon-tabs-top">
        <button
          type="button"
          className={`buzon-tab-btn ${paso === 'lista' ? 'activo' : ''}`}
          onClick={() => setPaso('lista')}
        >
          📋 Facturas ({facturasFiltradas.length})
        </button>
        <button
          type="button"
          className={`buzon-tab-btn ${paso === 'cargar' ? 'activo' : ''}`}
          onClick={() => {
            if (!canWrite) {
              toast('Tu rol no tiene permiso para cargar facturas', 'warning');
              return;
            }
            setPaso('cargar');
          }}
        >
          ➕ Cargar Factura
        </button>
      </div>

      {/* Pestaña: Formulario de Carga */}
      {paso === 'cargar' && (
        <FormularioCargaFactura
          empresas={empresas}
          actor={actor}
          actorName={actorName}
          onCancelar={() => setPaso('lista')}
          onGuardada={(nuevaFac) => {
            setPaso('lista');
            void cargarDatos();
            setFacturaWhatsApp(nuevaFac);
          }}
          onAbrirNuevaEmpresa={() => setModalEmpresa(true)}
        />
      )}

      {/* Pestaña: Lista de Facturas */}
      {paso === 'lista' && (
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
              const cant = facturas.filter((f) => f.empresaId === emp.id || f.empresa_receptora_id === emp.id).length;
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

          {loading ? (
            <div className="p-8 muted text-center">Cargando facturas...</div>
          ) : facturasFiltradas.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '2.5rem 1rem',
                background: 'var(--surface-1)',
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
              {canWrite && (
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
                const estatusClave: EstatusFacturaBuzon = fac.estatus || 'recibida';
                const estConfig = ESTATUS_CONFIG[estatusClave] || ESTATUS_CONFIG.recibida;
                const fotosCount = (fac.adjuntos || []).filter((a: AdjuntoFacturaItem) => a.tipo === 'imagen').length;
                const pdfsCount = (fac.adjuntos || []).filter((a: AdjuntoFacturaItem) => a.tipo === 'pdf').length;

                return (
                  <div key={fac.id} className="buzon-card">
                    <div className="buzon-card-header">
                      <span className="buzon-card-empresa">
                        🏢 {fac.empresaNombre || fac.empresa_nombre || 'Empresa'}
                      </span>
                      <span className={`buzon-estatus-pill ${estConfig.clase}`}>
                        {estConfig.icono} {estConfig.label}
                      </span>
                    </div>

                    <div>
                      <div className="buzon-card-prov">{fac.proveedorNombre || fac.proveedor_nombre}</div>
                      <div className="buzon-card-rif">
                        {(fac.proveedorRif || fac.proveedor_rif) ? `RIF: ${fac.proveedorRif || fac.proveedor_rif}` : 'Sin RIF'} · Fac #{fac.facturaNumero || fac.numero_factura}
                      </div>
                    </div>

                    {fac.descripcion && (
                      <p style={{ margin: '0', fontSize: '0.88rem', color: 'var(--text)' }}>
                        {fac.descripcion}
                      </p>
                    )}

                    <div className="buzon-card-montos">
                      <div>
                        <div className="buzon-card-monto-principal">
                          {money(fac.montoTotal || fac.monto_total || 0, fac.moneda)}
                        </div>
                        {fac.montoBs != null && fac.moneda === 'USD' && (
                          <div className="buzon-card-monto-alt">
                            ≈ {money(fac.montoBs, 'Bs')} {fac.tasa ? `(tasa ${num(fac.tasa)})` : ''}
                          </div>
                        )}
                        {fac.montoUsd != null && fac.moneda === 'Bs' && (
                          <div className="buzon-card-monto-alt">
                            ≈ {money(fac.montoUsd, 'USD')} {fac.tasa ? `(tasa ${num(fac.tasa)})` : ''}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <div>📅 {date(fac.facturaFecha || fac.fecha_factura || '')}</div>
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
                        className="btn sm"
                        style={{ background: '#25D366', color: '#fff', border: 'none', fontWeight: 700 }}
                        onClick={() => setFacturaWhatsApp(fac)}
                      >
                        💬 WhatsApp
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setDetalle(fac)}
                      >
                        👁 Detalle
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          className="btn sm danger"
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

      {/* Modal: Detalle de Factura */}
      {detalle && (
        <Modal
          title={`Factura #${detalle.facturaNumero || detalle.numero_factura} · ${detalle.proveedorNombre || detalle.proveedor_nombre}`}
          onClose={() => setDetalle(null)}
          size="lg"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="buzon-card-empresa">
                🏢 {detalle.empresaNombre || detalle.empresa_nombre || 'Empresa receptora'}
              </span>
              <span className={`buzon-estatus-pill ${ESTATUS_CONFIG[detalle.estatus]?.clase || ''}`}>
                {ESTATUS_CONFIG[detalle.estatus]?.icono} {ESTATUS_CONFIG[detalle.estatus]?.label}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: 'var(--surface-2)', padding: '0.75rem', borderRadius: 'var(--r-md)' }}>
              <div>
                <small className="muted" style={{ display: 'block' }}>PROVEEDOR</small>
                <strong>{detalle.proveedorNombre || detalle.proveedor_nombre}</strong>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{detalle.proveedorRif || detalle.proveedor_rif || 'Sin RIF'}</div>
              </div>
              <div>
                <small className="muted" style={{ display: 'block' }}>NÚMERO / CONTROL</small>
                <strong>Fac #{detalle.facturaNumero || detalle.numero_factura}</strong>
                {(detalle.facturaControl || detalle.numero_control) && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Control: {detalle.facturaControl || detalle.numero_control}</div>
                )}
              </div>
              <div>
                <small className="muted" style={{ display: 'block' }}>FECHA FACTURA</small>
                <strong>{date(detalle.facturaFecha || detalle.fecha_factura || '')}</strong>
              </div>
              <div>
                <small className="muted" style={{ display: 'block' }}>MONTO TOTAL</small>
                <strong style={{ fontSize: '1.1rem' }}>{money(detalle.montoTotal || detalle.monto_total || 0, detalle.moneda)}</strong>
                {detalle.tasa && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tasa: {num(detalle.tasa)} Bs/$</div>
                )}
              </div>
            </div>

            {detalle.descripcion && (
              <div>
                <small className="muted" style={{ display: 'block', fontWeight: 700 }}>DESCRIPCIÓN / CONCEPTO</small>
                <p style={{ margin: '0.2rem 0', background: 'var(--surface-1)', padding: '0.5rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
                  {detalle.descripcion}
                </p>
              </div>
            )}

            {detalle.observaciones && (
              <div>
                <small className="muted" style={{ display: 'block', fontWeight: 700 }}>NOTAS / OTRO</small>
                <p style={{ margin: '0.2rem 0', background: 'var(--surface-1)', padding: '0.5rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
                  {detalle.observaciones}
                </p>
              </div>
            )}

            <div>
              <small className="muted" style={{ display: 'block', fontWeight: 700, marginBottom: '0.4rem' }}>
                SOPORTES ADJUNTOS ({(detalle.adjuntos || []).length} de {REGLA_BUZON.maxTotal})
              </small>
              {(detalle.adjuntos || []).length === 0 ? (
                <p className="muted" style={{ fontStyle: 'italic', fontSize: '0.85rem' }}>No se subieron soportes adjuntos.</p>
              ) : (
                <div className="buzon-thumbs-grid">
                  {(detalle.adjuntos || []).map((adj: AdjuntoFacturaItem) => {
                    const url = urlPublicaAdjunto(adj.path);
                    const esImg = adj.tipo === 'imagen';
                    return (
                      <a
                        key={adj.id}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="buzon-thumb-item"
                        title={adj.nombreOriginal || adj.nombre}
                        style={{ textDecoration: 'none' }}
                      >
                        {esImg ? (
                          <img src={url} alt={adj.nombreOriginal || adj.nombre} />
                        ) : (
                          <div className="buzon-thumb-pdf">
                            <span aria-hidden>📄</span>
                            <small>{adj.nombreOriginal || adj.nombre}</small>
                          </div>
                        )}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.4rem' }}>
                📱 Resumen para WhatsApp:
              </div>
              <CompartirWhatsapp texto={mensajeFacturaExterna(detalle)} />
            </div>
          </div>
        </Modal>
      )}

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
                <div>¡Factura registrada exitosamente!</div>
                <small style={{ fontWeight: 400 }}>Ya está disponible en la bandeja de Retenciones.</small>
              </div>
            </div>

            <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
              Puedes pasar el resumen formateado por WhatsApp a los grupos o al personal de contabilidad:
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
      {facturaABorrar && (
        <ConfirmDialog
          title="¿Eliminar esta factura?"
          message={`Se eliminará permanentemente la factura #${facturaABorrar.facturaNumero || facturaABorrar.numero_factura} de ${facturaABorrar.proveedorNombre || facturaABorrar.proveedor_nombre} y sus soportes adjuntos.`}
          confirmText="Sí, eliminar factura"
          danger
          onCancel={() => setFacturaABorrar(null)}
          onConfirm={async () => {
            try {
              await eliminarFacturaBuzon(facturaABorrar.id);
              toast('Factura eliminada del buzón', 'info');
              setFacturaABorrar(null);
              void cargarDatos();
            } catch (e) {
              toast('Error al eliminar factura: ' + String(e), 'error');
            }
          }}
        />
      )}

      {/* Modal: Crear o Escribir Nueva Empresa Receptora (Móvil) */}
      {modalEmpresa && (
        <ModalNuevaEmpresa
          onClose={() => setModalEmpresa(false)}
          onCreada={(nueva) => {
            setEmpresas((prev) => {
              const existe = prev.some((x) => x.id === nueva.id || x.clave === nueva.clave);
              return existe ? prev : [...prev, nueva];
            });
            setEmpresaFiltro(nueva.id);
            setModalEmpresa(false);
            toast(`Empresa ${nueva.nombreCorto || nueva.nombre} lista para usar`, 'success');
          }}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Formulario de Carga de Factura Externa (Móvil)
   ──────────────────────────────────────────────────────────── */
function FormularioCargaFactura({
  empresas, actor, actorName, onCancelar, onGuardada, onAbrirNuevaEmpresa,
}: {
  empresas: EmpresaReceptora[];
  actor: string;
  actorName: string;
  onCancelar: () => void;
  onGuardada: (fac: FacturaExternaBuzon) => void;
  onAbrirNuevaEmpresa: () => void;
}) {
  const [empresaId, setEmpresaId] = useState(empresas[0]?.id ?? '');
  const [proveedorNombre, setProveedorNombre] = useState('');
  const [proveedorRif, setProveedorRif] = useState('');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [numeroControl, setNumeroControl] = useState('');
  const [fechaFactura, setFechaFactura] = useState(hoyVE());
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

  // Cargar tasa BCV del día si está disponible
  useEffect(() => {
    let cancel = false;
    getTasaHoy().then((th) => {
      if (!cancel && th?.usd && !tasa) {
        setTasa(String(th.usd));
      }
    }).catch(() => {});
    return () => { cancel = true; };
  }, [tasa]);

  // Si empresas cambia y empresaId no está en lista, ajustar
  useEffect(() => {
    if (!empresaId && empresas.length > 0) {
      setEmpresaId(empresas[0].id);
    }
  }, [empresas, empresaId]);

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
  const empresaSeleccionada = empresas.find((e) => e.id === empresaId);

  const handleSeleccionarArchivos = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const candidatas = [...archivos, ...files];
    const val = validarAdjuntosBuzon(candidatas);
    if (!val.valido) {
      toast(val.error || 'Límite de archivos excedido', 'warning');
      e.target.value = '';
      return;
    }
    setArchivos(candidatas);
    e.target.value = '';
  };

  const quitarArchivo = (index: number) => {
    setArchivos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!empresaId) {
      toast('Selecciona la empresa receptora', 'warning');
      return;
    }
    if (!proveedorNombre.trim()) {
      toast('Ingresa el nombre del proveedor', 'warning');
      return;
    }
    if (!numeroFactura.trim()) {
      toast('Ingresa el número de factura', 'warning');
      return;
    }
    const monto = parseFloat(montoTotal);
    if (isNaN(monto) || monto <= 0) {
      toast('Ingresa un monto válido mayor a 0', 'warning');
      return;
    }

    const val = validarAdjuntosBuzon(archivos);
    if (!val.valido) {
      toast(val.error || 'Revisa los adjuntos', 'warning');
      return;
    }

    setGuardando(true);
    setProgresoMsg('Guardando datos de factura...');

    try {
      const tasaNum = tasa ? parseFloat(tasa) : undefined;
      const empresa = empresas.find((x) => x.id === empresaId);

      // 1. Crear registro de factura
      const fac = await crearFacturaBuzon({
        empresa_receptora_id: empresaId,
        empresa_nombre: empresa?.nombre,
        proveedor_nombre: proveedorNombre.trim(),
        proveedor_rif: proveedorRif.trim() || undefined,
        numero_factura: numeroFactura.trim(),
        numero_control: numeroControl.trim() || undefined,
        fecha_factura: fechaFactura,
        moneda,
        monto_total: monto,
        tasa: tasaNum,
        descripcion: descripcion.trim() || 'Factura externa cargada desde móvil',
        observaciones: observaciones.trim() || undefined,
        creado_por: actor,
      });

      // 2. Subir adjuntos comprimiendo imágenes si las hay
      if (archivos.length > 0) {
        setProgresoMsg(`Procesando y subiendo ${archivos.length} soporte(s)...`);
        const preparados = await prepararAdjuntosBuzon(archivos);
        const adjuntosSubidos: AdjuntoFacturaItem[] = [];

        for (let i = 0; i < preparados.length; i++) {
          setProgresoMsg(`Subiendo archivo ${i + 1} de ${preparados.length}...`);
          const res = await subirArchivoBuzon(fac.id, preparados[i]);
          adjuntosSubidos.push(res);
        }
        fac.adjuntos = adjuntosSubidos;
      }

      // 3. Notificación sonora distintiva
      reproducirSonidoFacturaNueva();

      toast('Factura cargada con éxito', 'success');
      onGuardada(fac);
    } catch (err) {
      console.error('Error al guardar factura:', err);
      toast('Error al guardar: ' + String(err), 'error');
    } finally {
      setGuardando(false);
      setProgresoMsg('');
    }
  };

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
          <label style={{ margin: 0 }}>1. Empresa receptora de la compra *</label>
          {empresaSeleccionada && (
            <span style={{ fontSize: '0.78rem', color: 'var(--primary-2)', fontWeight: 700 }}>
              {empresaSeleccionada.nombreCorto || empresaSeleccionada.nombre}
            </span>
          )}
        </div>

        {/* Botones táctiles grandes para selección rápida */}
        <div className="buzon-selector-tactil">
          {empresas.map((emp) => {
            const esSel = emp.id === empresaId;
            return (
              <button
                key={emp.id}
                type="button"
                className={`buzon-tactil-btn ${esSel ? 'sel' : ''}`}
                onClick={() => setEmpresaId(emp.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', width: '100%' }}>
                  <span style={{ color: emp.colorBadge || '#2563eb', fontSize: '0.9rem' }}>●</span>
                  <div className="emp-nom" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {emp.nombreCorto || emp.nombre}
                  </div>
                </div>
                <div className="emp-rif">{emp.rif || 'Sin RIF'}</div>
              </button>
            );
          })}

          <button
            type="button"
            className="buzon-tactil-btn-otra"
            onClick={onAbrirNuevaEmpresa}
            title="Escribir nombre o código de otra empresa"
          >
            <span style={{ fontSize: '1.2rem', marginBottom: '0.1rem' }}>✏️</span>
            <span>Escribir otra</span>
          </button>
        </div>
      </div>

      {/* Proveedor y RIF */}
      <div className="surt-grid2">
        <div className="surt-campo">
          <label>2. Nombre del Proveedor *</label>
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
          <label>RIF del Proveedor (opcional)</label>
          <input
            type="text"
            className="input surt-input"
            placeholder="Ej. J-12345678-9"
            value={proveedorRif}
            onChange={(e) => setProveedorRif(e.target.value)}
          />
        </div>
      </div>

      {/* Número de Factura y Control */}
      <div className="surt-grid2">
        <div className="surt-campo">
          <label>3. Número de Factura *</label>
          <input
            type="text"
            className="input surt-input"
            placeholder="Ej. 00045812"
            value={numeroFactura}
            onChange={(e) => setNumeroFactura(e.target.value)}
            required
          />
        </div>
        <div className="surt-campo">
          <label>N° Control (opcional)</label>
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
          <label>4. Fecha de Factura *</label>
          <input
            type="date"
            className="input surt-input"
            value={fechaFactura}
            onChange={(e) => setFechaFactura(e.target.value)}
            required
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
              💵 USD ($)
            </button>
            <button
              type="button"
              className={`btn ${moneda === 'Bs' ? 'primario' : ''}`}
              style={{ minHeight: '56px', fontSize: '1.05rem', fontWeight: 800 }}
              onClick={() => setMoneda('Bs')}
            >
              🇻🇪 Bs.
            </button>
          </div>
        </div>
      </div>

      {/* Monto y Tasa */}
      <div className="surt-grid2">
        <div className="surt-campo">
          <label>5. Monto Total ({moneda}) *</label>
          <input
            type="number"
            step="0.01"
            className="input surt-input"
            placeholder="0.00"
            value={montoTotal}
            onChange={(e) => setMontoTotal(e.target.value)}
            required
          />
        </div>
        <div className="surt-campo">
          <label>Tasa BCV (Bs/$)</label>
          <input
            type="number"
            step="0.0001"
            className="input surt-input"
            placeholder="Tasa de cambio"
            value={tasa}
            onChange={(e) => setTasa(e.target.value)}
          />
        </div>
      </div>

      {/* Descripción y Notas */}
      <div className="surt-campo">
        <label>6. Descripción / Concepto de la compra</label>
        <textarea
          className="input surt-input"
          style={{ minHeight: '80px', paddingTop: '0.5rem' }}
          placeholder="Ej. Compra de repuestos para el tractor D8K, lubricantes y filtros..."
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </div>

      <div className="surt-campo">
        <label>7. Observaciones / Otro</label>
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
          <strong style={{ fontSize: '0.95rem' }}>📎 Soportes y Adjuntos</strong>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Máx {REGLA_BUZON.maxImagenes} fotos y {REGLA_BUZON.maxPdfs} PDFs
          </span>
        </div>

        {/* Inputs escondidos */}
        <input
          ref={inputFotosRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
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
          disabled={guardando}
        >
          {guardando ? progresoMsg || 'Guardando...' : '💾 Guardar y Enviar'}
        </button>
      </div>
    </form>
  );
}

/* ────────────────────────────────────────────────────────────
   Modal para Escribir / Añadir Empresa Receptora (Móvil)
   Ágil y directo para el personal en campo (Rol Facturas)
   ──────────────────────────────────────────────────────────── */
function ModalNuevaEmpresa({
  onClose, onCreada,
}: {
  onClose: () => void;
  onCreada: (emp: EmpresaReceptora) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [rif, setRif] = useState('');
  const [guardando, setGuardando] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const texto = nombre.trim();
    if (!texto) {
      toast('Ingresa el nombre o código de la empresa', 'warning');
      return;
    }
    setGuardando(true);
    try {
      const emp = await guardarEmpresaReceptora({
        nombre: texto,
        nombreCorto: texto.length <= 15 ? texto : texto.slice(0, 15),
        rif: rif.trim() || 'S/RIF',
        colorBadge: '#2563eb',
        activo: true,
        orden: 10,
      });
      onCreada(emp);
    } catch (err) {
      toast('Error al registrar empresa: ' + String(err), 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal title="✏️ Escribir otra empresa" onClose={onClose} size="md">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Indica a qué empresa o proyecto corresponde la compra. El departamento de Impuestos completará la ficha fiscal posteriormente en oficina.
        </p>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            Nombre o Código de la Empresa *
          </label>
          <input
            type="text"
            className="input"
            style={{ width: '100%', minHeight: '52px', fontSize: '1.1rem' }}
            placeholder="Ej. MGG, Minería TS, Inversiones..."
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            RIF de la Empresa (opcional si lo tienes)
          </label>
          <input
            type="text"
            className="input"
            style={{ width: '100%', minHeight: '52px', fontSize: '1.1rem' }}
            placeholder="Ej. J-12345678-9"
            value={rif}
            onChange={(e) => setRif(e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="button" className="btn" style={{ minHeight: '52px' }} onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" style={{ minHeight: '52px', fontWeight: 800 }} disabled={guardando}>
            {guardando ? 'Guardando...' : 'Aceptar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
