import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime, money, num } from '@/shared/lib/format';
import type { Produccion } from '@/shared/lib/types';
import { getProduccionConMateriales } from './produccion.repository';
// descargarProduccionPdf / descargarProduccionExcel se importan dinámicamente (al generar) para no cargar jsPDF/xlsx al abrir.
import { enviarProduccionAMultiples } from './enviarProduccion';

export function duracionProd(inicio: string, fin?: string | null): string {
  if (!fin) return 'En curso';
  const ms = new Date(fin).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

export function ProduccionDetalle({
  id,
  defaultEmail = '',
  titulo = 'Detalle de fundición',
  onEditar,
  onClose,
}: {
  id: string;
  defaultEmail?: string;
  titulo?: string;
  onEditar?: () => void;
  onClose: () => void;
}) {
  const [prod, setProd] = useState<Produccion | null>(null);
  const [loading, setLoading] = useState(true);
  const [enviar, setEnviar] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getProduccionConMateriales(id)
      .then((p) => { if (!cancelled) setProd(p); })
      .catch(() => { if (!cancelled) setProd(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  async function handlePdf() {
    try { const { descargarProduccionPdf } = await import('./produccionPdf'); await descargarProduccionPdf(id); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function handleExcel() {
    try { const { descargarProduccionExcel } = await import('./produccionExcel'); await descargarProduccionExcel(id); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el Excel', 'error'); }
  }

  const cp = prod ? prod.costo_material + prod.mano_obra + prod.costos_indirectos : 0;

  return (
    <Modal
      title={titulo}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {onEditar && <button className="btn btn-ghost" onClick={onEditar}>✎ Editar receta</button>}
          <button className="btn btn-ghost" onClick={handlePdf}>↓ PDF</button>
          <button className="btn btn-ghost" onClick={handleExcel}>↓ Excel</button>
          <button className="btn btn-ghost" onClick={() => setEnviar(true)} disabled={!prod}>✉ Enviar por correo</button>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      {loading ? (
        <EmptyState message="Cargando…" icon="◔" />
      ) : !prod ? (
        <EmptyState message="No se encontró la fundición." icon="✕" />
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
            <div>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                {prod.producto_nombre}
                {prod.receta_num != null && <span className="badge" style={{ fontSize: '.7rem' }}>Receta #{num(prod.receta_num)}</span>}
              </h3>
              <div className="muted mono" style={{ fontSize: '.78rem' }}>
                {num(prod.cantidad)} und · almacén {prod.almacen_destino}
                {prod.horno ? ` · horno ${prod.horno}` : ''} ·{' '}
                <span className={`badge ${prod.estado === 'finalizado' ? 'success' : 'warning'}`}>{prod.estado === 'finalizado' ? 'Finalizado' : 'En fundición'}</span>
              </div>
            </div>
            <div className="muted mono" style={{ fontSize: '.78rem', textAlign: 'right' }}>
              Inicio: {dateTime(prod.inicio_at)}<br />
              Fin: {prod.fin_at ? dateTime(prod.fin_at) : '—'}<br />
              Duración: <strong>{duracionProd(prod.inicio_at, prod.fin_at)}</strong>
            </div>
          </div>

          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.25rem' }}>Materiales utilizados</div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead>
                <tr>
                  <th>Material</th><th>Almacén</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th style={{ textAlign: 'right' }}>Costo unit.</th>
                  <th style={{ textAlign: 'right' }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(prod.materiales ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>{m.material_nombre}</td>
                    <td><span className="badge">{m.almacen}</span></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(m.cantidad)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(m.costo_unitario)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(m.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ padding: '.7rem .9rem', marginTop: '.75rem', borderLeft: '3px solid var(--primary)' }}>
            <div className="mono" style={{ fontSize: '.85rem', lineHeight: 1.7 }}>
              Costo Total de Materiales (CTM): <strong>{money(prod.costo_material)}</strong><br />
              Mano de obra: {money(prod.mano_obra)} · Costos indirectos: {money(prod.costos_indirectos)}<br />
              Costo de Fundición (CP): <strong>{money(cp)}</strong><br />
              Costo unitario (PMP): <strong style={{ color: 'var(--primary-3)' }}>{money(prod.costo_unitario)}</strong><br />
              Precio de venta: {prod.precio_venta != null ? money(prod.precio_venta) : '—'}
              {prod.ganancia != null && (
                <> · Posible ganancia: <strong style={{ color: prod.ganancia >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(prod.ganancia)}</strong></>
              )}
            </div>
          </div>
        </div>
      )}

      {enviar && prod && (
        <EnviarProduccionModal
          produccionId={id}
          codigo={prod.producto_nombre}
          defaultEmail={defaultEmail}
          onClose={() => setEnviar(false)}
        />
      )}
    </Modal>
  );
}

function EnviarProduccionModal({
  produccionId,
  codigo,
  defaultEmail,
  onClose,
}: {
  produccionId: string;
  codigo: string;
  defaultEmail: string;
  onClose: () => void;
}) {
  const [incluirPropio, setIncluirPropio] = useState(true);
  const [extra, setExtra] = useState('');
  const [enviando, setEnviando] = useState(false);

  const propio = defaultEmail.trim().toLowerCase();
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function handleEnviar() {
    const lista: string[] = [];
    if (incluirPropio && propio) lista.push(propio);
    const extraClean = extra.trim().toLowerCase();
    if (extraClean) {
      if (!emailRx.test(extraClean)) {
        toast('El correo adicional no es válido', 'error');
        return;
      }
      lista.push(extraClean);
    }
    if (!lista.length) {
      toast('Marcá al menos un destinatario', 'error');
      return;
    }
    setEnviando(true);
    try {
      const { enviados, fallidos } = await enviarProduccionAMultiples(produccionId, lista);
      if (fallidos.length) {
        const detalle = fallidos.map((f) => `${f.email} (${f.motivo})`).join(' · ');
        notify(`Enviado a ${enviados.join(', ')}. Falló: ${detalle}`, 'warning');
      } else {
        notify(`Reporte de fundición enviado a ${enviados.join(', ')}`, 'success');
      }
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar', 'error');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={`Enviar reporte · ${codigo}`}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={enviando}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleEnviar} disabled={enviando}>
            {enviando ? 'Enviando…' : '📧 Enviar'}
          </button>
        </>
      }
    >
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
        Se enviará el PDF del reporte de fundición a los destinatarios seleccionados.
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '.6rem',
          padding: '.7rem .85rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: incluirPropio ? 'rgba(255,138,0,0.06)' : 'transparent',
          cursor: propio ? 'pointer' : 'not-allowed',
          marginBottom: '.6rem',
        }}
      >
        <input
          type="checkbox"
          checked={incluirPropio}
          disabled={!propio}
          onChange={(e) => setIncluirPropio(e.target.checked)}
        />
        <div>
          <div style={{ fontWeight: 600 }}>Tu correo</div>
          <div className="mono" style={{ fontSize: '.82rem' }}>{propio || '—'}</div>
        </div>
      </label>

      <div className="form-row" style={{ marginTop: '.4rem' }}>
        <label>Correo adicional (opcional)</label>
        <input
          className="input"
          type="email"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="otro@correo.com"
          maxLength={120}
        />
        <small className="muted">Podés mandarlo a un segundo destinatario al mismo tiempo.</small>
      </div>
    </Modal>
  );
}
