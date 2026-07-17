import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
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
import { MultiSelectBuscador } from '@/shared/ui/MultiSelectBuscador';
import { mismaTaxonomia } from '@/shared/lib/taxonomias';
import { useSession } from '@/modules/auth/authStore';

type EstadoFilter = '' | EstadoGenerico;
type CategoriaFilter = string;

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
};

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const onlyDigits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

export function ProveedoresPage() {
  const canWrite = usePermissions().can('proveedores', 'escritura');
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [filterText, setFilterText] = useState('');
  const [filterEstado, setFilterEstado] = useState<EstadoFilter>('');
  const [filterCategoria, setFilterCategoria] = useState<CategoriaFilter>('');
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
  // Realtime: proveedores + sus datos de pago, ofertas y evaluaciones de recepción
  // (el score se recalcula con compras/recepciones nuevas).
  useRealtime(['proveedores', 'proveedor_datos_pago', 'ofertas_proveedor', 'evaluaciones_recepcion', 'ordenes'], () => { void refresh(); });

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
    const q = filterText.trim().toLowerCase();
    return proveedores.filter((p) => {
      if (filterEstado && p.estado !== filterEstado) return false;
      if (filterCategoria && !(p.categorias ?? []).includes(filterCategoria)) return false;
      if (q) {
        const hay = [p.razon_social, p.rif, p.contacto, p.email]
          .map((v) => (v ?? '').toLowerCase())
          .some((v) => v.includes(q));
        if (!hay) return false;
      }
      return true;
    });
  }, [proveedores, filterText, filterEstado, filterCategoria]);

  function openCreate() {
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setFormOpen(true);
  }

  const editing = editingId ? proveedores.find((p) => p.id === editingId) ?? null : null;

  async function handleSubmit(payload: ProveedorInput) {
    const existing = proveedores.find((p) => p.rif === payload.rif && p.id !== editingId);
    if (existing) {
      toast('Ya existe un proveedor con ese RIF', 'error');
      return;
    }
    try {
      if (editingId) {
        const updated = await updateProv(editingId, payload);
        setProveedores((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        notify(`Proveedor actualizado: ${updated.razon_social}`, 'success', { link: '#/app/proveedores' });
      } else {
        const created = await insertProv(payload);
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
          <p className="hint muted" style={{ margin: '.25rem 0 0' }}>
            Base de proveedores que participan en órdenes y licitaciones.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
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
          style={{ maxWidth: 360 }}
          placeholder="Buscar por razón social, RIF, contacto, email…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        <select
          className="select"
          style={{ maxWidth: 180 }}
          value={filterEstado}
          onChange={(e) => setFilterEstado(e.target.value as EstadoFilter)}
        >
          <option value="">Todos los estados</option>
          <option value="activo">Activos</option>
          <option value="inactivo">Inactivos</option>
        </select>
        <select
          className="select"
          style={{ maxWidth: 220 }}
          value={filterCategoria}
          onChange={(e) => setFilterCategoria(e.target.value as CategoriaFilter)}
        >
          <option value="">Todas las categorías</option>
          {categoriasList.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="card">
          <p className="hint muted" style={{ margin: 0 }}>Cargando proveedores…</p>
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
              {filtered.map((p) => (
                <tr key={p.id}>
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
                  </td>
                  <td className="mono">{p.telefono || '—'}</td>
                  <td>
                    {(p.categorias ?? []).map((c) => (
                      <span key={c} className="badge" style={{ marginRight: '.2rem' }}>
                        {c}
                      </span>
                    ))}
                  </td>
                  <td>
                    <StatusBadge estado={p.estado} />
                  </td>
                  <td className="actions">
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
              ))}
            </tbody>
          </table>
        </div>
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
  onSubmit: (payload: ProveedorInput) => void | Promise<void>;
}

function ProveedorFormModal({ initial, isEdit, proveedores, onCancel, onSubmit }: FormModalProps) {
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
    };
  });
  const [categorias, setCategorias] = useState<string[]>([]);
  const [nuevaCat, setNuevaCat] = useState('');
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

  function toggleCategoria(cat: string, checked: boolean) {
    setForm((prev) => {
      const set = new Set(prev.categorias);
      if (checked) set.add(cat);
      else set.delete(cat);
      return { ...prev, categorias: Array.from(set) };
    });
  }

  async function handleAddCategoria() {
    const clean = nuevaCat.trim();
    if (!clean) {
      toast('Escribe un nombre para la categoría', 'error');
      return;
    }
    // No permitir la misma categoría dos veces (ignora mayúsculas/minúsculas).
    const existente = categorias.find((c) => mismaTaxonomia(c, clean));
    if (existente) {
      setForm((prev) =>
        prev.categorias.includes(existente) ? prev : { ...prev, categorias: [...prev.categorias, existente] },
      );
      setNuevaCat('');
      toast(`La categoría "${existente}" ya existe — se marcó`, 'warning');
      return;
    }
    try {
      const added = await addCategoria(clean);
      if (!added) {
        toast('No se pudo añadir la categoría', 'error');
        return;
      }
      setCategorias((prev) => (prev.includes(added) ? prev : [...prev, added].sort((a, b) => a.localeCompare(b, 'es'))));
      setForm((prev) =>
        prev.categorias.includes(added) ? prev : { ...prev, categorias: [...prev.categorias, added] },
      );
      setNuevaCat('');
      toast(`Categoría "${added}" añadida`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo añadir la categoría', 'error');
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const emailClean = form.email?.trim() ?? '';
    if (emailClean && !EMAIL_RX.test(emailClean)) {
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
      email: emailClean || null,
      direccion: form.direccion?.trim().toUpperCase() || null,
    };
    if (!numero || !payload.razon_social) {
      toast('RIF (con número) y razón social son obligatorios', 'error');
      return;
    }
    void onSubmit(payload);
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
            <label>Correo</label>
            <input
              className="input"
              type="email"
              value={form.email ?? ''}
              onChange={(e) => update('email', e.target.value)}
              placeholder="correo@dominio.com"
            />
          </div>
        </div>

        <div className="form-row">
          <label>Dirección</label>
          <input
            className="input"
            value={form.direccion ?? ''}
            onChange={(e) => update('direccion', e.target.value.toUpperCase())}
          />
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
          <MultiSelectBuscador
            opciones={categorias}
            seleccionadas={form.categorias}
            onToggle={toggleCategoria}
            placeholder="Buscar categoría…"
          />
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.6rem', alignItems: 'center' }}>
            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Nueva categoría…"
              value={nuevaCat}
              onChange={(e) => setNuevaCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCategoria();
                }
              }}
              maxLength={40}
            />
            <button type="button" className="btn btn-sm btn-ghost" onClick={handleAddCategoria}>
              + Añadir
            </button>
            <span className="muted" style={{ fontSize: '.75rem' }}>
              Queda disponible para futuros proveedores.
            </span>
          </div>
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
}

function ProveedorDetailModal({ proveedor, onClose }: DetailModalProps) {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Modal
      title={proveedor.razon_social}
      size="lg"
      onClose={onClose}
      footer={
        <button className="btn btn-ghost" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <div style={{ display: 'grid', gap: '.5rem', marginBottom: '1.25rem' }}>
        <DetailRow label="RIF" value={<span className="mono">{proveedor.rif}</span>} />
        <DetailRow label="Razón social" value={proveedor.razon_social} />
        <DetailRow label="Teléfono" value={proveedor.telefono || '—'} />
        <DetailRow label="Correo" value={proveedor.email || '—'} />
        <DetailRow label="Dirección" value={proveedor.direccion || '—'} />
        <DetailRow label="Origen" value={proveedor.origen === 'internacional' ? '🌎 Internacional' : '🇻🇪 Nacional'} />
        <DetailRow
          label="Categorías"
          value={
            (proveedor.categorias ?? []).length === 0
              ? '—'
              : (proveedor.categorias ?? []).map((c) => (
                  <span key={c} className="badge" style={{ marginRight: '.2rem' }}>
                    {c}
                  </span>
                ))
          }
        />
        <DetailRow label="Estado" value={<StatusBadge estado={proveedor.estado} />} />
        <DetailRow
          label="Órdenes vinculadas"
          value={`${ordenes.length} · ${money(totalNegocios)} en negocios`}
        />
        <DetailRow
          label="Pedidos recibidos"
          value={
            <span>
              <strong>{recibidas.length}</strong>
              <span className="muted" style={{ marginLeft: '.4rem' }}>
                ({money(recibidas.reduce((a, o) => a + (o.total ?? 0), 0))})
              </span>
            </span>
          }
        />
        <DetailRow label="Registrado" value={date(proveedor.created_at)} />
      </div>

      <h3 className="card-title" style={{ marginBottom: '.5rem' }}>
        Histórico de órdenes
      </h3>
      {loading ? (
        <p className="hint muted" style={{ margin: 0 }}>Cargando histórico…</p>
      ) : error ? (
        <EmptyState message={error} icon="!" />
      ) : ordenes.length === 0 ? (
        <EmptyState message="Sin órdenes registradas para este proveedor." icon="✉" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Fecha</th>
                <th>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {ordenes.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.codigo}</td>
                  <td>{date(o.created_at)}</td>
                  <td>{money(o.total)}</td>
                  <td>
                    <StatusBadge estado={o.estado} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      className="m-stack"
      style={{
        display: 'grid',
        gridTemplateColumns: '140px minmax(0, 1fr)',
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
