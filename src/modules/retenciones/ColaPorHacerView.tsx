/* ============================================================
   Golden Touch · Retenciones · Vista unificada «Por hacer» (Etapa 1)

   Muestra la cola unificada de facturas con archivo listas para retener,
   filtradas por la empresa seleccionada:
   - Proveedor y RIF
   - Documento / N° de Factura
   - Vía de entrada (Buzón Móvil o Compras)
   - Acceso directo al archivo adjunto (previsualización)
   - Impuestos aplicables y pendientes
   - Acciones de registro directo bajo la empresa correspondiente
   ============================================================ */

import React, { useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { previewArchivo } from '@/shared/lib/reportePreview';
import { money } from '@/shared/lib/format';
import { norm } from '@/shared/lib/texto';
import type { ItemColaPorHacer, ImpuestoPendiente } from './colaPorHacer';
import { IMPUESTOS_PENDIENTES } from './colaPorHacer';
import type { FacturaDeOrigen } from '@/modules/libroFiscal/documentosOrigen.repository';
import type { RetencionItem } from './retenciones.repository';
import { soporteDeItem, urlSoporteCola } from './soporteCola';
import type { FacturaBuzon } from './facturasBuzon.repository';
import type { ObjetivoNoAplica } from '@/modules/libroFiscal/NoAplicaModal';
import { tipoAGt } from './colaPorHacer';

export interface ColaPorHacerViewProps {
  items: ItemColaPorHacer[];
  empresaNombre?: string;
  loading: boolean;
  canWrite: boolean;
  usuariosDirectorio?: { id?: string; email: string; nombre?: string }[];
  onCambiarSoporteFisico?: (
    item: ItemColaPorHacer,
    recibido: boolean,
    entregadoPor: string,
    tipo?: 'original' | 'copia' | null,
  ) => Promise<void>;
  onRegistrarBuzon: (fac: FacturaBuzon) => void;
  onRegistrarArchivo: (f: FacturaDeOrigen) => void;
  onRegistrarOrden: (item: RetencionItem) => void;
  onVerDetalle?: (item: RetencionItem, soporte: ReturnType<typeof soporteDeItem>) => void;
  onNoAplica?: (obj: ObjetivoNoAplica) => void;
  /** Abre el libro con el contexto de esta fila (factura, RIF y fecha). */
  onVerEnLibro?: (item: ItemColaPorHacer) => void;
}

export function ColaPorHacerView({
  items,
  empresaNombre,
  loading,
  canWrite,
  onCambiarSoporteFisico,
  onRegistrarBuzon,
  onRegistrarArchivo,
  onRegistrarOrden,
  onVerDetalle,
  onNoAplica,
  onVerEnLibro,
}: ColaPorHacerViewProps) {
  const [q, setQ] = useState('');
  const [fImp, setFImp] = useState('');
  const [fOrigen, setFOrigen] = useState<'' | 'buzon' | 'compras'>('');
  const [fFisico, setFFisico] = useState<'' | 'con_fisico' | 'original' | 'copia' | 'sin_fisico'>('');
  const [ord, setOrd] = useState<'reciente' | 'antiguo' | 'proveedor'>('reciente');
  const [tempEntregado, setTempEntregado] = useState<Record<string, string>>({});
  const [pag, setPag] = useState(1);
  const tam = 25;

  const filtradas = useMemo(() => {
    const txt = norm(q);
    return items.filter((it) => {
      if (txt) {
        const hay = norm(`${it.codigo} ${it.proveedorNombre} ${it.proveedorRif ?? ''} ${it.archivoNombre} ${it.empresaNombre ?? ''} ${it.soporteFisico?.entregadoPor ?? ''}`);
        if (!hay.includes(txt)) return false;
      }
      if (fImp) {
        if (!it.impuestosPendientes.includes(fImp as ImpuestoPendiente)) return false;
      }
      if (fOrigen) {
        if (fOrigen === 'buzon' && it.origen !== 'buzon') return false;
        if (fOrigen === 'compras' && it.origen === 'buzon') return false;
      }
      if (fFisico) {
        if (fFisico === 'con_fisico' && !it.soporteFisico?.recibido) return false;
        if (fFisico === 'original' && (!it.soporteFisico?.recibido || it.soporteFisico?.tipo === 'copia')) return false;
        if (fFisico === 'copia' && (!it.soporteFisico?.recibido || it.soporteFisico?.tipo !== 'copia')) return false;
        if (fFisico === 'sin_fisico' && it.soporteFisico?.recibido) return false;
      }
      return true;
    });
  }, [items, q, fImp, fOrigen, fFisico]);

  const ordenadas = useMemo(() => {
    const xs = [...filtradas];
    xs.sort((a, b) => {
      if (ord === 'reciente') return String(b.fecha ?? '').localeCompare(String(a.fecha ?? ''));
      if (ord === 'antiguo') return String(a.fecha ?? '').localeCompare(String(b.fecha ?? ''));
      if (ord === 'proveedor') return a.proveedorNombre.localeCompare(b.proveedorNombre);
      return 0;
    });
    return xs;
  }, [filtradas, ord]);

  const totalPags = Math.max(1, Math.ceil(ordenadas.length / tam));
  const pagActual = Math.min(pag, totalPags);
  const visible = ordenadas.slice((pagActual - 1) * tam, pagActual * tam);

  // Conteo de pendientes por impuesto
  const conteoImp = useMemo(() => {
    const c: Record<string, number> = { iva: 0, islr: 0, municipal: 0 };
    for (const it of items) {
      for (const k of it.impuestosPendientes) c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [items]);

  async function abrirArchivo(it: ItemColaPorHacer) {
    try {
      const url = await urlSoporteCola(soporteDeItem(it));
      previewArchivo(url, it.archivoNombre);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el archivo', 'error');
    }
  }

  return (
    <>
      {/* Cintillo contextual de la empresa activa */}
      {empresaNombre && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '.4rem',
          padding: '.45rem .75rem',
          marginBottom: '.65rem',
          borderRadius: '8px',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border)',
          fontSize: '.82rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
            <span>🏢</span>
            <span>Facturas pendientes por retener para: <strong style={{ color: 'var(--primary)' }}>{empresaNombre}</strong></span>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '.75rem' }}>
            Total en cola: <strong>{items.length}</strong>
          </span>
        </div>
      )}

      {/* Barra de búsqueda y filtros */}
      <div className="lfv8-barra">
        <div className="lfv8-buscar">
          <input
            type="search"
            className="input lfv8-buscar-q"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPag(1); }}
            placeholder="Buscar por factura, proveedor, RIF o soporte"
            aria-label="Buscar en facturas pendientes"
          />
          <span className="lfv8-barra-res" role="status">
            {filtradas.length} factura(s)
          </span>
        </div>
        <div className="lfv8-barra-filtros">
          <label className="lfv8-campo">
            <span>Impuesto</span>
            <select
              className="lfv8-select"
              value={fImp}
              onChange={(e) => { setFImp(e.target.value); setPag(1); }}
            >
              <option value="">Todos</option>
              {IMPUESTOS_PENDIENTES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label} ({conteoImp[t.key] || 0})
                </option>
              ))}
            </select>
          </label>

          <label className="lfv8-campo">
            <span>Vía</span>
            <select
              className="lfv8-select"
              value={fOrigen}
              onChange={(e) => { setFOrigen(e.target.value as '' | 'buzon' | 'compras'); setPag(1); }}
            >
              <option value="">Todas</option>
              <option value="buzon">📱 Buzón Móvil</option>
              <option value="compras">🛒 Compras</option>
            </select>
          </label>

          <label className="lfv8-campo">
            <span>Soporte físico</span>
            <select
              className="lfv8-select"
              value={fFisico}
              onChange={(e) => { setFFisico(e.target.value as typeof fFisico); setPag(1); }}
            >
              <option value="">Todos</option>
              <option value="con_fisico">✓ Con físico (todos)</option>
              <option value="original">✓ Original</option>
              <option value="copia">✓ Copia (foto/imp.)</option>
              <option value="sin_fisico">Sin físico</option>
            </select>
          </label>

          <label className="lfv8-campo">
            <span>Ordenar</span>
            <select
              className="lfv8-select"
              value={ord}
              onChange={(e) => setOrd(e.target.value as typeof ord)}
            >
              <option value="reciente">Más reciente primero</option>
              <option value="antiguo">Más antiguo primero</option>
              <option value="proveedor">Proveedor (A–Z)</option>
            </select>
          </label>
        </div>
      </div>

      <p className="lfv8-huella">
        Cola unificada de facturas con archivo adjunto listas para retener. Cada factura cuenta con su soporte verificado.
      </p>

      {/* Grid de facturas */}
      <div className="lfv8-sis" style={{ '--cols': '1.2fr 1.4fr 1fr 1.3fr .8fr .9fr 2.5fr' } as React.CSSProperties}>
        <div className="lfv8-sis-cab">
          <span>Documento</span>
          <span>Proveedor</span>
          <span>Soporte digital</span>
          <span>Soporte físico</span>
          <span style={{ textAlign: 'right' }}>Total</span>
          <span>Pendiente</span>
          <span></span>
        </div>

        {loading && <div className="lfv8-sis-vacio">Cargando facturas pendientes…</div>}

        {!loading && !ordenadas.length && (
          <div className="lfv8-sis-vacio">
            {items.length === 0 ? (
              <>
                <p style={{ margin: '0 0 .3rem', fontWeight: 600 }}>
                  No hay facturas pendientes con archivo para {empresaNombre || 'esta empresa'}.
                </p>
                <small className="muted">
                  Solo aparecen documentos con factura adjunta (subidos desde el Buzón Móvil o desde Compras), listos para retener.
                </small>
              </>
            ) : (
              'Sin facturas para los filtros aplicados.'
            )}
          </div>
        )}

        {!loading && visible.map((it) => {
          const pends = it.impuestosPendientes;
          const esBuzon = it.origen === 'buzon';
          const esComprasArchivo = it.origen === 'compras_archivo';
          const esComprasOrden = it.origen === 'compras_orden';

          return (
            <div key={it.id} className="lfv8-sis-fila">
              {/* Documento y origen */}
              <span data-l="Documento">
                <span className="mono" style={{ fontWeight: 600 }}>{it.codigo}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', flexWrap: 'wrap', marginTop: '.2rem' }}>
                  <span className="lfv8-pill" style={{ fontSize: '.68rem', padding: '1px 5px' }}>
                    {it.tipoDocumento}
                  </span>
                  <span
                    className="badge"
                    style={{
                      fontSize: '.68rem',
                      padding: '1px 5px',
                      background: esBuzon ? 'rgba(56, 189, 248, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                      color: esBuzon ? 'var(--info, #0284c7)' : 'var(--success, #16a34a)',
                    }}
                  >
                    {esBuzon ? '📱 Buzón' : '🛒 Compras'}
                  </span>
                  {it.fecha && <small className="muted">{it.fecha}</small>}
                </div>
              </span>

              {/* Proveedor */}
              <span data-l="Proveedor">
                <strong>{it.proveedorNombre}</strong>
                {it.proveedorRif && <small className="mono">{it.proveedorRif}</small>}
              </span>

              {/* Soporte adjunto */}
              <span data-l="Soporte digital">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', padding: '2px 6px' }}
                  onClick={() => void abrirArchivo(it)}
                  title={`Ver archivo adjunto: ${it.archivoNombre}`}
                >
                  📎 {it.adjuntosCount > 1 ? `${it.adjuntosCount} archivos` : it.archivoNombre}
                </button>
              </span>

              {/* Soporte físico */}
              <span data-l="Soporte físico">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap' }}>
                    {/* Casilla 1: Original */}
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '.25rem',
                        cursor: canWrite ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}
                      title="Factura original en físico"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(it.soporteFisico?.recibido && it.soporteFisico?.tipo !== 'copia')}
                        disabled={!canWrite}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const actualTexto = tempEntregado[it.id] !== undefined ? tempEntregado[it.id] : (it.soporteFisico?.entregadoPor ?? '');
                          void onCambiarSoporteFisico?.(it, checked, actualTexto, checked ? 'original' : null);
                        }}
                        style={{
                          width: '14px',
                          height: '14px',
                          accentColor: 'var(--success, #16a34a)',
                          cursor: canWrite ? 'pointer' : 'default',
                        }}
                      />
                      <span
                        style={{
                          fontSize: '.74rem',
                          fontWeight: (it.soporteFisico?.recibido && it.soporteFisico?.tipo !== 'copia') ? 700 : 500,
                          color: (it.soporteFisico?.recibido && it.soporteFisico?.tipo !== 'copia') ? 'var(--success, #16a34a)' : 'var(--text-muted)',
                        }}
                      >
                        Original
                      </span>
                    </label>

                    {/* Casilla 2: Copia (foto o impresión) */}
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '.25rem',
                        cursor: canWrite ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}
                      title="Copia de factura (foto o impresión)"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(it.soporteFisico?.recibido && it.soporteFisico?.tipo === 'copia')}
                        disabled={!canWrite}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const actualTexto = tempEntregado[it.id] !== undefined ? tempEntregado[it.id] : (it.soporteFisico?.entregadoPor ?? '');
                          void onCambiarSoporteFisico?.(it, checked, actualTexto, checked ? 'copia' : null);
                        }}
                        style={{
                          width: '14px',
                          height: '14px',
                          accentColor: 'var(--info, #0284c7)',
                          cursor: canWrite ? 'pointer' : 'default',
                        }}
                      />
                      <span
                        style={{
                          fontSize: '.74rem',
                          fontWeight: (it.soporteFisico?.recibido && it.soporteFisico?.tipo === 'copia') ? 700 : 500,
                          color: (it.soporteFisico?.recibido && it.soporteFisico?.tipo === 'copia') ? 'var(--info, #0284c7)' : 'var(--text-muted)',
                        }}
                      >
                        Copia
                      </span>
                    </label>
                  </div>

                  {/* Input limpio: quién entregó (sin datalist desplegable) */}
                  <input
                    type="text"
                    className="input input-sm"
                    placeholder="¿Quién entregó?"
                    value={tempEntregado[it.id] !== undefined ? tempEntregado[it.id] : (it.soporteFisico?.entregadoPor ?? '')}
                    disabled={!canWrite}
                    autoComplete="off"
                    onChange={(e) => {
                      const v = e.target.value;
                      setTempEntregado((prev) => ({ ...prev, [it.id]: v }));
                    }}
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v !== (it.soporteFisico?.entregadoPor ?? '')) {
                        const rec = it.soporteFisico?.recibido ?? (v.trim().length > 0);
                        const tipo = it.soporteFisico?.tipo ?? (rec ? 'original' : null);
                        void onCambiarSoporteFisico?.(it, rec, v, tipo);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = (e.target as HTMLInputElement).value;
                        const rec = it.soporteFisico?.recibido ?? (v.trim().length > 0);
                        const tipo = it.soporteFisico?.tipo ?? (rec ? 'original' : null);
                        void onCambiarSoporteFisico?.(it, rec, v, tipo);
                      }
                    }}
                    style={{
                      fontSize: '.74rem',
                      padding: '2px 6px',
                      width: '100%',
                      maxWidth: '180px',
                      borderColor: it.soporteFisico?.recibido
                        ? (it.soporteFisico?.tipo === 'copia' ? 'rgba(2, 132, 199, 0.4)' : 'rgba(34, 197, 94, 0.4)')
                        : undefined,
                      background: it.soporteFisico?.recibido
                        ? (it.soporteFisico?.tipo === 'copia' ? 'rgba(2, 132, 199, 0.05)' : 'rgba(34, 197, 94, 0.05)')
                        : undefined,
                    }}
                    title={
                      it.soporteFisico?.recibidoEn
                        ? `Soporte: ${it.soporteFisico?.tipo === 'copia' ? 'Copia (foto o impresión)' : 'Original'} · Recibido: ${it.soporteFisico.recibidoEn.slice(0, 10)}${it.soporteFisico.recibidoPor ? ` por ${it.soporteFisico.recibidoPor}` : ''}`
                        : 'Escribe quién entregó el documento físico o copia'
                    }
                  />
                </div>
              </span>

              {/* Montos */}
              <span className="n" data-l="Total">
                <strong>{money(it.total, it.moneda)}</strong>
                {it.ivaMonto != null && it.ivaMonto > 0 && (
                  <small style={{ color: 'var(--text-muted)' }}>
                    IVA: {money(it.ivaMonto, it.moneda)}
                  </small>
                )}
              </span>

              {/* Impuestos pendientes */}
              <span data-l="Pendiente">
                {pends.length === 0 ? (
                  <span className="lfv8-pill ok">Completa</span>
                ) : (
                  <span
                    className="muted"
                    title={`Por registrar: ${pends.map((k) => IMPUESTOS_PENDIENTES.find((t) => t.key === k)?.label ?? k).join(', ')}`}
                  >
                    {pends.length} por registrar
                  </span>
                )}
              </span>

              {/* Acciones */}
              <span className="lfv8-sis-acc">
                {canWrite && pends.length > 0 && (
                  <>
                    {esBuzon && it.rawBuzon && (
                      <button
                        type="button"
                        className="btn btn-sm lfv8-btn-reg"
                        onClick={() => onRegistrarBuzon(it.rawBuzon!)}
                        title="Cargar y retener esta factura del buzón"
                      >
                        Cargar en Retenciones
                      </button>
                    )}

                    {esComprasArchivo && it.rawFacturaOrigen && (
                      <button
                        type="button"
                        className="btn btn-sm lfv8-btn-reg"
                        onClick={() => onRegistrarArchivo(it.rawFacturaOrigen!)}
                        title="Cargar y registrar factura de Compras"
                      >
                        Cargar en Retenciones
                      </button>
                    )}

                    {esComprasOrden && it.rawOrdenItem && (
                      <button
                        type="button"
                        className="btn btn-sm lfv8-btn-reg"
                        onClick={() => onRegistrarOrden(it.rawOrdenItem!)}
                        title="Registrar retención de la orden"
                      >
                        Registrar Impuesto
                      </button>
                    )}
                  </>
                )}

                {/* Acción no aplica / no es apta para retener */}
                {onNoAplica && canWrite && (it.rawOrdenItem || it.rawFacturaOrigen?.origen.tipo === 'oc') && pends.length > 0 && (
                  <>
                    {pends.map((k) => {
                      const o = it.rawOrdenItem?.orden;
                      const ordenId = o?.id || (it.rawFacturaOrigen?.origen.tipo === 'oc' ? it.rawFacturaOrigen.origen.id : '');
                      const lbl = IMPUESTOS_PENDIENTES.find((t) => t.key === k)?.label ?? k;
                      const btnTexto = pends.length === 1 ? `🚫 No es apta` : `🚫 ${lbl}: no aplica`;
                      return (
                        <button
                          key={`na-${k}`}
                          type="button"
                          className="btn btn-sm btn-ghost"
                          style={{ color: '#f87171', borderColor: 'rgba(248, 113, 113, 0.3)' }}
                          title={`Indicar que a esta orden no le corresponde retención de ${lbl} (no es apta)`}
                          onClick={() => onNoAplica({
                            ordenId,
                            codigo: o?.oc_codigo ?? o?.codigo ?? it.codigo,
                            proveedorId: o?.proveedor_id ?? null,
                            proveedorNombre: it.proveedorNombre,
                            moneda: o?.total_moneda === 'Bs' ? 'Bs' : it.moneda,
                            total: o?.total ?? it.total ?? null,
                            impuestoClave: tipoAGt(k),
                            impuestoNombre: lbl,
                            fechaDocumento: it.fecha ?? '',
                          })}
                        >
                          {btnTexto}
                        </button>
                      );
                    })}
                  </>
                )}

                {/* Ver detalle / orden si aplica */}
                {it.rawOrdenItem && (
                  <>
                    {it.rawOrdenItem.orden.oc_codigo && (
                      <a
                        className="btn btn-sm btn-ghost"
                        href={`#/app/pedidos?detalle=${encodeURIComponent(it.rawOrdenItem.orden.id)}`}
                      >
                        Ver OC
                      </a>
                    )}
                    {onVerDetalle && (
                      <button
                        type="button"
                        className={`btn btn-sm ${pends.length === 0 ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => onVerDetalle(it.rawOrdenItem!, soporteDeItem(it))}
                      >
                        {pends.length === 0 ? '✓ Finalizar retención' : 'Ver detalle'}
                      </button>
                    )}
                  </>
                )}

                {onVerEnLibro && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => onVerEnLibro(it)}
                    title={`Abrir el libro filtrado por ${it.codigo}${it.proveedorRif ? ` · ${it.proveedorRif}` : ''}`}
                  >
                    Ver en libro
                  </button>
                )}
              </span>
            </div>
          );
        })}

        {!loading && ordenadas.length > tam && (
          <div className="lfv8-sis-pag">
            <span>
              <b>{ordenadas.length}</b> factura(s) · página {pagActual} de {totalPags}
            </span>
            <span className="lfv8-sis-pag-btns">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pagActual <= 1}
                onClick={() => setPag(pagActual - 1)}
              >
                ‹ Anterior
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pagActual >= totalPags}
                onClick={() => setPag(pagActual + 1)}
              >
                Siguiente ›
              </button>
            </span>
          </div>
        )}
      </div>
    </>
  );
}

