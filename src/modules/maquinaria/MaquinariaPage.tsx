import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { useSession } from '@/modules/auth/authStore';
import { num as fmtNum } from '@/shared/lib/format';
import { norm } from '@/shared/lib/texto';
import { MaquinariaCatalogoModal } from './MaquinariaCatalogoModal';
import { EquipoFormModal } from './EquipoFormModal';
import { ResumenMaquinariaModal } from './ResumenMaquinariaModal';
import { CorreoReporteModal } from '@/shared/ui/CorreoReporteModal';
import { listEquipos, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { listCatalogos } from '@/modules/combustible/tanques.repository';
import { descargarEquiposPdf, descargarEquiposExcel, enviarEquiposPorCorreo } from './maquinariaReportes';
import {
  BUCKETS_FLOTA, CLASES_EQUIPO, ESTADOS_EQUIPO, estadoEfectivo, claseEquipo, avisoServicio, avisoMasUrgente, coincideEquipo,
  type AvisoServicio, type BucketFlota, type ClaseEquipo, type EstadoEquipo,
} from './flota';
import { ordenesAbiertasPorEquipo, fotosDeEquipos, lecturasVigentesPorEquipo, type LecturaVigente } from './flota.repository';
import { FlotaNav } from './FlotaNav';

interface InfoEquipo {
  estado: EstadoEquipo;
  clase: ClaseEquipo;
  horometro: number | null;
  km: number | null;
  aviso: AvisoServicio | null;
}

/**
 * Catálogo de Control de Maquinaria y Vehículos (Flota y Servicio, 09/10/2026).
 * Arriba la franja de flota (Operativas · Averiadas · En taller · En espera ·
 * Retiradas) que también filtra; luego búsqueda sin acentos, clase, propietario y
 * tipo. Cada fila abre el expediente del equipo, donde están las acciones.
 */
export function MaquinariaPage() {
  const { can } = usePermissions();
  const { user } = useSession();
  const navigate = useNavigate();
  const canWrite = can('maquinaria', 'escritura');
  const actor = user?.email ?? 'sistema';

  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [lecturas, setLecturas] = useState<Map<string, LecturaVigente>>(new Map()); // contador vigente por equipo
  const [ordenesAbiertas, setOrdenesAbiertas] = useState<Map<string, number>>(new Map());
  const [fotos, setFotos] = useState<Map<string, string>>(new Map());
  // GT-INT-15 · Valores vigentes del catalogo de Combustible, para detectar fichas que
  // quedaron apuntando a un nombre renombrado (vinculo roto = alerta apagada en silencio).
  const [combEquipos, setCombEquipos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [filtro, setFiltro] = useState('');
  const [bucket, setBucket] = useState<BucketFlota | null>(null);
  const [clase, setClase] = useState<ClaseEquipo | 'todos'>('todos');
  const [propietario, setPropietario] = useState('');
  const [tipo, setTipo] = useState('');
  const [soloProximos, setSoloProximos] = useState(false);

  const [catalogoOpen, setCatalogoOpen] = useState(false);
  const [resumenOpen, setResumenOpen] = useState(false);
  const [correoOpen, setCorreoOpen] = useState(false);
  const [nuevo, setNuevo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [eqs, lecs, cats, abiertas, fts] = await Promise.all([
        listEquipos(),
        lecturasVigentesPorEquipo().catch(() => new Map<string, LecturaVigente>()),
        listCatalogos().catch(() => []),
        ordenesAbiertasPorEquipo().catch(() => new Map<string, number>()),
        fotosDeEquipos().catch(() => []),
      ]);
      setEquipos(eqs);
      setLecturas(lecs);
      setOrdenesAbiertas(abiertas);
      const fm = new Map<string, string>();
      for (const f of fts) if (!fm.has(f.equipo_id)) fm.set(f.equipo_id, f.url);
      setFotos(fm);
      setCombEquipos(cats.filter((c) => c.tipo === 'equipo').map((c) => c.valor));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  // También vigila los movimientos de combustible (horómetro vigente) y las órdenes de servicio.
  useRealtime(['maquinaria_equipos', 'maquinaria_catalogos', 'maquinaria_mantenimientos', 'maquinaria_documentos', 'maquinaria_ordenes_servicio', 'combustible_tanque_movimientos', 'maquinaria_lecturas'], () => { void cargar(); });

  // Estado, clase y aviso de servicio por equipo. Las lecturas vigentes (horómetro y
  // kilometraje) se traen de Combustible por el equipo vinculado (combustible_equipo);
  // el horómetro cae a la bitácora si no hay dato de Combustible. El aviso salta si
  // faltan ≤ 10% del intervalo (horas o km) o ya se pasó — la misma regla de siempre.
  const info = useMemo(() => {
    const m = new Map<string, InfoEquipo>();
    for (const e of equipos) {
      // Contador vigente unificado: Combustible, Maquinaria y bitácora (el mismo del surtidor).
      const lec = lecturas.get(e.id);
      const horo = lec?.horometro ?? null;
      const km = lec?.kilometraje ?? null;
      const aviso = avisoMasUrgente(
        avisoServicio(e.mantenimiento_cada_hrs, horo, e.mantenimiento_base_hrs, 'h'),
        avisoServicio(e.mantenimiento_cada_km, km, e.mantenimiento_base_km, 'km'),
      );
      m.set(e.id, { estado: estadoEfectivo(e), clase: claseEquipo(e), horometro: horo, km, aviso });
    }
    return m;
  }, [equipos, lecturas]);

  // GT-INT-15 · Fichas que apuntan a un valor que ya no está en el catálogo de
  // Combustible: no ven su horómetro ni su gasoil, y su alerta NO suena.
  const vinculosRotos = useMemo(() => {
    if (!combEquipos.length) return [];
    const vigentes = new Set(combEquipos.map((v) => v.trim()));
    return equipos.filter((e) => {
      if (!e.activo) return false;
      const v = (e.combustible_equipo ?? '').trim();
      return !!v && !vigentes.has(v);
    });
  }, [equipos, combEquipos]);

  const filtrar = useCallback((ignorar: 'bucket' | 'tipo' | null) => equipos.filter((e) => {
    const i = info.get(e.id);
    if (!i) return false;
    const b = ESTADOS_EQUIPO[i.estado].bucket;
    if (ignorar !== 'bucket') {
      if (bucket ? b !== bucket : b === 'retiradas') return false;
    }
    if (clase !== 'todos' && i.clase !== clase) return false;
    if (propietario && (e.propietario ?? '') !== propietario) return false;
    if (ignorar !== 'tipo' && tipo && norm(e.tipo) !== norm(tipo)) return false;
    if (soloProximos && !(i.aviso && i.aviso.nivel !== 'ok')) return false;
    return coincideEquipo(e, filtro);
  }), [equipos, info, bucket, clase, propietario, tipo, soloProximos, filtro]);

  const lista = useMemo(() => filtrar(null), [filtrar]);
  const baseFlota = useMemo(() => filtrar('bucket'), [filtrar]);
  const baseTipos = useMemo(() => filtrar('tipo'), [filtrar]);
  const disponibles = baseFlota.filter((e) => info.get(e.id)?.estado !== 'retirada').length;
  const proximos = useMemo(
    () => equipos.filter((e) => e.activo && info.get(e.id)?.aviso && info.get(e.id)?.aviso?.nivel !== 'ok'),
    [equipos, info],
  );

  const propietarios = useMemo(
    () => [...new Set(equipos.map((e) => e.propietario).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es')),
    [equipos],
  );
  const tipos = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of baseTipos) {
      const t = e.tipo?.trim().toUpperCase();
      if (t) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [baseTipos]);

  // Agrupado por propietario.
  const grupos = useMemo(() => {
    const g = new Map<string, MaquinariaEquipo[]>();
    for (const e of lista) {
      const k = e.propietario?.trim() || 'Sin propietario';
      const arr = g.get(k) ?? [];
      arr.push(e);
      g.set(k, arr);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [lista]);

  return (
    <div className="flo">
      <FlotaNav />
      <div className="page-head">
        <div>
          <h1 className="flo-h1">🚜 Control de Maquinaria y Vehículos</h1>
          <p className="flo-sub">{disponibles} equipo(s) en la flota disponible · toca un equipo para abrir su expediente</p>
        </div>
        <div className="actions" style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {canWrite && <button className="btn btn-primary" onClick={() => setNuevo(true)}>+ Nuevo equipo</button>}
          <button className="btn btn-ghost" onClick={() => setResumenOpen(true)}>📊 Resumen</button>
          <button className="btn btn-ghost" onClick={() => setCatalogoOpen(true)}>🏷 Catálogo</button>
          <button className="btn btn-ghost" disabled={!lista.length} onClick={() => void descargarEquiposPdf(lista)}>↓ PDF</button>
          <button className="btn btn-ghost" disabled={!lista.length} onClick={() => void descargarEquiposExcel(lista)}>↓ Excel</button>
          <button className="btn btn-ghost" disabled={!lista.length} onClick={() => setCorreoOpen(true)}>✉ Correo</button>
        </div>
      </div>

      <div className="flo-fleet" role="group" aria-label="Filtrar por estado">
        {BUCKETS_FLOTA.map((b) => {
          const n = baseFlota.filter((e) => ESTADOS_EQUIPO[info.get(e.id)?.estado ?? 'operativa'].bucket === b.id).length;
          return (
            <button key={b.id} type="button" className={`tone-${b.tono}`} aria-pressed={bucket === b.id}
              onClick={() => setBucket(bucket === b.id ? null : b.id)}>
              <strong>{n}</strong><span>{b.icon} {b.label}</span>
            </button>
          );
        })}
      </div>

      {proximos.length > 0 && (
        <div className="aviso warning" style={{ marginBottom: '.6rem' }}>
          <span className="aviso-icono">⚠️</span>
          <div>
            <strong>{proximos.length} equipo(s)</strong> con servicio próximo o vencido (horómetro / kilometraje de Combustible): {proximos.slice(0, 6).map((e) => e.equipo).join(', ')}{proximos.length > 6 ? '…' : ''}.{' '}
            <button type="button" className="btn-link" onClick={() => setSoloProximos(!soloProximos)}>{soloProximos ? 'Ver todos' : 'Ver solo esos'}</button>
          </div>
        </div>
      )}

      {vinculosRotos.length > 0 && (
        <div className="aviso danger" style={{ marginBottom: '.6rem' }}>
          <span className="aviso-icono">🔗</span>
          <div>
            <strong>{vinculosRotos.length} equipo(s) desvinculados de Combustible.</strong>{' '}
            Su ficha apunta a un nombre que ya no está en el catálogo — casi siempre porque lo
            renombraron. Mientras siga así, <strong>no ven su horómetro ni su gasoil y su alerta de
            mantenimiento no suena</strong>. Abre cada equipo y elige de nuevo el equipo de Combustible:
            <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.1rem' }}>
              {vinculosRotos.map((e) => (
                <li key={e.id}><Link to={`/app/maquinaria/equipo/${e.id}`}><strong>{e.equipo}</strong></Link> → apunta a «{e.combustible_equipo}»</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flo-filtros">
        <div className="fila">
          <input className="input flo-buscar" type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)}
            placeholder="🔍 Buscar equipo, marca, serial, placa, ubicación…" aria-label="Buscar equipo" />
          <div className="flo-seg" role="group" aria-label="Clase de equipo">
            <button type="button" aria-pressed={clase === 'todos'} onClick={() => setClase('todos')}>Todos</button>
            {CLASES_EQUIPO.map((c) => <button key={c.id} type="button" aria-pressed={clase === c.id} onClick={() => setClase(c.id)}>{c.icon} {c.label}</button>)}
          </div>
          {propietarios.length > 1 && (
            <select className="select" value={propietario} onChange={(e) => setPropietario(e.target.value)} aria-label="Propietario" style={{ maxWidth: '100%' }}>
              <option value="">Todos los propietarios</option>
              {propietarios.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
        </div>
        {tipos.length > 1 && (
          <div className="flo-pills" role="group" aria-label="Tipo de equipo">
            {tipos.map(([t, n]) => (
              <button key={t} type="button" className="flo-pill" aria-pressed={tipo === t} onClick={() => setTipo(tipo === t ? '' : t)}>{t}<span className="n">{n}</span></button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <EmptyState message="Cargando…" />
      ) : !lista.length ? (
        <EmptyState message={equipos.length ? 'Sin resultados con estos filtros.' : 'Aún no hay equipos registrados.'} icon="🔎" />
      ) : grupos.map(([g, eqs]) => (
        <div key={g}>
          <div className="flo-grupo"><span>🏢 {g}</span><span className="n">{eqs.length}</span></div>
          <div className="flo-lista">
            {eqs.map((e) => {
              const i = info.get(e.id);
              if (!i) return null;
              const st = ESTADOS_EQUIPO[i.estado];
              const foto = fotos.get(e.id);
              const nOrd = ordenesAbiertas.get(e.id) ?? 0;
              const notaClase = i.estado === 'averiada' ? '' : i.estado === 'espera' ? 'wait' : 'warn';
              const cl = CLASES_EQUIPO.find((c) => c.id === i.clase);
              const alerta = !!i.aviso && i.aviso.nivel !== 'ok' && i.estado !== 'retirada';
              return (
                <button key={e.id} type="button" className={`flo-row${alerta ? ' alerta' : ''}${e.activo ? '' : ' inactivo'}`}
                  onClick={() => navigate(`/app/maquinaria/equipo/${e.id}`)} aria-label={`Abrir expediente de ${e.equipo}`}>
                  <div className="flo-thumb">{foto ? <img src={foto} alt="" loading="lazy" /> : <span aria-hidden="true">{cl?.icon ?? '🚜'}</span>}</div>
                  <div className="flo-main">
                    <div className="flo-top"><span className="flo-code">{e.equipo}</span>{e.tipo && <span className="flo-tipo">{e.tipo}</span>}</div>
                    <div className="flo-subl">{[e.marca, e.modelo, e.placa || e.serial].filter(Boolean).join(' · ') || '—'}</div>
                    {i.estado !== 'operativa' && e.estado_nota && <div className={`flo-nota ${notaClase}`}>{e.estado_nota}</div>}
                    <div className="flo-meta">
                      <span className={`flo-chip tone-${st.tono}`}>{st.icon} {st.label}</span>
                      {e.ubicacion && <span>📍 {e.ubicacion}</span>}
                      {nOrd > 0 && <span>🧾 {nOrd} orden(es)</span>}
                      {alerta && i.aviso && (
                        <span className={i.aviso.nivel === 'vencido' ? 'danger' : 'warn'}>
                          ⏱️ {i.aviso.nivel === 'vencido' ? `Servicio vencido ${fmtNum(Math.abs(i.aviso.restante))} ${i.aviso.unidad}` : `Servicio en ${fmtNum(i.aviso.restante)} ${i.aviso.unidad}`}
                        </span>
                      )}
                      {i.aviso?.nivel === 'ok' && <span>⏱️ faltan {fmtNum(i.aviso.restante)} {i.aviso.unidad}</span>}
                      {!i.aviso && (i.horometro != null || i.km != null) && <span>{i.horometro != null ? `${fmtNum(i.horometro)} h` : `${fmtNum(i.km)} km`}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {catalogoOpen && <MaquinariaCatalogoModal canWrite={canWrite} onClose={() => setCatalogoOpen(false)} />}
      {resumenOpen && <ResumenMaquinariaModal equipos={equipos.filter((e) => e.activo)} onClose={() => setResumenOpen(false)} />}
      {nuevo && <EquipoFormModal equipo={null} actor={actor} onClose={() => setNuevo(false)} onSaved={cargar} />}
      {correoOpen && (
        <CorreoReporteModal
          titulo="Enviar Control de Maquinaria y Vehículos"
          descripcion={`Se enviará el PDF con ${lista.length} equipo(s).`}
          defaultEmail={actor}
          onEnviar={async (emails) => (await enviarEquiposPorCorreo(lista, emails)).destinatarios}
          onClose={() => setCorreoOpen(false)}
        />
      )}
    </div>
  );
}
