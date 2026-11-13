/* ============================================================
   MGG · Conciliación · Tab de ENTRADAS DE RETENCIÓN (13-11-2026)

   Muestra la lista de órdenes con retención, su estado de reintegro,
   cruce con el libro de Caja Multimoneda y formulario para registrar
   la entrada bancaria con su comprobante.
   ============================================================ */
import { useState, useMemo } from 'react';
import { toast } from '@/shared/ui/Toast';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { urlAdjuntoOc } from '@/modules/pedidos/pedidos.repository';
import type { Orden } from '@/shared/lib/types';
import {
  filtrarEntradas, tarjetasEntradas, type FilaEntradaRetencion, type FiltrosEntradasRetencion,
} from './conciliacionEntradas';
import { RegistrarReintegroModal } from './RegistrarReintegroModal';

const fmtBs = (n: number | null | undefined) =>
  Number.isFinite(n) ? `Bs ${(n as number).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

const fmtUsd = (n: number | null | undefined) =>
  Number.isFinite(n) ? `$ ${(n as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

const COLOR_TIPO: Record<string, { bg: string; color: string }> = {
  IVA: { bg: '#dbeafe', color: '#1e40af' },
  ISLR: { bg: '#ffedd5', color: '#9a3412' },
  ISAE: { bg: '#f3e8ff', color: '#6b21a8' },
  IGTF: { bg: '#fef3c7', color: '#92400e' },
  RETENCIÓN: { bg: '#f1f5f9', color: '#475569' },
};

export function ConciliacionEntradasTab({
  filas,
  puedeEditar,
  onActualizarOrden,
  onVerOc,
}: {
  filas: FilaEntradaRetencion[];
  puedeEditar: boolean;
  onActualizarOrden: (o: Orden) => void;
  onVerOc: (id: string) => void;
}) {
  const [filtros, setFiltros] = useState<FiltrosEntradasRetencion>({
    busqueda: '',
    estado: 'todos',
    tipoRetencion: 'todos',
    drive: 'todos',
  });
  const [editandoFila, setEditandoFila] = useState<FilaEntradaRetencion | null>(null);
  const [abriendoDoc, setAbriendoDoc] = useState<string | null>(null);
  const [porPagina, setPorPagina] = useState(15);
  const [pagina, setPagina] = useState(1);

  const filtradas = useMemo(() => filtrarEntradas(filas, filtros), [filas, filtros]);
  const metrics = useMemo(() => tarjetasEntradas(filas), [filas]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const paginaActual = Math.min(pagina, totalPaginas);
  const desde = (paginaActual - 1) * porPagina;
  const filasPagina = filtradas.slice(desde, desde + porPagina);

  const verComprobante = async (f: FilaEntradaRetencion) => {
    if (!f.reintegro?.comprobantePath) return;
    setAbriendoDoc(f.id);
    try {
      const url = await urlAdjuntoOc(f.reintegro.comprobantePath);
      await previewFileUrl(url, f.reintegro.comprobanteNombre || 'comprobante-reintegro', 'Comprobante de reintegro');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el comprobante', 'error');
    } finally {
      setAbriendoDoc(null);
    }
  };

  return (
    <div>
      {/* Encabezado del Submódulo */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
          🏛️ CONCILIACIÓN POR ENTRADAS DE RETENCIÓN
        </h2>
        <p className="hint muted" style={{ margin: '.3rem 0 0', fontSize: '.86rem' }}>
          Control de reintegros de impuestos y retenciones (IVA, ISLR, ISAE) de compras y servicios.
          Registra el día de entrada, su referencia bancaria, monto en Bs y comprobante, y coteja contra el libro de Caja Multimoneda.
        </p>
      </div>

      {/* Tarjetas Métricas */}
      <div style={{ display: 'grid', gap: '.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', marginBottom: '1.25rem' }}>
        <div className="card" style={{ padding: '.85rem 1rem', borderTop: '3px solid #3b82f6', margin: 0 }}>
          <div className="muted" style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            🏛 Total con retención
          </div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '.25rem' }}>
            {metrics.totalConRetencion.count} OC
          </div>
          <div className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>
            {fmtBs(metrics.totalConRetencion.bs)} · {fmtUsd(metrics.totalConRetencion.usd)}
          </div>
        </div>

        <div className="card" style={{ padding: '.85rem 1rem', borderTop: '3px solid #10b981', margin: 0 }}>
          <div className="muted" style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            ✓ Reintegradas (Entrada confirmada)
          </div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '.25rem', color: '#059669' }}>
            {metrics.reintegradas.count}
          </div>
          <div className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>
            Total recibido: <strong>{fmtBs(metrics.reintegradas.bs)}</strong>
          </div>
        </div>

        <div className="card" style={{ padding: '.85rem 1rem', borderTop: '3px solid #f59e0b', margin: 0 }}>
          <div className="muted" style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            ⏳ Pendientes por reintegro
          </div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '.25rem', color: '#d97706' }}>
            {metrics.pendientes.count}
          </div>
          <div className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>
            Por cobrar: {fmtBs(metrics.pendientes.bs)}
          </div>
        </div>

        <div className="card" style={{ padding: '.85rem 1rem', borderTop: '3px solid #8b5cf6', margin: 0 }}>
          <div className="muted" style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            📊 Cruce Drive / Banco
          </div>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginTop: '.35rem', flexWrap: 'wrap' }}>
            <span className="badge success">{metrics.drive.cuadran} CUADRA</span>
            <span className="badge danger">{metrics.drive.noCuadran} NO CUADRA</span>
            <span className="badge muted">{metrics.drive.sin} Sin cotejar</span>
          </div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="card" style={{ padding: '.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="search"
            className="input"
            style={{ minWidth: 240, flex: 1 }}
            placeholder="🔍 Buscar por OC, proveedor, factura o referencia..."
            value={filtros.busqueda ?? ''}
            onChange={(e) => {
              setFiltros((prev) => ({ ...prev, busqueda: e.target.value }));
              setPagina(1);
            }}
          />

          <label className="muted" style={{ fontSize: '.84rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
            Estado:
            <select
              className="select"
              style={{ width: 'auto' }}
              value={filtros.estado ?? 'todos'}
              onChange={(e) => {
                setFiltros((prev) => ({ ...prev, estado: e.target.value as FiltrosEntradasRetencion['estado'] }));
                setPagina(1);
              }}
            >
              <option value="todos">Todos ({filas.length})</option>
              <option value="reintegradas">Reintegradas ({metrics.reintegradas.count})</option>
              <option value="pendientes">Pendientes ({metrics.pendientes.count})</option>
            </select>
          </label>

          <label className="muted" style={{ fontSize: '.84rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
            Tipo:
            <select
              className="select"
              style={{ width: 'auto' }}
              value={filtros.tipoRetencion ?? 'todos'}
              onChange={(e) => {
                setFiltros((prev) => ({ ...prev, tipoRetencion: e.target.value }));
                setPagina(1);
              }}
            >
              <option value="todos">Todos los tipos</option>
              <option value="IVA">IVA</option>
              <option value="ISLR">ISLR</option>
              <option value="ISAE">ISAE</option>
            </select>
          </label>

          <label className="muted" style={{ fontSize: '.84rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
            DRIVE/BANCO:
            <select
              className="select"
              style={{ width: 'auto' }}
              value={filtros.drive ?? 'todos'}
              onChange={(e) => {
                setFiltros((prev) => ({ ...prev, drive: e.target.value as FiltrosEntradasRetencion['drive'] }));
                setPagina(1);
              }}
            >
              <option value="todos">Todos</option>
              <option value="cuadra">Cuadra ({metrics.drive.cuadran})</option>
              <option value="no_cuadra">No cuadra ({metrics.drive.noCuadran})</option>
              <option value="sin">Sin cotejar ({metrics.drive.sin})</option>
            </select>
          </label>

          {(filtros.busqueda || filtros.estado !== 'todos' || filtros.tipoRetencion !== 'todos' || filtros.drive !== 'todos') && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setFiltros({ busqueda: '', estado: 'todos', tipoRetencion: 'todos', drive: 'todos' });
                setPagina(1);
              }}
            >
              ✕ Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Tabla Detallada */}
      <div className="table-wrap" style={{ overflowX: 'auto', marginBottom: '1rem' }}>
        <table className="table" style={{ fontSize: '.82rem', width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-subtle, #f8fafc)', borderBottom: '2px solid var(--border, #e2e8f0)' }}>
              <th style={{ width: 40, textAlign: 'center' }}>#</th>
              <th>Código OC</th>
              <th>Proveedor</th>
              <th>Factura</th>
              <th>Tipos Retención</th>
              <th style={{ textAlign: 'right' }}>Monto Retenido</th>
              <th style={{ textAlign: 'center' }}>Día Reintegro</th>
              <th>Ref. Entrada</th>
              <th style={{ textAlign: 'right' }}>Monto Reintegrado</th>
              <th style={{ textAlign: 'center' }}>Soporte</th>
              <th style={{ textAlign: 'center' }}>DRIVE/BANCO</th>
              {puedeEditar && <th style={{ textAlign: 'center', width: 80 }}>Acción</th>}
            </tr>
          </thead>
          <tbody>
            {filasPagina.map((f) => {
              const r = f.reintegro;
              const d = f.drive;
              return (
                <tr key={f.id} style={{ borderBottom: '1px solid var(--border, #e2e8f0)' }}>
                  <td style={{ textAlign: 'center' }} className="mono muted">
                    {f.item}
                  </td>

                  <td>
                    <button
                      type="button"
                      className="link mono"
                      style={{ fontWeight: 700, padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}
                      onClick={() => onVerOc(f.id)}
                      title="Ver detalle de la orden"
                    >
                      {f.codigo}
                    </button>
                    {f.sp && f.sp !== f.codigo && <div className="muted mono" style={{ fontSize: '.72rem' }}>{f.sp}</div>}
                  </td>

                  <td>
                    <div style={{ fontWeight: 600 }}>{f.proveedor}</div>
                  </td>

                  <td>
                    {f.facturaNumero ? (
                      <span className="mono" style={{ fontWeight: 600 }}>#{f.facturaNumero}</span>
                    ) : f.facturasCount > 0 ? (
                      <span className="badge muted" style={{ fontSize: '.72rem' }}>{f.facturasCount} soporte(s)</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>

                  <td>
                    <div style={{ display: 'flex', gap: '.25rem', flexWrap: 'wrap' }}>
                      {f.tiposRetencion.map((t) => {
                        const style = COLOR_TIPO[t] || COLOR_TIPO.RETENCIÓN;
                        return (
                          <span
                            key={t}
                            style={{
                              fontSize: '.7rem',
                              padding: '.15rem .45rem',
                              borderRadius: '4px',
                              fontWeight: 700,
                              background: style.bg,
                              color: style.color,
                            }}
                          >
                            {t}
                          </span>
                        );
                      })}
                    </div>
                  </td>

                  <td style={{ textAlign: 'right' }} className="mono">
                    <div style={{ fontWeight: 700 }}>{fmtBs(f.montoRetencionBs)}</div>
                    {f.montoRetencionUsd > 0 && <div className="muted" style={{ fontSize: '.72rem' }}>{fmtUsd(f.montoRetencionUsd)}</div>}
                  </td>

                  <td style={{ textAlign: 'center' }}>
                    {r?.fechaReintegro ? (
                      <span className="badge success" style={{ fontSize: '.74rem', padding: '.2rem .5rem' }}>
                        📅 {r.fechaReintegro}
                      </span>
                    ) : (
                      <span className="badge warning" style={{ fontSize: '.74rem', padding: '.2rem .5rem' }}>
                        ⏳ Pendiente
                      </span>
                    )}
                  </td>

                  <td className="mono">
                    {r?.referencia ? (
                      <div>
                        <strong>{r.referencia}</strong>
                        {r.banco && <div className="muted" style={{ fontSize: '.7rem' }}>{r.banco}</div>}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>

                  <td style={{ textAlign: 'right' }} className="mono">
                    {r && r.montoBs > 0 ? (
                      <strong style={{ color: '#059669', fontSize: '.9rem' }}>{fmtBs(r.montoBs)}</strong>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>

                  <td style={{ textAlign: 'center' }}>
                    {r?.comprobantePath ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => void verComprobante(f)}
                        disabled={abriendoDoc === f.id}
                        title={`Ver ${r.comprobanteNombre || 'comprobante'}`}
                        style={{ padding: '.2rem .4rem', fontSize: '.76rem' }}
                      >
                        {abriendoDoc === f.id ? 'Abriendo…' : '📄 Ver'}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>

                  <td style={{ textAlign: 'center' }}>
                    {d ? (
                      <div>
                        <span className={`badge ${d.estado === 'CUADRA' ? 'success' : 'danger'}`}>
                          {d.estado}
                        </span>
                        {d.estado === 'NO CUADRA' && (
                          <div className="muted" style={{ fontSize: '.68rem', maxWidth: 180, margin: '.2rem auto 0', lineHeight: 1.2 }}>
                            {d.motivo}
                          </div>
                        )}
                      </div>
                    ) : f.driveEntradaDetectada ? (
                      <span
                        className="badge info"
                        title={`Detectado en libro de Caja: Bs ${fmtBs(f.driveEntradaDetectada.montoBs)} · Ref: ${f.driveEntradaDetectada.referencias.join(', ')}`}
                      >
                        En Caja
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>

                  {puedeEditar && (
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        style={{ padding: '.25rem .5rem', fontSize: '.78rem' }}
                        onClick={() => setEditandoFila(f)}
                        title={r ? 'Editar reintegro de retención' : 'Registrar reintegro de retención'}
                      >
                        ✎ {r ? 'Editar' : 'Registrar'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}

            {!filasPagina.length && (
              <tr>
                <td colSpan={puedeEditar ? 12 : 11} style={{ textAlign: 'center', padding: '2rem' }} className="muted">
                  No se encontraron órdenes con retención para los filtros seleccionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', fontSize: '.84rem' }}>
        <div className="muted">
          Mostrando <strong>{filtradas.length ? desde + 1 : 0}</strong>–<strong>{Math.min(desde + porPagina, filtradas.length)}</strong> de{' '}
          <strong>{filtradas.length}</strong> órdenes
        </div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <label className="muted" style={{ fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
            Por página:
            <select
              className="select"
              style={{ width: 'auto', padding: '.2rem .5rem' }}
              value={porPagina}
              onChange={(e) => {
                setPorPagina(Number(e.target.value));
                setPagina(1);
              }}
            >
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
            </select>
          </label>

          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={paginaActual <= 1}
          >
            ◀ Anterior
          </button>
          <span>
            {paginaActual} / {totalPaginas}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={paginaActual >= totalPaginas}
          >
            Siguiente ▶
          </button>
        </div>
      </div>

      {/* Modal para registrar / editar reintegro */}
      {editandoFila && (
        <RegistrarReintegroModal
          fila={editandoFila}
          onClose={() => setEditandoFila(null)}
          onGuardado={onActualizarOrden}
        />
      )}
    </div>
  );
}
