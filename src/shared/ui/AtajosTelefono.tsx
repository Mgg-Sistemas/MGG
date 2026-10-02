/* ============================================================
   MGG · Atajos entre vistas de teléfono (02-10-2026)

   Una persona de teléfono puede tener varias pantallas (surtidor y comidas,
   por ejemplo). Arriba de cada una se le ofrecen las OTRAS que le tocan por
   sus permisos, con un toque. Sin otras vistas no pinta nada: una persona con
   una sola pantalla no tiene por qué ver una barra vacía.
   ============================================================ */
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { vistasTelefonoDe } from '@/modules/usuarios/permisos.repository';

export function AtajosTelefono({ actual }: { actual: string }) {
  const { role, allowedModules } = usePermissions();
  const otras = vistasTelefonoDe(role, allowedModules).filter((v) => v.ruta !== actual);
  if (!otras.length) return null;
  return (
    <nav aria-label="Otras vistas de teléfono" style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', margin: '0 0 .75rem' }}>
      <span className="muted" style={{ fontSize: '.78rem' }}>Ir a:</span>
      {otras.map((v) => (
        <Link key={v.ruta} to={`/app/${v.ruta}`} className="btn btn-sm btn-ghost">{v.icono} {v.label}</Link>
      ))}
    </nav>
  );
}
