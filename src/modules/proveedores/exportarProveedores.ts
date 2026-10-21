/* ============================================================
   MGG · Proveedores · Exportar datos (lógica pura) · 21-10-2026
   Casillas para que el usuario elija QUÉ datos desea mostrar en el
   reporte (PDF y Excel). Los archivos se generan en proveedoresPdf y
   proveedoresExcel con vista previa.
   ============================================================ */
import type { Proveedor } from '@/shared/lib/types';
import { textoActividad, type ActividadEconomica } from './ciiu';

export interface CampoExportProveedor {
  key: string;
  label: string;
  ancho: number;
  valor: (p: Proveedor, actividades?: ActividadEconomica[]) => string;
}

const vacio = (v: string | null | undefined): string => (v ?? '').trim();

export const CAMPOS_EXPORT_PROVEEDORES: CampoExportProveedor[] = [
  { key: 'rif', label: 'RIF', ancho: 14, valor: (p) => vacio(p.rif) },
  { key: 'razon_social', label: 'Razón social', ancho: 36, valor: (p) => vacio(p.razon_social) },
  { key: 'contacto', label: 'Contacto', ancho: 22, valor: (p) => vacio(p.contacto) },
  { key: 'telefono', label: 'Teléfono', ancho: 16, valor: (p) => vacio(p.telefono) },
  { key: 'numero_administracion', label: 'Teléfono administración', ancho: 18, valor: (p) => vacio(p.numero_administracion) },
  { key: 'email', label: 'Correo', ancho: 26, valor: (p) => vacio(p.email) },
  { key: 'direccion', label: 'Dirección', ancho: 36, valor: (p) => vacio(p.direccion) },
  {
    key: 'actividad_economica',
    label: 'Actividad económica (CIIU)',
    ancho: 34,
    valor: (p, acts) => textoActividad(vacio(p.actividad_economica) || null, acts ?? []),
  },
  { key: 'actividad_economica_texto', label: 'Detalle de actividad', ancho: 26, valor: (p) => vacio(p.actividad_economica_texto) },
  { key: 'categorias', label: 'Categorías', ancho: 24, valor: (p) => (p.categorias ?? []).filter(Boolean).join(', ') },
  { key: 'origen', label: 'Origen', ancho: 14, valor: (p) => (p.origen === 'internacional' ? 'Internacional' : 'Nacional') },
  { key: 'estado', label: 'Estado', ancho: 12, valor: (p) => (p.estado === 'activo' ? 'Activo' : 'Inactivo') },
];

/** Campos por defecto cuando abre la primera vez (el listado completo estándar). */
export const CAMPOS_POR_DEFECTO: string[] = [
  'rif',
  'razon_social',
  'contacto',
  'telefono',
  'numero_administracion',
  'email',
  'actividad_economica',
  'categorias',
  'estado',
];

/** Preset de sólo RIF y razón social. */
export const CAMPOS_BASICOS: string[] = ['rif', 'razon_social'];

export function camposElegidosProveedores(keys: readonly string[]): CampoExportProveedor[] {
  const set = new Set(keys);
  return CAMPOS_EXPORT_PROVEEDORES.filter((c) => set.has(c.key));
}

export function tablaExportProveedores(
  proveedores: readonly Proveedor[],
  keys: readonly string[],
  actividades: ActividadEconomica[] = [],
): { head: string[]; filas: string[][] } {
  const campos = camposElegidosProveedores(keys);
  return {
    head: ['N°', ...campos.map((c) => c.label)],
    filas: proveedores.map((p, i) => [
      String(i + 1),
      ...campos.map((c) => c.valor(p, actividades)),
    ]),
  };
}
