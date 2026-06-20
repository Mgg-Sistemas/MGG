import { useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { money, num } from '@/shared/lib/format';
import type { Existencia, Producto, TipoMovimiento } from '@/shared/lib/types';
import { calcularPMP, type MovimientoInput } from './movimientos.repository';
import { AlmacenPicker } from './AlmacenPicker';

interface MovimientoFormProps {
  producto: Producto;
  /** Existencias del producto por almacén (stock + costo propios). */
  existencias: Existencia[];
  /** Nombres de almacén disponibles para los selectores. */
  almacenesList: string[];
  /** Si viene, el almacén queda fijo (ej. desde el detalle de un almacén). */
  fixedAlmacen?: string | null;
  actorEmail: string;
  actorName?: string | null;
  onClose: () => void;
  onSubmit: (data: MovimientoInput, transfer?: { almacenDestino: string }) => Promise<void>;
}

type TipoManual = 'entrada' | 'salida' | 'ajuste' | 'transferencia' | 'consumo' | 'fundicion' | 'fin_fundicion';

/** Parsea un número aceptando coma o punto como separador decimal (es-VE usa coma),
 *  para que un costo como "0,35" o "0.35" no se pierda. */
const parseDecimal = (s: number | string | null | undefined): number => {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  const limpio = String(s ?? '').trim().replace(/\s+/g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  return Number(limpio) || 0;
};

const OPCIONES: { value: TipoManual; label: string; sign: 'pos' | 'neg' | 'any' | 'zero' }[] = [
  { value: 'entrada',       label: 'Entrada (suma stock)',                sign: 'pos' },
  { value: 'salida',        label: 'Salida (resta stock)',                sign: 'neg' },
  { value: 'consumo',       label: 'Consumo en proceso',                  sign: 'neg' },
  { value: 'transferencia', label: 'Transferencia a otro almacén',        sign: 'neg' },
  { value: 'fundicion',     label: '🔥 Iniciar fundición (marca el producto)', sign: 'zero' },
  { value: 'fin_fundicion', label: '✓ Fin de fundición (libera el producto)', sign: 'zero' },
  { value: 'ajuste',        label: 'Ajuste manual (cualquier signo)',     sign: 'any' },
];

export function MovimientoForm({ producto, existencias, almacenesList, fixedAlmacen, actorEmail, actorName, onClose, onSubmit }: MovimientoFormProps) {
  const almacenInicial = fixedAlmacen || producto.almacen || almacenesList[0] || 'General';
  const [almacen, setAlmacen] = useState(almacenInicial);
  const [tipo, setTipo] = useState<TipoManual>('entrada');
  const [cantidad, setCantidad] = useState('1');
  const [almacenDestino, setAlmacenDestino] = useState('');
  const [signoAjuste, setSignoAjuste] = useState<'pos' | 'neg'>('pos');
  const [detalle, setDetalle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Existencia (stock + costo) del almacén seleccionado.
  const exSel = existencias.find((e) => e.almacen === almacen);
  const stockAlmacen = Number(exSel?.stock) || 0;
  const costoAlmacen = Number(exSel?.costo_promedio) || 0;

  // Total del producto (suma de todos los almacenes) y desglose, para que coincida
  // con el número de la lista de inventario y se vea dónde está repartido el stock.
  const stockTotal = existencias.reduce((acc, e) => acc + (Number(e.stock) || 0), 0);
  const desglose = existencias
    .filter((e) => (Number(e.stock) || 0) !== 0)
    .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));
  const repartido = desglose.length > 1;

  const [costoUnit, setCostoUnit] = useState(String(costoAlmacen || producto.precio || 0));

  // Conversor de bultos (solo para entradas): se ingresa por bulto/caja y el
  // sistema convierte a unidades. El "unidades por bulto" se ajusta en cada
  // ingreso (los tamaños varían); su default es el sugerido del producto.
  const [porBultos, setPorBultos] = useState(false);
  const [bultos, setBultos] = useState('1');
  const [uPorBulto, setUPorBulto] = useState(producto.unidades_empaque != null ? String(producto.unidades_empaque) : '');
  const [costoBulto, setCostoBulto] = useState('');

  const opcion = OPCIONES.find((o) => o.value === tipo)!;
  const bultosNum = Number(bultos) || 0;
  const uPorBultoNum = Number(uPorBulto) || 0;
  const costoBultoNum = parseDecimal(costoBulto);
  const usaBultos = tipo === 'entrada' && porBultos;
  const cantidadNum = usaBultos ? bultosNum * uPorBultoNum : (Number(cantidad) || 0);
  const delta =
    opcion.sign === 'zero'
      ? 0
      : opcion.sign === 'pos'
        ? Math.abs(cantidadNum)
        : opcion.sign === 'neg'
          ? -Math.abs(cantidadNum)
          : signoAjuste === 'pos'
            ? Math.abs(cantidadNum)
            : -Math.abs(cantidadNum);

  const stockResultante = Math.max(0, stockAlmacen + delta);
  const isFundicion = tipo === 'fundicion' || tipo === 'fin_fundicion';
  const esEntradaConCosto = tipo === 'entrada';
  const esTransferencia = tipo === 'transferencia';
  const costoUnitNum = usaBultos ? (uPorBultoNum > 0 ? costoBultoNum / uPorBultoNum : 0) : parseDecimal(costoUnit);
  const nuevoPMP =
    esEntradaConCosto && cantidadNum > 0
      ? calcularPMP(stockAlmacen, costoAlmacen, cantidadNum, costoUnitNum)
      : costoAlmacen;

  function onChangeAlmacen(value: string) {
    setAlmacen(value);
    // Al cambiar de almacén, el costo por defecto de la entrada sigue el costo de ese almacén.
    const ex = existencias.find((e) => e.almacen === value);
    setCostoUnit(String(Number(ex?.costo_promedio) || producto.precio || 0));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (usaBultos && (bultosNum <= 0 || uPorBultoNum <= 0)) {
      setError('Indicá los bultos y las unidades por bulto.');
      return;
    }
    if (!isFundicion && cantidadNum <= 0) {
      setError('La cantidad debe ser mayor que 0.');
      return;
    }
    if (esTransferencia && !almacenDestino) {
      setError('Indica el almacén destino para la transferencia.');
      return;
    }
    if (esTransferencia && almacenDestino === almacen) {
      setError('El almacén destino debe ser distinto del de origen.');
      return;
    }
    if ((tipo === 'salida' || tipo === 'consumo' || tipo === 'transferencia') && cantidadNum > stockAlmacen) {
      setError(`No hay stock suficiente en ${almacen}. Disponible: ${num(stockAlmacen)} ${producto.unidad}.`);
      return;
    }
    if (tipo === 'fundicion' && producto.en_fundicion) {
      setError('El producto ya está marcado como en proceso de fundición.');
      return;
    }
    if (tipo === 'fin_fundicion' && !producto.en_fundicion) {
      setError('El producto no está marcado como en proceso de fundición.');
      return;
    }

    setSaving(true);
    try {
      if (esTransferencia) {
        // La transferencia la resuelve el padre (salida origen + entrada destino).
        const payload: MovimientoInput = {
          producto_id: producto.id,
          tipo: 'transferencia',
          delta,
          almacen,
          actor: actorEmail,
          actor_name: actorName ?? null,
          ref_tipo: 'manual',
          detalle: detalle || null,
        };
        await onSubmit(payload, { almacenDestino });
        onClose();
        return;
      }

      const tipoSchema: TipoMovimiento = tipo;
      const payload: MovimientoInput = {
        producto_id: producto.id,
        tipo: tipoSchema,
        delta,
        almacen,
        actor: actorEmail,
        actor_name: actorName ?? null,
        ref_tipo: 'manual',
        detalle: detalle || null,
        precio_unitario: esEntradaConCosto ? costoUnitNum : null,
      };
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento.');
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
        Cancelar
      </button>
      <button type="submit" form="mov-form" className="btn btn-primary" disabled={saving}>
        {saving ? 'Registrando…' : esTransferencia ? 'Transferir' : 'Registrar movimiento'}
      </button>
    </>
  );

  return (
    <Modal title={`Movimiento · ${producto.sku}`} onClose={onClose} footer={footer}>
      <form id="mov-form" onSubmit={handleSubmit}>
        {error && (
          <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        <div className="card" style={{ marginBottom: '.75rem', padding: '.75rem 1rem' }}>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Producto
          </div>
          <div style={{ fontWeight: 600 }}>{producto.nombre}</div>
          <div className="muted mono" style={{ fontSize: '.78rem' }}>
            Stock en <strong>{almacen}</strong>: <strong>{num(stockAlmacen)} {producto.unidad}</strong> · costo {money(costoAlmacen)}
          </div>
          {repartido && (
            <div className="muted mono" style={{ fontSize: '.72rem', marginTop: '.2rem' }}>
              Total del producto: <strong>{num(stockTotal)} {producto.unidad}</strong> ·{' '}
              {desglose.map((e, i) => (
                <span key={e.almacen}>{i > 0 ? ' · ' : ''}{e.almacen} {num(Number(e.stock) || 0)}</span>
              ))}
            </div>
          )}
        </div>

        {fixedAlmacen ? (
          <div className="form-row">
            <label>Almacén</label>
            <input className="input" value={almacen} readOnly tabIndex={-1} />
          </div>
        ) : (
          <AlmacenPicker value={almacen} onChange={onChangeAlmacen} />
        )}
        <div className="form-row">
          <label>Tipo de movimiento</label>
          <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as TipoManual)}>
            {OPCIONES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Conversor de bultos: solo al ingresar mercancía (entrada). */}
        {esEntradaConCosto && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', marginBottom: '.6rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={porBultos} onChange={(e) => setPorBultos(e.target.checked)} />
            <span style={{ fontSize: '.85rem' }}>📦 Ingresar por bultos / cajas (convierte a {producto.unidad})</span>
          </label>
        )}

        {usaBultos ? (
          <>
            <div className="form-grid">
              <div className="form-row">
                <label>Bultos / cajas</label>
                <input className="input mono" type="number" min={0} step="any" value={bultos} onChange={(e) => setBultos(e.target.value)} required />
              </div>
              <div className="form-row">
                <label>Unidades por bulto</label>
                <input className="input mono" type="number" min={0} step="any" value={uPorBulto} onChange={(e) => setUPorBulto(e.target.value)}
                  placeholder={producto.unidades_empaque != null ? String(producto.unidades_empaque) : 'Ej: 24'} required />
                <small className="muted" style={{ fontSize: '.72rem' }}>Ajustalo en cada ingreso; el tamaño puede variar.</small>
              </div>
            </div>
            <div className="form-row">
              <label>Costo por bulto (USD)</label>
              <input className="input mono" type="text" inputMode="decimal" value={costoBulto} onChange={(e) => setCostoBulto(e.target.value)} placeholder="Precio pagado por cada bulto" />
              <small className="muted" style={{ fontSize: '.72rem' }}>
                {bultosNum > 0 && uPorBultoNum > 0
                  ? <>= <strong>{num(cantidadNum)} {producto.unidad}</strong>{costoBultoNum > 0 ? <> · costo unitario <strong>{money(costoUnitNum)}</strong> ({money(costoBultoNum)} ÷ {num(uPorBultoNum)})</> : ''}</>
                  : 'Indicá bultos y unidades por bulto para calcular el total.'}
              </small>
            </div>
          </>
        ) : (
        <div className="form-grid">
          {!isFundicion && (
            <div className="form-row">
              <label>Cantidad ({producto.unidad})</label>
              <input
                className="input mono"
                type="number"
                min={1}
                step="any"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                required={!isFundicion}
              />
            </div>
          )}
          {esEntradaConCosto && (
            <div className="form-row">
              <label>Costo unitario del proveedor (USD)</label>
              <input
                className="input mono"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={costoUnit}
                onChange={(e) => setCostoUnit(e.target.value)}
              />
              <small className="muted" style={{ fontSize: '.72rem' }}>
                Precio pagado en esta compra. Se promedia con el costo del almacén (PMP).
              </small>
            </div>
          )}
          {opcion.sign === 'any' && (
            <div className="form-row">
              <label>Signo del ajuste</label>
              <select
                className="select"
                value={signoAjuste}
                onChange={(e) => setSignoAjuste(e.target.value as 'pos' | 'neg')}
              >
                <option value="pos">+ aumenta stock</option>
                <option value="neg">− disminuye stock</option>
              </select>
            </div>
          )}
        </div>
        )}

        {esTransferencia && (
          <div>
            <AlmacenPicker value={almacenDestino} onChange={setAlmacenDestino} sedeLabel="Sede destino" label="Almacén destino" />
            <small className="muted" style={{ fontSize: '.72rem' }}>
              Se descuenta de {almacen} y se suma al destino llevando su costo (PMP).
            </small>
          </div>
        )}

        <div className="form-row">
          <label>Detalle (opcional)</label>
          <input
            className="input"
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            placeholder="Motivo, referencia, observación…"
          />
        </div>

        <div
          className="card"
          style={{
            padding: '.65rem .85rem',
            borderLeft: '3px solid var(--primary)',
            background: 'var(--bg-1)',
            margin: 0,
          }}
        >
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Vista previa {esTransferencia ? `· ${almacen} → ${almacenDestino || '—'}` : `· ${almacen}`}
          </div>
          <div className="mono" style={{ fontSize: '.9rem' }}>
            {num(stockAlmacen)} → <strong>{num(stockResultante)}</strong>{' '}
            <span style={{ color: delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              ({delta >= 0 ? '+' : ''}{num(delta)})
            </span>{' '}
            {producto.unidad}
          </div>
          {esEntradaConCosto && (
            <div className="mono" style={{ fontSize: '.9rem', marginTop: '.35rem' }}>
              Costo base (PMP): {money(costoAlmacen)} →{' '}
              <strong style={{ color: 'var(--primary-3)' }}>{money(nuevoPMP)}</strong>
              {nuevoPMP !== costoAlmacen && (
                <span className="muted"> · {num(stockAlmacen)}×{money(costoAlmacen)} + {num(cantidadNum)}×{money(costoUnitNum)}</span>
              )}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
