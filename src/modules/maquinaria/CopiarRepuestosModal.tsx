import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect, type SearchOption } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum } from '@/shared/lib/format';
import { listEquipos, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { agruparPorSistema, nombreRepuesto, repuestosParaCopiar, type RepuestoEquipo } from './repuestosEquipo';
import { listRepuestosEquipo, copiarRepuestosDeEquipo } from './repuestosEquipo.repository';

/**
 * «Copiar de otro equipo»: las dos EC210 o las dos ENCAVA se cargan una vez y se copian.
 * Solo entra lo que el equipo destino todavía no tiene (mismo tipo + número de parte).
 */
export function CopiarRepuestosModal({ equipo, ficha, actor, onClose, onDone }: {
  equipo: MaquinariaEquipo;
  ficha: RepuestoEquipo[];
  actor: { email: string; nombre: string | null };
  onClose: () => void;
  onDone: () => void;
}) {
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [todas, setTodas] = useState<RepuestoEquipo[]>([]);
  const [desde, setDesde] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([listEquipos(), listRepuestosEquipo()])
      .then(([eqs, fs]) => { setEquipos(eqs); setTodas(fs); })
      .catch(() => toast('No se pudieron cargar los equipos', 'error'));
  }, []);

  const conFicha = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const f of todas) cuenta.set(f.equipo_id, (cuenta.get(f.equipo_id) ?? 0) + 1);
    return equipos.filter((e) => e.id !== equipo.id && (cuenta.get(e.id) ?? 0) > 0).map((e) => ({ e, n: cuenta.get(e.id) ?? 0 }));
  }, [equipos, todas, equipo.id]);
  // Primero los del mismo modelo o marca (los que más probablemente llevan lo mismo).
  const opciones = useMemo<SearchOption[]>(() => [...conFicha]
    .sort((a, b) => Number(pareja(b.e, equipo)) - Number(pareja(a.e, equipo)) || a.e.equipo.localeCompare(b.e.equipo, 'es'))
    .map(({ e, n }) => ({ value: e.id, label: `${e.equipo}${pareja(e, equipo) ? ' · mismo modelo' : ''}`, hint: `${n} en su ficha`, keywords: [e.marca ?? '', e.modelo ?? '', e.tipo ?? ''] })),
  [conFicha, equipo]);
  const origen = useMemo(() => todas.filter((f) => f.equipo_id === desde), [todas, desde]);
  const nuevos = useMemo(() => repuestosParaCopiar(origen, ficha), [origen, ficha]);
  const repetidos = origen.length - nuevos.length;

  async function copiar() {
    if (!desde) { toast('Elige el equipo del que se copia la ficha.', 'warning'); return; }
    setSaving(true);
    try {
      const n = await copiarRepuestosDeEquipo(desde, equipo.id, actor);
      toast(n ? `📋 ${n} repuesto(s) copiados a ${equipo.equipo}` : 'No había nada nuevo que copiar.', n ? 'success' : 'info');
      onDone();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : (e as { message?: string })?.message || 'No se pudo copiar la ficha', 'error');
    } finally { setSaving(false); }
  }

  return (
    <Modal title={`📋 Copiar ficha de repuestos → ${equipo.equipo}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void copiar()} disabled={saving || !desde || !nuevos.length}>{saving ? 'Copiando…' : `Copiar ${nuevos.length ? `${nuevos.length} repuesto(s)` : ''}`}</button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.8rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>Trae a este equipo la ficha de otro (mismo modelo, por ejemplo). Lo que ya tenga no se repite; después se puede editar o borrar renglón por renglón.</p>
        {conFicha.length ? (
          <div className="form-row" style={{ marginBottom: 0 }}><label htmlFor="cop-desde">Copiar de</label>
            <SearchSelect id="cop-desde" options={opciones} value={desde} onChange={setDesde} placeholder="🔍 Equipo con ficha cargada…" emptyText="Ningún equipo coincide" />
          </div>
        ) : <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>Ningún otro equipo tiene ficha de repuestos todavía.</p>}
        {desde && (
          <div className="flo-sec">
            <div className="flo-sec-head"><h3>Se copian {nuevos.length} de {origen.length}</h3>{repetidos > 0 && <span className="muted" style={{ fontSize: '.76rem' }}>{repetidos} ya estaban</span>}</div>
            {nuevos.length ? agruparPorSistema(nuevos).map((g) => (
              <div key={g.sistema.id} style={{ marginBottom: '.4rem' }}>
                <strong style={{ fontSize: '.8rem' }}>{g.sistema.icon} {g.sistema.label}</strong>
                <ul className="flo-parts">
                  {g.items.map((r) => <li key={r.id}><span>{nombreRepuesto(r)}</span><strong className="mono">{fmtNum(r.cantidad)} {r.unidad}</strong></li>)}
                </ul>
              </div>
            )) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Este equipo ya tiene todo lo de esa ficha.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

const limpio = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();
/** Mismo modelo (o misma marca si no hay modelo). */
function pareja(a: Pick<MaquinariaEquipo, 'marca' | 'modelo'>, b: Pick<MaquinariaEquipo, 'marca' | 'modelo'>): boolean {
  if (limpio(a.modelo) && limpio(a.modelo) === limpio(b.modelo)) return true;
  return !limpio(a.modelo) && !!limpio(a.marca) && limpio(a.marca) === limpio(b.marca);
}
