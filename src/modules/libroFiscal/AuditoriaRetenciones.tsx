/* ============================================================
   Golden Touch · Retenciones · Pestaña de Auditoría Fiscal (v8)
   Diseño conciso y explícito para control y fiscalización tributaria.
   Muestra la traza completa de:
   - Emisiones de comprobantes
   - Anulaciones (con motivo explícito)
   - Cierres de período (declaraciones con candado fiscal)
   - Reaperturas de período (con justificación auditada)
   - Decisiones de «No aplica»
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { money, montoMoneda } from '@/shared/lib/format';
import { norm } from '@/shared/lib/texto';
import {
  calcularResumenAuditoria, listEventosAuditoria,
  type AccionAuditoria, type EventoAuditoriaFiscal, type ResumenAuditoria,
} from './auditoriaRetenciones.repository';
import { rotuloImpuesto } from './rotulos';

function formatFechaHoraVE(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true, timeZone: 'America/Caracas',
  }).format(d);
}

function tiempoRelativo(iso: string): string {
  if (!iso) return '';
  const ahora = new Date().getTime();
  const luego = new Date(iso).getTime();
  if (Number.isNaN(luego)) return '';
  const diffHoras = Math.round((ahora - luego) / (1000 * 60 * 60));
  if (diffHoras < 1) return 'Hace momentos';
  if (diffHoras < 24) return `Hace ${diffHoras} h`;
  const diffDias = Math.round(diffHoras / 24);
  if (diffDias === 1) return 'Ayer';
  if (diffDias <= 7) return `Hace ${diffDias} días`;
  return '';
}

const ACCIONES: { key: AccionAuditoria | ''; label: string }[] = [
  { key: '', label: 'Todos los eventos' },
  { key: 'emision', label: 'Emisiones' },
  { key: 'anulacion', label: 'Anulaciones' },
  { key: 'cierre', label: 'Cierres de período' },
  { key: 'reapertura', label: 'Reaperturas' },
  { key: 'no_aplica', label: '«No aplica»' },
];

const IMPUESTOS = [
  { key: '', label: 'Todos los impuestos' },
  { key: 'IVA', label: 'IVA' },
  { key: 'ISLR', label: 'ISLR' },
  { key: 'MUNICIPAL', label: 'ISAE (Municipal)' },
  { key: 'ESTADAL', label: 'Estadal (Timbre)' },
  { key: 'IGTF', label: 'IGTF' },
];

export function AuditoriaRetenciones() {
  const [eventos, setEventos] = useState<EventoAuditoriaFiscal[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [filtroTipo, setFiltroTipo] = useState<AccionAuditoria | ''>('');
  const [filtroImpuesto, setFiltroImpuesto] = useState('');
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');

  // Paginación
  const [pag, setPag] = useState(1);
  const TAM_PAG = 25;

  // Detalle modal
  const [eventoSeleccionado, setEventoSeleccionado] = useState<EventoAuditoriaFiscal | null>(null);

  const cargar = useCallback(async () => {
    try {
      setCargando(true);
      const data = await listEventosAuditoria();
      setEventos(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar los eventos de auditoría');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Actualización en tiempo real
  useRealtime(['retenciones', 'retencion_periodos', 'retencion_decisiones'], () => {
    void cargar();
  });

  const resumen: ResumenAuditoria = useMemo(() => {
    return calcularResumenAuditoria(eventos ?? []);
  }, [eventos]);

  const filtrados = useMemo(() => {
    if (!eventos) return [];
    const txt = norm(filtroTexto);

    return eventos.filter((e) => {
      if (filtroTipo && e.tipo !== filtroTipo) return false;
      if (filtroImpuesto && e.impuesto && !e.impuesto.toUpperCase().includes(filtroImpuesto.toUpperCase())) return false;

      const fDate = e.fechaIso.slice(0, 10);
      if (filtroDesde && fDate && fDate < filtroDesde) return false;
      if (filtroHasta && fDate && fDate > filtroHasta) return false;

      if (txt) {
        const bolsa = norm(
          `${e.referencia} ${e.titulo} ${e.usuario} ${e.contraparte?.nombre ?? ''} ${e.contraparte?.rif ?? ''} ` +
          `${e.documentoFiscal?.factura ?? ''} ${e.motivo ?? ''} ${e.detalle ?? ''}`
        );
        if (!bolsa.includes(txt)) return false;
      }

      return true;
    });
  }, [eventos, filtroTipo, filtroImpuesto, filtroDesde, filtroHasta, filtroTexto]);

  useEffect(() => {
    setPag(1);
  }, [filtroTipo, filtroImpuesto, filtroDesde, filtroHasta, filtroTexto]);

  const totalPags = Math.ceil(filtrados.length / TAM_PAG) || 1;
  const paginaActual = useMemo(() => {
    const inicio = (pag - 1) * TAM_PAG;
    return filtrados.slice(inicio, inicio + TAM_PAG);
  }, [filtrados, pag]);

  function exportarCsv() {
    if (!filtrados.length) return;
    const cabecera = ['Fecha y Hora', 'Tipo de Acción', 'Impuesto', 'Referencia / N°', 'Factura N°', 'Proveedor / Sujeto', 'RIF', 'Monto Retenido', 'Usuario Responsable', 'Motivo / Justificación'];
    const lineas = filtrados.map((e) => [
      formatFechaHoraVE(e.fechaIso),
      e.tipo.toUpperCase(),
      e.impuesto ?? '',
      `"${e.referencia.replace(/"/g, '""')}"`,
      `"${(e.documentoFiscal?.factura ?? '').replace(/"/g, '""')}"`,
      `"${(e.contraparte?.nombre ?? '').replace(/"/g, '""')}"`,
      e.contraparte?.rif ?? '',
      e.monto?.retenidoBs != null ? `${e.monto.retenidoBs} Bs` : (e.monto?.retenido != null ? `${e.monto.retenido} ${e.monto.moneda}` : ''),
      `"${e.usuario.replace(/"/g, '""')}"`,
      `"${(e.motivo || e.detalle || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = '\uFEFF' + [cabecera.join(','), ...lineas.map((l) => l.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `auditoria-retenciones-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Relación de auditoría exportada en CSV', 'success');
  }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* ── Encabezado y Explicación ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '.8rem', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span>🛡️</span> Auditoría Fiscal de Retenciones
          </h3>
          <p className="muted" style={{ margin: '.25rem 0 0', fontSize: '.84rem' }}>
            Trazabilidad explícita de emisiones, anulaciones, declaraciones de período, reaperturas y decisiones de exención.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()} disabled={cargando}>
            {cargando ? 'Actualizando…' : '🔄 Actualizar traza'}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={exportarCsv} disabled={!filtrados.length}>
            ↓ Exportar CSV
          </button>
        </div>
      </div>

      {/* ── Tarjetas Resumen (KPIs) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: '.6rem',
        marginBottom: '1rem',
      }}>
        <div className="card" style={{ padding: '.65rem .85rem', margin: 0, borderLeft: '4px solid var(--primary, #3b82f6)' }}>
          <div className="muted" style={{ fontSize: '.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Total Eventos</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 2 }}>{resumen.total}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>Traza fiscal consolidada</div>
        </div>
        <div className="card" style={{ padding: '.65rem .85rem', margin: 0, borderLeft: '4px solid var(--success, #22c55e)' }}>
          <div className="muted" style={{ fontSize: '.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Emisiones</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 2, color: 'var(--success, #22c55e)' }}>{resumen.emisiones}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>Comprobantes emitidos</div>
        </div>
        <div className="card" style={{ padding: '.65rem .85rem', margin: 0, borderLeft: '4px solid var(--danger, #ef4444)' }}>
          <div className="muted" style={{ fontSize: '.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Anulaciones</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 2, color: 'var(--danger, #ef4444)' }}>{resumen.anulaciones}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>Comprobantes anulados</div>
        </div>
        <div className="card" style={{ padding: '.65rem .85rem', margin: 0, borderLeft: '4px solid #3b82f6' }}>
          <div className="muted" style={{ fontSize: '.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Cierres (Declarados)</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 2, color: '#3b82f6' }}>{resumen.cierres}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>Períodos bajo candado</div>
        </div>
        <div className="card" style={{ padding: '.65rem .85rem', margin: 0, borderLeft: '4px solid var(--warning, #f59e0b)' }}>
          <div className="muted" style={{ fontSize: '.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Reaperturas</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 2, color: 'var(--warning, #f59e0b)' }}>{resumen.reaperturas}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>Desbloqueos con motivo</div>
        </div>
        <div className="card" style={{ padding: '.65rem .85rem', margin: 0, borderLeft: '4px solid #8b5cf6' }}>
          <div className="muted" style={{ fontSize: '.75rem', fontWeight: 600, textTransform: 'uppercase' }}>«No Aplica»</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 2, color: '#8b5cf6' }}>{resumen.noAplica}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>Exenciones tributarias</div>
        </div>
      </div>

      {/* ── Barra de Filtros ── */}
      <div className="card" style={{ padding: '.75rem', marginBottom: '1rem', background: 'var(--bg-2, rgba(255,255,255,0.03))' }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Selector de Acción */}
          <div role="group" aria-label="Filtro tipo de acción" style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
            {ACCIONES.map((a) => (
              <button
                key={a.key || 'todos'}
                type="button"
                className={`btn btn-sm ${filtroTipo === a.key ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFiltroTipo(a.key)}
                style={{ fontSize: '.78rem', padding: '3px 8px' }}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Filtro por Impuesto */}
            <select
              className="select"
              value={filtroImpuesto}
              onChange={(e) => setFiltroImpuesto(e.target.value)}
              style={{ fontSize: '.8rem', padding: '3px 8px', maxWidth: 170 }}
              aria-label="Filtrar por impuesto"
            >
              {IMPUESTOS.map((i) => (
                <option key={i.key} value={i.key}>{i.label}</option>
              ))}
            </select>

            {/* Rango de fechas */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
              <input
                type="date"
                className="input"
                value={filtroDesde}
                onChange={(e) => setFiltroDesde(e.target.value)}
                style={{ fontSize: '.78rem', padding: '2px 6px', maxWidth: 130 }}
                aria-label="Fecha desde"
                title="Fecha desde"
              />
              <span className="muted" style={{ fontSize: '.75rem' }}>–</span>
              <input
                type="date"
                className="input"
                value={filtroHasta}
                onChange={(e) => setFiltroHasta(e.target.value)}
                style={{ fontSize: '.78rem', padding: '2px 6px', maxWidth: 130 }}
                aria-label="Fecha hasta"
                title="Fecha hasta"
              />
            </div>

            {/* Buscador de texto */}
            <input
              type="search"
              className="input"
              placeholder="Buscar comprobante, proveedor, motivo, usuario…"
              value={filtroTexto}
              onChange={(e) => setFiltroTexto(e.target.value)}
              style={{ fontSize: '.8rem', padding: '3px 8px', minWidth: 220 }}
            />

            {(filtroTipo || filtroImpuesto || filtroDesde || filtroHasta || filtroTexto) && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setFiltroTipo('');
                  setFiltroImpuesto('');
                  setFiltroDesde('');
                  setFiltroHasta('');
                  setFiltroTexto('');
                }}
                style={{ fontSize: '.76rem', color: 'var(--text-muted)' }}
              >
                Limpiar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Contenido Principal / Tabla de Eventos ── */}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          <strong>Error de carga:</strong> {error}
        </div>
      )}

      {cargando && !eventos && (
        <p className="muted" style={{ textAlign: 'center', padding: '2rem' }}>Consultando eventos de auditoría fiscal…</p>
      )}

      {!cargando && filtrados.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🛡️</div>
          <strong>No hay eventos que coincidan con los filtros</strong>
          <p className="muted" style={{ fontSize: '.84rem', margin: '.3rem 0 0' }}>
            Prueba ajustando el rango de fechas o los términos de búsqueda.
          </p>
        </div>
      )}

      {filtrados.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '.82rem', margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 140 }}>Fecha / Hora</th>
                  <th style={{ minWidth: 130 }}>Acción Fiscal</th>
                  <th style={{ minWidth: 180 }}>Referencia / Comprobante</th>
                  <th style={{ minWidth: 160 }}>Contraparte / Sujeto</th>
                  <th style={{ minWidth: 120 }}>Monto / Impacto</th>
                  <th style={{ minWidth: 200 }}>Motivo / Justificación Explícita</th>
                  <th style={{ minWidth: 130 }}>Responsable</th>
                  <th style={{ width: 60, textAlign: 'center' }} aria-label="Detalle" />
                </tr>
              </thead>
              <tbody>
                {paginaActual.map((e) => {
                  const rel = tiempoRelativo(e.fechaIso);
                  return (
                    <tr
                      key={e.id}
                      style={{
                        background: e.tipo === 'anulacion'
                          ? 'rgba(239, 68, 68, 0.04)'
                          : e.tipo === 'reapertura'
                            ? 'rgba(245, 158, 11, 0.04)'
                            : undefined,
                      }}
                    >
                      {/* Fecha y Hora */}
                      <td>
                        <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {formatFechaHoraVE(e.fechaIso)}
                        </div>
                        {rel && <span className="muted" style={{ fontSize: '.7rem' }}>{rel}</span>}
                      </td>

                      {/* Acción con Badge semántico */}
                      <td>
                        <BadgeAccion tipo={e.tipo} impuesto={e.impuesto} />
                      </td>

                      {/* Referencia y Documento Fiscal */}
                      <td>
                        <strong style={{ display: 'block', color: 'var(--text)' }}>
                          {e.referencia}
                        </strong>
                        {e.documentoFiscal?.factura && !e.referencia.includes(e.documentoFiscal.factura) && (
                          <span className="muted" style={{ fontSize: '.74rem', display: 'block' }}>
                            Factura N° {e.documentoFiscal.factura}
                            {e.documentoFiscal.control ? ` · Control ${e.documentoFiscal.control}` : ''}
                          </span>
                        )}
                        {e.documentoFiscal?.control && (!e.documentoFiscal?.factura || e.referencia.includes(e.documentoFiscal.factura)) && (
                          <span className="muted" style={{ fontSize: '.74rem', display: 'block' }}>
                            Control N° {e.documentoFiscal.control}
                          </span>
                        )}
                        {e.documentoFiscal?.origen && (
                          <div style={{ fontSize: '.7rem', marginTop: 2 }}>
                            <span style={{
                              background: e.documentoFiscal.origen.includes('Manual') ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.06)',
                              color: e.documentoFiscal.origen.includes('Manual') ? 'var(--warning, #f59e0b)' : 'var(--text-muted)',
                              padding: '1px 5px', borderRadius: 3, fontWeight: 500,
                            }}>
                              {e.documentoFiscal.origen}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Contraparte / Sujeto retenido */}
                      <td>
                        {e.contraparte ? (
                          <div>
                            <span style={{ fontWeight: 600, display: 'block' }}>{e.contraparte.nombre}</span>
                            {e.contraparte.rif && <span className="muted mono" style={{ fontSize: '.72rem' }}>{e.contraparte.rif}</span>}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>

                      {/* Monto / Impacto */}
                      <td>
                        {e.monto ? (
                          <div>
                            <strong style={{ display: 'block', color: e.tipo === 'anulacion' ? 'var(--danger)' : undefined }}>
                              {e.monto.retenidoBs != null ? `${money(e.monto.retenidoBs)} Bs` : montoMoneda(e.monto.retenido, e.monto.moneda)}
                            </strong>
                            {e.monto.moneda === 'USD' && e.monto.retenidoBs != null && (
                              <span className="muted" style={{ fontSize: '.72rem' }}>
                                ({money(e.monto.retenido)} $)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>

                      {/* Motivo Explícito de Auditoría */}
                      <td>
                        {e.motivo ? (
                          <div style={{
                            padding: '3px 7px',
                            borderRadius: 4,
                            background: e.tipo === 'anulacion'
                              ? 'rgba(239, 68, 68, 0.12)'
                              : e.tipo === 'reapertura'
                                ? 'rgba(245, 158, 11, 0.12)'
                                : 'rgba(255, 255, 255, 0.05)',
                            borderLeft: `3px solid ${e.tipo === 'anulacion' ? 'var(--danger)' : e.tipo === 'reapertura' ? 'var(--warning)' : 'var(--primary)'}`,
                            fontSize: '.76rem',
                            lineHeight: 1.35,
                          }}>
                            <strong style={{ display: 'block', fontSize: '.7rem', textTransform: 'uppercase', opacity: 0.85 }}>
                              {e.tipo === 'anulacion' ? 'Motivo de Anulación:' : e.tipo === 'reapertura' ? 'Motivo de Reapertura:' : 'Justificación:'}
                            </strong>
                            <span>{e.motivo}</span>
                          </div>
                        ) : e.detalle ? (
                          <span className="muted" style={{ fontSize: '.76rem' }}>{e.detalle}</span>
                        ) : (
                          <span className="muted" style={{ fontSize: '.74rem' }}>Operación regular</span>
                        )}
                      </td>

                      {/* Usuario Responsable */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                          <span>👤</span>
                          <span style={{ fontWeight: 500 }}>{e.usuario}</span>
                        </div>
                      </td>

                      {/* Botón Ver Detalle */}
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          title="Ver ficha técnica completa del evento de auditoría"
                          onClick={() => setEventoSeleccionado(e)}
                          style={{ padding: '2px 6px', fontSize: '.75rem' }}
                        >
                          👁️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Paginador ── */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '.6rem .9rem',
            borderTop: '1px solid var(--border)',
            fontSize: '.8rem',
            background: 'var(--bg-2, rgba(255,255,255,0.02))',
          }}>
            <span className="muted">
              Mostrando {paginaActual.length} de {filtrados.length} evento{filtrados.length === 1 ? '' : 's'}
            </span>
            <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setPag((p) => Math.max(1, p - 1))}
                disabled={pag <= 1}
              >
                ‹ Anterior
              </button>
              <strong style={{ minWidth: 60, textAlign: 'center' }}>
                Página {pag} / {totalPags}
              </strong>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setPag((p) => Math.min(totalPags, p + 1))}
                disabled={pag >= totalPags}
              >
                Siguiente ›
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de Detalle Técnico / Ficha Fiscal ── */}
      {eventoSeleccionado && (
        <Modal
          title={`Ficha de Auditoría · ${eventoSeleccionado.referencia}`}
          size="md"
          onClose={() => setEventoSeleccionado(null)}
          footer={(
            <button type="button" className="btn btn-primary" onClick={() => setEventoSeleccionado(null)}>
              Cerrar
            </button>
          )}
        >
          <div style={{ fontSize: '.86rem', display: 'flex', flexDirection: 'column', gap: '.8rem' }}>
            <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
              <BadgeAccion tipo={eventoSeleccionado.tipo} impuesto={eventoSeleccionado.impuesto} grande />
              <div className="muted" style={{ fontSize: '.8rem' }}>
                {formatFechaHoraVE(eventoSeleccionado.fechaIso)}
              </div>
            </div>

            <div className="card" style={{ margin: 0, background: 'var(--bg-2)' }}>
              <strong style={{ display: 'block', fontSize: '.95rem', marginBottom: '.3rem' }}>
                {eventoSeleccionado.titulo}
              </strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem .8rem', fontSize: '.82rem' }}>
                <div><span className="muted">Usuario responsable:</span> <strong>{eventoSeleccionado.usuario}</strong></div>
                <div><span className="muted">Impuesto:</span> <strong>{rotuloImpuesto(eventoSeleccionado.impuesto)}</strong></div>
                {eventoSeleccionado.documentoFiscal?.factura && (
                  <div><span className="muted">Factura afectada:</span> <strong>N° {eventoSeleccionado.documentoFiscal.factura}</strong></div>
                )}
                {eventoSeleccionado.documentoFiscal?.control && (
                  <div><span className="muted">N° de Control:</span> <strong>{eventoSeleccionado.documentoFiscal.control}</strong></div>
                )}
                {eventoSeleccionado.documentoFiscal?.origen && (
                  <div><span className="muted">Origen de compra:</span> <strong>{eventoSeleccionado.documentoFiscal.origen}</strong></div>
                )}
                {eventoSeleccionado.contraparte?.nombre && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span className="muted">Sujeto retenido / Proveedor:</span>{' '}
                    <strong>{eventoSeleccionado.contraparte.nombre}</strong>
                    {eventoSeleccionado.contraparte.rif && <span className="mono"> ({eventoSeleccionado.contraparte.rif})</span>}
                  </div>
                )}
              </div>
            </div>

            {eventoSeleccionado.monto && (
              <div className="card" style={{ margin: 0 }}>
                <strong style={{ display: 'block', fontSize: '.84rem', marginBottom: '.3rem' }}>Detalle de Montos</strong>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  {eventoSeleccionado.monto.base != null && (
                    <div><span className="muted" style={{ fontSize: '.75rem', display: 'block' }}>Base imponible</span><strong>{money(eventoSeleccionado.monto.base)} {eventoSeleccionado.monto.moneda}</strong></div>
                  )}
                  {eventoSeleccionado.monto.pct != null && (
                    <div><span className="muted" style={{ fontSize: '.75rem', display: 'block' }}>% Retención</span><strong>{eventoSeleccionado.monto.pct} %</strong></div>
                  )}
                  <div>
                    <span className="muted" style={{ fontSize: '.75rem', display: 'block' }}>Total Retenido</span>
                    <strong style={{ fontSize: '1.05rem', color: eventoSeleccionado.tipo === 'anulacion' ? 'var(--danger)' : 'var(--primary)' }}>
                      {eventoSeleccionado.monto.retenidoBs != null ? `${money(eventoSeleccionado.monto.retenidoBs)} Bs` : montoMoneda(eventoSeleccionado.monto.retenido, eventoSeleccionado.monto.moneda)}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {(eventoSeleccionado.motivo || eventoSeleccionado.detalle) && (
              <div className="card" style={{
                margin: 0,
                background: eventoSeleccionado.tipo === 'anulacion'
                  ? 'rgba(239, 68, 68, 0.08)'
                  : eventoSeleccionado.tipo === 'reapertura'
                    ? 'rgba(245, 158, 11, 0.08)'
                    : 'var(--bg-2)',
                borderColor: eventoSeleccionado.tipo === 'anulacion'
                  ? 'var(--danger)'
                  : eventoSeleccionado.tipo === 'reapertura'
                    ? 'var(--warning)'
                    : 'var(--border)',
              }}>
                <strong style={{ display: 'block', fontSize: '.85rem', marginBottom: '.25rem' }}>
                  {eventoSeleccionado.motivo ? 'Motivo y Justificación Legal Registrada' : 'Detalles de la Acción'}
                </strong>
                <p style={{ margin: 0, fontSize: '.84rem', lineHeight: 1.45 }}>
                  {eventoSeleccionado.motivo || eventoSeleccionado.detalle}
                </p>
                {eventoSeleccionado.motivo && eventoSeleccionado.detalle && (
                  <p className="muted" style={{ margin: '.4rem 0 0', fontSize: '.78rem' }}>
                    {eventoSeleccionado.detalle}
                  </p>
                )}
              </div>
            )}

            <div className="muted" style={{ fontSize: '.72rem', textAlign: 'right' }}>
              Identificador único de traza: <code className="mono">{eventoSeleccionado.id}</code>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BadgeAccion({ tipo, impuesto, grande }: { tipo: AccionAuditoria; impuesto: string | null; grande?: boolean }) {
  const estilo = useMemo(() => {
    switch (tipo) {
      case 'emision':
        return { bg: 'rgba(34, 197, 94, 0.15)', color: 'var(--success, #22c55e)', border: '1px solid rgba(34, 197, 94, 0.3)', icono: '🟢', label: 'EMISIÓN' };
      case 'anulacion':
        return { bg: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger, #ef4444)', border: '1px solid rgba(239, 68, 68, 0.3)', icono: '🔴', label: 'ANULACIÓN' };
      case 'cierre':
        return { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)', icono: '🔒', label: 'CIERRE DECLARADO' };
      case 'reapertura':
        return { bg: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning, #f59e0b)', border: '1px solid rgba(245, 158, 11, 0.3)', icono: '🔓', label: 'REAPERTURA' };
      case 'no_aplica':
        return { bg: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6', border: '1px solid rgba(139, 92, 246, 0.3)', icono: '⚖️', label: 'NO APLICA' };
      default:
        return { bg: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-muted)', border: '1px solid var(--border)', icono: '📋', label: 'REGISTRO' };
    }
  }, [tipo]);

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '.3rem',
        padding: grande ? '3px 8px' : '1px 6px',
        borderRadius: 4,
        fontSize: grande ? '.78rem' : '.72rem',
        fontWeight: 700,
        background: estilo.bg,
        color: estilo.color,
        border: estilo.border,
        whiteSpace: 'nowrap',
      }}
    >
      <span>{estilo.icono}</span>
      <span>{estilo.label}</span>
      {impuesto && <span style={{ opacity: 0.85, fontWeight: 500 }}>· {impuesto}</span>}
    </span>
  );
}
