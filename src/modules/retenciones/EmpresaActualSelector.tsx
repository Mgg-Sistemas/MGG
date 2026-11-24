/* ============================================================
   Golden Touch · Retenciones · Selector de «empresa actual»

   Aparece arriba del módulo SOLO cuando hay varias empresas y la base ya trae
   la empresa en las retenciones (multiempresa). En single-empresa no se ve:
   todo sigue como hoy. Usa el SearchSelect del sistema (nada de inputs sueltos).
   ============================================================ */
import { SearchSelect } from '@/shared/ui/SearchSelect';
import type { EmpresaReceptora } from './empresasReceptoras.repository';

export function EmpresaActualSelector({ empresas, empresaId, onChange }: {
  empresas: EmpresaReceptora[];
  empresaId: string | null;
  onChange: (id: string) => void;
}) {
  // Con una sola empresa no hay nada que elegir.
  if (empresas.length <= 1) return null;
  const opciones = empresas
    .filter((e) => e.activo || e.id === empresaId)
    .map((e) => ({ value: e.id, label: e.nombreCorto?.trim() || e.nombre }));
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
      <span className="muted" style={{ fontSize: '.85rem', fontWeight: 600 }}>Empresa:</span>
      <div style={{ minWidth: 200 }}>
        <SearchSelect
          value={empresaId ?? ''}
          onChange={(v) => { if (v) onChange(v); }}
          placeholder="🔍 Elegir empresa…"
          options={opciones}
        />
      </div>
    </div>
  );
}
