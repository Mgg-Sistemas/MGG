/* ============================================================
   Golden Touch · Administración · pestaña «Responsabilidad»
   Cuatro vistas: Carga por analista (gerencia), Mis responsabilidades
   (analista, ordenable), Avisos (bandeja interna) y Asignar/compartir.
   Responsables = usuarios del sistema. Herencia por carpeta.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { listUsuarios } from '@/modules/usuarios/usuarios.repository';
import type { Usuario } from '@/shared/lib/types';
import { STATUS_VENCIMIENTO_LABEL, type AdminRepo, type Aviso, type DocumentoEmpresa, type Empresa, type ObjetivoResp, type Responsabilidad } from './admin.repository';
import { agendaVencimientos, textoDiasRestantes, type ItemAgenda } from './administracionAgenda';
import {
  cargaPorAnalista, misResponsabilidades, nombrePorEmail, etiquetaObjetivo,
  type CargaAnalista, type OrdenMisResp,
} from './administracionResponsabilidad';
import { TIPO_AVISO_LABEL, construirAvisos, sincronizarAvisos } from './administracionAvisos';
import { leerCarpetasPersonalizadas } from './GestionarCarpetasModal';

type Vista = 'carga' | 'mias' | 'avisos' | 'asignar';
const ORDEN_LABEL: Record<OrdenMisResp, string> = {
  prioridad: 'Prioridad', estatus: 'Estatus', vigencia_asc: 'Más próximo a vencer', vigencia_desc: 'Mayor vigencia',
};


export function ResponsabilidadTab({ repo, empresaClave, puedeEscribir = true }: {
  repo: AdminRepo;
  empresaClave: string | null;
  empresas: Empresa[];
  puedeEscribir?: boolean;
}) {
  const [items, setItems] = useState<ItemAgenda[]>([]);
  const [docs, setDocs] = useState<DocumentoEmpresa[]>([]);
  const [resp, setResp] = useState<Responsabilidad[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>('carga');
  const [analista, setAnalista] = useState('');
  const [orden, setOrden] = useState<OrdenMisResp>('vigencia_asc');
  const [ocupado, setOcupado] = useState(false);

  // Asignar
  const [objetivoSel, setObjetivoSel] = useState('');
  const [usuarioSel, setUsuarioSel] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      await repo.refrescarEnvios();
      const [documentos, movimientos, gestiones, envios, responsabilidades, us, avs] = await Promise.all([
        repo.listDocumentos(empresaClave ?? undefined),
        repo.listMovimientos(empresaClave ?? undefined),
        repo.listGestiones(empresaClave ?? undefined),
        repo.listEnvios(),
        repo.listResponsabilidades(empresaClave ?? undefined),
        listUsuarios().catch(() => [] as Usuario[]),
        repo.listAvisos(empresaClave ?? undefined),
      ]);
      const itemsAgenda = agendaVencimientos({ documentos, movimientos, gestiones, envios });
      const carpetasCustom = leerCarpetasPersonalizadas(empresaClave);
      const carpetasMap = new Map(carpetasCustom.map((c) => [c.id, { responsable: c.responsable }]));
      const docMapa = new Map(documentos.map((d) => [d.id, d]));

      let avisosConsolidados = avs;
      if (puedeEscribir) {
        try {
          avisosConsolidados = await sincronizarAvisos(repo, itemsAgenda, responsabilidades, docMapa, avs, carpetasMap);
        } catch {
          // best-effort
        }
      }

      setItems(itemsAgenda);
      setDocs(documentos);
      setResp(responsabilidades);
      setUsuarios(us);
      setAvisos(avisosConsolidados);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la responsabilidad.');
    } finally { setCargando(false); }
  }, [repo, empresaClave, puedeEscribir]);
  useEffect(() => { void cargar(); }, [cargar]);

  const docPorId = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const nombres = useMemo(() => nombrePorEmail(usuarios), [usuarios]);
  const carpetasMap = useMemo(() => new Map(leerCarpetasPersonalizadas(empresaClave).map((c) => [c.id, { responsable: c.responsable }])), [empresaClave]);
  // id de objetivo → nombre legible (documentos por nombre; gestiones/gastos por su título de agenda).
  const nombresObjetivo = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs) m.set(d.id, d.nombre);
    for (const i of items) if (!m.has(i.id)) m.set(i.id, i.titulo);
    return m;
  }, [docs, items]);
  const carga = useMemo(() => cargaPorAnalista(items, resp, docPorId, carpetasMap), [items, resp, docPorId, carpetasMap]);
  const mias = useMemo(() => (analista ? misResponsabilidades(analista, items, resp, docPorId, orden, carpetasMap) : []), [analista, items, resp, docPorId, orden, carpetasMap]);

  const optUsuarios = usuarios.map((u) => ({ value: u.email, label: u.nombre?.trim() || u.email, hint: u.email }));
  const nombre = (email: string) => nombres.get(email) ?? email;

  // Objetivos para asignar: documentos, carpetas (slugs distintos) y gestiones del set cargado.
  const optObjetivos = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const carpetas = new Set<string>();
    for (const d of docs) {
      opts.push({ value: `documento:${d.id}`, label: `📄 ${d.nombre}` });
      if (d.carpeta) carpetas.add(d.carpeta);
    }
    for (const c of carpetas) opts.push({ value: `carpeta:${c}`, label: `📁 Carpeta: ${c}` });
    for (const i of items) if (i.origen === 'gestion') opts.push({ value: `gestion:${i.id}`, label: `💼 ${i.titulo}` });
    return opts;
  }, [docs, items]);

  async function asignar() {
    if (!puedeEscribir) { toast('Sin permiso de escritura.', 'warning', { silent: true }); return; }
    if (!objetivoSel || !usuarioSel) { toast('Elige el objetivo y el responsable.', 'warning', { silent: true }); return; }
    const [tipo, ...rest] = objetivoSel.split(':');
    const objetivoId = rest.join(':');
    setOcupado(true);
    try {
      await repo.asignarResponsabilidad({ empresaClave: empresaClave || 'GT', usuarioEmail: usuarioSel, objetivoTipo: tipo as ObjetivoResp, objetivoId });
      toast('Responsable asignado.', 'success');
      setUsuarioSel('');
      await cargar();
    } catch (e) { toast(`No se pudo asignar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }
  async function quitar(id: string) {
    if (!puedeEscribir) { toast('Sin permiso de escritura.', 'warning', { silent: true }); return; }
    setOcupado(true);
    try { await repo.quitarResponsabilidad(id); toast('Responsable quitado.', 'info'); await cargar(); }
    catch (e) { toast(`No se pudo quitar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }
  async function generarAvisos() {
    if (!puedeEscribir) { toast('Sin permiso de escritura.', 'warning', { silent: true }); return; }
    setOcupado(true);
    try {
      const nuevos = construirAvisos(items, resp, docPorId, avisos, carpetasMap);
      for (const a of nuevos) await repo.crearAviso(a);
      toast(nuevos.length ? `${nuevos.length} aviso(s) generado(s).` : 'No hay avisos nuevos por generar.', 'success');
      await cargar();
    } catch (e) { toast(`No se pudieron generar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }
  async function alternarLeido(a: Aviso) {
    if (!puedeEscribir) { toast('Sin permiso de escritura.', 'warning', { silent: true }); return; }
    try { await repo.marcarAvisoLeido(a.id, !a.leido); await cargar(); }
    catch (e) { toast(`No se pudo marcar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
  }

  return (
    <div style={{ display: 'grid', gap: '.75rem' }}>
      <div className="view-toggle" role="tablist" aria-label="Vista de responsabilidad">
        <button className={vista === 'carga' ? 'active' : ''} onClick={() => setVista('carga')}>👥 Carga por analista</button>
        <button className={vista === 'mias' ? 'active' : ''} onClick={() => setVista('mias')}>🙋 Mis responsabilidades</button>
        <button className={vista === 'avisos' ? 'active' : ''} onClick={() => setVista('avisos')}>🔔 Avisos</button>
        {puedeEscribir && <button className={vista === 'asignar' ? 'active' : ''} onClick={() => setVista('asignar')}>➕ Asignar</button>}
      </div>

      {error && <div className="adm-aviso">No se pudo leer: {/relation|does not exist|schema cache|jwt|sesi|permission/i.test(error) ? 'inicia sesión o la base aún no tiene las tablas del módulo.' : error}</div>}

      {cargando ? (
        <p className="muted">Leyendo…</p>
      ) : vista === 'carga' ? (
        carga.length === 0 ? <EmptyState icon="👥" message="Nadie tiene ítems a cargo todavía. Asigna responsables en «Asignar» o en la carpeta/documento." /> : (
          <div style={{ display: 'grid', gap: '.5rem' }}>
            {carga.map((c: CargaAnalista) => (
              <details key={c.usuarioEmail} className="card" style={{ padding: '.6rem .85rem' }}>
                <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
                  <strong style={{ fontSize: '.86rem' }}>{nombre(c.usuarioEmail)}</strong>
                  <span style={{ display: 'inline-flex', gap: '.3rem' }}>
                    <span className="adm-badge suspendido">{c.vencidos} vencidos</span>
                    <span className="adm-badge">{c.porVencer} por vencer</span>
                    <span className="adm-badge activo">{c.alDia} al día</span>
                  </span>
                </summary>
                <div className="adm-tabla" style={{ marginTop: '.5rem' }}>
                  <table><tbody>
                    {c.items.map((i) => (
                      <tr key={`${i.origen}-${i.id}`}>
                        <td style={{ fontSize: '.8rem' }}>{i.titulo}</td>
                        <td style={{ fontSize: '.78rem' }}>{STATUS_VENCIMIENTO_LABEL[i.status]}</td>
                        <td style={{ fontSize: '.78rem' }} className="muted">{textoDiasRestantes(i.diasRestantes)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              </details>
            ))}
          </div>
        )
      ) : vista === 'mias' ? (
        <div style={{ display: 'grid', gap: '.5rem' }}>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ minWidth: 220 }}>
              <SearchSelect options={optUsuarios} value={analista} onChange={setAnalista} placeholder="Elige el analista…" />
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
              <span className="muted hint" style={{ fontSize: '.74rem' }}>Ordenar por</span>
              <select className="input input-sm" value={orden} onChange={(e) => setOrden(e.target.value as OrdenMisResp)}>
                {(Object.keys(ORDEN_LABEL) as OrdenMisResp[]).map((o) => <option key={o} value={o}>{ORDEN_LABEL[o]}</option>)}
              </select>
            </label>
          </div>
          {!analista ? (
            <p className="muted hint">Elige un analista para ver lo que tiene a cargo.</p>
          ) : mias.length === 0 ? (
            <EmptyState icon="🙋" message="Este analista no tiene nada a cargo con este filtro." />
          ) : (
            <div className="adm-tabla" style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
              <table>
                <thead><tr><th>Qué</th><th>Estado</th><th>Vence</th><th>Prioridad</th></tr></thead>
                <tbody>
                  {mias.map((i) => (
                    <tr key={`${i.origen}-${i.id}`}>
                      <td style={{ fontSize: '.82rem' }}>{i.titulo}</td>
                      <td style={{ fontSize: '.8rem' }}>{STATUS_VENCIMIENTO_LABEL[i.status]}</td>
                      <td style={{ fontSize: '.8rem' }} className="muted">{textoDiasRestantes(i.diasRestantes)}</td>
                      <td style={{ fontSize: '.8rem' }}>{i.prioridad ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : vista === 'avisos' ? (
        <div style={{ display: 'grid', gap: '.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {puedeEscribir && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void generarAvisos()} disabled={ocupado}>↻ Generar avisos de lo que vence</button>}
          </div>
          {avisos.length === 0 ? <EmptyState icon="🔔" message="Sin avisos. Se generan automáticamente al vencer o estar por vencer los ítems." /> : (
            <div style={{ display: 'grid', gap: '.35rem' }}>
              {avisos.map((a) => (
                <div key={a.id} className="card" style={{ padding: '.5rem .75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', opacity: a.leido ? 0.6 : 1 }}>
                  <div style={{ minWidth: 0 }}>
                    <span className={`adm-badge ${a.tipo === 'vencido' ? 'suspendido' : ''}`} style={{ marginRight: '.4rem' }}>{TIPO_AVISO_LABEL[a.tipo] ?? a.tipo}</span>
                    <strong style={{ fontSize: '.82rem' }}>{a.texto}</strong>
                    {a.responsableEmail && <span className="muted hint" style={{ fontSize: '.72rem', display: 'block' }}>👤 {nombre(a.responsableEmail)}</span>}
                  </div>
                  {puedeEscribir && <button type="button" className="btn btn-xs btn-ghost" onClick={() => void alternarLeido(a)}>{a.leido ? 'Marcar no leído' : 'Marcar leído'}</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* asignar */
        <div style={{ display: 'grid', gap: '.6rem' }}>
          <div className="card" style={{ padding: '.75rem' }}>
            <div className="card-title" style={{ fontSize: '.9rem' }}>Asignar / compartir responsabilidad</div>
            <p className="muted hint" style={{ margin: '.2rem 0 .5rem', fontSize: '.74rem' }}>El responsable es un usuario del sistema. Un documento sin responsable propio hereda el de su carpeta; una carpeta puede compartirse entre varios.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: '.5rem', alignItems: 'end' }}>
              <div><span className="muted hint" style={{ fontSize: '.72rem' }}>Objetivo</span><SearchSelect options={optObjetivos} value={objetivoSel} onChange={setObjetivoSel} placeholder="Documento, carpeta o gestión…" /></div>
              <div><span className="muted hint" style={{ fontSize: '.72rem' }}>Responsable</span><SearchSelect options={optUsuarios} value={usuarioSel} onChange={setUsuarioSel} placeholder="Usuario del sistema…" /></div>
              <button type="button" className="btn btn-primary btn-sm" style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }} onClick={() => void asignar()} disabled={ocupado}>Asignar</button>
            </div>
          </div>
          {resp.length === 0 ? <p className="muted hint">Sin responsabilidades asignadas.</p> : (
            <div className="adm-tabla" style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
              <table>
                <thead><tr><th>Responsable</th><th>Objetivo</th><th style={{ textAlign: 'right' }}></th></tr></thead>
                <tbody>
                  {resp.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontSize: '.82rem' }}>{nombre(r.usuarioEmail)}</td>
                      <td style={{ fontSize: '.8rem' }} className="muted">{etiquetaObjetivo(r.objetivoTipo, r.objetivoId, nombresObjetivo)}</td>
                      <td style={{ textAlign: 'right' }}><button type="button" className="btn btn-xs btn-ghost" style={{ color: '#ef4444' }} onClick={() => void quitar(r.id)} disabled={ocupado}>Quitar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
