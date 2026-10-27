/* ============================================================
   Golden Touch · Compras · Ficha técnica y de filtros del equipo
   (26/10/2026)

   Permite a los analistas de Compras consultar al instante:
   - La máquina o vehículo al que va destinado el pedido/servicio
   - Las marcas exactas de los filtros (Donaldson, Fleetguard, Baldwin...)
   - Los números de parte originales (OEM) y equivalencias comerciales
   - Especificaciones de aceite, viscosidad y cantidades por servicio
   - Encargado responsable y horas actuales

   Visto desde PC: tabla completa, desglosada y detallada con botones de copia.
   Visto desde Teléfono: vista ultra-resumida, táctil, compacta y directa.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { num as fmtNum } from '@/shared/lib/format';
import { toast } from '@/shared/ui/Toast';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { textoFichaFiltrosWhatsapp } from '@/modules/maquinaria/maquinariaWhatsapp';
import { listRepuestosEquipo } from '@/modules/maquinaria/repuestosEquipo.repository';
import { sistemaDe, type RepuestoEquipo } from '@/modules/maquinaria/repuestosEquipo';
import { extraerEncargado, type MaquinariaEquipo } from '@/modules/maquinaria/maquinariaEquipos.repository';

interface FichaEquipoComprasProps {
  equipoId?: string | null;
  equipoNombre?: string | null;
  spId?: string | null;
  ordenCodigo?: string | null;
}

export function FichaEquipoCompras({ equipoId, equipoNombre, spId, ordenCodigo }: FichaEquipoComprasProps) {
  const [eq, setEq] = useState<MaquinariaEquipo | null>(null);
  const [repuestos, setRepuestos] = useState<RepuestoEquipo[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandidoMovil, setExpandidoMovil] = useState(false);
  const [mostrarWa, setMostrarWa] = useState(false);

  useEffect(() => {
    let cancel = false;

    async function cargar() {
      setLoading(true);
      try {
        let id = equipoId;

        // 1. Si no hay equipoId pero sí spId, buscar la OS que generó esta orden de compra
        if (!id && spId) {
          const { data: os } = await supabase
            .from('maquinaria_ordenes_servicio')
            .select('equipo_id')
            .eq('orden_compra_id', spId)
            .maybeSingle();
          if (os?.equipo_id) id = os.equipo_id;
        }

        // 2. Si no hay id pero sí nombre, buscar el equipo por nombre
        if (!id && equipoNombre?.trim()) {
          const { data: eqs } = await supabase
            .from('maquinaria_equipos')
            .select('*')
            .ilike('equipo', `%${equipoNombre.trim()}%`)
            .limit(1);
          if (eqs && eqs[0]) {
            if (!cancel) {
              setEq(eqs[0] as MaquinariaEquipo);
              const rep = await listRepuestosEquipo(eqs[0].id);
              if (!cancel) setRepuestos(rep);
            }
            return;
          }
        }

        if (!id) {
          if (!cancel) { setEq(null); setRepuestos([]); }
          return;
        }

        const [{ data: equipoData }, repData] = await Promise.all([
          supabase.from('maquinaria_equipos').select('*').eq('id', id).maybeSingle(),
          listRepuestosEquipo(id).catch(() => [] as RepuestoEquipo[]),
        ]);

        if (!cancel) {
          setEq((equipoData as MaquinariaEquipo) ?? null);
          setRepuestos(repData);
        }
      } catch (err) {
        console.error('Error al cargar ficha de equipo para compras:', err);
      } finally {
        if (!cancel) setLoading(false);
      }
    }

    void cargar();
    return () => { cancel = true; };
  }, [equipoId, equipoNombre, spId]);

  const filtros = useMemo(() => {
    return repuestos.filter((r) =>
      /filtro|aceite|separador|refrigerante|correa|bateria/i.test(r.tipo) ||
      ['motor', 'combustible', 'aire', 'hidraulico', 'refrigeracion'].includes(r.sistema)
    );
  }, [repuestos]);

  const encargado = useMemo(() => eq ? extraerEncargado(eq) : null, [eq]);

  if (loading) {
    return (
      <div className="card muted" style={{ padding: '.65rem .85rem', margin: '.6rem 0', fontSize: '.82rem' }}>
        ⏳ Cargando especificaciones de la máquina y marcas de filtros…
      </div>
    );
  }

  if (!eq) return null;

  const textoWa = textoFichaFiltrosWhatsapp({
    equipo: eq.equipo,
    tipo: eq.tipo,
    marca: eq.marca,
    modelo: eq.modelo,
    motor: [eq.motor_modelo, eq.motor_serial].filter(Boolean).join(' · '),
    horasActuales: eq.mantenimiento_base_hrs ?? null,
    filtros: filtros.map((f) => ({
      sistema: f.sistema,
      tipo: f.tipo,
      numeroParte: f.numero_parte,
      equivalencias: f.equivalencias,
      especificacion: f.especificacion,
    })),
  });

  function copiarFiltrosTexto() {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(textoWa);
      toast('Lista de filtros y especificaciones copiada al portapapeles', 'success');
    }
  }

  return (
    <div className="ficha-equipo-compras" style={{
      margin: '.85rem 0',
      padding: '.85rem',
      background: 'var(--surface-2, #182230)',
      border: '1px solid var(--border, rgba(255,255,255,0.1))',
      borderRadius: 'var(--r-md, 8px)',
    }}>
      {/* ── Encabezado común ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.1rem' }}>🚜</span>
            <strong style={{ fontSize: '.95rem', color: 'var(--text-strong, #fff)' }}>{eq.equipo}</strong>
            {ordenCodigo && <span className="muted" style={{ fontSize: '.75rem' }}>({ordenCodigo})</span>}
            {eq.tipo && <span className="badge" style={{ fontSize: '.68rem' }}>{eq.tipo}</span>}
            {encargado && (
              <span className="badge" style={{ fontSize: '.68rem', background: 'rgba(59,130,246,0.15)', color: '#38bdf8' }}>
                👤 {encargado}
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>
            {[eq.marca, eq.modelo, eq.placa && `Placa: ${eq.placa}`, eq.serial && `Serial: ${eq.serial}`].filter(Boolean).join(' · ')}
          </div>
          {(eq.motor_modelo || eq.motor_serial) && (
            <div className="muted" style={{ fontSize: '.75rem', marginTop: '.1rem' }}>
              ⚙️ Motor: {[eq.motor_modelo, eq.motor_serial && `S/N ${eq.motor_serial}`].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMostrarWa(!mostrarWa)} title="Compartir ficha por WhatsApp">
            📲 WhatsApp
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={copiarFiltrosTexto} title="Copiar especificaciones y marcas de filtros">
            📋 Copiar
          </button>
          <Link to={`/app/maquinaria/equipo/${eq.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm" title="Ver expediente en Maquinaria">
            📂 Expediente
          </Link>
        </div>
      </div>

      {/* Modal / Acordeón de WhatsApp si se activó */}
      {mostrarWa && (
        <div style={{ marginTop: '.65rem', padding: '.65rem', background: 'var(--surface-1, #0f172a)', borderRadius: 'var(--r-sm, 6px)' }}>
          <CompartirWhatsapp texto={textoWa} />
        </div>
      )}

      {/* ── VISTA PC (Desktop) ── */}
      <div className="compras-ficha-pc" style={{ marginTop: '.75rem' }}>
        <div style={{ fontSize: '.8rem', fontWeight: 600, marginBottom: '.4rem', color: 'var(--text-strong, #fff)' }}>
          🔍 Marcas de Filtros y Especificaciones para Compra ({filtros.length})
        </div>

        {filtros.length === 0 ? (
          <div className="muted" style={{ fontSize: '.78rem' }}>
            Este equipo aún no tiene ficha de repuestos cargada en Maquinaria.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="items-table" style={{ fontSize: '.78rem', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Sistema</th>
                  <th style={{ textAlign: 'left' }}>Filtro / Insumo</th>
                  <th style={{ textAlign: 'left' }}>N° Parte OEM</th>
                  <th style={{ textAlign: 'left' }}>Marcas y Equivalencias (Donaldson / Fleetguard)</th>
                  <th style={{ textAlign: 'left' }}>Especificación</th>
                  <th style={{ textAlign: 'center' }}>Cant.</th>
                </tr>
              </thead>
              <tbody>
                {filtros.map((f) => {
                  const sis = sistemaDe(f.sistema);
                  return (
                    <tr key={f.id}>
                      <td>{sis.icon} {sis.label}</td>
                      <td><strong>{f.tipo}</strong></td>
                      <td>
                        {f.numero_parte ? (
                          <span className="mono" style={{ fontWeight: 600, color: 'var(--brand, #ff8a00)' }}>
                            {f.numero_parte}
                          </span>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td>
                        {f.equivalencias && f.equivalencias.length > 0 ? (
                          <div style={{ display: 'flex', gap: '.25rem', flexWrap: 'wrap' }}>
                            {f.equivalencias.map((eqStr, i) => (
                              <span key={i} className="badge tone-primary" style={{ fontSize: '.7rem', padding: '.05rem .35rem' }}>
                                {eqStr}
                              </span>
                            ))}
                          </div>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td>{f.especificacion || <span className="muted">—</span>}</td>
                      <td style={{ textAlign: 'center' }}>{fmtNum(f.cantidad)} {f.unidad}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── VISTA TELÉFONO (Móvil) ── */}
      <div className="compras-ficha-movil" style={{ marginTop: '.65rem' }}>
        <div style={{ fontSize: '.8rem', fontWeight: 600, marginBottom: '.35rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>🏷️ Filtros principales ({filtros.length})</span>
          <button type="button" className="btn btn-sm btn-ghost" style={{ fontSize: '.72rem', padding: '.15rem .4rem' }}
            onClick={() => setExpandidoMovil(!expandidoMovil)}>
            {expandidoMovil ? '▲ Resumir' : '▼ Ver todos'}
          </button>
        </div>

        <div style={{ display: 'grid', gap: '.4rem' }}>
          {(expandidoMovil ? filtros : filtros.slice(0, 3)).map((f) => {
            const sis = sistemaDe(f.sistema);
            const marcas = (f.equivalencias ?? []).join(' · ');
            return (
              <div key={f.id} style={{
                padding: '.45rem .65rem',
                background: 'var(--surface-1, #0f172a)',
                borderRadius: 'var(--r-sm, 6px)',
                fontSize: '.78rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{sis.icon} {f.tipo}</strong>
                  <span className="muted">{fmtNum(f.cantidad)} {f.unidad}</span>
                </div>
                {f.numero_parte && (
                  <div className="mono" style={{ fontSize: '.74rem', color: 'var(--brand, #ff8a00)', marginTop: '.1rem' }}>
                    OEM: {f.numero_parte}
                  </div>
                )}
                {marcas && (
                  <div style={{ fontSize: '.74rem', color: '#38bdf8', marginTop: '.1rem' }}>
                    Marcas: {marcas}
                  </div>
                )}
                {f.especificacion && (
                  <div className="muted" style={{ fontSize: '.72rem', marginTop: '.05rem' }}>
                    Esp: {f.especificacion}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
