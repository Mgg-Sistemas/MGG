import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { ConversorBcv } from '@/shared/ui/ConversorBcv';
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
  /** Si se pasa, la oferta nueva solo cotiza estos SKU (los productos que quedaron pendientes
   *  por asignar en una compra multiproveedor). Sin filtro, se cotizan todos los de la OP. */
  soloSkus?: Set<string> | null;
  onClose: () => void;
  onCreated: () => void;
}

interface FormItem extends ItemOrden {
  precio: number;       // precio unitario a tasa BCV
  precio_usd: number;   // precio unitario en divisa efectivo (USD)
  precioStr: string;    // texto crudo del precio BCV (permite escribir "." o "," decimal)
  precioUsdStr: string; // texto crudo del precio USD
  _rid: string;         // id local estable (las variantes comparten SKU)
  _variante?: boolean;  // true = renglón agregado como marca/variante extra
}

let _ridSeq = 0;
const nextRid = () => `r${++_ridSeq}`;

// Redondea a 2 decimales (los precios de compra siempre van a 2 decimales).
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
// Muestra vacío cuando el número es 0 (así no aparece el "0" que estorba al escribir).
// Los precios se muestran redondeados a 2 decimales (sin colas largas tipo 6.7138554…).
const numToStr = (n: number) => (n > 0 ? String(round2(n)) : '');
// Deja solo dígitos y UN separador decimal (acepta punto o coma), conservando el que se escribe.
function sanitizeDecimal(s: string): string {
  let out = s.replace(/[^\d.,]/g, '');
  const sep = out.search(/[.,]/);
  if (sep !== -1) out = out.slice(0, sep + 1) + out.slice(sep + 1).replace(/[.,]/g, '');
  return out;
}
// Convierte el texto (con "." o ",") a número ≥ 0.
function parseDecimal(s: string): number {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function AgregarOfertaModal({
  orden,
  proveedores,
  proveedoresYaOfertados,
  registradoPorEmail,
  ofertaEdit,
  soloSkus,
  onClose,
  onCreated,
}: Props) {
  const isEdit = !!ofertaEdit;
  const esServicio = orden.clase === 'servicio';
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
      ? ofertaEdit.items.map((i) => {
          const precio = round2(Number(i.precio) || 0);
          const precioUsd = round2(Number(i.precio_usd) || 0);
          return { ...i, precio, precio_usd: precioUsd, precioStr: numToStr(precio), precioUsdStr: numToStr(precioUsd), _rid: nextRid() };
        })
      : orden.items
          .filter((i) => i.comprar !== false && (!soloSkus || soloSkus.has(i.sku)))
          .map((i) => ({ ...i, precio: 0, precio_usd: 0, precioStr: '', precioUsdStr: '', _rid: nextRid() })),
  );
  const [fechaEntrega, setFechaEntrega] = useState<string>(ofertaEdit?.fecha_entrega_prometida ?? '');
  const [condiciones, setCondiciones] = useState(ofertaEdit?.condiciones_pago ?? '');
  const [notas, setNotas] = useState(ofertaEdit?.notas ?? '');
  // Descuento OBTENIDO (negociado): reduce el monto de la factura (total a pagar).
  const [descuentoStr, setDescuentoStr] = useState(ofertaEdit?.descuento != null ? String(ofertaEdit.descuento) : '');
  // Impuestos de la oferta (opcionales). IVA e IGTF se cargan por % o por monto (sincronizados)
  // sobre la FACTURA NETA (subtotal − descuento) y se SUMAN al total a pagar.
  const [incluyeIva, setIncluyeIva] = useState<boolean>((Number(ofertaEdit?.iva) || 0) > 0);
  const [ivaMontoStr, setIvaMontoStr] = useState<string>((Number(ofertaEdit?.iva) || 0) > 0 ? String(ofertaEdit!.iva) : '');
  const [ivaPctStr, setIvaPctStr] = useState<string>('');
  const [incluyeIgtf, setIncluyeIgtf] = useState<boolean>((Number(ofertaEdit?.igtf) || 0) > 0);
  const [igtfMontoStr, setIgtfMontoStr] = useState<string>((Number(ofertaEdit?.igtf) || 0) > 0 ? String(ofertaEdit!.igtf) : '');
  const [igtfPctStr, setIgtfPctStr] = useState<string>('');
  // Datos técnicos/logísticos de la oferta (todos opcionales).
  const [detalle, setDetalle] = useState<OfertaDetalle>(ofertaEdit?.detalle ?? {});
  const setD = (patch: Partial<OfertaDetalle>) => setDetalle((d) => ({ ...d, ...patch }));
  const setLog = (k: 'flete' | 'transporte' | 'embalaje' | 'seguros', v: CostoLogistico) =>
    setDetalle((d) => ({ ...d, logistica: { ...(d.logistica ?? {}), [k]: v } }));
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  // Adjuntos que YA tenía la oferta (en edición): se pueden quitar uno por uno.
  const [adjuntosExist, setAdjuntosExist] = useState(() => (isEdit && ofertaEdit ? adjuntosDeOferta(ofertaEdit) : []));
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
  // El MONTO FINAL de la oferta es el total BCV; si la oferta se cotizó SOLO en USD
  // (sin BCV), el total USD es el monto final. `precio_efectivo` solo tiene sentido
  // como DESCUENTO por pago en divisa cuando además existe un precio BCV.
  const precioTotal = Math.round((bcvSubtotal > 0 ? bcvSubtotal : usdTotal) * 100) / 100;
  const precioEfectivo = bcvSubtotal > 0 && usdTotal > 0 ? Math.round(usdTotal * 100) / 100 : 0;
  // Diferencia y % de ahorro al pagar en divisa efectivo (BCV − efectivo) / BCV.
  const ahorroEfectivo = descuentoEfectivo(precioTotal, precioEfectivo);
  // Descuento obtenido y monto de la factura resultante (sobre el efectivo si hay, si no el BCV).
  const descuentoObt = Math.max(0, Math.round((Number(descuentoStr) || 0) * 100) / 100);
  const baseFactura = precioEfectivo > 0 ? precioEfectivo : precioTotal;
  const facturaNeta = Math.round(Math.max(0, baseFactura - descuentoObt) * 100) / 100;

  // Impuestos: se calculan sobre la factura neta. % ↔ monto sincronizados.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const IVA_PCT_SUGERIDO = 16, IGTF_PCT_SUGERIDO = 3;
  const ivaMonto = incluyeIva ? Math.max(0, r2(Number(ivaMontoStr) || 0)) : 0;
  const igtfMonto = incluyeIgtf ? Math.max(0, r2(Number(igtfMontoStr) || 0)) : 0;
  const totalConImpuestos = r2(facturaNeta + ivaMonto + igtfMonto);
  const setImpPct = (v: string, setPct: (s: string) => void, setMonto: (s: string) => void) => {
    setPct(v);
    const p = Math.max(0, Number(v) || 0);
    setMonto(p > 0 && facturaNeta > 0 ? String(r2(facturaNeta * p / 100)) : '');
  };
  const setImpMonto = (v: string, setPct: (s: string) => void, setMonto: (s: string) => void) => {
    setMonto(v);
    const m = Math.max(0, Number(v) || 0);
    setPct(m > 0 && facturaNeta > 0 ? String(r2(m / facturaNeta * 100)) : '');
  };
  function toggleIva(on: boolean) {
    setIncluyeIva(on);
    if (on && !(Number(ivaMontoStr) > 0)) setImpPct(String(IVA_PCT_SUGERIDO), setIvaPctStr, setIvaMontoStr);
    if (!on) { setIvaMontoStr(''); setIvaPctStr(''); }
  }
  function toggleIgtf(on: boolean) {
    setIncluyeIgtf(on);
    if (on && !(Number(igtfMontoStr) > 0)) setImpPct(String(IGTF_PCT_SUGERIDO), setIgtfPctStr, setIgtfMontoStr);
    if (!on) { setIgtfMontoStr(''); setIgtfPctStr(''); }
  }
  // Backfill del % al abrir en edición (monto conocido, % vacío).
  useEffect(() => {
    if (Number(ivaMontoStr) > 0 && !ivaPctStr && facturaNeta > 0) setIvaPctStr(String(r2(Number(ivaMontoStr) / facturaNeta * 100)));
    if (Number(igtfMontoStr) > 0 && !igtfPctStr && facturaNeta > 0) setIgtfPctStr(String(r2(Number(igtfMontoStr) / facturaNeta * 100)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturaNeta]);

  function updateItemPrecio(idx: number, raw: string) {
    const str = sanitizeDecimal(raw);
    setItems((prev) => prev.map((it, k) => (k === idx ? { ...it, precioStr: str, precio: parseDecimal(str) } : it)));
  }
  function updateItemPrecioUsd(idx: number, raw: string) {
    const str = sanitizeDecimal(raw);
    setItems((prev) => prev.map((it, k) => (k === idx ? { ...it, precioUsdStr: str, precio_usd: parseDecimal(str) } : it)));
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
        marca: '', modelo: '', precio: 0, precio_usd: 0, precioStr: '', precioUsdStr: '',
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
    if (precioTotal <= 0 && precioEfectivo <= 0) {
      toast('Ingresá el precio en Bs (BCV) y/o en USD efectivo: al menos uno.', 'error');
      return;
    }
    if (!condiciones.trim()) {
      toast('Elegí la condición de pago (define el flujo: contado, crédito, contra entrega…)', 'error');
      return;
    }
    // El descuento por pago en efectivo solo aplica cuando la oferta trae AMBOS precios.
    if (precioTotal > 0 && precioEfectivo > 0 && precioEfectivo >= precioTotal) {
      toast('El precio en divisa efectivo debe ser menor al total BCV (es un descuento por pago en efectivo).', 'error');
      return;
    }
    setSubmitting(true);
    // Se quitan los campos locales (_rid/_variante) y se normaliza marca/modelo.
    const itemsLimpios: ItemOrden[] = items.map(({ _rid, _variante, precioStr, precioUsdStr, ...rest }) => {
      void _rid; void _variante; void precioStr; void precioUsdStr;
      return {
        ...rest,
        // Precios de compra siempre a 2 decimales (evita colas largas al guardar).
        precio: round2(Number(rest.precio) || 0),
        precio_usd: round2(Number(rest.precio_usd) || 0),
        marca: (rest.marca ?? '').toString().trim() || null,
        modelo: (rest.modelo ?? '').toString().trim() || null,
      };
    });
    try {
      // ── Modo edición: proveedor fijo, se actualiza la oferta existente ──
      if (isEdit && ofertaEdit) {
        // Adjuntos finales = los existentes que se conservaron (se pueden quitar) + los
        // nuevos que se cargaron. Siempre se persiste, así las remociones quedan guardadas.
        const subidos = pdfFiles.length ? await subirAdjuntosOferta(orden.id, ofertaEdit.proveedor_id, pdfFiles) : [];
        const todos = [...adjuntosExist, ...subidos];
        const adjuntosPatch: EditarOfertaInput = {
          adjuntos: todos.length ? todos : null,
          pdf_path: todos[0]?.path ?? null,
          pdf_filename: todos[0]?.filename ?? null,
        };
        await actualizarOferta(ofertaEdit.id, {
          proveedor_id: proveedorId || ofertaEdit.proveedor_id,
          items: itemsLimpios,
          precio_total: precioTotal,
          precio_efectivo: precioEfectivo > 0 ? precioEfectivo : null,
          descuento: descuentoObt > 0 ? descuentoObt : null,
          iva: ivaMonto > 0 ? ivaMonto : null,
          igtf: igtfMonto > 0 ? igtfMonto : null,
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
        descuento: descuentoObt > 0 ? descuentoObt : null,
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
            <p className="hint muted" style={{ margin: 0, fontSize: '.85rem' }}>
              No quedan proveedores activos sin oferta. Marca <strong>"Proveedor no registrado"</strong> arriba para crear uno nuevo.
            </p>
          )}
        </div>
      )}

      {/* Conversor Bs ⇄ $ (tasa BCV) como ayuda para pasar precios de la cotización. */}
      <div className="form-row">
        <label>Conversor Bs ⇄ $ <span className="muted" style={{ fontWeight: 400 }}>(ayuda: pasá un precio de la cotización de bolívares a dólares o al revés)</span></label>
        <ConversorBcv />
      </div>

      <div className="form-row">
        <label>Cotización por ítem <span className="muted" style={{ fontWeight: 400 }}>(precio en Bs a BCV y/o en USD efectivo — completá al menos una columna)</span></label>
        <p className="hint muted" style={{ fontSize: '.76rem', marginTop: 0, marginBottom: '.4rem' }}>
          💡 Si el proveedor ofrece el mismo producto en <strong>varias marcas/modelos</strong>, usá <strong>＋ marca</strong> para agregar otra variante con su propio precio.
        </p>
        <div className="table-wrap">
          <table className="items-table">
            <thead>
              <tr>
                <th rowSpan={2}>SKU</th>
                <th rowSpan={2}>{esServicio ? 'Servicio' : 'Producto'}</th>
                {esServicio && <th rowSpan={2}>Categoría</th>}
                {esServicio && <th rowSpan={2}>Subcategoría</th>}
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
                    {esServicio && (
                      <td style={{ fontSize: '.82rem' }}>{it._variante ? '' : (it.servicio_categoria?.trim() || <span className="muted">—</span>)}</td>
                    )}
                    {esServicio && (
                      <td style={{ fontSize: '.82rem' }}>{it._variante ? '' : (it.servicio_tipo?.trim() || <span className="muted">—</span>)}</td>
                    )}
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
                      <input type="text" inputMode="decimal" className="input mono" style={{ width: 95, textAlign: 'right' }}
                        value={it.precioStr} placeholder="0,00" onChange={(e) => updateItemPrecio(idx, e.target.value)} />
                    </td>
                    <td className="num mono">{money(totBcv)}</td>
                    <td className="num">
                      <input type="text" inputMode="decimal" className="input mono" style={{ width: 95, textAlign: 'right' }}
                        value={it.precioUsdStr} placeholder="—" onChange={(e) => updateItemPrecioUsd(idx, e.target.value)} />
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
                <td colSpan={esServicio ? 7 : 5} className="num" style={{ fontWeight: 700 }}>SUBTOTAL</td>
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
          <div>Total BCV: <strong>{precioTotal > 0 ? money(precioTotal) : '—'}</strong></div>
          <div>Total USD: <strong style={{ color: 'var(--success)' }}>{precioEfectivo > 0 ? money(precioEfectivo) : '—'}</strong></div>
          {ahorroEfectivo && (
            <div>Diferencia: <strong>{money(ahorroEfectivo.diferencia)}</strong> <span className="badge success" style={{ marginLeft: '.3rem' }}>−{ahorroEfectivo.pct.toFixed(2)}%</span></div>
          )}
        </div>
        {/* Descuento OBTENIDO (negociado): reduce el monto de la factura. */}
        <div className="form-row" style={{ marginTop: '.6rem' }}>
          <label>Descuento obtenido (opcional)</label>
          <input className="input mono" type="number" min={0} step="any" value={descuentoStr}
            onChange={(e) => setDescuentoStr(e.target.value)} placeholder="0,00" style={{ maxWidth: 200 }} />
          <small className="muted">
            Descuento negociado que se le resta al monto. Factura a pagar:{' '}
            <strong className="mono" style={{ color: 'var(--primary-3)' }}>{money(facturaNeta)}</strong>
            {descuentoObt > 0 && <> · descuento <strong className="mono">{money(descuentoObt)}</strong></>}
          </small>
        </div>
      </div>

      {/* Impuestos: IVA e IGTF, por % o por monto (sincronizados). Se suman al total a pagar. */}
      <div className="card" style={{ background: 'var(--bg-2)', padding: '.8rem', marginBottom: '.75rem' }}>
        <div className="card-title" style={{ marginBottom: '.5rem' }}>
          <span>🧾 Impuestos <span className="muted" style={{ fontWeight: 400 }}>(se calculan sobre la factura neta {money(facturaNeta)} y se suman al total)</span></span>
        </div>

        {/* IVA */}
        <div className="form-row" style={{ marginBottom: '.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={incluyeIva} onChange={(e) => toggleIva(e.target.checked)} />
            <span>Incluye IVA</span>
          </label>
          {incluyeIva && (
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '.35rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="muted" style={{ fontSize: '.72rem' }}>%</span>
                <input className="input mono" type="number" min={0} step="any" style={{ width: 110, textAlign: 'right' }}
                  value={ivaPctStr} placeholder="16" onChange={(e) => setImpPct(e.target.value, setIvaPctStr, setIvaMontoStr)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="muted" style={{ fontSize: '.72rem' }}>Monto</span>
                <input className="input mono" type="number" min={0} step="any" style={{ width: 140, textAlign: 'right' }}
                  value={ivaMontoStr} placeholder="0,00" onChange={(e) => setImpMonto(e.target.value, setIvaPctStr, setIvaMontoStr)} />
              </div>
              <span className="muted" style={{ fontSize: '.78rem', alignSelf: 'flex-end', paddingBottom: '.4rem' }}>IVA: <strong className="mono">{money(ivaMonto)}</strong></span>
            </div>
          )}
        </div>

        {/* IGTF */}
        <div className="form-row" style={{ marginBottom: '.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={incluyeIgtf} onChange={(e) => toggleIgtf(e.target.checked)} />
            <span>Incluye IGTF</span>
          </label>
          {incluyeIgtf && (
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '.35rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="muted" style={{ fontSize: '.72rem' }}>%</span>
                <input className="input mono" type="number" min={0} step="any" style={{ width: 110, textAlign: 'right' }}
                  value={igtfPctStr} placeholder="3" onChange={(e) => setImpPct(e.target.value, setIgtfPctStr, setIgtfMontoStr)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="muted" style={{ fontSize: '.72rem' }}>Monto</span>
                <input className="input mono" type="number" min={0} step="any" style={{ width: 140, textAlign: 'right' }}
                  value={igtfMontoStr} placeholder="0,00" onChange={(e) => setImpMonto(e.target.value, setIgtfPctStr, setIgtfMontoStr)} />
              </div>
              <span className="muted" style={{ fontSize: '.78rem', alignSelf: 'flex-end', paddingBottom: '.4rem' }}>IGTF: <strong className="mono">{money(igtfMonto)}</strong></span>
            </div>
          )}
        </div>

        <div className="mono" style={{ fontSize: '.95rem', borderTop: '1px solid var(--border)', paddingTop: '.5rem' }}>
          Total a pagar (con impuestos): <strong style={{ color: 'var(--primary-3)' }}>{money(totalConImpuestos)}</strong>
          {(ivaMonto > 0 || igtfMonto > 0) && (
            <span className="muted" style={{ fontSize: '.78rem' }}> {' '}= {money(facturaNeta)}{ivaMonto > 0 ? ` + IVA ${money(ivaMonto)}` : ''}{igtfMonto > 0 ? ` + IGTF ${money(igtfMonto)}` : ''}</span>
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
        {isEdit && (
          adjuntosExist.length > 0 ? (
            <div style={{ marginTop: '.35rem' }}>
              <div className="muted" style={{ fontSize: '.74rem', marginBottom: '.2rem' }}>📎 Adjuntos actuales (los nuevos se suman; podés quitar los que no quieras):</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                {adjuntosExist.map((a, i) => (
                  <div key={a.path ?? i} className="muted" style={{ fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                    📎 {a.filename ?? 'adjunto'}
                    <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .35rem', color: 'var(--danger)' }}
                      onClick={() => setAdjuntosExist((prev) => prev.filter((_, k) => k !== i))} title="Quitar este adjunto">✕</button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: '.78rem', marginTop: '.25rem' }}>Sin adjuntos. Cargá las fotos/PDF de la cotización si querés.</div>
          )
        )}
        <div className="muted" style={{ fontSize: '.72rem', marginTop: '.25rem' }}>
          PDF o imágenes · máximo 10 MB c/u. Podés seleccionar o ir agregando varias fotos de la cotización.
        </div>
      </div>
    </Modal>
  );
}
