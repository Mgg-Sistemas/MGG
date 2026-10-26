import { NavLink } from 'react-router-dom';
import { prefetchRoute } from '@/shared/lib/routePrefetch';

/** Submódulos simplificados de Control de Maquinaria. */
const SUBMODULOS_FLOTA: { to: string; icon: string; label: string }[] = [
  { to: '/app/maquinaria', icon: '🚜', label: 'Flota y Equipos' },
  { to: '/app/maquinaria/ordenes', icon: '🛠️', label: 'Servicios y Mantenimiento' },
  { to: '/app/maquinaria/repuestos', icon: '🛒', label: 'Repuestos y Compras' },
  { to: '/app/maquinaria/lavados', icon: '🚿', label: 'Lavados' },
];

/** Tira de submódulos arriba de cada página: en el teléfono se desliza de lado dentro de sí misma. */
export function FlotaNav() {
  return (
    <nav className="flo-subnav" aria-label="Submódulos de Control de Maquinaria">
      {SUBMODULOS_FLOTA.map((s) => (
        <NavLink key={s.to} to={s.to} end className={({ isActive }) => (isActive ? 'activo' : '')}
          onMouseEnter={() => prefetchRoute(s.to)} onFocus={() => prefetchRoute(s.to)} onTouchStart={() => prefetchRoute(s.to)}>
          <span aria-hidden="true">{s.icon}</span> {s.label}
        </NavLink>
      ))}
    </nav>
  );
}
