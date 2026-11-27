/* ============================================================
   Golden Touch · Retenciones · Buzón de Facturas Externas y Multi-Empresa
   Apartado para revisar las facturas que se cargan desde el teléfono
   fuera de la oficina, separadas por la empresa que las recibe.
   Incluye la ficha fiscal de cada empresa, avisos sonoros y en pantalla
   cuando llega una factura, y reportes por WhatsApp.

   Todo sale de la base: sin empresas cargadas, la pantalla pide
   cargarlas primero. Ninguna empresa es especial por su nombre.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { toast } from '@/shared/ui/Toast';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { num, date, money } from '@/shared/lib/format';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import {
  listEmpresasReceptoras, eliminarEmpresaReceptora,
  type EmpresaReceptora,
} from './empresasReceptoras.repository';
import {
  listFacturasBuzon, actualizarEstatusFacturaBuzon, eliminarFacturaBuzon,
  numeralFactura, ultimaCreacionBuzon,
  type FacturaBuzon, type EstatusFacturaBuzon,
} from './facturasBuzon.repository';
import { obtenerUrlAdjunto, type AdjuntoFacturaItem } from './adjuntosBuzon';
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
import { EmpresaEditor } from './EmpresaEditor';
import { estadoRetencionDeBuzon, badgeEstadoRetencion } from './estadoRetencion';
import { esEmpresaGt } from './empresaActual';

/** Cómo se dice cada estado del buzón en pantalla (la clave interna no se muestra). */
const ROTULO_ESTADO_BUZON: Record<EstatusFacturaBuzon, string> = {
  recibida: 'Recibida',
  en_revision: 'En revisión',
  retenida: 'Retención hecha',
  descartada: 'Descartada',
};

const ESTATUS_OPCIONES: { key: EstatusFacturaBuzon; label: string; icono: string; color: string }[] = [
  { key: 'recibida', label: ROTULO_ESTADO_BUZON.recibida, icono: '📥', color: '#2563eb' },
  { key: 'en_revision', label: ROTULO_ESTADO_BUZON.en_revision, icono: '⏳', color: '#d97706' },
  { key: 'retenida', label: ROTULO_ESTADO_BUZON.retenida, icono: '✅', color: '#059669' },
  { key: 'descartada', label: ROTULO_ESTADO_BUZON.descartada, icono: '✖', color: '#6b7280' },
];

const rotuloEstadoBuzon = (e: string) => ROTULO_ESTADO_BUZON[e as EstatusFacturaBuzon] ?? 'Sin estado';

/** El motivo en español que trae el error del repositorio. */
const motivoDeError = (e: unknown, porDefecto = 'No se pudo completar la operación. Vuelve a intentarlo.') =>
  (e instanceof Error && e.message.trim() ? e.message : porDefecto);

/** Totales en Bs (sin las descartadas). El equivalente en $ solo si todas lo tienen. */
function totalizar(facs: readonly FacturaBuzon[]) {
  const vigentes = facs.filter((f) => f.estatus !== 'descartada');
  const bs = vigentes.reduce((s, f) => s + (Number(f.montoBs) || 0), 0);
  const todasConUsd = vigentes.every((f) => f.montoUsd != null);
  const usd = todasConUsd ? vigentes.reduce((s, f) => s + (Number(f.montoUsd) || 0), 0) : null;
  return { bs, usd, vigentes: vigentes.length };
}

export interface BuzonFacturasExternasViewProps {
  empresaId?: string | null;
  onEmpresaChange?: (id: string) => void;
  onRegistrar?: (fac: FacturaBuzon) => void;
}

export function BuzonFacturasExternasView({
  empresaId,
  onEmpresaChange,
  onRegistrar,
}: BuzonFacturasExternasViewProps = {}) {
  const { can } = usePermissions();
  const canWrite = can('retenciones', 'escritura');

  const [empresas, setEmpresas] = useState<EmpresaReceptora[]>([]);
  const [facturas, setFacturas] = useState<FacturaBuzon[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  // Filtros inicializados con la empresa activa de sesión si viene provista
  const [empresaFiltro, setEmpresaFiltro] = useState<string>(empresaId || 'todas');
  const [estatusFiltro, setEstatusFiltro] = useState<string>('todas');
  const [busqueda, setBusqueda] = useState('');

  // Sincronizar automáticamente el filtro cuando la empresa activa en el banner cambia
  useEffect(() => {
    if (empresaId) {
      setEmpresaFiltro(empresaId);
    }
  }, [empresaId]);

  // Modales
  const [detalle, setDetalle] = useState<FacturaBuzon | null>(null);
  const [whatsappFac, setWhatsappFac] = useState<FacturaBuzon | null>(null);
  const [facturaABorrar, setFacturaABorrar] = useState<FacturaBuzon | null>(null);
  const [borrandoFactura, setBorrandoFactura] = useState(false);
  const [modalEmpresas, setModalEmpresas] = useState(false);
  const [empresaFichaEditar, setEmpresaFichaEditar] = useState<EmpresaReceptora | null>(null);
  const [empresaReporte, setEmpresaReporte] = useState<EmpresaReceptora | null>(null);

  // Sonido y avisos en pantalla independientes de retenciones
  const [sonidoActivo, setSonidoActivo] = useState(isSonidoRetencionesHabilitado());
  const [avisosActivos, setAvisosActivos] = useState(isAvisosPantallaHabilitados());
  const [permisoNotif, setPermisoNotif] = useState(getEstadoPermisoNotificacion());
  // Por el SELLO de creación más reciente, no por el conteo: si entra 1 y se borra 1
  // en la misma recarga el conteo no cambia pero el sello sí, y el aviso no se pierde (C-i).
  const prevUltimaCreacionRef = useRef<string | null>(null);

  const cargarDatos = useCallback(async (reproducirSonido = false) => {
    try {
      const [empr, facs] = await Promise.all([
        listEmpresasReceptoras(),
        listFacturasBuzon(),
      ]);
      setEmpresas(empr);

      // Si llegaron nuevas facturas desde el último render (sello más nuevo), sonar arpegio y alertar.
      const ultima = ultimaCreacionBuzon(facs);
      if (reproducirSonido && prevUltimaCreacionRef.current !== null && ultima > prevUltimaCreacionRef.current) {
        const facMasReciente = facs[0];
        lanzarAvisoFactura(facMasReciente, { conSonido: true });
        toast('🔔 Llegó una factura nueva al buzón', 'info');
      }
      prevUltimaCreacionRef.current = ultima;
      setFacturas(facs);
      setErrorCarga(null);
    } catch (e) {
      setErrorCarga(motivoDeError(e, 'No se pudo leer el buzón. Vuelve a intentarlo.'));
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
      toast('Este navegador no muestra avisos en pantalla.', 'info');
      return;
    }

    const estado = getEstadoPermisoNotificacion();
    if (estado === 'denied') {
      toast('Los avisos están bloqueados en este navegador. Toca el candado junto a la dirección de la página para permitirlos.', 'warning');
      setPermisoNotif('denied');
      return;
    }

    if (estado !== 'granted') {
      const res = await solicitarPermisoAvisos();
      setPermisoNotif(res);
      if (res === 'granted') {
        setAvisosActivos(true);
        toast('✅ Avisos en pantalla activados. Te llegará un aviso con vibración cuando entre una factura.', 'success');
        lanzarAvisoFactura(
          { empresaNombre: 'Retenciones', proveedorNombre: 'Avisos activados', moneda: 'Bs', montoTotal: 0 },
          { conSonido: false }
        );
      } else if (res === 'denied') {
        toast('El navegador no dio permiso para los avisos.', 'warning');
      }
      return;
    }

    const nuevo = !avisosActivos;
    setAvisosPantallaHabilitados(nuevo);
    setAvisosActivos(nuevo);
    toast(nuevo ? 'Avisos en pantalla activados 📲' : 'Avisos en pantalla desactivados 📴', 'info');
  };

  const handleCambiarEstatus = async (facId: string, nuevoEstatus: EstatusFacturaBuzon) => {
    if (!canWrite) return;
    try {
      await actualizarEstatusFacturaBuzon(facId, nuevoEstatus);
      reproducirSonidoEstatusFactura();
      toast(`Estado cambiado a «${rotuloEstadoBuzon(nuevoEstatus)}»`, 'success');
      void cargarDatos(false);
      if (detalle && detalle.id === facId) {
        setDetalle((prev) => prev ? { ...prev, estatus: nuevoEstatus } : null);
      }
    } catch (e) {
      toast(motivoDeError(e), 'error');
    }
  };

  // Filtrado
  const facturasFiltradas = useMemo(() => {
    return facturas.filter((f) => {
      if (empresaFiltro !== 'todas') {
        const empSel = empresas.find((e) => e.id === empresaFiltro);
        const esGtFiltro =
          empresaFiltro === 'empresa-golden-touch' ||
          empresaFiltro === 'gt-default' ||
          empresaFiltro === 'golden_touch' ||
          empresaFiltro === 'GT' ||
          (empSel && esEmpresaGt(empSel));

        if (esGtFiltro) {
          const esGtFac =
            !f.empresaId ||
            f.empresaId === 'empresa-golden-touch' ||
            f.empresaId === 'gt-default' ||
            f.empresaId === 'golden_touch' ||
            f.empresaId === 'GT' ||
            (f.empresaNombre && f.empresaNombre.toLowerCase().includes('golden touch'));
          if (!esGtFac) return false;
        } else {
          // Empresa no GT (ej. MTO): coincidencia estricta por id, clave o nombre
          const match =
            f.empresaId === empresaFiltro ||
            (empSel?.clave && f.empresaId === empSel.clave) ||
            (empSel?.nombre && f.empresaNombre && f.empresaNombre.trim().toLowerCase() === empSel.nombre.trim().toLowerCase());
          if (!match) return false;
        }
      }
      if (estatusFiltro !== 'todas' && f.estatus !== estatusFiltro) return false;
      if (busqueda.trim()) {
        const q = busqueda.toLowerCase().trim();
        const texto = `${f.proveedorNombre} ${f.proveedorRif || ''} ${f.facturaNumero} ${f.facturaControl || ''} ${f.empresaNombre || ''} ${f.descripcion || ''}`.toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    });
  }, [facturas, empresas, empresaFiltro, estatusFiltro, busqueda]);

  // Facturas base de la empresa para totales
  const facturasEmpresaBase = useMemo(() => {
    if (empresaFiltro === 'todas') return facturas;
    const empSel = empresas.find((e) => e.id === empresaFiltro);
    const esGtFiltro =
      empresaFiltro === 'empresa-golden-touch' ||
      empresaFiltro === 'gt-default' ||
      empresaFiltro === 'golden_touch' ||
      empresaFiltro === 'GT' ||
      (empSel && esEmpresaGt(empSel));

    return facturas.filter((f) => {
      if (esGtFiltro) {
        return (
          !f.empresaId ||
          f.empresaId === 'empresa-golden-touch' ||
          f.empresaId === 'gt-default' ||
          f.empresaId === 'golden_touch' ||
          f.empresaId === 'GT' ||
          (f.empresaNombre && f.empresaNombre.toLowerCase().includes('golden touch'))
        );
      }
      return (
        f.empresaId === empresaFiltro ||
        (empSel?.clave && f.empresaId === empSel.clave) ||
        (empSel?.nombre && f.empresaNombre && f.empresaNombre.trim().toLowerCase() === empSel.nombre.trim().toLowerCase())
      );
    });
  }, [facturas, empresas, empresaFiltro]);

  // Totales del buzón (de la empresa elegida o de todas)
  const totales = useMemo(() => {
    const montos = totalizar(facturasEmpresaBase);
    return {
      ...montos,
      recibidasCount: facturasEmpresaBase.filter((f) => f.estatus === 'recibida').length,
      enRevisionCount: facturasEmpresaBase.filter((f) => f.estatus === 'en_revision').length,
      retenidasCount: facturasEmpresaBase.filter((f) => f.estatus === 'retenida').length,
      totalCount: facturasEmpresaBase.length,
    };
  }, [facturasEmpresaBase]);

  // Total en Bs por empresa (solo las que tienen facturas)
  const porEmpresa = useMemo(() => {
    return empresas
      .map((emp) => {
        const suyas = facturas.filter((f) => f.empresaId === emp.id);
        return { emp, cantidad: suyas.length, bs: totalizar(suyas).bs };
      })
      .filter((x) => x.cantidad > 0);
  }, [empresas, facturas]);

  const recibidasTodas = useMemo(() => facturas.filter((f) => f.estatus === 'recibida').length, [facturas]);

  const empresaSeleccionadaActual = useMemo(() => {
    if (empresaFiltro === 'todas') return null;
    return empresas.find((e) => e.id === empresaFiltro) || null;
  }, [empresas, empresaFiltro]);

  const sinEmpresas = !loading && !errorCarga && empresas.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Barra de título y acciones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📥 Buzón de facturas por empresa</span>
            {recibidasTodas > 0 && (
              <span className="buzon-badge-alerta" title={`${recibidasTodas} facturas recibidas sin revisar`}>
                {recibidasTodas} nuevas
              </span>
            )}
          </h2>
          <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>
            Facturas cargadas desde el teléfono fuera de la oficina, separadas por la empresa que las recibe. Cada empresa tiene su ficha fiscal.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`buzon-audio-toggle ${sonidoActivo ? 'activo' : ''}`}
            onClick={handleToggleSonido}
            title={sonidoActivo ? 'Suena una campana cuando llega una factura' : 'Sonido silenciado'}
          >
            {sonidoActivo ? '🔔 Sonido: activo' : '🔕 Sonido: silenciado'}
          </button>

          <button
            type="button"
            className={`buzon-audio-toggle ${avisosActivos && permisoNotif === 'granted' ? 'activo' : ''}`}
            onClick={handleToggleAvisosPantalla}
            title={
              permisoNotif === 'denied'
                ? 'Avisos bloqueados en la configuración de este navegador (revisa el candado junto a la dirección)'
                : avisosActivos && permisoNotif === 'granted'
                ? 'Avisos en pantalla y vibración del teléfono activados'
                : 'Activar avisos en pantalla y vibración del teléfono'
            }
          >
            {permisoNotif === 'denied'
              ? '⚠️ Avisos: bloqueados'
              : avisosActivos && permisoNotif === 'granted'
              ? '📲 Avisos en pantalla: activados'
              : '📴 Avisos en pantalla: apagados'}
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setModalEmpresas(true)}
            title={canWrite ? 'Ver, agregar y editar las empresas que reciben facturas y su ficha fiscal' : 'Ver las empresas que reciben facturas'}
          >
            🏢 Empresas ({empresas.length})
          </button>

          {empresaSeleccionadaActual && (
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}
              onClick={() => setEmpresaReporte(empresaSeleccionadaActual)}
              title={`Reporte de facturas de ${empresaSeleccionadaActual.nombreCorto || empresaSeleccionadaActual.nombre}`}
            >
              📊 Reporte de {empresaSeleccionadaActual.nombreCorto || empresaSeleccionadaActual.nombre}
            </button>
          )}

          <Link
            to="/app/retenciones/telefono"
            className="btn btn-sm btn-primary"
            style={{ textDecoration: 'none' }}
          >
            📱 Abrir vista teléfono
          </Link>
        </div>
      </div>

      {errorCarga && (
        <div className="aviso danger" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span>{errorCarga}</span>
          <button type="button" className="btn btn-sm" onClick={() => { setLoading(true); void cargarDatos(false); }}>
            Volver a intentar
          </button>
        </div>
      )}

      {sinEmpresas ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', background: 'var(--surface-1)', borderRadius: 'var(--r-lg)', border: '1px dashed var(--border)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🏢</div>
          <p style={{ fontWeight: 700, margin: '0 0 0.4rem' }}>Todavía no hay empresas que reciban facturas</p>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 0.9rem' }}>
            {canWrite
              ? 'Primero carga las empresas que reciben facturas (nombre y RIF). Después el buzón se puede usar desde el teléfono.'
              : 'Primero hay que cargar las empresas que reciben facturas. Pídeselo a quien administra Retenciones.'}
          </p>
          {canWrite && (
            <button type="button" className="btn btn-primary" onClick={() => setModalEmpresas(true)}>
              ➕ Cargar las empresas
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Tarjetas de resumen */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <div style={{ background: 'var(--surface-2)', padding: '0.85rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
              <small className="muted" style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                🧾 {empresaSeleccionadaActual ? `Total de ${empresaSeleccionadaActual.nombreCorto || empresaSeleccionadaActual.nombre}` : 'Total del buzón'}
              </small>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary-2)', marginTop: '0.2rem' }}>
                {money(totales.bs, 'Bs')}
              </div>
              <small className="muted" style={{ fontSize: '0.8rem' }}>
                {totales.vigentes} facturas, sin las descartadas
                {totales.usd != null && totales.vigentes > 0 && ` · ≈ ${money(totales.usd, 'USD')}`}
              </small>
            </div>

            {empresaFiltro === 'todas' && porEmpresa.length > 0 && (
              <div style={{ background: 'var(--surface-2)', padding: '0.85rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                <small className="muted" style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  🏢 Por empresa
                </small>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.35rem' }}>
                  {porEmpresa.map(({ emp, cantidad, bs }) => (
                    <div key={emp.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.85rem' }}>
                      <span>
                        <span style={{ color: emp.colorBadge }}>●</span> {emp.nombreCorto || emp.nombre}
                        <small className="muted"> ({cantidad})</small>
                      </span>
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>{money(bs, 'Bs')}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ background: 'var(--surface-2)', padding: '0.85rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
              <small className="muted" style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                📊 Estado de las facturas
              </small>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#2563eb' }}>{totales.recibidasCount}</span>
                  <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>Por revisar</small>
                </div>
                <div>
                  <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#d97706' }}>{totales.enRevisionCount}</span>
                  <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>En revisión</small>
                </div>
                <div>
                  <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#059669' }}>{totales.retenidasCount}</span>
                  <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>Retención hecha</small>
                </div>
                <div>
                  <span style={{ fontSize: '1.2rem', fontWeight: 800 }}>{totales.totalCount}</span>
                  <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>En el buzón</small>
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
                  onChange={(e) => {
                    const val = e.target.value;
                    setEmpresaFiltro(val);
                    if (val !== 'todas' && onEmpresaChange) {
                      onEmpresaChange(val);
                    }
                  }}
                >
                  <option value="todas">Todas las empresas ({facturas.length})</option>
                  {empresas.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.nombreCorto || emp.nombre}{emp.activo ? '' : ' (desactivada)'} ({facturas.filter((f) => f.empresaId === emp.id).length})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)' }}>ESTADO:</span>
                <select
                  className="select sm"
                  value={estatusFiltro}
                  onChange={(e) => setEstatusFiltro(e.target.value)}
                >
                  <option value="todas">Todos los estados</option>
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
              <p style={{ fontWeight: 700, margin: '0 0 0.4rem' }}>
                {facturas.length === 0 ? 'Todavía no hay facturas en el buzón' : 'No hay facturas con los filtros elegidos'}
              </p>
              <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                Las facturas se cargan desde la vista teléfono, con sus fotos o PDF de soporte.
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
                    <th style={{ padding: '0.65rem 0.8rem', textAlign: 'right' }}>MONTO (BS)</th>
                    <th style={{ padding: '0.65rem 0.8rem', textAlign: 'center' }}>SOPORTES</th>
                    <th style={{ padding: '0.65rem 0.8rem' }}>ESTADO</th>
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
                            🏢 {fac.empresaNombre || 'Empresa'}
                          </span>
                        </td>
                        <td style={{ padding: '0.65rem 0.8rem' }}>
                          <strong style={{ display: 'block', fontSize: '0.92rem' }}>{fac.proveedorNombre}</strong>
                          <small className="muted" style={{ fontFamily: 'var(--font-mono)' }}>
                            {fac.proveedorRif || 'Sin RIF'}
                          </small>
                        </td>
                        <td style={{ padding: '0.65rem 0.8rem' }}>
                          <strong style={{ fontFamily: 'var(--font-mono)' }}>{numeralFactura(fac.facturaNumero)}</strong>
                          {fac.facturaControl && (
                            <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                              N° de control: {fac.facturaControl}
                            </small>
                          )}
                        </td>
                        <td style={{ padding: '0.65rem 0.8rem', fontSize: '0.85rem' }}>
                          {date(fac.facturaFecha)}
                        </td>
                        <td style={{ padding: '0.65rem 0.8rem', textAlign: 'right' }}>
                          <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem' }}>
                            {money(fac.montoBs, 'Bs')}
                          </strong>
                          {fac.moneda === 'USD' && (
                            <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                              Factura en {money(fac.montoTotal, 'USD')}{fac.tasa ? ` · tasa ${num(fac.tasa)}` : ''}
                            </small>
                          )}
                          {fac.moneda === 'Bs' && fac.montoUsd != null && (
                            <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                              ≈ {money(fac.montoUsd, 'USD')}
                            </small>
                          )}
                        </td>
                        <td style={{ padding: '0.65rem 0.8rem', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ border: '1px solid var(--border)' }}
                            onClick={() => setDetalle(fac)}
                            title="Ver los soportes"
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
                              title="Cambiar el estado de la factura"
                            >
                              {ESTATUS_OPCIONES.map((op) => (
                                <option key={op.key} value={op.key}>
                                  {op.icono} {op.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className={`buzon-estatus-pill buzon-estatus-${fac.estatus}`}>
                              {rotuloEstadoBuzon(fac.estatus)}
                            </span>
                          )}
                          {(() => {
                            const b = badgeEstadoRetencion(estadoRetencionDeBuzon(fac.estatus));
                            return <div style={{ marginTop: '0.3rem' }}><span className={b.className} title={b.tooltip} style={{ fontSize: '.68rem', padding: '1px 5px' }}>{b.label}</span></div>;
                          })()}
                        </td>
                        <td style={{ padding: '0.65rem 0.8rem', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                            {onRegistrar && canWrite && fac.estatus !== 'retenida' && fac.estatus !== 'descartada' && (
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={() => onRegistrar(fac)}
                                title="Registrar la retención de esta factura en el Libro Fiscal de su empresa"
                              >
                                ✍ Retener desde buzón
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-sm"
                              style={{ background: '#25D366', color: '#fff', border: 'none', fontWeight: 700 }}
                              onClick={() => setWhatsappFac(fac)}
                              title="Enviar el resumen por WhatsApp"
                            >
                              💬 WhatsApp
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => setDetalle(fac)}
                              title="Ver el detalle completo"
                            >
                              👁
                            </button>
                            {canWrite && (
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={() => setFacturaABorrar(fac)}
                                title="Borrar la factura"
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
        </>
      )}

      {/* Modal: Detalle de Factura y Visualizador de Soportes */}
      {detalle && (
        <ModalDetalleFactura
          factura={detalle}
          canWrite={canWrite}
          onClose={() => setDetalle(null)}
          onCambiarEstatus={(nuevo) => handleCambiarEstatus(detalle.id, nuevo)}
        />
      )}

      {/* Modal: Compartir WhatsApp directo */}
      {whatsappFac && (
        <Modal
          title={`WhatsApp · Factura ${numeralFactura(whatsappFac.facturaNumero)}`}
          onClose={() => setWhatsappFac(null)}
          size="md"
        >
          <div style={{ padding: '0.5rem' }}>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
              Resumen de la factura, con su estado, para enviar al grupo o al proveedor:
            </p>
            <CompartirWhatsapp texto={mensajeFacturaExterna(whatsappFac)} />
          </div>
        </Modal>
      )}

      {/* ConfirmDialog de Borrado */}
      {facturaABorrar && canWrite && (
        <ConfirmDialog
          title="¿Borrar esta factura del buzón?"
          message={`Se borrará la factura ${numeralFactura(facturaABorrar.facturaNumero)} de ${facturaABorrar.proveedorNombre} con todos sus soportes.`}
          confirmText={borrandoFactura ? 'Borrando...' : 'Sí, borrar la factura'}
          danger
          onCancel={() => { if (!borrandoFactura) setFacturaABorrar(null); }}
          onConfirm={async () => {
            if (borrandoFactura) return;
            setBorrandoFactura(true);
            try {
              await eliminarFacturaBuzon(facturaABorrar);
              toast('Factura borrada', 'info');
              if (detalle?.id === facturaABorrar.id) setDetalle(null);
              setFacturaABorrar(null);
              void cargarDatos(false);
            } catch (e) {
              toast(motivoDeError(e), 'error');
              void cargarDatos(false);
            } finally {
              setBorrandoFactura(false);
            }
          }}
        />
      )}

      {/* Modal de Gestión de Empresas Receptoras */}
      {modalEmpresas && (
        <ModalGestionEmpresas
          empresas={empresas}
          facturas={facturas}
          canWrite={canWrite}
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

      {/* Identidad de la empresa — editor ÚNICO EmpresaEditor (C4b, modo identidad). Lo fiscal, en Parámetros. */}
      {empresaFichaEditar && canWrite && (
        <Modal title={`Empresa · ${empresaFichaEditar.nombreCorto || empresaFichaEditar.nombre}`} onClose={() => setEmpresaFichaEditar(null)} size="md">
          <EmpresaEditor
            modo="identidad"
            empresa={empresaFichaEditar}
            onClose={() => setEmpresaFichaEditar(null)}
            onGuardada={(actualizada) => {
              setEmpresaFichaEditar(null);
              void cargarDatos(false);
              toast(`Datos de ${actualizada.nombreCorto || actualizada.nombre} guardados`, 'success');
            }}
          />
        </Modal>
      )}

      {/* Modal de Reporte Fiscal por Empresa */}
      {empresaReporte && (
        <ModalReporteEmpresa
          empresa={empresaReporte}
          facturas={facturas.filter((f) => f.empresaId === empresaReporte.id)}
          onClose={() => setEmpresaReporte(null)}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Modal de Detalle de Factura y Visualizador de Soportes
   Los soportes se ven con enlaces firmados (válidos una hora),
   nunca con enlace público.
   ──────────────────────────────────────────────────────────── */
function ModalDetalleFactura({
  factura, canWrite, onClose, onCambiarEstatus,
}: {
  factura: FacturaBuzon;
  canWrite: boolean;
  onClose: () => void;
  onCambiarEstatus: (nuevo: EstatusFacturaBuzon) => void;
}) {
  // path → enlace firmado; null si no se pudo pedir (la miniatura avisa).
  const [urls, setUrls] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let vigente = true;
    setUrls({});
    void Promise.all(
      factura.adjuntos.map(async (a): Promise<[string, string | null]> => {
        try {
          return [a.path, await obtenerUrlAdjunto(a.path)];
        } catch {
          return [a.path, null];
        }
      }),
    ).then((pares) => {
      if (vigente) setUrls(Object.fromEntries(pares) as Record<string, string | null>);
    });
    return () => { vigente = false; };
  }, [factura.id, factura.adjuntos]);

  const abrirAdjunto = async (adj: AdjuntoFacturaItem) => {
    // La ventana se abre en el clic para que el navegador no la bloquee; el enlace se pide nuevo.
    const ventana = window.open('', '_blank');
    try {
      const url = await obtenerUrlAdjunto(adj.path);
      setUrls((prev) => ({ ...prev, [adj.path]: url }));
      if (ventana) {
        ventana.opener = null;
        ventana.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      ventana?.close();
      toast(motivoDeError(e, 'No se pudo abrir el archivo.'), 'error');
    }
  };

  const nombreAdjunto = (adj: AdjuntoFacturaItem) => adj.nombreOriginal || adj.nombre || 'Soporte';

  return (
    <Modal
      title={`Factura ${numeralFactura(factura.facturaNumero)} · ${factura.proveedorNombre}`}
      onClose={onClose}
      size="lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span className="buzon-card-empresa">
            🏢 {factura.empresaNombre || 'Empresa'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="muted" style={{ fontSize: '0.85rem' }}>Estado:</span>
            {canWrite ? (
              <select
                className="select sm"
                value={factura.estatus}
                onChange={(e) => onCambiarEstatus(e.target.value as EstatusFacturaBuzon)}
              >
                {ESTATUS_OPCIONES.map((op) => (
                  <option key={op.key} value={op.key}>
                    {op.icono} {op.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className={`buzon-estatus-pill buzon-estatus-${factura.estatus}`}>
                {rotuloEstadoBuzon(factura.estatus)}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem', background: 'var(--surface-2)', padding: '0.85rem', borderRadius: 'var(--r-md)' }}>
          <div>
            <small className="muted" style={{ display: 'block' }}>PROVEEDOR</small>
            <strong>{factura.proveedorNombre}</strong>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{factura.proveedorRif || 'Sin RIF'}</div>
          </div>
          <div>
            <small className="muted" style={{ display: 'block' }}>NÚMERO / CONTROL</small>
            <strong>Factura {numeralFactura(factura.facturaNumero)}</strong>
            {factura.facturaControl && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>N° de control: {factura.facturaControl}</div>
            )}
          </div>
          <div>
            <small className="muted" style={{ display: 'block' }}>FECHA DE LA FACTURA</small>
            <strong>{date(factura.facturaFecha)}</strong>
          </div>
          <div>
            <small className="muted" style={{ display: 'block' }}>MONTO TOTAL (BS)</small>
            <strong style={{ fontSize: '1.1rem' }}>{money(factura.montoBs, 'Bs')}</strong>
            {factura.moneda === 'USD' && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Factura en {money(factura.montoTotal, 'USD')}{factura.tasa ? ` · tasa ${num(factura.tasa)} Bs/$` : ''}
              </div>
            )}
            {factura.moneda === 'Bs' && factura.montoUsd != null && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>≈ {money(factura.montoUsd, 'USD')}</div>
            )}
          </div>
          <div>
            <small className="muted" style={{ display: 'block' }}>CARGADA</small>
            <strong>{date(factura.createdAt)}</strong>
            {factura.createdByName && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Por {factura.createdByName}</div>
            )}
          </div>
        </div>

        {factura.descripcion && (
          <div>
            <small className="muted" style={{ display: 'block', fontWeight: 700 }}>QUÉ SE COMPRÓ</small>
            <p style={{ margin: '0.2rem 0', background: 'var(--surface-1)', padding: '0.6rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
              {factura.descripcion}
            </p>
          </div>
        )}

        {factura.observaciones && (
          <div>
            <small className="muted" style={{ display: 'block', fontWeight: 700 }}>OBSERVACIONES</small>
            <p style={{ margin: '0.2rem 0', background: 'var(--surface-1)', padding: '0.6rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
              {factura.observaciones}
            </p>
          </div>
        )}

        <div>
          <small className="muted" style={{ display: 'block', fontWeight: 700, marginBottom: '0.4rem' }}>
            SOPORTES ({factura.adjuntos.length})
          </small>
          {factura.adjuntos.length === 0 ? (
            <p className="muted" style={{ fontStyle: 'italic', fontSize: '0.85rem' }}>No se adjuntaron fotos ni documentos.</p>
          ) : (
            <div className="buzon-thumbs-grid">
              {factura.adjuntos.map((adj) => {
                const esImg = adj.tipo === 'imagen';
                const url = urls[adj.path];
                const nombre = nombreAdjunto(adj);
                return (
                  <button
                    key={adj.id}
                    type="button"
                    className="buzon-thumb-item"
                    onClick={() => void abrirAdjunto(adj)}
                    title={`${nombre} (toca para abrirlo)`}
                    style={{ padding: 0, cursor: 'pointer' }}
                  >
                    {esImg && url ? (
                      <img src={url} alt={nombre} />
                    ) : (
                      <div className="buzon-thumb-pdf">
                        <span aria-hidden>{esImg ? '🖼' : '📄'}</span>
                        <small>
                          {esImg && url === undefined ? 'Cargando vista previa…' : esImg && url === null ? 'Sin vista previa: tócala para abrirla' : nombre}
                        </small>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.35rem' }}>
            💬 Compartir el resumen por WhatsApp:
          </div>
          <CompartirWhatsapp texto={mensajeFacturaExterna(factura)} />
        </div>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────
   Modal para Administrar Empresas Receptoras (Lista y Fichas)
   ──────────────────────────────────────────────────────────── */
function ModalGestionEmpresas({
  empresas, facturas, canWrite, onClose, onActualizado, onEditarFichaFiscal, onVerReporte,
}: {
  empresas: EmpresaReceptora[];
  facturas: FacturaBuzon[];
  canWrite: boolean;
  onClose: () => void;
  onActualizado: () => void;
  onEditarFichaFiscal: (emp: EmpresaReceptora) => void;
  onVerReporte: (emp: EmpresaReceptora) => void;
}) {
  // C4b: el alta rápida usa el editor único EmpresaEditor (modo rápido); acá solo el padrón (lista + borrar).
  const [empresaABorrar, setEmpresaABorrar] = useState<EmpresaReceptora | null>(null);
  const [borrando, setBorrando] = useState(false);

  const confirmarBorrado = async () => {
    if (!empresaABorrar || borrando) return;
    setBorrando(true);
    try {
      await eliminarEmpresaReceptora(empresaABorrar.id);
      toast('Empresa borrada', 'info');
      setEmpresaABorrar(null);
      onActualizado();
    } catch (err) {
      toast(motivoDeError(err), 'error');
      setEmpresaABorrar(null);
    } finally {
      setBorrando(false);
    }
  };

  return (
    <Modal title="Empresas que reciben facturas y su ficha fiscal" onClose={onClose} size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Cada empresa que recibe facturas tiene su ficha fiscal (RIF, domicilio, licencia y condición de agente de retención) y su propio reporte.
        </p>

        {/* Lista de empresas registradas */}
        {empresas.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontStyle: 'italic', fontSize: '0.85rem' }}>
            {canWrite
              ? 'Todavía no hay empresas cargadas. Agrega la primera abajo con su nombre y RIF.'
              : 'Todavía no hay empresas cargadas.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {empresas.map((emp) => {
              const tieneFichaCompleta = Boolean(emp.rif && emp.direccionFiscal);
              const cantidad = facturas.filter((f) => f.empresaId === emp.id).length;
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
                    opacity: emp.activo ? 1 : 0.7,
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
                          {tieneFichaCompleta ? '✅ Ficha completa' : '⚠️ Falta el domicilio fiscal'}
                        </span>
                        {!emp.activo && (
                          <span className="buzon-ficha-tag-incompleta">Desactivada: no aparece al cargar</span>
                        )}
                      </div>

                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                        RIF: <strong>{emp.rif || 'Sin RIF'}</strong>
                        {emp.municipio && ` · ${emp.municipio}${emp.estado ? `, ${emp.estado}` : ''}`}
                        {` · ${cantidad} ${cantidad === 1 ? 'factura' : 'facturas'}`}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    {canWrite && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => onEditarFichaFiscal(emp)}
                        title="Editar la ficha fiscal: domicilio, régimen y condición de agente"
                      >
                        ✏️ Ficha fiscal
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onVerReporte(emp)}
                      title="Ver el reporte de facturas de esta empresa"
                    >
                      📊 Reporte
                    </button>
                    {canWrite && (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => setEmpresaABorrar(emp)}
                        title="Borrar la empresa"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Agregar una empresa nueva — editor ÚNICO EmpresaEditor (C4b, modo rápido, crear) */}
        {canWrite && (
          <div style={{ background: 'var(--surface-1)', padding: '0.85rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
            <strong style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem' }}>➕ Agregar una empresa</strong>
            <EmpresaEditor modo="rapido" onGuardada={(emp) => { toast(`Empresa ${emp.nombreCorto || emp.nombre} agregada`, 'success'); onActualizado(); }} />
            <small className="muted" style={{ display: 'block', marginTop: '0.35rem', fontSize: '0.78rem' }}>
              El RIF se puede escribir con o sin guiones: se guarda completo. Después toca «✏️ Ficha fiscal» para el domicilio y contacto, y en Parámetros → Config fiscal por empresa la alícuota municipal, la licencia y la emisión.
            </small>
          </div>
        )}
      </div>

      {empresaABorrar && (
        <ConfirmDialog
          title="¿Borrar esta empresa?"
          message={`Se borrará «${empresaABorrar.nombre}». Si ya tiene facturas cargadas no se puede borrar: desactívala desde su ficha fiscal.`}
          confirmText={borrando ? 'Borrando...' : 'Sí, borrar la empresa'}
          danger
          onCancel={() => { if (!borrando) setEmpresaABorrar(null); }}
          onConfirm={() => void confirmarBorrado()}
        />
      )}
    </Modal>
  );
}


/* ────────────────────────────────────────────────────────────
   Modal de Reporte Fiscal por Empresa
   Solo arma el texto con lo que está en la base, para enviarlo por WhatsApp.
   ──────────────────────────────────────────────────────────── */
function ModalReporteEmpresa({
  empresa, facturas, onClose,
}: {
  empresa: EmpresaReceptora;
  facturas: FacturaBuzon[];
  onClose: () => void;
}) {
  const totalesEmpresa = useMemo(() => {
    const montos = totalizar(facturas);
    const proveedores = new Set(facturas.filter((f) => f.estatus !== 'descartada' && f.proveedorNombre).map((f) => f.proveedorNombre));
    return {
      ...montos,
      recibidas: facturas.filter((f) => f.estatus === 'recibida').length,
      enRevision: facturas.filter((f) => f.estatus === 'en_revision').length,
      retenidas: facturas.filter((f) => f.estatus === 'retenida').length,
      descartadas: facturas.filter((f) => f.estatus === 'descartada').length,
      total: facturas.length,
      proveedoresCount: proveedores.size,
    };
  }, [facturas]);

  const textoReporte = useMemo(() => {
    const lineas = [
      `📊 *REPORTE DE FACTURAS DEL BUZÓN*`,
      `🏢 *Empresa:* ${empresa.nombre}`,
      `🆔 *RIF:* ${empresa.rif || 'Sin RIF'}`,
      empresa.municipio ? `📍 *Ubicación:* ${empresa.municipio}${empresa.estado ? `, ${empresa.estado}` : ''}` : '',
      `📅 *Fecha del reporte:* ${date(hoyVenezuela())}`,
      `────────────────────────`,
      `📦 *Facturas cargadas:* ${totalesEmpresa.total}`,
      `📥 *Por revisar:* ${totalesEmpresa.recibidas} | ⏳ *En revisión:* ${totalesEmpresa.enRevision}`,
      `✅ *Retención hecha:* ${totalesEmpresa.retenidas} | ✖ *Descartadas:* ${totalesEmpresa.descartadas}`,
      `👥 *Proveedores:* ${totalesEmpresa.proveedoresCount}`,
      `🇻🇪 *Monto total (sin descartadas):* ${money(totalesEmpresa.bs, 'Bs')}`,
      totalesEmpresa.usd != null && totalesEmpresa.vigentes > 0 ? `💵 *Equivalente:* ${money(totalesEmpresa.usd, 'USD')}` : '',
      `────────────────────────`,
      `_Módulo de Retenciones_`,
    ];
    return lineas.filter(Boolean).join('\n');
  }, [empresa, totalesEmpresa]);

  return (
    <Modal title={`Reporte · ${empresa.nombreCorto || empresa.nombre}`} onClose={onClose} size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div style={{ background: 'var(--surface-2)', padding: '0.85rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <strong style={{ fontSize: '1.05rem', display: 'block' }}>{empresa.nombre}</strong>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                RIF: {empresa.rif || 'Sin RIF'} {empresa.municipio ? `· ${empresa.municipio}` : ''}
              </div>
            </div>
            <span style={{ color: empresa.colorBadge, fontSize: '1.5rem' }}>●</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginTop: '0.75rem', paddingTop: '0.6rem', borderTop: '1px solid var(--border)' }}>
            <div>
              <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>TOTAL FACTURADO (BS)</small>
              <strong style={{ fontSize: '1.2rem', color: 'var(--primary-2)' }}>{money(totalesEmpresa.bs, 'Bs')}</strong>
              <small className="muted" style={{ display: 'block', fontSize: '0.72rem' }}>Sin las descartadas</small>
            </div>
            {totalesEmpresa.usd != null && totalesEmpresa.vigentes > 0 && (
              <div>
                <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>EQUIVALENTE ($)</small>
                <strong style={{ fontSize: '1.2rem' }}>{money(totalesEmpresa.usd, 'USD')}</strong>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.5rem', textAlign: 'center' }}>
          <div style={{ background: 'var(--surface-1)', padding: '0.6rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{totalesEmpresa.total}</div>
            <small className="muted" style={{ fontSize: '0.75rem' }}>Facturas cargadas</small>
          </div>
          <div style={{ background: 'var(--surface-1)', padding: '0.6rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#2563eb' }}>{totalesEmpresa.recibidas}</div>
            <small className="muted" style={{ fontSize: '0.75rem' }}>Por revisar</small>
          </div>
          <div style={{ background: 'var(--surface-1)', padding: '0.6rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#d97706' }}>{totalesEmpresa.enRevision}</div>
            <small className="muted" style={{ fontSize: '0.75rem' }}>En revisión</small>
          </div>
          <div style={{ background: 'var(--surface-1)', padding: '0.6rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#059669' }}>{totalesEmpresa.retenidas}</div>
            <small className="muted" style={{ fontSize: '0.75rem' }}>Retención hecha</small>
          </div>
        </div>

        <div style={{ marginTop: '0.5rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.35rem' }}>
            📱 Enviar el resumen de la empresa por WhatsApp:
          </div>
          <CompartirWhatsapp texto={textoReporte} />
        </div>
      </div>
    </Modal>
  );
}
