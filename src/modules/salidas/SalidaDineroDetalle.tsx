import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { money, num, dateTime } from '@/shared/lib/format';
import type { MovimientoCaja, Producto } from '@/shared/lib/types';
import { ProductoDetail } from '@/modules/inventario/ProductoDetail';
import { descargarSalidaDineroPdf, descargarTrasladoDineroPdf } from './salidaPdf';

/**
 * Detalle COMPLETO de una salida/traslado de DINERO (gasto). Muestra todos los datos:
 * caja, monto, motivo, categoría/beneficiario, cuenta, quién lo autorizó/registró, cuándo,
 * y —si la salida fue conciliada con mineral— el detalle del producto recibido.
 */
export function SalidaDineroDetalle({
  mov, producto, esTraslado, onClose,
}: {
  mov: MovimientoCaja;
  producto: Producto | null;
  esTraslado: boolean;
  onClose: () => void;
}) {
  const [traza, setTraza] = useState(false);
  const conciliada = mov.estado_mineral === 'conciliada';

  async function handlePdf() {
    try { esTraslado ? await descargarTrasladoDineroPdf(mov) : await descargarSalidaDineroPdf(mov); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  const cat = [mov.gasto_categoria, mov.gasto_subcategoria].filter(Boolean).join(' · ') || mov.categoria || null;

  // Datos generales del movimiento. Solo se listan las filas con valor.
  const filas: Array<[string, string | null]> = [
    ['Caja', `${mov.caja?.nombre ?? '—'} (${mov.moneda})`],
    ['Tipo', `${esTraslado ? 'Traslado' : 'Salida'} de dinero`],
    ['Monto', money(Number(mov.monto) || 0)],
    [esTraslado ? 'Hacia' : 'Dirigido a', mov.destino || null],
    ['Motivo / detalle', mov.motivo || null],
    ['Categoría', cat],
    ['N° correlativo', mov.gasto_correlativo != null ? String(mov.gasto_correlativo) : null],
    ['Beneficiario', mov.beneficiario || null],
    ['Cuenta', mov.cuenta || null],
    ['Tasa (Bs/unidad)', mov.tasa_bs != null ? num(mov.tasa_bs) : null],
    ['Nota de entrega', mov.nota_entrega || null],
    ['Saldo antes', money(Number(mov.saldo_antes) || 0)],
    ['Saldo después', money(Number(mov.saldo_despues) || 0)],
    ['Autorizado / registrado por', mov.actor_name || mov.actor || '—'],
    ['Fecha de salida', dateTime(mov.at)],
    ...(!esTraslado ? [['Estado mineral', conciliada ? 'Conciliada' : 'Pendiente de conciliar'] as [string, string]] : []),
  ];

  // Detalle del producto/mineral recibido (cuando la salida se concilió con material).
  const filasMineral: Array<[string, string]> = conciliada ? [
    ['Producto', mov.mineral_producto_nombre || producto?.nombre || '—'],
    ['Cantidad recibida', `${num(Number(mov.mineral_cantidad) || 0)} ${mov.mineral_unidad ?? producto?.unidad ?? ''}`.trim()],
    ['Costo unitario', mov.mineral_costo_unit != null ? money(Number(mov.mineral_costo_unit)) : '—'],
    ['Descripción', mov.mineral_descripcion || '—'],
    ['Conciliada el', mov.conciliada_at ? dateTime(mov.conciliada_at) : '—'],
  ] : [];

  return (
    <Modal
      title={esTraslado ? 'Detalle del traslado de dinero' : 'Detalle de la salida de dinero'}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={handlePdf}>↓ PDF</button>
          {producto && <button className="btn btn-ghost" onClick={() => setTraza(true)}>📋 Trazabilidad del producto</button>}
          <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.86rem' }}>
          <tbody>
            {filas.filter(([, v]) => v != null).map(([k, v]) => (
              <tr key={k}>
                <td style={{ fontWeight: 600, width: 180 }}>{k}</td>
                <td className="mono">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {conciliada && (
        <>
          <div className="card-title" style={{ marginTop: '1rem' }}><span style={{ color: 'var(--primary-3)' }}>⛏ Mineral recibido</span></div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.86rem' }}>
              <tbody>
                {filasMineral.map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ fontWeight: 600, width: 180 }}>{k}</td>
                    <td className="mono">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {traza && producto && (
        <ProductoDetail producto={producto} onClose={() => setTraza(false)} />
      )}
    </Modal>
  );
}
