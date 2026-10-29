/* ============================================================
   MGG · Retenciones · Vista de Teléfono (Carga de Facturas) (29-10-2026)

   Diseñada para celular (pantalla táctil, botones grandes):
   - Cargar y eliminar facturas de compras fuera del flujo tradicional de oficina.
   - Adjuntos controlados: máximo 4 fotos y 1 o 2 archivos PDF.
   - Lista estructurada de empresas fiscales registradas (Golden Touch, MineriaTs, MGG...)
     con posibilidad de registrar una nueva empresa con su RIF válido.
   - Resumen estructurado con botón directo para enviar por WhatsApp.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/modules/auth/useSession';
import { usePermissions } from '@/modules/usuarios/usePermissions';
import { toast } from '@/shared/lib/toast';
import { normalizarRif, rifValido } from '@/shared/lib/rif';
import {
  listEmpresasFiscales,
  crearEmpresaFiscal,
  type DatosFiscalesEmpresa,
} from './empresasFiscales.repository';
import {
  crearFacturaExterna,
  eliminarFacturaExterna,
  listFacturasExternas,
  urlArchivoFactura,
  validarArchivosFactura,
  MAX_IMAGENES_FACTURA,
  MAX_PDFS_FACTURA,
  type FacturaExterna,
  type TipoDocumentoFactura,
  type MonedaFactura,
} from './facturasExternas.repository';
import {
  mensajeFacturaWhatsapp,
  compartirFacturaWhatsapp,
  EMOJI_ESTADO_FACTURA,
  ETIQUETA_ESTADO_FACTURA,
} from './mensajeFacturaWhatsapp';
import {
  getSonidoRetencionesHabilitado,
  toggleSonidoRetenciones,
  useNotificacionesFacturasRetencion,
} from './notificacionesRetencion';
import {
  isNotificacionesSoportadas,
  getEstadoPermisoNotificacion,
  isAvisosPantallaHabilitados,
  setAvisosPantallaHabilitados,
  solicitarPermisoAvisos,
} from './notificacionesDispositivo';

type ModoVista = 'carga' | 'lista';

export function RetencionesMovilView() {
  const { user } = useSession();
  const { soloTelefono } = usePermissions();
  const actor = user?.email ?? 'sistema';

  const [modo, setModo] = useState<ModoVista>('carga');
  const [empresas, setEmpresas] = useState<DatosFiscalesEmpresa[]>([]);
  const [empresaSeleccionada, setEmpresaSeleccionada] = useState<string>('GOLDEN');

  // Modal para registrar nueva empresa con RIF
  const [modalNuevaEmpresaOpen, setModalNuevaEmpresaOpen] = useState(false);
  const [nuevaEmpRazon, setNuevaEmpRazon] = useState('');
  const [nuevaEmpRif, setNuevaEmpRif] = useState('');
  const [nuevaEmpCodigo, setNuevaEmpCodigo] = useState('');
  const [guardandoEmpresa, setGuardandoEmpresa] = useState(false);

  // Campos del formulario de factura
  const [proveedorNombre, setProveedorNombre] = useState('');
  const [proveedorRif, setProveedorRif] = useState('');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [numeroControl, setNumeroControl] = useState('');
  const [fechaFactura, setFechaFactura] = useState(() => new Date().toISOString().slice(0, 10));
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumentoFactura>('factura');
  const [moneda, setMoneda] = useState<MonedaFactura>('USD');
  const [montoTotal, setMontoTotal] = useState('');
  const [baseImponible, setBaseImponible] = useState('');
  const [tasaCambio, setTasaCambio] = useState('');
  const [observacion, setObservacion] = useState('');

  // Archivos adjuntos seleccionados
  const [fotos, setFotos] = useState<File[]>([]);
  const [pdfs, setPdfs] = useState<File[]>([]);
  const [guardando, setGuardando] = useState(false);

  // Lista de facturas
  const [facturas, setFacturas] = useState<FacturaExterna[]>([]);
  const [cargandoLista, setCargandoLista] = useState(false);
  const [filtroEmpresa, setFiltroEmpresa] = useState('todas');
  const [filtroTexto, setFiltroTexto] = useState('');

  // Factura seleccionada para ver detalle/adjuntos
  const [facturaDetalle, setFacturaDetalle] = useState<FacturaExterna | null>(null);
  const [urlsAdjuntos, setUrlsAdjuntos] = useState<Record<string, string>>({});
  const [cargandoUrls, setCargandoUrls] = useState(false);

  // Avisos y sonido nativos (sin instalar nada en el móvil)
  const [sonidoHabilitado, setSonidoHabilitado] = useState(getSonidoRetencionesHabilitado());
  const [avisosActivos, setAvisosActivos] = useState(isAvisosPantallaHabilitados());
  const [permisoNotif, setPermisoNotif] = useState(getEstadoPermisoNotificacion());

  function toggleSonido() {
    const nuevo = toggleSonidoRetenciones();
    setSonidoHabilitado(nuevo);
    toast(nuevo ? 'Sonido activado 🔔' : 'Sonido silenciado 🔕', 'info');
  }

  async function handleToggleAvisosPantalla() {
    if (!isNotificacionesSoportadas()) {
      toast('Este navegador no soporta notificaciones nativas.', 'info');
      return;
    }
    const estado = getEstadoPermisoNotificacion();
    if (estado === 'denied') {
      toast('Avisos bloqueados. Revisa los permisos del navegador.', 'warning');
      setPermisoNotif('denied');
      return;
    }
    if (estado !== 'granted') {
      const res = await solicitarPermisoAvisos();
      setPermisoNotif(res);
      if (res === 'granted') {
        setAvisosActivos(true);
        toast('Avisos activados 📲', 'success');
      }
      return;
    }
    const nuevo = !avisosActivos;
    setAvisosPantallaHabilitados(nuevo);
    setAvisosActivos(nuevo);
    toast(nuevo ? 'Avisos activados 📲' : 'Avisos desactivados 📴', 'info');
  }

  // Cargar empresas fiscales registradas
  const recargarEmpresas = useCallback(async () => {
    try {
      const lista = await listEmpresasFiscales();
      setEmpresas(lista);
      if (lista.length && !lista.some((e) => e.codigo === empresaSeleccionada)) {
        setEmpresaSeleccionada(lista[0].codigo);
      }
    } catch {
      // Fallback mínimo
      setEmpresas([
        { codigo: 'GOLDEN', razonSocial: 'Golden Touch 1127 C.A.', rif: 'J-50129993-5', direccionFiscal: null, ciudad: null, municipio: null, estado: null, esContribuyenteEspecial: true, esAgenteRetencionIva: true, pctIvaGeneral: 75, pctIvaEspecial: 100, activa: true },
        { codigo: 'MINERIATS', razonSocial: 'Mineria Tin Oxide C.A.', rif: 'J-41234567-8', direccionFiscal: null, ciudad: null, municipio: null, estado: null, esContribuyenteEspecial: false, esAgenteRetencionIva: false, pctIvaGeneral: 75, pctIvaEspecial: 100, activa: true },
        { codigo: 'MGG', razonSocial: 'Mineral Group Guayana C.A.', rif: 'J-50221930-7', direccionFiscal: null, ciudad: null, municipio: null, estado: null, esContribuyenteEspecial: true, esAgenteRetencionIva: true, pctIvaGeneral: 75, pctIvaEspecial: 100, activa: true },
      ]);
    }
  }, [empresaSeleccionada]);

  useEffect(() => {
    void recargarEmpresas();
  }, [recargarEmpresas]);

  const recargarFacturas = useCallback(async () => {
    setCargandoLista(true);
    try {
      const data = await listFacturasExternas();
      setFacturas(data);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al cargar facturas', 'error');
    } finally {
      setCargandoLista(false);
    }
  }, []);

  useEffect(() => {
    void recargarFacturas();
  }, [recargarFacturas]);

  // Escuchar notificaciones en vivo
  useNotificacionesFacturasRetencion({
    activo: true,
    onNuevaFactura: () => { void recargarFacturas(); },
    onCambioEstatus: () => { void recargarFacturas(); },
  });

  // Manejo de carga de archivos (fotos y PDFs)
  function handleArchivosSeleccionados(e: React.ChangeEvent<HTMLInputElement>) {
    const rawFiles = Array.from(e.target.files ?? []);
    if (!rawFiles.length) return;

    try {
      const todosNuevos = [...fotos, ...pdfs, ...rawFiles];
      const { imagenes, pdfs: nuevosPdfs } = validarArchivosFactura(todosNuevos);
      setFotos(imagenes);
      setPdfs(nuevosPdfs);
      toast(`Adjuntos listos: ${imagenes.length} foto(s), ${nuevosPdfs.length} PDF(s)`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error en los archivos', 'error');
    } finally {
      e.target.value = '';
    }
  }

  function eliminarFoto(idx: number) {
    setFotos((prev) => prev.filter((_, i) => i !== idx));
  }

  function eliminarPdf(idx: number) {
    setPdfs((prev) => prev.filter((_, i) => i !== idx));
  }

  // Registrar nueva empresa fiscal desde el celular
  async function handleGuardarNuevaEmpresa(e: React.FormEvent) {
    e.preventDefault();
    const razon = nuevaEmpRazon.trim();
    if (razon.length < 3) {
      toast('Escribe la razón social o nombre de la empresa.', 'error');
      return;
    }

    const rifNorm = normalizarRif(nuevaEmpRif);
    if (!rifNorm || !rifValido(rifNorm)) {
      toast('Ingresa un RIF válido según el SENIAT (ej. J-12345678-0).', 'error');
      return;
    }

    const codigo = (nuevaEmpCodigo.trim() || razon.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)).toUpperCase();

    setGuardandoEmpresa(true);
    try {
      const creada = await crearEmpresaFiscal({
        codigo,
        razonSocial: razon,
        rif: rifNorm,
      }, actor);

      toast(`Empresa ${creada.codigo} registrada con RIF ${creada.rif}`, 'success');
      await recargarEmpresas();
      setEmpresaSeleccionada(creada.codigo);
      setModalNuevaEmpresaOpen(false);
      setNuevaEmpRazon('');
      setNuevaEmpRif('');
      setNuevaEmpCodigo('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al registrar empresa', 'error');
    } finally {
      setGuardandoEmpresa(false);
    }
  }

  // Guardar factura
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!empresaSeleccionada) {
      toast('Selecciona la empresa a la que pertenece la factura.', 'error');
      return;
    }

    const nro = Number(montoTotal);
    if (!Number.isFinite(nro) || nro <= 0) {
      toast('Ingresa un monto válido mayor a 0.', 'error');
      return;
    }

    if (!fotos.length && !pdfs.length) {
      toast('Adjunta al menos una foto o PDF de la factura como soporte.', 'error');
      return;
    }

    setGuardando(true);
    try {
      const nueva = await crearFacturaExterna(
        {
          empresa: empresaSeleccionada,
          proveedorNombre: proveedorNombre.trim(),
          proveedorRif: proveedorRif.trim(),
          numeroFactura: numeroFactura.trim(),
          numeroControl: numeroControl.trim() || null,
          fechaFactura,
          tipoDocumento,
          moneda,
          tasaCambio: tasaCambio ? Number(tasaCambio) : null,
          montoTotal: nro,
          baseImponible: baseImponible ? Number(baseImponible) : nro,
          observacion: observacion.trim() || null,
          actor,
          actorName: user?.email || null,
        },
        [...fotos, ...pdfs]
      );

      toast('¡Factura cargada exitosamente!', 'success');

      // Limpiar formulario
      setProveedorNombre('');
      setProveedorRif('');
      setNumeroFactura('');
      setNumeroControl('');
      setMontoTotal('');
      setBaseImponible('');
      setObservacion('');
      setFotos([]);
      setPdfs([]);

      await recargarFacturas();

      // Ofrecer enviar por WhatsApp inmediatamente
      const textoWsp = mensajeFacturaWhatsapp(nueva);
      void compartirFacturaWhatsapp(textoWsp, `Factura ${nueva.numeroFactura}`);

      setModo('lista');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al guardar la factura', 'error');
    } finally {
      setGuardando(false);
    }
  }

  // Eliminar factura
  async function handleEliminar(f: FacturaExterna) {
    if (!window.confirm(`¿Seguro que deseas eliminar la factura ${f.numeroFactura} de ${f.proveedorNombre}?`)) return;

    try {
      await eliminarFacturaExterna(f.id);
      toast('Factura eliminada.', 'info');
      setFacturas((prev) => prev.filter((x) => x.id !== f.id));
      if (facturaDetalle?.id === f.id) setFacturaDetalle(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al eliminar', 'error');
    }
  }

  // Cargar URLs para previsualizar adjuntos en modal
  async function abrirDetalle(f: FacturaExterna) {
    setFacturaDetalle(f);
    setUrlsAdjuntos({});
    if (!f.archivos.length) return;

    setCargandoUrls(true);
    const map: Record<string, string> = {};
    for (const a of f.archivos) {
      try {
        map[a.id] = await urlArchivoFactura(a.path);
      } catch {
        // Ignorar si falla enlace individual
      }
    }
    setUrlsAdjuntos(map);
    setCargandoUrls(false);
  }

  // Facturas filtradas
  const facturasFiltradas = useMemo(() => {
    return facturas.filter((f) => {
      if (filtroEmpresa !== 'todas' && f.empresa.toUpperCase() !== filtroEmpresa.toUpperCase()) {
        return false;
      }
      if (filtroTexto.trim()) {
        const q = filtroTexto.trim().toLowerCase();
        const match =
          f.numeroFactura.toLowerCase().includes(q) ||
          f.proveedorNombre.toLowerCase().includes(q) ||
          f.proveedorRif.toLowerCase().includes(q) ||
          f.empresa.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [facturas, filtroEmpresa, filtroTexto]);

  return (
    <div className="surtidor flo-movil-wrap" style={{ maxWidth: '580px', margin: '0 auto', padding: '1rem .75rem' }}>
      {/* ── Encabezado Móvil ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px solid #334155', paddingBottom: '.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          <span style={{ fontSize: '1.75rem' }}>🧾</span>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>Carga de Facturas</h1>
            <small style={{ color: '#94a3b8' }}>Compras y soportes fuera de oficina</small>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          <button
            type="button"
            onClick={toggleSonido}
            className="btn btn-ghost btn-sm"
            title={sonidoHabilitado ? 'Silenciar sonido' : 'Activar sonido distintivo'}
            style={{ padding: '4px 8px', fontSize: '.85rem' }}
          >
            {sonidoHabilitado ? '🔔' : '🔕'}
          </button>
          <button
            type="button"
            onClick={handleToggleAvisosPantalla}
            className="btn btn-ghost btn-sm"
            title={
              permisoNotif === 'denied'
                ? 'Avisos bloqueados en el navegador'
                : avisosActivos && permisoNotif === 'granted'
                ? 'Desactivar avisos en pantalla'
                : 'Activar avisos nativos en pantalla y vibración'
            }
            style={{ padding: '4px 8px', fontSize: '.85rem' }}
          >
            {permisoNotif === 'denied' ? '⚠️' : avisosActivos && permisoNotif === 'granted' ? '📲' : '📴'}
          </button>
          {!soloTelefono && (
            <Link to="/app/retenciones" className="btn btn-ghost btn-sm" title="Volver al libro fiscal y retenciones de escritorio">
              🖥 PC
            </Link>
          )}
        </div>
      </div>

      {/* ── Selector de Modo (Cargar vs Lista) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginBottom: '1.25rem' }}>
        <button
          type="button"
          className={`btn ${modo === 'carga' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ padding: '.75rem', fontWeight: 600, fontSize: '.95rem' }}
          onClick={() => setModo('carga')}
        >
          ➕ Nueva Factura
        </button>
        <button
          type="button"
          className={`btn ${modo === 'lista' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ padding: '.75rem', fontWeight: 600, fontSize: '.95rem' }}
          onClick={() => setModo('lista')}
        >
          📋 Facturas ({facturas.length})
        </button>
      </div>

      {/* ── PANTALLA: FORMULARIO DE CARGA ── */}
      {modo === 'carga' && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Empresa Destino (Selector con base fiscal y alta rápida) */}
          <div className="card" style={{ padding: '1rem', background: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem' }}>
              <label style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '.9rem' }}>
                🏢 Empresa a la que pertenece la factura:
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '.75rem', padding: '2px 8px', color: '#ff8a00' }}
                onClick={() => setModalNuevaEmpresaOpen(true)}
              >
                ➕ Nueva Empresa
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '.5rem' }}>
              {empresas.map((emp) => {
                const activa = empresaSeleccionada === emp.codigo;
                return (
                  <button
                    key={emp.codigo}
                    type="button"
                    onClick={() => setEmpresaSeleccionada(emp.codigo)}
                    style={{
                      padding: '.6rem .5rem',
                      borderRadius: '6px',
                      border: activa ? '2px solid #ff8a00' : '1px solid #475569',
                      background: activa ? '#334155' : '#0f172a',
                      color: '#f8fafc',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: '.85rem', color: '#ff8a00' }}>
                      🏢 {emp.codigo}
                    </span>
                    <small style={{ color: '#cbd5e1', fontSize: '.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {emp.razonSocial}
                    </small>
                    <small style={{ color: '#94a3b8', fontSize: '.68rem' }}>
                      {emp.rif || 'Sin RIF'}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Datos de Proveedor */}
          <div className="card" style={{ padding: '1rem', background: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
            <h3 style={{ margin: '0 0 .75rem 0', fontSize: '.95rem', color: '#cbd5e1' }}>🏪 Proveedor</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem', marginBottom: '.6rem' }}>
              <div>
                <label style={{ fontSize: '.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>RIF *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="J-12345678-0"
                  value={proveedorRif}
                  onChange={(e) => setProveedorRif(e.target.value.toUpperCase())}
                  onBlur={() => setProveedorRif(normalizarRif(proveedorRif) || proveedorRif)}
                  style={{ width: '100%', textTransform: 'uppercase' }}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: '.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Razón Social *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Nombre de la empresa"
                  value={proveedorNombre}
                  onChange={(e) => setProveedorNombre(e.target.value)}
                  style={{ width: '100%' }}
                  required
                />
              </div>
            </div>
          </div>

          {/* Datos del Documento */}
          <div className="card" style={{ padding: '1rem', background: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
            <h3 style={{ margin: '0 0 .75rem 0', fontSize: '.95rem', color: '#cbd5e1' }}>📄 Datos de la Factura</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem', marginBottom: '.6rem' }}>
              <div>
                <label style={{ fontSize: '.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>N° Factura *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="000123"
                  value={numeroFactura}
                  onChange={(e) => setNumeroFactura(e.target.value)}
                  style={{ width: '100%', fontWeight: 700 }}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: '.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>N° Control</label>
                <input
                  type="text"
                  className="input"
                  placeholder="00-00123"
                  value={numeroControl}
                  onChange={(e) => setNumeroControl(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem', marginBottom: '.6rem' }}>
              <div>
                <label style={{ fontSize: '.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Fecha Emisión *</label>
                <input
                  type="date"
                  className="input"
                  value={fechaFactura}
                  onChange={(e) => setFechaFactura(e.target.value)}
                  style={{ width: '100%' }}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: '.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Documento</label>
                <select
                  className="input"
                  value={tipoDocumento}
                  onChange={(e) => setTipoDocumento(e.target.value as TipoDocumentoFactura)}
                  style={{ width: '100%' }}
                >
                  <option value="factura">Factura</option>
                  <option value="nota_debito">Nota de Débito</option>
                  <option value="nota_credito">Nota de Crédito</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '.6rem', marginBottom: '.6rem' }}>
              <div>
                <label style={{ fontSize: '.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Moneda</label>
                <select
                  className="input"
                  value={moneda}
                  onChange={(e) => setMoneda(e.target.value as MonedaFactura)}
                  style={{ width: '100%', fontWeight: 700 }}
                >
                  <option value="USD">USD ($)</option>
                  <option value="Bs">Bs.</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Monto Total *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="input"
                  placeholder="0.00"
                  value={montoTotal}
                  onChange={(e) => {
                    setMontoTotal(e.target.value);
                    if (!baseImponible) setBaseImponible(e.target.value);
                  }}
                  style={{ width: '100%', fontSize: '1.1rem', fontWeight: 700 }}
                  required
                />
              </div>
            </div>

            {moneda === 'Bs' && (
              <div style={{ marginBottom: '.6rem' }}>
                <label style={{ fontSize: '.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Tasa BCV / Ref (opcional)</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  placeholder="Bs. por dólar"
                  value={tasaCambio}
                  onChange={(e) => setTasaCambio(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: '.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Observación o concepto</label>
              <textarea
                className="input"
                rows={2}
                placeholder="Detalle de compra, repuesto o insumo..."
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* Adjuntos: Máximo 4 fotos y 1 o 2 PDF */}
          <div className="card" style={{ padding: '1rem', background: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem' }}>
              <h3 style={{ margin: 0, fontSize: '.95rem', color: '#cbd5e1' }}>📎 Fotos y PDFs de Soporte</h3>
              <div style={{ display: 'flex', gap: '.4rem', fontSize: '.75rem' }}>
                <span style={{ color: fotos.length >= MAX_IMAGENES_FACTURA ? '#f59e0b' : '#38bdf8' }}>
                  📷 {fotos.length}/{MAX_IMAGENES_FACTURA} fotos
                </span>
                <span style={{ color: pdfs.length >= MAX_PDFS_FACTURA ? '#f59e0b' : '#a855f7' }}>
                  📄 {pdfs.length}/{MAX_PDFS_FACTURA} PDFs
                </span>
              </div>
            </div>

            <p style={{ margin: '0 0 .75rem 0', fontSize: '.75rem', color: '#94a3b8' }}>
              Puedes tomar fotos directamente con la cámara del celular o seleccionar hasta 4 fotos y 1 o 2 archivos PDF.
            </p>

            <label
              className="btn btn-ghost"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '.5rem',
                padding: '1rem',
                border: '2px dashed #475569',
                borderRadius: '8px',
                cursor: 'pointer',
                background: '#0f172a',
                color: '#e2e8f0',
                fontWeight: 600,
              }}
            >
              <span>📷 Tomar Foto o Subir PDF</span>
              <input
                type="file"
                multiple
                accept="image/*,application/pdf"
                onChange={handleArchivosSeleccionados}
                style={{ display: 'none' }}
              />
            </label>

            {/* Previsualización de Fotos */}
            {fotos.length > 0 && (
              <div style={{ marginTop: '.75rem' }}>
                <small style={{ color: '#cbd5e1', fontWeight: 600 }}>Fotos cargadas ({fotos.length}):</small>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.5rem', marginTop: '.4rem' }}>
                  {fotos.map((f, idx) => (
                    <div key={idx} style={{ position: 'relative', width: '100%', height: '70px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #475569' }}>
                      <img
                        src={URL.createObjectURL(f)}
                        alt={`Foto ${idx + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <button
                        type="button"
                        onClick={() => eliminarFoto(idx)}
                        style={{
                          position: 'absolute',
                          top: '2px',
                          right: '2px',
                          background: 'rgba(239, 68, 68, 0.9)',
                          border: 'none',
                          color: '#fff',
                          borderRadius: '50%',
                          width: '20px',
                          height: '20px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Previsualización de PDFs */}
            {pdfs.length > 0 && (
              <div style={{ marginTop: '.75rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                <small style={{ color: '#cbd5e1', fontWeight: 600 }}>PDFs cargados ({pdfs.length}):</small>
                {pdfs.map((p, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: '#0f172a',
                      padding: '.4rem .6rem',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                      fontSize: '.8rem',
                    }}
                  >
                    <span style={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      📄 {p.name} ({(p.size / 1024).toFixed(0)} KB)
                    </span>
                    <button
                      type="button"
                      onClick={() => eliminarPdf(idx)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontWeight: 700,
                        padding: '2px 6px',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Botón de Enviar */}
          <button
            type="submit"
            className="btn btn-primary btn-grande"
            disabled={guardando}
            style={{ padding: '1rem', fontSize: '1.05rem', fontWeight: 700, borderRadius: '8px' }}
          >
            {guardando ? '⏳ Guardando y subiendo archivos...' : '💾 Guardar y Compartir Factura'}
          </button>
        </form>
      )}

      {/* ── PANTALLA: LISTA DE FACTURAS ── */}
      {modo === 'lista' && (
        <div>
          {/* Filtros Rápidos */}
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem' }}>
            <input
              type="text"
              className="input"
              placeholder="Buscar por N° factura, proveedor o RIF..."
              value={filtroTexto}
              onChange={(e) => setFiltroTexto(e.target.value)}
              style={{ flex: 1, fontSize: '.85rem' }}
            />
            <select
              className="input"
              value={filtroEmpresa}
              onChange={(e) => setFiltroEmpresa(e.target.value)}
              style={{ width: '130px', fontSize: '.85rem' }}
            >
              <option value="todas">Todas</option>
              {empresas.map((e) => (
                <option key={e.codigo} value={e.codigo}>{e.codigo}</option>
              ))}
            </select>
          </div>

          {cargandoLista ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0' }}>Cargando facturas...</p>
          ) : facturasFiltradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', background: '#1e293b', borderRadius: '8px', color: '#94a3b8' }}>
              <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '.5rem' }}>📭</span>
              <p style={{ margin: 0, fontWeight: 600 }}>No hay facturas cargadas con este criterio.</p>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ marginTop: '1rem' }}
                onClick={() => setModo('carga')}
              >
                ➕ Cargar primera factura
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              {facturasFiltradas.map((f) => {
                const empFiscal = empresas.find((e) => e.codigo === f.empresa.toUpperCase());
                const emoji = EMOJI_ESTADO_FACTURA[f.estado] || '📄';
                const fotosCount = f.archivos.filter((a) => a.tipo === 'imagen').length;
                const pdfsCount = f.archivos.filter((a) => a.tipo === 'pdf').length;

                return (
                  <div
                    key={f.id}
                    className="card"
                    style={{
                      padding: '1rem',
                      background: '#1e293b',
                      borderRadius: '8px',
                      border: '1px solid #334155',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '.5rem',
                    }}
                  >
                    {/* Header de tarjeta */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span
                          style={{
                            fontSize: '.75rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: '#0f172a',
                            color: '#ff8a00',
                            border: '1px solid #ff8a00',
                            display: 'inline-block',
                            marginBottom: '4px',
                          }}
                        >
                          🏢 {f.empresa} {empFiscal?.rif ? `(${empFiscal.rif})` : ''}
                        </span>
                        <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>
                          Factura #{f.numeroFactura}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: '.75rem',
                          fontWeight: 600,
                          padding: '3px 8px',
                          borderRadius: '12px',
                          background: '#0f172a',
                          color: '#e2e8f0',
                          border: '1px solid #475569',
                        }}
                      >
                        {emoji} {ETIQUETA_ESTADO_FACTURA[f.estado] || f.estado}
                      </span>
                    </div>

                    {/* Datos */}
                    <div style={{ fontSize: '.85rem', color: '#cbd5e1' }}>
                      <div style={{ fontWeight: 600 }}>{f.proveedorNombre}</div>
                      <small style={{ color: '#94a3b8' }}>RIF: {f.proveedorRif} · Fecha: {f.fechaFactura}</small>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '.2rem 0' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#38bdf8' }}>
                        {f.moneda === 'USD' ? `$ ${f.montoTotal.toFixed(2)}` : `Bs. ${f.montoTotal.toFixed(2)}`}
                      </div>
                      <div style={{ fontSize: '.75rem', color: '#94a3b8' }}>
                        📎 {fotosCount} foto(s), {pdfsCount} PDF(s)
                      </div>
                    </div>

                    {/* Botones de acción */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '.4rem', marginTop: '.3rem' }}>
                      <button
                        type="button"
                        className="btn btn-wsp"
                        style={{
                          background: '#25D366',
                          color: '#000',
                          fontWeight: 700,
                          fontSize: '.85rem',
                          padding: '.4rem .6rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '.4rem',
                        }}
                        onClick={() => {
                          const txt = mensajeFacturaWhatsapp(f);
                          void compartirFacturaWhatsapp(txt, `Factura ${f.numeroFactura}`);
                        }}
                      >
                        <span>📲 WhatsApp</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '.4rem .6rem', fontSize: '.85rem' }}
                        onClick={() => void abrirDetalle(f)}
                      >
                        🔍 Ver
                      </button>

                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '.4rem .6rem', fontSize: '.85rem', color: '#ef4444' }}
                        title="Eliminar factura"
                        onClick={() => void handleEliminar(f)}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: REGISTRAR NUEVA EMPRESA FISCAL ── */}
      {modalNuevaEmpresaOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setModalNuevaEmpresaOpen(false)}
        >
          <div
            style={{
              background: '#1e293b',
              borderRadius: '10px',
              maxWidth: '440px',
              width: '100%',
              padding: '1.25rem',
              border: '1px solid #475569',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc' }}>
                🏢 Registrar Nueva Empresa
              </h2>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setModalNuevaEmpresaOpen(false)}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: '0 0 1rem', fontSize: '.8rem', color: '#94a3b8' }}>
              Registra el nombre y RIF de la empresa para que sus facturas y retenciones queden identificadas formalmente.
            </p>

            <form onSubmit={handleGuardarNuevaEmpresa} style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              <div>
                <label style={{ fontSize: '.8rem', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                  Razón Social de la Empresa *
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="Ej. Inversiones Mineras C.A."
                  value={nuevaEmpRazon}
                  onChange={(e) => {
                    setNuevaEmpRazon(e.target.value);
                    if (!nuevaEmpCodigo) {
                      const sigla = e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
                      setNuevaEmpCodigo(sigla);
                    }
                  }}
                  style={{ width: '100%' }}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '.8rem', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                  RIF Fiscal *
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="J-12345678-0"
                  value={nuevaEmpRif}
                  onChange={(e) => setNuevaEmpRif(e.target.value.toUpperCase())}
                  onBlur={() => setNuevaEmpRif(normalizarRif(nuevaEmpRif) || nuevaEmpRif)}
                  style={{ width: '100%', textTransform: 'uppercase' }}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '.8rem', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                  Código o sigla corta (opcional)
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="Ej. INVMIN"
                  value={nuevaEmpCodigo}
                  onChange={(e) => setNuevaEmpCodigo(e.target.value.toUpperCase())}
                  style={{ width: '100%', textTransform: 'uppercase' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '.5rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setModalNuevaEmpresaOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={guardandoEmpresa}
                >
                  {guardandoEmpresa ? 'Registrando...' : 'Registrar Empresa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL DETALLE / ADJUNTOS ── */}
      {facturaDetalle && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setFacturaDetalle(null)}
        >
          <div
            style={{
              background: '#1e293b',
              borderRadius: '10px',
              maxWidth: '520px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '1.25rem',
              border: '1px solid #475569',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc' }}>
                Factura #{facturaDetalle.numeroFactura}
              </h2>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setFacturaDetalle(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: '.85rem', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '.4rem', marginBottom: '1rem' }}>
              <div><strong>Empresa:</strong> {facturaDetalle.empresa}</div>
              <div><strong>Proveedor:</strong> {facturaDetalle.proveedorNombre} ({facturaDetalle.proveedorRif})</div>
              <div><strong>Fecha:</strong> {facturaDetalle.fechaFactura}</div>
              <div><strong>Monto:</strong> {facturaDetalle.moneda} {facturaDetalle.montoTotal.toFixed(2)}</div>
              {facturaDetalle.observacion && <div><strong>Observación:</strong> {facturaDetalle.observacion}</div>}
              <div><strong>Estatus:</strong> {ETIQUETA_ESTADO_FACTURA[facturaDetalle.estado] || facturaDetalle.estado}</div>
            </div>

            <h3 style={{ fontSize: '.95rem', color: '#f8fafc', marginBottom: '.6rem' }}>Adjuntos ({facturaDetalle.archivos.length})</h3>

            {cargandoUrls ? (
              <p style={{ color: '#94a3b8', fontSize: '.85rem' }}>Generando enlaces de visualización...</p>
            ) : facturaDetalle.archivos.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '.85rem' }}>Sin adjuntos.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                {facturaDetalle.archivos.map((a) => {
                  const url = urlsAdjuntos[a.id];
                  if (a.tipo === 'imagen') {
                    return (
                      <div key={a.id} style={{ borderRadius: '6px', overflow: 'hidden', border: '1px solid #334155' }}>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt={a.nombre} style={{ width: '100%', maxHeight: '250px', objectFit: 'contain', background: '#0f172a' }} />
                          </a>
                        ) : (
                          <div style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>Cargando foto...</div>
                        )}
                        <div style={{ padding: '4px 8px', fontSize: '.75rem', background: '#0f172a', color: '#94a3b8' }}>
                          📷 {a.nombre}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={a.id}
                      style={{
                        padding: '.6rem',
                        background: '#0f172a',
                        borderRadius: '6px',
                        border: '1px solid #334155',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontSize: '.85rem', color: '#f8fafc' }}>📄 {a.nombre}</span>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
                          Ver PDF
                        </a>
                      ) : (
                        <span style={{ fontSize: '.75rem', color: '#94a3b8' }}>Cargando...</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default RetencionesMovilView;
