/* ============================================================
   Golden Touch · Administración · Sección de Auditoría y Trazabilidad
   Consolida todo el historial de cambios, renovaciones, modificaciones
   y auditoría de documentos, empresas y asignaciones.
   ============================================================ */

import { useMemo, useState } from 'react';
import type { DocumentoEmpresa, Empresa } from './admin.repository';
import { extraerHistorialGlobalDocumentos } from './administracionCentrosResponsables';

interface Props {
  documentos: DocumentoEmpresa[];
  empresas: Empresa[];
  empresaClave?: string | null;
}

const fFechaHora = new Intl.DateTimeFormat('es-VE', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function AuditoriaTab({
  documentos,
  empresas,
  empresaClave,
}: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [filtroAccion, setFiltroAccion] = useState<string>('todas');
  const [empresaFiltro, setEmpresaFiltro] = useState<string>(empresaClave || 'todas');

  // Filtrar documentos según empresa seleccionada
  const docsEfectivos = useMemo(() => {
    if (empresaFiltro !== 'todas') {
      return documentos.filter((d) => d.empresaClave === empresaFiltro);
    }
    return documentos;
  }, [documentos, empresaFiltro]);

  // Historial global extraído
  const historialCompleto = useMemo(() => {
    return extraerHistorialGlobalDocumentos(docsEfectivos, busqueda);
  }, [docsEfectivos, busqueda]);

  // Filtrado por acción
  const historialFiltrado = useMemo(() => {
    if (filtroAccion === 'todas') return historialCompleto;
    return historialCompleto.filter((h) => h.accion === filtroAccion);
  }, [historialCompleto, filtroAccion]);

  // Métricas rápidas de auditoría
  const kpis = useMemo(() => {
    let renovaciones = 0;
    let creaciones = 0;
    let modificaciones = 0;
    let cambiosStatus = 0;

    for (const h of historialCompleto) {
      if (h.accion === 'renovacion') renovaciones += 1;
      else if (h.accion === 'creacion') creaciones += 1;
      else if (h.accion === 'cambio_status') cambiosStatus += 1;
      else modificaciones += 1;
    }

    return {
      total: historialCompleto.length,
      renovaciones,
      creaciones,
      modificaciones,
      cambiosStatus,
    };
  }, [historialCompleto]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '.75rem' }}>
      {/* Header y Resumen de Auditoría */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>📜 Auditoría y Trazabilidad del Módulo</h2>
            <p className="muted hint" style={{ margin: '.2rem 0 0', fontSize: '.82rem' }}>
              Bitácora cronológica inmutable: quién modificó, cuándo, renovaciones realizadas y soportes actualizados.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
            <span className="badge" style={{ fontSize: '.78rem', background: 'rgba(255,255,255,0.06)' }}>
              Total registros: <strong>{kpis.total}</strong>
            </span>
          </div>
        </div>

        {/* Tarjetas de Métricas de Auditoría */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.6rem', marginTop: '1rem' }}>
          <div
            className="kpi-card"
            style={{
              padding: '.7rem .9rem',
              borderRadius: '6px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              borderColor: filtroAccion === 'renovacion' ? '#ff8a00' : undefined,
            }}
            onClick={() => setFiltroAccion(filtroAccion === 'renovacion' ? 'todas' : 'renovacion')}
          >
            <div className="muted hint" style={{ fontSize: '.72rem' }}>🔄 Renovaciones</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#10b981' }}>{kpis.renovaciones}</div>
          </div>

          <div
            className="kpi-card"
            style={{
              padding: '.7rem .9rem',
              borderRadius: '6px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              borderColor: filtroAccion === 'creacion' ? '#ff8a00' : undefined,
            }}
            onClick={() => setFiltroAccion(filtroAccion === 'creacion' ? 'todas' : 'creacion')}
          >
            <div className="muted hint" style={{ fontSize: '.72rem' }}>➕ Altas / Creaciones</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#38bdf8' }}>{kpis.creaciones}</div>
          </div>

          <div
            className="kpi-card"
            style={{
              padding: '.7rem .9rem',
              borderRadius: '6px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              borderColor: filtroAccion === 'modificacion' ? '#ff8a00' : undefined,
            }}
            onClick={() => setFiltroAccion(filtroAccion === 'modificacion' ? 'todas' : 'modificacion')}
          >
            <div className="muted hint" style={{ fontSize: '.72rem' }}>✏️ Modificaciones</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f59e0b' }}>{kpis.modificaciones}</div>
          </div>

          <div
            className="kpi-card"
            style={{
              padding: '.7rem .9rem',
              borderRadius: '6px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              borderColor: filtroAccion === 'cambio_status' ? '#ff8a00' : undefined,
            }}
            onClick={() => setFiltroAccion(filtroAccion === 'cambio_status' ? 'todas' : 'cambio_status')}
          >
            <div className="muted hint" style={{ fontSize: '.72rem' }}>🏷️ Cambios de Estatus</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#c084fc' }}>{kpis.cambiosStatus}</div>
          </div>
        </div>
      </div>

      {/* Controles de Filtros */}
      <div className="card" style={{ padding: '.75rem 1rem' }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {empresas.length > 1 && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
                <span className="muted hint">Empresa</span>
                <select
                  className="input input-sm"
                  value={empresaFiltro}
                  onChange={(e) => setEmpresaFiltro(e.target.value)}
                  style={{ minWidth: 160 }}
                >
                  <option value="todas">Todas las empresas</option>
                  {empresas.map((em) => (
                    <option key={em.id} value={em.clave}>{em.nombre}</option>
                  ))}
                </select>
              </label>
            )}

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
              <span className="muted hint">Acción</span>
              <select
                className="input input-sm"
                value={filtroAccion}
                onChange={(e) => setFiltroAccion(e.target.value)}
                style={{ minWidth: 150 }}
              >
                <option value="todas">Todas las acciones</option>
                <option value="renovacion">🔄 Solo Renovaciones</option>
                <option value="creacion">➕ Solo Creaciones</option>
                <option value="modificacion">✏️ Solo Modificaciones</option>
                <option value="cambio_status">🏷️ Cambios de Estatus</option>
              </select>
            </label>
          </div>

          <input
            type="search"
            className="input input-sm"
            placeholder="🔍 Buscar por usuario, documento o detalle…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{ minWidth: 260, fontSize: '.78rem' }}
          />
        </div>
      </div>

      {/* Tabla de Eventos de Auditoría */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {historialFiltrado.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center' }}>
            <span style={{ fontSize: '2rem' }}>📜</span>
            <p className="muted" style={{ margin: '.5rem 0 0', fontSize: '.85rem' }}>
              No se encontraron eventos de auditoría con los filtros seleccionados.
            </p>
          </div>
        ) : (
          <div className="adm-tabla" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 1 }}>
                <tr>
                  <th>Fecha y Hora</th>
                  <th>Actor (Usuario)</th>
                  <th>Documento / Permiso</th>
                  <th>Empresa</th>
                  <th>Tipo de Acción</th>
                  <th>Detalle de la Operación</th>
                </tr>
              </thead>
              <tbody>
                {historialFiltrado.map((h) => {
                  const esRenovacion = h.accion === 'renovacion';
                  const esCreacion = h.accion === 'creacion';
                  const badgeColor = esRenovacion ? '#10b981' : esCreacion ? '#38bdf8' : '#f59e0b';
                  const badgeBg = esRenovacion ? 'rgba(16,185,129,0.12)' : esCreacion ? 'rgba(56,189,248,0.12)' : 'rgba(245,158,11,0.12)';

                  return (
                    <tr key={h.id}>
                      <td className="mono" style={{ fontSize: '.74rem', whiteSpace: 'nowrap' }}>
                        {fFechaHora.format(new Date(h.fecha))}
                      </td>
                      <td>
                        <strong style={{ color: '#ff8a00', fontSize: '.82rem' }}>👤 {h.actor}</strong>
                      </td>
                      <td>
                        <div>
                          <strong style={{ fontSize: '.82rem', color: 'var(--text)' }}>{h.documentoNombre}</strong>
                          <div className="muted" style={{ fontSize: '.7rem' }}>{h.tipoLabel}</div>
                        </div>
                      </td>
                      <td>
                        <span className="badge" style={{ fontSize: '.7rem' }}>🏢 {h.empresaClave}</span>
                      </td>
                      <td>
                        <span
                          className="adm-chip"
                          style={{
                            fontSize: '.7rem',
                            color: badgeColor,
                            background: badgeBg,
                            borderColor: badgeColor,
                            fontWeight: 600,
                          }}
                        >
                          {esRenovacion ? '🔄 Renovación' : esCreacion ? '➕ Creación' : h.accion}
                        </span>
                      </td>
                      <td style={{ fontSize: '.78rem', color: 'var(--text)', maxWidth: 400 }}>
                        {h.detalle}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
