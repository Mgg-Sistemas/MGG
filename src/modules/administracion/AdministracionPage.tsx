/* ============================================================
   Golden Touch · Administración — «Gastos fijos por servicio»
   Multi-empresa (lista propia del módulo): la cabecera trae el selector de
   EMPRESA (activas + «Todas»), recordado por navegador, y «⚙ Gestionar
   empresas». Toda la vista se filtra por la empresa elegida. Tres pestañas:
   Gastos fijos (viva) · Movimientos/Histórico · Reporte (Fase 2/3).
   Estilo del sistema (view-toggle, tarjetas, tokens). Los datos entran por
   un repo inyectado: Supabase en la app; en memoria en la demo (DEV).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { usePwaInstall } from '@/shared/hooks/usePwaInstall';
import { esErrorTablaAusente, extraerMensajeError } from './adminErrores';
import { crearRepoSupabase, type AdminRepo, type Empresa, type DocumentoEmpresa } from './admin.repository';
import { crearPreferenciasAdmin, TODAS, type PreferenciasAdmin, type TabAdmin } from './administracionPreferencias';
import { EmpresasModal } from './EmpresasModal';
import { GastosFijosTab } from './GastosFijosTab';
import { MovimientosTab } from './MovimientosTab';
import { HonorariosTab } from './HonorariosTab';
import { AgendaTab } from './AgendaTab';
import { ResponsabilidadTab } from './ResponsabilidadTab';
import { ReporteTab } from './ReporteTab';
import { DocumentosTab } from './DocumentosTab';
import { ConfiguracionTab } from './ConfiguracionTab';
import { TableroModuloTab } from './TableroModuloTab';
import { AuditoriaTab } from './AuditoriaTab';
import { NotificacionesAdminModal } from './NotificacionesAdminModal';
import {
  evaluarAlertasDocumentos,
  emitirNotificacionPushNativa,
  dispararSonidoAlertaAdmin,
} from './notificacionesAdministracion';
import './administracion.css';

const PESTANAS: { id: TabAdmin; label: string }[] = [
  { id: 'tablero', label: '📊 Tablero' },
  { id: 'gastos', label: '📌 Gastos fijos' },
  { id: 'movimientos', label: '📒 Movimientos / Histórico' },
  { id: 'honorarios', label: '💼 Honorarios' },
  { id: 'documentos', label: '📁 Documentos y Permisos' },
  { id: 'agenda', label: '🗓 Agenda' },
  { id: 'responsabilidad', label: '👥 Responsabilidad' },
  { id: 'reporte', label: '📊 Reporte' },
  { id: 'auditoria', label: '📜 Auditoría' },
  { id: 'config', label: '⚙ Configuración' },
];

export function AdministracionPage({ repo: repoDado, prefs: prefsDadas, aviso, puedeEscribir = true, puedeFull = true }: {
  repo?: AdminRepo;
  prefs?: PreferenciasAdmin;
  /** Franja arriba de todo (la demo avisa que es de prueba). */
  aviso?: ReactNode;
  /** Permiso de escritura del módulo (registrar/generar/importar/editar). La demo lo deja en true. */
  puedeEscribir?: boolean;
  /** Full control: además gestiona la lista de empresas (admin_empresas). */
  puedeFull?: boolean;
} = {}) {
  const repo = useMemo(() => repoDado ?? crearRepoSupabase(), [repoDado]);
  const prefs = useMemo(() => prefsDadas ?? crearPreferenciasAdmin(), [prefsDadas]);

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [empresaSel, setEmpresaSel] = useState<string>(() => prefs.leerEmpresa());
  const [tab, setTab] = useState<TabAdmin>(() => prefs.leerTab());
  const [gestionar, setGestionar] = useState(false);
  const [verNotificaciones, setVerNotificaciones] = useState(false);
  const [todosLosDocs, setTodosLosDocs] = useState<DocumentoEmpresa[]>([]);
  const { isInstallable, promptInstall } = usePwaInstall();

  const cargarEmpresas = useCallback(async () => {
    setError(null);
    try { setEmpresas(await repo.listEmpresas()); }
    catch (e) { setError(extraerMensajeError(e, 'No se pudieron leer las empresas.')); }
  }, [repo]);

  const cargarDocsAlerta = useCallback(async () => {
    try {
      const d = await repo.listDocumentos();
      setTodosLosDocs(d);
    } catch { /* ignore */ }
  }, [repo]);

  useEffect(() => { void cargarEmpresas(); }, [cargarEmpresas]);
  useEffect(() => { void cargarDocsAlerta(); }, [cargarDocsAlerta]);

  // Si la empresa elegida ya no está activa (la desactivaron/borraron), vuelve a «Todas».
  useEffect(() => {
    if (empresaSel !== TODAS && empresas.length && !empresas.some((e) => e.clave === empresaSel && e.activa)) {
      setEmpresaSel(TODAS);
      prefs.guardarEmpresa(TODAS);
    }
  }, [empresas, empresaSel, prefs]);

  const activas = useMemo(() => empresas.filter((e) => e.activa), [empresas]);
  const empresaClave = empresaSel === TODAS ? null : empresaSel;

  const elegirEmpresa = (v: string) => { setEmpresaSel(v); prefs.guardarEmpresa(v); };
  const elegirTab = (t: TabAdmin) => { setTab(t); prefs.guardarTab(t); };

  // Alertas de documentos según la regla de tiempos establecidos y descartes
  const { nuevasParaSonar, totalSilenciadas } = useMemo(() => {
    return evaluarAlertasDocumentos(
      empresaClave ? todosLosDocs.filter((d) => d.empresaClave === empresaClave) : todosLosDocs,
    );
  }, [todosLosDocs, empresaClave]);

  // Emitir notificación PWA nativa y sonido al detectar alertas activas
  useEffect(() => {
    if (nuevasParaSonar.length === 0) return;
    try {
      const storageKey = 'mgg.admin.alertas_notificadas_session';
      const raw = sessionStorage.getItem(storageKey);
      const yaNotificados = new Set<string>(raw ? JSON.parse(raw) : []);

      const pendientes = nuevasParaSonar.filter((a) => !yaNotificados.has(`${a.docId}_${a.hitoActual}`));
      if (pendientes.length === 0) return;

      for (const p of pendientes) {
        yaNotificados.add(`${p.docId}_${p.hitoActual}`);
      }
      sessionStorage.setItem(storageKey, JSON.stringify(Array.from(yaNotificados)));

      // 1. Sonido de alerta
      dispararSonidoAlertaAdmin();

      // 2. Notificación push emergente en el dispositivo
      const masUrgente = pendientes[0];
      const titulo = pendientes.length === 1
        ? `💼 Alerta de Documento · ${masUrgente.empresaClave}`
        : `💼 Administración: ${pendientes.length} alertas de vigencia`;
      const cuerpo = pendientes.length === 1
        ? `«${masUrgente.nombre}»: ${masUrgente.mensaje}`
        : `«${masUrgente.nombre}» y otros documentos requieren atención.`;

      void emitirNotificacionPushNativa(titulo, cuerpo, '/administracion');
    } catch { /* best-effort */ }
  }, [nuevasParaSonar]);

  return (
    <div>
      {aviso}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>💼 Administración</h1>
          <p className="muted hint" style={{ margin: '.25rem 0 0' }}>Gastos fijos por servicio: plantillas, histórico y reporte.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
            <span className="muted hint">Empresa</span>
            <select className="input" value={empresaSel} onChange={(e) => elegirEmpresa(e.target.value)} aria-label="Empresa" style={{ minWidth: 190 }}>
              <option value={TODAS}>Todas las empresas</option>
              {activas.map((e) => <option key={e.id} value={e.clave}>{e.nombre}</option>)}
            </select>
          </label>
          {puedeFull && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGestionar(true)}>⚙ Gestionar empresas</button>}

          {/* Botón PWA: Instalable en teléfono o escritorio si el navegador lo soporta */}
          {isInstallable && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void promptInstall()}
              title="Instalar MGG en la pantalla de inicio o escritorio"
            >
              📲 Instalar App
            </button>
          )}

          {/* Campana de Alertas y Notificaciones Push descartables */}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}
            onClick={() => setVerNotificaciones(true)}
            title={
              nuevasParaSonar.length > 0
                ? `${nuevasParaSonar.length} alertas activas de vencimiento`
                : totalSilenciadas > 0
                ? `${totalSilenciadas} alertas silenciadas temporalmente`
                : 'Centro de Alertas y Notificaciones'
            }
          >
            <span style={{ fontSize: '1rem' }}>{nuevasParaSonar.length > 0 ? '🔔' : '🔕'}</span>
            {nuevasParaSonar.length > 0 && (
              <span
                style={{
                  background: '#ef4444',
                  color: '#fff',
                  borderRadius: '10px',
                  fontSize: '.66rem',
                  padding: '1px 6px',
                  fontWeight: 700,
                  lineHeight: '1.2',
                }}
              >
                {nuevasParaSonar.length}
              </span>
            )}
          </button>

          <div className="view-toggle" role="tablist" aria-label="Vista de administración">
            {PESTANAS.map((p) => (
              <button key={p.id} className={tab === p.id ? 'active' : ''} onClick={() => elegirTab(p.id)}>{p.label}</button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="adm-aviso">
          No se pudieron leer las empresas: {esErrorTablaAusente(error) || /sesi|jwt|auth|401|permission|does not exist/i.test(error)
            ? 'las tablas del módulo aún no han sido aplicadas en la base de datos (ejecutar script SQL de administración).'
            : error}
        </div>
      )}

      {tab === 'tablero' && <TableroModuloTab repo={repo} empresaClave={empresaClave} empresas={empresas} puedeEscribir={puedeEscribir} />}
      {tab === 'gastos' && <GastosFijosTab repo={repo} empresaClave={empresaClave} empresas={empresas} puedeEscribir={puedeEscribir} />}
      {tab === 'movimientos' && <MovimientosTab repo={repo} empresaClave={empresaClave} empresas={empresas} puedeEscribir={puedeEscribir} />}
      {tab === 'honorarios' && <HonorariosTab repo={repo} empresaClave={empresaClave} empresas={empresas} puedeEscribir={puedeEscribir} />}
      {tab === 'documentos' && <DocumentosTab repo={repo} empresaClave={empresaClave} empresas={empresas} puedeEscribir={puedeEscribir} />}
      {tab === 'agenda' && <AgendaTab repo={repo} empresaClave={empresaClave} empresas={empresas} />}
      {tab === 'responsabilidad' && <ResponsabilidadTab repo={repo} empresaClave={empresaClave} empresas={empresas} puedeEscribir={puedeEscribir} />}
      {tab === 'reporte' && <ReporteTab repo={repo} empresaClave={empresaClave} empresas={empresas} />}
      {tab === 'auditoria' && <AuditoriaTab documentos={todosLosDocs} empresas={empresas} empresaClave={empresaClave} />}
      {tab === 'config' && <ConfiguracionTab repo={repo} empresas={empresas} puedeFull={puedeFull} puedeEscribir={puedeEscribir} onGestionarEmpresas={() => setGestionar(true)} />}

      {gestionar && puedeFull && <EmpresasModal repo={repo} onClose={() => setGestionar(false)} onChanged={() => void cargarEmpresas()} />}

      {verNotificaciones && (
        <NotificacionesAdminModal
          documentos={todosLosDocs}
          empresaClave={empresaClave}
          onClose={() => {
            setVerNotificaciones(false);
            void cargarDocsAlerta();
          }}
          onVerDocumento={() => {
            setTab('documentos');
          }}
        />
      )}
    </div>
  );
}

/** La ruta de la app real: toma los permisos del rol y los pasa a la página.
 *  (La demo DEV usa `AdministracionPage` directo, fuera del PermissionsProvider.) */
export function AdministracionPageApp() {
  const { can } = usePermissions();
  return <AdministracionPage puedeEscribir={can('administracion', 'escritura')} puedeFull={can('administracion', 'full')} />;
}
