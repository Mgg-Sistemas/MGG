import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { notify } from '@/shared/lib/notify';
import { money } from '@/shared/lib/format';
import { PREFIJOS_RIF, partirRif } from '@/shared/lib/rif';
import type { ItemOrden, Orden, OrigenProveedor, Proveedor, OfertaDetalle, CostoLogistico, OfertaProveedor } from '@/shared/lib/types';
import { crearOferta, actualizarOferta, subirAdjuntosOferta, adjuntosDeOferta, CONDICIONES_PAGO, descuentoEfectivo, type EditarOfertaInput } from './ofertas.repository';
import { getStatsForProveedores, type ProveedorStats } from './evaluaciones.repository';
import { insert as crearProveedor } from '@/modules/proveedores/proveedores.repository';

/** Estrellas ★ según un promedio 1–5. */
function estrellas(avg: number): string {
  const full = Math.round(avg);
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}

interface Props {
  orden: Orden;
  proveedores: Proveedor[];
  proveedoresYaOfertados: Set<string>;
  registradoPorEmail: string;
  /** Si se pasa, el modal edita esa oferta (proveedor fijo) en vez de crear una nueva. */
  ofertaEdit?: OfertaProveedor | null;
  onClose: () => void;
  onCreated: () => void;
}

interface FormItem extends ItemOrden {
  precio: number;       // precio unitario a tasa BCV
  precio_usd: number;   // precio unitario en divisa efectivo (USD)
  _rid: string;         // id local estable (las variantes comparten SKU)
  _variante?: boolean;  // true = renglón agregado como marca/variante extra
}

let _ridSeq = 0;
const nextRid = () => `r${++_ridSeq}`;

export function AgregarOfertaModal({
  orden,
  proveedores,
  proveedoresYaOfertados,
  registradoPorEmail,
  ofertaEdit,
  onClose,
  onCreated,
}: Props) {
  const isEdit = !!ofertaEdit;
  const provEdit = ofertaEdit ? proveedores.find((p) => p.id === ofertaEdit.proveedor_id) : undefined;
  const opcionesProveedor = useMemo(
    () => proveedores.filter((p) => p.estado === 'activo' && !proveedoresYaOfertados.has(p.id)),
    [proveedores, proveedoresYaOfertados]
  );
  // En edición: activos + el proveedor actual (aunque esté inactivo), sin duplicar.
  const opcionesProveedorEdit = useMemo(() => {
    const out = proveedores.filter((p) => p.estado === 'activo');
    if (provEdit && !out.some((p) => p.id === provEdit.id)) out.unshift(provEdit);
    return out.sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es'));
  }, [proveedores, provEdit]);

  // Modo proveedor: si el checkbox está activo, se crea uno nuevo en línea.
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [proveedorId, setProveedorId] = useState<string>(ofertaEdit?.proveedor_id ?? opcionesProveedor[0]?.id ?? '');

  // Campos del proveedor nuevo (cuando nuevoProveedor=true)
  const [provRazon, setProvRazon] = useState('');
  const [provRif, setProvRif] = useState('');
  const [provTelefono, setProvTelefono] = useState('');
  const [provEmail, setProvEmail] = useState('');
  const [provDireccion, setProvDireccion] = useState('');
  const [provOrigen, setProvOrigen] = useState<OrigenProveedor>('nacional');
  const rifPartes = partirRif(provRif);

  // Calificación histórica de los proveedores (se guarda al finalizar cada pedido).
  const [stats, setStats] = useState<Map<string, ProveedorStats>>(new Map());
  useEffect(() => {
    const ids = opcionesProveedor.map((p) => p.id);
    if (!ids.length) return;
    getStatsForProveedores(ids).then(setStats).catch(() => setStats(new Map()));
  }, [opcionesProveedor]);
  const statSel = !nuevoProveedor ? stats.get(proveedorId) : undefined;

  // Solo se cotizan los ítems marcados "comprar" en la OP (los desmarcados no se compran).
  // En edición, se traen los ítems con el precio que ya tenía la oferta.
  const [items, setItems] = useState<FormItem[]>(
    ofertaEdit
      ? ofertaEdit.items.map((i) => ({ ...i, precio: Number(i.precio) || 0, precio_usd: Number(i.precio_usd) || 0, _rid: nextRid() }))
      : orden.items.filter((i) => i.comprar !== false).map((i) => ({ ...i, precio: 0, precio_usd: 0, _rid: nextRid() })),
  );
  const [fechaEntrega, setFechaEntrega] = useState<string>(ofertaEdit?.fecha_entrega_prometida ?? '');
  const [condiciones, setCondiciones] = useState(ofertaEdit?.condiciones_pago ?? '');
  const [notas, setNotas] = useState(ofertaEdit?.notas ?? '');
  // Datos técnicos/logísticos de la oferta (todos opcionales).
  const [detalle, setDetalle] = useState<OfertaDetalle>(ofertaEdit?.detalle ?? {});
  const setD = (patch: Partial<OfertaDetalle>) => setDetalle((d) => ({ ...d, ...patch }));
  const setLog = (k: 'flete' | 'transporte' | 'embalaje' | 'seguros', v: CostoLogistico) =>
    setDetalle((d) => ({ ...d, logistica: { ...(d.logistica ?? {}), [k]: v } }));
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const nuevos = Array.from(e.target.files ?? []);
    if (!nuevos.length) return;
    const validos: File[] = [];
    for (const f of nuevos) {
      if (f.type !== 'application/pdf' && !f.type.startsWith('image/')) {
        toast(`"${f.name}": debe ser PDF o imagen`, 'error'); continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast(`"${f.name}": no puede superar 10 MB`, 'error'); continue;
      }
      validos.push(f);
    }
    // Se acumulan (podés ir agregando fotos en varias selecciones), sin duplicar por nombre+tamaño.
    setPdfFiles((prev) => {
      const key = (f: File) => `${f.name}-${f.size}`;
      const ya = new Set(prev.map(key));
      return [...prev, ...validos.filter((f) => !ya.has(key(f)))];
    });
    e.target.value = '';
  }
  function quitarArchivo(idx: number) {
    setPdfFiles((prev) => prev.filter((_, k) => k !== idx));
  }

  const bcvSubtotal = items.reduce((a, i) => a + i.cantidad * i.precio, 0);
  const usdTotal = items.reduce((a, i) => a + i.cantidad * (i.precio_usd || 0), 0);
  const precioTotal = Math.round(bcvSubtotal * 100) / 100;
  const precioEfectivo = usdTotal > 0 ? Math.round(usdTotal * 100) / 100 : 0;
  // Diferencia y % de ahorro al pagar en divisa efectivo (BCV − efectivo) / BCV.
  const ahorroEfectivo = descuentoEfectivo(precioTotal, precioEfectivo);

  function updateItemPrecio(idx: number, precio: number) {
    setItems((prev) => prev.map((it, k) => (k === idx ? { ...it, precio: Math.max(0, precio) } : it)));
  }
  function updateItemPrecioUsd(idx: number, precioUsd: number) {
    setItems((prev) => prev.map((it, k) => (k === idx ? { ...it, precio_usd: Math.max(0, precioUsd) } : it)));
  }
  function updateItemCampo(idx: number, patch: Partial<FormItem>) {
    setItems((prev) => prev.map((it, k) => (k === idx ? { ...it, ...patch } : it)));
  }
  // Agrega otra marca/variante del MISMO producto justo debajo (mismo SKU, su propio precio).
  function agregarVariante(idx: number) {
    setItems((prev) => {
      const base = prev[idx];
      const nueva: FormItem = {
        ...base, _rid: nextRid(), _variante: true,
        marca: '', modelo: '', precio: 0, precio_usd: 0,
      };
      const out = [...prev];
      out.splice(idx + 1, 0, nueva);
      return out;
    });
  }
  function quitarItem(idx: number) {
    setItems((prev) => prev.filter((_, k) => k !== idx));
  }

  async function handleSubmit() {
    if (precioTotal <= 0) {
      toast('El precio total debe ser mayor a cero', 'error');
      return;
    }
    if (!condiciones.trim()) {
      toast('Elegí la condición de pago (define el flujo: contado, crédito, contra entrega…)', 'error');
      return;
    }
    if (precioEfectivo > 0 && precioEfectivo >= precioTotal) {
      toast('El precio en divisa efectivo debe ser menor al total BCV (es un descuento por pago en efectivo).', 'error');
      return;
    }
    setSubmitting(true);
    // Se quitan los campos locales (_rid/_variante) y se normaliza marca/modelo.
    const itemsLimpios: ItemOrden[] = items.map(({ _rid, _variante, ...rest }) => {
      void _rid; void _variante;
      return {
        ...rest,
        marca: (rest.marca ?? '').toString().trim() || null,
        modelo: (rest.modelo ?? '').toString().trim() || null,
      };
    });
    try {
      // ── Modo edición: proveedor fijo, se actualiza la oferta existente ──
      if (isEdit && ofertaEdit) {
        // Los nuevos archivos se SUMAN a los adjuntos que ya tenía la oferta.
        const adjuntosPatch: EditarOfertaInput = {};
        if (pdfFiles.length) {
          const subidos = await subirAdjuntosOferta(orden.id, ofertaEdit.proveedor_id, pdfFiles);
          const todos = [...adjuntosDeOferta(ofertaEdit), ...subidos];
          adjuntosPatch.adjuntos = todos;
          adjuntosPatch.pdf_path = todos[0]?.path ?? null;
          adjuntosPatch.pdf_filename = todos[0]?.filename ?? null;
        }
        await actualizarOferta(ofertaEdit.id, {
          proveedor_id: proveedorId || ofertaEdit.proveedor_id,
          items: itemsLimpios,
          precio_total: precioTotal,
          precio_efectivo: precioEfectivo > 0 ? precioEfectivo : null,
          descuento: null,
          fecha_entrega_prometida: fechaEntrega || null,
          condiciones_pago: condiciones.trim() || null,
          notas: notas.trim() || null,
          detalle,
          ...adjuntosPatch,
        });
        notify(`Oferta actualizada para ${orden.codigo}`, 'success', { link: '#/app/pedidos' });
        onCreated();
        return;
      }

      // 1) Resolver proveedor (existente o crear uno nuevo)
      let provId = proveedorId;
      if (nuevoProveedor) {
        if (!provRazon.trim() || !rifPartes.numero) {
          toast('Razón social y RIF (con número) son obligatorios para el nuevo proveedor', 'error');
          setSubmitting(false);
          return;
        }
        const emailClean = provEmail.trim();
        if (emailClean && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
          toast('El correo del proveedor no tiene un formato válido', 'error');
          setSubmitting(false);
          return;
        }
        const creado = await crearProveedor({
          razon_social: provRazon.trim().toUpperCase(),
          rif: `${rifPartes.letra}-${rifPartes.numero}`,
          contacto: null,
          telefono: provTelefono.trim() || null,
          email: emailClean || null,
          direccion: provDireccion.trim().toUpperCase() || null,
          categorias: [],
          origen: provOrigen,
          estado: 'activo',
        });
        provId = creado.id;
        notify(`Proveedor "${creado.razon_social}" registrado`, 'success', { link: '#/app/proveedores' });
      } else if (!provId) {
        toast('Selecciona un proveedor', 'error');
        setSubmitting(false);
        return;
      }

      // 2) Subir los adjuntos (fotos/PDF) si los hay
      const adjuntos = pdfFiles.length ? await subirAdjuntosOferta(orden.id, provId, pdfFiles) : [];

      // 3) Crear oferta
      await crearOferta({
        orden_id: orden.id,
        proveedor_id: provId,
        items: itemsLimpios,
        precio_total: precioTotal,
        precio_efectivo: precioEfectivo > 0 ? precioEfectivo : null,
        fecha_entrega_prometida: fechaEntrega || null,
        condiciones_pago: condiciones.trim() || null,
        notas: notas.trim() || null,
        detalle,
        registrada_por_email: registradoPorEmail,
        pdf_path: adjuntos[0]?.path ?? null,
        pdf_filename: adjuntos[0]?.filename ?? null,
        adjuntos: adjuntos.length ? adjuntos : null,
      });
      notify(`Oferta registrada para ${orden.codigo}`, 'success', { link: '#/app/pedidos' });
      onCreated();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al registrar', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`${isEdit ? 'Editar' : 'Agregar'} oferta · ${orden.codigo}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Registrar oferta'}
          </button>
        </>
      }
    >
      {isEdit ? (
        <div className="form-row">
          <label>Proveedor</label>
          <SearchSelect
            value={proveedorId}
            onChange={setProveedorId}
            options={opcionesProveedorEdit.map((p) => ({ value: p.id, label: `${p.razon_social}${p.rif ? ` (${p.rif})` : ''}` }))}
            placeholder="Buscar proveedor por nombre o RIF…"
            emptyText="Ningún proveedor coincide"
          />
          <small className="muted">Podés corregir el proveedor de la oferta. El resto de datos se edita abajo.</small>
        </div>
      ) : (
      <div className="form-row">
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={nuevoProveedor}
            onChange={(e) => setNuevoProveedor(e.target.checked)}
          />
          <span>Proveedor no registrado (lo creo ahora junto con la oferta)</span>
        </label>
      </div>
      )}

      {isEdit ? null : nuevoProveedor ? (
        <div className="card" style={{ background: 'var(--bg-2)', padding: '1rem', marginBottom: '.75rem' }}>
          <div className="card-title" style={{ marginBottom: '.5rem' }}>
            <span>Datos del nuevo proveedor</span>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Razón social *</label>
              <input className="input" value={provRazon} onChange={(e) => setProvRazon(e.target.value.toUpperCase())} />
            </div>
            <div className="form-row">
              <label>RIF *</label>
              <div style={{ display: 'flex', gap: '.4rem' }}>
                <select
                  className="select"
                  value={rifPartes.letra}
                  onChange={(e) => setProvRif(`${e.target.value}-${rifPartes.numero}`)}
                  style={{ width: 'auto', flex: '0 0 auto' }}
                  aria-label="Tipo de RIF"
                >
                  {PREFIJOS_RIF.map((p) => (
                    <option key={p.letra} value={p.letra}>{p.letra} · {p.desc}</option>
                  ))}
                </select>
                <input
                  className="input mono"
                  value={rifPartes.numero}
                  onChange={(e) => setProvRif(`${rifPartes.letra}-${e.target.value.replace(/\D/g, '').slice(0, 10)}`)}
                  placeholder="40778442"
                  inputMode="numeric"
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Teléfono</label>
              <input
                className="input"
                inputMode="numeric"
                value={provTelefono}
                onChange={(e) => setProvTelefono(e.target.value.replace(/\D/g, '').slice(0, 15))}
                maxLength={15}
                placeholder="Solo dígitos"
              />
            </div>
            <div className="form-row">
              <label>Email</label>
              <input
                className="input"
                type="email"
                value={provEmail}
                onChange={(e) => setProvEmail(e.target.value)}
                placeholder="correo@dominio.com"
              />
            </div>
          </div>
          <div className="form-row">
            <label>Dirección</label>
            <input className="input" value={provDireccion} onChange={(e) => setProvDireccion(e.target.value.toUpperCase())} />
          </div>
          <div className="form-row">
            <label>Origen</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
              {([
                { val: 'nacional', txt: '🇻🇪 Nacional' },
                { val: 'internacional', txt: '🌎 Internacional' },
              ] as const).map((o) => {
                const checked = provOrigen === o.val;
                return (
                  <label
                    key={o.val}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '.3rem',
                      padding: '.35rem .65rem',
                      background: checked ? 'var(--brand-soft, rgba(255,138,0,.12))' : 'var(--bg-1)',
                      border: `1px solid ${checked ? 'var(--brand, #ff8a00)' : 'var(--border)'}`,
                      borderRadius: 6, cursor: 'pointer',
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => setProvOrigen(o.val)} />
                    <span style={{ fontSize: '.82rem' }}>{o.txt}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="form-row">
          <label>Proveedor</label>
          {opcionesProveedor.length ? (
            <>
              <SearchSelect
                value={proveedorId}
                onChange={setProveedorId}
                options={opcionesProveedor.map((p) => ({ value: p.id, label: `${p.razon_social} (${p.rif})` }))}
                placeholder="Buscar proveedor por nombre o RIF…"
                emptyText="Ningún proveedor coincide"
              />
              {statSel && (
                <div className="card" style={{ marginTop: '.4rem', padding: '.45rem .6rem', background: 'var(--bg-1)', fontSize: '.82rem' }}>
                  {statSel.total_evaluaciones > 0 ? (
                    <span>
                      <strong style={{ color: 'var(--warning)' }}>{estrellas(statSel.calidad_avg)}</strong>{' '}
                      <strong>{statSel.calidad_avg.toFixed(1)}/5</strong> calidad ·{' '}
                      {Math.round(statSel.puntualidad_pct * 100)}% puntual ·{' '}
                      <span className="muted">{statSel.total_evaluaciones} evaluación{statSel.total_evaluaciones !== 1 ? 'es' : ''} previa{statSel.total_evaluaciones !== 1 ? 's' : ''}</span>
                    </span>
                  ) : (
                    <span className="muted">Proveedor sin evaluaciones previas (calificación neutra hasta su primer pedido recibido).</span>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
              No quedan proveedores activos sin oferta. Marca <strong>"Proveedor no registrado"</strong> arriba para crear uno nuevo.
            </p>
          )}
        </div>
      )}

      <div className="form-row">
        <label>Cotización por ítem <span className="muted" style={{ fontWeight: 400 }}>(precio en Bs a BCV y, si aplica, en USD efectivo)</span></label>
        <p className="muted" style={{ fontSize: '.76rem', marginTop: 0, marginBottom: '.4rem' }}>
          💡 Si el proveedor ofrece el mismo producto en <strong>varias marcas/modelos</strong>, usá <strong>＋ marca</strong> para agregar otra variante con su propio precio.
        </p>
        <div className="table-wrap">
          <table className="items-table">
            <thead>
              <tr>
                <th rowSpan={2}>SKU</th>
                <th rowSpan={2}>Producto</th>
                <th rowSpan={2}>Marca / modelo</th>
                <th className="num" rowSpan={2}>Cant.</th>
                <th className="num" colSpan={2} style={{ textAlign: 'center', background: 'rgba(80,140,255,.10)' }}>Pago en Bs a BCV</th>
                <th className="num" colSpan={2} style={{ textAlign: 'center', background: 'rgba(255,120,120,.10)' }}>Pago en USD</th>
                <th className="num" rowSpan={2}>Diferencia</th>
                <th className="num" rowSpan={2}>Var. %</th>
                <th rowSpan={2}></th>
              </tr>
              <tr>
                <th className="num" style={{ background: 'rgba(80,140,255,.06)' }}>Precio</th>
                <th className="num" style={{ background: 'rgba(80,140,255,.06)' }}>Total</th>
                <th className="num" style={{ background: 'rgba(255,120,120,.06)' }}>Precio</th>
                <th className="num" style={{ background: 'rgba(255,120,120,.06)' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const totBcv = it.cantidad * it.precio;
                const totUsd = it.cantidad * (it.precio_usd || 0);
                const dif = totBcv - totUsd;
                const pct = it.precio > 0 ? ((it.precio - (it.precio_usd || 0)) / it.precio) * 100 : 0;
                return (
                  <tr key={it._rid}>
                    <td className="mono">{it._variante ? <span className="muted" title="Variante del mismo producto">↳</span> : it.sku}</td>
                    <td>{it._variante ? <span className="muted">{it.nombre}</span> : it.nombre}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                        <input className="input" style={{ minWidth: 110 }} placeholder="Marca"
                          value={it.marca ?? ''} onChange={(e) => updateItemCampo(idx, { marca: e.target.value })} />
                        <input className="input" style={{ minWidth: 110, fontSize: '.78rem' }} placeholder="Modelo (opcional)"
                          value={it.modelo ?? ''} onChange={(e) => updateItemCampo(idx, { modelo: e.target.value })} />
                      </div>
                    </td>
                    <td className="num">
                      <input type="number" className="input mono" style={{ width: 64, textAlign: 'right' }} min={0} step="any"
                        value={it.cantidad} onChange={(e) => updateItemCampo(idx, { cantidad: Math.max(0, Number(e.target.value) || 0) })} />
                    </td>
                    <td className="num">
                      <input type="number" className="input mono" style={{ width: 95, textAlign: 'right' }} min={0} step={0.01}
                        value={it.precio} onChange={(e) => updateItemPrecio(idx, Number(e.target.value) || 0)} />
                    </td>
                    <td className="num mono">{money(totBcv)}</td>
                    <td className="num">
                      <input type="number" className="input mono" style={{ width: 95, textAlign: 'right' }} min={0} step={0.01}
                        value={it.precio_usd || ''} placeholder="—" onChange={(e) => updateItemPrecioUsd(idx, Number(e.target.value) || 0)} />
                    </td>
                    <td className="num mono">{totUsd > 0 ? money(totUsd) : '—'}</td>
                    <td className="num mono" style={{ color: dif > 0 ? 'var(--success)' : undefined }}>{totUsd > 0 ? money(dif) : '—'}</td>
                    <td className="num mono">{it.precio_usd ? `${pct.toFixed(2)}%` : '—'}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .35rem' }}
                        onClick={() => agregarVariante(idx)} title="Agregar otra marca/modelo de este producto">＋ marca</button>
                      {it._variante && (
                        <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .35rem', color: 'var(--danger)' }}
                          onClick={() => quitarItem(idx)} title="Quitar esta variante">✕</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="num" style={{ fontWeight: 700 }}>SUBTOTAL</td>
                <td className="num mono" style={{ fontWeight: 700 }}>{money(bcvSubtotal)}</td>
                <td></td>
                <td className="num mono" style={{ fontWeight: 700 }}>{usdTotal > 0 ? money(usdTotal) : '—'}</td>
                <td className="num mono" style={{ fontWeight: 700 }}>{usdTotal > 0 ? money(bcvSubtotal - usdTotal) : '—'}</td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Totales BCV/USD/diferencia */}
      <div className="card" style={{ background: 'var(--bg-2)', padding: '.8rem', marginBottom: '.75rem' }}>
        <div className="card-title" style={{ marginBottom: '.5rem' }}><span>💵 Totales</span></div>
        <div className="mono" style={{ fontSize: '.9rem', lineHeight: 1.7 }}>
          <div>Total BCV: <strong>{money(precioTotal)}</strong></div>
          <div>Total USD: <strong style={{ color: 'var(--success)' }}>{precioEfectivo > 0 ? money(precioEfectivo) : '—'}</strong></div>
          {ahorroEfectivo && (
            <div>Diferencia: <strong>{money(ahorroEfectivo.diferencia)}</strong> <span className="badge success" style={{ marginLeft: '.3rem' }}>−{ahorroEfectivo.pct.toFixed(2)}%</span></div>
          )}
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>Fecha de entrega prometida</label>
          <input type="date" className="input" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Condiciones del Pago *</label>
          <select className="select" value={condiciones} onChange={(e) => setCondiciones(e.target.value)} required>
            <option value="">— elegir —</option>
            {CONDICIONES_PAGO.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row">
        <label>Notas</label>
        <textarea className="textarea" placeholder="Comentarios sobre la oferta, exclusiones, garantías…" value={notas} onChange={(e) => setNotas(e.target.value)} />
      </div>

      {/* Datos técnicos del producto ofertado (opcionales) */}
      <div className="card" style={{ background: 'var(--bg-2)', padding: '.8rem', marginBottom: '.75rem' }}>
        <div className="card-title" style={{ marginBottom: '.5rem' }}><span>📋 Datos técnicos del producto <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></span></div>
        <div className="form-grid">
          <div className="form-row"><label>Marca</label><input className="input" value={detalle.marca ?? ''} onChange={(e) => setD({ marca: e.target.value })} /></div>
          <div className="form-row"><label>Modelo</label><input className="input" value={detalle.modelo ?? ''} onChange={(e) => setD({ modelo: e.target.value })} /></div>
          <div className="form-row"><label>Procedencia</label><input className="input" value={detalle.procedencia ?? ''} onChange={(e) => setD({ procedencia: e.target.value })} placeholder="País / origen" /></div>
          <div className="form-row"><label>Materiales</label><input className="input" value={detalle.materiales ?? ''} onChange={(e) => setD({ materiales: e.target.value })} /></div>
          <div className="form-row"><label>Dimensiones</label><input className="input" value={detalle.dimensiones ?? ''} onChange={(e) => setD({ dimensiones: e.target.value })} placeholder="Ej.: 120 × 80 × 40 cm" /></div>
          <div className="form-row"><label>Peso</label><input className="input" value={detalle.peso ?? ''} onChange={(e) => setD({ peso: e.target.value })} placeholder="Ej.: 25 kg" /></div>
          <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Nivel de calidad</label><input className="input" value={detalle.calidad ?? ''} onChange={(e) => setD({ calidad: e.target.value })} placeholder="Ej.: Industrial / Premium / Estándar" /></div>
        </div>
      </div>

      {/* Costos logísticos: ¿incluidos o por cuenta del comprador? */}
      <div className="card" style={{ background: 'var(--bg-2)', padding: '.8rem', marginBottom: '.75rem' }}>
        <div className="card-title" style={{ marginBottom: '.5rem' }}><span>🚚 Costos logísticos <span className="muted" style={{ fontWeight: 400 }}>(¿incluidos en el precio o por cuenta del comprador?)</span></span></div>
        <div className="form-grid">
          {([
            { k: 'flete', label: 'Flete' },
            { k: 'transporte', label: 'Transporte' },
            { k: 'embalaje', label: 'Embalaje' },
            { k: 'seguros', label: 'Seguros' },
          ] as const).map((c) => (
            <div className="form-row" key={c.k}>
              <label>{c.label}</label>
              <select className="select" value={detalle.logistica?.[c.k] ?? ''} onChange={(e) => setLog(c.k, (e.target.value || null) as CostoLogistico)}>
                <option value="">— sin especificar —</option>
                <option value="incluido">Incluido en el precio</option>
                <option value="por_cuenta">Por cuenta del comprador</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="form-row">
        <label>Cargue la cotización del proveedor <span className="muted" style={{ fontWeight: 400 }}>(varias fotos/PDF · opcional)</span></label>
        <input type="file" className="input" accept="application/pdf,image/*" multiple onChange={handleFileChange} />
        {pdfFiles.length > 0 && (
          <div style={{ marginTop: '.35rem', display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
            {pdfFiles.map((f, i) => (
              <div key={`${f.name}-${i}`} className="muted" style={{ fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                ✓ {f.name} ({(f.size / 1024).toFixed(0)} KB)
                <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .35rem', color: 'var(--danger)' }}
                  onClick={() => quitarArchivo(i)} title="Quitar este archivo">✕</button>
              </div>
            ))}
          </div>
        )}
        {isEdit && adjuntosDeOferta(ofertaEdit ?? {}).length > 0 && (
          <div className="muted" style={{ fontSize: '.78rem', marginTop: '.25rem' }}>
            📎 {adjuntosDeOferta(ofertaEdit ?? {}).length} adjunto(s) actual(es). Los nuevos que cargues se <strong>suman</strong> a los existentes.
          </div>
        )}
        <div className="muted" style={{ fontSize: '.72rem', marginTop: '.25rem' }}>
          PDF o imágenes · máximo 10 MB c/u. Podés seleccionar o ir agregando varias fotos de la cotización.
        </div>
      </div>
    </Modal>
  );
}
