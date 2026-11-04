/* ============================================================
   MGG · RRHH · Repositorio para Reporte Dinámico (04-11-2026)

   Capa de acceso a datos multi-empresa para la suite de reportes de RRHH.
   Lee de Supabase con paginación defensiva (todasLasFilas) para no
   truncar listas en 1.000 filas.

   Permite consultar:
     - Empresas registradas (rrhh_empresas)
     - Personal filtrado por múltiples empresas (o todas)
     - Carga familiar e hijos de todo el personal seleccionado
     - Histórico de sueldos (personal_sueldos)
     - Histórico del tabulador de cargos (tabulador_cargos_historial)
     - Tasa de cambio oficial BCV del día
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Personal } from '@/shared/lib/types';
import { listEmpresas } from './empresas.repository';
import type { DefinicionEmpresa } from './empresa';
import { listCambiosSueldo, listCargaFamiliarDeTodos, type CambioSueldoRegistro, type FamiliarPersonal } from './personal.repository';
import { listHistorialTabulador } from './tabulador.repository';
import type { HistorialTabulador } from './tabulador';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';
import type { AmbitoRrhh } from './reporteRrhhDinamico';

const TABLA_PERSONAL = 'personal';

/**
 * Consulta el personal soportando filtro multi-empresa.
 * Si empresasSel está vacío o incluye 'TODAS', consulta sin filtrar por empresa.
 */
export async function listPersonalMultiEmpresa(empresasSel?: string[], soloActivos = false): Promise<Personal[]> {
  const tieneFiltro = Array.isArray(empresasSel) && empresasSel.length > 0 && !empresasSel.includes('TODAS');

  const filas = await todasLasFilas<Record<string, unknown>>((d, h) => {
    let q = supabase
      .from(TABLA_PERSONAL)
      .select('*')
      .order('departamento', { ascending: true, nullsFirst: false })
      .order('nombre', { ascending: true })
      .range(d, h);

    if (tieneFiltro) {
      q = q.in('empresa', empresasSel!);
    }
    if (soloActivos) {
      q = q.eq('activo', true);
    }
    return q;
  });

  return filas as unknown as Personal[];
}

export interface PaqueteDatosReporteRrhh {
  empresas: DefinicionEmpresa[];
  mapaEmpresas: Map<string, DefinicionEmpresa>;
  personal: Personal[];
  cargaFamiliar: FamiliarPersonal[];
  mapaFamilia: Map<string, FamiliarPersonal[]>;
  cambiosSueldo: CambioSueldoRegistro[];
  historialTabulador: HistorialTabulador[];
  tasaBcv: number;
}

/**
 * Carga todos los datos requeridos por el reporte dinámico en paralelo.
 */
export async function cargarDatosReporteRrhh(opts: {
  ambito: AmbitoRrhh;
  empresasSel?: string[];
  desde?: string;
  hasta?: string;
}): Promise<PaqueteDatosReporteRrhh> {
  const [empresas, tasaHoy, personal, cargaFamiliar, cambiosSueldo, historialTabulador] = await Promise.all([
    listEmpresas().catch(() => []),
    getTasaHoy().catch(() => null),
    listPersonalMultiEmpresa(opts.empresasSel, false).catch(() => []),
    listCargaFamiliarDeTodos().catch(() => []),
    opts.ambito === 'historico_salarial'
      ? listCambiosSueldo(opts.desde, opts.hasta).catch(() => [])
      : Promise.resolve([]),
    opts.ambito === 'historico_cargos'
      ? listHistorialTabulador().catch(() => [])
      : Promise.resolve([]),
  ]);

  const mapaEmpresas = new Map<string, DefinicionEmpresa>();
  for (const emp of empresas) {
    mapaEmpresas.set(emp.key, emp);
  }

  // Agrupar carga familiar por personalId
  const mapaFamilia = new Map<string, FamiliarPersonal[]>();
  for (const fam of cargaFamiliar) {
    const arr = mapaFamilia.get(fam.personalId) || [];
    arr.push(fam);
    mapaFamilia.set(fam.personalId, arr);
  }

  const tasaBcv = tasaHoy?.usd && tasaHoy.usd > 0 ? tasaHoy.usd : 1;

  return {
    empresas,
    mapaEmpresas,
    personal,
    cargaFamiliar,
    mapaFamilia,
    cambiosSueldo,
    historialTabulador,
    tasaBcv,
  };
}

