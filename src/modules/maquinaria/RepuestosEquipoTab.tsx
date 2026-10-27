import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum } from '@/shared/lib/format';
import {
  agruparPorSistema, estadoStock, ESTADO_STOCK, textoEquivalencias, textoCada, sistemaDe, coincideRepuesto,
  type ProductoRepuesto, type RepuestoEquipo, type SistemaRepuesto,
} from './repuestosEquipo';
import {
  listRepuestosEquipo, listRepuestosTodos, productosParaFicha, eliminarRepuestoEquipo, copiarRepuestosDeEquipo,
} from './repuestosEquipo.repository';
import { listEquipos, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { RepuestoEquipoModal } from './RepuestoEquipoModal';
import { listadoFlotaPdf, type ListadoFlota } from './flotaPdf';
import { listadoFlotaExcel } from './flotaExcel';

const errMsg = (e: unknown, def: string) => (e instanceof Error ? e.message : (e as { message?: string })?.message || def);

/** Datos de identificación del equipo para el encabezado de los reportes. */
export const identificacionEquipo = (eq: Pick<MaquinariaEquipo, 'marca' | 'modelo' | 'serial' | 'placa' | 'motor_modelo' | 'motor_serial'>) =>
  [[eq.marca, eq.modelo].filter(Boolean).join(' '), eq.serial ? `Serial ${eq.serial}` : null, eq.placa ? `Placa ${eq.placa}` : null,
    eq.motor_modelo && !/^(n\/?a|-|s\/n)$/i.test(eq.motor_modelo.trim()) ? `Motor ${eq.motor_modelo}` : null,
    eq.motor_serial ? `Serial motor ${eq.motor_serial}` : null].filter(Boolean).join(' · ');

function listadoFicha(eq: MaquinariaEquipo, rs: RepuestoEquipo[], productos: Map<string, ProductoRepuesto>): ListadoFlota & { numeros: number[] } {
  const filas = agruparPorSistema(rs).flatMap((g) => g.items.map((r) => {
    const p = r.producto_id ? productos.get(r.producto_id) : null;
    return [
      g.sistema.label, r.tipo, r.numero_parte ?? '', textoEquivalencias(r.equivalencias), r.especificacion ?? '',
      r.cantidad, r.unidad, textoCada(r), r.en_servicio ? 'Sí' : 'No', p?.nombre ?? 'No está en el inventario', p ? p.stock : null,
    ];
  }));
  return {
    titulo: `Repuestos · ${eq.equipo}`,
    subtitulo: identificacionEquipo(eq) || 'Ficha de repuestos del equipo',
    encabezados: ['Sistema', 'Tipo', 'N° de parte', 'Equivalencias', 'Especificación', 'Cant.', 'Und', 'Cada', 'En cada servicio', 'Producto del inventario', 'Stock'],
    filas, anchos: [1.4, 2.2, 1.6, 2.8, 1.6, .7, .7, 1.2, .9, 3, .8], numeros: [5, 10],
    archivo: `repuestos-${eq.equipo}`,
  };
}

/**
 * Pestaña «Repuestos» del expediente: la ficha de lo que lleva el equipo (filtros,
 * aceites, cauchos…) por sistema, con el stock del inventario de cada pieza, para
 * saber qué comprar. Se carga a mano o se copia de otro equipo igual.
 */
export function RepuestosEquipoTab({ equipo, canWrite, actor }: { equipo: MaquinariaEquipo; canWrite: boolean; actor: string }) {
  const [renglones, setRenglones] = useState<RepuestoEquipo[]>([]);
  const [productos, setProductos] = useState<Map<string, ProductoRepuesto>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState<{ renglon: RepuestoEquipo | null; sistema?: SistemaRepuesto } | null>(null);
  const [borrar, setBorrar] = useState<RepuestoEquipo | null>(null);
  const [copiar, setCopiar] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [rs, ps] = await Promise.all([listRepuestosEquipo(equipo.id), productosParaFicha()]);
      setRenglones(rs);
      setProductos(ps);
    } catch (e) { toast(errMsg(e, 'No se pudo cargar la ficha de repuestos'), 'error'); }
    finally { setLoading(false); }
  }, [equipo.id]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_repuestos_equipo', 'productos'], () => { void cargar(); });

  const visibles = useMemo(() => renglones.filter((r) => coincideRepuesto(r, busca, [r.producto_id ? productos.get(r.producto_id)?.nombre : null])), [renglones, busca, productos]);
  const grupos = agruparPorSistema(visibles);
  const cuenta = useMemo(() => {
    const c = { hay: 0, poco: 0, no_hay: 0, sin_producto: 0 };
    for (const r of renglones) c[estadoStock(r.cantidad, r.producto_id ? productos.get(r.producto_id) : null)]++;
    return c;
  }, [renglones, productos]);

  async function exportar(como: 'pdf' | 'excel') {
    try {
      const l = listadoFicha(equipo, renglones, productos);
      if (como === 'pdf') await listadoFlotaPdf(l); else await listadoFlotaExcel(l);
    } catch (e) { toast(errMsg(e, 'No se pudo generar el reporte'), 'error'); }
  }

  if (loading) return <EmptyState message="Cargando la ficha de repuestos…" />;

  return (
    <>
      <div className="aviso info sm"><span className="aviso-icono">🔧</span><div>
        <strong>Lo que lleva este equipo:</strong> filtros, aceites, cauchos, baterías… con su número de parte, las equivalencias por marca y el producto del inventario. Así se sabe qué comprar y la orden de servicio se llena desde aquí. <Link to="/app/maquinaria/repuestos-equipo">Buscar en toda la flota →</Link>
      </div></div>

      <div className="flo-rep-bar">
        {canWrite && <button className="btn btn-primary" onClick={() => setForm({ renglon: null })}>＋ Agregar repuesto</button>}
        {canWrite && <button className="btn" onClick={() => setCopiar(true)}>📋 Copiar de otro equipo</button>}
        <button className="btn" disabled={!renglones.length} onClick={() => void exportar('pdf')}>📄 PDF</button>
        <button className="btn" disabled={!renglones.length} onClick={() => void exportar('excel')}>📊 Excel</button>
      </div>

      {renglones.length > 0 && (
        <div className="flo-stats">
          <div className="flo-stat"><small>Repuestos en la ficha</small><strong>{renglones.length}</strong></div>
          <div className="flo-stat"><small>{ESTADO_STOCK.hay.icon} Hay en inventario</small><strong>{cuenta.hay}</strong></div>
          <div className="flo-stat"><small>{ESTADO_STOCK.no_hay.icon} Sin stock / 🟡 no alcanza</small><strong>{cuenta.no_hay + cuenta.poco}</strong></div>
          <div className="flo-stat"><small>{ESTADO_STOCK.sin_producto.icon} No están en el inventario</small><strong>{cuenta.sin_producto}</strong></div>
        </div>
      )}

      {renglones.length > 4 && (
        <input className="input" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar en la ficha"
          placeholder="Buscar: filtro, P553771, 15W-40, caucho…" />
      )}

      {!renglones.length ? (
        <div className="flo-sec"><EmptyState icon="🔧" message={canWrite
          ? 'Este equipo todavía no tiene ficha de repuestos. Agrega sus filtros, aceites y cauchos, o cópiala de otro equipo igual.'
          : 'Este equipo todavía no tiene ficha de repuestos.'} /></div>
      ) : !grupos.length ? (
        <div className="flo-sec"><EmptyState icon="🔍" message="Nada coincide con la búsqueda." /></div>
      ) : grupos.map((g) => (
        <div key={g.sistema.id} className="flo-sec">
          <div className="flo-sec-head">
            <h3>{g.sistema.icon} {g.sistema.label}</h3>
            {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setForm({ renglon: null, sistema: g.sistema.id })}>＋ {g.sistema.label}</button>}
          </div>
          <ul className="flo-parts flo-rep-list">
            {g.items.map((r) => {
              const p = r.producto_id ? productos.get(r.producto_id) ?? null : null;
              const st = ESTADO_STOCK[estadoStock(r.cantidad, p)];
              return (
                <li key={r.id}>
                  <div className="flo-rep-main">
                    <strong>{r.tipo}{r.numero_parte && <span className="mono"> · {r.numero_parte}</span>}</strong>
                    <span className="mono flo-rep-cant">{fmtNum(r.cantidad)} {r.unidad}</span>
                    {r.equivalencias.length > 0 && <small>Equivalencias: <span className="mono">{textoEquivalencias(r.equivalencias)}</span></small>}
                    {(r.especificacion || textoCada(r) || r.nota) && <small>{[r.especificacion, textoCada(r) ? `cada ${textoCada(r)}` : null, r.nota].filter(Boolean).join(' · ')}</small>}
                  </div>
                  <span className="src">
                    <span className={`flo-chip tone-${st.tono}`} title={st.label}>{st.icon} {p ? `${p.nombre} · ${fmtNum(p.stock)} ${p.unidad}` : st.label}</span>
                    {!r.en_servicio && <span className="flo-chip tone-info">No entra en cada servicio</span>}
                    {canWrite && (
                      <span className="flo-rep-acc">
                        <button className="btn btn-sm btn-ghost" onClick={() => setForm({ renglon: r })} aria-label={`Editar ${r.tipo}`}>✎</button>
                        <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(r)} aria-label={`Quitar ${r.tipo}`}>🗑</button>
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {form && (
        <RepuestoEquipoModal equipo={equipo} renglon={form.renglon} sistemaInicial={form.sistema} productos={productos} actor={actor}
          onClose={() => setForm(null)} onSaved={() => void cargar()} />
      )}
      {copiar && <CopiarFichaModal equipo={equipo} actor={actor} onClose={() => setCopiar(false)} onDone={() => void cargar()} />}
      {borrar && (
        <ConfirmDialog title="Quitar repuesto de la ficha" danger confirmText="Quitar"
          message="Se quita este repuesto de la ficha del equipo. El producto del inventario no se toca."
          preview={<VistaPrevia><Dato label="Equipo">{equipo.equipo}</Dato><Dato label="Sistema">{sistemaDe(borrar.sistema).label}</Dato><Dato label="Repuesto">{borrar.tipo}</Dato><Dato label="N° de parte">{borrar.numero_parte ?? undefined}</Dato></VistaPrevia>}
          onCancel={() => setBorrar(null)}
          onConfirm={() => {
            const r = borrar; setBorrar(null);
            void eliminarRepuestoEquipo(r.id).then(() => { toast('Repuesto quitado de la ficha', 'success'); void cargar(); })
              .catch((e) => toast(errMsg(e, 'No se pudo quitar'), 'error'));
          }} />
      )}
    </>
  );
}

/** Copia la ficha de otro equipo (solo agrega lo que falta; no borra nada). */
function CopiarFichaModal({ equipo, actor, onClose, onDone }: { equipo: MaquinariaEquipo; actor: string; onClose: () => void; onDone: () => void }) {
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [cuenta, setCuenta] = useState<Map<string, number>>(new Map());
  const [origen, setOrigen] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([listEquipos(), listRepuestosTodos()]).then(([es, rs]) => {
      const c = new Map<string, number>();
      for (const r of rs) c.set(r.equipo_id, (c.get(r.equipo_id) ?? 0) + 1);
      setCuenta(c);
      // Primero los del mismo modelo, luego los demás que tengan ficha.
      const mismo = (e: MaquinariaEquipo) => Number(!!equipo.modelo && (e.modelo ?? '').trim().toUpperCase() === equipo.modelo.trim().toUpperCase());
      setEquipos(es.filter((e) => e.id !== equipo.id && (c.get(e.id) ?? 0) > 0).sort((a, b) => mismo(b) - mismo(a) || a.equipo.localeCompare(b.equipo, 'es')));
    }).catch((e) => toast(errMsg(e, 'No se pudieron cargar los equipos'), 'error'));
  }, [equipo.id, equipo.modelo]);

  const opciones = equipos.map((e) => ({ value: e.id, label: `${e.equipo} · ${[e.marca, e.modelo].filter(Boolean).join(' ')} · ${cuenta.get(e.id) ?? 0} repuesto(s)` }));
  const elegido = equipos.find((e) => e.id === origen) ?? null;

  async function copiar() {
    if (!origen) return;
    setSaving(true);
    try {
      const n = await copiarRepuestosDeEquipo(origen, equipo.id, actor);
      toast(n ? `📋 ${n} repuesto(s) copiado(s) de ${elegido?.equipo}.` : 'Este equipo ya tenía todos esos repuestos.', n ? 'success' : 'info');
      onDone();
      onClose();
    } catch (e) { toast(errMsg(e, 'No se pudo copiar la ficha'), 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal compact title={`📋 Copiar ficha a ${equipo.equipo}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void copiar()} disabled={saving || !origen}>{saving ? 'Copiando…' : 'Copiar'}</button>
      </>}>
      <div style={{ display: 'grid', gap: '.7rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>Se agregan los repuestos del otro equipo que este todavía no tiene (mismo sistema, tipo y número de parte). No se borra ni se cambia nada de lo que ya está. Después puedes ajustar cantidades o quitar lo que no aplique.</p>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label htmlFor="rep-copiar">Copiar de</label>
          <SearchSelect id="rep-copiar" options={opciones} value={origen} onChange={setOrigen} placeholder="Equipo con ficha cargada…" emptyText="Ningún otro equipo tiene ficha todavía" />
        </div>
        {elegido && (
          <VistaPrevia titulo="Se copia">
            <Dato label="De">{`${elegido.equipo} · ${[elegido.marca, elegido.modelo].filter(Boolean).join(' ')}`}</Dato>
            <Dato label="A">{`${equipo.equipo} · ${[equipo.marca, equipo.modelo].filter(Boolean).join(' ')}`}</Dato>
            <Dato label="Repuestos en la ficha de origen">{String(cuenta.get(elegido.id) ?? 0)}</Dato>
          </VistaPrevia>
        )}
      </div>
    </Modal>
  );
}
