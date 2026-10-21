/* ============================================================
   MGG · Compras · Cierre diario (modal en pantalla) · 21-10-2026
   Modo RESUMEN: cuatro títulos con su cantidad —pedidos, órdenes pendientes por
   aprobar, órdenes por pagar y órdenes pagadas—. Se filtra por día, semana, mes o
   rango de fechas (con «Hoy» solo se ve lo de hoy). Indica la fecha y la hora en que se
   imprime. Salidas con la misma data: PDF, Excel y WhatsApp (ventana «Avisar»).
   Las reglas de cada cantidad están en `cierreDiario.ts`. Se actualiza en vivo.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { ITEMS_CIERRE, hoyVE, rangoCierre, type FiltroCierre, type ModoCierre, type ResumenCierre } from './cierreDiario';
import { cargarCierreDiario } from './cierreDiario.repository';
import { mensajeCierreDiario } from './cierreDiarioMensaje';
import { fechaReporteTexto } from './comprasReporteMensaje';
import { MensajeWhatsappModal } from './MensajeWhatsappModal';

const MODOS: { key: ModoCierre; label: string }[] = [
  { key: 'dia', label: 'Día' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
  { key: 'rango', label: 'Rango de fechas' },
];

const filtroDeHoy = (): FiltroCierre => {
  const hoy = hoyVE();
  return { modo: 'dia', dia: hoy, mes: hoy.slice(0, 7), desde: hoy, hasta: hoy };
};

export function CierreDiarioModal({ onClose }: { onClose: () => void }) {
  const [filtro, setFiltro] = useState<FiltroCierre>(filtroDeHoy);
  const [resumen, setResumen] = useState<ResumenCierre | null>(null);
  const [cargando, setCargando] = useState(true);
  /** Cuándo se consultó (se vuelve a fijar en cada actualización). */
  const [consultado, setConsultado] = useState(() => new Date().toISOString());
  const [genPdf, setGenPdf] = useState(false);
  const [genExcel, setGenExcel] = useState(false);
  const [avisar, setAvisar] = useState<string | null>(null);

  const rango = useMemo(() => rangoCierre(filtro), [filtro]);

  const cargar = useCallback(async () => {
    try {
      setResumen(await cargarCierreDiario(rango));
      setConsultado(new Date().toISOString());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar el cierre diario', 'error');
    } finally {
      setCargando(false);
    }
  }, [rango]);

  useEffect(() => { setCargando(true); void cargar(); }, [cargar]);
  // Realtime: cada pedido, cotización, aprobación o pago cambia las cantidades al instante.
  useRealtime(['ordenes', 'ofertas_proveedor'], () => { void cargar(); });

  const set = (patch: Partial<FiltroCierre>) => setFiltro((f) => ({ ...f, ...patch }));

  async function verPdf() {
    if (!resumen) return;
    setGenPdf(true);
    try {
      const { descargarCierreDiarioPdf } = await import('./cierreDiarioPdf');
      await descargarCierreDiarioPdf(resumen, new Date().toISOString());
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setGenPdf(false); }
  }

  async function verExcel() {
    if (!resumen) return;
    setGenExcel(true);
    try {
      const { exportarCierreDiarioExcel } = await import('./cierreDiarioExcel');
      await exportarCierreDiarioExcel(resumen, new Date().toISOString());
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el Excel', 'error'); }
    finally { setGenExcel(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button className="btn btn-ghost" onClick={() => void verExcel()} disabled={genExcel || !resumen}>
        {genExcel ? 'Generando…' : '📊 Excel'}
      </button>
      {/* Abre la ventana «Avisar» (la de Combustible): el mensaje a la vista, «Copiar» y «Enviar por WhatsApp». */}
      <button className="btn btn-ghost" onClick={() => resumen && setAvisar(mensajeCierreDiario(resumen, new Date().toISOString()))} disabled={!resumen}>
        💬 WhatsApp
      </button>
      <button className="btn btn-primary" onClick={() => void verPdf()} disabled={genPdf || !resumen}>
        {genPdf ? 'Generando…' : '📄 Ver PDF (vista previa)'}
      </button>
    </>
  );

  return (
    <Modal title="Cierre diario" size="lg" onClose={onClose} footer={footer}>
      {/* ── Filtro: día, semana, mes o rango ── */}
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.7rem' }} role="tablist" aria-label="Período del cierre">
        {MODOS.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={filtro.modo === m.key}
            className={`btn ${filtro.modo === m.key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => set({ modo: m.key })}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '.6rem' }}>
        {(filtro.modo === 'dia' || filtro.modo === 'semana') && (
          <div className="form-row" style={{ margin: 0 }}>
            <label>{filtro.modo === 'dia' ? 'Día' : 'Un día de la semana'}</label>
            <input className="input" type="date" value={filtro.dia} onChange={(e) => set({ dia: e.target.value })} />
          </div>
        )}
        {filtro.modo === 'mes' && (
          <div className="form-row" style={{ margin: 0 }}>
            <label>Mes</label>
            <input className="input" type="month" value={filtro.mes} onChange={(e) => set({ mes: e.target.value })} />
          </div>
        )}
        {filtro.modo === 'rango' && (
          <>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Desde</label>
              <input className="input" type="date" value={filtro.desde} max={filtro.hasta || undefined} onChange={(e) => set({ desde: e.target.value })} />
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Hasta</label>
              <input className="input" type="date" value={filtro.hasta} min={filtro.desde || undefined} onChange={(e) => set({ hasta: e.target.value })} />
            </div>
          </>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => setFiltro(filtroDeHoy())} title="Volver a HOY: solo lo de hoy">
          Hoy
        </button>
      </div>

      <div className="muted" style={{ fontSize: '.85rem', marginBottom: '.8rem' }}>
        <div><strong>Período:</strong> {rango.etiqueta}</div>
        <div><strong>🕒 Fecha y hora de impresión:</strong> {fechaReporteTexto(consultado)} <span style={{ opacity: .8 }}>(al generar el PDF, el Excel o el WhatsApp se anota la hora exacta)</span></div>
      </div>

      {/* ── Resumen: los cuatro títulos con su cantidad ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.7rem' }}>
        {ITEMS_CIERRE.map((it) => {
          const cantidad = resumen?.items.find((x) => x.key === it.key)?.cantidad;
          return (
            <div key={it.key} className="card" style={{ margin: 0, padding: '.8rem 1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '.9rem' }}>{it.emoji} {it.titulo}</div>
              <div className="mono" style={{ fontSize: '2.1rem', fontWeight: 800, lineHeight: 1.2, margin: '.2rem 0', color: 'var(--primary)' }}>
                {cargando || cantidad == null ? '…' : cantidad}
              </div>
              <div className="muted" style={{ fontSize: '.74rem' }}>{it.ayuda}</div>
            </div>
          );
        })}
      </div>

      {/* ── Actividad por analista: cotizaciones y órdenes finalizadas ── */}
      <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <div style={{ fontWeight: 700, fontSize: '.95rem' }}>
            👥 Rendimiento por analista
          </div>
          <div style={{ display: 'flex', gap: '.5rem', fontSize: '.8rem' }}>
            <span className="badge" title="Total de cotizaciones cargadas en el período">
              Cotizaciones cargadas: <strong>{cargando ? '…' : resumen?.totalCotizaciones ?? 0}</strong>
            </span>
            <span className="badge" title="Total de órdenes finalizadas en el período">
              Órdenes finalizadas: <strong>{cargando ? '…' : resumen?.totalFinalizadas ?? 0}</strong>
            </span>
          </div>
        </div>

        {cargando ? (
          <div className="muted" style={{ fontSize: '.85rem', padding: '.4rem 0' }}>Cargando analistas…</div>
        ) : !resumen?.analistas.length ? (
          <div className="muted" style={{ fontSize: '.85rem', fontStyle: 'italic', padding: '.4rem 0' }}>
            Sin actividad de analistas registrada en este período.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead>
                <tr>
                  <th>Analista</th>
                  <th style={{ textAlign: 'center', width: '180px' }}>Cotizaciones cargadas</th>
                  <th style={{ textAlign: 'center', width: '180px' }}>Órdenes finalizadas</th>
                </tr>
              </thead>
              <tbody>
                {resumen.analistas.map((a) => (
                  <tr key={a.email}>
                    <td>
                      <strong>{a.nombre}</strong>
                      <div className="muted" style={{ fontSize: '.74rem' }}>{a.email}</div>
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{a.cotizaciones}</td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{a.ordenesFinalizadas}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td>TOTAL</td>
                  <td style={{ textAlign: 'center' }}>{resumen.totalCotizaciones}</td>
                  <td style={{ textAlign: 'center' }}>{resumen.totalFinalizadas}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <small className="hint muted" style={{ display: 'block', marginTop: '.8rem' }}>
        Cuentan órdenes de compra y servicios (no las compras ni servicios directos). Con «Hoy» solo se ve lo que entró hoy a cada estado; con semana, mes o rango, lo del período. Se actualiza en vivo.
      </small>

      {avisar && <MensajeWhatsappModal titulo="Avisar · Cierre diario" texto={avisar} onClose={() => setAvisar(null)} />}
    </Modal>
  );
}
