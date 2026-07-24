import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime } from '@/shared/lib/format';
import { crearOrden, ensureUnidadSolicitante, ultimaOrdenMercado, FINALIDAD_MERCADO } from './pedidos.repository';
import type { ItemOrden, Producto, Usuario } from '@/shared/lib/types';

/** Valores precargados (editables) de la Solicitud de Mercado. */
const UNIDAD_DEFAULT = 'COCINA';
const SOLICITANTE_DEFAULT = 'COCINA';

/** Quita acentos y pasa a minúsculas para comparar categorías de forma tolerante. */
const norm = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** ¿La categoría es "Víveres y Art. de Limpieza" (tolerante a acentos/variantes)? */
const esViveres = (categoria: string) => norm(categoria).includes('viveres');

interface Props {
  productos: Producto[];
  usuario: Usuario | null;
  authEmail: string;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * SOLICITUD DE MERCADO (botón independiente en Pedidos). Trae TODOS los productos
 * de la categoría «Víveres y Art. de Limpieza» como checklist con cantidades editables,
 * precargada para COCINA y marcada como ORDEN URGENTE. Al aceptar crea una SP
 * (finalidad = reposición de mercado) que entra al flujo normal de Pedidos.
 */
export function SolicitudMercadoModal({ productos, usuario, authEmail, onClose, onCreated }: Props) {
  const email = usuario?.email ?? authEmail;
  const viveres = useMemo(
    () => productos.filter((p) => p.estado !== 'inactivo' && esViveres(p.categoria)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [productos],
  );

  const [unidad, setUnidad] = useState(UNIDAD_DEFAULT);
  const [persona, setPersona] = useState(SOLICITANTE_DEFAULT);
  const [nota, setNota] = useState('');
  // sku → { check, cantidad(texto) }. Todos vienen marcados (traer todo) con cantidad 1;
  // luego se reemplaza por la cantidad SUGERIDA de la última compra de mercado (si la hubo).
  const [sel, setSel] = useState<Record<string, { check: boolean; cant: string }>>(() => {
    const init: Record<string, { check: boolean; cant: string }> = {};
    for (const p of viveres) init[p.sku] = { check: true, cant: '1' };
    return init;
  });
  const [guardando, setGuardando] = useState(false);
  // Info de la última compra de mercado, de donde salen las cantidades sugeridas.
  const [ultima, setUltima] = useState<{ codigo: string; fecha?: string | null } | null>(null);

  // Al abrir, trae la ÚLTIMA compra de mercado y precarga la cantidad de cada víver
  // que ya se compró antes (por SKU, con respaldo por productoId). El resto queda en 1.
  useEffect(() => {
    let vivo = true;
    ultimaOrdenMercado()
      .then((o) => {
        if (!vivo || !o) return;
        const porSku = new Map<string, number>();
        const porId = new Map<string, number>();
        for (const it of o.items ?? []) {
          const c = Number(it.cantidad) || 0;
          if (c <= 0) continue;
          if (it.sku) porSku.set(it.sku, c);
          if (it.productoId) porId.set(it.productoId, c);
        }
        setSel((m) => {
          const n = { ...m };
          for (const p of viveres) {
            const sug = porSku.get(p.sku) ?? porId.get(p.id);
            if (sug != null) n[p.sku] = { check: n[p.sku]?.check ?? true, cant: String(sug) };
          }
          return n;
        });
        setUltima({ codigo: o.codigo, fecha: o.created_at });
      })
      .catch(() => { /* sin sugerencias: quedan en 1 */ });
    return () => { vivo = false; };
  }, [viveres]);

  const marcados = viveres.filter((p) => sel[p.sku]?.check).length;

  function toggle(sku: string) {
    setSel((m) => ({ ...m, [sku]: { check: !(m[sku]?.check ?? false), cant: m[sku]?.cant ?? '1' } }));
  }
  function setCant(sku: string, cant: string) {
    setSel((m) => ({ ...m, [sku]: { check: m[sku]?.check ?? true, cant } }));
  }
  function marcarTodos(v: boolean) {
    setSel((m) => {
      const n = { ...m };
      for (const p of viveres) n[p.sku] = { check: v, cant: n[p.sku]?.cant ?? '1' };
      return n;
    });
  }

  async function crear() {
    const items: ItemOrden[] = [];
    for (const p of viveres) {
      const s = sel[p.sku];
      if (!s?.check) continue;
      const cant = Number(String(s.cant ?? '').replace(',', '.'));
      if (!Number.isFinite(cant) || cant <= 0) { toast(`Indicá una cantidad válida para "${p.nombre}"`, 'error'); return; }
      items.push({ productoId: p.id, sku: p.sku, nombre: p.nombre, cantidad: Math.round(cant * 1000) / 1000, precio: 0, unidad: p.unidad, comprar: true });
    }
    if (!items.length) { toast('Marcá al menos un producto', 'error'); return; }
    if (!unidad.trim()) { toast('Indicá la unidad solicitante', 'error'); return; }

    setGuardando(true);
    try {
      try { await ensureUnidadSolicitante(unidad.trim(), email); } catch { /* ya existe */ }
      const saved = await crearOrden({
        proveedor_id: null,
        items,
        notas: nota.trim() || null,
        motivo: null,
        finalidad: FINALIDAD_MERCADO,
        clasificacion: ['Mercado'],
        solicitante_email: email,
        solicitante: unidad.trim(),
        ci_solicitante: persona.trim() || null,
        urgente: true,
      });
      notify(`Solicitud de MERCADO ${saved.codigo} · URGENTE enviada para aprobación`, 'success', { link: '#/app/pedidos', destino: 'admin' });
      toast(`Solicitud de mercado ${saved.codigo} creada`, 'success');
      onCreated();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear la solicitud', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title="🛒 Solicitud de Mercado"
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
      <div className="card" style={{ margin: '0 0 .8rem', padding: '.6rem .85rem', borderColor: 'var(--danger)', background: 'rgba(239,68,68,.08)' }}>
        🚨 <strong>Se marca como ORDEN URGENTE.</strong> <span className="muted" style={{ fontSize: '.82rem' }}>Reposición de víveres y artículos de limpieza para la cocina.</span>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>Unidad solicitante</label>
          <input className="input" value={unidad} onChange={(e) => setUnidad(e.target.value.toUpperCase())} />
        </div>
        <div className="form-row">
          <label>Solicitado por</label>
          <input className="input" value={persona} onChange={(e) => setPersona(e.target.value.toUpperCase())} />
        </div>
      </div>

      <div className="form-row">
        <label>Nota <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
        <textarea className="textarea" value={nota} onChange={(e) => setNota(e.target.value)} rows={2}
          placeholder="Observación de la solicitud de mercado (opcional)…" />
      </div>

      <div className="form-row">
        <label>Víveres y Art. de Limpieza <span className="muted" style={{ fontWeight: 400 }}>· marcá los que se piden e indicá la cantidad</span></label>
        {ultima && (
          <small className="muted" style={{ display: 'block', margin: '-.2rem 0 .5rem', fontSize: '.76rem' }}>
            🧾 Cantidades sugeridas de la última compra <strong className="mono">{ultima.codigo}</strong>{ultima.fecha ? <> · {dateTime(ultima.fecha)}</> : null} (editables).
          </small>
        )}
        {!viveres.length ? (
          <EmptyState icon="◇" message="No hay productos activos en la categoría «Víveres y Art. de Limpieza». Cargalos primero en Inventario." />
        ) : (
          <>
            <div style={{ display: 'flex', gap: '.4rem', margin: '0 0 .4rem' }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => marcarTodos(true)}>✓ Marcar todos</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => marcarTodos(false)}>✕ Desmarcar todos</button>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: '.8rem', alignSelf: 'center' }}>{marcados} de {viveres.length}</span>
            </div>
            <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
              <table className="table" style={{ fontSize: '.85rem' }}>
                <thead><tr>
                  <th style={{ width: 34 }}>✓</th>
                  <th>Producto</th>
                  <th style={{ textAlign: 'right' }}>Stock</th>
                  <th style={{ width: 150, textAlign: 'right' }}>Cantidad a pedir</th>
                </tr></thead>
                <tbody>
                  {viveres.map((p) => {
                    const s = sel[p.sku] ?? { check: true, cant: '1' };
                    return (
                      <tr key={p.id} style={{ background: s.check ? 'rgba(255,138,0,.08)' : undefined }}>
                        <td><input type="checkbox" checked={s.check} onChange={() => toggle(p.sku)} /></td>
                        <td>
                          <strong>{p.nombre}</strong>
                          <div className="muted mono" style={{ fontSize: '.72rem' }}>{p.sku}</div>
                        </td>
                        <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{p.stock} {p.unidad}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center' }}>
                            <input className="input mono" type="number" min={0} step="any" disabled={!s.check}
                              style={{ width: 84, textAlign: 'right', fontWeight: 700 }}
                              value={s.cant} onChange={(e) => setCant(p.sku, e.target.value)} />
                            <span className="muted" style={{ fontSize: '.72rem', minWidth: 34, textAlign: 'left' }}>{p.unidad}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <p className="hint muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>
        Se crea una <strong>Solicitud de Pedido</strong> (finalidad: {FINALIDAD_MERCADO}) sin monto; el precio lo fija el proveedor al cotizar. Entra al módulo de Pedidos para aprobación.
      </p>
    </Modal>
  );
}
