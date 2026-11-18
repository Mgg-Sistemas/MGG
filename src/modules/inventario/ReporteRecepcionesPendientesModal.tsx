import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { toast } from '@/shared/ui/Toast';
import { money, num } from '@/shared/lib/format';
import type { Orden, Almacen } from '@/shared/lib/types';
import type { CompraDirecta } from '@/modules/pedidos/compras.repository';
import {
  armarFilasRecepcionesPendientes,
  filtrarRecepcionesPendientes,
  calcularTotalesRecepciones,
  textoReporteRecepcionesWhatsapp,
  type FiltrosRecepcionesPendientes,
} from './reporteRecepcionesPendientes';
import { generarReporteRecepcionesPdf } from './reporteRecepcionesPendientesPdf';

interface Props {
  ordenes: Orden[];
  compras?: CompraDirecta[];
  almacenes: Almacen[];
  actor?: string;
  modoInicial?: 'reporte' | 'whatsapp';
  onClose: () => void;
}

export function ReporteRecepcionesPendientesModal({
  ordenes,
  compras = [],
  almacenes,
  actor,
  modoInicial = 'reporte',
  onClose,
}: Props) {
  // Filas completas normalizadas
  const filasBase = useMemo(() => {
    return armarFilasRecepcionesPendientes(ordenes, compras, almacenes);
  }, [ordenes, compras, almacenes]);

  // Lista dinámica de sedes y analistas disponibles
  const { sedesDisponibles, analistasDisponibles } = useMemo(() => {
    const s = new Set<string>();
    const a = new Set<string>();
    for (const f of filasBase) {
      if (f.almacenSugerido && f.almacenSugerido !== '—') s.add(f.almacenSugerido);
      if (f.analista && f.analista !== '—') a.add(f.analista);
    }
    return {
      sedesDisponibles: Array.from(s).sort(),
      analistasDisponibles: Array.from(a).sort(),
    };
  }, [filasBase]);

  // Estado de filtros interactivos
  const [texto, setTexto] = useState('');
  const [sede, setSede] = useState('');
  const [analista, setAnalista] = useState('');
  const [tipo, setTipo] = useState<'todos' | 'oc' | 'directo'>('todos');
  const [criterioFecha, setCriterioFecha] = useState<'montada' | 'pago'>('montada');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const [verWhatsappModal, setVerWhatsappModal] = useState(modoInicial === 'whatsapp');
  const [generandoPdf, setGenerandoPdf] = useState(false);

  const filtrosActuales: FiltrosRecepcionesPendientes = useMemo(() => ({
    texto,
    sede,
    analista,
    tipo,
    criterioFecha,
    desde,
    hasta,
  }), [texto, sede, analista, tipo, criterioFecha, desde, hasta]);

  // Filas filtradas en tiempo real
  const filasFiltradas = useMemo(() => {
    return filtrarRecepcionesPendientes(filasBase, filtrosActuales);
  }, [filasBase, filtrosActuales]);

  // Totales de las filas filtradas
  const totales = useMemo(() => {
    return calcularTotalesRecepciones(filasFiltradas);
  }, [filasFiltradas]);

  const textoWhatsapp = useMemo(() => {
    return textoReporteRecepcionesWhatsapp(filasFiltradas, filtrosActuales, actor);
  }, [filasFiltradas, filtrosActuales, actor]);

  async function handleDescargarPdf() {
    try {
      setGenerandoPdf(true);
      await generarReporteRecepcionesPdf(filasFiltradas, filtrosActuales, actor);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo generar el PDF', 'error');
    } finally {
      setGenerandoPdf(false);
    }
  }

  function handleCopiarTexto() {
    navigator.clipboard.writeText(textoWhatsapp)
      .then(() => toast('Texto copiado al portapapeles para WhatsApp', 'success'))
      .catch(() => toast('No se pudo copiar el texto', 'error'));
  }

  function handleLimpiarFiltros() {
    setTexto('');
    setSede('');
    setAnalista('');
    setTipo('todos');
    setCriterioFecha('montada');
    setDesde('');
    setHasta('');
  }

  return (
    <>
      <Modal
        title="📦 Reporte Dinámico de Pendientes por Recepcionar"
        size="xl"
        onClose={onClose}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '.5rem' }}>
            <div className="muted" style={{ fontSize: '.84rem' }}>
              Mostrando <strong>{num(filasFiltradas.length)}</strong> de <strong>{num(filasBase.length)}</strong> registros
            </div>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={generandoPdf}
                onClick={handleDescargarPdf}
              >
                {generandoPdf ? 'Generando PDF…' : '📄 Generar PDF'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setVerWhatsappModal(true)}
              >
                💬 Compartir por WhatsApp
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: '1rem' }}>
          {/* ── Barra de Filtros Dinámicos ── */}
          <div className="card" style={{ margin: 0, padding: '.85rem', background: 'var(--surface-2)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.65rem', alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '.82rem', fontWeight: 600, display: 'block', marginBottom: '.25rem' }}>
                  🔍 Búsqueda rápida
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ fontSize: '.85rem' }}
                  placeholder="Código, analista, material…"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '.82rem', fontWeight: 600, display: 'block', marginBottom: '.25rem' }}>
                  🏢 Sede / Destino
                </label>
                <select
                  className="select"
                  style={{ fontSize: '.85rem' }}
                  value={sede}
                  onChange={(e) => setSede(e.target.value)}
                >
                  <option value="">Todas las sedes ({sedesDisponibles.length})</option>
                  {sedesDisponibles.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '.82rem', fontWeight: 600, display: 'block', marginBottom: '.25rem' }}>
                  👤 Analista encargado
                </label>
                <select
                  className="select"
                  style={{ fontSize: '.85rem' }}
                  value={analista}
                  onChange={(e) => setAnalista(e.target.value)}
                >
                  <option value="">Todos los analistas ({analistasDisponibles.length})</option>
                  {analistasDisponibles.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '.82rem', fontWeight: 600, display: 'block', marginBottom: '.25rem' }}>
                  📦 Tipo de orden
                </label>
                <select
                  className="select"
                  style={{ fontSize: '.85rem' }}
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as 'todos' | 'oc' | 'directo')}
                >
                  <option value="todos">Todos los tipos</option>
                  <option value="oc">Solo Órdenes de Compra (OC)</option>
                  <option value="directo">Solo Compras Directas</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '.82rem', fontWeight: 600, display: 'block', marginBottom: '.25rem' }}>
                  📅 Filtrar fecha por
                </label>
                <select
                  className="select"
                  style={{ fontSize: '.85rem' }}
                  value={criterioFecha}
                  onChange={(e) => setCriterioFecha(e.target.value as 'montada' | 'pago')}
                >
                  <option value="montada">Fecha que se montó</option>
                  <option value="pago">Fecha que pagó Tesorería</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '.82rem', fontWeight: 600, display: 'block', marginBottom: '.25rem' }}>
                  Desde
                </label>
                <input
                  type="date"
                  className="input"
                  style={{ fontSize: '.85rem' }}
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '.82rem', fontWeight: 600, display: 'block', marginBottom: '.25rem' }}>
                  Hasta
                </label>
                <input
                  type="date"
                  className="input"
                  style={{ fontSize: '.85rem' }}
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                />
              </div>

              <div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', fontSize: '.82rem', height: '36px' }}
                  onClick={handleLimpiarFiltros}
                >
                  ✕ Limpiar filtros
                </button>
              </div>
            </div>
          </div>

          {/* ── KPIs / Resumen Dinámico ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.65rem' }}>
            <div className="card" style={{ margin: 0, padding: '.75rem .9rem', textAlign: 'center', background: 'var(--surface)' }}>
              <div className="muted" style={{ fontSize: '.76rem', fontWeight: 600, textTransform: 'uppercase' }}>Pendientes</div>
              <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--primary)' }}>
                {num(totales.totalRegistros)}
              </div>
              <div className="muted" style={{ fontSize: '.72rem' }}>
                {totales.totalOc} OC · {totales.totalDirectos} Directas
              </div>
            </div>

            <div className="card" style={{ margin: 0, padding: '.75rem .9rem', textAlign: 'center', background: 'var(--surface)' }}>
              <div className="muted" style={{ fontSize: '.76rem', fontWeight: 600, textTransform: 'uppercase' }}>Ítems / Cantidad</div>
              <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--info)' }}>
                {num(totales.totalItems)}
              </div>
              <div className="muted" style={{ fontSize: '.72rem' }}>
                {num(totales.totalUnidades)} und. estimadas
              </div>
            </div>

            <div className="card" style={{ margin: 0, padding: '.75rem .9rem', textAlign: 'center', background: 'var(--surface)' }}>
              <div className="muted" style={{ fontSize: '.76rem', fontWeight: 600, textTransform: 'uppercase' }}>Total en Divisas</div>
              <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--success)' }}>
                {money(totales.totalUsd, 'USD')}
              </div>
              <div className="muted" style={{ fontSize: '.72rem' }}>En órdenes en $</div>
            </div>

            {totales.totalBs > 0 && (
              <div className="card" style={{ margin: 0, padding: '.75rem .9rem', textAlign: 'center', background: 'var(--surface)' }}>
                <div className="muted" style={{ fontSize: '.76rem', fontWeight: 600, textTransform: 'uppercase' }}>Total en Bolívares</div>
                <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--warning)' }}>
                  {money(totales.totalBs, 'Bs')}
                </div>
                <div className="muted" style={{ fontSize: '.72rem' }}>En órdenes en Bs</div>
              </div>
            )}
          </div>

          {/* ── Tabla de Resultados ── */}
          <div style={{ overflowX: 'auto', maxHeight: '52vh', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
            <table className="table" style={{ width: '100%', fontSize: '.84rem', margin: 0 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 1 }}>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>#</th>
                  <th>Documento / Tipo</th>
                  <th>Fecha Montada</th>
                  <th>Pagó Tesorería</th>
                  <th>Analista Encargado</th>
                  <th>Destino Sugerido</th>
                  <th>Ítems / Und.</th>
                  <th style={{ textAlign: 'right' }}>Monto</th>
                  <th style={{ textAlign: 'center' }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {!filasFiltradas.length ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                      No hay recepciones pendientes que coincidan con los filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  filasFiltradas.map((f, i) => (
                    <tr key={f.id}>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{i + 1}</td>
                      <td>
                        <strong className="mono">{f.codigo}</strong>
                        <div className="muted" style={{ fontSize: '.74rem' }}>{f.tipoEtiqueta}</div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{f.fechaMontadaTxt}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={`badge ${f.fechaPago ? 'success' : 'warning'}`} style={{ fontSize: '.74rem' }}>
                          {f.fechaPagoTxt}
                        </span>
                      </td>
                      <td>
                        <strong>{f.analista}</strong>
                      </td>
                      <td>
                        <span>{f.almacenSugerido}</span>
                      </td>
                      <td>
                        <div>{f.itemsCount} ítem{f.itemsCount !== 1 ? 's' : ''}</div>
                        <div className="muted" style={{ fontSize: '.74rem' }}>{num(f.unidades)} und.</div>
                      </td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--primary-3)' }}>
                        {money(f.monto, f.moneda)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="badge info" style={{ fontSize: '.74rem' }}>
                          {f.estado}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      {/* ── Modal de Vista Previa y Envío por WhatsApp ── */}
      {verWhatsappModal && (
        <Modal
          title="💬 Reporte de Pendientes para WhatsApp"
          size="md"
          onClose={() => setVerWhatsappModal(false)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: '.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={handleCopiarTexto}>
                📋 Copiar Texto
              </button>
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <CompartirWhatsapp texto={textoWhatsapp} />
                <button type="button" className="btn btn-ghost" onClick={() => setVerWhatsappModal(false)}>
                  Cerrar
                </button>
              </div>
            </div>
          }
        >
          <div style={{ display: 'grid', gap: '.85rem' }}>
            <p className="muted" style={{ margin: 0, fontSize: '.86rem' }}>
              Puedes copiar este reporte dinámico o enviarlo directamente a los grupos de WhatsApp de compras / almacén:
            </p>
            <textarea
              className="input mono"
              rows={14}
              style={{ fontSize: '.82rem', lineHeight: 1.4, width: '100%', boxSizing: 'border-box' }}
              readOnly
              value={textoWhatsapp}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
