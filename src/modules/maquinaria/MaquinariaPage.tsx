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
import { LecturaModal } from './LecturaModal';
import { OrdenServicioModal } from './OrdenServicioModal';
import { LavadoModal } from './LavadoModal';
import { EstadoEquipoModal } from './EstadoEquipoModal';
import { MensajeWhatsappModal } from '@/modules/pedidos/MensajeWhatsappModal';
import { mensajeReporteAveria } from './mensajeMaquinaria';

interface InfoEquipo {
  estado: EstadoEquipo;
  clase: ClaseEquipo;
  horometro: number | null;
  km: number | null;
  aviso: AvisoServicio | null;
  avisoH: AvisoServicio | null;
  avisoK: AvisoServicio | null;
}

type FiltroMant = 'todos' | 'vencidos' | 'proximos' | 'al_dia';

function BarraServicio({ aviso, cada, etiqueta }: { aviso: AvisoServicio | null; cada: number | null; etiqueta: string }) {
  if (!aviso) {
    return (
      <div className="flo-mant-barra sin">
        <div className="fila"><span>{etiqueta}</span><span>{cada ? 'sin lectura' : 'sin intervalo'}</span></div>
        <div className="flo-meter"><i style={{ width: '0%' }} /></div>
      </div>
    );
  }
  const tono = aviso.nivel === 'vencido' ? 'var(--danger)' : aviso.nivel === 'proximo' ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="flo-mant-barra">
      <div className="fila">
        <span>{etiqueta} · cada {fmtNum(cada)} {aviso.unidad}</span>
        <strong style={{ color: tono }}>
          {aviso.restante <= 0 ? `vencido ${fmtNum(Math.abs(aviso.restante))} ${aviso.unidad}` : `faltan ${fmtNum(aviso.restante)} ${aviso.unidad}`}
        </strong>
      </div>
      <div className="flo-meter" style={{ ['--tone' as string]: tono }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(aviso.pct)}
        aria-label={`${etiqueta}: ${Math.round(aviso.pct)} % del intervalo`}><i style={{ width: `${aviso.pct}%` }} /></div>
    </div>
  );
}

/**
 * Catálogo de Control de Maquinaria y Vehículos (Flota y Servicio).
 * Muestra el estado y las horas de mantenimiento directamente en el catálogo.
 * Con botones rápidos ("Puro botón") táctiles en PC y móvil para registrar
 * horómetros, pedir servicios, registrar lavados y reportar averías con envío por WhatsApp.
 */
export function MaquinariaPage() {
  const { can, userRole } = usePermissions();
  const { user } = useSession();
  const navigate = useNavigate();
  const canWrite = can('maquinaria', 'escritura');
  const isAdmin = userRole === 'admin' || userRole === 'jefe';
  const actor = user?.email ?? 'sistema';
  const actorName = user?.user_metadata?.nombre || user?.email?.split('@')[0] || 'Usuario';

  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [lecturas, setLecturas] = useState<Map<string, LecturaVigente>>(new Map());
  const [ordenesAbiertas, setOrdenesAbiertas] = useState<Map<string, number>>(new Map());
  const [fotos, setFotos] = useState<Map<string, string>>(new Map());
  const [combEquipos, setCombEquipos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [filtro, setFiltro] = useState('');
  const [bucket, setBucket] = useState<BucketFlota | null>(null);
  const [clase, setClase] = useState<ClaseEquipo | 'todos'>('todos');
  const [propietario, setPropietario] = useState('');
  const [tipo, setTipo] = useState('');
  const [filtroMant, setFiltroMant] = useState<FiltroMant>('todos');

  // Modales generales
  const [catalogoOpen, setCatalogoOpen] = useState(false);
  const [resumenOpen, setResumenOpen] = useState(false);
  const [correoOpen, setCorreoOpen] = useState(false);
  const [nuevo, setNuevo] = useState(false);

  // Acciones directas por equipo ("puro botón")
  const [lecturaEquipo, setLecturaEquipo] = useState<MaquinariaEquipo | null>(null);
  const [servicioEquipo, setServicioEquipo] = useState<MaquinariaEquipo | null>(null);
  const [lavadoEquipo, setLavadoEquipo] = useState<MaquinariaEquipo | null>(null);
  const [averiaEquipo, setAveriaEquipo] = useState<MaquinariaEquipo | null>(null);
  const [whatsappModal, setWhatsappModal] = useState<{ titulo: string; texto: string } | null>(null);

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
  useRealtime(['maquinaria_equipos', 'maquinaria_catalogos', 'maquinaria_mantenimientos', 'maquinaria_documentos', 'maquinaria_fotos', 'maquinaria_ordenes_servicio', 'combustible_tanque_movimientos', 'maquinaria_lecturas'], () => { void cargar(); });

  const info = useMemo(() => {
    const m = new Map<string, InfoEquipo>();
    for (const e of equipos) {
      const lec = lecturas.get(e.id);
      const horo = lec?.horometro ?? null;
      const km = lec?.kilometraje ?? null;
      const aH = avisoServicio(e.mantenimiento_cada_hrs, horo, e.mantenimiento_base_hrs, 'h');
      const aK = avisoServicio(e.mantenimiento_cada_km, km, e.mantenimiento_base_km, 'km');
      const aviso = avisoMasUrgente(aH, aK);
      m.set(e.id, {
        estado: estadoEfectivo(e),
        clase: claseEquipo(e),
        horometro: horo,
        km,
        aviso,
        avisoH: aH,
        avisoK: aK,
      });
    }
    return m;
  }, [equipos, lecturas]);

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

    // Filtro por estado de servicio
    if (filtroMant === 'vencidos' && !(i.aviso && i.aviso.nivel === 'vencido')) return false;
    if (filtroMant === 'proximos' && !(i.aviso && i.aviso.nivel === 'proximo')) return false;
    if (filtroMant === 'al_dia' && !(i.aviso && i.aviso.nivel === 'ok')) return false;

    // Búsqueda por texto (incluyendo responsable)
    const extraMatch = e.responsable && norm(e.responsable).includes(norm(filtro));
    return coincideEquipo(e, filtro) || !!extraMatch;
  }), [equipos, info, bucket, clase, propietario, tipo, filtroMant, filtro]);

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
          <p className="flo-sub">{disponibles} equipo(s) en la flota · control de horas, servicios y lavados</p>
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
            <strong>{proximos.length} equipo(s)</strong> con servicio próximo o vencido (horas / km de Combustible y taller).{' '}
            <button type="button" className="btn-link" onClick={() => setFiltroMant(filtroMant === 'vencidos' || filtroMant === 'proximos' ? 'todos' : 'vencidos')}>
              {filtroMant === 'vencidos' || filtroMant === 'proximos' ? 'Ver todos los equipos' : 'Filtrar solo con alerta'}
            </button>
          </div>
        </div>
      )}

      {vinculosRotos.length > 0 && (
        <div className="aviso danger" style={{ marginBottom: '.6rem' }}>
          <span className="aviso-icono">🔗</span>
          <div>
            <strong>{vinculosRotos.length} equipo(s) desvinculados de Combustible.</strong>
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
            placeholder="🔍 Buscar equipo, encargado, marca, serial, placa…" aria-label="Buscar equipo" />
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

        {/* Píldoras de filtro rápido por estado de mantenimiento de horas / km */}
        <div className="flo-pills" role="group" aria-label="Estado de servicio">
          <button type="button" className="flo-pill" aria-pressed={filtroMant === 'todos'} onClick={() => setFiltroMant('todos')}>
            ⏱️ Todos los servicios
          </button>
          <button type="button" className="flo-pill" aria-pressed={filtroMant === 'vencidos'} onClick={() => setFiltroMant(filtroMant === 'vencidos' ? 'todos' : 'vencidos')}>
            ⛔ Servicios vencidos
          </button>
          <button type="button" className="flo-pill" aria-pressed={filtroMant === 'proximos'} onClick={() => setFiltroMant(filtroMant === 'proximos' ? 'todos' : 'proximos')}>
            ⚠️ Próximos a vencer
          </button>
          <button type="button" className="flo-pill" aria-pressed={filtroMant === 'al_dia'} onClick={() => setFiltroMant(filtroMant === 'al_dia' ? 'todos' : 'al_dia')}>
            ✅ Al día
          </button>
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
        <div key={g} style={{ marginBottom: '1.2rem' }}>
          <div className="flo-grupo"><span>🏢 {g}</span><span className="n">{eqs.length}</span></div>
          <div style={{ display: 'grid', gap: '.65rem', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {eqs.map((e) => {
              const i = info.get(e.id);
              if (!i) return null;
              const st = ESTADOS_EQUIPO[i.estado];
              const foto = fotos.get(e.id);
              const nOrd = ordenesAbiertas.get(e.id) ?? 0;
              const cl = CLASES_EQUIPO.find((c) => c.id === i.clase);
              const alerta = !!i.aviso && i.aviso.nivel !== 'ok' && i.estado !== 'retirada';
              const esVencido = i.aviso?.nivel === 'vencido';

              return (
                <div key={e.id} className={`flo-card-catalogo${alerta ? (esVencido ? ' vencido' : ' alerta') : ''}${e.activo ? '' : ' inactivo'}`}>
                  {/* Cabecera del equipo */}
                  <div className="flo-card-top">
                    <div className="flo-card-title">
                      <div className="flo-card-icon">
                        {foto ? <img src={foto} alt="" loading="lazy" /> : <span>{cl?.icon ?? '🚜'}</span>}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <Link to={`/app/maquinaria/equipo/${e.id}`} className="flo-card-nom" title="Abrir expediente">
                          {e.equipo}
                        </Link>
                        <div className="flo-card-sub">
                          {[e.marca, e.modelo, e.placa || e.serial].filter(Boolean).join(' · ') || e.tipo || '—'}
                        </div>
                      </div>
                    </div>
                    <span className={`flo-chip tone-${st.tono}`}>{st.icon} {st.label}</span>
                  </div>

                  {/* Encargado responsable y datos de ubicación / órdenes */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem .8rem', fontSize: '.76rem', color: 'var(--text-muted)' }}>
                    {e.responsable && (
                      <span className="flo-card-resp">👤 {e.responsable}</span>
                    )}
                    {e.ubicacion && <span>📍 {e.ubicacion}</span>}
                    {nOrd > 0 && <span style={{ color: 'var(--primary)', fontWeight: 600 }}>🧾 {nOrd} orden(es) abierta(s)</span>}
                  </div>

                  {/* Barra de servicio: Horas y Kilómetros en el catálogo */}
                  <div style={{ display: 'grid', gap: '.4rem', background: 'var(--bg-1)', padding: '.45rem .6rem', borderRadius: 'var(--r-md)' }}>
                    <BarraServicio aviso={i.avisoH} cada={e.mantenimiento_cada_hrs} etiqueta="Horas" />
                    {(e.mantenimiento_cada_km || i.km != null) && (
                      <BarraServicio aviso={i.avisoK} cada={e.mantenimiento_cada_km} etiqueta="Kilometraje" />
                    )}
                  </div>

                  {/* Botonera táctil: "Puro botón" para PC y teléfono */}
                  <div className="flo-acciones-grid">
                    <button type="button" className="flo-btn-tactil" onClick={() => setLecturaEquipo(e)} title="Cargar horómetro o kilometraje">
                      ⏱️ Horómetro
                    </button>
                    <button type="button" className="flo-btn-tactil primary" onClick={() => setServicioEquipo(e)} title="Crear orden de servicio">
                      🔧 Servicio
                    </button>
                    <button type="button" className="flo-btn-tactil" onClick={() => setLavadoEquipo(e)} title="Registrar lavado del equipo">
                      🚿 Lavado
                    </button>
                    <button type="button" className="flo-btn-tactil danger" onClick={() => setAveriaEquipo(e)} title="Reportar avería">
                      ⚠️ Avería
                    </button>
                    <Link to={`/app/maquinaria/equipo/${e.id}`} className="flo-btn-tactil" style={{ gridColumn: 'span 2' }}>
                      📂 Ver Expediente
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Modales generales */}
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

      {/* Acciones directas ("puro botón") */}
      {lecturaEquipo && (
        <LecturaModal
          equipo={lecturaEquipo}
          vigente={lecturas.get(lecturaEquipo.id) ?? { horometro: null, kilometraje: null, horometro_fecha: null, km_fecha: null, horometro_origen: null, km_origen: null }}
          isAdmin={isAdmin}
          onClose={() => setLecturaEquipo(null)}
          onSaved={() => void cargar()}
        />
      )}

      {servicioEquipo && (
        <OrdenServicioModal
          equipo={servicioEquipo}
          horometro={info.get(servicioEquipo.id)?.horometro ?? null}
          kilometraje={info.get(servicioEquipo.id)?.km ?? null}
          aviso={info.get(servicioEquipo.id)?.aviso ?? null}
          puedeSalidas={can('inventario', 'escritura')}
          puedePedidos={can('pedidos', 'escritura')}
          actor={{ email: actor, nombre: actorName }}
          onClose={() => setServicioEquipo(null)}
          onCreated={() => void cargar()}
        />
      )}

      {lavadoEquipo && (
        <LavadoModal
          equipo={lavadoEquipo}
          horometro={info.get(lavadoEquipo.id)?.horometro ?? null}
          km={info.get(lavadoEquipo.id)?.km ?? null}
          ultimo={null}
          actor={{ email: actor, nombre: actorName }}
          onClose={() => setLavadoEquipo(null)}
          onSaved={() => void cargar()}
        />
      )}

      {averiaEquipo && (
        <EstadoEquipoModal
          equipo={averiaEquipo}
          modo="averia"
          onClose={() => setAveriaEquipo(null)}
          onSaved={() => {
            const txt = mensajeReporteAveria({
              equipoNombre: averiaEquipo.equipo,
              placaOSerial: averiaEquipo.placa || averiaEquipo.serial,
              horometro: info.get(averiaEquipo.id)?.horometro ?? null,
              kilometraje: info.get(averiaEquipo.id)?.km ?? null,
              ubicacion: averiaEquipo.ubicacion,
              falla: 'Reportada averiada desde Catálogo',
              reportadoPor: actorName,
            });
            setWhatsappModal({ titulo: `Avería · ${averiaEquipo.equipo}`, texto: txt });
            void cargar();
          }}
        />
      )}

      {whatsappModal && (
        <MensajeWhatsappModal
          titulo={whatsappModal.titulo}
          texto={whatsappModal.texto}
          onClose={() => setWhatsappModal(null)}
        />
      )}
    </div>
  );
}
