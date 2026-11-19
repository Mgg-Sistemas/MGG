/* ============================================================
   MGG · Usuarios › Directorio
   La misma gente de la tabla, leída por DEPARTAMENTO.
   El dato ya se capturaba en el alta y se gestionaba como
   taxonomía, pero la lista nunca lo mostraba: aquí es el eje.
   El color de cada persona es el de su rol (custom_roles.color),
   el mismo que usa la pestaña de Roles — así un color significa
   lo mismo en todo el módulo.

   Es solo otra forma de ver lo mismo: no lee ni escribe nada por
   su cuenta, recibe los usuarios ya filtrados por la página.
   ============================================================ */
import { useMemo, type CSSProperties } from 'react';
import type { Usuario } from '@/shared/lib/types';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { Iniciales } from '@/shared/ui/Iniciales';
import type { CustomRole } from './roles.repository';
import { estadoVisible } from './usuariosArchivo';

const SIN_DEPTO = 'Sin departamento';

function nombreVisible(u: Usuario): string {
  return [u.nombre, u.apellido].filter(Boolean).join(' ').trim() || u.email || 'Sin nombre';
}

interface Props {
  usuarios: Usuario[];
  roles: CustomRole[];
  /** Abre la misma ficha que abre la tabla. */
  onAbrir: (u: Usuario) => void;
}

export function DirectorioUsuarios({ usuarios, roles, onAbrir }: Props) {
  const porRol = useMemo(() => new Map(roles.map((r) => [r.key, r])), [roles]);

  /* Agrupado por departamento. «Sin departamento» va al final: es un
     cajón de pendientes, no un equipo. */
  const grupos = useMemo(() => {
    const mapa = new Map<string, Usuario[]>();
    usuarios.forEach((u) => {
      const d = (u.departamento ?? '').trim() || SIN_DEPTO;
      const lista = mapa.get(d);
      if (lista) lista.push(u);
      else mapa.set(d, [u]);
    });
    return [...mapa.entries()]
      .sort((a, b) => {
        if (a[0] === SIN_DEPTO) return 1;
        if (b[0] === SIN_DEPTO) return -1;
        return a[0].localeCompare(b[0], 'es', { sensitivity: 'base' });
      })
      .map(([depto, gente]) => ({
        depto,
        gente: gente.sort((x, y) => nombreVisible(x).localeCompare(nombreVisible(y), 'es', { sensitivity: 'base' })),
      }));
  }, [usuarios]);

  return (
    <div>
      {grupos.map(({ depto, gente }) => (
        <section key={depto}>
          <div className="usr-depto">
            <h3>{depto}</h3>
            <span className="usr-depto-n">{gente.length}</span>
          </div>
          <div className="usr-grid">
            {gente.map((u) => {
              const rol = porRol.get(u.role);
              const estado = estadoVisible(u);
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`usr-persona${estado === 'activo' ? '' : ' inactivo'}`}
                  style={{ '--rol-color': rol?.color } as CSSProperties}
                  onClick={() => onAbrir(u)}
                  title={`Ver la ficha de ${nombreVisible(u)}`}
                >
                  <Iniciales nombre={u.nombre} apellido={u.apellido} respaldo={u.email} color={rol?.color} />
                  <span className="usr-persona-datos">
                    <span className="usr-persona-nombre">{nombreVisible(u)}</span>
                    <span className="usr-persona-rol">{rol?.label ?? u.role}</span>
                    <span className="usr-persona-correo">{u.email}</span>
                    <span className="usr-persona-avisos">
                      {estado !== 'activo' && <StatusBadge estado={estado} />}
                      {u.bloqueado && <span className="usr-aviso bloqueado">🔒 Bloqueado</span>}
                      {u.must_change_password && <span className="usr-aviso clave">⚠ Clave pendiente</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
