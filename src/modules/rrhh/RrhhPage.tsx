import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { PersonalTab } from './PersonalTab';
import { AnticiposTab } from './AnticiposTab';
import { NominaTab } from './NominaTab';
import { VacacionesTab } from './VacacionesTab';
import { AdministrativoTab } from './AdministrativoTab';
import { DescansosTab } from './DescansosTab';
import { TabuladorTab } from './TabuladorTab';
import { EmpresasModal } from './EmpresasModal';
import {
  MGG, definicionEmpresa, empresaGuardada, empresaVigente, guardarEmpresaElegida, modoSelectorEmpresas,
  type DefinicionEmpresa, type Empresa,
} from './empresa';
import { contarPersonalPorEmpresa, listEmpresas } from './empresas.repository';

type Vista = 'personal' | 'tabulador' | 'anticipos' | 'nomina' | 'vacaciones' | 'descansos' | 'administrativo';

const TABS: { key: Vista; label: string; icon: string }[] = [
  { key: 'personal', label: 'Personal', icon: '👥' },
  { key: 'tabulador', label: 'Tabulador', icon: '📐' },
  { key: 'anticipos', label: 'Anticipos / Préstamos', icon: '💵' },
  { key: 'nomina', label: 'Nómina', icon: '📋' },
  { key: 'vacaciones', label: 'Vacaciones', icon: '🏖' },
  { key: 'descansos', label: 'Descansos', icon: '🏠' },
  { key: 'administrativo', label: 'Administrativo', icon: '🗂' },
];

/* Las nóminas son las empresas de `rrhh_empresas` (14-10-2026): MGG y las que
   la administradora cree en ⚙ Empresas. El switch de arriba atraviesa TODO el
   módulo: con dos o menos se ve como pastillas (como en Golden Touch), con tres
   o más como lista plegable buscable. Cada pestaña se vuelve a montar al
   cambiar de nómina (`key`), así ningún estado de una se arrastra a la otra. */
export function RrhhPage() {
  const { user } = useSession();
  const { can, appUser, isAdmin } = usePermissions();
  const canWrite = can('rrhh', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;
  const [vista, setVista] = useState<Vista>('personal');

  const [empresas, setEmpresas] = useState<DefinicionEmpresa[] | null>(null);
  const [conteo, setConteo] = useState<Record<string, number> | null>(null);
  const [gestionar, setGestionar] = useState(false);
  const [empresa, setEmpresa] = useState<Empresa>(() => empresaGuardada());

  const cargarEmpresas = useCallback(() => {
    listEmpresas().then(setEmpresas).catch((e) => {
      toast(e instanceof Error ? e.message : 'No se pudieron cargar las empresas', 'error');
      setEmpresas([MGG]);
    });
  }, []);
  // Conteo de adorno: si falla, las pastillas van sin número, pero van.
  const cargarConteo = useCallback(() => {
    contarPersonalPorEmpresa().then(setConteo).catch(() => setConteo(null));
  }, []);
  useEffect(() => { cargarEmpresas(); cargarConteo(); }, [cargarEmpresas, cargarConteo]);
  useRealtime(['rrhh_empresas'], cargarEmpresas);
  useRealtime(['personal'], cargarConteo);

  const activas = useMemo(() => (empresas ?? []).filter((e) => e.activa), [empresas]);
  // La nómina abierta tiene que existir y estar activa; si no, cae en la primera.
  useEffect(() => {
    if (!empresas) return;
    const v = empresaVigente(empresa, activas);
    if (v !== empresa) setEmpresa(v);
  }, [empresas, activas, empresa]);
  useEffect(() => { guardarEmpresaElegida(empresa); }, [empresa]);

  const def = definicionEmpresa(empresa);
  const modo = modoSelectorEmpresas(activas.length);
  const puedeGestionar = isAdmin || canWrite;

  const opciones = useMemo(() => activas.map((e) => ({
    value: e.key,
    label: `${e.icono} Nómina ${e.label}${conteo?.[e.key] != null ? ` (${conteo[e.key]})` : ''}`,
    hint: e.razonSocial,
    keywords: [e.key, e.razonSocial, e.rif ?? ''],
  })), [activas, conteo]);

  return (
    <div>
      <header className="rrhh-cabecera">
        <div className="rrhh-cabecera-fila">
          <h1 className="rrhh-titulo">
            <span aria-hidden="true">👥</span>
            {' RRHH · '}
            <span className="rrhh-titulo-nomina">Nómina {def.label}</span>
          </h1>

          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            {modo === 'pastillas' ? (
              <div className="rrhh-nominas" role="group" aria-label="Nómina">
                {activas.map((e) => {
                  const activa = empresa === e.key;
                  const cuantos = conteo?.[e.key];
                  return (
                    <button key={e.key} type="button" className={`rrhh-nomina-btn${activa ? ' activa' : ''}`}
                      aria-pressed={activa} title={`Personal y nómina de ${e.razonSocial}`} onClick={() => setEmpresa(e.key)}>
                      <span aria-hidden="true">{e.icono}</span>
                      <span>Nómina {e.label}</span>
                      {cuantos != null && <span className="rrhh-nomina-cuenta">({cuantos})</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <SearchSelect options={opciones} value={empresa} onChange={(v) => { if (v) setEmpresa(v); }}
                placeholder="Buscar nómina…" style={{ minWidth: 260 }} />
            )}
            {puedeGestionar && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGestionar(true)} title="Crear, editar o deshabilitar empresas / nóminas">
                ⚙ Empresas
              </button>
            )}
          </div>
        </div>

        <p className="hint muted rrhh-cabecera-nota">
          Personal, nómina quincenal y administrativo de <strong>{def.razonSocial}</strong>{def.rif ? <> · RIF <span className="mono">{def.rif}</span></> : null}. La nómina se paga desde Tesorería.
          {activas.length > 1 && <> Cada nómina tiene su propio personal, anticipos, períodos y recibos; una persona se pasa de una a otra con <strong>↔ Transferir</strong> en su ficha.</>}
        </p>
      </header>

      <div className="view-toggle" role="tablist" aria-label="Vista de RRHH" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} className={vista === t.key ? 'active' : ''} onClick={() => setVista(t.key)}>{t.icon} {t.label}</button>
        ))}
      </div>

      {!empresas && <p className="muted">Cargando…</p>}
      {empresas && <>
        {vista === 'personal' && <PersonalTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} empresas={activas} />}
        {vista === 'tabulador' && <TabuladorTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} />}
        {vista === 'anticipos' && <AnticiposTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} />}
        {vista === 'nomina' && <NominaTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} />}
        {vista === 'vacaciones' && <VacacionesTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} />}
        {vista === 'descansos' && <DescansosTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} />}
        {vista === 'administrativo' && <AdministrativoTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} />}
      </>}

      {gestionar && empresas && (
        <EmpresasModal empresas={empresas} conteo={conteo} actor={actor} actorName={actorName}
          onClose={() => setGestionar(false)} onChanged={() => { cargarEmpresas(); cargarConteo(); }} />
      )}
    </div>
  );
}
