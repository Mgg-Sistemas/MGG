/* ============================================================
   MGG · Proveedores · listado para PDF y Excel (lógica pura) · 21-10-2026
   Convierte los proveedores (los que están a la vista, con sus filtros) en filas de texto
   listas para imprimir: sin nulos, con la actividad económica legible y las categorías
   unidas. El Excel y el PDF usan las mismas filas, así no se contradicen.
   ============================================================ */
import type { Proveedor } from '@/shared/lib/types';
import { textoActividad, type ActividadEconomica } from './ciiu';

export interface FilaProveedor {
  rif: string;
  razonSocial: string;
  contacto: string;
  telefono: string;
  telefonoAdmin: string;
  email: string;
  direccion: string;
  actividad: string;
  categorias: string;
  origen: string;
  estado: string;
}

/** Lo que el usuario filtró en pantalla (para dejarlo escrito en el reporte). */
export interface FiltrosProveedores {
  texto?: string;
  estado?: '' | 'activo' | 'inactivo';
  categoria?: string;
}

const vacio = (v: string | null | undefined): string => (v ?? '').trim();

/** Una fila por proveedor, en el orden recibido. */
export function filasProveedores(lista: Proveedor[], actividades: ActividadEconomica[] = []): FilaProveedor[] {
  return lista.map((p) => {
    const ciiu = textoActividad(vacio(p.actividad_economica) || null, actividades);
    const libre = vacio(p.actividad_economica_texto);
    return {
      rif: vacio(p.rif),
      razonSocial: vacio(p.razon_social),
      contacto: vacio(p.contacto),
      telefono: vacio(p.telefono),
      telefonoAdmin: vacio(p.numero_administracion),
      email: vacio(p.email),
      direccion: vacio(p.direccion),
      actividad: [ciiu, libre].filter(Boolean).join(' — '),
      categorias: (p.categorias ?? []).filter(Boolean).join(', '),
      origen: p.origen === 'internacional' ? 'Internacional' : 'Nacional',
      estado: p.estado === 'activo' ? 'Activo' : 'Inactivo',
    };
  });
}

/** «Estado: Activos · Categoría: EPP · Búsqueda: «abc»», o «Sin filtros (todos los proveedores)». */
export function textoFiltros(f: FiltrosProveedores): string {
  const partes: string[] = [];
  if (f.estado) partes.push(`Estado: ${f.estado === 'activo' ? 'Activos' : 'Inactivos'}`);
  if (f.categoria) partes.push(`Categoría: ${f.categoria}`);
  if (vacio(f.texto)) partes.push(`Búsqueda: «${vacio(f.texto)}»`);
  return partes.length ? partes.join(' · ') : 'Sin filtros (todos los proveedores)';
}

/** «3 proveedor(es) · 2 activo(s) · 1 inactivo(s)» */
export function resumenProveedores(filas: FilaProveedor[]): string {
  const activos = filas.filter((f) => f.estado === 'Activo').length;
  return `${filas.length} proveedor(es) · ${activos} activo(s) · ${filas.length - activos} inactivo(s)`;
}
