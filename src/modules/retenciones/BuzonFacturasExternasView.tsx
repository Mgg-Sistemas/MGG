/* ============================================================
   MGG · Retenciones · Buzón de Facturas Externas y Multi-Empresa
   Alineado 1:1 con Golden Touch BuzonFacturasExternasView.tsx

   Apartado para gestionar facturas externas de MGG y otras
   empresas (Golden Touch, Minería TS / MTO, etc.) sin mezclar las retenciones oficiales.
   Incluye gestión de Ficha Fiscal completa por empresa, alertas sonoras
   independientes en tiempo real, notificaciones nativas y reportes por WhatsApp.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { toast } from '@/shared/ui/Toast';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { num, date, money } from '@/shared/lib/format';
import { rifEmpresaParaGuardar } from '@/modules/libroFiscal/parametrosEmpresa';
import {
  listEmpresasReceptoras, guardarEmpresaReceptora, eliminarEmpresaReceptora,
  type EmpresaReceptora,
} from './empresasReceptoras.repository';
import {
  listFacturasBuzon, actualizarEstatusFacturaBuzon, eliminarFacturaBuzon,
  urlPublicaAdjunto, type FacturaBuzon, type EstatusFacturaBuzon,
} from './facturasBuzon.repository';
import {
  reproducirSonidoEstatusFactura,
  isSonidoRetencionesHabilitado, toggleSonidoRetenciones,
} from './soundRetenciones';
import {
  isNotificacionesSoportadas,
  getEstadoPermisoNotificacion,
  isAvisosPantallaHabilitados,
  setAvisosPantallaHabilitados,
  solicitarPermisoAvisos,
  lanzarAvisoFactura,
} from './notificacionesDispositivo';
import { mensajeFacturaExterna } from './mensajeFacturaExterna';

const ESTATUS_OPCIONES: { key: EstatusFacturaBuzon; label: string; icono: string; color: string }[] = [
  { key: 'recibida', label: 'Recibida', icono: '📥', color: '#2563eb' },
  { key: 'en_revision', label: 'En Revisión', icono: '🔍', color: '#d97706' },
  { key: 'retenida', label: 'Retenida', icono: '✅', color: '#059669' },
  { key: 'descartada', label: 'Descartada', icono: '⚪', color: '#6b7280' },
];

export function BuzonFacturasExternasView() {
  const { can } = usePermissions();
  const canWrite = can('retenciones', 'escritura');

  const [empresas, setEmpresas] = useState<EmpresaReceptora[]>([]);
  const [facturas, setFacturas] = useState<FacturaBuzon[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [empresaFiltro, setEmpresaFiltro] = useState<string>('todas');
  const [estatusFiltro, setEstatusFiltro] = useState<string>('todas');
  const [busqueda, setBusqueda] = useState('');

  // Modales
  const [detalle, setDetalle] = useState<FacturaBuzon | null>(null);
  const [whatsappFac, setWhatsappFac] = useState<FacturaBuzon | null>(null);
  const [facturaABorrar, setFacturaABorrar] = useState<FacturaBuzon | null>(null);
  const [modalEmpresas, setModalEmpresas] = useState(false);
  const [empresaFichaEditar, setEmpresaFichaEditar] = useState<EmpresaReceptora | null>(null);
  const [empresaReporte, setEmpresaReporte] = useState<EmpresaReceptora | null>(null);

  // Sonido y avisos en pantalla independientes de retenciones
  const [sonidoActivo, setSonidoActivo] = useState(isSonidoRetencionesHabilitado());
  const [avisosActivos, setAvisosActivos] = useState(isAvisosPantallaHabilitados());
  const [permisoNotif, setPermisoNotif] = useState(getEstadoPermisoNotificacion());
  const prevCountRef = useRef<number | null>(null);

  const cargarDatos = useCallback(async (reproducirSonido = false) => {
    try {
      const [empr, facs] = await Promise.all([
        listEmpresasReceptoras(),
        listFacturasBuzon(),
      ]);
      setEmpresas(empr);

      // Si llegaron nuevas facturas desde el último render, sonar arpegio y alertar en pantalla/móvil
      if (reproducirSonido && prevCountRef.current !== null && facs.length > prevCountRef.current) {
        const facMasReciente = facs[0];
        lanzarAvisoFactura(facMasReciente, { conSonido: true });
        toast('🔔 Nueva factura recibida en el buzón', 'info');
      }
      prevCountRef.current = facs.length;
      setFacturas(facs);
    } catch (e) {
      console.warn('Error al cargar buzón de facturas:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargarDatos(false);
  }, [cargarDatos]);

  // Listener Realtime: escucha llegada o cambios en facturas externas
  useRealtime(['retencion_facturas_externas', 'retencion_empresas_receptoras'], () => {
    void cargarDatos(true);
  });

  const handleToggleSonido = () => {
    const nuevo = toggleSonidoRetenciones();
    setSonidoActivo(nuevo);
    toast(nuevo ? 'Sonido de facturas activado 🔔' : 'Sonido silenciado 🔕', 'info');
  };

  const handleToggleAvisosPantalla = async () => {
    if (!isNotificacionesSoportadas()) {
      toast('Este navegador no soporta notificaciones nativas en pantalla.', 'info');
      return;
    }

    const estado = getEstadoPermisoNotificacion();
    if (estado === 'denied') {
      toast('Las notificaciones están bloqueadas en este navegador. Toca el candado junto a la URL para permitirlas.', 'warning');
      return;
    }

    if (estado === 'default') {
      const res = await solicitarPermisoAvisos();
      setPermisoNotif(res);
      if (res === 'granted') {
        setAvisosPantallaHabilitados(true);
        setAvisosActivos(true);
        toast('Avisos nativos activados. Recibirás alertas y vibración al recibir facturas.', 'success');
        lanzarAvisoFactura(
          { empresaNombre: 'Retenciones MGG', proveedorNombre: 'Avisos activados con éxito', moneda: 'USD', montoTotal: 0 },
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
  };

  const handleCambiarEstatus = async (facId: string, nuevoEstatus: EstatusFacturaBuzon) => {
    try {
      await actualizarEstatusFacturaBuzon(facId, nuevoEstatus);
      reproducirSonidoEstatusFactura();
      toast(`Estatus actualizado a ${nuevoEstatus}`, 'success');
      void cargarDatos(false);
      if (detalle && detalle.id === facId) {
        setDetalle((prev) => prev ? { ...prev, estatus: nuevoEstatus } : null);
      }
    } catch (e) {
      toast('Error al actualizar estatus: ' + String(e), 'error');
    }
  };

  // Filtrado
  const facturasFiltradas = useMemo(() => {
    return facturas.filter((f) => {
      if (empresaFiltro !== 'todas' && f.empresa_receptora_id !== empresaFiltro) return false;
      if (estatusFiltro !== 'todas' && f.estatus !== estatusFiltro) return false;
      if (busqueda.trim()) {
        const q = busqueda.toLowerCase().trim();
        const texto = `${f.proveedor_nombre} ${f.proveedor_rif || ''} ${f.numero_factura} ${f.numero_control || ''} ${f.empresa_nombre || ''} ${f.descripcion || ''}`.toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    });
  }, [facturas, empresaFiltro, estatusFiltro, busqueda]);

  // Totales independientes por empresa (MGG vs Otras Empresas)
  const totales = useMemo(() => {
    let totalMggUsd = 0;
    let totalMggBs = 0;
    let totalOtrasUsd = 0;
    let totalOtrasBs = 0;
    let recibidasCount = 0;
    let retenidasCount = 0;

    facturas.forEach((f) => {
      const esMgg = (f.empresa_nombre || '').toLowerCase().includes('mgg') || (f.empresa_nombre || '').toLowerCase().includes('mineral');
      const montoUsd = Number(f.moneda === 'USD' ? (f.monto_total ?? 0) : (f.monto_usd ?? 0));
      const montoBs = Number(f.moneda === 'Bs' ? (f.monto_total ?? 0) : (f.monto_bs ?? 0));

      if (esMgg) {
        totalMggUsd += montoUsd;
        totalMggBs += montoBs;
      } else {
        totalOtrasUsd += montoUsd;
        totalOtrasBs += montoBs;
      }

      if (f.estatus === 'recibida') recibidasCount++;
      if (f.estatus === 'retenida') retenidasCount++;
    });

    return {
      totalMggUsd,
      totalMggBs,
      totalOtrasUsd,
      totalOtrasBs,
      recibidasCount,
      retenidasCount,
      totalCount: facturas.length,
    };
  }, [facturas]);

  const empresaSeleccionadaActual = useMemo(() => {
    if (empresaFiltro === 'todas') return null;
    return empresas.find((e) => e.id === empresaFiltro) || null;
  }, [empresas, empresaFiltro]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Barra de título y acciones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📬 Buzón de Facturas & Multi-Empresa</span>
            {totales.recibidasCount > 0 && (
              <span className="buzon-badge-alerta" title={`${totales.recibidasCount} facturas recién recibidas`}>
                {totales.recibidasCount} nuevas
              </span>
            )}
          </h2>
          <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>
            Facturas externas capturadas fuera de oficina. Ficha fiscal completa por empresa (MGG, Golden Touch, Minería TS / MTO) sin alterar el libro fiscal oficial.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`buzon-audio-toggle ${sonidoActivo ? 'activo' : ''}`}
            onClick={handleToggleSonido}
            title={sonidoActivo ? 'Sonido de avisos activo (arpegio campana)' : 'Sonido silenciado'}
          >
            {sonidoActivo ? '🔔 Sonido: Activo' : '🔕 Sonido: Silenciado'}
          </button>

          <button
            type="button"
            className={`buzon-audio-toggle ${avisosActivos && permisoNotif === 'granted' ? 'activo' : ''}`}
            onClick={handleToggleAvisosPantalla}
            title={
              permisoNotif === 'denied'
                ? 'Avisos bloqueados en la configuración de este navegador (revisa el icono de candado)'
                : avisosActivos && permisoNotif === 'granted'
                ? 'Avisos en pantalla y vibración móvil activados'
                : 'Activar avisos nativos en pantalla y vibración del teléfono'
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
            className="btn sm"
            onClick={() => setModalEmpresas(true)}
            title="Administrar catálogo y fichas fiscales de empresas receptoras"
          >
            🏢 Empresas & Fichas Fiscales ({empresas.length})
          </button>

          {empresaSeleccionadaActual && (
            <button
              type="button"
              className="btn sm"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}
              onClick={() => setEmpresaReporte(empresaSeleccionadaActual)}
              title={`Generar reporte fiscal de ${empresaSeleccionadaActual.nombreCorto || empresaSeleccionadaActual.nombre}`}
            >
              📊 Reporte {empresaSeleccionadaActual.nombreCorto || 'Empresa'}
            </button>
          )}

          <Link
            to="/app/retenciones/telefono"
            className="btn sm primario"
            style={{ textDecoration: 'none' }}
          >
            📱 Abrir Vista Teléfono
          </Link>
        </div>
      </div>

      {/* Tarjetas de Resumen: MGG vs Otras Empresas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
        <div style={{ background: 'var(--surface-2)', padding: '0.85rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
          <small className="muted" style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem' }}>
            🏢 Mineral Group Guayana C.A. (MGG)
          </small>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary-2)', marginTop: '0.2rem' }}>
            {money(totales.totalMggUsd, 'USD')}
          </div>
          <small className="muted" style={{ fontSize: '0.8rem' }}>
            ≈ {money(totales.totalMggBs, 'Bs')}
          </small>
        </div>

        <div style={{ background: 'var(--surface-2)', padding: '0.85rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
          <small className="muted" style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem' }}>
            🏭 Otras Empresas (Golden Touch, Minería TS, etc.)
          </small>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#eab308', marginTop: '0.2rem' }}>
            {money(totales.totalOtrasUsd, 'USD')}
          </div>
          <small className="muted" style={{ fontSize: '0.8rem' }}>
            ≈ {money(totales.totalOtrasBs, 'Bs')}
          </small>
        </div>

        <div style={{ background: 'var(--surface-2)', padding: '0.85rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
          <small className="muted" style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem' }}>
            📊 Estatus de Recepción
          </small>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.35rem' }}>
            <div>
              <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#d97706' }}>{totales.recibidasCount}</span>
              <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>Por revisar</small>
            </div>
            <div>
              <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#059669' }}>{totales.retenidasCount}</span>
              <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>Retenidas</small>
            </div>
            <div>
              <span style={{ fontSize: '1.2rem', fontWeight: 800 }}>{totales.totalCount}</span>
              <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>Total buzón</small>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="buzon-desktop-filtros">
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)' }}>EMPRESA:</span>
            <select
              className="select sm"
              value={empresaFiltro}
              onChange={(e) => setEmpresaFiltro(e.target.value)}
            >
              <option value="todas">Todas las empresas ({facturas.length})</option>
              {empresas.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.nombreCorto || emp.nombre} ({facturas.filter((f) => f.empresa_receptora_id === emp.id).length})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)' }}>ESTATUS:</span>
            <select
              className="select sm"
              value={estatusFiltro}
              onChange={(e) => setEstatusFiltro(e.target.value)}
            >
              <option value="todas">Todos los estatus</option>
              {ESTATUS_OPCIONES.map((op) => (
                <option key={op.key} value={op.key}>
                  {op.icono} {op.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ minWidth: '220px' }}>
          <input
            type="search"
            className="input sm"
            style={{ width: '100%' }}
            placeholder="🔍 Buscar proveedor, RIF, factura..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      {/* Tabla de Facturas */}
      {loading ? (
        <div className="p-8 muted text-center">Cargando buzón...</div>
      ) : facturasFiltradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', background: 'var(--surface-1)', borderRadius: 'var(--r-lg)', border: '1px dashed var(--border)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📭</div>
          <p style={{ fontWeight: 700, margin: '0 0 0.4rem' }}>No hay facturas con los filtros seleccionados</p>
          <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
            Utiliza la vista teléfono o comparte el enlace para que el personal en campo cargue facturas con soportes.
          </p>
        </div>
      ) : (
        <div className="tabla-responsive" style={{ background: 'var(--surface-1)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table className="tabla" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.65rem 0.8rem' }}>EMPRESA</th>
                <th style={{ padding: '0.65rem 0.8rem' }}>PROVEEDOR / RIF</th>
                <th style={{ padding: '0.65rem 0.8rem' }}>N° FACTURA</th>
                <th style={{ padding: '0.65rem 0.8rem' }}>FECHA</th>
                <th style={{ padding: '0.65rem 0.8rem', textAlign: 'right' }}>MONTO TOTAL</th>
                <th style={{ padding: '0.65rem 0.8rem', textAlign: 'center' }}>SOPORTES</th>
                <th style={{ padding: '0.65rem 0.8rem' }}>ESTATUS</th>
                <th style={{ padding: '0.65rem 0.8rem', textAlign: 'center' }}>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {facturasFiltradas.map((fac) => {
                const fotosCount = fac.adjuntos.filter((a) => a.tipo === 'imagen').length;
                const pdfsCount = fac.adjuntos.filter((a) => a.tipo === 'pdf').length;

                return (
                  <tr key={fac.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.65rem 0.8rem' }}>
                      <span className="buzon-card-empresa">
                        🏢 {fac.empresa_nombre || 'Empresa'}
                      </span>
                    </td>
                    <td style={{ padding: '0.65rem 0.8rem' }}>
                      <strong style={{ display: 'block', fontSize: '0.92rem' }}>{fac.proveedor_nombre}</strong>
                      <small className="muted" style={{ fontFamily: 'var(--font-mono)' }}>
                        {fac.proveedor_rif || 'Sin RIF'}
                      </small>
                    </td>
                    <td style={{ padding: '0.65rem 0.8rem' }}>
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>#{fac.numero_factura}</strong>
                      {fac.numero_control && (
                        <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                          Ctrl: {fac.numero_control}
                        </small>
                      )}
                    </td>
                    <td style={{ padding: '0.65rem 0.8rem', fontSize: '0.85rem' }}>
                      {date(fac.fecha_factura)}
                    </td>
                    <td style={{ padding: '0.65rem 0.8rem', textAlign: 'right' }}>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem' }}>
                        {money(fac.monto_total, fac.moneda)}
                      </strong>
                      {fac.monto_bs != null && fac.moneda === 'USD' && (
                        <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                          ≈ {money(fac.monto_bs, 'Bs')}
                        </small>
                      )}
                      {fac.monto_usd != null && fac.moneda === 'Bs' && (
                        <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                          ≈ {money(fac.monto_usd, 'USD')}
                        </small>
                      )}
                    </td>
                    <td style={{ padding: '0.65rem 0.8rem', textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn xs"
                        style={{ border: '1px solid var(--border)' }}
                        onClick={() => setDetalle(fac)}
                        title="Ver soportes adjuntos"
                      >
                        {fotosCount > 0 && <span>🖼 {fotosCount} </span>}
                        {pdfsCount > 0 && <span>📄 {pdfsCount}</span>}
                        {fotosCount === 0 && pdfsCount === 0 && <span className="muted">Sin soportes</span>}
                      </button>
                    </td>
                    <td style={{ padding: '0.65rem 0.8rem' }}>
                      {canWrite ? (
                        <select
                          className="select xs"
                          value={fac.estatus}
                          onChange={(e) => handleCambiarEstatus(fac.id, e.target.value as EstatusFacturaBuzon)}
                        >
                          {ESTATUS_OPCIONES.map((op) => (
                            <option key={op.key} value={op.key}>
                              {op.icono} {op.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`buzon-estatus-pill buzon-estatus-${fac.estatus}`}>
                          {ESTATUS_OPCIONES.find((o) => o.key === fac.estatus)?.label || fac.estatus}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '0.65rem 0.8rem', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                        <button
                          type="button"
                          className="btn xs"
                          style={{ background: '#25D366', color: '#fff', border: 'none', fontWeight: 700 }}
                          onClick={() => setWhatsappFac(fac)}
                          title="Enviar resumen formateado por WhatsApp"
                        >
                          💬 WA
                        </button>
                        <button
                          type="button"
                          className="btn xs"
                          onClick={() => setDetalle(fac)}
                          title="Ver detalle completo"
                        >
                          👁
                        </button>
                        {canWrite && (
                          <button
                            type="button"
                            className="btn xs danger"
                            onClick={() => setFacturaABorrar(fac)}
                            title="Eliminar factura"
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

      {/* Modal: Detalle de Factura y Visualizador de Soportes */}
      {detalle && (
        <Modal
          title={`Factura #${detalle.numero_factura} · ${detalle.proveedor_nombre}`}
          onClose={() => setDetalle(null)}
          size="lg"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="buzon-card-empresa">
                🏢 {detalle.empresa_nombre || 'Empresa Receptora'}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="muted" style={{ fontSize: '0.85rem' }}>Estatus:</span>
                {canWrite ? (
                  <select
                    className="select sm"
                    value={detalle.estatus}
                    onChange={(e) => handleCambiarEstatus(detalle.id, e.target.value as EstatusFacturaBuzon)}
                  >
                    {ESTATUS_OPCIONES.map((op) => (
                      <option key={op.key} value={op.key}>
                        {op.icono} {op.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`buzon-estatus-pill buzon-estatus-${detalle.estatus}`}>
                    {ESTATUS_OPCIONES.find((o) => o.key === detalle.estatus)?.label || detalle.estatus}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem', background: 'var(--surface-2)', padding: '0.85rem', borderRadius: 'var(--r-md)' }}>
              <div>
                <small className="muted" style={{ display: 'block' }}>PROVEEDOR</small>
                <strong>{detalle.proveedor_nombre}</strong>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{detalle.proveedor_rif || 'Sin RIF'}</div>
              </div>
              <div>
                <small className="muted" style={{ display: 'block' }}>NÚMERO / CONTROL</small>
                <strong>Fac #{detalle.numero_factura}</strong>
                {detalle.numero_control && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Control: {detalle.numero_control}</div>
                )}
              </div>
              <div>
                <small className="muted" style={{ display: 'block' }}>FECHA FACTURA</small>
                <strong>{date(detalle.fecha_factura)}</strong>
              </div>
              <div>
                <small className="muted" style={{ display: 'block' }}>MONTO TOTAL</small>
                <strong style={{ fontSize: '1.1rem' }}>{money(detalle.monto_total, detalle.moneda)}</strong>
                {detalle.tasa && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tasa: {num(detalle.tasa)} Bs/$</div>
                )}
              </div>
            </div>

            {detalle.descripcion && (
              <div>
                <small className="muted" style={{ display: 'block', fontWeight: 700 }}>DESCRIPCIÓN / CONCEPTO</small>
                <p style={{ margin: '0.2rem 0', background: 'var(--surface-1)', padding: '0.6rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
                  {detalle.descripcion}
                </p>
              </div>
            )}

            {detalle.observaciones && (
              <div>
                <small className="muted" style={{ display: 'block', fontWeight: 700 }}>OBSERVACIONES / OTRO</small>
                <p style={{ margin: '0.2rem 0', background: 'var(--surface-1)', padding: '0.6rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
                  {detalle.observaciones}
                </p>
              </div>
            )}

            <div>
              <small className="muted" style={{ display: 'block', fontWeight: 700, marginBottom: '0.4rem' }}>
                SOPORTES ADJUNTOS ({detalle.adjuntos.length})
              </small>
              {detalle.adjuntos.length === 0 ? (
                <p className="muted" style={{ fontStyle: 'italic', fontSize: '0.85rem' }}>No se adjuntaron fotos ni documentos.</p>
              ) : (
                <div className="buzon-thumbs-grid">
                  {detalle.adjuntos.map((adj) => {
                    const url = urlPublicaAdjunto(adj.path);
                    const esImg = adj.tipo === 'imagen';
                    return (
                      <a
                        key={adj.id}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="buzon-thumb-item"
                        title={`${adj.nombre} (click para abrir)`}
                        style={{ textDecoration: 'none' }}
                      >
                        {esImg ? (
                          <img src={url} alt={adj.nombre} />
                        ) : (
                          <div className="buzon-thumb-pdf">
                            <span aria-hidden>📄</span>
                            <small>{adj.nombre}</small>
                          </div>
                        )}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.35rem' }}>
                💬 Compartir Resumen por WhatsApp:
              </div>
              <CompartirWhatsapp texto={mensajeFacturaExterna(detalle)} />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Compartir WhatsApp directo */}
      {whatsappFac && (
        <Modal
          title={`WhatsApp · Factura #${whatsappFac.numero_factura}`}
          onClose={() => setWhatsappFac(null)}
          size="md"
        >
          <div style={{ padding: '0.5rem' }}>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
              Resumen formateado con estatus para enviar al grupo o al proveedor:
            </p>
            <CompartirWhatsapp texto={mensajeFacturaExterna(whatsappFac)} />
          </div>
        </Modal>
      )}

      {/* ConfirmDialog de Borrado */}
      {facturaABorrar && (
        <ConfirmDialog
          title="¿Eliminar esta factura del buzón?"
          message={`Se eliminará la factura #${facturaABorrar.numero_factura} de ${facturaABorrar.proveedor_nombre} y todos sus soportes del almacenamiento.`}
          confirmText="Sí, eliminar factura"
          danger
          onCancel={() => setFacturaABorrar(null)}
          onConfirm={async () => {
            try {
              await eliminarFacturaBuzon(facturaABorrar.id);
              toast('Factura eliminada', 'info');
              setFacturaABorrar(null);
              void cargarDatos(false);
            } catch (e) {
              toast('Error al eliminar factura: ' + String(e), 'error');
            }
          }}
        />
      )}

      {/* Modal de Gestión de Empresas Receptoras */}
      {modalEmpresas && (
        <ModalGestionEmpresas
          empresas={empresas}
          onClose={() => setModalEmpresas(false)}
          onActualizado={() => void cargarDatos(false)}
          onEditarFichaFiscal={(emp) => {
            setModalEmpresas(false);
            setEmpresaFichaEditar(emp);
          }}
          onVerReporte={(emp) => {
            setModalEmpresas(false);
            setEmpresaReporte(emp);
          }}
        />
      )}

      {/* Modal de Ficha Fiscal Completa de una Empresa (para Retención / Impuestos) */}
      {empresaFichaEditar && (
        <ModalFichaFiscalEmpresa
          empresa={empresaFichaEditar}
          onClose={() => setEmpresaFichaEditar(null)}
          onGuardada={(actualizada) => {
            setEmpresaFichaEditar(null);
            void cargarDatos(false);
            toast(`Ficha fiscal de ${actualizada.nombreCorto || actualizada.nombre} guardada`, 'success');
          }}
        />
      )}

      {/* Modal de Reporte Fiscal por Empresa */}
      {empresaReporte && (
        <ModalReporteEmpresa
          empresa={empresaReporte}
          facturas={facturas.filter((f) => f.empresa_receptora_id === empresaReporte.id)}
          onClose={() => setEmpresaReporte(null)}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Modal para Administrar Empresas Receptoras (Lista y Fichas)
   ──────────────────────────────────────────────────────────── */
function ModalGestionEmpresas({
  empresas, onClose, onActualizado, onEditarFichaFiscal, onVerReporte,
}: {
  empresas: EmpresaReceptora[];
  onClose: () => void;
  onActualizado: () => void;
  onEditarFichaFiscal: (emp: EmpresaReceptora) => void;
  onVerReporte: (emp: EmpresaReceptora) => void;
}) {
  const [nuevaNombre, setNuevaNombre] = useState('');
  const [nuevaRif, setNuevaRif] = useState('');
  const [guardando, setGuardando] = useState(false);

  const handleCrearRapida = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevaNombre.trim()) return;
    setGuardando(true);
    try {
      const emp = await guardarEmpresaReceptora({
        nombre: nuevaNombre.trim(),
        nombreCorto: nuevaNombre.trim().slice(0, 18),
        rif: nuevaRif.trim() || 'S/RIF',
        colorBadge: '#2563eb',
        activo: true,
      });
      setNuevaNombre('');
      setNuevaRif('');
      toast(`Empresa ${emp.nombreCorto || emp.nombre} añadida`, 'success');
      onActualizado();
    } catch (err) {
      toast('Error al guardar: ' + String(err), 'error');
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminar = async (emp: EmpresaReceptora) => {
    if (!confirm(`¿Eliminar la empresa "${emp.nombre}" del catálogo?`)) return;
    try {
      await eliminarEmpresaReceptora(emp.id);
      toast('Empresa eliminada', 'info');
      onActualizado();
    } catch (err) {
      toast('Error al eliminar: ' + String(err), 'error');
    }
  };

  return (
    <Modal title="Catálogo de Empresas Receptoras & Fichas Fiscales" onClose={onClose} size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Configuración fiscal de empresas receptoras. El personal de Retención / Impuestos puede gestionar la ficha fiscal de cada empresa para emisión de comprobantes y reportes independientes.
        </p>

        {/* Lista de empresas registradas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {empresas.map((emp) => {
            const tieneFichaCompleta = Boolean(emp.rif && emp.rif !== 'S/RIF' && emp.direccionFiscal);
            return (
              <div
                key={emp.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.75rem 0.9rem',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <span style={{ color: emp.colorBadge, fontSize: '1.4rem' }}>●</span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.95rem' }}>{emp.nombre}</strong>
                      {emp.nombreCorto && emp.nombreCorto !== emp.nombre && (
                        <span className="muted" style={{ fontSize: '0.82rem' }}>({emp.nombreCorto})</span>
                      )}
                      <span className={tieneFichaCompleta ? 'buzon-ficha-tag-completa' : 'buzon-ficha-tag-incompleta'}>
                        {tieneFichaCompleta ? '✅ Ficha completa' : '⚠️ Ficha pendiente'}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      RIF: <strong>{emp.rif || 'Sin RIF'}</strong>
                      {emp.municipio && ` · ${emp.municipio}, ${emp.estado || ''}`}
                      {emp.esAgenteRetencionIva && ' · Agente IVA'}
                      {emp.esContribuyenteEspecial && ' · Contribuyente Especial'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn xs primario"
                    onClick={() => onEditarFichaFiscal(emp)}
                    title="Editar ficha fiscal, dirección, régimen y condición de agente"
                  >
                    ✏️ Ficha Fiscal
                  </button>
                  <button
                    type="button"
                    className="btn xs"
                    onClick={() => onVerReporte(emp)}
                    title="Ver reporte ejecutivo de compras y facturas de esta empresa"
                  >
                    📊 Reporte
                  </button>
                  {!emp.id.startsWith('empresa-mgg') && (
                    <button
                      type="button"
                      className="btn xs danger"
                      onClick={() => handleEliminar(emp)}
                      title="Eliminar empresa"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Añadir nueva empresa rápida */}
        <form onSubmit={handleCrearRapida} style={{ background: 'var(--surface-1)', padding: '0.85rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
          <strong style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem' }}>
            ➕ Añadir Empresa al Catálogo
          </strong>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              className="input sm"
              placeholder="Razón Social o Nombre (ej. Minera del Sur C.A.)"
              value={nuevaNombre}
              onChange={(e) => setNuevaNombre(e.target.value)}
              required
            />
            <input
              type="text"
              className="input sm"
              placeholder="RIF (ej. J-12345678-9)"
              value={nuevaRif}
              onChange={(e) => setNuevaRif(e.target.value)}
            />
            <button type="submit" className="btn sm primario" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Añadir'}
            </button>
          </div>
          <small className="muted" style={{ display: 'block', marginTop: '0.35rem', fontSize: '0.78rem' }}>
            Una vez añadida, podrás pulsar "✏️ Ficha Fiscal" para completar su domicilio, ordenanza municipal y régimen tributario.
          </small>
        </form>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────
   Modal de Ficha Fiscal Completa de una Empresa (Impuestos/Retención)
   ──────────────────────────────────────────────────────────── */
function ModalFichaFiscalEmpresa({
  empresa, onClose, onGuardada,
}: {
  empresa: EmpresaReceptora;
  onClose: () => void;
  onGuardada: (emp: EmpresaReceptora) => void;
}) {
  const [nombre, setNombre] = useState(empresa.nombre);
  const [nombreCorto, setNombreCorto] = useState(empresa.nombreCorto || '');
  const [rif, setRif] = useState(empresa.rif === 'S/RIF' ? '' : empresa.rif);
  const [colorBadge, setColorBadge] = useState(empresa.colorBadge || '#2563eb');
  const [email, setEmail] = useState(empresa.email || '');
  const [telefono, setTelefono] = useState(empresa.telefono || '');

  const [direccionFiscal, setDireccionFiscal] = useState(empresa.direccionFiscal || '');
  const [municipio, setMunicipio] = useState(empresa.municipio || '');
  const [estado, setEstado] = useState(empresa.estado || '');
  const [licenciaMunicipal, setLicenciaMunicipal] = useState(empresa.licenciaMunicipal || '');

  const [esAgenteRetencionIva, setEsAgenteRetencionIva] = useState(empresa.esAgenteRetencionIva ?? true);
  const [esContribuyenteEspecial, setEsContribuyenteEspecial] = useState(empresa.esContribuyenteEspecial ?? false);
  const [retieneIslr, setRetieneIslr] = useState(empresa.retieneIslr ?? true);
  const [retieneMunicipal, setRetieneMunicipal] = useState(empresa.retieneMunicipal ?? false);
  const [pctIvaGeneral, setPctIvaGeneral] = useState(empresa.pctIvaGeneral ?? 75);
  const [imprimirOriginalYCopia, setImprimirOriginalYCopia] = useState(empresa.imprimirOriginalYCopia ?? true);

  const [errorRif, setErrorRif] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) {
      toast('Ingresa la razón social de la empresa', 'warning');
      return;
    }

    // Validar RIF si se provee
    if (rif.trim()) {
      const v = rifEmpresaParaGuardar(rif);
      if (v.error) {
        setErrorRif(v.error);
        return;
      }
    }

    setGuardando(true);
    setErrorRif(null);

    try {
      const emp = await guardarEmpresaReceptora({
        id: empresa.id,
        clave: empresa.clave,
        nombre: nombre.trim(),
        nombreCorto: nombreCorto.trim() || undefined,
        rif: rif.trim() || 'S/RIF',
        colorBadge,
        activo: true,
        orden: empresa.orden,
        email: email.trim() || undefined,
        telefono: telefono.trim() || undefined,
        direccionFiscal: direccionFiscal.trim() || undefined,
        municipio: municipio.trim() || undefined,
        estado: estado.trim() || undefined,
        licenciaMunicipal: licenciaMunicipal.trim() || undefined,
        esAgenteRetencionIva,
        esContribuyenteEspecial,
        retieneIslr,
        retieneMunicipal,
        pctIvaGeneral: Number(pctIvaGeneral) || 75,
        imprimirOriginalYCopia,
      });

      onGuardada(emp);
    } catch (err) {
      toast('Error al guardar ficha fiscal: ' + String(err), 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal title={`Ficha Fiscal · ${empresa.nombreCorto || empresa.nombre}`} onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        {/* 1. Identificación Principal */}
        <div className="buzon-ficha-fiscal-seccion">
          <h4>🏢 Identificación Fiscal</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.6rem', marginBottom: '0.5rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                Razón Social Oficial *
              </label>
              <input
                type="text"
                className="input sm"
                style={{ width: '100%' }}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                Alias / Código Corto (ej. MGG, MTO)
              </label>
              <input
                type="text"
                className="input sm"
                style={{ width: '100%' }}
                value={nombreCorto}
                onChange={(e) => setNombreCorto(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                RIF Fiscal (SENIAT)
              </label>
              <input
                type="text"
                className="input sm"
                style={{ width: '100%' }}
                placeholder="J-12345678-9"
                value={rif}
                onChange={(e) => {
                  setRif(e.target.value);
                  setErrorRif(null);
                }}
              />
              {errorRif && <small style={{ color: 'var(--danger)', fontSize: '0.75rem' }}>{errorRif}</small>}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                Correo Electrónico Fiscal
              </label>
              <input
                type="email"
                className="input sm"
                style={{ width: '100%' }}
                placeholder="impuestos@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                Teléfono de Contacto
              </label>
              <input
                type="text"
                className="input sm"
                style={{ width: '100%' }}
                placeholder="+58 414..."
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* 2. Domicilio Fiscal */}
        <div className="buzon-ficha-fiscal-seccion">
          <h4>📍 Domicilio Fiscal</h4>
          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.2rem' }}>
              Dirección Fiscal Completa (para comprobantes)
            </label>
            <input
              type="text"
              className="input sm"
              style={{ width: '100%' }}
              placeholder="Av. Principal, Edificio..., Ciudad, Venezuela"
              value={direccionFiscal}
              onChange={(e) => setDireccionFiscal(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                Municipio
              </label>
              <input
                type="text"
                className="input sm"
                style={{ width: '100%' }}
                placeholder="Ej. Caroní / El Callao"
                value={municipio}
                onChange={(e) => setMunicipio(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                Estado
              </label>
              <input
                type="text"
                className="input sm"
                style={{ width: '100%' }}
                placeholder="Ej. Bolívar"
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                N° Patente / Licencia Municipal
              </label>
              <input
                type="text"
                className="input sm"
                style={{ width: '100%' }}
                placeholder="Ej. RIM-9874"
                value={licenciaMunicipal}
                onChange={(e) => setLicenciaMunicipal(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* 3. Régimen Tributario y Retenciones */}
        <div className="buzon-ficha-fiscal-seccion">
          <h4>⚖️ Régimen Tributario y Condición de Agente</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem', marginBottom: '0.6rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={esAgenteRetencionIva}
                onChange={(e) => setEsAgenteRetencionIva(e.target.checked)}
              />
              <span>Agente de Retención de IVA</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={esContribuyenteEspecial}
                onChange={(e) => setEsContribuyenteEspecial(e.target.checked)}
              />
              <span>Contribuyente Especial (SNAT)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={retieneIslr}
                onChange={(e) => setRetieneIslr(e.target.checked)}
              />
              <span>Retiene ISLR (Decreto 1.808)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={retieneMunicipal}
                onChange={(e) => setRetieneMunicipal(e.target.checked)}
              />
              <span>Retiene ISAE (Municipal)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={imprimirOriginalYCopia}
                onChange={(e) => setImprimirOriginalYCopia(e.target.checked)}
              />
              <span>Comprobantes Original y Copia</span>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 700 }}>% Retención IVA General:</label>
              <select
                className="select sm"
                value={pctIvaGeneral}
                onChange={(e) => setPctIvaGeneral(Number(e.target.value))}
              >
                <option value={75}>75% (General)</option>
                <option value={100}>100% (Especial / Metales)</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 700 }}>Color Distintivo:</label>
              <input
                type="color"
                value={colorBadge}
                onChange={(e) => setColorBadge(e.target.value)}
                style={{ width: '36px', height: '36px', padding: 0, border: 'none', borderRadius: 'var(--r-sm)' }}
                title="Color que identifica sus facturas y reportes"
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.6rem', marginTop: '0.4rem' }}>
          <button type="button" className="btn" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" disabled={guardando} style={{ fontWeight: 800 }}>
            {guardando ? 'Guardando Ficha...' : '💾 Guardar Ficha Fiscal'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────
   Modal de Reporte Fiscal por Empresa
   ──────────────────────────────────────────────────────────── */
function ModalReporteEmpresa({
  empresa, facturas, onClose,
}: {
  empresa: EmpresaReceptora;
  facturas: FacturaBuzon[];
  onClose: () => void;
}) {
  const totalesEmpresa = useMemo(() => {
    let usd = 0;
    let bs = 0;
    let recibidas = 0;
    let retenidas = 0;
    let proveedoresSet = new Set<string>();

    facturas.forEach((f) => {
      const mUsd = Number(f.moneda === 'USD' ? (f.monto_total ?? 0) : (f.monto_usd ?? 0));
      const mBs = Number(f.moneda === 'Bs' ? (f.monto_total ?? 0) : (f.monto_bs ?? 0));
      usd += mUsd;
      bs += mBs;
      if (f.estatus === 'recibida') recibidas++;
      if (f.estatus === 'retenida') retenidas++;
      if (f.proveedor_nombre) {
        proveedoresSet.add(f.proveedor_nombre);
      }
    });

    return { usd, bs, recibidas, retenidas, total: facturas.length, proveedoresCount: proveedoresSet.size };
  }, [facturas]);

  const textoReporte = useMemo(() => {
    const lineas = [
      `📊 *REPORTE EJECUTIVO DE COMPRAS & FACTURAS*`,
      `🏢 *Empresa:* ${empresa.nombre}`,
      `🆔 *RIF:* ${empresa.rif || 'S/RIF'}`,
      empresa.municipio ? `📍 *Ubicación:* ${empresa.municipio}, ${empresa.estado || 'Venezuela'}` : '',
      `📅 *Fecha de emisión:* ${date(new Date().toISOString())}`,
      `────────────────────────`,
      `📦 *Total Facturas Registradas:* ${totalesEmpresa.total}`,
      `📥 *Por revisar:* ${totalesEmpresa.recibidas} | ✅ *Retenidas:* ${totalesEmpresa.retenidas}`,
      `👥 *Proveedores atendidos:* ${totalesEmpresa.proveedoresCount}`,
      `💵 *Monto Total USD:* ${money(totalesEmpresa.usd, 'USD')}`,
      `🇻🇪 *Monto Total Bs:* ${money(totalesEmpresa.bs, 'Bs')}`,
      `────────────────────────`,
      `*Módulo de Retenciones · Mineral Group Guayana C.A.*`,
    ];
    return lineas.filter(Boolean).join('\n');
  }, [empresa, totalesEmpresa]);

  return (
    <Modal title={`Reporte Fiscal · ${empresa.nombreCorto || empresa.nombre}`} onClose={onClose} size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div style={{ background: 'var(--surface-2)', padding: '0.85rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <strong style={{ fontSize: '1.05rem', display: 'block' }}>{empresa.nombre}</strong>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                RIF: {empresa.rif || 'S/RIF'} {empresa.municipio ? `· ${empresa.municipio}` : ''}
              </div>
            </div>
            <span style={{ color: empresa.colorBadge, fontSize: '1.5rem' }}>●</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginTop: '0.75rem', paddingTop: '0.6rem', borderTop: '1px solid var(--border)' }}>
            <div>
              <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>TOTAL FACTURADO (USD)</small>
              <strong style={{ fontSize: '1.2rem', color: 'var(--primary-2)' }}>{money(totalesEmpresa.usd, 'USD')}</strong>
            </div>
            <div>
              <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>TOTAL FACTURADO (BS)</small>
              <strong style={{ fontSize: '1.2rem' }}>{money(totalesEmpresa.bs, 'Bs')}</strong>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', textAlign: 'center' }}>
          <div style={{ background: 'var(--surface-1)', padding: '0.6rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{totalesEmpresa.total}</div>
            <small className="muted" style={{ fontSize: '0.75rem' }}>Facturas Totales</small>
          </div>
          <div style={{ background: 'var(--surface-1)', padding: '0.6rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#d97706' }}>{totalesEmpresa.recibidas}</div>
            <small className="muted" style={{ fontSize: '0.75rem' }}>Por Revisar</small>
          </div>
          <div style={{ background: 'var(--surface-1)', padding: '0.6rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#059669' }}>{totalesEmpresa.retenidas}</div>
            <small className="muted" style={{ fontSize: '0.75rem' }}>Retenidas</small>
          </div>
        </div>

        <div style={{ marginTop: '0.5rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.35rem' }}>
            📱 Enviar Resumen de Empresa por WhatsApp:
          </div>
          <CompartirWhatsapp texto={textoReporte} />
        </div>
      </div>
    </Modal>
  );
}

