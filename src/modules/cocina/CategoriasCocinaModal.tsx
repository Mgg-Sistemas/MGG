/* ============================================================
   MGG · Cocina · Gestionar las categorías que entran a Alimentación (05-10-2026)

   Qué categorías del inventario ve Cocina (víveres, mercado, consumo) y cuáles
   no bajan por Salidas en Los Pinos / La Esperanza. Cada una es «Comida» (la
   descuenta el plato) o «Limpieza» (se gasta en la cocina, nadie la sirve).
   La base lee la misma tabla, así que el cambio vale en todo el sistema.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { getCategorias, listProductos } from '@/modules/inventario/inventario.repository';
import {
  guardarCategoriaCocina, listCategoriasCocina, normCategoriaCocina, quitarCategoriaCocina,
  type CategoriaCocina, type TipoCategoriaCocina,
} from './categoriasCocina';

const ETIQUETA_TIPO: Record<TipoCategoriaCocina, string> = { comestible: '🍽 Comida', limpieza: '🧽 Limpieza' };

export function CategoriasCocinaModal({ actor, canWrite, onClose }: { actor: string; canWrite: boolean; onClose: () => void }) {
  const [filas, setFilas] = useState<CategoriaCocina[]>([]);
  const [delInventario, setDelInventario] = useState<string[]>([]);
  const [productosPorCat, setProductosPorCat] = useState<Map<string, number>>(new Map());
  const [nueva, setNueva] = useState('');
  const [tipoNueva, setTipoNueva] = useState<TipoCategoriaCocina>('comestible');
  const [busca, setBusca] = useState('');
  const [guardando, setGuardando] = useState<string | null>(null);
  const [quitar, setQuitar] = useState<CategoriaCocina | null>(null);

  const reload = useCallback(async () => {
    try { setFilas(await listCategoriasCocina()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron leer las categorías', 'error'); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useRealtime(['categorias_cocina'], () => { void reload(); });
  // Categorías que existen en el inventario y cuántos productos activos tiene cada una.
  useEffect(() => {
    listProductos().then(async (prods) => {
      const m = new Map<string, number>();
      for (const p of prods) {
        if (p.estado !== 'activo') continue;
        const k = normCategoriaCocina(p.categoria ?? '');
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      }
      setProductosPorCat(m);
      setDelInventario(await getCategorias(prods));
    }).catch(() => { /* sin conteo: la gestión igual funciona */ });
  }, []);

  const yaEsta = useMemo(() => new Set(filas.map((f) => normCategoriaCocina(f.categoria))), [filas]);
  const sugeridas = useMemo(() => delInventario.filter((c) => !yaEsta.has(normCategoriaCocina(c))), [delInventario, yaEsta]);
  const visibles = useMemo(() => {
    const q = normCategoriaCocina(busca);
    const xs = q ? filas.filter((f) => normCategoriaCocina(f.categoria).includes(q)) : filas;
    // Activas primero, después por tipo y nombre.
    return [...xs].sort((a, b) => Number(b.activa) - Number(a.activa) || a.tipo.localeCompare(b.tipo) || a.categoria.localeCompare(b.categoria, 'es'));
  }, [filas, busca]);

  async function guardar(f: { categoria: string; tipo: TipoCategoriaCocina; activa: boolean }, aviso: string) {
    setGuardando(f.categoria);
    try { await guardarCategoriaCocina(f, actor); toast(aviso, 'success'); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setGuardando(null); }
  }

  async function agregar() {
    const cat = nueva.trim();
    if (!cat) { toast('Escribí o elegí la categoría.', 'error'); return; }
    if (yaEsta.has(normCategoriaCocina(cat))) { toast(`«${cat.toUpperCase()}» ya está en la lista.`, 'warning'); return; }
    await guardar({ categoria: cat, tipo: tipoNueva, activa: true }, `«${cat.toUpperCase()}» entra a Cocina`);
    setNueva('');
  }

  async function confirmarQuitar() {
    if (!quitar) return;
    const cat = quitar.categoria;
    setQuitar(null);
    setGuardando(cat);
    try { await quitarCategoriaCocina(cat); toast(`«${cat}» ya no entra a Cocina`, 'success'); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo quitar', 'error'); }
    finally { setGuardando(null); }
  }

  const activas = filas.filter((f) => f.activa).length;

  return (
    <Modal title="🏷 Categorías que entran a Cocina" size="lg" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Los productos del inventario con estas categorías aparecen en Cocina (víveres, mercado y consumo).
        En <strong>Los Pinos</strong> y <strong>La Esperanza</strong> no bajan por Salidas: salen por consumo desde Alimentación.
        <strong> 🍽 Comida</strong> la descuentan los platos; <strong>🧽 Limpieza</strong> se gasta en la cocina pero nadie la sirve.
        Las mayúsculas, las tildes y la «S» final no importan (PROTEINA = Proteínas).
      </p>

      {canWrite && (
        <div className="card" style={{ padding: '.6rem .8rem', marginBottom: '.75rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
            <label>Agregar categoría</label>
            <input className="input" list="cat-cocina-inventario" value={nueva} placeholder="Elegí del inventario o escribila"
              onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregar(); } }} />
            <datalist id="cat-cocina-inventario">
              {sugeridas.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Tipo</label>
            <select className="select" value={tipoNueva} onChange={(e) => setTipoNueva(e.target.value as TipoCategoriaCocina)}>
              <option value="comestible">{ETIQUETA_TIPO.comestible}</option>
              <option value="limpieza">{ETIQUETA_TIPO.limpieza}</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => void agregar()} disabled={!!guardando}>＋ Agregar</button>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'center', marginBottom: '.4rem', flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: '.82rem' }}>{activas} activa{activas === 1 ? '' : 's'} de {filas.length}</span>
        <input className="input" style={{ maxWidth: 240 }} placeholder="🔎 Buscar categoría…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Categoría</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Productos</th><th>Entra a Cocina</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {visibles.map((f) => {
              const n = productosPorCat.get(normCategoriaCocina(f.categoria)) ?? 0;
              const ocupado = guardando === f.categoria;
              return (
                <tr key={f.categoria} style={{ opacity: f.activa ? 1 : 0.55 }}>
                  <td><strong>{f.categoria}</strong></td>
                  <td>
                    {canWrite ? (
                      <select className="select" value={f.tipo} disabled={ocupado}
                        onChange={(e) => void guardar({ ...f, tipo: e.target.value as TipoCategoriaCocina }, `«${f.categoria}» ahora es ${ETIQUETA_TIPO[e.target.value as TipoCategoriaCocina]}`)}>
                        <option value="comestible">{ETIQUETA_TIPO.comestible}</option>
                        <option value="limpieza">{ETIQUETA_TIPO.limpieza}</option>
                      </select>
                    ) : ETIQUETA_TIPO[f.tipo]}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{n || <span className="muted">0</span>}</td>
                  <td>
                    <label style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center', cursor: canWrite ? 'pointer' : 'default' }}>
                      <input type="checkbox" checked={f.activa} disabled={!canWrite || ocupado}
                        onChange={(e) => void guardar({ ...f, activa: e.target.checked }, e.target.checked ? `«${f.categoria}» entra a Cocina` : `«${f.categoria}» pausada: no entra a Cocina`)} />
                      <span>{f.activa ? 'Sí' : 'Pausada'}</span>
                    </label>
                  </td>
                  {canWrite && (
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} disabled={ocupado}
                        onClick={() => setQuitar(f)} title="Quitar de la lista">✕</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {!visibles.length && <tr><td colSpan={canWrite ? 5 : 4} className="muted" style={{ textAlign: 'center' }}>Sin categorías.</td></tr>}
          </tbody>
        </table>
      </div>

      {quitar && (
        <ConfirmDialog
          title="Quitar categoría"
          message={`«${quitar.categoria}» deja de entrar a Cocina: sus ${productosPorCat.get(normCategoriaCocina(quitar.categoria)) ?? 0} producto(s) salen de la lista de víveres y del mercado, y en Los Pinos / La Esperanza volverán a bajar por Salidas. El inventario no se toca. Si es temporal, mejor pausala.`}
          confirmText="Quitar"
          danger
          onConfirm={() => void confirmarQuitar()}
          onCancel={() => setQuitar(null)}
        />
      )}
    </Modal>
  );
}
