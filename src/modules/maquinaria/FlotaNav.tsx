import { NavLink, useLocation } from 'react-router-dom';
import { prefetchRoute } from '@/shared/lib/routePrefetch';

/** Submódulos simplificados de Control de Maquinaria (4 pestañas esenciales y directas). */
const SUBMODULOS_FLOTA = [
  {
    to: '/app/maquinaria',
    icon: '🚜',
    label: 'Flota y Equipos',
    match: (p: string) => p === '/app/maquinaria' || p.startsWith('/app/maquinaria/equipo/'),
  },
  {
    to: '/app/maquinaria/ordenes',
    icon: '🔧',
    label: 'Mantenimiento y Servicios',
    match: (p: string) =>
      p.startsWith('/app/maquinaria/ordenes') ||
      p.startsWith('/app/maquinaria/servicio-mantenimiento') ||
      p.startsWith('/app/maquinaria/averias'),
  },
  {
    to: '/app/maquinaria/repuestos',
    icon: '🛒',
    label: 'Repuestos',
    match: (p: string) => p.startsWith('/app/maquinaria/repuestos'),
  },
  {
    to: '/app/maquinaria/lavados',
    icon: '🚿',
    label: 'Lavados',
    match: (p: string) => p.startsWith('/app/maquinaria/lavados'),
  },
  {
    to: '/app/maquinaria/telefono',
    icon: '📱',
    label: 'Modo Teléfono',
    match: (p: string) => p === '/app/maquinaria/telefono',
  },
];

/** Tira de navegación superior limpia y amigable para operarios y usuarios de campo. */
export function FlotaNav() {
  const { pathname } = useLocation();

  return (
    <nav className="flo-subnav" aria-label="Submódulos de Control de Maquinaria">
      {SUBMODULOS_FLOTA.map((s) => {
        const activo = s.match(pathname);
        return (
          <NavLink
            key={s.to}
            to={s.to}
            className={activo ? 'activo' : ''}
            onMouseEnter={() => prefetchRoute(s.to)}
            onFocus={() => prefetchRoute(s.to)}
            onTouchStart={() => prefetchRoute(s.to)}
          >
            <span aria-hidden="true">{s.icon}</span> {s.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
