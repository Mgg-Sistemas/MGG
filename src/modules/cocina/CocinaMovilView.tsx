/* ============================================================
   MGG · Alimentación · Comidas (vista de teléfono)

   La pantalla del cocinero con el celular: elige su cocina, toca
   🍳 Desayuno, 🍛 Almuerzo o 🌙 Cena, pone cuántas personas comieron
   y qué se gastó, le saca hasta 4 fotos y guarda. Puede cargar un día
   anterior. Después lo manda por WhatsApp, como el surtidor de
   combustible.

   Escribe en las MISMAS tablas que el módulo de PC (crearComida /
   editarComida / eliminarComida, que descuentan y devuelven el
   inventario), así que lo que se carga acá lo ve la analista al
   instante en la PC (realtime), donde lo verifica y lo corrige.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { recargarCategoriasCocina } from './categoriasCocina';
import { toast } from '@/shared/ui/Toast';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { num, dateTime } from '@/shared/lib/format';
import type { CocinaComida, TipoComida, Cocina } from '@/shared/lib/types';
import {
  crearComida, editarComida, eliminarComida, labelTipoComida, listComidas, listCocinasQueSirven,
  listViveresGlobal, type ViverDisponible,
} from './cocina.repository';
import { EMOJI_COMIDA, enlaceWhatsapp, fechaComidaTexto, mensajeComida } from './mensajeComida';
import { compartirMovimiento, puedeCompartir } from '@/modules/combustible/mensajeMovimiento';
import { FotosDelMovimiento, SelectorFotos } from '@/modules/combustible/FotosMovimiento';
import { MODULO_ADJUNTO_COMIDA, contarFotos, subirFotos } from '@/modules/combustible/adjuntosCombustible.repository';
import { RUTA_COCINA_TELEFONO } from '@/modules/usuarios/permisos.repository';
import { AtajosTelefono } from '@/shared/ui/AtajosTelefono';

/** Cuántas comidas se ven en el teléfono. El libro completo está en la PC. */
export const ULTIMAS_COMIDAS_TELEFONO = 10;

const TIPOS: TipoComida[] = ['desayuno', 'almuerzo', 'cena'];
const CLAVE_COCINA = 'mgg.cocinaMovil.cocinaId';

const hoyVE = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
/** Día de planta de una comida guardada (AAAA-MM-DD). */
const diaVE = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const leerCocina = () => { try { return localStorage.getItem(CLAVE_COCINA) ?? ''; } catch { return ''; } };
const guardarCocina = (id: string) => { try { localStorage.setItem(CLAVE_COCINA, id); } catch { /* sin almacenamiento: se vuelve a elegir */ } };

export function CocinaMovilView() {
  const { user } = useSession();
  const { can, appUser, soloTelefono } = usePermissions();
  const canWrite = can('cocina', 'escritura');
  // El cocinero no tiene módulo de escritorio al que volver.
  const esCocinero = soloTelefono;
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;

  const [cocinas, setCocinas] = useState<{ cocina: Cocina; almacenNombre: string | null }[]>([]);
  const [selId, setSelId] = useState(leerCocina);
  const [comidas, setComidas] = useState<CocinaComida[]>([]);
  const [fotos, setFotos] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ tipo: TipoComida; comida: CocinaComida | null } | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const reloadCocinas = useCallback(async () => {
    const cs = await listCocinasQueSirven();
    setCocinas(cs);
    setSelId((prev) => (prev && cs.some((c) => c.cocina.id === prev) ? prev : cs[0]?.cocina.id ?? ''));
  }, []);

  const reloadComidas = useCallback(async (id: string) => {
    if (!id) { setComidas([]); setFotos(new Map()); return; }
    const todas = await listComidas({ cocinaId: id });
    const ultimas = todas.slice(0, ULTIMAS_COMIDAS_TELEFONO);
    setComidas(ultimas);
    try { setFotos(await contarFotos(ultimas.map((c) => c.id), MODULO_ADJUNTO_COMIDA)); }
    catch { /* el contador de fotos es adorno */ }
  }, []);

  useEffect(() => {
    let cancel = false;
    reloadCocinas().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reloadCocinas]);
  useEffect(() => { if (selId) guardarCocina(selId); void reloadComidas(selId).catch(() => {}); }, [selId, reloadComidas]);
  useRealtime(['cocinas', 'cocina_comidas', 'combustible_adjuntos'], () => {
    void reloadCocinas().catch(() => {});
    void reloadComidas(selId).catch(() => {});
  });

  const sel = useMemo(() => cocinas.find((c) => c.cocina.id === selId) ?? null, [cocinas, selId]);
  const detalle = detalleId ? comidas.find((c) => c.id === detalleId) ?? null : null;

  return (
    <div className="surtidor">
      <header className="surt-head">
        <div>
          <h1>🍳 Comidas</h1>
          <div className="muted" style={{ fontSize: '.85rem' }}>{actorName ?? actor}</div>
        </div>
        {!esCocinero && <Link to="/app/cocina" className="btn btn-ghost">🖥 Módulo completo</Link>}
      </header>
      <AtajosTelefono actual={RUTA_COCINA_TELEFONO} />

      {loading && <p className="muted">Cargando…</p>}
      {!loading && !cocinas.length && <EmptyState icon="🍳" message="No hay cocinas activas. Se crean desde Control de Alimentación en la PC." />}

      {cocinas.length > 1 && (
        <>
          <div className="surt-rotulo">Cocina</div>
          <div className="surt-tanques" role="tablist" aria-label="Cocina">
            {cocinas.map(({ cocina, almacenNombre }) => (
              <button key={cocina.id} type="button" role="tab" aria-selected={cocina.id === selId}
                className={`surt-tanque${cocina.id === selId ? ' sel' : ''}`}
                onClick={() => { setSelId(cocina.id); setForm(null); }}>
                <div className="nombre">{cocina.nombre}</div>
                <div className="muted" style={{ fontSize: '.8rem' }}>{almacenNombre ?? 'sin almacén'}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {sel && !form && canWrite && (
        <div className="surt-acciones comidas">
          {TIPOS.map((t) => (
            <button key={t} type="button" className={`surt-btn ${t}`} onClick={() => setForm({ tipo: t, comida: null })}>
              <span className="icono" aria-hidden>{EMOJI_COMIDA[t]}</span>
              <span className="texto">
                <span>{labelTipoComida(t)}</span>
                <small>Personas y consumo de {sel.cocina.nombre}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {sel && !canWrite && (
        <div className="aviso warning sm" style={{ margin: '.75rem 0' }}>
          <span className="aviso-icono">👁</span>
          <div>Tu rol solo puede ver. Para cargar comidas hace falta escritura en Alimentación.</div>
        </div>
      )}
      {sel && !sel.almacenNombre && (
        <div className="aviso warning sm" style={{ margin: '.75rem 0' }}>
          <span className="aviso-icono">⚠</span>
          <div>Esta cocina no tiene almacén vinculado: se asigna desde la PC.</div>
        </div>
      )}

      {sel && form && (
        <FormularioComida key={`${sel.cocina.id}-${form.tipo}-${form.comida?.id ?? 'nueva'}`}
          tipoInicial={form.tipo} comida={form.comida} cocinaId={sel.cocina.id} cocinaNombre={sel.cocina.nombre}
          almacen={sel.almacenNombre} actor={actor} actorName={actorName}
          onCancel={() => setForm(null)}
          onSaved={async (id) => { setForm(null); await reloadComidas(sel.cocina.id).catch(() => {}); setDetalleId(id); }} />
      )}

      {sel && (
        <section className="surt-lista">
          <h2>Últimas {ULTIMAS_COMIDAS_TELEFONO} comidas · {sel.cocina.nombre}</h2>
          {!comidas.length && <p className="muted">Esta cocina no tiene comidas cargadas todavía.</p>}
          {comidas.map((c) => {
            const n = fotos.get(c.id) ?? 0;
            return (
              <button key={c.id} type="button" className="surt-mov" onClick={() => setDetalleId(c.id)}>
                <span className="icono" aria-hidden>{EMOJI_COMIDA[c.tipo_comida]}</span>
                <span style={{ minWidth: 0 }}>
                  <div className="titulo">{labelTipoComida(c.tipo_comida)} · {fechaComidaTexto(c.at)}</div>
                  <div className="sub">
                    {num((c.items ?? []).length)} víver(es){c.nota ? ` · ${c.nota}` : ''}{n > 0 ? ` · 📎 ${n}` : ''}
                  </div>
                </span>
                <span className="litros">👥 {num(c.platos)}</span>
              </button>
            );
          })}
          {comidas.length >= ULTIMAS_COMIDAS_TELEFONO && (
            <p className="muted" style={{ fontSize: '.85rem' }}>Acá se ven las últimas {ULTIMAS_COMIDAS_TELEFONO}. El libro completo está en Control de Alimentación en la PC.</p>
          )}
        </section>
      )}

      {detalle && sel && (
        <DetalleComida comida={detalle} cocinaNombre={sel.cocina.nombre} canWrite={canWrite} actor={actor} actorName={actorName}
          fotos={fotos.get(detalle.id) ?? 0}
          onClose={() => setDetalleId(null)}
          onEditar={() => { setDetalleId(null); setForm({ tipo: detalle.tipo_comida, comida: detalle }); }}
          onBorrada={async () => { setDetalleId(null); await reloadComidas(sel.cocina.id).catch(() => {}); }} />
      )}
    </div>
  );
}

/* ───────────── Formulario: personas, consumo, fecha y fotos ───────────── */
function FormularioComida({ tipoInicial, comida, cocinaId, cocinaNombre, almacen, actor, actorName, onCancel, onSaved }: {
  tipoInicial: TipoComida; comida: CocinaComida | null; cocinaId: string; cocinaNombre: string; almacen: string | null;
  actor: string; actorName: string | null; onCancel: () => void; onSaved: (comidaId: string) => Promise<void>;
}) {
  const hoy = hoyVE();
  const [tipo, setTipo] = useState<TipoComida>(tipoInicial);
  const [fecha, setFecha] = useState(comida ? diaVE(comida.at) : hoy);
  const [personas, setPersonas] = useState(comida ? String(comida.platos) : '');
  const [nota, setNota] = useState(comida?.nota ?? '');
  const [viveres, setViveres] = useState<ViverDisponible[]>([]);
  const [buscar, setBuscar] = useState('');
  // Lo elegido, en el orden en que se fue agregando: productoId → cantidad (texto).
  const [items, setItems] = useState<{ id: string; cant: string }[]>(
    () => (comida?.items ?? []).map((it) => ({ id: it.producto_id, cant: String(it.cantidad) })));
  const [archivos, setArchivos] = useState<File[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [etapa, setEtapa] = useState<'comida' | 'fotos'>('comida');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listViveresGlobal(almacen).then(setViveres).catch(() => setViveres([])); }, [almacen]);
  // Si en la PC dan de baja (o alta) un víver, el buscador del teléfono lo refleja al instante.
  useRealtime(['productos', 'existencias'], () => { listViveresGlobal(almacen).then(setViveres).catch(() => {}); });
  useRealtime(['categorias_cocina'], () => { void recargarCategoriasCocina().then(() => listViveresGlobal(almacen)).then(setViveres).catch(() => {}); });
  const mapV = useMemo(() => new Map(viveres.map((v) => [v.producto.id, v])), [viveres]);
  const elegidos = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const sugerencias = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    if (!q) return [];
    return viveres.filter((v) => !elegidos.has(v.producto.id)
      && (v.producto.nombre.toLowerCase().includes(q) || (v.producto.sku ?? '').toLowerCase().includes(q))).slice(0, 8);
  }, [viveres, buscar, elegidos]);

  function agregar(id: string) { setItems((xs) => [...xs, { id, cant: '' }]); setBuscar(''); }
  function setCant(id: string, cant: string) { setItems((xs) => xs.map((x) => (x.id === id ? { ...x, cant } : x))); }
  function quitar(id: string) { setItems((xs) => xs.filter((x) => x.id !== id)); }

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    const nPersonas = Number(personas) || 0;
    const lineas = items.map((x) => ({ producto_id: x.id, cantidad: Number(String(x.cant).replace(',', '.')) || 0 }));
    if (nPersonas <= 0) { setError('Indicá cuántas personas comieron.'); return; }
    if (!lineas.length) { setError('Agregá lo que se consumió: buscá cada víver y poné la cantidad.'); return; }
    if (lineas.some((l) => l.cantidad <= 0)) { setError('Falta la cantidad de algún víver (o quitalo con ✕).'); return; }
    if (!fecha || fecha > hoy) { setError('La fecha no puede ser posterior a hoy.'); return; }
    setGuardando(true); setEtapa('comida');
    try {
      const payload = { tipoComida: tipo, platos: nPersonas, items: lineas, nota: nota.trim() || null, cocinaId, almacen, fecha, actor, actorName };
      const guardada = comida ? await editarComida(comida.id, payload) : await crearComida(payload);
      // Las fotos se suben recién ahora: van colgadas del id de la comida.
      if (archivos.length) {
        setEtapa('fotos');
        const { fallos } = await subirFotos(guardada.id, archivos, actor, MODULO_ADJUNTO_COMIDA);
        for (const f of fallos) toast(`Comida guardada, pero una foto no se pudo subir: ${f}`, 'error');
      }
      toast(`${labelTipoComida(tipo)} ${comida ? 'actualizado' : 'registrado'} · ${cocinaNombre}`, 'success');
      await onSaved(guardada.id);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar.'); }
    finally { setGuardando(false); }
  }

  return (
    <form className="surt-form card" onSubmit={guardar}>
      <div className="surt-form-titulo">
        <span className="icono" aria-hidden>{EMOJI_COMIDA[tipo]}</span>
        <div>
          <strong>{comida ? `Editar ${labelTipoComida(tipo).toLowerCase()} · ${comida.codigo}` : labelTipoComida(tipo)}</strong>
          <div className="muted" style={{ fontSize: '.85rem' }}>{cocinaNombre}{almacen ? ` · descuenta de ${almacen}` : ''}</div>
        </div>
      </div>

      {error && <div className="aviso danger"><span className="aviso-icono">⛔</span><div>{error}</div></div>}

      <div className="surt-campo">
        <label>Servicio</label>
        <div className="surt-grid3">
          {TIPOS.map((t) => (
            <button key={t} type="button" className={`btn btn-grande ${tipo === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTipo(t)}>
              {EMOJI_COMIDA[t]} {labelTipoComida(t)}
            </button>
          ))}
        </div>
      </div>

      <div className="surt-grid2">
        <div className="surt-campo">
          <label htmlFor="com-personas">👥 Personas</label>
          <input id="com-personas" className="input surt-input surt-litros" type="number" inputMode="numeric" min={1} step={1}
            value={personas} onChange={(e) => setPersonas(e.target.value)} placeholder="0" autoFocus={!comida} required />
        </div>
        <div className="surt-campo">
          <label htmlFor="com-fecha">📅 Fecha</label>
          <input id="com-fecha" className="input surt-input" type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} />
          {fecha && fecha !== hoy && <small className="muted">Día anterior: se carga con fecha {fecha.split('-').reverse().join('/')}.</small>}
        </div>
      </div>

      <div className="surt-campo">
        <label htmlFor="com-buscar">📦 Consumo ({items.length})</label>
        <input id="com-buscar" className="input surt-input" value={buscar} onChange={(e) => setBuscar(e.target.value)}
          placeholder="🔍 Buscá el víver (arroz, pollo, aceite…)" autoComplete="off" />
        {!!sugerencias.length && (
          <div className="surt-sugerencias" style={{ display: 'grid', gap: '.3rem', marginTop: '.35rem' }}>
            {sugerencias.map((v) => (
              <button key={v.producto.id} type="button" className="btn btn-ghost" style={{ justifyContent: 'space-between', textAlign: 'left' }}
                onClick={() => agregar(v.producto.id)}>
                <span>＋ {v.producto.nombre}</span>
                <small className="muted">{num(v.stock)} {v.producto.unidad}</small>
              </button>
            ))}
          </div>
        )}
        {buscar.trim() && !sugerencias.length && <small className="muted">Ningún víver de este centro coincide.</small>}
        {!!items.length && (
          <div style={{ display: 'grid', gap: '.4rem', marginTop: '.5rem' }}>
            {items.map((x) => {
              const v = mapV.get(x.id);
              const cant = Number(String(x.cant).replace(',', '.')) || 0;
              const excede = !!v && cant > v.stock;
              return (
                <div key={x.id} className="card" style={{ margin: 0, padding: '.45rem .6rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '.95rem' }}>{v?.producto.nombre ?? comida?.items.find((it) => it.producto_id === x.id)?.nombre ?? 'Víver'}</div>
                    <small className="muted" style={{ color: excede ? 'var(--warning)' : undefined }}>
                      hay {num(v?.stock ?? 0)} {v?.producto.unidad ?? ''}{excede ? ' · supera lo que hay' : ''}
                    </small>
                  </div>
                  <input className="input surt-input" type="number" inputMode="decimal" step="any" min={0} value={x.cant}
                    onChange={(e) => setCant(x.id, e.target.value)} placeholder={v?.producto.unidad ?? 'cant.'}
                    aria-label={`Cantidad de ${v?.producto.nombre ?? 'víver'}`} style={{ width: 96, textAlign: 'right' }} />
                  <button type="button" className="btn btn-icon btn-ghost" title="Quitar" onClick={() => quitar(x.id)}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="surt-campo">
        <label htmlFor="com-nota">📝 Nota (opcional)</label>
        <input id="com-nota" className="input surt-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Pollo guisado con arroz…" />
      </div>

      {!comida && <SelectorFotos archivos={archivos} onChange={setArchivos} titulo="📷 Fotos del servicio (hasta 4)" />}
      {comida && <small className="muted">Las fotos se agregan o quitan desde el detalle de la comida.</small>}

      <button type="submit" className="btn btn-primary surt-guardar" disabled={guardando}>
        {guardando
          ? (etapa === 'fotos' ? `Subiendo ${archivos.length === 1 ? 'la foto' : `${archivos.length} fotos`}…` : 'Guardando…')
          : `✔ ${comida ? 'Guardar cambios' : `Registrar ${labelTipoComida(tipo).toLowerCase()}`}`}
      </button>
      <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>Cancelar</button>
    </form>
  );
}

/* ───────────── Detalle: WhatsApp, fotos, editar y borrar ───────────── */
function DetalleComida({ comida, cocinaNombre, canWrite, actor, actorName, fotos, onClose, onEditar, onBorrada }: {
  comida: CocinaComida; cocinaNombre: string; canWrite: boolean; actor: string; actorName: string | null; fotos: number;
  onClose: () => void; onEditar: () => void; onBorrada: () => Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const texto = mensajeComida(comida, { cocina: cocinaNombre, fotos });
  const titulo = `${EMOJI_COMIDA[comida.tipo_comida]} ${labelTipoComida(comida.tipo_comida)} · ${fechaComidaTexto(comida.at)}`;

  async function copiar() {
    try { await navigator.clipboard.writeText(texto); toast('Mensaje copiado', 'success'); }
    catch { toast('No se pudo copiar solo. Mantené presionado el texto para copiarlo.', 'warning'); }
  }

  async function borrar() {
    setBorrando(true);
    try {
      await eliminarComida(comida.id, actor, actorName);
      toast('Comida eliminada · el consumo volvió al inventario', 'success');
      await onBorrada();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error');
      setBorrando(false);
    }
  }

  // La confirmación ocupa todo el modal y sus botones van en el pie, donde está el dedo.
  if (confirmando) {
    return (
      <Modal title="🗑 Eliminar comida" size="md" onClose={() => { if (!borrando) setConfirmando(false); }}
        footer={<>
          <button type="button" className="btn btn-ghost btn-grande" onClick={() => setConfirmando(false)} disabled={borrando}>↩ NO, VOLVER</button>
          <button type="button" className="btn btn-peligro btn-grande" onClick={() => void borrar()} disabled={borrando}>
            {borrando ? 'Eliminando…' : '🗑 SÍ, ELIMINAR'}
          </button>
        </>}>
        <div className="surt-confirmar">
          <strong style={{ fontSize: '1.15rem', display: 'block' }}>
            ¿Eliminar el {labelTipoComida(comida.tipo_comida).toLowerCase()} del {fechaComidaTexto(comida.at)} ({num(comida.platos)} personas)?
          </strong>
          <div className="muted" style={{ marginTop: '.7rem', fontSize: '.95rem' }}>
            Lo consumido <strong>vuelve al inventario</strong> y se borran sus fotos. <strong>No se puede deshacer.</strong> Se refleja al instante en la PC.
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={titulo} size="md" onClose={() => { if (!borrando) onClose(); }}
      footer={<>
        {canWrite && <button className="btn btn-danger btn-grande" onClick={() => setConfirmando(true)}>🗑 Eliminar</button>}
        {canWrite && <button className="btn btn-ghost btn-grande" onClick={onEditar}>✎ Editar</button>}
        <button className="btn btn-primary btn-grande" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="surt-detalle">
        <div className="surt-fila"><span className="muted">Cocina</span><span>{cocinaNombre}</span></div>
        <div className="surt-fila"><span className="muted">Personas</span><span>{num(comida.platos)}</span></div>
        <div className="surt-fila"><span className="muted">Código</span><span>{comida.codigo}</span></div>
        {comida.nota && <div className="surt-fila"><span className="muted">Nota</span><span>{comida.nota}</span></div>}
        <div className="surt-fila"><span className="muted">Registrado</span><span>{dateTime(comida.created_at ?? comida.at)}{comida.actor_name || comida.actor ? ` · ${comida.actor_name || comida.actor}` : ''}</span></div>
      </div>
      <div className="surt-rotulo">📦 Consumo</div>
      <div className="surt-detalle">
        {(comida.items ?? []).map((it) => (
          <div key={it.producto_id} className="surt-fila"><span>{it.nombre}</span><span>{num(it.cantidad)} {it.unidad}</span></div>
        ))}
      </div>

      <div className="surt-rotulo">Avisar</div>
      <div className="surt-grid2">
        <button type="button" className="btn btn-ghost btn-grande" onClick={() => void copiar()}>📋 Copiar mensaje</button>
        <a className="btn btn-primary btn-grande" href={enlaceWhatsapp(texto)} target="_blank" rel="noopener noreferrer"
          onClick={(e) => {
            // En el teléfono va por la hoja de compartir (el texto llega exacto); en la PC, el enlace.
            if (!puedeCompartir()) return;
            e.preventDefault();
            void compartirMovimiento(texto);
          }}>
          💬 Enviar por WhatsApp
        </a>
      </div>
      <pre className="surt-mensaje">{texto}</pre>

      <FotosDelMovimiento movId={comida.id} actor={actor} soloLectura={!canWrite} modulo={MODULO_ADJUNTO_COMIDA}
        sinFotosTexto="Esta comida no tiene fotos." />
    </Modal>
  );
}
