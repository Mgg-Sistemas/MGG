/* ============================================================
   MGG · Retenciones · Apartado para Otras Empresas y Facturas Externas (29-10-2026)

   Lleva el control, datos tributarios y retenciones de otras razones sociales
   (Golden Touch, MineriaTs / MTO, etc.) de forma 100% aislada e independiente:
   - Ficha fiscal editable por empresa (RIF, Razón Social, Domicilio Fiscal, etc.)
   - Generación de reportes fiscales en PDF por empresa con membrete formal.
   - Sin alterar ni mezclar el libro fiscal, declaraciones ni comprobantes de
     Mineral Group Guayana C.A.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/lib/toast';
import { normalizarRif, rifValido } from '@/shared/lib/rif';
import {
  listEmpresasFiscales,
  guardarDatosFiscalesEmpresa,
  type DatosFiscalesEmpresa,
} from './empresasFiscales.repository';
import {
  listFacturasExternas,
  actualizarEstadoFacturaExterna,
  actualizarEmpresaFacturaExterna,
  eliminarFacturaExterna,
  urlArchivoFactura,
  type FacturaExterna,
  type EstadoFacturaExterna,
} from './facturasExternas.repository';
import {
  mensajeFacturaWhatsapp,
  compartirFacturaWhatsapp,
  EMOJI_ESTADO_FACTURA,
  ETIQUETA_ESTADO_FACTURA,
} from './mensajeFacturaWhatsapp';
import {
  getSonidoRetencionesHabilitado,
  setSonidoRetencionesHabilitado,
  playSonidoFacturaLlegada,
  useNotificacionesFacturasRetencion,
} from './notificacionesRetencion';
import {
  isNotificacionesSoportadas,
  getEstadoPermisoNotificacion,
  isAvisosPantallaHabilitados,
  setAvisosPantallaHabilitados,
  solicitarPermisoAvisos,
  lanzarAvisoFactura,
} from './notificacionesDispositivo';
import { exportarReporteFiscalFacturasPdf } from './reporteFacturasExternasPdf';

export function OtrasEmpresasView({ canWrite }: { canWrite: boolean }) {
  const [empresas, setEmpresas] = useState<DatosFiscalesEmpresa[]>([]);
  const [empresaFiltro, setEmpresaFiltro] = useState<string>('todas');
  const [estadoFiltro, setEstadoFiltro] = useState<string>('todas');
  const [textoFiltro, setTextoFiltro] = useState<string>('');

  const [facturas, setFacturas] = useState<FacturaExterna[]>([]);
  const [cargando, setCargando] = useState(true);

  // Preferencia de sonido distintivo y avisos en pantalla (100% nativo sin instalación)
  const [sonidoHabilitado, setSonidoHabilitado] = useState(getSonidoRetencionesHabilitado());
  const [avisosActivos, setAvisosActivos] = useState(isAvisosPantallaHabilitados());
  const [permisoNotif, setPermisoNotif] = useState(getEstadoPermisoNotificacion());

  // Modal para ver adjuntos
  const [facturaSeleccionada, setFacturaSeleccionada] = useState<FacturaExterna | null>(null);
  const [urlsAdjuntos, setUrlsAdjuntos] = useState<Record<string, string>>({});
  const [cargandoUrls, setCargandoUrls] = useState(false);

  // Modal para editar Ficha Fiscal de Empresa
  const [modalFichaFiscalOpen, setModalFichaFiscalOpen] = useState(false);
  const [empresaEditando, setEmpresaEditando] = useState<DatosFiscalesEmpresa | null>(null);
  const [guardandoFicha, setGuardandoFicha] = useState(false);

  // Cargar catálogo de empresas fiscales
  const recargarEmpresas = useCallback(async () => {
    try {
      const lista = await listEmpresasFiscales();
      setEmpresas(lista);
    } catch {
      // Fallback
    }
  }, []);

  useEffect(() => {
    void recargarEmpresas();
  }, [recargarEmpresas]);

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      const data = await listFacturasExternas();
      setFacturas(data);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al cargar facturas', 'error');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  // Escuchar notificaciones y reproducir sonido distintivo
  useNotificacionesFacturasRetencion({
    activo: true,
    onNuevaFactura: (ev) => {
      toast(`🧾 Nueva factura recibida: #${ev.numeroFactura} (${ev.empresa} · ${ev.proveedorNombre})`, 'info');
      void recargar();
    },
    onCambioEstatus: (ev) => {
      toast(`📌 Factura #${ev.numeroFactura} cambió a ${ETIQUETA_ESTADO_FACTURA[ev.estado] || ev.estado}`, 'info');
      void recargar();
    },
  });

  function toggleSonido() {
    const nuevo = !sonidoHabilitado;
    setSonidoHabilitado(nuevo);
    setSonidoRetencionesHabilitado(nuevo);
    if (nuevo) playSonidoFacturaLlegada();
  }

  async function handleToggleAvisosPantalla() {
    if (!isNotificacionesSoportadas()) {
      toast('Este navegador no soporta notificaciones nativas en pantalla.', 'info');
      return;
    }

    const estado = getEstadoPermisoNotificacion();
    if (estado === 'denied') {
      toast('Las notificaciones están bloqueadas en este navegador. Toca el icono de candado o configuración junto a la URL para permitirlas.', 'warning');
      setPermisoNotif('denied');
      return;
    }

    if (estado !== 'granted') {
      const res = await solicitarPermisoAvisos();
      setPermisoNotif(res);
      if (res === 'granted') {
        setAvisosActivos(true);
        toast('✅ Avisos en pantalla activados. Recibirás alertas y vibración al recibir facturas.', 'success');
        lanzarAvisoFactura(
          { empresa: 'Retenciones MGG', proveedorNombre: 'Avisos activados con éxito', moneda: 'USD', montoTotal: 0 },
          { conSonido: false }
        );
      } else if (res === 'denied') {
        toast('Permiso denegado por el navegador.', 'warning');
      }
      return;
    }

    const nuevo = !avisosActivos;
    setAvisosPantallaHabilitados(nuevo);
    setAvisosActivos(nuevo);
    toast(nuevo ? 'Avisos en pantalla activados 📲' : 'Avisos en pantalla desactivados 📴', 'info');
  }

  async function handleCambiarEstado(f: FacturaExterna, nuevoEstado: EstadoFacturaExterna) {
    if (!canWrite) {
      toast('No tienes permiso de escritura en retenciones.', 'error');
      return;
    }
    try {
      await actualizarEstadoFacturaExterna(f.id, nuevoEstado);
      toast(`Estatus de factura #${f.numeroFactura} actualizado a ${ETIQUETA_ESTADO_FACTURA[nuevoEstado]}`, 'success');
      setFacturas((prev) => prev.map((x) => (x.id === f.id ? { ...x, estado: nuevoEstado } : x)));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al cambiar estatus', 'error');
    }
  }

  async function handleReasignarEmpresa(f: FacturaExterna) {
    if (!canWrite) return;
    const actual = f.empresa;
    const nueva = window.prompt(`Indica el código de la nueva empresa para la factura #${f.numeroFactura} (ej. GOLDEN, MINERIATS):`, actual);
    if (!nueva || nueva.trim().toUpperCase() === actual.toUpperCase()) return;

    try {
      await actualizarEmpresaFacturaExterna(f.id, nueva);
      toast(`Factura #${f.numeroFactura} reasignada a ${nueva.toUpperCase()}`, 'success');
      setFacturas((prev) => prev.map((x) => (x.id === f.id ? { ...x, empresa: nueva.toUpperCase() } : x)));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al reasignar empresa', 'error');
    }
  }

  async function handleEliminar(f: FacturaExterna) {
    if (!canWrite) return;
    if (!window.confirm(`¿Confirmas eliminar la factura ${f.numeroFactura} de ${f.proveedorNombre}?`)) return;

    try {
      await eliminarFacturaExterna(f.id);
      toast('Factura eliminada del buzón.', 'info');
      setFacturas((prev) => prev.filter((x) => x.id !== f.id));
      if (facturaSeleccionada?.id === f.id) setFacturaSeleccionada(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al eliminar', 'error');
    }
  }

  async function verAdjuntos(f: FacturaExterna) {
    setFacturaSeleccionada(f);
    setUrlsAdjuntos({});
    if (!f.archivos.length) return;

    setCargandoUrls(true);
    const map: Record<string, string> = {};
    for (const a of f.archivos) {
      try {
        map[a.id] = await urlArchivoFactura(a.path);
      } catch {
        // Ignorar fallo puntual
      }
    }
    setUrlsAdjuntos(map);
    setCargandoUrls(false);
  }

  // Filtrado
  const facturasFiltradas = useMemo(() => {
    return facturas.filter((f) => {
      if (empresaFiltro !== 'todas' && f.empresa.toUpperCase() !== empresaFiltro.toUpperCase()) {
        return false;
      }
      if (estadoFiltro !== 'todas' && f.estado !== estadoFiltro) {
        return false;
      }
      if (textoFiltro.trim()) {
        const q = textoFiltro.trim().toLowerCase();
        const m =
          f.numeroFactura.toLowerCase().includes(q) ||
          f.proveedorNombre.toLowerCase().includes(q) ||
          f.proveedorRif.toLowerCase().includes(q) ||
          f.empresa.toLowerCase().includes(q);
        if (!m) return false;
      }
      return true;
    });
  }, [facturas, empresaFiltro, estadoFiltro, textoFiltro]);

  // Totales
  const totales = useMemo(() => {
    let usd = 0;
    let bs = 0;
    for (const f of facturasFiltradas) {
      if (f.moneda === 'USD') usd += f.montoTotal;
      else bs += f.montoTotal;
    }
    return { usd, bs, total: facturasFiltradas.length };
  }, [facturasFiltradas]);

  // Exportar Reporte Fiscal PDF
  async function handleExportarReporte() {
    const cod = empresaFiltro !== 'todas' ? empresaFiltro.toUpperCase() : 'TODAS';
    const emp = empresas.find((e) => e.codigo === cod) || {
      codigo: cod,
      razonSocial: cod === 'TODAS' ? 'CONSOLIDADO DE OTRAS EMPRESAS' : cod,
      rif: '',
      direccionFiscal: null,
      ciudad: null,
      municipio: null,
      estado: null,
      esContribuyenteEspecial: false,
      esAgenteRetencionIva: false,
      pctIvaGeneral: 75,
      pctIvaEspecial: 100,
      activa: true,
    };

    try {
      await exportarReporteFiscalFacturasPdf(
        emp,
        facturasFiltradas,
        `Filtro: ${empresaFiltro} · Estatus: ${estadoFiltro}`
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al exportar reporte', 'error');
    }
  }

  // Guardar cambios de la ficha fiscal
  async function handleGuardarFichaFiscal(e: React.FormEvent) {
    e.preventDefault();
    if (!empresaEditando) return;

    setGuardandoFicha(true);
    try {
      await guardarDatosFiscalesEmpresa(empresaEditando);
      toast(`Datos fiscales de ${empresaEditando.codigo} actualizados.`, 'success');
      await recargarEmpresas();
      setModalFichaFiscalOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al guardar datos fiscales', 'error');
    } finally {
      setGuardandoFicha(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '.5rem' }}>
      {/* ── Banner explicativo y control de campana ── */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          padding: '.85rem 1.25rem',
          background: 'linear-gradient(90deg, #1e293b 0%, #0f172a 100%)',
          borderLeft: '4px solid #f59e0b',
          borderRadius: '8px',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span>🏢 Retenciones y Facturas de Otras Empresas</span>
            <span style={{ fontSize: '.75rem', padding: '2px 8px', borderRadius: '12px', background: '#334155', color: '#cbd5e1' }}>
              Aislado de MGG
            </span>
          </div>
          <small style={{ color: '#94a3b8', display: 'block', marginTop: '2px' }}>
            Control y seguimiento de compras para Golden Touch, MineriaTs / MTO y otras razones sociales, sin alterar los libros ni declaraciones de Mineral Group Guayana.
          </small>
        </div>

        {/* Sonido distintivo y acciones */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ color: '#ff8a00', border: '1px solid #ff8a00' }}
            onClick={() => {
              const inicial = empresas[0] || null;
              setEmpresaEditando(inicial ? { ...inicial } : null);
              setModalFichaFiscalOpen(true);
            }}
          >
            ⚙ Ficha Fiscal de Empresas
          </button>

          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={handleExportarReporte}
            title="Generar reporte formal en PDF para esta empresa"
          >
            📄 Reporte PDF
          </button>

          <button
            type="button"
            className={`btn btn-sm ${sonidoHabilitado ? 'btn-ghost' : 'btn-ghost muted'}`}
            onClick={toggleSonido}
            title={sonidoHabilitado ? 'Sonido distintivo de facturas activado' : 'Sonido silenciado'}
            style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}
          >
            <span>{sonidoHabilitado ? '🔔 Campana: ON' : '🔕 Campana: Silenciada'}</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${avisosActivos && permisoNotif === 'granted' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={handleToggleAvisosPantalla}
            title={
              permisoNotif === 'denied'
                ? 'Avisos bloqueados en la configuración de este navegador (revisa el candado de la URL)'
                : avisosActivos && permisoNotif === 'granted'
                ? 'Avisos en pantalla y vibración móvil activados'
                : 'Activar avisos nativos en pantalla y vibración del teléfono (sin descargas ni instalaciones)'
            }
          >
            {permisoNotif === 'denied'
              ? '⚠️ Avisos: Bloqueados'
              : avisosActivos && permisoNotif === 'granted'
              ? '📲 Avisos Pantalla: ON'
              : '📴 Avisos Pantalla: OFF'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={playSonidoFacturaLlegada}
            title="Probar sonido distintivo fiscal (arpegio brillante)"
          >
            🔊 Probar
          </button>
        </div>
      </div>

      {/* ── Filtros y selector de empresa ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'center' }}>
        {/* Selector de empresa */}
        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '.85rem', color: '#94a3b8', fontWeight: 600 }}>Empresa:</span>
          <button
            type="button"
            className={`btn btn-sm ${empresaFiltro === 'todas' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setEmpresaFiltro('todas')}
          >
            Todas ({facturas.length})
          </button>
          {empresas.map((e) => {
            const count = facturas.filter((f) => f.empresa.toUpperCase() === e.codigo.toUpperCase()).length;
            const activa = empresaFiltro.toUpperCase() === e.codigo.toUpperCase();
            return (
              <button
                key={e.codigo}
                type="button"
                className={`btn btn-sm ${activa ? 'btn-primary' : 'btn-ghost'}`}
                style={{ border: `1px solid ${activa ? '#ff8a00' : '#475569'}` }}
                onClick={() => setEmpresaFiltro(e.codigo)}
              >
                <span>🏢 {e.codigo}</span>
                <span style={{ opacity: 0.8, fontSize: '.75rem', marginLeft: '4px' }}>({count})</span>
              </button>
            );
          })}
        </div>

        {/* Estatus */}
        <select
          className="input"
          value={estadoFiltro}
          onChange={(e) => setEstadoFiltro(e.target.value)}
          style={{ width: '150px', fontSize: '.85rem' }}
        >
          <option value="todas">Todos los estatus</option>
          <option value="recibida">🟡 Recibida</option>
          <option value="en_revision">🔵 En revisión</option>
          <option value="procesada">🟢 Procesada</option>
          <option value="retenida">🟣 Retenida</option>
          <option value="rechazada">🔴 Rechazada</option>
          <option value="anulada">⚪ Anulada</option>
        </select>

        {/* Buscador */}
        <input
          type="text"
          className="input"
          placeholder="Buscar por N° factura, proveedor o RIF..."
          value={textoFiltro}
          onChange={(e) => setTextoFiltro(e.target.value)}
          style={{ flex: 1, minWidth: '200px', fontSize: '.85rem' }}
        />

        <button type="button" className="btn btn-ghost btn-sm" onClick={recargar} title="Refrescar buzón">
          🔄 Recargar
        </button>
      </div>

      {/* ── KPIs Rápidos ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.75rem' }}>
        <div className="card" style={{ padding: '.75rem 1rem', background: '#1e293b', borderRadius: '6px' }}>
          <small style={{ color: '#94a3b8' }}>Total Facturas</small>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>{totales.total}</div>
        </div>
        <div className="card" style={{ padding: '.75rem 1rem', background: '#1e293b', borderRadius: '6px' }}>
          <small style={{ color: '#94a3b8' }}>Monto Total ($ USD)</small>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#38bdf8' }}>$ {totales.usd.toFixed(2)}</div>
        </div>
        <div className="card" style={{ padding: '.75rem 1rem', background: '#1e293b', borderRadius: '6px' }}>
          <small style={{ color: '#94a3b8' }}>Monto Total (Bs.)</small>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#a855f7' }}>Bs. {totales.bs.toFixed(2)}</div>
        </div>
      </div>

      {/* ── Tabla de facturas ── */}
      {cargando ? (
        <p style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>Cargando facturas de otras empresas...</p>
      ) : facturasFiltradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', background: '#1e293b', borderRadius: '8px', color: '#94a3b8' }}>
          <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '.5rem' }}>📭</span>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay facturas registradas para esta selección.</p>
          <small>Las facturas cargadas desde el celular aparecerán aquí con su soporte.</small>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.88rem' }}>
            <thead>
              <tr>
                <th>Empresa</th>
                <th>N° Factura</th>
                <th>Proveedor</th>
                <th>Fecha</th>
                <th style={{ textAlign: 'right' }}>Monto Total</th>
                <th>Estatus</th>
                <th>Adjuntos</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {facturasFiltradas.map((f) => {
                const empFiscal = empresas.find((e) => e.codigo === f.empresa.toUpperCase());
                const emoji = EMOJI_ESTADO_FACTURA[f.estado] || '📄';
                const fotos = f.archivos.filter((a) => a.tipo === 'imagen').length;
                const pdfs = f.archivos.filter((a) => a.tipo === 'pdf').length;

                return (
                  <tr key={f.id}>
                    <td>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '.75rem',
                          fontWeight: 700,
                          background: '#0f172a',
                          color: '#ff8a00',
                          border: '1px solid #ff8a00',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        🏢 {f.empresa} {empFiscal?.rif ? `(${empFiscal.rif})` : ''}
                      </span>
                    </td>
                    <td>
                      <strong>#{f.numeroFactura}</strong>
                      {f.numeroControl && <div style={{ fontSize: '.75rem', color: '#94a3b8' }}>Ctrl: {f.numeroControl}</div>}
                    </td>
                    <td>
                      <div>{f.proveedorNombre}</div>
                      <small style={{ color: '#94a3b8' }}>{f.proveedorRif}</small>
                    </td>
                    <td>{f.fechaFactura}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#38bdf8' }}>
                      {f.moneda === 'USD' ? `$ ${f.montoTotal.toFixed(2)}` : `Bs. ${f.montoTotal.toFixed(2)}`}
                    </td>
                    <td>
                      <select
                        className="input"
                        value={f.estado}
                        disabled={!canWrite}
                        onChange={(e) => void handleCambiarEstado(f, e.target.value as EstadoFacturaExterna)}
                        style={{ fontSize: '.8rem', padding: '3px 6px' }}
                      >
                        <option value="recibida">🟡 Recibida</option>
                        <option value="en_revision">🔵 En revisión</option>
                        <option value="procesada">🟢 Procesada</option>
                        <option value="retenida">🟣 Retenida</option>
                        <option value="rechazada">🔴 Rechazada</option>
                        <option value="anulada">⚪ Anulada</option>
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: '.75rem', padding: '2px 8px' }}
                        onClick={() => void verAdjuntos(f)}
                      >
                        📎 {fotos} foto(s), {pdfs} PDF(s)
                      </button>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '.3rem' }}>
                        {/* Botón WhatsApp */}
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ background: '#25D366', color: '#000', fontWeight: 700, padding: '3px 8px', fontSize: '.75rem' }}
                          title="Enviar resumen por WhatsApp"
                          onClick={() => {
                            const txt = mensajeFacturaWhatsapp(f);
                            void compartirFacturaWhatsapp(txt, `Factura ${f.numeroFactura}`);
                          }}
                        >
                          📲 WhatsApp
                        </button>

                        {/* Reasignar empresa */}
                        {canWrite && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: '.75rem', padding: '3px 6px' }}
                            title="Reasignar empresa"
                            onClick={() => void handleReasignarEmpresa(f)}
                          >
                            ✏ Empresa
                          </button>
                        )}

                        {/* Eliminar */}
                        {canWrite && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ color: '#ef4444', fontSize: '.75rem', padding: '3px 6px' }}
                            title="Eliminar factura"
                            onClick={() => void handleEliminar(f)}
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── MODAL: FICHA FISCAL DE EMPRESAS ── */}
      {modalFichaFiscalOpen && empresaEditando && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setModalFichaFiscalOpen(false)}
        >
          <div
            style={{
              background: '#1e293b',
              borderRadius: '10px',
              maxWidth: '650px',
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              padding: '1.5rem',
              border: '1px solid #475569',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#f8fafc' }}>
                  ⚙ Ficha Fiscal de Empresa ({empresaEditando.codigo})
                </h2>
                <small style={{ color: '#94a3b8' }}>Parámetros tributarios para emisión de comprobantes y reportes SENIAT</small>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setModalFichaFiscalOpen(false)}
              >
                ✕
              </button>
            </div>

            {/* Selector de empresa a editar */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                Selecciona la empresa a configurar:
              </label>
              <select
                className="input"
                value={empresaEditando.codigo}
                onChange={(e) => {
                  const encontrada = empresas.find((x) => x.codigo === e.target.value);
                  if (encontrada) setEmpresaEditando({ ...encontrada });
                }}
                style={{ width: '100%', fontWeight: 700 }}
              >
                {empresas.map((e) => (
                  <option key={e.codigo} value={e.codigo}>
                    {e.codigo} — {e.razonSocial} {e.rif ? `(${e.rif})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <form onSubmit={handleGuardarFichaFiscal} style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '.75rem' }}>
                <div>
                  <label style={{ fontSize: '.8rem', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                    Razón Social Completa *
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={empresaEditando.razonSocial}
                    onChange={(e) => setEmpresaEditando({ ...empresaEditando, razonSocial: e.target.value })}
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
                    value={empresaEditando.rif}
                    onChange={(e) => setEmpresaEditando({ ...empresaEditando, rif: e.target.value.toUpperCase() })}
                    onBlur={() => {
                      const n = normalizarRif(empresaEditando.rif);
                      if (n) setEmpresaEditando({ ...empresaEditando, rif: n });
                    }}
                    style={{ width: '100%', textTransform: 'uppercase' }}
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '.8rem', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                  Domicilio Fiscal / Dirección
                </label>
                <input
                  type="text"
                  className="input"
                  value={empresaEditando.direccionFiscal || ''}
                  onChange={(e) => setEmpresaEditando({ ...empresaEditando, direccionFiscal: e.target.value })}
                  placeholder="Av., Edif., Local, Piso..."
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.75rem' }}>
                <div>
                  <label style={{ fontSize: '.8rem', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                    Ciudad
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={empresaEditando.ciudad || ''}
                    onChange={(e) => setEmpresaEditando({ ...empresaEditando, ciudad: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '.8rem', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                    Municipio
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={empresaEditando.municipio || ''}
                    onChange={(e) => setEmpresaEditando({ ...empresaEditando, municipio: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '.8rem', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                    Estado
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={empresaEditando.estado || ''}
                    onChange={(e) => setEmpresaEditando({ ...empresaEditando, estado: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
                <div>
                  <label style={{ fontSize: '.8rem', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                    Teléfono
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={empresaEditando.telefono || ''}
                    onChange={(e) => setEmpresaEditando({ ...empresaEditando, telefono: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '.8rem', color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
                    Correo de Contacto
                  </label>
                  <input
                    type="email"
                    className="input"
                    value={empresaEditando.email || ''}
                    onChange={(e) => setEmpresaEditando({ ...empresaEditando, email: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Checks Tributarios */}
              <div style={{ padding: '.85rem', background: '#0f172a', borderRadius: '6px', border: '1px solid #334155' }}>
                <h4 style={{ margin: '0 0 .5rem 0', fontSize: '.85rem', color: '#ff8a00' }}>
                  ⚖ Régimen de Retención de IVA
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', fontSize: '.85rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={empresaEditando.esContribuyenteEspecial}
                      onChange={(e) => setEmpresaEditando({ ...empresaEditando, esContribuyenteEspecial: e.target.checked })}
                    />
                    <span>¿Designada Contribuyente Especial por el SENIAT?</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={empresaEditando.esAgenteRetencionIva}
                      onChange={(e) => setEmpresaEditando({ ...empresaEditando, esAgenteRetencionIva: e.target.checked })}
                    />
                    <span>¿Designada Agente de Retención de IVA (Providencia SNAT/2025/000054)?</span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '.75rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setModalFichaFiscalOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={guardandoFicha}
                >
                  {guardandoFicha ? 'Guardando...' : '💾 Guardar Ficha Fiscal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal de Adjuntos ── */}
      {facturaSeleccionada && (
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
          onClick={() => setFacturaSeleccionada(null)}
        >
          <div
            style={{
              background: '#1e293b',
              borderRadius: '10px',
              maxWidth: '600px',
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
                Soportes · Factura #{facturaSeleccionada.numeroFactura} ({facturaSeleccionada.empresa})
              </h2>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setFacturaSeleccionada(null)}
              >
                ✕
              </button>
            </div>

            {cargandoUrls ? (
              <p style={{ color: '#94a3b8' }}>Generando enlaces seguros para visualización...</p>
            ) : facturaSeleccionada.archivos.length === 0 ? (
              <p style={{ color: '#94a3b8' }}>Esta factura no contiene archivos adjuntos.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {facturaSeleccionada.archivos.map((a) => {
                  const url = urlsAdjuntos[a.id];
                  if (a.tipo === 'imagen') {
                    return (
                      <div key={a.id} style={{ borderRadius: '6px', overflow: 'hidden', border: '1px solid #334155' }}>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt={a.nombre} style={{ width: '100%', maxHeight: '350px', objectFit: 'contain', background: '#0f172a' }} />
                          </a>
                        ) : (
                          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Cargando foto...</div>
                        )}
                        <div style={{ padding: '6px 10px', fontSize: '.8rem', background: '#0f172a', color: '#cbd5e1' }}>
                          📷 {a.nombre}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={a.id}
                      style={{
                        padding: '.75rem',
                        background: '#0f172a',
                        borderRadius: '6px',
                        border: '1px solid #334155',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontSize: '.9rem', color: '#f8fafc' }}>📄 {a.nombre}</span>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
                          Abrir PDF ↗
                        </a>
                      ) : (
                        <span style={{ fontSize: '.8rem', color: '#94a3b8' }}>Generando enlace...</span>
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
