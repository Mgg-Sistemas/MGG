import type { AbcClass } from './restock';

export type StockFilter = '' | 'critico' | 'restock' | 'ok' | 'sin_mov';
export type EstadoFilter = '' | 'activo' | 'inactivo';
export type FundicionFilter = '' | 'si' | 'no' | 'en_proceso';

/** Campos de filtrado compartidos por inventario general y por el detalle de almacén. */
export interface FilterValues {
  filterText: string;
  filterCat: string;
  filterClass: '' | AbcClass;
  filterStock: StockFilter;
  filterEstado: EstadoFilter;
  filterFundicion: FundicionFilter;
  filterAlmacen: string;
}

export interface AlmacenOpcion { value: string; label: string }

interface InventarioFilterbarProps {
  values: FilterValues;
  categorias: string[];
  /** Almacenes para el filtro por ubicación. Solo se pasa en la vista general
   *  (en el detalle de un almacén ya está acotado, así que el select no aparece).
   *  Lista jerárquica: el almacén PADRE se elige "sin subalmacén" (roll-up: trae
   *  todos sus productos y los de sus subalmacenes); los subalmacenes van indentados. */
  almacenes?: AlmacenOpcion[];
  /** Texto de la opción "todos" del filtro por ubicación (def. "Todos los almacenes").
   *  Dentro de un centro se usa "Todos los subalmacenes". */
  almacenTodosLabel?: string;
  /** title/tooltip del desplegable de ubicación (ej. "Subalmacén" dentro de un centro). */
  almacenPlaceholder?: string;
  onChange: (key: keyof FilterValues, value: string) => void;
}

/** Barra de filtros reutilizable de inventario (búsqueda + categoría/fundición/ABC/stock/estado/almacén). */
export function InventarioFilterbar({ values, categorias, almacenes, almacenTodosLabel, almacenPlaceholder, onChange }: InventarioFilterbarProps) {
  return (
    <div className="filterbar">
      <input
        className="search"
        placeholder="Buscar: nombre, medida, marca, alias… (ej. clavo media pulgada)"
        value={values.filterText}
        onChange={(e) => onChange('filterText', e.target.value)}
      />
      <select
        className="select"
        style={{ maxWidth: 180 }}
        value={values.filterCat}
        onChange={(e) => onChange('filterCat', e.target.value)}
      >
        <option value="">Todas las categorías</option>
        {categorias.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {almacenes && (
        <select
          className="select"
          style={{ maxWidth: 200 }}
          title={almacenPlaceholder}
          value={values.filterAlmacen}
          onChange={(e) => onChange('filterAlmacen', e.target.value)}
        >
          <option value="">{almacenTodosLabel ?? 'Todos los almacenes'}</option>
          {almacenes.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
      )}
      <select
        className="select"
        style={{ maxWidth: 180 }}
        value={values.filterFundicion}
        onChange={(e) => onChange('filterFundicion', e.target.value)}
      >
        <option value="">Todos</option>
        <option value="si">Con receta de fundición</option>
        <option value="en_proceso">En proceso de fundición</option>
        <option value="no">Sin receta</option>
      </select>
      <select
        className="select"
        style={{ maxWidth: 140 }}
        value={values.filterClass}
        onChange={(e) => onChange('filterClass', e.target.value)}
      >
        <option value="">Todas las clases</option>
        <option value="A">Clase A</option>
        <option value="B">Clase B</option>
        <option value="C">Clase C</option>
      </select>
      <select
        className="select"
        style={{ maxWidth: 200 }}
        value={values.filterStock}
        onChange={(e) => onChange('filterStock', e.target.value)}
      >
        <option value="">Todo el stock</option>
        <option value="critico">Crítico</option>
        <option value="restock">Reabastecer (no crítico)</option>
        <option value="ok">Stock óptimo</option>
        <option value="sin_mov">Sin existencias</option>
      </select>
      <select
        className="select"
        style={{ maxWidth: 140 }}
        value={values.filterEstado}
        onChange={(e) => onChange('filterEstado', e.target.value)}
      >
        <option value="">Todos</option>
        <option value="activo">Activos</option>
        <option value="inactivo">Inactivos</option>
      </select>
    </div>
  );
}
