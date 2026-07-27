import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import type { Producto, RecetaFundicion } from '@/shared/lib/types';
import { RECETAS_FUNDICION } from '@/shared/lib/types';
import {
  exportarInventarioExcel,
  exportarInventarioPdf,
  filtrarParaExport,
  type ExportFiltros,
} from './inventarioBulk';
import { getCategorias } from './inventario.repository';
import { AlmacenSelectAgrupado } from './AlmacenPicker';

interface Props {
  productos: Producto[];
  /** Si viene, el export se limita a ESE almacén/centro (con opción General/Casiterita). */
  scope?: { titulo: string; general: Producto[]; casiterita: Producto[] };
  onClose: () => void;
}

type RecetaFiltro = '' | 'con_receta' | 'sin_receta' | 'en_proceso' | RecetaFundicion;

export function ExportInventarioModal({ productos, scope, onClose }: Props) {
  // Vista dentro de un centro: General o Casiterita (solo si el centro tiene casiterita).
  const [vista, setVista] = useState<'general' | 'casiterita'>('general');
  // Base de productos: el scope del centro (general/casiterita) o TODOS si no hay scope.
  const base = scope ? (vista === 'casiterita' ? scope.casiterita : scope.general) : productos;
  const [f, setF] = useState<ExportFiltros>({
    categorias: [],
    estado: 'activo',
    bajoMinimo: false,
    receta: '',
    almacen: '',
    unidad: '',
    texto: '',
  });
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);

  const [categorias, setCategorias] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    getCategorias(base)
      .then((cs) => { if (!cancelled) setCategorias(cs); })
      .catch(() => { /* defaults via repo */ });
    return () => { cancelled = true; };
  }, [base]);
  const almacenes = useMemo(() => Array.from(new Set(base.map((p) => p.almacen).filter(Boolean))).sort(), [base]);
  const unidades = useMemo(() => Array.from(new Set(base.map((p) => p.unidad).filter(Boolean))).sort(), [base]);

  const filtrados = useMemo(() => filtrarParaExport(base, f), [base, f]);

  function update<K extends keyof ExportFiltros>(key: K, value: ExportFiltros[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
  }

  const catsSel = f.categorias ?? [];
  function toggleCategoria(c: string) {
    setF((prev) => {
      const cur = prev.categorias ?? [];
      return { ...prev, categorias: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] };
    });
  }

  async function handleExportar(formato: 'xlsx' | 'pdf') {
    if (!filtrados.length) {
      toast('Ningún producto coincide con los filtros', 'warning');
      return;
    }
    setBusy(formato);
    try {
      if (formato === 'xlsx') {
        await exportarInventarioExcel(filtrados);
        toast(`Excel exportado · ${filtrados.length} productos`, 'success');
      } else {
        await exportarInventarioPdf(filtrados);
        toast(`PDF exportado · ${filtrados.length} productos`, 'success');
      }
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo exportar', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      title={scope ? `Exportar · ${scope.titulo}` : 'Exportar inventario'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={!!busy}>Cancelar</button>
          <button className="btn btn-ghost" onClick={() => handleExportar('pdf')} disabled={!!busy}>
            {busy === 'pdf' ? 'Generando…' : '↓ PDF'}
          </button>
          <button className="btn btn-primary" onClick={() => handleExportar('xlsx')} disabled={!!busy}>
            {busy === 'xlsx' ? 'Generando…' : '↓ Excel'}
          </button>
        </>
      }
    >
      <p className="hint muted" style={{ fontSize: '.85rem', marginTop: 0 }}>
        Aplicá los filtros que querés que aparezcan en el reporte. La vista previa muestra cuántos productos quedan.
      </p>

      <div className="form-grid">
        <div className="form-row">
          <label>Texto (SKU o nombre)</label>
          <input
            className="input"
            value={f.texto ?? ''}
            onChange={(e) => update('texto', e.target.value)}
            placeholder="Filtro libre"
          />
        </div>
        <div className="form-row">
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Categoría {catsSel.length > 0 && <span className="muted">· {catsSel.length} seleccionada(s)</span>}</span>
            {catsSel.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => update('categorias', [])}>Limpiar</button>}
          </label>
          <div className="card" style={{ margin: 0, padding: '.4rem .6rem', maxHeight: 190, overflowY: 'auto' }}>
            {!categorias.length ? (
              <span className="muted" style={{ fontSize: '.82rem' }}>Sin categorías.</span>
            ) : (
              <>
                <div className="muted" style={{ fontSize: '.74rem', marginBottom: '.35rem' }}>
                  {catsSel.length === 0 ? 'Marcá una o varias. Sin marcar = todas las categorías.' : 'Solo saldrán las categorías marcadas.'}
                </div>
                {categorias.map((c) => (
                  <label key={c} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.15rem 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={catsSel.includes(c)} onChange={() => toggleCategoria(c)} />
                    <span>{c}</span>
                  </label>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>Estado</label>
          <select className="select" value={f.estado ?? ''} onChange={(e) => update('estado', e.target.value as 'activo' | 'inactivo' | '')}>
            <option value="">Todos</option>
            <option value="activo">Activos</option>
            <option value="inactivo">Inactivos</option>
          </select>
        </div>
        <div className="form-row">
          <label>Receta de fundición</label>
          <select
            className="select"
            value={f.receta ?? ''}
            onChange={(e) => update('receta', e.target.value as RecetaFiltro)}
          >
            <option value="">Todos</option>
            <option value="con_receta">Con receta (cualquiera)</option>
            <option value="sin_receta">Sin receta</option>
            <option value="en_proceso">En proceso de fundición</option>
            {RECETAS_FUNDICION.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>Almacén</label>
          {scope ? (
            scope.casiterita.length > 0 ? (
              <div className="view-toggle" role="tablist" aria-label="General o Casiterita" style={{ marginLeft: 0 }}>
                <button type="button" className={vista === 'general' ? 'active' : ''} onClick={() => setVista('general')}>📦 General</button>
                <button type="button" className={vista === 'casiterita' ? 'active' : ''} onClick={() => setVista('casiterita')}>⛏ Casiterita</button>
              </div>
            ) : (
              <input className="input" value={scope.titulo} disabled readOnly />
            )
          ) : (
            <AlmacenSelectAgrupado value={f.almacen ?? ''} onChange={(v) => update('almacen', v)} todosLabel="Todos" extraNombres={almacenes} />
          )}
        </div>
        <div className="form-row">
          <label>Unidad</label>
          <select className="select" value={f.unidad ?? ''} onChange={(e) => update('unidad', e.target.value)}>
            <option value="">Todas</option>
            {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row">
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!f.bajoMinimo}
            onChange={(e) => update('bajoMinimo', e.target.checked)}
          />
          <span>Sólo productos con stock por debajo del mínimo</span>
        </label>
      </div>

      <div
        className="card"
        style={{ padding: '.75rem 1rem', marginTop: '1rem', borderLeft: '3px solid var(--primary)' }}
      >
        <strong>{filtrados.length}</strong>{' '}
        <span className="muted">producto(s) coinciden con los filtros · van a salir en el reporte.</span>
      </div>
    </Modal>
  );
}
