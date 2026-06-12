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
  onClose: () => void;
}

type RecetaFiltro = '' | 'con_receta' | 'sin_receta' | 'en_proceso' | RecetaFundicion;

export function ExportInventarioModal({ productos, onClose }: Props) {
  const [f, setF] = useState<ExportFiltros>({
    categoria: '',
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
    getCategorias(productos)
      .then((cs) => { if (!cancelled) setCategorias(cs); })
      .catch(() => { /* defaults via repo */ });
    return () => { cancelled = true; };
  }, [productos]);
  const almacenes = useMemo(() => Array.from(new Set(productos.map((p) => p.almacen).filter(Boolean))).sort(), [productos]);
  const unidades = useMemo(() => Array.from(new Set(productos.map((p) => p.unidad).filter(Boolean))).sort(), [productos]);

  const filtrados = useMemo(() => filtrarParaExport(productos, f), [productos, f]);

  function update<K extends keyof ExportFiltros>(key: K, value: ExportFiltros[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
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
      title="Exportar inventario"
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
      <p className="muted" style={{ fontSize: '.85rem', marginTop: 0 }}>
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
          <label>Categoría</label>
          <select className="select" value={f.categoria ?? ''} onChange={(e) => update('categoria', e.target.value)}>
            <option value="">Todas</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
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
          <AlmacenSelectAgrupado value={f.almacen ?? ''} onChange={(v) => update('almacen', v)} todosLabel="Todos" extraNombres={almacenes} />
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
