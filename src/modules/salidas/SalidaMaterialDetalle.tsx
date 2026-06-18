import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { money, num, date, dateTime } from '@/shared/lib/format';
import type { Movimiento, Producto } from '@/shared/lib/types';
import { ProductoDetail } from '@/modules/inventario/ProductoDetail';
import { descargarSalidaMaterialPdf } from './salidaPdf';
import { enviarSalidaAMultiples } from './enviarSalida';

/** Detalle de una salida/traslado de material con opciones de PDF y trazabilidad. */
export function SalidaMaterialDetalle({
  mov, producto, esTraslado, onClose,
}: {
  mov: Movimiento;
  producto: Producto | null;
  esTraslado: boolean;
  onClose: () => void;
}) {
  const [traza, setTraza] = useState(false);
  const [correoOpen, setCorreoOpen] = useState(false);
  const [emails, setEmails] = useState('');
  const [enviando, setEnviando] = useState(false);
  const cant = Math.abs(Number(mov.delta) || 0);
  const precio = Number(mov.precio_unitario) || 0;

  async function handlePdf() {
    try { await descargarSalidaMaterialPdf(mov, esTraslado); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function handleEnviarCorreo() {
    const lista = emails.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!lista.length) { toast('Indicá al menos un correo', 'error'); return; }
    setEnviando(true);
    try {
      const { enviados, fallidos } = await enviarSalidaAMultiples(mov, esTraslado, lista);
      toast(`Enviado a: ${enviados.join(', ')}`, 'success');
      if (fallidos.length) toast(`No se pudo enviar a: ${fallidos.map((f) => f.email).join(', ')}`, 'error');
      setCorreoOpen(false);
      setEmails('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar el correo', 'error');
    } finally {
      setEnviando(false);
    }
  }

  const filas: Array<[string, string]> = [
    ['Producto', mov.producto ? `${mov.producto.nombre} · ${mov.producto.sku}` : '—'],
    ['Almacén origen', mov.almacen || '—'],
    [esTraslado ? 'Almacén destino' : 'Dirigido a', mov.destino || '—'],
    ['Cantidad', `${num(cant)} ${mov.producto?.unidad ?? ''}`.trim()],
    ['Precio unitario', precio ? money(precio) : '—'],
    ['Precio total', precio ? money(precio * cant) : '—'],
    ['Fecha de entrega', mov.fecha_entrega ? date(mov.fecha_entrega) : '—'],
    ['Consumo interno', mov.consumo_interno ? 'Sí 🏭' : 'No'],
    ['Motivo / detalle', mov.detalle || '—'],
    ['Registrado por', mov.actor_name || mov.actor],
    ['Fecha de registro', dateTime(mov.at)],
  ];

  return (
    <Modal
      title={esTraslado ? 'Detalle del traslado' : 'Detalle de la salida'}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={handlePdf}>↓ PDF</button>
          <button className="btn btn-ghost" onClick={() => setCorreoOpen(true)}>✉ Enviar por correo</button>
          {producto && <button className="btn btn-ghost" onClick={() => setTraza(true)}>📋 Trazabilidad</button>}
          <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.86rem' }}>
          <tbody>
            {filas.map(([k, v]) => (
              <tr key={k}>
                <td style={{ fontWeight: 600, width: 160 }}>{k}</td>
                <td className="mono">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {traza && producto && (
        <ProductoDetail producto={producto} onClose={() => setTraza(false)} />
      )}

      {correoOpen && (
        <Modal
          title={`Enviar ${esTraslado ? 'traslado' : 'salida'} por correo`}
          size="md"
          onClose={() => !enviando && setCorreoOpen(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setCorreoOpen(false)} disabled={enviando}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleEnviarCorreo} disabled={enviando}>
                {enviando ? 'Enviando…' : 'Enviar'}
              </button>
            </>
          }
        >
          <div className="form-row">
            <label>Correo(s) destinatario(s)</label>
            <input
              className="input"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="correo@ejemplo.com, otro@ejemplo.com"
              autoFocus
            />
            <small className="muted">Separá varios correos con coma o espacio. Se adjunta el comprobante en PDF con la fecha de entrega.</small>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
