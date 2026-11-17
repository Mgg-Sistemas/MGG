/* ============================================================
   Golden Touch · Administración · pestaña «Configuración»
   Reorganizada en acordeón (secciones colapsables) para no abrumar.
   Orden: arriba Empresas y Profesionales; abajo Tasa BCV, Parafiscales,
   Categorías (cerrada por defecto) y Carpetas.
   Lo que el módulo deja configurar de verdad + la referencia que ata todo:
   · Empresas del módulo (conteo + acceso a «Gestionar empresas»).
   · Profesionales de Administración (abogada, contador…): lista PROPIA
     en la base — base del estado de cuenta por profesional (honorarios).
   · Categorías contables de gasto fijo (plan de cuentas PROPIO del módulo).
   · Carpetas organizativas de Documentos y Permisos.
   · Tasa BCV del día en uso (la misma de Tesorería) — referencia.
   · Base legal de los parafiscales FAOV — referencia.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { FAOV_TIERS, type TierFaov } from './administracionParafiscal';
import { SeccionColapsable, estadoInicialSecciones } from './SeccionColapsable';
import {
  GestionarCarpetasModal,
  leerCarpetasPersonalizadas,
  guardarCarpetasPersonalizadas,
} from './GestionarCarpetasModal';
import { CENTROS_ACOPIO_DEFECTO, FASES_OPERATIVAS, ROLES_RESPONSABLES_DEFECTO } from './administracionCentrosResponsables';
import type { AdminCategoria, AdminRepo, CentroAcopio, Empresa, InfoCarpetaDoc, Profesional } from './admin.repository';

const num2 = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fFecha = (s: string | null) => (s ? new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${s}T00:00:00`)) : '—');

// Estado inicial del acordeón: todas abiertas salvo «categorias».
const ESTADO_SECCIONES = estadoInicialSecciones(
  ['empresas', 'centros', 'profesionales', 'tasa', 'parafiscales', 'categorias', 'carpetas'],
  { cerradasPorDefecto: ['categorias'] },
);

export function ConfiguracionTab({
  repo,
  empresas,
  puedeFull = true,
  puedeEscribir = true,
  onGestionarEmpresas,
}: {
  repo: AdminRepo;
  empresas: Empresa[];
  puedeFull?: boolean;
  puedeEscribir?: boolean;
  onGestionarEmpresas?: () => void;
}) {
  const puedeModificar = puedeFull || puedeEscribir;

  // Tasas
  const [tasa, setTasa] = useState<{ usd: number; eur: number; fecha: string | null } | null>(null);
  const [cargandoTasa, setCargandoTasa] = useState(true);

  // Categorías de Gasto
  const [cats, setCats] = useState<AdminCategoria[]>([]);
  const [cargandoCats, setCargandoCats] = useState(true);
  const [nueva, setNueva] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [busquedaCat, setBusquedaCat] = useState('');
  const [filtroCat, setFiltroCat] = useState<'todas' | 'activas' | 'inactivas'>('todas');

  // Centros de acopio (antes estaban escritos a mano en el código; ahora viven en la base)
  const VACIO_CENTRO = { nombre: '', responsablePrincipal: '', fasePredeterminada: '', descripcion: '', empresaClave: '' };
  const [centros, setCentros] = useState<CentroAcopio[]>([]);
  const [cargandoCentros, setCargandoCentros] = useState(true);
  const [cenForm, setCenForm] = useState(VACIO_CENTRO);
  const [cenEditId, setCenEditId] = useState<string | null>(null);
  const [cenOcupado, setCenOcupado] = useState(false);
  const [busquedaCentros, setBusquedaCentros] = useState('');
  const [filtroCentros, setFiltroCentros] = useState<'activos' | 'inactivos' | 'todos'>('activos');
  const [centroBorrar, setCentroBorrar] = useState<CentroAcopio | null>(null);

  // Profesionales (lista propia en la base: abogada, contador…)
  const [profs, setProfs] = useState<Profesional[]>([]);
  const [cargandoProfs, setCargandoProfs] = useState(true);
  const [profForm, setProfForm] = useState<{ nombre: string; profesion: string; contacto: string }>({ nombre: '', profesion: '', contacto: '' });
  const [profEditId, setProfEditId] = useState<string | null>(null);
  const [profOcupado, setProfOcupado] = useState(false);
  const [busquedaProf, setBusquedaProf] = useState('');
  const [filtroProf, setFiltroProf] = useState<'activos' | 'inactivos' | 'todos'>('activos');

  // Factores de la multa FAOV. Son de ley, pero la ley cambia: se guardan en la
  // base para no tener que tocar codigo y desplegar cuando salga otra Gaceta.
  const [faov, setFaov] = useState<TierFaov[]>(FAOV_TIERS);
  const [faovEdit, setFaovEdit] = useState<string[]>(FAOV_TIERS.map((t) => String(t.factor)));
  const [faovOcupado, setFaovOcupado] = useState(false);
  useEffect(() => {
    repo.leerFactoresFaov()
      .then((t) => { setFaov(t); setFaovEdit(t.map((x) => String(x.factor))); })
      .catch(() => { /* sin conexion: quedan los de la Gaceta vigente */ });
  }, [repo]);

  async function guardarFaov() {
    const tiers = faov.map((t, i) => ({ ...t, factor: Number(faovEdit[i].replace(',', '.')) || 0 }));
    setFaovOcupado(true);
    try {
      await repo.guardarFactoresFaov(tiers);
      setFaov(tiers);
      toast('Factores actualizados. La calculadora ya usa los nuevos.', 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron guardar.', 'error'); }
    finally { setFaovOcupado(false); }
  }

  // Carpetas de Documentos
  const [carpetas, setCarpetas] = useState<InfoCarpetaDoc[]>(() => leerCarpetasPersonalizadas(null));
  const [modalCarpetas, setModalCarpetas] = useState(false);

  useEffect(() => {
    let vivo = true;
    getTasaHoy()
      .then((t) => { if (vivo) setTasa({ usd: Number(t?.usd) || 0, eur: Number(t?.eur) || 0, fecha: t?.fecha ?? null }); })
      .catch(() => { if (vivo) setTasa(null); })
      .finally(() => { if (vivo) setCargandoTasa(false); });
    return () => { vivo = false; };
  }, []);

  const cargarCats = useCallback(async () => {
    setCargandoCats(true);
    try { setCats(await repo.listAdminCategorias()); }
    catch { setCats([]); }
    finally { setCargandoCats(false); }
  }, [repo]);

  useEffect(() => { void cargarCats(); }, [cargarCats]);

  const cargarProfs = useCallback(async () => {
    setCargandoProfs(true);
    try { setProfs(await repo.listProfesionales()); }
    catch { setProfs([]); }
    finally { setCargandoProfs(false); }
  }, [repo]);

  useEffect(() => { void cargarProfs(); }, [cargarProfs]);

  const cargarCentros = useCallback(async () => {
    setCargandoCentros(true);
    try { setCentros(await repo.listCentros()); }
    catch { setCentros([]); }
    finally { setCargandoCentros(false); }
  }, [repo]);

  useEffect(() => { void cargarCentros(); }, [cargarCentros]);

  // ─── Centros de acopio: crear / editar / activar ───
  const empresaPorDefecto = empresas.find((e) => e.activa)?.clave || empresas[0]?.clave || '';

  function limpiarCenForm() { setCenForm(VACIO_CENTRO); setCenEditId(null); }

  function editarCentro(c: CentroAcopio) {
    setCenEditId(c.id);
    setCenForm({
      nombre: c.nombre,
      responsablePrincipal: c.responsablePrincipal || '',
      fasePredeterminada: c.fasePredeterminada || '',
      descripcion: c.descripcion || '',
      empresaClave: c.empresaClave,
    });
  }

  async function guardarCentro() {
    const nombre = cenForm.nombre.trim();
    if (!nombre) { toast('Escriba el nombre del centro.', 'warning', { silent: true }); return; }
    const empresaClave = cenForm.empresaClave || empresaPorDefecto;
    if (!empresaClave) { toast('Primero registre una empresa.', 'warning', { silent: true }); return; }
    const repetido = centros.some((c) => c.id !== cenEditId && c.empresaClave === empresaClave && c.nombre.trim().toLowerCase() === nombre.toLowerCase());
    if (repetido) { toast('Esa empresa ya tiene un centro con ese nombre.', 'warning', { silent: true }); return; }

    const datos = {
      empresaClave,
      nombre,
      responsablePrincipal: cenForm.responsablePrincipal.trim() || null,
      fasePredeterminada: cenForm.fasePredeterminada || null,
      descripcion: cenForm.descripcion.trim() || null,
    };
    setCenOcupado(true);
    try {
      if (cenEditId) { await repo.editarCentro(cenEditId, datos); toast('Centro actualizado.', 'success'); }
      else {
        const orden = centros.reduce((m, c) => Math.max(m, c.orden), 0) + 1;
        await repo.crearCentro({ ...datos, orden, activo: true });
        toast('Centro creado.', 'success');
      }
      limpiarCenForm();
      await cargarCentros();
    } catch (e) { toast(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setCenOcupado(false); }
  }

  async function alternarCentro(c: CentroAcopio) {
    setCenOcupado(true);
    try { await repo.setActivoCentro(c.id, !c.activo); await cargarCentros(); }
    catch (e) { toast(`No se pudo cambiar el estado: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setCenOcupado(false); }
  }

  async function borrarCentro(c: CentroAcopio) {
    setCenOcupado(true);
    try {
      await repo.eliminarCentro(c.id);
      toast('Centro de acopio eliminado.', 'success');
      setCentroBorrar(null);
      await cargarCentros();
    } catch (e) {
      toast(`No se pudo eliminar: ${e instanceof Error ? e.message : 'error'}`, 'error');
    } finally {
      setCenOcupado(false);
    }
  }

  const centrosActivos = useMemo(() => centros.filter((c) => c.activo).length, [centros]);
  const centrosFiltrados = useMemo(() => {
    return centros.filter((c) => {
      if (filtroCentros === 'activos' && !c.activo) return false;
      if (filtroCentros === 'inactivos' && c.activo) return false;
      if (busquedaCentros.trim()) {
        const q = busquedaCentros.toLowerCase();
        const m = c.nombre.toLowerCase().includes(q) || (c.descripcion || '').toLowerCase().includes(q) || (c.responsablePrincipal || '').toLowerCase().includes(q);
        if (!m) return false;
      }
      return true;
    });
  }, [centros, filtroCentros, busquedaCentros]);

  /** Atajo para no empezar de cero: crea los 4 centros que el sistema traía escritos. */
  async function cargarCentrosDeSiempre() {
    const empresaClave = empresaPorDefecto;
    if (!empresaClave) { toast('Primero registre una empresa.', 'warning', { silent: true }); return; }
    setCenOcupado(true);
    try {
      let orden = 0;
      for (const c of CENTROS_ACOPIO_DEFECTO) {
        orden += 1;
        await repo.crearCentro({
          empresaClave, nombre: c.nombre, orden, activo: true,
          responsablePrincipal: c.responsablePrincipal || null,
          fasePredeterminada: c.fasePredeterminada || null,
          descripcion: c.descripcion || null,
        });
      }
      toast('Se cargaron los 4 centros.', 'success');
      await cargarCentros();
    } catch (e) { toast(`No se pudieron cargar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setCenOcupado(false); }
  }

  async function agregar() {
    const n = nueva.trim();
    if (!n) { toast('Escriba el nombre de la categoría.', 'warning', { silent: true }); return; }
    if (cats.some((c) => c.nombre.toLowerCase() === n.toLowerCase())) { toast('Ya existe una categoría con ese nombre.', 'warning', { silent: true }); return; }
    setOcupado(true);
    try { await repo.crearAdminCategoria(n); setNueva(''); toast('Categoría agregada.', 'success'); await cargarCats(); }
    catch (e) { toast(`No se pudo agregar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }

  async function guardarNombre() {
    if (!editId) return;
    const n = editNombre.trim();
    if (!n) { toast('El nombre no puede quedar vacío.', 'warning', { silent: true }); return; }
    setOcupado(true);
    try { await repo.renombrarAdminCategoria(editId, n); setEditId(null); setEditNombre(''); toast('Categoría renombrada.', 'success'); await cargarCats(); }
    catch (e) { toast(`No se pudo renombrar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }

  async function alternar(c: AdminCategoria) {
    setOcupado(true);
    try { await repo.setActivaAdminCategoria(c.id, !c.activa); await cargarCats(); }
    catch (e) { toast(`No se pudo cambiar el estado: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }

  // ─── Profesionales: crear / editar / activar ───
  function limpiarProfForm() { setProfForm({ nombre: '', profesion: '', contacto: '' }); setProfEditId(null); }

  function editarProf(p: Profesional) {
    setProfEditId(p.id);
    setProfForm({ nombre: p.nombre, profesion: p.profesion ?? '', contacto: p.contacto ?? '' });
  }

  async function guardarProf() {
    const nombre = profForm.nombre.trim();
    if (!nombre) { toast('Escriba el nombre del profesional.', 'warning', { silent: true }); return; }
    const profesion = profForm.profesion.trim() || null;
    const contacto = profForm.contacto.trim() || null;
    setProfOcupado(true);
    try {
      if (profEditId) {
        await repo.editarProfesional(profEditId, { nombre, profesion, contacto });
        toast('Profesional actualizado.', 'success');
      } else {
        await repo.crearProfesional({ nombre, profesion, contacto, activo: true });
        toast('Profesional agregado.', 'success');
      }
      limpiarProfForm();
      await cargarProfs();
    } catch (e) {
      toast(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`, 'error');
    } finally { setProfOcupado(false); }
  }

  async function alternarProf(p: Profesional) {
    setProfOcupado(true);
    try { await repo.setActivoProfesional(p.id, !p.activo); await cargarProfs(); }
    catch (e) { toast(`No se pudo cambiar el estado: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setProfOcupado(false); }
  }

  // Filtrado de categorías para evitar abrumar la pantalla
  const catsFiltradas = useMemo(() => {
    const q = busquedaCat.trim().toLowerCase();
    return cats.filter((c) => {
      if (filtroCat === 'activas' && !c.activa) return false;
      if (filtroCat === 'inactivas' && c.activa) return false;
      if (q && !c.nombre.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cats, filtroCat, busquedaCat]);

  const totalActivas = useMemo(() => cats.filter((c) => c.activa).length, [cats]);
  const profsActivos = useMemo(() => profs.filter((p) => p.activo).length, [profs]);

  // Filtrado de profesionales para evitar abrumar la pantalla con data inusable si hay muchos inactivos
  const profsFiltrados = useMemo(() => {
    const q = busquedaProf.trim().toLowerCase();
    return profs.filter((p) => {
      if (filtroProf === 'activos' && !p.activo) return false;
      if (filtroProf === 'inactivos' && p.activo) return false;
      if (q) {
        const n = p.nombre.toLowerCase();
        const pr = (p.profesion ?? '').toLowerCase();
        const co = (p.contacto ?? '').toLowerCase();
        if (!n.includes(q) && !pr.includes(q) && !co.includes(q)) return false;
      }
      return true;
    });
  }, [profs, filtroProf, busquedaProf]);

  const activas = empresas.filter((e) => e.activa).length;

  return (
    <div style={{ display: 'grid', gap: '.75rem' }}>
      {/* 1. Empresas gestionadas */}
      <SeccionColapsable
        titulo="🏢 Empresas gestionadas"
        subtitulo={`${empresas.length} empresa(s), ${activas} activa(s)`}
        abiertoPorDefecto={ESTADO_SECCIONES.empresas}
      >
        <p className="muted hint" style={{ marginTop: 0, marginBottom: '.5rem' }}>
          Razones sociales y entidades jurídicas que conforman el grupo. Cada empresa posee su propio expediente independiente de documentos, permisos, centros de acopio y obligaciones fiscales.
        </p>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '.4rem', lineHeight: 1.5 }}>
          <li><b>Empresas registradas</b>: {empresas.length} en total ({activas} activas). Tienen su propia razón social, RIF, moneda operativa y expedientes documentales.</li>
        </ul>
        {puedeFull && onGestionarEmpresas && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '.6rem' }} onClick={onGestionarEmpresas}>⚙ Gestionar empresas</button>
        )}
      </SeccionColapsable>

      {/* 2. Centros de acopio (viven en la base; antes estaban escritos a mano) */}
      <SeccionColapsable
        titulo="🏭 Centros de acopio"
        subtitulo={`${centros.length} centro(s), ${centros.filter((c) => c.activo).length} activo(s)`}
        abiertoPorDefecto={ESTADO_SECCIONES.centros}
      >
        <p className="muted hint" style={{ marginTop: 0 }}>
          Los lugares de la empresa: el patio, la planta, la sede. Cada documento y cada gasto fijo puede colgar de uno,
          y de ahí salen el reporte de Centros y Fases y la cobertura del Tablero.
        </p>

        {puedeFull && (
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', margin: '.75rem 0 .5rem', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '2 1 200px' }}>
              <span className="muted hint" style={{ fontSize: '.7rem' }}>Nombre del centro *</span>
              <input
                className="input input-sm"
                value={cenForm.nombre}
                onChange={(e) => setCenForm((f) => ({ ...f, nombre: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void guardarCentro(); }}
                placeholder="Ej: Planta de Molienda"
                disabled={cenOcupado}
              />
            </label>

            {empresas.length > 1 && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '1 1 150px' }}>
                <span className="muted hint" style={{ fontSize: '.7rem' }}>Empresa</span>
                <select
                  className="select select-sm"
                  value={cenForm.empresaClave || empresaPorDefecto}
                  onChange={(e) => setCenForm((f) => ({ ...f, empresaClave: e.target.value }))}
                  disabled={cenOcupado}
                >
                  {empresas.map((e) => <option key={e.clave} value={e.clave}>{e.nombre}</option>)}
                </select>
              </label>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '1 1 170px' }}>
              <span className="muted hint" style={{ fontSize: '.7rem' }}>Quién responde por él</span>
              <input
                className="input input-sm"
                list="adm-responsables-centro"
                value={cenForm.responsablePrincipal}
                onChange={(e) => setCenForm((f) => ({ ...f, responsablePrincipal: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void guardarCentro(); }}
                placeholder="Elija o escriba…"
                disabled={cenOcupado}
              />
              <datalist id="adm-responsables-centro">
                {ROLES_RESPONSABLES_DEFECTO.map((r) => <option key={r} value={r} />)}
              </datalist>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '1 1 190px' }}>
              <span className="muted hint" style={{ fontSize: '.7rem' }}>En qué fase está</span>
              <select
                className="select select-sm"
                value={cenForm.fasePredeterminada}
                onChange={(e) => setCenForm((f) => ({ ...f, fasePredeterminada: e.target.value }))}
                disabled={cenOcupado}
              >
                <option value="">Sin fase asignada</option>
                {FASES_OPERATIVAS.map((f) => <option key={f.id} value={f.nombre}>{f.nombre}</option>)}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '2 1 220px' }}>
              <span className="muted hint" style={{ fontSize: '.7rem' }}>Qué se hace ahí (opcional)</span>
              <input
                className="input input-sm"
                value={cenForm.descripcion}
                onChange={(e) => setCenForm((f) => ({ ...f, descripcion: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void guardarCentro(); }}
                placeholder="Ej: Trituración y recuperación"
                disabled={cenOcupado}
              />
            </label>

            <div style={{ display: 'inline-flex', gap: '.3rem' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void guardarCentro()}
                disabled={cenOcupado}
                style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }}
              >
                {cenEditId ? 'Guardar' : '+ Agregar centro'}
              </button>
              {cenEditId && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={limpiarCenForm} disabled={cenOcupado}>
                  Cancelar
                </button>
              )}
            </div>
          </div>
        )}

        {cargandoCentros ? (
          <p className="muted" style={{ marginTop: '.4rem' }}>Leyendo centros…</p>
        ) : centros.length === 0 ? (
          <div>
            <EmptyState icon="🏭" message={puedeFull ? 'Todavía no hay centros. Cree el primero arriba.' : 'El módulo no tiene centros cargados.'} />
            {puedeFull && (
              <div style={{ textAlign: 'center', marginTop: '-.5rem' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cargarCentrosDeSiempre()} disabled={cenOcupado}>
                  O cargar los 4 centros de siempre
                </button>
                <p className="muted hint" style={{ fontSize: '.7rem', marginTop: '.15rem' }}>
                  Acopio Principal, Patio Brasilero, Planta de Molienda y Sede Administrativa, con su responsable y su fase. Después puede renombrarlos o desactivarlos.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', margin: '.6rem 0 .5rem', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <div style={{ display: 'inline-flex', gap: '.3rem' }}>
                <button
                  type="button"
                  className={`btn btn-xs ${filtroCentros === 'activos' ? 'btn-primary' : 'btn-ghost'}`}
                  style={filtroCentros === 'activos' ? { background: '#ff8a00', color: '#000', fontWeight: 700 } : undefined}
                  onClick={() => setFiltroCentros('activos')}
                >
                  Solo Activos ({centrosActivos})
                </button>
                <button
                  type="button"
                  className={`btn btn-xs ${filtroCentros === 'inactivos' ? 'btn-primary' : 'btn-ghost'}`}
                  style={filtroCentros === 'inactivos' ? { background: '#ff8a00', color: '#000', fontWeight: 700 } : undefined}
                  onClick={() => setFiltroCentros('inactivos')}
                >
                  Inactivos ({centros.length - centrosActivos})
                </button>
                <button
                  type="button"
                  className={`btn btn-xs ${filtroCentros === 'todos' ? 'btn-primary' : 'btn-ghost'}`}
                  style={filtroCentros === 'todos' ? { background: '#ff8a00', color: '#000', fontWeight: 700 } : undefined}
                  onClick={() => setFiltroCentros('todos')}
                >
                  Todos ({centros.length})
                </button>
              </div>

              <input
                type="search"
                className="input input-sm"
                value={busquedaCentros}
                onChange={(e) => setBusquedaCentros(e.target.value)}
                placeholder="🔍 Buscar centro…"
                style={{ maxWidth: 220, fontSize: '.76rem' }}
              />
            </div>

            {centrosFiltrados.length === 0 ? (
              <p className="muted hint" style={{ margin: '.5rem 0' }}>
                No hay centros que coincidan con el filtro ({filtroCentros === 'activos' ? 'Solo Activos' : filtroCentros === 'inactivos' ? 'Solo Inactivos' : 'Todos'}).
              </p>
            ) : (
              <div className="adm-tabla" style={{ marginTop: '.2rem', maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
                <table>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 2 }}>
                    <tr>
                      <th>Centro</th>
                      <th>Responsable</th>
                      <th>Fase</th>
                      <th>Estado</th>
                      <th style={{ textAlign: 'right' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {centrosFiltrados.map((c) => (
                      <tr key={c.id} className={c.activo ? undefined : 'adm-fila-off'}>
                        <td>
                          <strong style={{ color: 'var(--text)', fontSize: '.84rem' }}>{c.nombre}</strong>
                          {c.descripcion && <div className="muted" style={{ fontSize: '.72rem' }}>{c.descripcion}</div>}
                        </td>
                        <td style={{ fontSize: '.82rem' }}>{c.responsablePrincipal || <span className="muted">Sin asignar</span>}</td>
                        <td style={{ fontSize: '.78rem' }}>{c.fasePredeterminada || <span className="muted">Sin fase</span>}</td>
                        <td><span className={`adm-badge ${c.activo ? 'activo' : 'suspendido'}`}>{c.activo ? 'Activo' : 'Inactivo'}</span></td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {puedeFull ? (
                            <div style={{ display: 'inline-flex', gap: '.3rem' }}>
                              <button type="button" className="btn btn-xs btn-ghost" onClick={() => editarCentro(c)} title="Cambiar nombre, responsable o fase">✏️ Editar</button>
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                onClick={() => void alternarCentro(c)}
                                disabled={cenOcupado}
                                style={{ color: c.activo ? '#f59e0b' : '#10b981' }}
                              >
                                {c.activo ? 'Desactivar' : 'Activar'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                style={{ color: '#ef4444' }}
                                onClick={() => setCentroBorrar(c)}
                                disabled={cenOcupado}
                                title="Eliminar centro definitivamente"
                              >
                                🗑️ Borrar
                              </button>
                            </div>
                          ) : (<span className="muted">—</span>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </SeccionColapsable>

      {/* 3. Profesionales (lista propia en la base) */}
      <SeccionColapsable
        titulo="👤 Profesionales de Administración"
        subtitulo={`${profs.length} profesional(es) (${profsActivos} activos)`}
        abiertoPorDefecto={ESTADO_SECCIONES.profesionales}
      >
        <p className="muted hint" style={{ marginTop: 0 }}>
          La lista propia de profesionales del módulo (abogada, contador, gestor…). Es la base del estado de cuenta por profesional y de los honorarios. Es independiente de los Proveedores del sistema.
        </p>

        {puedeModificar && (
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', margin: '.75rem 0 .5rem', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '2 1 200px' }}>
              <span className="muted hint" style={{ fontSize: '.7rem' }}>Nombre *</span>
              <input
                className="input input-sm"
                value={profForm.nombre}
                onChange={(e) => setProfForm((f) => ({ ...f, nombre: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void guardarProf(); }}
                placeholder="Ej: Abg. Ana Pérez"
                disabled={profOcupado}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '1 1 140px' }}>
              <span className="muted hint" style={{ fontSize: '.7rem' }}>Profesión</span>
              <input
                className="input input-sm"
                value={profForm.profesion}
                onChange={(e) => setProfForm((f) => ({ ...f, profesion: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void guardarProf(); }}
                placeholder="Ej: Abogado"
                disabled={profOcupado}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '1 1 140px' }}>
              <span className="muted hint" style={{ fontSize: '.7rem' }}>Contacto</span>
              <input
                className="input input-sm"
                value={profForm.contacto}
                onChange={(e) => setProfForm((f) => ({ ...f, contacto: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void guardarProf(); }}
                placeholder="Tel / correo"
                disabled={profOcupado}
              />
            </label>
            <div style={{ display: 'inline-flex', gap: '.3rem' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void guardarProf()}
                disabled={profOcupado}
                style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }}
              >
                {profEditId ? 'Guardar' : '+ Agregar'}
              </button>
              {profEditId && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={limpiarProfForm} disabled={profOcupado}>
                  Cancelar
                </button>
              )}
            </div>
          </div>
        )}

        {/* Barra de Búsqueda y Filtros de Profesionales */}
        {profs.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', margin: '.5rem 0 .4rem', flexWrap: 'wrap' }}>
            <input
              type="search"
              className="input input-sm"
              placeholder="🔍 Buscar profesional, profesión o contacto…"
              value={busquedaProf}
              onChange={(e) => setBusquedaProf(e.target.value)}
              style={{ maxWidth: 280, fontSize: '.78rem', padding: '.25rem .5rem' }}
            />
            <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
              <button
                type="button"
                className={`btn btn-xs ${filtroProf === 'activos' ? 'btn-primary' : 'btn-ghost'}`}
                style={filtroProf === 'activos' ? { background: '#ff8a00', color: '#000', fontWeight: 700 } : undefined}
                onClick={() => setFiltroProf('activos')}
              >
                Activos ({profsActivos})
              </button>
              <button
                type="button"
                className={`btn btn-xs ${filtroProf === 'inactivos' ? 'btn-primary' : 'btn-ghost'}`}
                style={filtroProf === 'inactivos' ? { background: '#ff8a00', color: '#000', fontWeight: 700 } : undefined}
                onClick={() => setFiltroProf('inactivos')}
              >
                Inactivos ({profs.length - profsActivos})
              </button>
              <button
                type="button"
                className={`btn btn-xs ${filtroProf === 'todos' ? 'btn-primary' : 'btn-ghost'}`}
                style={filtroProf === 'todos' ? { background: '#ff8a00', color: '#000', fontWeight: 700 } : undefined}
                onClick={() => setFiltroProf('todos')}
              >
                Todos ({profs.length})
              </button>
            </div>
          </div>
        )}

        {cargandoProfs ? (
          <p className="muted" style={{ marginTop: '.4rem' }}>Leyendo profesionales…</p>
        ) : profs.length === 0 ? (
          <EmptyState icon="👤" message={puedeModificar ? 'Sin profesionales todavía. Agregue el primero arriba.' : 'El módulo no tiene profesionales cargados.'} />
        ) : profsFiltrados.length === 0 ? (
          <div style={{ padding: '1rem', textAlign: 'center', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <p className="muted" style={{ margin: '0 0 .5rem', fontSize: '.84rem' }}>
              No hay profesionales que coincidan con el filtro actual ({filtroProf === 'activos' ? 'Solo Activos' : filtroProf === 'inactivos' ? 'Solo Inactivos' : 'Todos'}{busquedaProf ? ` · «${busquedaProf}»` : ''}).
            </p>
            <div style={{ display: 'inline-flex', gap: '.4rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              {filtroProf !== 'todos' && (
                <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setFiltroProf('todos'); setBusquedaProf(''); }}>
                  Mostrar todos ({profs.length})
                </button>
              )}
              {filtroProf !== 'inactivos' && (profs.length - profsActivos) > 0 && (
                <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setFiltroProf('inactivos'); setBusquedaProf(''); }}>
                  Ver inactivos ({profs.length - profsActivos})
                </button>
              )}
              {busquedaProf && (
                <button type="button" className="btn btn-xs btn-ghost" onClick={() => setBusquedaProf('')}>
                  Limpiar búsqueda
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="adm-tabla" style={{ marginTop: '.2rem', maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
            <table>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 2 }}>
                <tr>
                  <th>Profesional</th>
                  <th>Profesión</th>
                  <th>Contacto</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {profsFiltrados.map((p) => (
                  <tr key={p.id} className={p.activo ? undefined : 'adm-fila-off'}>
                    <td><strong style={{ color: 'var(--text)', fontSize: '.84rem' }}>{p.nombre}</strong></td>
                    <td style={{ fontSize: '.82rem' }}>{p.profesion || <span className="muted">—</span>}</td>
                    <td style={{ fontSize: '.82rem' }}>{p.contacto || <span className="muted">—</span>}</td>
                    <td><span className={`adm-badge ${p.activo ? 'activo' : 'suspendido'}`}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {puedeModificar ? (
                        <div style={{ display: 'inline-flex', gap: '.3rem' }}>
                          <button type="button" className="btn btn-xs btn-ghost" onClick={() => editarProf(p)} title="Modificar datos del profesional">✏️ Editar</button>
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost"
                            onClick={() => void alternarProf(p)}
                            disabled={profOcupado}
                            style={{ color: p.activo ? '#f59e0b' : '#10b981' }}
                          >
                            {p.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      ) : (<span className="muted">—</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SeccionColapsable>

      {/* 3. Tasa BCV en uso */}
      <SeccionColapsable
        titulo="💱 Tasa BCV del día"
        subtitulo="La misma tasa de Tesorería (referencia)"
        abiertoPorDefecto={ESTADO_SECCIONES.tasa}
      >
        <p className="muted hint" style={{ marginTop: 0 }}>
          La tasa que usan los equivalentes del tablero, el reporte y la calculadora de parafiscales. Sale de Tesorería (la misma de todo el sistema).
        </p>
        {cargandoTasa ? (
          <p className="muted" style={{ marginTop: '.4rem' }}>Leyendo la tasa…</p>
        ) : tasa && (tasa.usd > 0 || tasa.eur > 0) ? (
          <div className="adm-kpis" style={{ marginTop: '.6rem', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <div className="adm-kpi oro"><span className="adm-kpi-lbl">USD</span><span className="adm-kpi-num">{num2(tasa.usd)}</span><span className="adm-kpi-sub">Bs por dólar</span></div>
            <div className="adm-kpi oro"><span className="adm-kpi-lbl">EUR</span><span className="adm-kpi-num">{num2(tasa.eur)}</span><span className="adm-kpi-sub">Bs por euro</span></div>
            <div className="adm-kpi"><span className="adm-kpi-lbl">Fecha</span><span className="adm-kpi-num" style={{ fontSize: '1.05rem' }}>{fFecha(tasa.fecha)}</span><span className="adm-kpi-sub">última publicada</span></div>
          </div>
        ) : (
          <div className="adm-aviso" style={{ marginTop: '.5rem' }}>No hay tasa cargada (inicie sesión o cárguela en Tesorería). Mientras tanto, los equivalentes usan 40 Bs/USD de respaldo.</div>
        )}
      </SeccionColapsable>

      {/* 4. Parafiscales (FAOV) */}
      <SeccionColapsable
        titulo="⚖ Parafiscales · FAOV / BANAVIH"
        subtitulo="Factores legales de la multa FAOV (referencia)"
        abiertoPorDefecto={ESTADO_SECCIONES.parafiscales}
      >
        <p className="muted hint" style={{ marginTop: 0 }}>
          Base de la calculadora (pestaña Movimientos → «Parafiscal»). Según Gaceta Extra 6.805, art. 98, la multa = <b>factor × la tasa BCV de mayor valor</b>, según el tamaño de la nómina. Los factores los pone la ley: si sale una Gaceta nueva, ajústalos aquí y la calculadora los toma enseguida.
        </p>
        <div className="adm-tabla" style={{ marginTop: '.6rem' }}>
          <table>
            <thead><tr><th>Tamaño de la nómina</th><th style={{ textAlign: 'right' }}>Factor</th></tr></thead>
            <tbody>
              {faov.map((t, i) => (
                <tr key={t.nivel}>
                  <td>{t.label}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {puedeFull ? (
                      <input
                        className="input input-sm mono" type="number" min="1" step="1"
                        value={faovEdit[i] ?? ''} disabled={faovOcupado}
                        onChange={(e) => setFaovEdit((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                        style={{ width: 110, textAlign: 'right' }}
                      />
                    ) : (<span className="adm-chip">{t.factor}</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {puedeFull && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.4rem', marginTop: '.5rem' }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={faovOcupado}
              onClick={() => setFaovEdit(faov.map((t) => String(t.factor)))}>
              Deshacer
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={faovOcupado}
              onClick={() => void guardarFaov()}
              style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }}>
              {faovOcupado ? 'Guardando…' : 'Guardar factores'}
            </button>
          </div>
        )}
        {tasa && (tasa.usd > 0 || tasa.eur > 0) && (
          <p className="muted hint" style={{ marginTop: '.5rem', fontSize: '.78rem' }}>
            Ejemplo hoy ({faov[0].label}): {faov[0].factor} × {num2(Math.max(tasa.usd, tasa.eur))} = <b>Bs {num2(faov[0].factor * Math.max(tasa.usd, tasa.eur))}</b>.
          </p>
        )}
      </SeccionColapsable>

      {/* 5. Categorías del módulo (CERRADA por defecto) */}
      <SeccionColapsable
        titulo="🗂 Categorías de gasto del módulo"
        subtitulo={`${cats.length} categoría(s) (${totalActivas} activas)`}
        abiertoPorDefecto={ESTADO_SECCIONES.categorias}
      >
        <p className="muted hint" style={{ marginTop: 0 }}>
          El plan de cuentas propio de Administración: lo que aparece al clasificar un gasto fijo o un movimiento. Es independiente del catálogo general del sistema.
        </p>

        {/* Input para agregar nueva categoría */}
        {puedeModificar && (
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', margin: '.75rem 0 .5rem' }}>
            <input
              className="input"
              style={{ flex: '1 1 240px', fontSize: '.84rem' }}
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void agregar(); }}
              placeholder="Nueva categoría (p. ej. Seguros, Regalías mineras...)"
              disabled={ocupado}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void agregar()}
              disabled={ocupado}
              style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }}
            >
              + Agregar
            </button>
          </div>
        )}

        {/* Barra de Búsqueda y Filtros de Categorías para no abrumar la pantalla */}
        {cats.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', margin: '.5rem 0 .4rem', flexWrap: 'wrap' }}>
            <input
              type="search"
              className="input input-sm"
              placeholder="🔍 Buscar categoría…"
              value={busquedaCat}
              onChange={(e) => setBusquedaCat(e.target.value)}
              style={{ maxWidth: 240, fontSize: '.78rem', padding: '.25rem .5rem' }}
            />
            <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
              <button type="button" className={`btn btn-xs ${filtroCat === 'todas' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFiltroCat('todas')}>Todas ({cats.length})</button>
              <button type="button" className={`btn btn-xs ${filtroCat === 'activas' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFiltroCat('activas')}>Activas ({totalActivas})</button>
              <button type="button" className={`btn btn-xs ${filtroCat === 'inactivas' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFiltroCat('inactivas')}>Inactivas ({cats.length - totalActivas})</button>
            </div>
          </div>
        )}

        {cargandoCats ? (
          <p className="muted" style={{ marginTop: '.4rem' }}>Leyendo categorías…</p>
        ) : cats.length === 0 ? (
          <EmptyState icon="🗂" message={puedeModificar ? 'Sin categorías todavía. Agregue la primera arriba.' : 'El módulo no tiene categorías cargadas.'} />
        ) : catsFiltradas.length === 0 ? (
          <p className="muted" style={{ padding: '1rem 0', fontSize: '.84rem' }}>No se encontraron categorías con «{busquedaCat}».</p>
        ) : (
          <div className="adm-tabla" style={{ marginTop: '.2rem', maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
            <table>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 2 }}>
                <tr>
                  <th>Categoría</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {catsFiltradas.map((c) => (
                  <tr key={c.id} className={c.activa ? undefined : 'adm-fila-off'}>
                    <td>
                      {editId === c.id ? (
                        <input
                          className="input input-sm"
                          value={editNombre}
                          onChange={(e) => setEditNombre(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void guardarNombre();
                            if (e.key === 'Escape') setEditId(null);
                          }}
                          autoFocus
                          disabled={ocupado}
                          style={{ maxWidth: 280 }}
                        />
                      ) : (
                        <strong style={{ color: 'var(--text)', fontSize: '.84rem' }}>{c.nombre}</strong>
                      )}
                    </td>
                    <td>
                      <span className={`adm-badge ${c.activa ? 'activo' : 'suspendido'}`}>{c.activa ? 'Activa' : 'Inactiva'}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {puedeModificar ? (
                        editId === c.id ? (
                          <div style={{ display: 'inline-flex', gap: '.3rem' }}>
                            <button type="button" className="btn btn-xs btn-primary" onClick={() => void guardarNombre()} disabled={ocupado}>Guardar</button>
                            <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setEditId(null); setEditNombre(''); }} disabled={ocupado}>Cancelar</button>
                          </div>
                        ) : (
                          <div style={{ display: 'inline-flex', gap: '.3rem' }}>
                            <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setEditId(c.id); setEditNombre(c.nombre); }} title="Modificar nombre de la categoría">✏️ Renombrar</button>
                            <button type="button" className="btn btn-xs btn-ghost" onClick={() => void alternar(c)} disabled={ocupado} style={{ color: c.activa ? '#f59e0b' : '#10b981' }}>
                              {c.activa ? 'Desactivar' : 'Activar'}
                            </button>
                          </div>
                        )
                      ) : (<span className="muted">—</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SeccionColapsable>

      {/* 6. Carpetas de Documentos y Permisos */}
      <SeccionColapsable
        titulo="📁 Carpetas de Documentos y Permisos"
        subtitulo={`${carpetas.length} carpeta(s) configuradas`}
        abiertoPorDefecto={ESTADO_SECCIONES.carpetas}
        accionCabecera={puedeModificar ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }}
            onClick={() => setModalCarpetas(true)}
          >
            ⚙ Gestionar Carpetas
          </button>
        ) : undefined}
      >
        <p className="muted hint" style={{ marginTop: 0 }}>
          Estructura organizativa para archivar y vigilar los documentos mineros, parafiscales y legales. Puedes personalizar nombres, íconos y notas explicativas.
        </p>
        <div
          style={{
            marginTop: '.75rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '.55rem',
            maxHeight: '260px',
            overflowY: 'auto',
            paddingRight: '.25rem',
          }}
        >
          {carpetas.map((c) => (
            <div
              key={c.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '.55rem .75rem',
                background: 'var(--surface-1)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '.5rem',
              }}
            >
              <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{c.icon}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.15rem', overflow: 'hidden' }}>
                <strong style={{ fontSize: '.82rem', color: 'var(--text)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                  {c.label}
                </strong>
                {c.descripcion ? (
                  <span className="muted" style={{ fontSize: '.72rem', lineHeight: 1.25 }}>{c.descripcion}</span>
                ) : (
                  <span className="muted hint" style={{ fontSize: '.68rem', fontStyle: 'italic' }}>Sin nota descriptiva</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </SeccionColapsable>

      {/* Modal de Gestión de Carpetas */}
      {modalCarpetas && (
        <GestionarCarpetasModal
          carpetas={carpetas}
          centros={centros}
          empresaClave={null}
          onClose={() => setModalCarpetas(false)}
          onGuardar={(nuevas) => {
            setCarpetas(nuevas);
            guardarCarpetasPersonalizadas(nuevas);
          }}
        />
      )}

      {/* Confirmación para Eliminar Centro de Acopio */}
      {centroBorrar && (
        <ConfirmDialog
          title="Eliminar Centro de Acopio"
          danger
          message={
            <span>
              ¿Estás seguro de eliminar el centro <strong>«{centroBorrar.nombre}»</strong>?
              Esta acción eliminará el centro permanentemente del sistema.
            </span>
          }
          onConfirm={() => void borrarCentro(centroBorrar)}
          onCancel={() => setCentroBorrar(null)}
        />
      )}
    </div>
  );
}
