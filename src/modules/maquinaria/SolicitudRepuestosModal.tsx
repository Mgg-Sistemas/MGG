import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { crearOrden, listProductosActivos, ensureUnidadSolicitante } from '@/modules/pedidos/pedidos.repository';
import type { ItemOrden, Producto } from '@/shared/lib/types';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

/** Unidad y persona precargadas al generar la SP desde una alerta de mantenimiento. */
const UNIDAD_SOLICITANTE = 'MANTENIMIENTO DE MAQUINARIA';
const SOLICITANTE_PERSONA = 'MARIANA TOVAR';

/** Quita acentos y pasa a minúsculas para una búsqueda tolerante. */
const normTxt = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

interface Props {
  equipo: MaquinariaEquipo;
  actorEmail: string;
  onClose: () => void;
  onCreated?: () => void;
}

/**
 * SOLICITUD DE PEDIDO precargada desde una ALERTA de mantenimiento de Maquinaria.
 * Trae fijos la unidad solicitante (Mantenimiento de Maquinaria), la persona
 * (Mariana Tovar) y una nota que nombra la máquina alertada (+placa). El usuario
 * marca los productos del inventario (tipo check, con buscador) e indica cuánto
 * de cada uno; al aceptar se crea una SP normal (crearOrden) que entra al flujo
 * de Pedidos para su aprobación/cotización.
 */
export function SolicitudRepuestosModal({ equipo, actorEmail, onClose, onCreated }: Props) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  // productoId → cantidad (como texto, para tipeo cómodo). Presente = marcado.
  const [sel, setSel] = useState<Record<string, string>>({});
  const [unidad, setUnidad] = useState(UNIDAD_SOLICITANTE);
  const [persona, setPersona] = useState(SOLICITANTE_PERSONA);
  const notaInicial = `SE SOLICITA COMPRAR PARA LA MÁQUINA ${(equipo.equipo || '').toUpperCase()}${equipo.placa ? ` (PLACA ${equipo.placa.toUpperCase()})` : ''}`;
  const [nota, setNota] = useState(notaInicial);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    listProductosActivos()
      .then((ps) => { if (vivo) setProductos(ps); })
      .catch(() => { if (vivo) toast('No se pudo cargar el inventario', 'error'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, []);

  const filtrados = useMemo(() => {
    const q = normTxt(busqueda.trim());
    if (!q) return productos;
    return productos.filter((p) => normTxt(`${p.sku} ${p.nombre} ${p.categoria}`).includes(q));
  }, [productos, busqueda]);

  const marcados = Object.keys(sel).length;

  function toggle(p: Producto) {
    setSel((m) => {
      const n = { ...m };
      if (Object.prototype.hasOwnProperty.call(n, p.id)) delete n[p.id];
      else n[p.id] = '1';
      return n;
    });
  }
  function setCant(id: string, raw: string) {
    setSel((m) => ({ ...m, [id]: raw }));
  }

  async function crear() {
    const items: ItemOrden[] = [];
    for (const p of productos) {
      const raw = sel[p.id];
      if (raw === undefined) continue;
      const cant = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(cant) || cant <= 0) {
        toast(`Indicá una cantidad válida para "${p.nombre}"`, 'error');
        return;
      }
      items.push({
        productoId: p.id, sku: p.sku, nombre: p.nombre,
        cantidad: Math.round(cant * 1000) / 1000, precio: 0, unidad: p.unidad,
        comprar: true,
        finalidad: `MANTENIMIENTO · ${(equipo.equipo || '').toUpperCase()}`,
      });
    }
    if (!items.length) { toast('Marcá al menos un producto y su cantidad', 'error'); return; }
    if (!unidad.trim()) { toast('Indicá la unidad solicitante', 'error'); return; }

    setGuardando(true);
    try {
      try { await ensureUnidadSolicitante(unidad.trim(), actorEmail); } catch { /* ya existe: no bloquea */ }
      const saved = await crearOrden({
        proveedor_id: null,
        items,
        notas: nota.trim() || null,
        motivo: null,
        finalidad: null,
        clasificacion: ['Mantenimiento'],
        solicitante_email: actorEmail,
        solicitante: unidad.trim(),
        solicitante_persona: persona.trim() || null,
        ci_solicitante: null,
      });
      notify(`Nueva solicitud de pedido ${saved.codigo} (mantenimiento · ${equipo.equipo}) enviada para aprobación`, 'success', { link: '#/app/pedidos', destino: 'admin' });
      toast(`Solicitud ${saved.codigo} creada`, 'success');
      onCreated?.();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear la solicitud', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title="🛒 Solicitud de pedido · repuestos por mantenimiento"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => void crear()} disabled={guardando || !marcados}>
            {guardando ? 'Creando…' : `Crear solicitud${marcados ? ` (${marcados})` : ''}`}
          </button>
        </>
      }
    >
      <div className="card" style={{ margin: '0 0 .8rem', padding: '.6rem .85rem', borderColor: 'var(--warning)' }}>
        ⚠️ Mantenimiento próximo · <strong>{equipo.equipo}</strong>
        {equipo.placa ? <span className="muted"> · placa {equipo.placa}</span> : null}
        {equipo.tipo ? <span className="muted"> · {equipo.tipo}</span> : null}
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>Unidad solicitante</label>
          <input className="input" value={unidad} onChange={(e) => setUnidad(e.target.value.toUpperCase())} />
        </div>
        <div className="form-row">
          <label>Solicitante</label>
          <input className="input" value={persona} onChange={(e) => setPersona(e.target.value.toUpperCase())} />
        </div>
      </div>

      <div className="form-row">
        <label>Nota</label>
        <textarea className="textarea" value={nota} onChange={(e) => setNota(e.target.value)} rows={2} />
      </div>

      <div className="form-row">
        <label>Productos del inventario <span className="muted" style={{ fontWeight: 400 }}>· marcá los que se compran e indicá la cantidad</span></label>
        <input className="input" placeholder="🔍 Buscar producto por nombre o SKU…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ marginBottom: '.5rem' }} />
        {cargando ? (
          <EmptyState message="Cargando inventario…" />
        ) : !filtrados.length ? (
          <EmptyState icon="◇" message={productos.length ? 'Ningún producto coincide con la búsqueda.' : 'No hay productos activos en el inventario.'} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr>
                <th style={{ width: 34 }}>✓</th>
                <th>Producto</th>
                <th style={{ textAlign: 'right' }}>Stock</th>
                <th style={{ width: 150, textAlign: 'right' }}>Cantidad a pedir</th>
              </tr></thead>
              <tbody>
                {filtrados.map((p) => {
                  const marcado = Object.prototype.hasOwnProperty.call(sel, p.id);
                  return (
                    <tr key={p.id} style={{ background: marcado ? 'rgba(255,138,0,.08)' : undefined }}>
                      <td><input type="checkbox" checked={marcado} onChange={() => toggle(p)} /></td>
                      <td>
                        <strong>{p.nombre}</strong>
                        <div className="muted mono" style={{ fontSize: '.72rem' }}>{p.sku}{p.categoria ? ` · ${p.categoria}` : ''}</div>
                      </td>
                      <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{p.stock} {p.unidad}</td>
                      <td style={{ textAlign: 'right' }}>
                        {marcado ? (
                          <div style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center' }}>
                            <input className="input mono" type="number" min={0} step="any" autoFocus
                              style={{ width: 84, textAlign: 'right', fontWeight: 700 }}
                              value={sel[p.id]}
                              onChange={(e) => setCant(p.id, e.target.value)} />
                            <span className="muted" style={{ fontSize: '.72rem', minWidth: 34, textAlign: 'left' }}>{p.unidad}</span>
                          </div>
                        ) : <span className="muted" style={{ fontSize: '.75rem' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="hint muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>
        Se crea una <strong>Solicitud de Pedido</strong> sin monto (el precio lo fija el proveedor al cotizar). Entra al módulo de Pedidos para aprobación y compra.
      </p>
    </Modal>
  );
}
