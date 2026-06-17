import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { notify } from '@/shared/lib/notify';
import { money } from '@/shared/lib/format';
import { PREFIJOS_RIF, partirRif } from '@/shared/lib/rif';
import type { ItemOrden, Orden, OrigenProveedor, Proveedor, OfertaDetalle, CostoLogistico } from '@/shared/lib/types';
import { crearOferta, subirPdfOferta, CONDICIONES_PAGO } from './ofertas.repository';
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
  onClose: () => void;
  onCreated: () => void;
}

interface FormItem extends ItemOrden {
  precio: number;
}

export function AgregarOfertaModal({
  orden,
  proveedores,
  proveedoresYaOfertados,
  registradoPorEmail,
  onClose,
  onCreated,
}: Props) {
  const opcionesProveedor = useMemo(
    () => proveedores.filter((p) => p.estado === 'activo' && !proveedoresYaOfertados.has(p.id)),
    [proveedores, proveedoresYaOfertados]
  );

  // Modo proveedor: si el checkbox está activo, se crea uno nuevo en línea.
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [proveedorId, setProveedorId] = useState<string>(opcionesProveedor[0]?.id ?? '');

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
  const [items, setItems] = useState<FormItem[]>(
    orden.items.filter((i) => i.comprar !== false).map((i) => ({ ...i, precio: 0 })),
  );
  const [fechaEntrega, setFechaEntrega] = useState<string>('');
  const [condiciones, setCondiciones] = useState('');
  const [notas, setNotas] = useState('');
  // Datos técnicos/logísticos de la oferta (todos opcionales).
  const [detalle, setDetalle] = useState<OfertaDetalle>({});
  const setD = (patch: Partial<OfertaDetalle>) => setDetalle((d) => ({ ...d, ...patch }));
  const setLog = (k: 'flete' | 'transporte' | 'embalaje' | 'seguros', v: CostoLogistico) =>
    setDetalle((d) => ({ ...d, logistica: { ...(d.logistica ?? {}), [k]: v } }));
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) { setPdfFile(null); return; }
    if (f.type !== 'application/pdf' && !f.type.startsWith('image/')) {
      toast('El archivo debe ser PDF o imagen', 'error');
      e.target.value = '';
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast('El archivo no puede superar 10 MB', 'error');
      e.target.value = '';
      return;
    }
    setPdfFile(f);
  }

  const precioTotal = items.reduce((a, i) => a + i.cantidad * i.precio, 0);

  function updateItemPrecio(idx: number, precio: number) {
    setItems((prev) => prev.map((it, k) => (k === idx ? { ...it, precio: Math.max(0, precio) } : it)));
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
    setSubmitting(true);
    try {
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

      // 2) Subir PDF (si lo hay)
      let pdf_path: string | null = null;
      let pdf_filename: string | null = null;
      if (pdfFile) {
        const uploaded = await subirPdfOferta(orden.id, provId, pdfFile);
        pdf_path = uploaded.path;
        pdf_filename = uploaded.filename;
      }

      // 3) Crear oferta
      await crearOferta({
        orden_id: orden.id,
        proveedor_id: provId,
        items,
        precio_total: precioTotal,
        fecha_entrega_prometida: fechaEntrega || null,
        condiciones_pago: condiciones.trim() || null,
        notas: notas.trim() || null,
        detalle,
        registrada_por_email: registradoPorEmail,
        pdf_path,
        pdf_filename,
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
      title={`Agregar oferta · ${orden.codigo}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Guardando…' : 'Registrar oferta'}
          </button>
        </>
      }
    >
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

      {nuevoProveedor ? (
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
        <label>Cotización por ítem</label>
        <div className="table-wrap">
          <table className="items-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto</th>
                <th className="num">Cantidad</th>
                <th className="num">Precio unit.</th>
                <th className="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={`${it.sku}-${idx}`}>
                  <td className="mono">{it.sku}</td>
                  <td>{it.nombre}</td>
                  <td className="num">{it.cantidad}</td>
                  <td className="num">
                    <input
                      type="number"
                      className="input mono"
                      style={{ width: 110, textAlign: 'right' }}
                      min={0}
                      step={0.01}
                      value={it.precio}
                      onChange={(e) => updateItemPrecio(idx, Number(e.target.value) || 0)}
                    />
                  </td>
                  <td className="num mono">{money(it.cantidad * it.precio)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="num">TOTAL OFERTA</td>
                <td className="num mono">{money(precioTotal)}</td>
              </tr>
            </tfoot>
          </table>
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
        <label>Cargue la cotización del proveedor (opcional)</label>
        <input type="file" className="input" accept="application/pdf,image/*" onChange={handleFileChange} />
        {pdfFile && (
          <div className="muted" style={{ fontSize: '.78rem', marginTop: '.25rem' }}>
            ✓ {pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)
          </div>
        )}
        <div className="muted" style={{ fontSize: '.72rem', marginTop: '.25rem' }}>
          PDF o imagen · máximo 10 MB. El jefe podrá descargarlo para validar la oferta antes de aprobar.
        </div>
      </div>
    </Modal>
  );
}
