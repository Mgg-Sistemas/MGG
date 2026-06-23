import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut, useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type { ModuleKey } from '@/modules/usuarios/permisos.repository';
import { NotificacionesPanel } from '@/modules/notificaciones/NotificacionesPanel';
import { GlobalSearch } from '@/shared/ui/GlobalSearch';
import { TasaChip } from '@/modules/tesoreria/TasaChip';
import { toast } from '@/shared/ui/Toast';
import type { CapturasManual } from '@/shared/lib/manualUsuarioPdf';
import { descargarRespaldoSql, enviarRespaldoPorCorreo, chequearRespaldoAutomatico, puedeRespaldar, BACKUP_EMAIL } from '@/shared/lib/backup';
import { Modal } from '@/shared/ui/Modal';
import { AvisoActualizacion } from '@/shared/ui/AvisoActualizacion';
import { scanStockAndNotify, unreadCount } from '@/modules/notificaciones/notif.repository';
import { initSound } from '@/shared/lib/sound';
import { onNotifRefresh } from '@/shared/lib/notify';
import { useRealtime } from '@/shared/lib/useRealtime';
import { prefetchRoute } from '@/shared/lib/routePrefetch';

const SIDEBAR_KEY = 'mgg.sidebar.collapsed';

/** Vistas que se capturan en vivo para ilustrar el manual (key → ruta → permiso). */
const CAPTURA_RUTAS: Array<{ key: string; ruta: string; permiso: ModuleKey }> = [
  { key: 'dashboard', ruta: '/app/dashboard', permiso: 'dashboard' },
  { key: 'pedidos', ruta: '/app/pedidos', permiso: 'pedidos' },
  { key: 'proveedores', ruta: '/app/proveedores', permiso: 'proveedores' },
  { key: 'inventario', ruta: '/app/inventario', permiso: 'inventario' },
  { key: 'produccion', ruta: '/app/produccion', permiso: 'produccion' },
  { key: 'salidas', ruta: '/app/salidas', permiso: 'salidas' },
  { key: 'usuarios', ruta: '/app/usuarios', permiso: 'usuarios' },
  { key: 'ajustes', ruta: '/app/ajustes', permiso: 'ajustes' },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function AppShell() {
  const { user } = useSession();
  const { can, role } = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const showOperacion = can('dashboard') || can('pedidos') || can('proveedores') || can('inventario') || can('produccion') || can('salidas') || can('cocina') || can('combustible') || can('maquinaria') || can('acopio') || can('ventas') || can('tesoreria');
  // El "Menú del Sistema" (manual HTML) está disponible para todos, así que la
  // sección Sistema siempre se muestra.
  const showSistema = true;
  // Manual de Sistema (PDF con capturas): oculto por ahora (se retomará más adelante).
  const MOSTRAR_MANUAL = false;
  const manualSistemaUrl = `${import.meta.env.BASE_URL}manual-sistema.html`;
  const [notifOpen, setNotifOpen] = useState(false);
  const [descargandoManual, setDescargandoManual] = useState(false);
  const [descargandoBackup, setDescargandoBackup] = useState(false);
  const mostrarRespaldo = puedeRespaldar(role);
  const [unread, setUnread] = useState(0);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  });

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  }

  // En móvil (≤768px) el sidebar es un drawer deslizable; en desktop, colapsa a íconos.
  const [drawerOpen, setDrawerOpen] = useState(false);
  function handleMenuBtn() {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) setDrawerOpen((o) => !o);
    else toggleSidebar();
  }
  const closeDrawer = () => setDrawerOpen(false);
  // Cierra el drawer al cambiar de ruta (navegar desde el menú en móvil).
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  async function refreshUnread() {
    try {
      setUnread(await unreadCount());
    } catch {
      setUnread(0);
    }
  }

  // Al montar (con sesión activa): pintamos primero el contador (rápido) y
  // disparamos el scan de stock en segundo plano (no bloquea el render).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void refreshUnread();
    scanStockAndNotify()
      .then(() => { if (!cancelled) void refreshUnread(); })
      .catch(() => {/* RLS u offline: el contador inicial sigue válido */});
    return () => { cancelled = true; };
  }, [user?.id]);

  // Inicializa el contexto de audio (se "desbloquea" en el primer click/tecla).
  useEffect(() => { initSound(); }, []);

  // Cuando cualquier `notify()` persista en BD, refresca el contador de la campana.
  useEffect(() => onNotifRefresh(() => { void refreshUnread(); }), []);
  // Realtime: el contador se actualiza en vivo si OTRO usuario me genera una notificación.
  useRealtime(['notificaciones'], () => { void refreshUnread(); });

  async function handleLogout() {
    await signOut();
    navigate('/login');
  }

  function handleOpenNotif() {
    setNotifOpen(true);
  }

  function handleAllRead() {
    setUnread(0);
  }

  // Genera el manual capturando en vivo (html2canvas) cada vista a la que el
  // usuario tiene acceso, luego arma el PDF con esas capturas embebidas.
  async function handleManual() {
    if (descargandoManual) return;
    setDescargandoManual(true);
    const rutaOriginal = location.pathname;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const objetivos = CAPTURA_RUTAS.filter((r) => can(r.permiso));
      const capturas: CapturasManual = {};
      const fondo = getComputedStyle(document.body).backgroundColor || '#0b0f17';

      for (const obj of objetivos) {
        navigate(obj.ruta);
        await sleep(1600); // dar tiempo a renderizar y cargar datos de Supabase
        const main = document.querySelector('main') as HTMLElement | null;
        if (!main) continue;
        main.scrollTop = 0;
        await sleep(120);
        try {
          const canvas = await html2canvas(main, {
            backgroundColor: fondo,
            scale: Math.min(1.5, window.devicePixelRatio || 1),
            useCORS: true,
            logging: false,
            width: main.clientWidth,
            height: main.clientHeight,
            windowWidth: main.clientWidth,
            windowHeight: main.clientHeight,
          });
          capturas[obj.key] = {
            dataUrl: canvas.toDataURL('image/jpeg', 0.85),
            w: canvas.width,
            h: canvas.height,
          };
        } catch { /* si una captura falla, el manual igual se genera con texto */ }
      }

      navigate(rutaOriginal);
      await sleep(150);
      // Import dinámico: la generación del manual (jsPDF) no debe pesar en el arranque.
      const { descargarManualUsuario } = await import('@/shared/lib/manualUsuarioPdf');
      await descargarManualUsuario(capturas);
    } catch {
      toast('No se pudo generar el manual de usuario', 'error');
    } finally {
      setDescargandoManual(false);
    }
  }

  // Respaldo manual: al hacer clic se elige Descargar o Enviar por correo.
  const [respaldoOpen, setRespaldoOpen] = useState(false);
  async function handleRespaldoDescargar() {
    if (descargandoBackup) return;
    setDescargandoBackup(true);
    try {
      await descargarRespaldoSql(user?.email ?? 'sistema', false);
      toast('Respaldo de datos descargado (.sql)', 'success');
      setRespaldoOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el respaldo', 'error');
    } finally {
      setDescargandoBackup(false);
    }
  }
  async function handleRespaldoCorreo() {
    if (descargandoBackup) return;
    setDescargandoBackup(true);
    try {
      const { destinatarios } = await enviarRespaldoPorCorreo(user?.email ?? 'sistema', false);
      toast(`Respaldo enviado por correo a ${destinatarios.join(', ')}`, 'success');
      setRespaldoOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar el respaldo', 'error');
    } finally {
      setDescargandoBackup(false);
    }
  }

  // Respaldo AUTOMÁTICO cada 30 días: al entrar un admin/analista, si toca,
  // descarga el .sql y registra la fecha. Corre una sola vez por sesión.
  const backupAutoCorrido = useRef(false);
  useEffect(() => {
    if (backupAutoCorrido.current) return;
    if (!puedeRespaldar(role)) return;
    backupAutoCorrido.current = true;
    chequearRespaldoAutomatico(role, user?.email ?? 'sistema')
      .then((corrio) => { if (corrio) toast(`Respaldo automático (cada 30 días) enviado por correo a ${BACKUP_EMAIL}`, 'info'); })
      .catch(() => { /* silencioso: el respaldo manual sigue disponible */ });
  }, [role, user?.email]);

  return (
    <div className={`app${collapsed ? ' sidebar-collapsed' : ''}${drawerOpen ? ' drawer-open' : ''}`}>
      <div className="sidebar-overlay" onClick={closeDrawer} aria-hidden="true" />
      <aside className="sidebar">
        <div className="sidebar-brand">
          <NavLink to="/app" className="brand">
            <img src="/image.jpeg" alt="MGG" />
            <div className="brand-text">
              <strong>MGG</strong>
              <small>BIENVENIDO</small>
            </div>
          </NavLink>
        </div>

        {showOperacion && <div className="sidebar-section">Operación</div>}
        <nav className="nav">
          {can('dashboard') && <NavItem to="/app/dashboard" icon="▦" label="Dashboard" />}
          {can('pedidos') && <NavItem to="/app/pedidos" icon="✉" label="Pedidos / Compras" />}
          {can('proveedores') && <NavItem to="/app/proveedores" icon="⚒" label="Proveedores" />}
          {can('inventario') && <NavItem to="/app/inventario" icon="⬢" label="Inventario" />}
          {can('produccion') && <NavItem to="/app/produccion" icon="🔥" label="Fundición" />}
          {can('salidas') && <NavItem to="/app/salidas" icon="↘" label="Salidas / Traslados" />}
          {can('cocina') && <NavItem to="/app/cocina" icon="🍽" label="Control de Alimentación" />}
          {can('combustible') && <NavItem to="/app/combustible" icon="⛽" label="Combustible" />}
          {can('maquinaria') && <NavItem to="/app/maquinaria" icon="🚜" label="Control de Maquinaria" />}
          {(can('acopio') || can('acopio_reporte') || can('acopio_gmt') || can('acopio_peramanal') || can('acopio_esmeralda') || can('acopio_pijiguaos')) && (
            <NavGroup icon="🏭" label="Cajas Centro de Costo" defaultOpen={location.pathname.startsWith('/app/acopio')}>
              {can('acopio_reporte') && <NavItem to="/app/acopio/reporte-preliminar" icon="📅" label="Reporte Preliminar" />}
              {can('acopio') && <NavItem to="/app/acopio" icon="🏭" label="La Esperanza" />}
              {can('acopio_gmt') && <NavItem to="/app/acopio/global-mineral-tin" icon="🏭" label="Global Mineral TIN" />}
              {can('acopio_peramanal') && <NavItem to="/app/acopio/peramanal-ender" icon="🏭" label="Peramanal (Ender Mejías)" />}
              {/* Oculto a pedido: La Esmeralda (Alí). La vista/ruta siguen existiendo; solo no aparece en el menú. */}
              {/* {can('acopio_esmeralda') && <NavItem to="/app/acopio/esmeralda-ali" icon="🏭" label="La Esmeralda (Alí)" />} */}
              {can('acopio_pijiguaos') && <NavItem to="/app/acopio/los-pijiguaos" icon="🏭" label="Los Pijiguaos" />}
            </NavGroup>
          )}
          {can('ventas') && <NavItem to="/app/ventas" icon="🧾" label="Ventas" />}
          {can('tesoreria') && <NavItem to="/app/tesoreria" icon="🏦" label="Tesorería" />}
          {can('retenciones') && <NavItem to="/app/retenciones" icon="🧾" label="Retenciones" />}
          {can('rrhh') && <NavItem to="/app/rrhh" icon="👥" label="RRHH / Nómina" />}
        </nav>

        {showSistema && <div className="sidebar-section">Sistema</div>}
        <nav className="nav">
          {can('usuarios') && (
            <NavItem
              to="/app/usuarios"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0v1H4z" />
                </svg>
              }
              label="Usuarios"
            />
          )}
          {can('ajustes') && <NavItem to="/app/ajustes" icon="⚙" label="Ajustes" />}
          <a
            href={manualSistemaUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir el manual del sistema"
          >
            <span className="icn">📘</span> <span>Menú del Sistema</span>
          </a>
          {mostrarRespaldo && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); setRespaldoOpen(true); }}
              title="Respaldo de la base de datos (.sql): descargar o enviar por correo"
            >
              <span className="icn">💾</span>{' '}
              <span>Respaldo de Data</span>
            </a>
          )}
          {MOSTRAR_MANUAL && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); void handleManual(); }}
              title="Descargar el manual de usuario en PDF"
              style={descargandoManual ? { opacity: 0.6, pointerEvents: 'none' } : undefined}
            >
              <span className="icn">📘</span>{' '}
              <span>{descargandoManual ? 'Generando…' : 'Manual de Sistema'}</span>
            </a>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar" style={{ overflow: 'hidden', background: '#fff', padding: 0 }}>
              <img
                src="/image.jpeg"
                alt="Avatar"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
            <div className="info">
              <div className="name">{user?.email ?? '—'}</div>
              <div className="role">{role ?? 'Sesión activa'}</div>
            </div>
            <button onClick={handleLogout} className="btn btn-icon btn-ghost" title="Cerrar sesión">
              ⎋
            </button>
          </div>
        </div>
      </aside>

      <header className="topbar">
        <div className="crumb" style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          <button
            type="button"
            onClick={handleMenuBtn}
            className="btn btn-icon btn-ghost"
            title={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
            aria-label={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
            style={{ fontSize: '1.1rem', lineHeight: 1 }}
          >
            ☰
          </button>
          <span>MGG · <strong>Sistema</strong></span>
        </div>
        <div className="top-actions">
          <TasaChip />
          <GlobalSearch />
          <button
            type="button"
            className="notif-btn"
            onClick={handleOpenNotif}
            title="Notificaciones"
            style={{
              position: 'relative',
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '.45rem .65rem',
              borderRadius: 'var(--r-md)',
              cursor: 'pointer',
              fontSize: '1.05rem',
              lineHeight: 1,
            }}
          >
            ◔
            {unread > 0 && (
              <span
                aria-label={`${unread} sin leer`}
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  background: 'var(--danger)',
                  color: '#fff',
                  borderRadius: '999px',
                  minWidth: 18,
                  height: 18,
                  fontSize: '.65rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 5px',
                  boxShadow: '0 0 0 2px var(--bg-1)',
                }}
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        </div>
      </header>

      <AvisoActualizacion />

      <main className="main">
        <Outlet />
      </main>

      <NotificacionesPanel
        open={notifOpen}
        onClose={() => { setNotifOpen(false); void refreshUnread(); }}
        onAllRead={handleAllRead}
      />

      {respaldoOpen && (
        <Modal
          title="Respaldo de la base de datos"
          size="md"
          onClose={() => { if (!descargandoBackup) setRespaldoOpen(false); }}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setRespaldoOpen(false)} disabled={descargandoBackup}>Cancelar</button>
              <button className="btn btn-ghost" onClick={() => void handleRespaldoDescargar()} disabled={descargandoBackup}>↓ Descargar</button>
              <button className="btn btn-primary" onClick={() => void handleRespaldoCorreo()} disabled={descargandoBackup}>✉ Enviar por correo</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0, fontSize: '.9rem' }}>
            {descargandoBackup ? 'Generando el respaldo…' : <>¿Cómo querés el respaldo de la base de datos (.sql)? El envío por correo va a <strong>{BACKUP_EMAIL}</strong>.</>}
          </p>
        </Modal>
      )}
    </div>
  );
}

/** Grupo colapsable del menú: cabecera con chevron + sub-ítems indentados. */
function NavGroup({
  icon,
  label,
  defaultOpen,
  children,
}: {
  icon: ReactNode;
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div>
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        aria-expanded={open}
        title={label}
      >
        <span className="icn">{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        <span style={{ fontSize: '.7rem', opacity: .7, transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
      </a>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: '.7rem', marginLeft: '.3rem', borderLeft: '1px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
  disabled,
  soon,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  soon?: boolean;
}) {
  if (disabled) {
    return (
      <a href="#" onClick={(e) => e.preventDefault()} style={{ opacity: 0.4, cursor: 'not-allowed' }} title={soon ? 'Próximamente' : undefined}>
        <span className="icn">{icon}</span> <span>{label}</span>
        {soon && <span className="badge" style={{ marginLeft: 'auto', fontSize: '.58rem', opacity: .8 }}>próx.</span>}
      </a>
    );
  }
  return (
    // Prefetch del chunk de la página al pasar el mouse o enfocar: el clic abre al instante.
    <NavLink
      to={to}
      className={({ isActive }) => (isActive ? 'active' : '')}
      end
      onMouseEnter={() => prefetchRoute(to)}
      onFocus={() => prefetchRoute(to)}
    >
      <span className="icn">{icon}</span> <span>{label}</span>
    </NavLink>
  );
}
