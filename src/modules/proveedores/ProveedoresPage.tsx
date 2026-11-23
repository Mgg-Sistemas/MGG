import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { SearchSelect, type SearchOption } from '@/shared/ui/SearchSelect';
import { useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { date, money } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { PREFIJOS_RIF, partirRif } from '@/shared/lib/rif';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type { EstadoGenerico, Orden, Proveedor } from '@/shared/lib/types';
import {
  addCategoria,
  contarProveedoresPorCategoria,
  eliminarCategoria,
  getCategorias,
  getOrdenesByProveedor,
  insert as insertProv,
  list as listProveedores,
  renombrarCategoria,
  toggleEstado,
  update as updateProv,
  type ProveedorInput,
} from './proveedores.repository';
import { GestionarCategoriasModal } from '@/shared/ui/GestionarCategoriasModal';
import { SearchMultiSelect } from '@/shared/ui/SearchMultiSelect';
import { useSession } from '@/modules/auth/authStore';
import { norm } from '@/shared/lib/texto';
import { ExportarProveedoresModal } from './ExportarProveedoresModal';
import { SelectorUbicacionMapa } from './SelectorUbicacionMapa';
import { guardarUbicacion, ubicacionDe } from './proveedores.repository';
import { coordsTxt, parsearCoordenadas, type PuntoMapa } from './ubicacionProveedor';

type EstadoFilter = '' | EstadoGenerico;
type ModoVista = 'tarjetas' | 'tabla';
const VIEW_KEY = 'mgg.proveedores.modo_vista';

const EMPTY_FORM: ProveedorInput = {
  rif: '',
  razon_social: '',
  contacto: null,
  telefono: '',
  email: '',
  direccion: '',
  categorias: [],
  origen: 'nacional',
  estado: 'activo',
  actividad_economica: null,
  numero_administracion: null,
};

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const onlyDigits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

interface CategoriaMultiDropdownProps {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  proveedores: Proveedor[];
}

function CategoriaMultiDropdown({ options, selected, onChange, proveedores }: CategoriaMultiDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const countsPerCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of proveedores) {
      for (const c of p.categorias ?? []) {
        map.set(c, (map.get(c) ?? 0) + 1);
      }
    }
    return map;
  }, [proveedores]);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return options;
    return options.filter((o) => norm(o).includes(q));
  }, [options, query]);

  function toggle(cat: string) {
    if (selected.includes(cat)) {
      onChange(selected.filter((c) => c !== cat));
    } else {
      onChange([...selected, cat]);
    }
  }

  const labelBtn =
    selected.length === 0
      ? '🏷️ Categorías (Todas)'
      : selected.length === 1
      ? `🏷️ ${selected[0]}`
      : `🏷️ Categorías (${selected.length})`;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`btn btn-sm ${selected.length > 0 ? 'btn-primary' : 'btn-outline'}`}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          height: 38,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '.4rem',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          borderRadius: 'var(--r-md, 8px)',
        }}
        title="Filtrar por una o varias categorías (búsqueda interactiva)"
      >
        <span>{labelBtn}</span>
        <span style={{ fontSize: '.7rem', opacity: 0.7 }}>{open ? '▲' : '▾'}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filtro de categorías"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 9999,
            minWidth: 280,
            maxWidth: 340,
            width: 'max-content',
            background: 'var(--surface-2, #182230)',
            border: '1.5px solid var(--primary, #ff8a00)',
            borderRadius: 12,
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.65)',
            padding: '.6rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '.5rem',
          }}
        >
          <input
            className="input"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 Buscar categoría…"
            style={{ fontSize: '.84rem', padding: '.4rem .65rem', height: 34 }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.75rem', padding: '0 .2rem' }}>
            <span className="muted">
              {filtered.length} de {options.length}
            </span>
            <div style={{ display: 'flex', gap: '.3rem' }}>
              {selected.length > 0 && (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => onChange([])}
                  style={{ color: 'var(--danger, #ef4444)' }}
                >
                  Limpiar ({selected.length})
                </button>
              )}
              <button
                type="button"
                className="btn btn-xs btn-ghost"
                onClick={() => { setOpen(false); setQuery(''); }}
              >
                Cerrar ✕
              </button>
            </div>
          </div>

          <div
            style={{
              maxHeight: 260,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '1px',
              borderTop: '1px solid var(--border)',
              paddingTop: '.3rem',
            }}
          >
            {filtered.length === 0 ? (
              <div className="muted" style={{ padding: '.8rem', fontSize: '.82rem', textAlign: 'center' }}>
                Sin categorías coincidentes
              </div>
            ) : (
              filtered.map((cat) => {
                const isSelected = selected.includes(cat);
                const count = countsPerCategory.get(cat) ?? 0;
                return (
                  <div
                    key={cat}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggle(cat)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '.4rem .6rem',
                      cursor: 'pointer',
                      borderRadius: 6,
                      background: isSelected ? 'rgba(255, 138, 0, 0.15)' : 'transparent',
                      color: isSelected ? 'var(--primary-2, #ffa733)' : 'var(--text)',
                      fontWeight: isSelected ? 700 : 400,
                      fontSize: '.85rem',
                      transition: 'background 0.1s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', minWidth: 0 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cat}
                      </span>
                    </div>
                    {count > 0 && (
                      <span
                        className="badge mono"
                        style={{
                          fontSize: '.68rem',
                          padding: '1px 6px',
                          marginLeft: '.5rem',
                          background: isSelected ? 'var(--primary)' : 'var(--surface-3)',
                          color: isSelected ? '#fff' : 'var(--text-muted)',
                        }}
                      >
                        {count}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProveedoresPage() {
  const canWrite = usePermissions().can('proveedores', 'escritura');
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [filterText, setFilterText] = useState('');
  const [filterEstado, setFilterEstado] = useState<EstadoFilter>('');
  const [filterCategorias, setFilterCategorias] = useState<string[]>([]);
  const [filterOrigen, setFilterOrigen] = useState<string>('');
  const [filterUbicacion, setFilterUbicacion] = useState<string>('');
  const [filterGps, setFilterGps] = useState(false);
  const [categoriasList, setCategoriasList] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    getCategorias(proveedores)
      .then((cs) => { if (!cancelled) setCategoriasList(cs); })
      .catch(() => { /* defaults via repo */ });
    return () => { cancelled = true; };
  }, [proveedores]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Proveedor | null>(null);
  const [gestionCatsOpen, setGestionCatsOpen] = useState(false);
  const [conteoCats, setConteoCats] = useState<Record<string, number>>({});
  const { user } = useSession();

  const [modoVista, setModoVista] = useState<ModoVista>(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'tabla' || saved === 'tarjetas') return saved;
    } catch {
      /* ignore */
    }
    return 'tarjetas';
  });

  function cambiarModoVista(nuevo: ModoVista) {
    setModoVista(nuevo);
    try {
      localStorage.setItem(VIEW_KEY, nuevo);
    } catch {
      /* ignore */
    }
  }

  // Paginación para acotar el scroll vertical masivo
  const [pagina, setPagina] = useState(1);
  const [itemsPorPagina, setItemsPorPagina] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('mgg.proveedores.por_pagina');
      if (saved) return Number(saved) || 24;
    } catch {
      /* ignore */
    }
    return 24;
  });

  useEffect(() => {
    setPagina(1);
  }, [filterText, filterEstado, filterCategorias, filterOrigen, filterUbicacion, filterGps]);

  const kpis = useMemo(() => {
    const total = proveedores.length;
    const activos = proveedores.filter((p) => p.estado === 'activo').length;
    const inactivos = total - activos;
    const conGps = proveedores.filter((p) => ubicacionDe(p) != null).length;
    const nacionales = proveedores.filter((p) => p.origen === 'nacional').length;
    const internacionales = total - nacionales;
    return { total, activos, inactivos, conGps, nacionales, internacionales };
  }, [proveedores]);

  const estadoOptions: SearchOption[] = useMemo(() => [
    { value: '', label: '⚡ Todos los estados' },
    { value: 'activo', label: '✅ Activos', hint: `${kpis.activos} prov.` },
    { value: 'inactivo', label: '⛔ Inactivos', hint: `${kpis.inactivos} prov.` },
  ], [kpis.activos, kpis.inactivos]);

  const origenOptions: SearchOption[] = useMemo(() => [
    { value: '', label: '🌎 Todos los orígenes' },
    { value: 'nacional', label: '🇻🇪 Nacional', hint: `${kpis.nacionales} prov.` },
    { value: 'internacional', label: '🌎 Internacional', hint: `${kpis.internacionales} prov.` },
  ], [kpis.nacionales, kpis.internacionales]);

  const ubicacionOptions: SearchOption[] = useMemo(() => {
    const opts: SearchOption[] = [
      { value: '', label: '📍 Todas las ubicaciones' },
      { value: 'con_gps', label: '🛰️ Con ubicación GPS', hint: `${kpis.conGps} prov.` },
      { value: 'sin_gps', label: '📍 Sin ubicación GPS', hint: `${kpis.total - kpis.conGps} prov.` },
    ];
    const CIUDADES_CONOCIDAS = [
      'Puerto Ordaz', 'Ciudad Guayana', 'Ciudad Bolívar', 'San Félix', 'Upata',
      'Caracas', 'Maturín', 'El Tigre', 'Barcelona', 'Puerto La Cruz',
      'Lechería', 'Valencia', 'Maracay', 'Barquisimeto', 'Maracaibo',
      'Peramanal', 'Guasipati', 'El Callao', 'Tumeremo', 'La Esperanza'
    ];
    CIUDADES_CONOCIDAS.forEach((ciudad) => {
      const q = norm(ciudad);
      const conteo = proveedores.filter((p) => norm(p.direccion ?? '').includes(q)).length;
      if (conteo > 0) {
        opts.push({
          value: `ciudad:${ciudad}`,
          label: `🏙️ ${ciudad}`,
          hint: `${conteo} prov.`,
        });
      }
    });
    return opts;
  }, [proveedores, kpis.conGps, kpis.total]);

  useEffect(() => {
    if (!gestionCatsOpen) return;
    contarProveedoresPorCategoria().then(setConteoCats).catch(() => setConteoCats({}));
  }, [gestionCatsOpen, proveedores]);

  async function refresh() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await listProveedores();
      setProveedores(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error cargando proveedores';
      setErrorMsg(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);
  // En vivo (multiusuario): altas/cambios de proveedores u órdenes se reflejan solos.
  useRealtime(['proveedores', 'ordenes'], () => { void refresh(); });

  // Abrir el detalle de un proveedor desde el buscador global (?detalle=ID).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('detalle');
    if (!id || !proveedores.length) return;
    if (proveedores.some((p) => p.id === id)) {
      setDetailId(id);
      const next = new URLSearchParams(searchParams);
      next.delete('detalle');
      setSearchParams(next, { replace: true });
    }
  }, [proveedores, searchParams, setSearchParams]);

  const filtered = useMemo(() => {
    const q = norm(filterText);
    return proveedores.filter((p) => {
      if (filterEstado && p.estado !== filterEstado) return false;
      if (filterCategorias.length > 0) {
        const provCats = p.categorias ?? [];
        if (!filterCategorias.some((c) => provCats.includes(c))) return false;
      }
      if (filterOrigen && p.origen !== filterOrigen) return false;
      if (filterUbicacion === 'con_gps' && ubicacionDe(p) == null) return false;
      if (filterUbicacion === 'sin_gps' && ubicacionDe(p) != null) return false;
      if (filterUbicacion.startsWith('ciudad:')) {
        const ciudad = filterUbicacion.replace('ciudad:', '');
        if (!norm(p.direccion ?? '').includes(norm(ciudad))) return false;
      }
      if (filterGps && ubicacionDe(p) == null) return false;
      if (q) {
        const hay = [p.razon_social, p.rif, p.contacto, p.email, p.direccion]
          .map((v) => norm(v))
          .some((v) => v.includes(q));
        if (!hay) return false;
      }
      return true;
    });
  }, [proveedores, filterText, filterEstado, filterCategorias, filterOrigen, filterUbicacion, filterGps]);

  const totalPaginas = Math.max(1, Math.ceil(filtered.length / itemsPorPagina));
  const paginaValida = Math.min(pagina, totalPaginas);

  const itemsVisibles = useMemo(() => {
    if (itemsPorPagina >= 99999) return filtered;
    const inicio = (paginaValida - 1) * itemsPorPagina;
    return filtered.slice(inicio, inicio + itemsPorPagina);
  }, [filtered, paginaValida, itemsPorPagina]);

  // Descargar datos de los proveedores visibles en PDF o Excel.
  const [exportarOpen, setExportarOpen] = useState(false);
  const descripcionFiltro = [
    filterText.trim() && `Búsqueda «${filterText.trim()}»`,
    filterEstado && (filterEstado === 'activo' ? 'Activos' : 'Inactivos'),
    filterCategorias.length > 0 && `Categorías: ${filterCategorias.join(', ')}`,
    filterOrigen && (filterOrigen === 'nacional' ? 'Origen Nacional' : 'Origen Internacional'),
    filterUbicacion && (filterUbicacion === 'con_gps' ? 'Con GPS' : filterUbicacion === 'sin_gps' ? 'Sin GPS' : `Ciudad: ${filterUbicacion.replace('ciudad:', '')}`),
    filterGps && 'Con ubicación GPS',
  ].filter(Boolean).join(' · ');

  function openCreate() {
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setFormOpen(true);
  }

  const editing = editingId ? proveedores.find((p) => p.id === editingId) ?? null : null;

  async function handleSubmit(payload: ProveedorInput, ubicacion: PuntoMapa | null) {
    const existing = proveedores.find((p) => p.rif === payload.rif && p.id !== editingId);
    if (existing) {
      toast('Ya existe un proveedor con ese RIF', 'error');
      return;
    }
    // Ubicación en el mapa (03/11/2026): se guarda aparte y solo si cambió; queda para
    // los próximos pedidos de Delivery (ruta y «proveedor más cercano»).
    const conUbicacion = async (prov: Proveedor): Promise<Proveedor> => {
      const antes = ubicacionDe(prov);
      if (antes?.lat === ubicacion?.lat && antes?.lng === ubicacion?.lng) return prov;
      try {
        await guardarUbicacion(prov.id, ubicacion);
        return { ...prov, lat: ubicacion?.lat ?? null, lng: ubicacion?.lng ?? null } as Proveedor;
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar la ubicación', 'warning');
        return prov;
      }
    };
    try {
      if (editingId) {
        const updated = await conUbicacion(await updateProv(editingId, payload));
        setProveedores((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        notify(`Proveedor actualizado: ${updated.razon_social}`, 'success', { link: '#/app/proveedores' });
      } else {
        const created = await conUbicacion(await insertProv(payload));
        setProveedores((prev) => [...prev, created].sort((a, b) => a.razon_social.localeCompare(b.razon_social)));
        notify(`Proveedor creado: ${created.razon_social}`, 'success', { link: '#/app/proveedores' });
      }
      setFormOpen(false);
      setEditingId(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo guardar', 'error');
    }
  }

  async function handleToggle(p: Proveedor) {
    const nextEstado: EstadoGenerico = p.estado === 'activo' ? 'inactivo' : 'activo';
    try {
      const updated = await toggleEstado(p.id, nextEstado);
      setProveedores((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      notify(
        nextEstado === 'activo' ? `Proveedor activado: ${p.razon_social}` : `Proveedor desactivado: ${p.razon_social}`,
        'success',
        { link: '#/app/proveedores' },
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo actualizar', 'error');
    } finally {
      setToggleTarget(null);
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.25rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Proveedores</h1>
          <p className="muted hint" style={{ margin: '.25rem 0 0' }}>
            Base de proveedores que participan en órdenes y licitaciones.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost"
            disabled={filtered.length === 0}
            onClick={() => setExportarOpen(true)}
            title="Descargar en Excel o PDF los datos que elijas (con el filtro aplicado)"
          >
            ⬇ Descargar datos
          </button>
          {canWrite && (
            <button className="btn btn-ghost" onClick={() => setGestionCatsOpen(true)} title="Gestionar y renombrar categorías">
              ⚙ Categorías
            </button>
          )}
          {canWrite && (
            <button className="btn btn-primary" onClick={openCreate}>
              + Nuevo proveedor
            </button>
          )}
        </div>
      </div>

      {/* Barra de métricas resumen (KPIs) con filtrado rápido */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '.75rem',
          marginBottom: '1.1rem',
        }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setFilterEstado('');
            setFilterGps(false);
            setFilterOrigen('');
            setFilterUbicacion('');
            setFilterCategorias([]);
            setFilterText('');
          }}
          className="card"
          style={{
            padding: '.75rem 1rem',
            background: filterEstado === '' && !filterGps && !filterOrigen && !filterUbicacion && filterCategorias.length === 0 && !filterText ? 'var(--surface-3)' : 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid var(--border-strong)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          title="Ver todos los proveedores (limpiar todos los filtros)"
        >
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', fontWeight: 700 }}>Total Proveedores</div>
          <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)' }}>{kpis.total}</div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => setFilterEstado(filterEstado === 'activo' ? '' : 'activo')}
          className="card"
          style={{
            padding: '.75rem 1rem',
            background: filterEstado === 'activo' ? 'rgba(41, 192, 129, 0.12)' : 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid var(--success)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          title="Filtrar por proveedores activos"
        >
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', fontWeight: 700 }}>Activos</div>
          <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--success)' }}>{kpis.activos}</div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => setFilterEstado(filterEstado === 'inactivo' ? '' : 'inactivo')}
          className="card"
          style={{
            padding: '.75rem 1rem',
            background: filterEstado === 'inactivo' ? 'rgba(239, 79, 94, 0.12)' : 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid var(--danger)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          title="Filtrar por proveedores inactivos"
        >
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', fontWeight: 700 }}>Inactivos</div>
          <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--danger)' }}>{kpis.inactivos}</div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => setFilterGps((prev) => !prev)}
          className="card"
          style={{
            padding: '.75rem 1rem',
            background: filterGps ? 'rgba(255, 138, 0, 0.16)' : 'var(--surface-2)',
            border: filterGps ? '1px solid var(--primary)' : '1px solid var(--border)',
            borderLeft: '4px solid var(--primary)',
            boxShadow: filterGps ? '0 0 0 1px var(--primary)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          title={filterGps ? 'Quitar filtro de ubicación GPS' : 'Filtrar por proveedores con ubicación GPS'}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.4rem' }}>
            <span className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', fontWeight: 700 }}>Con Ubicación GPS</span>
            {filterGps && (
              <span className="badge primary" style={{ fontSize: '.62rem', padding: '1px 6px', fontWeight: 700 }}>✓ Activo</span>
            )}
          </div>
          <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary)' }}>{kpis.conGps}</div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '.6rem',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <input
          className="input"
          style={{ minWidth: 240, flex: '1 1 240px', maxWidth: 340 }}
          placeholder="Buscar por razón social, RIF, contacto, dirección…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />

        {/* Buscador de Estado con lista */}
        <SearchSelect
          style={{ width: 160 }}
          options={estadoOptions}
          value={filterEstado}
          onChange={(v) => setFilterEstado(v as EstadoFilter)}
          placeholder="⚡ Estado…"
        />

        {/* Buscador de Origen (Nacional / Internacional) */}
        <SearchSelect
          style={{ width: 175 }}
          options={origenOptions}
          value={filterOrigen}
          onChange={setFilterOrigen}
          placeholder="🌎 Origen…"
        />

        {/* Buscador de Ubicación (Con GPS, Sin GPS, Ciudades detectadas) */}
        <SearchSelect
          style={{ width: 195 }}
          options={ubicacionOptions}
          value={filterUbicacion}
          onChange={setFilterUbicacion}
          placeholder="📍 Ubicación…"
        />

        {/* Buscador de Categorías con multi-selección interactiva */}
        <CategoriaMultiDropdown
          options={categoriasList}
          selected={filterCategorias}
          onChange={setFilterCategorias}
          proveedores={proveedores}
        />

        <div className="view-toggle" role="tablist" aria-label="Modo de vista" style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className={modoVista === 'tarjetas' ? 'active' : ''}
            onClick={() => cambiarModoVista('tarjetas')}
            title="Vista por tarjetas"
          >
            🗂️ Tarjetas
          </button>
          <button
            type="button"
            className={modoVista === 'tabla' ? 'active' : ''}
            onClick={() => cambiarModoVista('tabla')}
            title="Vista por filas (tabla)"
          >
            ☰ Filas
          </button>
        </div>
      </div>

      {(filterCategorias.length > 0 || filterOrigen || filterUbicacion || filterGps || filterEstado || filterText) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '.45rem .75rem', background: 'var(--surface-2)', borderRadius: 'var(--r-md, 8px)', border: '1px solid var(--border)' }}>
          <span className="muted" style={{ fontSize: '.75rem', fontWeight: 700 }}>Filtros activos:</span>
          {filterText.trim() && (
            <span
              className="badge"
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}
              onClick={() => setFilterText('')}
              title="Quitar búsqueda de texto"
            >
              🔍 «{filterText.trim()}» ✕
            </span>
          )}
          {filterEstado && (
            <span
              className="badge"
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}
              onClick={() => setFilterEstado('')}
              title="Quitar filtro de estado"
            >
              {filterEstado === 'activo' ? '✅ Activos' : '⛔ Inactivos'} ✕
            </span>
          )}
          {filterOrigen && (
            <span
              className="badge"
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}
              onClick={() => setFilterOrigen('')}
              title="Quitar filtro de origen"
            >
              {filterOrigen === 'nacional' ? '🇻🇪 Nacional' : '🌎 Internacional'} ✕
            </span>
          )}
          {filterUbicacion && (
            <span
              className="badge"
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}
              onClick={() => setFilterUbicacion('')}
              title="Quitar filtro de ubicación"
            >
              {filterUbicacion === 'con_gps' ? '🛰️ Con GPS' : filterUbicacion === 'sin_gps' ? '📍 Sin GPS' : `🏙️ ${filterUbicacion.replace('ciudad:', '')}`} ✕
            </span>
          )}
          {filterGps && filterUbicacion !== 'con_gps' && (
            <span
              className="badge primary"
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}
              onClick={() => setFilterGps(false)}
              title="Quitar filtro de GPS"
            >
              📍 Con GPS ✕
            </span>
          )}
          {filterCategorias.map((c) => (
            <span
              key={c}
              className="badge primary"
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontWeight: 600 }}
              onClick={() => setFilterCategorias((prev) => prev.filter((x) => x !== c))}
              title="Quitar esta categoría"
            >
              🏷️ {c} ✕
            </span>
          ))}
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            style={{ fontSize: '.72rem', color: 'var(--primary)', fontWeight: 600, marginLeft: 'auto' }}
            onClick={() => {
              setFilterEstado('');
              setFilterOrigen('');
              setFilterUbicacion('');
              setFilterGps(false);
              setFilterCategorias([]);
              setFilterText('');
            }}
          >
            Limpiar todos los filtros
          </button>
        </div>
      )}

      {loading ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Cargando proveedores…</p>
        </div>
      ) : errorMsg ? (
        <div className="card">
          <EmptyState message={errorMsg} icon="!" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState message="Sin proveedores que coincidan." icon="⚒" />
        </div>
      ) : (
        <>
          {modoVista === 'tarjetas' ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '1rem',
              }}
            >
              {itemsVisibles.map((p) => {
                const uLoc = ubicacionDe(p);
                const tieneGps = Boolean(uLoc);
                const esInactivo = p.estado !== 'activo';
                const iniciales = (p.razon_social || 'PR')
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join('')
                  .toUpperCase();

                return (
                  <div
                    key={p.id}
                    className="card prov-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetailId(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetailId(p.id);
                      }
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      padding: '1.1rem 1.15rem',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderLeft: `4px solid ${esInactivo ? 'var(--danger, #ef4444)' : 'var(--primary, #ff8a00)'}`,
                      borderRadius: 'var(--r-lg)',
                      boxShadow: 'var(--shadow-sm)',
                      opacity: esInactivo ? 0.82 : 1,
                      gap: '.75rem',
                    }}
                  >
                    <div>
                      {/* Cabecera con avatar monograma, RIF y badges */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.65rem', marginBottom: '.45rem' }}>
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: '10px',
                            background: esInactivo ? 'var(--surface-3)' : 'linear-gradient(135deg, rgba(255,138,0,0.22), rgba(255,138,0,0.06))',
                            border: `1.5px solid ${esInactivo ? 'var(--border)' : 'var(--primary)'}`,
                            color: esInactivo ? 'var(--text-muted)' : 'var(--primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: '.85rem',
                            flexShrink: 0,
                          }}
                        >
                          {iniciales}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.3rem', marginBottom: '.2rem' }}>
                            <span className="badge mono" style={{ fontSize: '.72rem', fontWeight: 700, padding: '.15rem .45rem' }}>
                              {p.rif}
                            </span>
                            <StatusBadge estado={p.estado} />
                          </div>

                          <div
                            style={{
                              fontSize: '.98rem',
                              fontWeight: 700,
                              color: 'var(--text)',
                              lineHeight: 1.3,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                            }}
                            title={p.razon_social}
                          >
                            {p.razon_social}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Datos de contacto y ubicación */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.82rem', color: 'var(--text-muted)' }}>
                      {p.contacto && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                          <span style={{ fontSize: '.85rem' }}>👤</span>
                          <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.contacto}</span>
                        </div>
                      )}

                      {p.telefono && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                          <span style={{ fontSize: '.85rem' }}>📞</span>
                          <a
                            href={`tel:${p.telefono}`}
                            onClick={(e) => e.stopPropagation()}
                            className="mono"
                            style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}
                            title="Llamar proveedor"
                          >
                            {p.telefono}
                          </a>
                        </div>
                      )}

                      {p.email && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', minWidth: 0 }}>
                          <span style={{ fontSize: '.85rem' }}>✉️</span>
                          <a
                            href={`mailto:${p.email}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              color: 'var(--text-muted)',
                              textDecoration: 'none',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={p.email}
                          >
                            {p.email}
                          </a>
                        </div>
                      )}

                      {(p.direccion || tieneGps) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '.85rem' }}>📍</span>
                          {p.direccion && (
                            <span
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 1,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                lineHeight: 1.35,
                                fontSize: '.78rem',
                                flex: 1,
                                minWidth: 100,
                              }}
                              title={p.direccion}
                            >
                              {p.direccion}
                            </span>
                          )}
                          {uLoc && (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${uLoc.lat},${uLoc.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="badge primary"
                              style={{
                                fontSize: '.68rem',
                                padding: '.15rem .5rem',
                                flexShrink: 0,
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '.25rem',
                                cursor: 'pointer',
                                borderRadius: '999px',
                                fontWeight: 700,
                              }}
                              title="Abrir ubicación en Google Maps (opcional)"
                            >
                              📍 Maps ↗
                            </a>
                          )}
                        </div>
                      )}

                      <div style={{ marginTop: '.2rem' }}>
                        <Etiquetas items={p.categorias ?? []} max={2} />
                      </div>
                    </div>

                    {/* Pie de tarjeta con acciones */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingTop: '.6rem',
                        borderTop: '1px solid var(--border)',
                        marginTop: 'auto',
                        gap: '.4rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '.8rem',
                          fontWeight: 600,
                          color: 'var(--primary)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '.25rem',
                        }}
                      >
                        Ver expediente →
                      </span>

                      <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
                        {uLoc && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${uLoc.lat},${uLoc.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="btn btn-xs btn-ghost"
                            style={{
                              color: 'var(--primary)',
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '.2rem',
                              fontWeight: 600,
                            }}
                            title="Abrir en Google Maps (opcional)"
                          >
                            📍 Maps ↗
                          </a>
                        )}
                        {canWrite && (
                          <>
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(p.id);
                            }}
                            title="Editar datos del proveedor"
                          >
                            ✏️ Editar
                          </button>
                          <button
                            type="button"
                            className={`btn btn-xs ${p.estado === 'activo' ? 'btn-danger' : 'btn-success'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setToggleTarget(p);
                            }}
                          >
                            {p.estado === 'activo' ? 'Desactivar' : 'Activar'}
                          </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>RIF</th>
                    <th>Razón social</th>
                    <th>Teléfono</th>
                    <th>Categorías</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {itemsVisibles.map((p) => {
                    const uLoc = ubicacionDe(p);
                    return (
                    <tr
                      key={p.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setDetailId(p.id)}
                      title="Ver expediente del proveedor"
                    >
                      <td className="mono">{p.rif}</td>
                      <td>
                        <div>
                          <strong>{p.razon_social}</strong>
                        </div>
                        {p.email && (
                          <div className="muted" style={{ fontSize: '.78rem' }}>
                            {p.email}
                          </div>
                        )}
                        {uLoc && (
                          <div style={{ marginTop: '.15rem' }}>
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${uLoc.lat},${uLoc.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                fontSize: '.72rem',
                                color: 'var(--primary)',
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '.2rem',
                                fontWeight: 600,
                              }}
                              title="Abrir ubicación en Google Maps (opcional)"
                            >
                              📍 Maps ↗
                            </a>
                          </div>
                        )}
                      </td>
                      <td className="mono">{p.telefono || '—'}</td>
                      <td>
                        <Etiquetas items={p.categorias ?? []} max={3} />
                      </td>
                      <td>
                        <StatusBadge estado={p.estado} />
                      </td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        {uLoc && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${uLoc.lat},${uLoc.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-sm btn-ghost"
                            style={{ textDecoration: 'none', color: 'var(--primary)', fontWeight: 600 }}
                            title="Abrir ubicación en Google Maps"
                          >
                            📍 Maps
                          </a>
                        )}
                        <button className="btn btn-sm btn-ghost" onClick={() => setDetailId(p.id)}>
                          Ver
                        </button>
                        {canWrite && (
                          <>
                            <button className="btn btn-sm btn-ghost" onClick={() => openEdit(p.id)}>
                              Editar
                            </button>
                            <button
                              className={`btn btn-sm ${p.estado === 'activo' ? 'btn-danger' : 'btn-success'}`}
                              onClick={() => setToggleTarget(p)}
                            >
                              {p.estado === 'activo' ? 'Desactivar' : 'Activar'}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Barra de paginación para limitar el scroll vertical */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              marginTop: '1.25rem',
              padding: '.75rem 1rem',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              flexWrap: 'wrap',
            }}
          >
            <div className="muted" style={{ fontSize: '.84rem' }}>
              Mostrando <strong>{filtered.length === 0 ? 0 : (paginaValida - 1) * itemsPorPagina + 1}</strong>–<strong>{Math.min(paginaValida * itemsPorPagina, filtered.length)}</strong> de <strong>{filtered.length}</strong> proveedores
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={paginaValida <= 1}
                onClick={() => {
                  setPagina((p) => Math.max(1, p - 1));
                  window.scrollTo({ top: 120, behavior: 'smooth' });
                }}
              >
                ◀ Anterior
              </button>

              <span style={{ fontSize: '.84rem', fontWeight: 600, padding: '0 .5rem' }}>
                Página {paginaValida} de {totalPaginas}
              </span>

              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={paginaValida >= totalPaginas}
                onClick={() => {
                  setPagina((p) => Math.min(totalPaginas, p + 1));
                  window.scrollTo({ top: 120, behavior: 'smooth' });
                }}
              >
                Siguiente ▶
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem' }}>
              <span className="muted" style={{ fontSize: '.8rem' }}>Por página:</span>
              <select
                className="select"
                style={{ padding: '.25rem .5rem', fontSize: '.82rem', width: 'auto' }}
                value={itemsPorPagina}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setItemsPorPagina(val);
                  setPagina(1);
                  try { localStorage.setItem('mgg.proveedores.por_pagina', String(val)); } catch {}
                }}
              >
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={48}>48</option>
                <option value={99999}>Todos</option>
              </select>
            </div>
          </div>
        </>
      )}

      {formOpen && (
        <ProveedorFormModal
          initial={editing ?? null}
          isEdit={Boolean(editingId)}
          proveedores={proveedores}
          onCancel={() => {
            setFormOpen(false);
            setEditingId(null);
          }}
          onSubmit={handleSubmit}
        />
      )}

      {detailId && (
        <ProveedorDetailModal
          proveedor={proveedores.find((p) => p.id === detailId) ?? null}
          onClose={() => setDetailId(null)}
          onEdit={(id) => {
            setDetailId(null);
            openEdit(id);
          }}
          canWrite={canWrite}
        />
      )}

      {toggleTarget && (
        <ConfirmDialog
          title={toggleTarget.estado === 'activo' ? 'Desactivar proveedor' : 'Activar proveedor'}
          message={`¿Deseas ${toggleTarget.estado === 'activo' ? 'desactivar' : 'activar'} "${toggleTarget.razon_social}"?`}
          confirmText={toggleTarget.estado === 'activo' ? 'Desactivar' : 'Activar'}
          danger={toggleTarget.estado === 'activo'}
          onConfirm={() => void handleToggle(toggleTarget)}
          onCancel={() => setToggleTarget(null)}
        />
      )}

      {exportarOpen && (
        <ExportarProveedoresModal
          proveedores={filtered}
          total={proveedores.length}
          filtro={descripcionFiltro}
          onClose={() => setExportarOpen(false)}
        />
      )}

      {gestionCatsOpen && (
        <GestionarCategoriasModal
          titulo="Categorías de proveedores"
          categorias={categoriasList}
          conteoUso={conteoCats}
          entidadLabel="proveedor"
          onRenombrar={(o, n) => renombrarCategoria(o, n, user?.email ?? undefined)}
          onEliminar={(n) => eliminarCategoria(n)}
          onAgregar={(n) => addCategoria(n, user?.email ?? undefined)}
          onCambioAplicado={async () => {
            await refresh();
            const cs = await getCategorias(proveedores);
            setCategoriasList(cs);
            const c = await contarProveedoresPorCategoria();
            setConteoCats(c);
          }}
          onClose={() => setGestionCatsOpen(false)}
        />
      )}
    </div>
  );
}

/* ============================================================
   Modal: formulario crear/editar
   ============================================================ */
interface FormModalProps {
  initial: Proveedor | null;
  isEdit: boolean;
  proveedores: Proveedor[];
  onCancel: () => void;
  onSubmit: (payload: ProveedorInput, ubicacion: PuntoMapa | null) => void | Promise<void>;
}

function ProveedorFormModal({ initial, isEdit, proveedores, onCancel, onSubmit }: FormModalProps) {
  const [ubicacion, setUbicacion] = useState<PuntoMapa | null>(() => ubicacionDe(initial));
  const [form, setForm] = useState<ProveedorInput>(() => {
    if (!initial) return { ...EMPTY_FORM };
    return {
      rif: initial.rif,
      razon_social: initial.razon_social,
      contacto: initial.contacto ?? null,
      telefono: initial.telefono ?? '',
      email: initial.email ?? '',
      direccion: initial.direccion ?? '',
      categorias: [...(initial.categorias ?? [])],
      origen: initial.origen ?? 'nacional',
      estado: initial.estado,
      actividad_economica: initial.actividad_economica ?? null,
      numero_administracion: initial.numero_administracion ?? null,
    };
  });
  const [categorias, setCategorias] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    getCategorias(proveedores)
      .then((cs) => { if (!cancelled) setCategorias(cs); })
      .catch(() => { /* defaults via repo */ });
    return () => { cancelled = true; };
  }, [proveedores]);

  function update<K extends keyof ProveedorInput>(key: K, value: ProveedorInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // RIF dividido en letra (combo) + número, derivado del valor guardado.
  const rifPartes = partirRif(form.rif);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const emailClean = form.email?.trim() ?? '';
    if (!emailClean) {
      toast('El correo electrónico es obligatorio', 'error');
      return;
    }
    if (!EMAIL_RX.test(emailClean)) {
      toast('El correo no tiene un formato válido', 'error');
      return;
    }
    const { letra, numero } = partirRif(form.rif);
    const payload: ProveedorInput = {
      ...form,
      rif: numero ? `${letra}-${numero}` : '',
      razon_social: form.razon_social.trim().toUpperCase(),
      contacto: null,
      telefono: form.telefono?.trim() || null,
      email: emailClean,
      direccion: form.direccion?.trim().toUpperCase() || null,
      numero_administracion: (form.numero_administracion ?? '').replace(/\D/g, '') || null,
      actividad_economica: form.actividad_economica?.replace(/\s+/g, ' ').trim() || null,
    };
    if (!numero || !payload.razon_social) {
      toast('RIF (con número) y razón social son obligatorios', 'error');
      return;
    }
    void onSubmit(payload, ubicacion);
  }

  return (
    <Modal
      title={isEdit ? 'Editar proveedor' : 'Nuevo proveedor'}
      size="lg"
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn btn-primary" form="proveedor-form" type="submit">
            {isEdit ? 'Guardar cambios' : 'Crear proveedor'}
          </button>
        </>
      }
    >
      <form id="proveedor-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="form-row">
            <label>RIF</label>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              <select
                className="select"
                value={rifPartes.letra}
                onChange={(e) => update('rif', `${e.target.value}-${rifPartes.numero}`)}
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
                onChange={(e) => update('rif', `${rifPartes.letra}-${e.target.value.replace(/\D/g, '').slice(0, 10)}`)}
                placeholder="40778442"
                inputMode="numeric"
                style={{ flex: 1 }}
                required
              />
            </div>
          </div>
          <div className="form-row">
            <label>Estado</label>
            <select
              className="select"
              value={form.estado}
              onChange={(e) => update('estado', e.target.value as EstadoGenerico)}
            >
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <label>Razón social</label>
          <input
            className="input"
            value={form.razon_social}
            onChange={(e) => update('razon_social', e.target.value.toUpperCase())}
            required
          />
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Teléfono</label>
            <input
              className="input"
              inputMode="numeric"
              value={form.telefono ?? ''}
              onChange={(e) => update('telefono', onlyDigits(e.target.value, 15))}
              maxLength={15}
              placeholder="Solo dígitos"
            />
          </div>
          <div className="form-row">
            <label>Correo *</label>
            <input
              className="input"
              type="email"
              value={form.email ?? ''}
              onChange={(e) => update('email', e.target.value)}
              placeholder="correo@dominio.com"
              required
            />
          </div>
        </div>

        <div className="form-row">
          <label>Dirección</label>
          <input
            className="input"
            value={form.direccion ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              update('direccion', val.toUpperCase());
              const coords = parsearCoordenadas(val);
              if (coords) {
                setUbicacion(coords);
              }
            }}
            placeholder="Dirección física, coordenadas o enlace de mapa"
          />
        </div>

        <div className="form-row">
          <label>📍 Ubicación en el mapa <span className="muted" style={{ fontWeight: 400 }}>(coordenadas y geolocalización)</span></label>
          <SelectorUbicacionMapa value={ubicacion} onChange={setUbicacion} direccion={form.direccion} />
        </div>

        <div className="form-row">
          <label>Origen</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
            {([
              { val: 'nacional', txt: '🇻🇪 Nacional' },
              { val: 'internacional', txt: '🌎 Internacional' },
            ] as const).map((o) => {
              const checked = form.origen === o.val;
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
                  <input type="checkbox" checked={checked} onChange={() => update('origen', o.val)} />
                  <span style={{ fontSize: '.82rem' }}>{o.txt}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="form-row">
          <label>Categorías que ofrece</label>
          <SearchMultiSelect
            options={categorias}
            selected={form.categorias}
            onChange={(next: string[]) => setForm((prev) => ({ ...prev, categorias: next }))}
            onCreate={async (name: string) => {
              const added = await addCategoria(name);
              if (added) setCategorias((prev) => (prev.some((c) => c.toLowerCase() === added.toLowerCase()) ? prev : [...prev, added].sort((a, b) => a.localeCompare(b, 'es-VE'))));
              return added;
            }}
            placeholder="🔍 Buscar categoría o crear una nueva…"
            hint="No se permiten repetidas (ni por mayúsculas/minúsculas). Las nuevas quedan disponibles para futuros proveedores."
          />
        </div>

        <div className="form-row">
          <label htmlFor="prov-numero-adm">Número de administración del proveedor (teléfono)</label>
          <input id="prov-numero-adm" className="input mono" style={{ maxWidth: 280 }} value={form.numero_administracion ?? ''} type="tel" inputMode="numeric"
            onChange={(e) => update('numero_administracion', e.target.value.replace(/\D/g, '').slice(0, 15))} maxLength={15}
            placeholder="Se pide la primera vez al indicar el método de pago" />
        </div>
      </form>
    </Modal>
  );
}

/* ============================================================
   Modal: detalle + histórico de órdenes
   ============================================================ */
interface DetailModalProps {
  proveedor: Proveedor | null;
  onClose: () => void;
  onEdit?: (id: string) => void;
  canWrite?: boolean;
}

function ProveedorDetailModal({ proveedor, onClose, onEdit, canWrite }: DetailModalProps) {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabDetalle, setTabDetalle] = useState<'ficha' | 'ordenes'>('ficha');

  useEffect(() => {
    if (!proveedor) return;
    let alive = true;
    setLoading(true);
    setError(null);
    getOrdenesByProveedor(proveedor.id)
      .then((data) => {
        if (alive) setOrdenes(data);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Error cargando órdenes');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [proveedor]);

  if (!proveedor) return null;

  const recibidas = ordenes.filter((o) => o.estado === 'recibida');
  const totalNegocios = ordenes.reduce((acc, o) => acc + (o.total ?? 0), 0);
  const totalRecibido = recibidas.reduce((acc, o) => acc + (o.total ?? 0), 0);
  const u = ubicacionDe(proveedor);

  const iniciales = (proveedor.razon_social || 'PR')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <Modal
      title=""
      size="lg"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ display: 'flex', gap: '.4rem' }}>
            {canWrite && onEdit && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => onEdit(proveedor.id)}
              >
                ✏️ Editar proveedor
              </button>
            )}
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
      }
    >
      {/* ─── Hero Banner del Proveedor ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '1rem',
          paddingBottom: '1.25rem',
          borderBottom: '1px solid var(--border)',
          marginBottom: '1.25rem',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: '14px',
            background: 'linear-gradient(135deg, rgba(255,138,0,0.25), rgba(255,138,0,0.06))',
            border: '2px solid var(--primary)',
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '1.35rem',
            flexShrink: 0,
            boxShadow: '0 4px 12px rgba(255,138,0,0.15)',
          }}
        >
          {iniciales}
        </div>

        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.35rem' }}>
            <span className="badge mono" style={{ fontSize: '.82rem', fontWeight: 700, padding: '.2rem .55rem' }}>
              {proveedor.rif}
            </span>
            <StatusBadge estado={proveedor.estado} />
            <span className="badge" style={{ fontSize: '.75rem' }}>
              {proveedor.origen === 'internacional' ? '🌎 Internacional' : '🇻🇪 Nacional'}
            </span>
            {proveedor.actividad_economica && (
              <span className="badge" style={{ fontSize: '.75rem' }} title="Código CIIU SENIAT">
                CIIU: {proveedor.actividad_economica}
              </span>
            )}
          </div>

          <h2 style={{ margin: 0, fontSize: '1.28rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.25 }}>
            {proveedor.razon_social}
          </h2>
        </div>

        {/* Acciones directas de contacto */}
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignSelf: 'center' }}>
          {proveedor.telefono && (
            <a
              href={`tel:${proveedor.telefono}`}
              className="btn btn-sm btn-ghost"
              style={{ color: 'var(--primary)', textDecoration: 'none' }}
              title="Llamar al proveedor"
            >
              📞 Llamar
            </a>
          )}
          {proveedor.email && (
            <a
              href={`mailto:${proveedor.email}`}
              className="btn btn-sm btn-ghost"
              style={{ textDecoration: 'none' }}
              title="Enviar correo"
            >
              ✉️ Correo
            </a>
          )}
          {u && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${u.lat},${u.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm btn-ghost"
              style={{ textDecoration: 'none' }}
              title="Ver en Google Maps"
            >
              📍 Maps
            </a>
          )}
        </div>
      </div>

      {/* ─── Franja de 4 KPIs Ejecutivos ─── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '.75rem',
          marginBottom: '1.25rem',
        }}
      >
        <div
          className="card"
          style={{
            padding: '.8rem .95rem',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid var(--primary)',
          }}
        >
          <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', fontWeight: 700 }}>Total Negocios</div>
          <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary)', margin: '.2rem 0 .1rem' }}>
            {money(totalNegocios)}
          </div>
          <div className="muted" style={{ fontSize: '.72rem' }}>Volumen histórico</div>
        </div>

        <div
          className="card"
          style={{
            padding: '.8rem .95rem',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid var(--info)',
          }}
        >
          <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', fontWeight: 700 }}>Órdenes Totales</div>
          <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)', margin: '.2rem 0 .1rem' }}>
            {ordenes.length}
          </div>
          <div className="muted" style={{ fontSize: '.72rem' }}>Órdenes emitidas</div>
        </div>

        <div
          className="card"
          style={{
            padding: '.8rem .95rem',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid var(--success)',
          }}
        >
          <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', fontWeight: 700 }}>Recibidas</div>
          <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--success)', margin: '.2rem 0 .1rem' }}>
            {recibidas.length}
          </div>
          <div className="muted" style={{ fontSize: '.72rem' }}>{money(totalRecibido)}</div>
        </div>

        <div
          className="card"
          style={{
            padding: '.8rem .95rem',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid var(--warning)',
          }}
        >
          <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', fontWeight: 700 }}>Efectividad</div>
          <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--warning)', margin: '.2rem 0 .1rem' }}>
            {ordenes.length ? `${Math.round((recibidas.length / ordenes.length) * 100)} %` : '—'}
          </div>
          <div className="muted" style={{ fontSize: '.72rem' }}>Tasa de entrega</div>
        </div>
      </div>

      {/* ─── Pestañas dentro del Modal ─── */}
      <div className="view-toggle" role="tablist" style={{ marginBottom: '1rem', width: '100%' }}>
        <button
          type="button"
          className={tabDetalle === 'ficha' ? 'active' : ''}
          onClick={() => setTabDetalle('ficha')}
          style={{ flex: 1, justifyContent: 'center' }}
        >
          📋 Ficha y Contacto
        </button>
        <button
          type="button"
          className={tabDetalle === 'ordenes' ? 'active' : ''}
          onClick={() => setTabDetalle('ordenes')}
          style={{ flex: 1, justifyContent: 'center' }}
        >
          🧾 Histórico de Órdenes ({ordenes.length})
        </button>
      </div>

      {tabDetalle === 'ficha' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {/* Tarjeta A: Contacto y Ubicación */}
          <div className="card" style={{ padding: '1rem 1.15rem', background: 'var(--surface-2)' }}>
            <div className="card-title" style={{ marginBottom: '.65rem', color: 'var(--primary)' }}>
              <span>📍 Contacto y Despacho</span>
            </div>
            <div style={{ display: 'grid', gap: '.45rem' }}>
              <DetailRow label="Contacto" value={proveedor.contacto ? <strong>{proveedor.contacto}</strong> : <span className="muted">Sin contacto registrado</span>} />
              <DetailRow
                label="Teléfono principal"
                value={
                  proveedor.telefono ? (
                    <a href={`tel:${proveedor.telefono}`} className="mono" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
                      📞 {proveedor.telefono}
                    </a>
                  ) : <span className="muted">—</span>
                }
              />
              <DetailRow
                label="Tlf. Administración"
                value={
                  proveedor.numero_administracion ? (
                    <a href={`tel:${proveedor.numero_administracion}`} className="mono" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                      ☎️ {proveedor.numero_administracion}
                    </a>
                  ) : <span className="muted">—</span>
                }
              />
              <DetailRow
                label="Correo"
                value={
                  proveedor.email ? (
                    <a href={`mailto:${proveedor.email}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
                      ✉️ {proveedor.email}
                    </a>
                  ) : <span className="muted">—</span>
                }
              />
              <DetailRow label="Dirección física" value={proveedor.direccion || <span className="muted">Sin dirección registrada</span>} />
              <DetailRow
                label="Ubicación GPS"
                value={
                  u ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${u.lat},${u.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mono"
                      style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}
                    >
                      📍 {coordsTxt(u)} (Abrir en Maps)
                    </a>
                  ) : (
                    <span className="muted" style={{ fontSize: '.8rem' }}>Sin marcar (se define en Editar o vía Delivery)</span>
                  )
                }
              />
            </div>
          </div>

          {/* Tarjeta B: Perfil y Datos Fiscales */}
          <div className="card" style={{ padding: '1rem 1.15rem', background: 'var(--surface-2)' }}>
            <div className="card-title" style={{ marginBottom: '.65rem', color: 'var(--primary)' }}>
              <span>🏢 Perfil y Registro Fiscal</span>
            </div>
            <div style={{ display: 'grid', gap: '.45rem' }}>
              <DetailRow label="RIF" value={<span className="mono" style={{ fontWeight: 700 }}>{proveedor.rif}</span>} />
              <DetailRow label="Origen" value={proveedor.origen === 'internacional' ? '🌎 Internacional' : '🇻🇪 Nacional'} />
              <DetailRow label="Actividad CIIU" value={proveedor.actividad_economica || <span className="muted">Sin especificar</span>} />
              <DetailRow
                label="Categorías"
                value={
                  (proveedor.categorias ?? []).length === 0
                    ? <span className="muted">Sin categorías asignadas</span>
                    : <Etiquetas items={proveedor.categorias ?? []} />
                }
              />
              <DetailRow label="Estado comercial" value={<StatusBadge estado={proveedor.estado} />} />
              <DetailRow label="Fecha de registro" value={date(proveedor.created_at)} />
            </div>
          </div>
        </div>
      ) : (
        <div>
          {loading ? (
            <p className="muted" style={{ margin: '1rem 0', textAlign: 'center' }}>Cargando histórico de órdenes…</p>
          ) : error ? (
            <EmptyState message={error} icon="!" />
          ) : ordenes.length === 0 ? (
            <EmptyState message="Sin órdenes de compra registradas para este proveedor." icon="✉" />
          ) : (
            <div className="table-wrap" style={{ maxHeight: '360px', overflowY: 'auto' }}>
              <table className="table">
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 1 }}>
                  <tr>
                    <th>Código</th>
                    <th>Tipo</th>
                    <th>Fecha</th>
                    <th>Renglones</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'center' }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenes.map((o) => (
                    <tr key={o.id}>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                        {o.oc_codigo || o.codigo}
                      </td>
                      <td>
                        <span style={{ fontSize: '.8rem' }}>
                          {o.tipo === 'servicio' ? '🛠️ Servicio' : '📦 Producto'}
                        </span>
                      </td>
                      <td style={{ fontSize: '.82rem' }}>{date(o.created_at)}</td>
                      <td style={{ fontSize: '.82rem' }}>
                        {o.items?.length ?? 0} {((o.items?.length ?? 0) === 1 ? 'ítem' : 'ítems')}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                        {money(o.total)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <StatusBadge estado={o.estado} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Rubros del proveedor como etiquetas cortas. Con max, el resto va en «+N» (con la lista al pasar el mouse). */
function Etiquetas({ items, max }: { items: string[]; max?: number }) {
  if (!items.length) return <span className="muted">—</span>;
  const visibles = max ? items.slice(0, max) : items;
  const resto = items.length - visibles.length;
  return (
    <span className="tags">
      {visibles.map((c) => <span key={c} className="tag">{c}</span>)}
      {resto > 0 && <span className="tag mas" title={items.slice(visibles.length).join(' · ')}>+{resto}</span>}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 160px) minmax(0, 1fr)',
        gap: '.75rem',
        alignItems: 'center',
        padding: '.4rem 0',
        borderBottom: '1px dashed var(--border)',
      }}
    >
      <div className="muted" style={{ fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}
