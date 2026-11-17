/* ============================================================
   Golden Touch · Administración · Centros de Acopio, Fases y Responsables
   (05/11/2026)

   Motor para responder a las preguntas críticas de control gerencial:
     1. ¿En qué FASE está cada centro de acopio o empresa respecto a:
        - Documentación y permisología minera/legal?
        - Gastos fijos y costos recurrentes?
        - O consolidado integral de ambos?
     2. ¿Quién es RESPONSABLE de qué?:
        - De una empresa completa.
        - De varios centros de acopio.
        - De todos los gastos fijos de una empresa.
        - De gastos fijos puntuales de ciertas empresas.
        - De documentos puntuales (ej. RUPDAE, RAGDA, Solvencias).
     3. ¿Quién actualiza qué documento en el HISTORIAL?:
        - Trazabilidad y auditoría ligera de quién modificó qué, cuándo y qué acción realizó.
   ============================================================ */

import type { DocumentoEmpresa, Empresa, GastoFijo, InfoCarpetaDoc } from './admin.repository';
import { leerCarpetasPersonalizadas } from './GestionarCarpetasModal';
import { TIPO_DOCUMENTO_LABEL } from './admin.repository';

export interface CentroAcopio {
  id: string;
  nombre: string;
  empresaClave: string;
  activo?: boolean;
  /** `null` llega de la base; `undefined`, de los centros de fabrica. */
  responsablePrincipal?: string | null;
  fasePredeterminada?: string | null;
  descripcion?: string | null;
}

export interface FaseDefinicion {
  id: string;
  nombre: string;
  nivel: number;
  descripcion: string;
  color: string;
  bg: string;
}

export const FASES_OPERATIVAS: FaseDefinicion[] = [
  {
    id: 'fase_1',
    nombre: 'Fase 1: Constitución e Instalación Base',
    nivel: 1,
    descripcion: 'Carta constitutiva, RIF, permisos preliminares de sitio y patentes base.',
    color: '#38bdf8',
    bg: 'rgba(56, 189, 248, 0.15)',
  },
  {
    id: 'fase_2',
    nombre: 'Fase 2: Permisología Minera y Ambiental',
    nivel: 2,
    descripcion: 'RUPDAE, RAGDA, Permiso Ambiental MINEC, providencias y concesión.',
    color: '#eab308',
    bg: 'rgba(234, 179, 8, 0.15)',
  },
  {
    id: 'fase_3',
    nombre: 'Fase 3: Laboral, Solvencias y Parafiscales',
    nivel: 3,
    descripcion: 'MINTRAS, INCES, IVSS, FAOV y solvencias municipales operativas.',
    color: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.15)',
  },
  {
    id: 'fase_4',
    nombre: 'Fase 4: Operación Regular y Mantenimiento',
    nivel: 4,
    descripcion: '100% de permisología vigente, contratos vigentes y gastos fijos presupuestados.',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.15)',
  },
  {
    id: 'fase_auditoria',
    nombre: 'Fase de Auditoría y Regularización',
    nivel: 0,
    descripcion: 'Atención urgente: permisos caducados o en trámite de renovación.',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.15)',
  },
];

export const ROLES_RESPONSABLES_DEFECTO = [
  'Dirección de Operaciones',
  'Jefe de Patio y Maquinaria',
  'Jefe de Planta',
  'Administración y Finanzas',
  'Analista de Tesorería',
  'Analista de Compras',
  'Auditoría y Legal',
  'Asesor Contable',
];

export function normalizarNombreResponsable(nombre: string): string {
  const t = (nombre || '').trim();
  if (/administra.*finanza/i.test(t)) return 'Administración y Finanzas';
  if (/direcci.*operaci/i.test(t)) return 'Dirección de Operaciones';
  if (/jefe.*patio/i.test(t)) return 'Jefe de Patio y Maquinaria';
  if (/jefe.*planta/i.test(t)) return 'Jefe de Planta';
  return t;
}

export function obtenerListaResponsables(
  centros: CentroAcopio[] = [],
  documentos: DocumentoEmpresa[] = [],
  gastos: GastoFijo[] = [],
  carpetas: InfoCarpetaDoc[] = [],
  usuarios: Array<{
    nombre?: string | null;
    apellido?: string | null;
    email: string;
    estado?: string;
    archivado_en?: string | null;
    bloqueado?: boolean;
  }> = [],
): string[] {
  // REGLA ESTRICTA SOLICITADA POR EL USUARIO:
  // «Solo deben aparecer usuarios activos, nada más»
  // Se muestran exclusivamente los usuarios activos reales del sistema (Nombre + Apellido).
  // Quedan terminantemente excluidos roles genéricos, correos electrónicos y usuarios inactivos o archivados.
  if (usuarios && usuarios.length > 0) {
    const setActivos = new Set<string>();
    for (const u of usuarios) {
      const esActivo = (!u.estado || u.estado === 'activo') && !u.archivado_en && !u.bloqueado;
      if (!esActivo) continue;

      const nombreCompleto = [u.nombre, u.apellido].filter(Boolean).join(' ').trim();
      if (nombreCompleto && !nombreCompleto.includes('@')) {
        setActivos.add(nombreCompleto);
      }
    }
    return Array.from(setActivos).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }

  // Fallback para entornos de test unitario o si aún no se han cargado usuarios
  const set = new Set<string>(ROLES_RESPONSABLES_DEFECTO.map(normalizarNombreResponsable));
  for (const c of centros) {
    if (c.responsablePrincipal?.trim() && !c.responsablePrincipal.includes('@')) {
      set.add(normalizarNombreResponsable(c.responsablePrincipal));
    }
  }
  for (const cp of carpetas) {
    if (cp.responsable?.trim() && !cp.responsable.includes('@')) {
      set.add(normalizarNombreResponsable(cp.responsable));
    }
  }
  for (const d of documentos) {
    if (d.responsable?.trim() && !d.responsable.includes('@')) {
      set.add(normalizarNombreResponsable(d.responsable));
    }
  }
  for (const g of gastos) {
    if (g.responsable?.trim() && !g.responsable.includes('@')) {
      set.add(normalizarNombreResponsable(g.responsable));
    }
  }

  return Array.from(set)
    .filter(Boolean)
    .filter((x) => !x.includes('@'))
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

export const CENTROS_ACOPIO_DEFECTO: CentroAcopio[] = [
  {
    id: 'acopio_principal',
    nombre: 'Centro de Acopio Principal',
    empresaClave: 'GT',
    responsablePrincipal: 'Dirección de Operaciones',
    fasePredeterminada: 'Fase 4: Operación Regular y Mantenimiento',
    descripcion: 'Pesaje, recepción y custodia de material aurífero.',
  },
  {
    id: 'patio_brasilero',
    nombre: 'Patio Brasilero (Maquinaria)',
    empresaClave: 'GT',
    responsablePrincipal: 'Jefe de Patio y Maquinaria',
    fasePredeterminada: 'Fase 4: Operación Regular y Mantenimiento',
    descripcion: 'Estacionamiento de camiones, lubricación y abastecimiento de combustible.',
  },
  {
    id: 'planta_molinos',
    nombre: 'Planta de Molienda y Beneficio',
    empresaClave: 'GT',
    responsablePrincipal: 'Jefe de Planta',
    fasePredeterminada: 'Fase 2: Permisología Minera y Ambiental',
    descripcion: 'Circuito de trituración, amalgamación y tanques de recuperación.',
  },
  {
    id: 'sede_administrativa',
    nombre: 'Sede Administrativa / Central',
    empresaClave: 'GT',
    responsablePrincipal: 'Administración y Finanzas',
    fasePredeterminada: 'Fase 4: Operación Regular y Mantenimiento',
    descripcion: 'Oficinas corporativas, gestión tributaria y pagos parafiscales.',
  },
];

const CLAVE_STORAGE_CENTROS = 'admin.centros_acopio.custom.v1';

export function leerCentrosAcopio(): CentroAcopio[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(CLAVE_STORAGE_CENTROS) : null;
    if (!raw) return CENTROS_ACOPIO_DEFECTO;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fallback
  }
  return CENTROS_ACOPIO_DEFECTO;
}

export function guardarCentrosAcopio(centros: CentroAcopio[]): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(CLAVE_STORAGE_CENTROS, JSON.stringify(centros));
    }
  } catch {
    // ignorar
  }
}

/* ───────────── Métricas y Matriz por Centro de Acopio ───────────── */

export interface MetricasCentroAcopio {
  centroId: string;
  centroNombre: string;
  empresaClave: string;
  empresaNombre: string;
  responsablePrincipal: string;
  faseActual: string;
  faseColor: string;
  faseBg: string;
  // Permisología
  docsTotal: number;
  docsVigentes: number;
  docsPorVencer: number;
  docsVencidos: number;
  docsEnTramite: number;
  porcentajeCumplimientoDocs: number;
  // Gastos Fijos
  gastosFijosTotal: number;
  montoMensualUsd: number;
  serviciosGastos: string[];
  // Estatus Consolidado
  semaforo: 'al_dia' | 'atencion' | 'critico';
  diagnostico: string;
}

export function calcularMatrizCentrosAcopio({
  centros,
  empresas,
  documentos,
  gastosFijos = [],
  carpetas,
}: {
  centros: CentroAcopio[];
  empresas: Empresa[];
  documentos: DocumentoEmpresa[];
  gastosFijos?: GastoFijo[];
  carpetas?: InfoCarpetaDoc[];
}): MetricasCentroAcopio[] {
  const empMap = new Map(empresas.map((e) => [e.clave, e.nombre]));
  const carpetasEfectivas = carpetas || leerCarpetasPersonalizadas();
  const carpetasPorId = new Map(carpetasEfectivas.map((cp) => [cp.id, cp]));

  return centros.map((c) => {
    const empNombre = empMap.get(c.empresaClave) || c.empresaClave;

    // Documentos asociados a este centro (por documento directo, por carpeta asociada o por empresa)
    const docsCentro = documentos.filter((d) => {
      // 1. Coincide por centro específico asignado al documento
      const cAcopioDoc = (
        (d as unknown as { centroAcopioId?: string; centroAcopio?: string }).centroAcopioId ||
        (d as unknown as { centroAcopioId?: string; centroAcopio?: string }).centroAcopio ||
        ''
      ).trim().toLowerCase();

      if (cAcopioDoc) {
        return cAcopioDoc === c.nombre.toLowerCase() || cAcopioDoc === c.id.toLowerCase();
      }

      // 2. Coincide por centro asociado a la carpeta del documento
      const carpetaDoc = carpetasPorId.get(d.carpeta);
      if (carpetaDoc?.centroAcopioId) {
        return (
          carpetaDoc.centroAcopioId.toLowerCase() === c.id.toLowerCase() ||
          carpetaDoc.centroAcopioId.toLowerCase() === c.nombre.toLowerCase()
        );
      }

      // 3. Documentos generales sin centro específico: si coinciden en la empresa
      return d.empresaClave === c.empresaClave;
    });

    let vigentes = 0;
    let porVencer = 0;
    let vencidos = 0;
    let enTramite = 0;

    for (const d of docsCentro) {
      if (d.statusVencimiento === 'vencido') vencidos += 1;
      else if (d.statusVencimiento === 'vencido_en_tramite') enTramite += 1;
      else if (d.statusVencimiento === 'por_vencer') porVencer += 1;
      else vigentes += 1; // vigente o no_vence
    }

    const docsTotal = docsCentro.length;
    const porcentajeCumplimientoDocs = docsTotal > 0 ? Math.round((vigentes / docsTotal) * 100) : 100;

    // Gastos fijos asociados a este centro o empresa
    const gastosCentro = gastosFijos.filter((g) => {
      const cAcopioGasto = (
        g.centroAcopioId ||
        (g as unknown as { centroAcopio?: string }).centroAcopio ||
        ''
      ).trim().toLowerCase();

      if (cAcopioGasto) {
        return cAcopioGasto === c.nombre.toLowerCase() || cAcopioGasto === c.id.toLowerCase();
      }

      // Si el gasto menciona explícitamente el centro en el concepto
      const conceptoNorm = g.concepto.toLowerCase();
      if (conceptoNorm.includes(c.nombre.toLowerCase()) || conceptoNorm.includes(c.id.toLowerCase())) {
        return true;
      }

      // Si no tiene centro asignado explícitamente, asociar a sede administrativa o acopio principal
      return (c.id === 'sede_administrativa' || c.id === 'acopio_principal') && g.empresaClave === c.empresaClave;
    });

    let montoUsd = 0;
    const servicios: string[] = [];
    for (const g of gastosCentro) {
      if (g.estado === 'activo') {
        const factor = g.periodicidad === 'anual' ? 1 / 12 : g.periodicidad === 'trimestral' ? 1 / 3 : 1;
        const montoMensual = g.monto * factor;
        montoUsd += g.moneda === 'USD' ? montoMensual : g.tasaRef && g.tasaRef > 0 ? montoMensual / g.tasaRef : montoMensual / 40;
        servicios.push(g.concepto);
      }
    }

    // Determinar fase y semáforo
    let semaforo: 'al_dia' | 'atencion' | 'critico' = 'al_dia';
    let diagnostico = 'Todos los permisos y gastos al día.';
    let faseActual = c.fasePredeterminada || 'Fase 4: Operación Regular y Mantenimiento';

    if (vencidos > 0) {
      semaforo = 'critico';
      faseActual = 'Fase de Auditoría y Regularización';
      diagnostico = `Alerta crítica: ${vencidos} documento(s) vencido(s). Requiere renovación inmediata.`;
    } else if (porVencer > 0 || enTramite > 0) {
      semaforo = 'atencion';
      diagnostico = `Atención: ${porVencer} documento(s) por vencer y ${enTramite} en trámite.`;
    }

    const faseObj = FASES_OPERATIVAS.find((f) => f.nombre === faseActual) || FASES_OPERATIVAS[3];

    return {
      centroId: c.id,
      centroNombre: c.nombre,
      empresaClave: c.empresaClave,
      empresaNombre: empNombre,
      responsablePrincipal: c.responsablePrincipal || 'Sin asignar',
      faseActual,
      faseColor: faseObj.color,
      faseBg: faseObj.bg,
      docsTotal,
      docsVigentes: vigentes,
      docsPorVencer: porVencer,
      docsVencidos: vencidos,
      docsEnTramite: enTramite,
      porcentajeCumplimientoDocs,
      gastosFijosTotal: gastosCentro.length,
      montoMensualUsd: Math.round(montoUsd * 100) / 100,
      serviciosGastos: servicios.slice(0, 5),
      semaforo,
      diagnostico,
    };
  });
}

/* ───────────── Matriz de Responsables ───────────── */

export interface MetricasResponsable {
  responsable: string;
  empresas: string[];
  centrosAcopio: string[];
  documentosTotal: number;
  documentosVigentes: number;
  documentosPorVencer: number;
  documentosVencidos: number;
  documentosEnTramite: number;
  gastosFijosTotal: number;
  presupuestoMensualUsd: number;
  itemsCriticos: number;
  nivelResponsabilidad: 'empresa_completa' | 'centro_acopio' | 'gastos_fijos' | 'documentos_puntuales';
}

export function calcularMatrizResponsables({
  documentos,
  gastosFijos = [],
  centros = [],
  carpetas,
}: {
  documentos: DocumentoEmpresa[];
  gastosFijos?: GastoFijo[];
  centros?: CentroAcopio[];
  carpetas?: InfoCarpetaDoc[];
}): MetricasResponsable[] {
  const carpetasEfectivas = carpetas || leerCarpetasPersonalizadas();
  const carpetasPorId = new Map(carpetasEfectivas.map((cp) => [cp.id, cp]));

  const mapa = new Map<string, {
    responsable: string;
    empresas: Set<string>;
    centrosAcopio: Set<string>;
    docs: DocumentoEmpresa[];
    gastos: GastoFijo[];
  }>();

  function obtenerOcrear(nombre: string) {
    const key = normalizarNombreResponsable(nombre) || 'Sin responsable asignado';
    if (!mapa.has(key)) {
      mapa.set(key, {
        responsable: key,
        empresas: new Set(),
        centrosAcopio: new Set(),
        docs: [],
        gastos: [],
      });
    }
    return mapa.get(key)!;
  }

  // 1. Asignaciones de Centros de Acopio y sus responsables principales
  const centroPorId = new Map(centros.map((c) => [c.id.toLowerCase(), c]));
  const centroPorNombre = new Map(centros.map((c) => [c.nombre.toLowerCase(), c]));

  for (const c of centros) {
    if (c.responsablePrincipal) {
      const r = obtenerOcrear(c.responsablePrincipal);
      r.empresas.add(c.empresaClave);
      r.centrosAcopio.add(c.nombre);
    }
  }

  // 2. Documentos: asignación por responsable explícito, por responsable de carpeta, por socio/titular Y por responsable del centro de acopio
  for (const d of documentos) {
    const responsablesAsignar = new Set<string>();

    // A) Responsable explícito anotado en el documento
    if (d.responsable?.trim()) {
      responsablesAsignar.add(d.responsable.trim());
    }

    // B) Responsable configurado en la carpeta del documento
    const cp = carpetasPorId.get(d.carpeta);
    if (cp?.responsable?.trim()) {
      responsablesAsignar.add(cp.responsable.trim());
    }

    // C) Titular o socio
    const titular = d.socioNombre?.trim();
    if (titular) {
      responsablesAsignar.add(titular);
    }

    // D) Responsable del Centro de Acopio (si el documento o su carpeta tienen centro asignado)
    let centroAsociado: CentroAcopio | undefined;
    const cAcopioDoc = (
      d.centroAcopioId ||
      (d as unknown as { centroAcopio?: string }).centroAcopio ||
      ''
    ).trim().toLowerCase();

    if (cAcopioDoc) {
      centroAsociado = centroPorId.get(cAcopioDoc) || centroPorNombre.get(cAcopioDoc);
    } else if (cp?.centroAcopioId) {
      centroAsociado =
        centroPorId.get(cp.centroAcopioId.toLowerCase()) ||
        centroPorNombre.get(cp.centroAcopioId.toLowerCase());
    }

    if (centroAsociado?.responsablePrincipal) {
      responsablesAsignar.add(centroAsociado.responsablePrincipal);
    }

    // E) Si no tiene ni responsable ni centro asignado, atribuir a Administración y Finanzas
    if (responsablesAsignar.size === 0) {
      responsablesAsignar.add('Administración y Finanzas');
    }

    for (const resp of responsablesAsignar) {
      const r = obtenerOcrear(resp);
      r.empresas.add(d.empresaClave);
      if (centroAsociado) r.centrosAcopio.add(centroAsociado.nombre);
      r.docs.push(d);
    }
  }

  // 3. Gastos Fijos: asignación por responsable explícito, o por centro de acopio
  for (const g of gastosFijos) {
    const responsablesAsignar = new Set<string>();

    // A) Responsable explícito del gasto
    if (g.responsable?.trim()) {
      responsablesAsignar.add(g.responsable.trim());
    }

    // B) Por centro de acopio asociado
    let centroAsociado: CentroAcopio | undefined;
    const cAcopioG = (
      g.centroAcopioId ||
      (g as unknown as { centroAcopio?: string }).centroAcopio ||
      ''
    ).trim().toLowerCase();

    if (cAcopioG) {
      centroAsociado = centroPorId.get(cAcopioG) || centroPorNombre.get(cAcopioG);
      if (centroAsociado?.responsablePrincipal) {
        responsablesAsignar.add(centroAsociado.responsablePrincipal);
      }
    }

    // C) Si no tiene responsable explícito ni centro, va a Administración y Finanzas
    if (responsablesAsignar.size === 0) {
      responsablesAsignar.add('Administración y Finanzas');
    }

    for (const resp of responsablesAsignar) {
      const r = obtenerOcrear(resp);
      r.empresas.add(g.empresaClave);
      if (centroAsociado) r.centrosAcopio.add(centroAsociado.nombre);
      r.gastos.push(g);
    }
  }

  return Array.from(mapa.values()).map((entry) => {
    let vigentes = 0;
    let porVencer = 0;
    let vencidos = 0;
    let enTramite = 0;

    for (const d of entry.docs) {
      if (d.statusVencimiento === 'vencido') vencidos += 1;
      else if (d.statusVencimiento === 'vencido_en_tramite') enTramite += 1;
      else if (d.statusVencimiento === 'por_vencer') porVencer += 1;
      else vigentes += 1;
    }

    let presupuesto = 0;
    for (const g of entry.gastos) {
      if (g.estado === 'activo') {
        const factor = g.periodicidad === 'anual' ? 1 / 12 : g.periodicidad === 'trimestral' ? 1 / 3 : 1;
        const mensual = g.monto * factor;
        presupuesto += g.moneda === 'USD' ? mensual : g.tasaRef && g.tasaRef > 0 ? mensual / g.tasaRef : mensual / 40;
      }
    }

    const itemsCriticos = vencidos + porVencer;

    // Determinar nivel de responsabilidad
    let nivel: 'empresa_completa' | 'centro_acopio' | 'gastos_fijos' | 'documentos_puntuales' = 'documentos_puntuales';
    if (entry.centrosAcopio.size > 0) {
      nivel = 'centro_acopio';
    } else if (entry.gastos.length > 0 && entry.docs.length === 0) {
      nivel = 'gastos_fijos';
    } else if (entry.empresas.size > 1 || (entry.docs.length > 5 && entry.gastos.length > 2)) {
      nivel = 'empresa_completa';
    }

    return {
      responsable: entry.responsable,
      empresas: Array.from(entry.empresas),
      centrosAcopio: Array.from(entry.centrosAcopio),
      documentosTotal: entry.docs.length,
      documentosVigentes: vigentes,
      documentosPorVencer: porVencer,
      documentosVencidos: vencidos,
      documentosEnTramite: enTramite,
      gastosFijosTotal: entry.gastos.length,
      presupuestoMensualUsd: Math.round(presupuesto * 100) / 100,
      itemsCriticos,
      nivelResponsabilidad: nivel,
    };
  });
}

/* ───────────── Trazabilidad e Historial de Auditoría ───────────── */

export interface EventoAuditoriaDoc {
  id: string;
  documentoId: string;
  documentoNombre: string;
  tipo: string;
  tipoLabel: string;
  empresaClave: string;
  actor: string;
  fecha: string;
  accion: string;
  detalle: string;
  responsable?: string;
}

export function extraerHistorialGlobalDocumentos(
  documentos: DocumentoEmpresa[],
  filtroActor?: string,
): EventoAuditoriaDoc[] {
  const eventos: EventoAuditoriaDoc[] = [];

  for (const d of documentos) {
    const hist = d.historial || [];
    const responsable = (d as unknown as { responsable?: string }).responsable || d.socioNombre || undefined;

    for (const h of hist) {
      if (filtroActor && !h.actor.toLowerCase().includes(filtroActor.toLowerCase().trim())) {
        continue;
      }
      eventos.push({
        id: h.id,
        documentoId: d.id,
        documentoNombre: d.nombre,
        tipo: d.tipo,
        tipoLabel: TIPO_DOCUMENTO_LABEL[d.tipo] || d.tipo,
        empresaClave: d.empresaClave,
        actor: h.actor && h.actor !== 'usuario' ? h.actor : (responsable || 'Administrador'),
        fecha: h.fecha,
        accion: h.accion,
        detalle: h.detalle,
        responsable,
      });
    }
  }

  // Orden cronológico inverso (los más recientes primero)
  return eventos.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
}
