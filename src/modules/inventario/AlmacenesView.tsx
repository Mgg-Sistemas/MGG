import { EmptyState } from '@/shared/ui/EmptyState';
import { money, num } from '@/shared/lib/format';
import type { Almacen } from '@/shared/lib/types';
import { nombreCortoAlmacen, type AlmacenValor } from './almacenes.repository';

export type AlmacenLayout = 'kanban' | 'lista';

const EMPTY_VALOR: AlmacenValor = { valor: 0, items: 0, unidades: 0 };
const SIN_SEDE = 'Sin sede';

/** Hijos directos (subalmacenes) de un almacén dentro del conjunto dado. */
export function hijosDe(parentId: string | null, almacenes: Almacen[]): Almacen[] {
  return almacenes
    .filter((a) => (a.parent_id ?? null) === parentId)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Almacenes de nivel superior del conjunto (sin padre, o cuyo padre no está). */
export function raices(almacenes: Almacen[]): Almacen[] {
  const ids = new Set(almacenes.map((a) => a.id));
  return almacenes
    .filter((a) => !a.parent_id || !ids.has(a.parent_id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/* ───────────────────────── Tarjetas de SEDE (nivel 1) ───────────────────────── */

/** Agrupa los almacenes por su sede y, al hacer clic, entra a esa sede. */
export function SedesView({ almacenes, valores, onSelectSede, onEditarSede, canWrite = true }: {
  almacenes: Almacen[];
  valores: Record<string, AlmacenValor>;
  onSelectSede: (sede: string) => void;
  /** Renombrar la sede (se aplica a todos sus almacenes). */
  onEditarSede?: (sede: string) => void;
  canWrite?: boolean;
}) {
  const sedes = new Map<string, { almacenes: number; subalmacenes: number; valor: number; items: number; unidades: number }>();
  for (const a of almacenes) {
    const key = a.sede?.trim() || SIN_SEDE;
    const v = valores[a.nombre] ?? EMPTY_VALOR;
    const acc = sedes.get(key) ?? { almacenes: 0, subalmacenes: 0, valor: 0, items: 0, unidades: 0 };
    acc.almacenes += 1;
    if (a.parent_id) acc.subalmacenes += 1;
    acc.valor += v.valor; acc.items += v.items; acc.unidades += v.unidades;
    sedes.set(key, acc);
  }
  const lista = Array.from(sedes.entries()).sort((a, b) => a[0].localeCompare(b[0], 'es'));

  if (!lista.length) {
    return <div className="card"><EmptyState message="No hay almacenes. Creá el primero con “+ Agregar almacén”." icon="▣" /></div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '.85rem' }}>
      {lista.map(([sede, a]) => (
        <div
          key={sede}
          className="card"
          style={{ margin: 0, padding: '1rem', cursor: 'pointer', borderTop: '3px solid var(--primary)', color: 'var(--text)' }}
          onClick={() => onSelectSede(sede)}
          title={`Ver almacenes de ${sede}`}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.5rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.02rem', color: 'var(--text)' }}>📍 {sede}</div>
              <div className="muted" style={{ fontSize: '.75rem' }}>
                {a.subalmacenes} subalmacén{a.subalmacenes !== 1 ? 'es' : ''} · {a.almacenes} almacén{a.almacenes !== 1 ? 'es' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
              {canWrite && onEditarSede && (
                <button className="btn btn-sm btn-ghost" title="Renombrar la sede (se aplica a todos sus almacenes)"
                  onClick={(e) => { e.stopPropagation(); onEditarSede(sede); }}>✎</button>
              )}
              <span className="muted" style={{ fontSize: '1.2rem', lineHeight: 1 }}>›</span>
            </div>
          </div>
          <div style={{ marginTop: '.75rem' }}>
            <div className="muted" style={{ fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>Valor total</div>
            <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-3)' }}>{money(a.valor)}</div>
          </div>
          <div className="muted" style={{ fontSize: '.78rem', marginTop: '.4rem' }}>
            {num(a.items)} producto{a.items !== 1 ? 's' : ''} · {num(a.unidades)} und.
          </div>
        </div>
      ))}
    </div>
  );
}

/* ──────────── Almacenes de un nivel (plano: drill-down, no anidado) ──────────── */

interface AlmacenesViewProps {
  /** Todos los almacenes de la sede (para calcular hijos en cada nivel). */
  almacenes: Almacen[];
  valores: Record<string, AlmacenValor>;
  layout: AlmacenLayout;
  canWrite?: boolean;
  /** Nivel a mostrar: null = almacenes raíz de la sede; un id = hijos de ese almacén. */
  parentId: string | null;
  /** Almacén sin subalmacenes → abre su detalle de productos. */
  onSelect: (nombre: string) => void;
  /** Almacén con subalmacenes → entra a ver sus subalmacenes. */
  onDrill: (a: Almacen) => void;
  onConsumo: (nombre: string) => void;
  /** Reporte (Excel/PDF) del almacén individual. */
  onReporte: (nombre: string) => void;
  onEditar: (a: Almacen) => void;
  onEliminar: (a: Almacen) => void;
  onAgregarSub: (a: Almacen) => void;
}

export function AlmacenesView({ almacenes, valores, layout, canWrite = true, parentId, onSelect, onDrill, onConsumo, onReporte, onEditar, onEliminar, onAgregarSub }: AlmacenesViewProps) {
  const actuales = parentId ? hijosDe(parentId, almacenes) : raices(almacenes);
  const numHijos = (a: Almacen) => hijosDe(a.id, almacenes).length;

  if (!actuales.length) {
    return <div className="card"><EmptyState message="No hay almacenes en este nivel. Creá uno con “+ Agregar almacén”." icon="▣" /></div>;
  }

  if (layout === 'lista') {
    return (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Almacén</th>
              <th>Ubicación</th>
              <th style={{ textAlign: 'right' }}>Productos</th>
              <th style={{ textAlign: 'right' }}>Unidades</th>
              <th style={{ textAlign: 'right' }}>Valor total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {actuales.map((a) => {
              const v = valores[a.nombre] ?? EMPTY_VALOR;
              const hijos = numHijos(a);
              return (
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(a.nombre)}>
                  <td>
                    <strong>{nombreCortoAlmacen(a, almacenes)}</strong>
                    {hijos > 0 && <button type="button" className="btn-link" style={{ marginLeft: '.4rem', fontSize: '.8rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--primary-3)', font: 'inherit' }}
                      onClick={(e) => { e.stopPropagation(); onDrill(a); }} title="Ver los subalmacenes">· {hijos} subalmacén{hijos !== 1 ? 'es' : ''} ›</button>}
                  </td>
                  <td className="muted">{a.ubicacion || '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(v.items)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(v.unidades)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--primary-3)', fontWeight: 600 }}>{money(v.valor)}</td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-ghost" onClick={() => onSelect(a.nombre)} title="Ver productos (incluye subalmacenes)">Ver</button>
                    {hijos > 0 && <button className="btn btn-sm btn-ghost" onClick={() => onDrill(a)} title="Ver subalmacenes">Subs ›</button>}
                    <button className="btn btn-sm btn-ghost" onClick={() => onReporte(a.nombre)} title="Reporte del almacén (Excel/PDF)">📄 Reporte</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => onConsumo(a.nombre)} title="Gráfica de consumo por producto">📊 Consumo</button>
                    {canWrite && (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={() => onAgregarSub(a)} title="Agregar subalmacén">+ Sub</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => onEditar(a)}>Editar</button>
                        <button className="btn btn-sm btn-danger" onClick={() => onEliminar(a)} title="Eliminar almacén">✕</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Kanban: cada almacén del nivel como tarjeta independiente.
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '.85rem' }}>
      {actuales.map((a) => {
        const v = valores[a.nombre] ?? EMPTY_VALOR;
        const hijos = numHijos(a);
        return (
          <div
            key={a.id}
            className="card"
            style={{ margin: 0, padding: '1rem', cursor: 'pointer', borderTop: '3px solid var(--primary)', color: 'var(--text)' }}
            onClick={() => onSelect(a.nombre)}
            title={hijos > 0 ? 'Ver productos (incluye subalmacenes)' : 'Ver detalle del almacén'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.5rem' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.02rem', color: 'var(--text)' }}>▣ {nombreCortoAlmacen(a, almacenes)}</div>
                <div className="muted" style={{ fontSize: '.75rem' }}>{a.ubicacion || 'Sin ubicación'}</div>
              </div>
              <div className="actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-sm btn-ghost" onClick={() => onReporte(a.nombre)} title="Reporte del almacén (Excel/PDF)">📄</button>
                <button className="btn btn-sm btn-ghost" onClick={() => onConsumo(a.nombre)} title="Gráfica de consumo por producto">📊</button>
                {canWrite && (
                  <>
                    <button className="btn btn-sm btn-ghost" onClick={() => onAgregarSub(a)} title="Agregar subalmacén">＋Sub</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => onEditar(a)} title="Editar">✎</button>
                    <button className="btn btn-sm btn-danger" onClick={() => onEliminar(a)} title="Eliminar">✕</button>
                  </>
                )}
              </div>
            </div>

            <div style={{ marginTop: '.75rem' }}>
              <div className="muted" style={{ fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>Valor total</div>
              <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-3)' }}>{money(v.valor)}</div>
            </div>

            <div className="muted" style={{ fontSize: '.78rem', marginTop: '.4rem' }}>
              {num(v.items)} producto{v.items !== 1 ? 's' : ''} · {num(v.unidades)} und.
              {hijos > 0 && <> · <button type="button" className="btn-link" style={{ color: 'var(--primary-3)', fontWeight: 700, background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
                onClick={(e) => { e.stopPropagation(); onDrill(a); }} title="Ver los subalmacenes">{hijos} subalmacén{hijos !== 1 ? 'es' : ''} ›</button></>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
