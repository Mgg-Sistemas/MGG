import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { useQuien } from '@/shared/lib/directorioUsuarios';
import { dateTime, money } from '@/shared/lib/format';
import type { Orden } from '@/shared/lib/types';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
const fechaMontadaOrden = (o: Orden) => o.oc_creada_en || o.oc_emitida_en || [...(o.historial || [])].reverse().find(h => /^oc_creada/.test(h.evento))?.at || o.created_at;
const fechaPagoTesoreriaOrden = (o: Orden) => o.pagada_en || [...(o.historial || [])].reverse().find(h => h.evento === 'pagada')?.at;
const resolverAnalistaOrden = (o: Orden, quien: (nombre: string | null, correo?: string | null) => string) => quien(null, o.oc_creada_por || o.oc_emitida_por || o.metodo_pago_por || o.aprobada_por) || 'Por asignar';
const etiquetaSinPagoTesoreria = (c?: string | null) => c === 'contra_entrega' ? 'Contra entrega (sin pago)' : c === 'credito' ? 'A crédito (sin pago)' : 'Pendiente de pago';

export type OrdenTarjeta = Orden & { proveedores?: { razon_social: string } | null };

export function ContextoCompraTarjeta({ orden, titulo, detalle, estado }: { orden?: OrdenTarjeta; titulo: string; detalle: string[]; estado: string }) {
  const quien = useQuien();
  const [whatsapp, setWhatsapp] = useState(false);
  if (!orden) return <p className="muted">Datos de la OC no disponibles.</p>;
  const analista = resolverAnalistaOrden(orden, quien);
  const montada = fechaMontadaOrden(orden);
  const pagada = fechaPagoTesoreriaOrden(orden);
  const proveedor = orden.proveedores?.razon_social || 'Sin proveedor asignado';
  const pago = pagada ? dateTime(pagada) : etiquetaSinPagoTesoreria(orden.condiciones_pago);
  const moneda = (orden as OrdenTarjeta & { moneda?: string; total_moneda?: string }).total_moneda || (orden as OrdenTarjeta & { moneda?: string }).moneda || 'USD';
  const texto = [
    `📋 *${titulo.toLocaleUpperCase()}*`, '', `🧾 *OC:* ${orden.oc_codigo || orden.codigo}`, `📋 *Solicitud:* ${orden.codigo}`,
    `🏪 *Proveedor:* ${proveedor}`, `👤 *Analista encargado:* ${analista}`,
    `📅 *Fecha montada:* ${montada ? dateTime(montada) : '—'}`, `💳 *Pago Tesorería:* ${pago}`,
    `📦 *Recepción:* ${orden.recibida_en ? dateTime(orden.recibida_en) : 'Sin recepción registrada'}`,
    `👷 *Recibido por:* ${orden.recibida_por ? quien(null, orden.recibida_por) : '—'}`,
    `💰 *Total de la OC:* ${money(orden.total, moneda)}`, `${estado.startsWith('Recibido') ? '🟢' : '🟡'} *Estado:* ${estado}`, '',
    ...detalle.map(linea => {
      if (linea.startsWith('Motivo del reintegro:')) return '📝 *Motivo del reintegro:*' + linea.slice('Motivo del reintegro:'.length);
      if (linea.startsWith('Motivo del almacenista:')) return '👷 *Motivo del almacenista:*' + linea.slice('Motivo del almacenista:'.length);
      if (linea.startsWith('Importe del reintegro:')) return '↩️ *Importe del reintegro:*' + linea.slice('Importe del reintegro:'.length);
      if (linea.startsWith('Referencia:')) return '🔎 *Referencia:*' + linea.slice('Referencia:'.length);
      return '📦 ' + linea;
    }),
  ].join('\n');
  return <>
    <div className="compras-proveedor">{proveedor}</div>
    <dl className="compras-contexto">
      <div><dt>👤 Analista</dt><dd>{analista}</dd></div>
      <div><dt>📅 Montada</dt><dd>{montada ? dateTime(montada) : '—'}</dd></div>
      <div><dt>💳 Pagó Tesorería</dt><dd>{pago}</dd></div>
      <div><dt>📦 Recepción</dt><dd>{orden.recibida_en ? dateTime(orden.recibida_en) : 'Sin recepción registrada'}</dd></div>
      <div><dt>💰 Total de la OC</dt><dd>{money(orden.total, moneda)}</dd></div>
      <div><dt>👷 Recibido por</dt><dd>{orden.recibida_por ? quien(null, orden.recibida_por) : '—'}</dd></div>
    </dl>
    <div className="compras-acciones"><button className="btn" style={{ color: '#25d366', borderColor: '#25d366', flex: 1 }} onClick={() => setWhatsapp(true)}>💬 WhatsApp</button></div>
    {whatsapp && <Modal title={'💬 ' + titulo + ' · ' + (orden.oc_codigo || orden.codigo)} onClose={() => setWhatsapp(false)}><div className="compras-panel"><CompartirWhatsapp texto={texto} /></div></Modal>}
  </>;
}
