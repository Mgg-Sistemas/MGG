/* ============================================================
   MGG · (traído de Golden Touch 11-11-2026) · Ventas · Partes compartidas de los formularios

   Aquí vive TODO lo que la venta y la permuta hacen igual. Antes estaba
   escrito dos veces y un arreglo aplicado a uno no llegaba al otro; el caso
   que más dolía eran los tres avisos del renglón (sin costo / por debajo del
   costo / más que el stock): si mañana alguien corrige el criterio en un
   formulario, el otro sigue mintiendo. Ahora el criterio está una sola vez.

   Lo que NO vive aquí, a propósito:
     · Contra qué monto cuadran las patas de pago. La venta cuadra contra el
       total; la permuta contra la DIFERENCIA, porque parte del precio ya se
       pagó con material y cobrar el total sería cobrarlo dos veces. Por eso
       `TablaPagoLegs` RECIBE el monto objetivo (`aCobrar`) como prop y no lo
       calcula: quien sabe qué hay que cobrar es cada formulario.
     · Los totales del documento. Salen siempre de `resumenDeVenta`, en cada
       formulario, una sola vez.
     · El bloque «Material que recibo» de la permuta, que no existe en la venta.

   Las diferencias de TEXTO entre los dos formularios (se vende / se entrega)
   entran como props, no como ramas `if (esPermuta)`: el componente no tiene
   por qué saber en cuál de los dos está.
   ============================================================ */
import { useState, type Dispatch, type SetStateAction } from 'react';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { notify } from '@/shared/lib/notify';
import { dosDecimales, montoMoneda, num } from '@/shared/lib/format';
import { PREFIJOS_RIF, partirRif } from '@/shared/lib/rif';
import type { Caja, CajaSaldo, CuentaCaja, Producto } from '@/shared/lib/types';
import {
  crearCliente,
  type Cliente, type DocumentoVenta, type ExistenciaProducto, type PagoLeg, type Venta,
} from './ventas.repository';

/* ─────────────────────────── Estado compartido ─────────────────────────── */

/** Un renglón de lo que SALE, mientras se lo edita: todo texto, para no pelear con el tecleo. */
export interface LineaUI {
  id: number;
  productoId: string;
  cantidad: string;
  /** Precargado de `productos.precio_venta`; editable y casi siempre vacío. */
  precio: string;
  descuento: string;
}

/** Una pata del cobro de contado: de qué caja, qué cuenta, qué moneda, cuánto. */
export interface LegUI {
  id: number;
  cajaId: string;
  cuenta: CuentaCaja;
  moneda: string;
  monto: string;
}

export const CUENTAS: { value: CuentaCaja; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'juridica', label: 'Jurídica' },
  { value: 'personal', label: 'Personal' },
];

/** Monedas que se ofrecen para el documento. La tasa Bs/$ va aparte. */
export const MONEDAS_DOC = ['USD', 'Bs'];

export const nuevaLinea = (id: number): LineaUI => ({ id, productoId: '', cantidad: '1', precio: '', descuento: '' });
export const nuevaLeg = (id: number, cajaId: string, moneda: string): LegUI =>
  ({ id, cajaId, cuenta: 'general', moneda, monto: '' });

/** Siguiente id de una lista (max + 1): nunca colisiona aunque se borre del medio. */
export const proximoId = <T extends { id: number }>(xs: T[]): number => xs.reduce((m, x) => Math.max(m, x.id), 0) + 1;

/** Las patas que de verdad se guardan: las que tienen monto. */
export const legsAPago = (legs: LegUI[]): PagoLeg[] =>
  legs.filter((l) => (Number(l.monto) || 0) > 0)
    .map((l) => ({ cuenta: l.cuenta, moneda: l.moneda, monto: Number(l.monto) || 0, cajaId: l.cajaId || null }));

/* ─────────────────────── Cuentas del renglón que sale ───────────────────────
   Cada renglón se calcula con la MISMA función que el pie del documento (sin
   IVA ni descuento de documento, que son del total). Así el renglón y el total
   nunca se contradicen. */

/** Cómo calcular un renglón: es `resumenDeVenta` de un solo renglón, sin IVA. */
export type CalculoRenglon = (calculo: {
  cantidad: number; precio_unit: number; costo_unit: number; descuento: number;
}) => { subtotal: number; gananciaTotal: number };

export interface FilaVenta {
  linea: LineaUI;
  producto: Producto | null;
  calculo: { cantidad: number; precio_unit: number; costo_unit: number; descuento: number };
  costo: number;
  stock: number;
  cantidad: number;
  precio: number;
  subtotal: number;
  ganancia: number;
  /** El costo sale de `existencias.costo_promedio` y ese producto no lo tiene. */
  sinCosto: boolean;
  /** Se está vendiendo por menos de lo que costó. Avisa, no bloquea. */
  bajoCosto: boolean;
  /** Se está sacando más de lo que hay. Avisa, no bloquea: se entrega después. */
  sobreStock: boolean;
  sinPrecio: boolean;
}

/**
 * Los tres avisos del renglón viven aquí y en ningún otro lado. Ninguno bloquea:
 * los tres cuentan algo que el vendedor tiene que saber ANTES de confirmar, no
 * después.
 */
export function calcularFilas(
  lineas: LineaUI[],
  porId: Map<string, Producto>,
  existencias: Record<string, ExistenciaProducto>,
  resumenUno: CalculoRenglon,
): FilaVenta[] {
  return lineas.map((l) => {
    const producto = l.productoId ? porId.get(l.productoId) ?? null : null;
    const existencia = l.productoId ? existencias[l.productoId] : undefined;
    const costo = existencia?.costo_promedio ?? 0;
    const stock = existencia?.stock ?? 0;
    const cantidad = Number(l.cantidad) || 0;
    const precio = Number(l.precio) || 0;
    const desc = Math.max(0, Number(l.descuento) || 0);
    const calculo = { cantidad, precio_unit: precio, costo_unit: costo, descuento: desc };
    const t = resumenUno(calculo);
    return {
      linea: l, producto, calculo,
      costo, stock, cantidad, precio,
      subtotal: t.subtotal,
      ganancia: t.gananciaTotal,
      sinCosto: !!l.productoId && cantidad > 0 && costo <= 0,
      bajoCosto: costo > 0 && precio > 0 && precio < costo,
      sobreStock: !!l.productoId && cantidad > stock,
      sinPrecio: !!l.productoId && cantidad > 0 && precio <= 0,
    };
  });
}

/* ─────────────────────────── Cliente ─────────────────────────── */

/**
 * Todo el estado del cliente del documento: a quién se le vende, y el alta al
 * vuelo si no está en el padrón. Los dos formularios lo usan igual.
 */
export function useClienteVenta(clienteIdInicial: string) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState(clienteIdInicial);
  const [nuevoCliente, setNuevoCliente] = useState(false);
  const [cliNombre, setCliNombre] = useState('');
  const [cliRif, setCliRif] = useState('J-');
  const [cliTelefono, setCliTelefono] = useState('');

  /**
   * Da de alta el cliente si se lo estaba creando al vuelo. Devuelve la ficha
   * (no solo el id): el `setState` de recién no se ve todavía en esta pasada,
   * así que el nombre y el RIF hay que tomarlos de aquí.
   */
  async function resolver(): Promise<Cliente | null> {
    if (!nuevoCliente) return clientes.find((c) => c.id === clienteId) ?? null;
    const nombre = cliNombre.trim();
    if (!nombre) throw new Error('Escribe el nombre del cliente nuevo.');
    const partes = partirRif(cliRif);
    const creado = await crearCliente({
      nombre,
      rif: partes.numero ? `${partes.letra}-${partes.numero}` : null,
      telefono: cliTelefono.trim() || null,
    });
    setClientes((cs) => [...cs, creado].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-VE')));
    setClienteId(creado.id);
    setNuevoCliente(false);
    notify(`Cliente «${creado.nombre}» registrado`, 'success', { link: '#/app/ventas' });
    return creado;
  }

  const selector: ClienteSelectorProps = {
    clientes, clienteId, setClienteId,
    nuevoCliente, setNuevoCliente,
    cliNombre, setCliNombre,
    cliRif, setCliRif,
    cliTelefono, setCliTelefono,
  };

  return { clientes, setClientes, clienteId, resolver, selector };
}

export interface ClienteSelectorProps {
  clientes: Cliente[];
  clienteId: string;
  setClienteId: Dispatch<SetStateAction<string>>;
  nuevoCliente: boolean;
  setNuevoCliente: Dispatch<SetStateAction<boolean>>;
  cliNombre: string;
  setCliNombre: Dispatch<SetStateAction<string>>;
  cliRif: string;
  setCliRif: Dispatch<SetStateAction<string>>;
  cliTelefono: string;
  setCliTelefono: Dispatch<SetStateAction<string>>;
}

/** Elegir cliente del padrón de Tesorería, o darlo de alta aquí mismo. */
export function ClienteSelector({
  clientes, clienteId, setClienteId,
  nuevoCliente, setNuevoCliente,
  cliNombre, setCliNombre,
  cliRif, setCliRif,
  cliTelefono, setCliTelefono,
}: ClienteSelectorProps) {
  return (
    <div className="form-row">
      <label>Cliente</label>
      {!nuevoCliente ? (
        <>
          <SearchSelect value={clienteId} onChange={setClienteId} style={{ maxWidth: 380 }}
            disabled={!clientes.length}
            placeholder={clientes.length ? '🔍 Buscar cliente…' : '— sin clientes —'}
            options={clientes.map((c) => ({ value: c.id, label: `${c.nombre}${c.rif ? ` · ${c.rif}` : ''}` }))} />
          <small className="muted">
            {clienteId
              ? <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .3rem' }}
                  onClick={() => setClienteId('')}>✕ Quitar cliente</button>
              : <>¿No está? <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .3rem' }}
                  onClick={() => setNuevoCliente(true)}>＋ Agregar cliente nuevo</button> (se guarda en el padrón de Tesorería)</>}
          </small>
        </>
      ) : (
        <div className="card" style={{ background: 'var(--bg-2)', padding: '.85rem', marginTop: '.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
            <strong style={{ fontSize: '.88rem' }}>Nuevo cliente</strong>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNuevoCliente(false)}>↩ Elegir existente</button>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Nombre / razón social *</label>
              <input className="input" value={cliNombre} style={{ textTransform: 'uppercase' }}
                onChange={(e) => setCliNombre(e.target.value.toUpperCase())} placeholder="Nombre del cliente" />
            </div>
            <div className="form-row">
              <label>RIF / cédula <span className="muted">(opcional)</span></label>
              <div style={{ display: 'flex', gap: '.4rem' }}>
                <select className="select" value={partirRif(cliRif).letra} aria-label="Tipo de RIF"
                  style={{ width: 'auto', flex: '0 0 auto' }}
                  onChange={(e) => setCliRif(`${e.target.value}-${partirRif(cliRif).numero}`)}>
                  {PREFIJOS_RIF.map((p) => <option key={p.letra} value={p.letra}>{p.letra} · {p.desc}</option>)}
                </select>
                <input className="input mono" value={partirRif(cliRif).numero} inputMode="numeric"
                  onChange={(e) => setCliRif(`${partirRif(cliRif).letra}-${e.target.value.replace(/\D/g, '').slice(0, 10)}`)}
                  placeholder="40778442" style={{ flex: 1 }} />
              </div>
            </div>
            <div className="form-row">
              <label>Teléfono <span className="muted">(opcional)</span></label>
              <input className="input" value={cliTelefono} inputMode="numeric" maxLength={15}
                onChange={(e) => setCliTelefono(e.target.value.replace(/\D/g, '').slice(0, 15))} placeholder="Solo dígitos" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Renglones de lo que sale (con los avisos) ─────────────────── */

export interface TablaRenglonesVentaProps {
  filas: FilaVenta[];
  /** Productos activos del catálogo: lo que se puede elegir. */
  activos: Producto[];
  existencias: Record<string, ExistenciaProducto>;
  porId: Map<string, Producto>;
  moneda: string;
  onSetLinea: (id: number, patch: Partial<LineaUI>) => void;
  onAgregar: () => void;
  onQuitar: (id: number) => void;
  /** «vendiendo» en la venta, «entregando» en la permuta. */
  verboSobreStock: string;
  /** Qué significa un renglón sin precio en este documento. */
  textoSinPrecio: string;
  /** El cierre del cartel de avisos: ninguno bloquea, y por qué. */
  textoNoBloquea: string;
}

export function TablaRenglonesVenta({
  filas, activos, existencias, porId, moneda,
  onSetLinea, onAgregar, onQuitar,
  verboSobreStock, textoSinPrecio, textoNoBloquea,
}: TablaRenglonesVentaProps) {
  /** Al elegir el producto se precarga el precio de venta de su ficha… si lo tiene. */
  function elegirProducto(id: number, productoId: string) {
    const p = porId.get(productoId);
    const sugerido = Number(p?.precio_venta) || 0;
    onSetLinea(id, { productoId, precio: sugerido > 0 ? String(sugerido) : '' });
  }

  const hayAvisos = filas.some((f) => f.sinCosto || f.bajoCosto || f.sobreStock);
  const productosSinCosto = filas.filter((f) => f.sinCosto).length;

  return (
    <>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead>
            <tr>
              <th style={{ minWidth: 260 }}>Producto</th>
              <th style={{ width: 110, textAlign: 'right' }}>Cantidad</th>
              <th style={{ width: 120, textAlign: 'right' }}>Precio</th>
              <th style={{ width: 110, textAlign: 'right' }}>Desc.</th>
              <th style={{ width: 110, textAlign: 'right' }}>Costo</th>
              <th style={{ width: 120, textAlign: 'right' }}>Subtotal</th>
              <th style={{ width: 130, textAlign: 'right' }}>Ganancia</th>
              <th style={{ width: 44 }}></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, idx) => (
              <tr key={f.linea.id}>
                <td>
                  <SearchSelect value={f.linea.productoId} onChange={(v) => elegirProducto(f.linea.id, v)}
                    disabled={!activos.length}
                    placeholder={activos.length ? `🔍 Producto #${idx + 1}…` : '— sin productos —'}
                    options={activos.map((p) => {
                      const ex = existencias[p.id];
                      const stock = ex?.stock ?? 0;
                      const costo = ex?.costo_promedio ?? 0;
                      return {
                        value: p.id,
                        label: `${p.nombre} · ${p.sku} · stock ${num(stock)} ${p.unidad}`
                          + (costo > 0 ? ` · costo ${montoMoneda(costo, moneda)}` : ' · SIN COSTO'),
                      };
                    })} />
                  {/* Los tres avisos. Se ven aquí, pegados al renglón que los provoca. */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', marginTop: '.3rem' }}>
                    {f.sinCosto && (
                      <span className="badge warning" title="El costo sale de existencias.costo_promedio y ese producto no lo tiene cargado">
                        ⚠ sin costo cargado: la ganancia de este renglón no es real
                      </span>
                    )}
                    {f.bajoCosto && (
                      <span className="badge warning" title={`Costo actual ${montoMoneda(f.costo, moneda)}`}>
                        ⚠ por debajo del costo
                      </span>
                    )}
                    {f.sobreStock && (
                      <span className="badge warning" title={`Hay ${num(f.stock)} y se están ${verboSobreStock} ${num(f.cantidad)}`}>
                        ⚠ más de lo que hay en stock (hay {num(f.stock)})
                      </span>
                    )}
                    {f.sinPrecio && <span className="badge info">{textoSinPrecio}</span>}
                  </div>
                </td>
                <td>
                  <input className="input mono" type="number" min={0} step="any" style={{ textAlign: 'right' }}
                    value={f.linea.cantidad} onChange={(e) => onSetLinea(f.linea.id, { cantidad: e.target.value })} />
                </td>
                <td>
                  <input className="input mono" inputMode="decimal" style={{ textAlign: 'right' }}
                    value={f.linea.precio} placeholder="0,00"
                    onChange={(e) => onSetLinea(f.linea.id, { precio: dosDecimales(e.target.value) })} />
                </td>
                <td>
                  <input className="input mono" inputMode="decimal" style={{ textAlign: 'right' }}
                    value={f.linea.descuento} placeholder="0,00"
                    onChange={(e) => onSetLinea(f.linea.id, { descuento: dosDecimales(e.target.value) })} />
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {f.costo > 0 ? montoMoneda(f.costo, moneda) : <span className="muted">—</span>}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(f.subtotal, moneda)}</td>
                <td className="mono" style={{ textAlign: 'right', color: f.ganancia < 0 ? 'var(--danger)' : undefined }}>
                  {montoMoneda(f.ganancia, moneda)}
                </td>
                <td>
                  {filas.length > 1 && (
                    <button type="button" className="btn btn-sm btn-ghost" title="Quitar renglón"
                      onClick={() => onQuitar(f.linea.id)}>✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onAgregar} style={{ marginTop: '.4rem' }}>
        ＋ Agregar producto
      </button>

      {hayAvisos && (
        <div className="card" style={{ marginTop: '.75rem', borderColor: 'var(--warning, #f59e0b)' }}>
          <div className="card-title" style={{ marginBottom: '.25rem' }}>⚠ Revisa antes de confirmar</div>
          <div className="muted" style={{ fontSize: '.82rem' }}>
            {productosSinCosto > 0 && (
              <div>
                {productosSinCosto === 1 ? 'Hay 1 renglón' : `Hay ${productosSinCosto} renglones`} con costo en 0:
                la ganancia que se ve abajo sale inflada (margen 100 %) y no es real. El costo se congela al
                confirmar contra el costo promedio de existencias.
              </div>
            )}
            <div>{textoNoBloquea}</div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────── Patas de pago ─────────────────────────── */

export interface TablaPagoLegsProps {
  legs: LegUI[];
  cajas: Caja[];
  saldos: CajaSaldo[];
  /**
   * El monto contra el que tienen que cuadrar las patas. VIENE DE AFUERA a
   * propósito: la venta cobra el total, la permuta cobra la DIFERENCIA.
   */
  aCobrar: number;
  pagado: number;
  falta: number;
  legSinCaja: boolean;
  moneda: string;
  onSetLeg: (id: number, patch: Partial<LegUI>) => void;
  onAgregar: () => void;
  onQuitar: (id: number) => void;
  /** Cómo se nombra el objetivo: «de» en la venta, «de la diferencia» en la permuta. */
  etiquetaObjetivo: string;
  /** El cartel de que todo cuadra. */
  textoCuadran: string;
}

export function TablaPagoLegs({
  legs, cajas, saldos, aCobrar, pagado, falta, legSinCaja, moneda,
  onSetLeg, onAgregar, onQuitar, etiquetaObjetivo, textoCuadran,
}: TablaPagoLegsProps) {
  /** Saldo actual de la billetera de una pata (solo informativo: aquí entra dinero). */
  function saldoDeLeg(l: LegUI): CajaSaldo | undefined {
    return saldos.find((s) => s.caja_id === l.cajaId && s.cuenta === l.cuenta && s.moneda === l.moneda);
  }

  /** Monedas razonables para una pata: las que ya tiene esa caja + la de la caja. */
  function monedasDeCaja(cajaId: string): string[] {
    const propias = saldos.filter((s) => s.caja_id === cajaId).map((s) => s.moneda);
    const dela = cajas.find((c) => c.id === cajaId)?.moneda;
    return Array.from(new Set([...(dela ? [String(dela)] : []), ...propias, 'USD', 'Bs']));
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Caja</th>
              <th style={{ width: 150 }}>Cuenta</th>
              <th style={{ width: 130 }}>Moneda</th>
              <th style={{ width: 140, textAlign: 'right' }}>Monto</th>
              <th style={{ width: 44 }}></th>
            </tr>
          </thead>
          <tbody>
            {legs.map((l) => {
              const saldo = saldoDeLeg(l);
              return (
                <tr key={l.id}>
                  <td>
                    <SearchSelect value={l.cajaId} onChange={(v) => onSetLeg(l.id, { cajaId: v })}
                      disabled={!cajas.length}
                      placeholder={cajas.length ? '🔍 Buscar caja…' : '— sin cajas —'}
                      options={cajas.map((c) => ({ value: c.id, label: `${c.nombre} · ${c.moneda}` }))} />
                    {saldo && (
                      <small className="muted">Saldo hoy: <span className="mono">{montoMoneda(Number(saldo.saldo), saldo.moneda)}</span></small>
                    )}
                  </td>
                  <td>
                    <select className="select" value={l.cuenta}
                      onChange={(e) => onSetLeg(l.id, { cuenta: e.target.value as CuentaCaja })}>
                      {CUENTAS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="select" value={l.moneda} onChange={(e) => onSetLeg(l.id, { moneda: e.target.value })}>
                      {monedasDeCaja(l.cajaId).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="input mono" inputMode="decimal" style={{ textAlign: 'right' }}
                      value={l.monto} placeholder="0,00"
                      onChange={(e) => onSetLeg(l.id, { monto: dosDecimales(e.target.value) })} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm btn-ghost" title="Quitar forma de pago"
                      onClick={() => onQuitar(l.id)}>✕</button>
                  </td>
                </tr>
              );
            })}
            {!legs.length && (
              <tr><td colSpan={5} className="muted">Todavía no cargaste ninguna forma de pago.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onAgregar} disabled={!cajas.length}>
          ＋ Agregar forma de pago
        </button>
        <span>
          Cargado: <strong className="mono">{montoMoneda(pagado, moneda)}</strong> {etiquetaObjetivo}{' '}
          <strong className="mono">{montoMoneda(aCobrar, moneda)}</strong>
        </span>
        {/* Cuánto falta o cuánto sobra: la base exige que sumen exacto. */}
        {aCobrar <= 0
          ? <span className="badge info">no hay nada que cobrar</span>
          : Math.abs(falta) <= 0.01
            ? <span className="badge success">{textoCuadran}</span>
            : falta > 0
              ? <span className="badge warning">faltan {montoMoneda(falta, moneda)}</span>
              : <span className="badge danger">sobran {montoMoneda(Math.abs(falta), moneda)}</span>}
        {legSinCaja && <span className="badge danger">hay una forma de pago sin caja elegida</span>}
      </div>
    </>
  );
}

/* ─────────────────────────── Documento e impuestos ─────────────────────────── */

/**
 * Con qué documento sale la venta y qué impuestos lleva. Lo usan la venta y la
 * permuta, así el criterio vive en un solo lugar:
 *   · NOTA DE ENTREGA → sin impuestos. IVA e IGTF quedan en 0.
 *   · FACTURA → nº de factura y nº de control, y una CASILLA para el IVA y otra
 *     para el IGTF, cada una con su porcentaje (16 % y 3 % de entrada).
 * Las dos pasan igual por la autorización previa.
 */
export interface DocumentoImpuestosUI {
  documento: DocumentoVenta;
  numeroFactura: string;
  numeroControl: string;
  conIva: boolean;
  ivaPct: string;
  conIgtf: boolean;
  igtfPct: string;
}

export function documentoImpuestosInicial(venta?: Venta | null): DocumentoImpuestosUI {
  if (!venta) {
    return { documento: 'nota_entrega', numeroFactura: '', numeroControl: '', conIva: false, ivaPct: '16', conIgtf: false, igtfPct: '3' };
  }
  return {
    documento: venta.documento,
    numeroFactura: venta.numero_factura ?? '',
    numeroControl: venta.numero_control ?? '',
    conIva: venta.iva_pct > 0,
    ivaPct: venta.iva_pct > 0 ? String(venta.iva_pct) : '16',
    conIgtf: venta.igtf_pct > 0,
    igtfPct: venta.igtf_pct > 0 ? String(venta.igtf_pct) : '3',
  };
}

/** Los porcentajes que de verdad se aplican: en nota de entrega, o sin casilla, 0. */
export function porcentajesAplicados(d: DocumentoImpuestosUI): { ivaPct: number; igtfPct: number } {
  const factura = d.documento === 'factura';
  return {
    ivaPct: factura && d.conIva ? Math.max(0, Number(d.ivaPct) || 0) : 0,
    igtfPct: factura && d.conIgtf ? Math.max(0, Number(d.igtfPct) || 0) : 0,
  };
}

export function DocumentoImpuestos({
  valor, onChange,
}: { valor: DocumentoImpuestosUI; onChange: Dispatch<SetStateAction<DocumentoImpuestosUI>> }) {
  const set = (patch: Partial<DocumentoImpuestosUI>) => onChange((d) => ({ ...d, ...patch }));
  const factura = valor.documento === 'factura';
  return (
    <div className="card" style={{ margin: '.75rem 0' }}>
      <div className="card-title" style={{ marginBottom: '.5rem' }}>Documento</div>
      <div className="view-toggle" role="radiogroup" aria-label="Tipo de documento" style={{ marginBottom: '.6rem' }}>
        <button type="button" className={!factura ? 'active' : ''} aria-pressed={!factura}
          onClick={() => set({ documento: 'nota_entrega' })}>📋 Nota de entrega</button>
        <button type="button" className={factura ? 'active' : ''} aria-pressed={factura}
          onClick={() => set({ documento: 'factura', conIva: true })}>🧾 Factura</button>
      </div>

      {!factura ? (
        <small className="muted">La nota de entrega no lleva IVA ni IGTF. Si hacen falta impuestos, elige Factura.</small>
      ) : (
        <div className="form-grid">
          <div className="form-row">
            <label htmlFor="venta-nro-factura">Nº de factura</label>
            <input id="venta-nro-factura" className="input mono" value={valor.numeroFactura}
              onChange={(e) => set({ numeroFactura: e.target.value })} placeholder="00001234" />
          </div>
          <div className="form-row">
            <label htmlFor="venta-nro-control">Nº de control</label>
            <input id="venta-nro-control" className="input mono" value={valor.numeroControl}
              onChange={(e) => set({ numeroControl: e.target.value })} placeholder="00-00001234" />
          </div>
          <div className="form-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={valor.conIva} onChange={(e) => set({ conIva: e.target.checked })} />
              Aplicar IVA
            </label>
            <input className="input mono" inputMode="decimal" value={valor.ivaPct} disabled={!valor.conIva}
              onChange={(e) => set({ ivaPct: dosDecimales(e.target.value) })} placeholder="16" aria-label="Porcentaje de IVA" />
            <small className="muted">% sobre el subtotal menos el descuento.</small>
          </div>
          <div className="form-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={valor.conIgtf} onChange={(e) => set({ conIgtf: e.target.checked })} />
              Aplicar IGTF
            </label>
            <input className="input mono" inputMode="decimal" value={valor.igtfPct} disabled={!valor.conIgtf}
              onChange={(e) => set({ igtfPct: dosDecimales(e.target.value) })} placeholder="3" aria-label="Porcentaje de IGTF" />
            <small className="muted">% sobre la misma base (pago en divisas).</small>
          </div>
        </div>
      )}
    </div>
  );
}
