import { useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import type { MaquinariaEquipo } from '@/modules/maquinaria/maquinariaEquipos.repository';
import type { RepuestoEquipo } from '@/modules/maquinaria/repuestosEquipo';
import { listRepuestosEquipo } from '@/modules/maquinaria/repuestosEquipo.repository';
import { num } from '@/shared/lib/format';

interface Props {
  equipoId?: string | null;
  equipoNombre?: string | null;
}

/**
 * Ficha técnica y repuestos de la máquina para el analista de Compras.
 * En PC muestra todos los detalles (marca de filtros, modelo de motor, viscosidad de aceite, serial).
 * En teléfono muestra una vista resumida, limpia y táctil.
 */
export function FichaEquipoCompras({ equipoId, equipoNombre }: Props) {
  const [equipo, setEquipo] = useState<MaquinariaEquipo | null>(null);
  const [repuestos, setRepuestos] = useState<RepuestoEquipo[]>([]);
  const [abiertoMovil, setAbiertoMovil] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    async function cargar() {
      if (!equipoId && !equipoNombre) {
        setEquipo(null);
        setRepuestos([]);
        return;
      }
      setLoading(true);
      try {
        let eq: MaquinariaEquipo | null = null;
        if (equipoId) {
          const { data } = await supabase.from('maquinaria_equipos').select('*').eq('id', equipoId).maybeSingle();
          if (data) eq = data as MaquinariaEquipo;
        }
        if (!eq && equipoNombre) {
          const { data } = await supabase.from('maquinaria_equipos').select('*').ilike('equipo', equipoNombre.trim()).maybeSingle();
          if (data) eq = data as MaquinariaEquipo;
        }
        if (cancel) return;
        setEquipo(eq);

        if (eq?.id) {
          const reps = await listRepuestosEquipo(eq.id).catch(() => []);
          if (!cancel) setRepuestos(reps);
        } else {
          setRepuestos([]);
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    void cargar();
    return () => { cancel = true; };
  }, [equipoId, equipoNombre]);

  if (loading) {
    return <div className="muted" style={{ fontSize: '.78rem', padding: '.4rem 0' }}>Cargando ficha del equipo…</div>;
  }

  if (!equipo && !repuestos.length) {
    return null;
  }

  // Filtros del equipo agrupados
  const filtros = repuestos.filter((r) => /filtro/i.test(r.sistema || '') || /filtro/i.test(r.repuesto || ''));
  const otrosRepuestos = repuestos.filter((r) => !filtros.includes(r));

  return (
    <div
      style={{
        border: '1px solid color-mix(in srgb, var(--primary, #3b82f6) 40%, var(--border))',
        background: 'color-mix(in srgb, var(--primary, #3b82f6) 5%, var(--surface))',
        borderRadius: 'var(--r-md, 8px)',
        padding: '.75rem .9rem',
        margin: '.75rem 0',
      }}
    >
      {/* Encabezado visible en PC y Móvil */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          <span style={{ fontSize: '1.2rem' }}>🚜</span>
          <div>
            <strong style={{ fontSize: '.95rem', color: 'var(--text)' }}>
              {equipo?.equipo || equipoNombre}
            </strong>
            <span className="muted" style={{ fontSize: '.78rem', marginLeft: '.45rem' }}>
              {[equipo?.marca, equipo?.modelo, equipo?.placa || equipo?.serial].filter(Boolean).join(' · ')}
            </span>
          </div>
        </div>

        {/* Botón para desplegar / plegar en teléfono */}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setAbiertoMovil(!abiertoMovil)}
          style={{ fontSize: '.8rem', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}
        >
          {abiertoMovil ? '▲ Ocultar ficha' : '▼ Ver detalles y filtros'}
        </button>
      </div>

      {/* Resumen rápido visible en teléfono cuando está cerrado */}
      {!abiertoMovil && (
        <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: '.35rem', display: 'flex', gap: '.7rem', flexWrap: 'wrap' }}>
          {equipo?.responsable && <span>👤 Responsable: <strong style={{ color: 'var(--text)' }}>{equipo.responsable}</strong></span>}
          {equipo?.motor_modelo && <span>⚙️ Motor: {equipo.motor_modelo}</span>}
          {filtros.length > 0 && <span>🧴 {filtros.length} filtro(s) registrados</span>}
        </div>
      )}

      {/* Contenido detallado (visible en PC por CSS o en teléfono cuando está abierto) */}
      <div style={{ display: abiertoMovil ? 'block' : undefined }} className={abiertoMovil ? '' : 'hide-mobile'}>
        {/* Datos técnicos */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '.5rem',
            margin: '.6rem 0',
            fontSize: '.8rem',
            background: 'var(--bg-1, #13171d)',
            padding: '.6rem .75rem',
            borderRadius: 'var(--r-sm, 6px)',
          }}
        >
          {equipo?.responsable && (
            <div>
              <span className="muted" style={{ display: 'block', fontSize: '.72rem' }}>Encargado responsable</span>
              <strong style={{ color: 'var(--primary, #3b82f6)' }}>👤 {equipo.responsable}</strong>
            </div>
          )}
          {equipo?.motor_modelo && (
            <div>
              <span className="muted" style={{ display: 'block', fontSize: '.72rem' }}>Modelo de motor</span>
              <strong>{equipo.motor_modelo}</strong>
            </div>
          )}
          {equipo?.motor_serial && (
            <div>
              <span className="muted" style={{ display: 'block', fontSize: '.72rem' }}>Serial de motor</span>
              <strong className="mono">{equipo.motor_serial}</strong>
            </div>
          )}
          {equipo?.serial && (
            <div>
              <span className="muted" style={{ display: 'block', fontSize: '.72rem' }}>Serial / PIN</span>
              <strong className="mono">{equipo.serial}</strong>
            </div>
          )}
          {equipo?.placa && (
            <div>
              <span className="muted" style={{ display: 'block', fontSize: '.72rem' }}>Placa</span>
              <strong>{equipo.placa}</strong>
            </div>
          )}
          {equipo?.combustible && (
            <div>
              <span className="muted" style={{ display: 'block', fontSize: '.72rem' }}>Combustible</span>
              <strong>{equipo.combustible}</strong>
            </div>
          )}
        </div>

        {/* Tabla de Filtros registrados */}
        {filtros.length > 0 ? (
          <div style={{ marginTop: '.6rem' }}>
            <div style={{ fontSize: '.82rem', fontWeight: 700, marginBottom: '.35rem', color: 'var(--text)' }}>
              🧴 Filtros especificados para este equipo (para cotización exacta):
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="items-table" style={{ fontSize: '.8rem', margin: 0 }}>
                <thead>
                  <tr>
                    <th>Filtro / Insumo</th>
                    <th>Marca</th>
                    <th>Nº de Parte / Ref.</th>
                    <th>Especificaciones</th>
                    <th style={{ textAlign: 'right' }}>Cant. x servicio</th>
                  </tr>
                </thead>
                <tbody>
                  {filtros.map((f) => (
                    <tr key={f.id}>
                      <td style={{ fontWeight: 600 }}>{f.repuesto}</td>
                      <td>
                        {f.marca ? (
                          <span style={{ color: 'var(--primary, #3b82f6)', fontWeight: 600 }}>🏷️ {f.marca}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="mono">{f.numero_parte || '—'}</td>
                      <td>{f.especificaciones || f.notas || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{f.cantidad_por_servicio != null ? num(f.cantidad_por_servicio) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: '.78rem', marginTop: '.4rem' }}>
            ℹ️ No hay filtros precargados en la ficha técnica de este equipo. El nombre que se coloque se guardará para el próximo servicio.
          </div>
        )}

        {/* Otros repuestos */}
        {otrosRepuestos.length > 0 && (
          <div style={{ marginTop: '.6rem' }}>
            <div style={{ fontSize: '.82rem', fontWeight: 700, marginBottom: '.35rem' }}>
              ⚙️ Otros repuestos y lubricantes registrados:
            </div>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              {otrosRepuestos.map((r) => (
                <span
                  key={r.id}
                  style={{
                    fontSize: '.76rem',
                    padding: '.2rem .5rem',
                    background: 'var(--surface-2)',
                    borderRadius: '4px',
                    border: '1px solid var(--border)',
                  }}
                >
                  {r.repuesto}
                  {r.marca ? ` · ${r.marca}` : ''}
                  {r.numero_parte ? ` (${r.numero_parte})` : ''}
                  {r.aceite_viscosidad ? ` · ${r.aceite_viscosidad}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
