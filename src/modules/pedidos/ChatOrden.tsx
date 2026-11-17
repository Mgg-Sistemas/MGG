import { Quien } from '@/shared/ui/Quien';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/modules/auth/authStore';
import { useRealtime } from '@/shared/lib/useRealtime';
import { dateTime } from '@/shared/lib/format';
import { toast } from '@/shared/ui/Toast';
import { listMensajes, enviarMensaje, marcarLeido, type MensajeOrden } from './ordenChat.repository';
import { ChatMensajeContenido } from './ChatFormato';
import { PERSONAS_CONOCIDAS_COMPRAS } from './personasCompras';
import { ARCHIVADOS_CONOCIDOS, esUsuarioActivoParaMencion } from './chatMenciones';
import { listUsuarios } from '@/modules/usuarios/usuarios.repository';
import { supabase } from '@/shared/lib/supabase';
import type { Orden, Usuario } from '@/shared/lib/types';

export interface MiembroEquipo {
  nombre: string;
  email: string;
  departamento: string;
  cargo?: string;
}

/** Representación de un token de bloque en el texto (@mención o #referencia) */
export interface TokenBloque {
  simbolo: '@' | '#';
  inicio: number;
  finContenido: number;
  finConEspacio: number;
  contenido: string;
  textoCompleto: string;
  tipo: 'mencion' | 'referencia';
}

/** Resultado del borrado inteligente de tokens */
export interface ResultadoBorradoToken {
  nuevoTexto: string;
  nuevaPos: number;
  borradoBloque: boolean;
  tipoMenu?: 'mencion' | 'referencia';
}

/** Normaliza y categoriza un departamento para priorización y agrupación limpia */
export function normalizarDepartamento(deptoRaw?: string | null, email?: string): string {
  const d = (deptoRaw || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (d.includes('COMPRA')) return 'COMPRAS';
  if (d.includes('TESORER')) return 'TESORERIA';
  if (d.includes('ADMINISTRA')) return 'ADMINISTRACION';
  if (d.includes('ALMACEN')) return 'ALMACEN';
  if (d.includes('SISTEMA')) return 'SISTEMAS';
  if (d.includes('RRHH') || d.includes('HUMANO') || d.includes('PERSONAL')) return 'RRHH';
  if (d.includes('MAQUINA') || d.includes('TALLER') || d.includes('FLOTA')) return 'MAQUINARIA';
  if (d.includes('COMBUSTIBLE') || d.includes('SURTIDOR')) return 'COMBUSTIBLE';
  if (d.includes('COCINA') || d.includes('COMIDA')) return 'COCINA';
  if (d.includes('DIRECTIVA') || d.includes('GERENCIA') || d.includes('PRESIDENCIA')) return 'DIRECTIVA';
  if (d.includes('IMPUESTO') || d.includes('FISCAL') || d.includes('SENIAT')) return 'IMPUESTOS';
  if (d.includes('GEODESTA') || d.includes('MINA')) return 'OPERACIONES';

  const em = (email || '').toLowerCase().trim();
  if (em.includes('touchgolden') || em.includes('mineralgroup')) return 'DIRECTIVA';
  if (em.includes('jhzgcontabilidad')) return 'TESORERIA';
  if (
    em.includes('analista1') ||
    em.includes('comprasanalista') ||
    em.includes('analistadecompras') ||
    em.includes('asistentecompras') ||
    em.includes('admingometales') ||
    em.includes('analista4')
  ) {
    return 'COMPRAS';
  }
  if (em.includes('analistaadministrativo') || em.includes('edinsontrabajo') || em.includes('mariana')) {
    return 'ADMINISTRACION';
  }
  if (em.includes('impuestosmgg')) return 'IMPUESTOS';
  if (em.includes('almacen')) return 'ALMACEN';
  if (em.includes('maquinaria')) return 'MAQUINARIA';
  if (em.includes('combustible')) return 'COMBUSTIBLE';
  if (em.includes('geodesta')) return 'OPERACIONES';
  if (em.includes('cocina')) return 'COCINA';
  if (em.includes('rrhh')) return 'RRHH';
  if (em.includes('sistema')) return 'SISTEMAS';

  return d || 'GENERAL';
}

/** Orden de prioridad departamental según el contexto de origen del chat */
export function ordenarDepartamentos(deptos: string[], contexto: 'compras' | 'tesoreria' | 'administracion'): string[] {
  let ordenPrioridad: string[] = [];
  if (contexto === 'compras') {
    ordenPrioridad = ['COMPRAS', 'TESORERIA', 'ADMINISTRACION', 'ALMACEN', 'DIRECTIVA', 'OPERACIONES'];
  } else if (contexto === 'tesoreria') {
    ordenPrioridad = ['TESORERIA', 'COMPRAS', 'ADMINISTRACION', 'DIRECTIVA', 'ALMACEN', 'OPERACIONES'];
  } else if (contexto === 'administracion') {
    ordenPrioridad = ['ADMINISTRACION', 'TESORERIA', 'COMPRAS', 'DIRECTIVA', 'ALMACEN', 'OPERACIONES'];
  } else {
    ordenPrioridad = ['COMPRAS', 'TESORERIA', 'ADMINISTRACION'];
  }

  return [...deptos].sort((a, b) => {
    const idxA = ordenPrioridad.indexOf(a);
    const idxB = ordenPrioridad.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });
}

/** Etiqueta amigable de la fase actual de la orden o solicitud */
export function formatearFaseOrden(fase?: string | null): string {
  if (!fase) return '';
  const f = fase.toLowerCase().trim();
  switch (f) {
    case 'creada':
    case 'borrador':
      return 'Creada';
    case 'enviada_revision_almacen':
    case 'revision_almacen':
      return 'Revisión Almacén';
    case 'cotizacion':
    case 'en_cotizacion':
      return 'En Cotización';
    case 'pendiente_aprobacion':
    case 'revision':
      return 'Por Aprobar';
    case 'aprobada':
      return 'Aprobada';
    case 'emitida':
      return 'OC Emitida';
    case 'pendiente':
    case 'pendiente_pago':
    case 'por_pagar':
      return 'Por Pagar';
    case 'parcial':
    case 'abono':
      return 'Pago Parcial';
    case 'pagada':
      return 'Pagada';
    case 'recepcion':
    case 'recibida':
      return 'En Recepción';
    case 'cerrada':
      return 'Cerrada';
    default:
      return fase.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/** Infiere el tipo de operación para exhibir contexto preciso */
export function inferirTipoOperacion(codigo: string, tipoDado?: string | null): string {
  if (tipoDado && tipoDado.trim()) return tipoDado.trim();
  const c = (codigo || '').toUpperCase().trim();
  if (c.startsWith('SP-')) return 'Solicitud de Pedido';
  if (c.startsWith('OC-')) return 'Orden de Compra';
  if (c.startsWith('CS-')) return 'Control de Servicio';
  if (c.startsWith('SS-')) return 'Solicitud de Servicio';
  if (c.startsWith('GF-')) return 'Gasto Fijo';
  return 'Orden';
}

/**
 * Identifica tokens de bloques (@mención y #referencia) en el texto del chat.
 * Ordenados por posición de aparición.
 */
export function identificarTokensBloque(texto: string, nombresConocidos: string[] = []): TokenBloque[] {
  if (!texto) return [];

  const tokens: TokenBloque[] = [];

  // 1. Menciones (@)
  const nombresLimpios = Array.from(new Set(nombresConocidos.map((n) => n.trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length);

  const nombresRegex = nombresLimpios.length > 0
    ? nombresLimpios.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    : '';

  const mencionPatternStr = nombresRegex
    ? `(?:^|(?<=[\\s(\\[,;]))@(${nombresRegex}|[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+|[A-Za-zÁÉÍÓÚáéíóúñÑ0-9_.-]+)`
    : `(?:^|(?<=[\\s(\\[,;]))@([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+|[A-Za-zÁÉÍÓÚáéíóúñÑ0-9_.-]+)`;

  const regMencion = new RegExp(mencionPatternStr, 'gi');
  let m: RegExpExecArray | null;

  while ((m = regMencion.exec(texto)) !== null) {
    const matchedFull = m[0];
    const atOffset = matchedFull.indexOf('@');
    if (atOffset === -1) continue;
    const inicio = m.index + atOffset;
    const contenido = m[1];
    const finContenido = inicio + 1 + contenido.length;
    const tieneEspacio = texto[finContenido] === ' ';
    const finConEspacio = tieneEspacio ? finContenido + 1 : finContenido;

    tokens.push({
      simbolo: '@',
      inicio,
      finContenido,
      finConEspacio,
      contenido,
      textoCompleto: texto.slice(inicio, finContenido),
      tipo: 'mencion',
    });
  }

  // 2. Referencias (#) — excluyendo CD y SD
  const regRef = /(?:^|(?<=[\s(\[,;]))#((?:OC|SP|CS|SS|GF)-[A-Za-z0-9-]+|[A-Za-z0-9_-]+)/gi;
  while ((m = regRef.exec(texto)) !== null) {
    const matchedFull = m[0];
    const hashOffset = matchedFull.indexOf('#');
    if (hashOffset === -1) continue;
    const inicio = m.index + hashOffset;
    const contenido = m[1];
    const upper = contenido.toUpperCase();
    if (upper.startsWith('CD-') || upper.startsWith('SD-')) continue;

    const finContenido = inicio + 1 + contenido.length;
    const tieneEspacio = texto[finContenido] === ' ';
    const finConEspacio = tieneEspacio ? finContenido + 1 : finContenido;

    tokens.push({
      simbolo: '#',
      inicio,
      finContenido,
      finConEspacio,
      contenido,
      textoCompleto: texto.slice(inicio, finContenido),
      tipo: 'referencia',
    });
  }

  tokens.sort((a, b) => a.inicio - b.inicio);
  return tokens;
}

/** Devuelve el token sobre el que se encuentra el cursor (si existe) */
export function obtenerTokenEnCursor(
  texto: string,
  cursorPos: number,
  nombresConocidos: string[] = []
): TokenBloque | null {
  const tokens = identificarTokensBloque(texto, nombresConocidos);
  for (const tok of tokens) {
    if (cursorPos > tok.inicio && cursorPos <= tok.finConEspacio) {
      return tok;
    }
  }
  return null;
}

/**
 * Ejecuta el borrado inteligente tipo bloque:
 * - 1er toque de Backspace: borra el contenido del bloque HASTA el signo '@' o '#'.
 * - 2do toque de Backspace: borra el carácter '@' o '#' (borrado normal).
 */
export function ejecutarBorradoToken(
  texto: string,
  cursorPos: number,
  nombresConocidos: string[] = []
): ResultadoBorradoToken {
  const token = obtenerTokenEnCursor(texto, cursorPos, nombresConocidos);
  if (!token) {
    return { nuevoTexto: texto, nuevaPos: cursorPos, borradoBloque: false };
  }

  // Si el contenido ya está vacío (ej. es solo "@" o "#"), el segundo toque borra normal el símbolo
  if (token.contenido.trim().length === 0) {
    return { nuevoTexto: texto, nuevaPos: cursorPos, borradoBloque: false };
  }

  // 1er toque: Borra todo el contenido hasta '@' o '#'
  const antes = texto.slice(0, token.inicio + 1); // conserva '@' o '#'
  const despues = texto.slice(token.finConEspacio);
  const nuevoTexto = antes + despues;
  const nuevaPos = token.inicio + 1; // cursor posicionado inmediatamente tras '@' o '#'

  return {
    nuevoTexto,
    nuevaPos,
    borradoBloque: true,
    tipoMenu: token.tipo,
  };
}

export interface ReferenciaSugerida {
  codigo: string;
  label?: string;
  sublabel?: string;
  tipo?: 'madre' | 'hija' | 'par' | 'orden' | 'prefijo';
}

/**
 * Construye y filtra inteligentemente la lista de referencias (#):
 * - PRIMERA PLANA (sin texto tras '#'):
 *   1. Orden activa donde está el chat (primera opción, ej. #SP-2026-0565).
 *   2. Orden Madre (SOLO si la orden actual la tiene).
 *   3. Órdenes Hijas (SOLO si la orden actual las tiene).
 *   4. Par SP <-> OC (SOLO si existe una OC emitida o SP origen asociada a esta orden).
 *   5. Comandos de prefijos (#OC-, #SP-, #CS-, #SS-, #GF-).
 *   NO exhibe todas las SPs del catálogo en primera plana.
 * - AUTOCOMPLETADO (cuando se escribe tras '#', ej. #056, #laptop):
 *   Busca en el catálogo de órdenes por número de orden o motivo.
 */
export function construirReferenciasOrden(input: {
  ordenActual?: {
    id?: string;
    codigo?: string;
    oc_codigo?: string | null;
    op_padre_id?: string | null;
    tipo?: string | null;
    motivo?: string | null;
  } | null;
  ordenLabel?: string;
  todasLasOrdenes?: Array<{
    id: string;
    codigo: string;
    oc_codigo?: string | null;
    op_padre_id?: string | null;
    tipo?: string | null;
    motivo?: string | null;
    estado?: string | null;
  }>;
  referenciasExtra?: Array<ReferenciaSugerida | string>;
  contextoModulo?: 'compras' | 'tesoreria' | 'administracion';
  query?: string;
}): ReferenciaSugerida[] {
  const q = (input.query || '').trim().toLowerCase();
  const res: ReferenciaSugerida[] = [];
  const codigosVistos = new Set<string>();

  const agregar = (ref: ReferenciaSugerida) => {
    const cod = ref.codigo.replace(/^#/, '').trim();
    if (!cod) return;
    const upper = cod.toUpperCase();
    if (upper.startsWith('CD-') || upper.startsWith('SD-')) return;
    if (codigosVistos.has(upper)) return;
    codigosVistos.add(upper);
    res.push({ ...ref, codigo: cod });
  };

  const { ordenActual, ordenLabel, todasLasOrdenes = [], referenciasExtra = [], contextoModulo = 'compras' } = input;

  // 1. En primera plana: La orden actual donde está activo el chat SIEMPRE va de primera
  if (ordenLabel && !ordenLabel.startsWith('CD-') && !ordenLabel.startsWith('SD-')) {
    agregar({
      codigo: ordenLabel,
      label: 'Orden en vista',
      sublabel: 'Actual',
      tipo: 'par',
    });
  }

  // 2. Aspecto de madre o hija SOLO si lo tiene:
  if (ordenActual) {
    // Par asociado SP <-> OC si existe
    if (ordenActual.codigo && ordenActual.oc_codigo) {
      if (ordenLabel === ordenActual.oc_codigo) {
        agregar({
          codigo: ordenActual.codigo,
          label: `${ordenActual.codigo} · Solicitud de Pedido origen`,
          sublabel: 'Solicitud Origen',
          tipo: 'par',
        });
      } else if (ordenLabel === ordenActual.codigo) {
        agregar({
          codigo: ordenActual.oc_codigo,
          label: `${ordenActual.oc_codigo} · Orden de Compra emitida`,
          sublabel: 'OC Asociada',
          tipo: 'par',
        });
      }
    }

    // Orden Madre (SOLO si es orden hija con op_padre_id)
    if (ordenActual.op_padre_id) {
      const madre = todasLasOrdenes.find((x) => x.id === ordenActual.op_padre_id);
      if (madre) {
        const codMadre = madre.oc_codigo || madre.codigo;
        agregar({
          codigo: codMadre,
          label: `${codMadre} · ${madre.motivo || 'Orden Madre (Pedido Origen)'}`,
          sublabel: 'Orden Madre',
          tipo: 'madre',
        });
      }
    }

    // Órdenes Hijas (SOLO si esta orden tiene hijas de un reparto)
    const hijas = todasLasOrdenes.filter((x) => x.op_padre_id === ordenActual.id);
    for (const h of hijas) {
      const codHija = h.oc_codigo || h.codigo;
      agregar({
        codigo: codHija,
        label: `${codHija} · ${h.motivo || 'Orden Hija (Reparto de proveedor)'}`,
        sublabel: 'Orden Hija',
        tipo: 'hija',
      });
    }
  }

  // 3. Comandos de prefijos en primera plana
  agregar({ codigo: 'OC-', label: 'Orden de Compra', sublabel: 'Comando', tipo: 'prefijo' });
  agregar({ codigo: 'SP-', label: 'Solicitud de Pedido', sublabel: 'Comando', tipo: 'prefijo' });
  agregar({ codigo: 'CS-', label: 'Control de Servicio', sublabel: 'Comando', tipo: 'prefijo' });
  agregar({ codigo: 'SS-', label: 'Solicitud de Servicio', sublabel: 'Comando', tipo: 'prefijo' });
  if (contextoModulo === 'tesoreria' || contextoModulo === 'administracion') {
    agregar({ codigo: 'GF-', label: 'Gasto Fijo (Administración)', sublabel: 'Gasto Fijo', tipo: 'prefijo' });
  }

  // 4. Si el query está vacío (PRIMERA PLANA):
  // Solo se devuelven la orden activa, madre/hija si las tiene, y los comandos.
  // ¡NO se exhiben las SPs del catálogo en primera plana!
  if (!q) {
    return res;
  }

  // 5. En caso de autocompletado (el usuario escribe tras '#'):
  // Ahora sí se incorpora el catálogo para buscar y sugerir números y motivos específicos
  for (const o of todasLasOrdenes) {
    if (o.oc_codigo) {
      agregar({
        codigo: o.oc_codigo,
        label: o.motivo ? `${o.oc_codigo} · ${o.motivo}` : `${o.oc_codigo} · Orden de Compra`,
        sublabel: 'OC',
        tipo: 'orden',
      });
    }
    if (o.codigo) {
      const tipoTxt = o.tipo === 'servicio' ? 'Servicio' : 'Solicitud de Pedido';
      agregar({
        codigo: o.codigo,
        label: o.motivo ? `${o.codigo} · ${o.motivo}` : `${o.codigo} · ${tipoTxt}`,
        sublabel: o.tipo === 'servicio' ? 'Servicio' : 'SP',
        tipo: 'orden',
      });
    }
  }

  for (const r of referenciasExtra) {
    if (typeof r === 'string') {
      agregar({ codigo: r, label: r, tipo: 'orden' });
    } else {
      agregar(r);
    }
  }

  return res
    .filter((item) => {
      const c = item.codigo.toLowerCase();
      const l = (item.label || '').toLowerCase();
      const s = (item.sublabel || '').toLowerCase();
      return c.includes(q) || l.includes(q) || s.includes(q);
    })
    .sort((a, b) => {
      const aStarts = a.codigo.toLowerCase().startsWith(q);
      const bStarts = b.codigo.toLowerCase().startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      if (a.tipo === 'prefijo' && b.tipo !== 'prefijo') return -1;
      if (a.tipo !== 'prefijo' && b.tipo === 'prefijo') return 1;
      return 0;
    })
    .slice(0, 8);
}

/** Renderiza el texto con bloques resaltados tipo píldora detrás del textarea */
export function renderizarBackdropTexto(texto: string, nombresConocidos: string[] = []): React.ReactNode[] {
  if (!texto) return [];
  const tokens = identificarTokensBloque(texto, nombresConocidos);
  if (!tokens.length) {
    return [<span key="plain" style={{ color: 'transparent' }}>{texto}</span>];
  }

  const nodos: React.ReactNode[] = [];
  let ultimoIdx = 0;

  tokens.forEach((tok, i) => {
    if (tok.inicio > ultimoIdx) {
      nodos.push(
        <span key={`plain-${i}`} style={{ color: 'transparent' }}>
          {texto.slice(ultimoIdx, tok.inicio)}
        </span>
      );
    }

    const esMencion = tok.tipo === 'mencion';
    nodos.push(
      <span
        key={`tok-${i}`}
        style={{
          display: 'inline-block',
          background: esMencion ? 'rgba(255, 138, 0, 0.25)' : 'rgba(74, 168, 255, 0.25)',
          border: `1px solid ${esMencion ? 'rgba(255, 138, 0, 0.55)' : 'rgba(74, 168, 255, 0.55)'}`,
          borderRadius: '4px',
          padding: '0 2px',
          color: 'transparent',
          boxSizing: 'border-box',
        }}
      >
        {tok.textoCompleto}
      </span>
    );

    ultimoIdx = tok.finContenido;
  });

  if (ultimoIdx < texto.length) {
    nodos.push(
      <span key="plain-final" style={{ color: 'transparent' }}>
        {texto.slice(ultimoIdx)}
      </span>
    );
  }

  return nodos;
}

/**
 * Chat interno de seguimiento por orden (OC / SP / CS / SS / GF).
 * Inteligente, contextual y clasificado por departamentos:
 * - Clasificación departamental con prioridad según módulo (Compras ↔ Tesorería ↔ Administración).
 * - Restricción estricta: Solo usuarios activos pueden ser mencionados (archivados y deshabilitados excluidos).
 * - Referenciación inteligente a otra orden: madre, hija, par SP-OC o búsqueda en el catálogo.
 * - Bloques de referencia con borrado inteligente en dos toques.
 * - Vista previa enriquecida en vivo para apreciar modificadores (*negrita*, _cursiva_, etc.) al momento.
 */
export function ChatOrden({
  ordenId,
  ordenLabel,
  autorNombre,
  contextoModulo,
  fase,
  tipoOperacion,
  referenciasSugeridas,
  ordenActual,
  todasLasOrdenes,
}: {
  ordenId: string;
  ordenLabel: string;
  autorNombre?: string | null;
  contextoModulo?: 'compras' | 'tesoreria' | 'administracion';
  fase?: string | null;
  tipoOperacion?: string | null;
  referenciasSugeridas?: Array<ReferenciaSugerida | string>;
  ordenActual?: Partial<Pick<Orden, 'id' | 'codigo' | 'oc_codigo' | 'op_padre_id' | 'tipo' | 'motivo'>> | null;
  todasLasOrdenes?: Array<Pick<Orden, 'id' | 'codigo' | 'oc_codigo' | 'op_padre_id' | 'tipo' | 'motivo' | 'estado'>>;
}) {
  const { user } = useSession();
  const [msgs, setMsgs] = useState<MensajeOrden[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cargaError, setCargaError] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [mostrarPreview, setMostrarPreview] = useState(true);
  const finRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Catálogo de órdenes cargadas para sugerencias si no se pasaron en props
  const [ordenesCatalogo, setOrdenesCatalogo] = useState<
    Array<{ id: string; codigo: string; oc_codigo?: string | null; op_padre_id?: string | null; tipo?: string | null; motivo?: string | null }>
  >([]);

  useEffect(() => {
    if (todasLasOrdenes && todasLasOrdenes.length > 0) return;
    let cancel = false;
    async function cargarOrdenes() {
      try {
        const { data, error } = await supabase
          .from('ordenes')
          .select('id, codigo, oc_codigo, op_padre_id, tipo, motivo')
          .order('created_at', { ascending: false })
          .limit(80);
        if (!error && data && !cancel) {
          setOrdenesCatalogo(data as any);
        }
      } catch {
        // Silencioso
      }
    }
    void cargarOrdenes();
    return () => { cancel = true; };
  }, [todasLasOrdenes]);

  const ordenesDisponibles = useMemo(() => {
    return (todasLasOrdenes && todasLasOrdenes.length > 0) ? todasLasOrdenes : ordenesCatalogo;
  }, [todasLasOrdenes, ordenesCatalogo]);

  // Detección automática del módulo de contexto si no se pasa explícito
  const ctxModulo: 'compras' | 'tesoreria' | 'administracion' = useMemo(() => {
    if (contextoModulo) return contextoModulo;
    if (typeof window !== 'undefined') {
      if (window.location.hash.includes('tesoreria')) return 'tesoreria';
      if (window.location.hash.includes('administracion')) return 'administracion';
    }
    return 'compras';
  }, [contextoModulo]);

  // Autocomplete de menciones (@) y referencias (#)
  const [miembros, setMiembros] = useState<MiembroEquipo[]>([]);
  const [menuTipo, setMenuTipo] = useState<'mencion' | 'referencia' | null>(null);
  const [menuQuery, setMenuQuery] = useState('');
  const [menuIndex, setMenuIndex] = useState(0);

  // Cargar lista de miembros activos clasificados por departamento
  // REQUISITO ESTRICTO: Excluir totalmente archivados, deshabilitados y desvinculados
  useEffect(() => {
    let cancel = false;
    async function cargarMiembros() {
      const mapa = new Map<string, { nombre: string; depto: string }>();

      try {
        const dbUsers: Usuario[] = await listUsuarios();
        for (const u of dbUsers) {
          if (!esUsuarioActivoParaMencion(u)) continue;

          const emailNorm = (u.email ?? '').toLowerCase().trim();
          const nom = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim();
          if (emailNorm && nom) {
            const depto = normalizarDepartamento(u.departamento, emailNorm);
            mapa.set(emailNorm, { nombre: nom.toUpperCase(), depto });
          }
        }
      } catch {
        // Fallback si listUsuarios falla
      }

      // Si RLS restringe la tabla a usuarios no-admin (mapa.size <= 1),
      // complementar con las personas conocidas activas de la institución
      if (mapa.size <= 1) {
        for (const [correo, nom] of Object.entries(PERSONAS_CONOCIDAS_COMPRAS)) {
          const emailNorm = correo.toLowerCase().trim();
          const nomNorm = nom.toLowerCase().trim();
          if (ARCHIVADOS_CONOCIDOS.has(nomNorm) || ARCHIVADOS_CONOCIDOS.has(emailNorm)) continue;
          if (correo.includes('@') && !mapa.has(emailNorm)) {
            const depto = normalizarDepartamento(null, emailNorm);
            mapa.set(emailNorm, { nombre: nom.toUpperCase(), depto });
          }
        }
      }

      if (!cancel) {
        const lista: MiembroEquipo[] = [];
        const nombresVistos = new Set<string>();
        for (const [email, { nombre, depto }] of mapa.entries()) {
          const upper = nombre.toUpperCase();
          const lower = nombre.toLowerCase().trim();
          const lowerEmail = email.toLowerCase().trim();
          if (ARCHIVADOS_CONOCIDOS.has(lower) || ARCHIVADOS_CONOCIDOS.has(lowerEmail)) continue;

          if (!nombresVistos.has(upper)) {
            lista.push({ email, nombre: upper, departamento: depto });
            nombresVistos.add(upper);
          }
        }
        setMiembros(lista);
      }
    }
    void cargarMiembros();
    return () => { cancel = true; };
  }, []);

  const marcar = useCallback(() => {
    if (user?.id) void marcarLeido(ordenId, user.id).catch(() => { /* best-effort */ });
  }, [ordenId, user?.id]);

  const cargar = useCallback(async () => {
    if (!ordenId) { setLoading(false); return; }
    try {
      const rows = await listMensajes(ordenId);
      setMsgs(rows);
      setCargaError(false);
      marcar();
    } catch {
      setCargaError(true);
    } finally {
      setLoading(false);
    }
  }, [ordenId, marcar]);

  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['orden_mensajes', 'oc_mensajes'], () => { void cargar(); });

  useEffect(() => { finRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  // Manejo de autocompletado en el textarea
  const actualizarSugerencias = (nuevoTexto: string, pos: number) => {
    const textoAntes = nuevoTexto.slice(0, pos);

    const matchMencion = textoAntes.match(/(?:^|\s)@([a-zA-ZÁÉÍÓÚáéíóúñÑ0-9_.]*)$/);
    if (matchMencion) {
      setMenuTipo('mencion');
      setMenuQuery(matchMencion[1].toLowerCase());
      setMenuIndex(0);
      return;
    }

    const matchRef = textoAntes.match(/(?:^|\s)#([a-zA-Z0-9-]*)$/);
    if (matchRef) {
      setMenuTipo('referencia');
      setMenuQuery(matchRef[1].toLowerCase());
      setMenuIndex(0);
      return;
    }

    setMenuTipo(null);
  };

  const handleTextoChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setTexto(val);
    actualizarSugerencias(val, e.target.selectionStart ?? val.length);
  };

  // Nombres de miembros para detección de tokens
  const nombresMiembros = useMemo(() => miembros.map((m) => m.nombre), [miembros]);

  // Tokens de bloques activos presentes en el borrador actual
  const tokensActivos = useMemo(() => {
    return identificarTokensBloque(texto, nombresMiembros);
  }, [texto, nombresMiembros]);

  // Detecta si el mensaje actual contiene formato o modificadores (*, _, ~, `, >, •, @, #)
  const tieneFormato = useMemo(() => {
    if (!texto.trim()) return false;
    return /[*_~`>•@#]/.test(texto) || texto.includes('\n');
  }, [texto]);

  // Elimina un bloque activo directamente (ej. al presionar la '✕' del chip)
  const eliminarToken = (tok: TokenBloque) => {
    const antes = texto.slice(0, tok.inicio);
    const despues = texto.slice(tok.finConEspacio);
    const nuevo = (antes + (antes && despues && !antes.endsWith(' ') && !despues.startsWith(' ') ? ' ' : '') + despues).trim();
    setTexto(nuevo);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const p = Math.min(antes.length, nuevo.length);
        textareaRef.current.setSelectionRange(p, p);
      }
    }, 0);
  };

  // Sincronizar scroll entre el textarea y el backdrop resaltador
  const handleScroll = () => {
    if (backdropRef.current && textareaRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Filtrado y clasificación departamental para el menú de mención
  const { miembrosAgrupados, miembrosPlana } = useMemo(() => {
    if (menuTipo !== 'mencion') return { miembrosAgrupados: [] as Array<[string, MiembroEquipo[]]>, miembrosPlana: [] as MiembroEquipo[] };

    const filtrados = miembros.filter((m) => {
      const lowerNom = m.nombre.toLowerCase().trim();
      const lowerEmail = m.email.toLowerCase().trim();
      if (ARCHIVADOS_CONOCIDOS.has(lowerNom) || ARCHIVADOS_CONOCIDOS.has(lowerEmail)) return false;

      return (
        m.nombre.toLowerCase().includes(menuQuery) ||
        m.email.toLowerCase().includes(menuQuery) ||
        m.departamento.toLowerCase().includes(menuQuery)
      );
    });

    const gruposMap = new Map<string, MiembroEquipo[]>();
    for (const m of filtrados) {
      const dep = m.departamento;
      if (!gruposMap.has(dep)) gruposMap.set(dep, []);
      gruposMap.get(dep)!.push(m);
    }

    for (const lista of gruposMap.values()) {
      lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
    }

    const deptosOrdenados = ordenarDepartamentos(Array.from(gruposMap.keys()), ctxModulo);
    const grupos: Array<[string, MiembroEquipo[]]> = deptosOrdenados.map((d) => [d, gruposMap.get(d)!]);

    const plana: MiembroEquipo[] = [];
    for (const [, items] of grupos) {
      plana.push(...items);
    }

    return { miembrosAgrupados: grupos, miembrosPlana: plana.slice(0, 10) };
  }, [menuTipo, miembros, menuQuery, ctxModulo]);

  // Sugerencias de referencias (#) inteligentes (Madre, Hija, Par, Catálogo y Prefijos)
  const referenciasFiltradas = useMemo(() => {
    if (menuTipo !== 'referencia') return [];
    return construirReferenciasOrden({
      ordenActual,
      ordenLabel,
      todasLasOrdenes: ordenesDisponibles as any,
      referenciasExtra: referenciasSugeridas,
      contextoModulo: ctxModulo,
      query: menuQuery,
    });
  }, [menuTipo, ordenActual, ordenLabel, ordenesDisponibles, referenciasSugeridas, ctxModulo, menuQuery]);

  const insertarSugerencia = (valor: string, esMencion: boolean) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? texto.length;
    const textoAntes = texto.slice(0, pos);
    const textoDespues = texto.slice(pos);

    let prefijo = '';
    if (esMencion) {
      prefijo = textoAntes.replace(/(?:^|\s)@([a-zA-ZÁÉÍÓÚáéíóúñÑ0-9_.]*)$/, (match) => {
        return match.startsWith(' ') ? ` @${valor} ` : `@${valor} `;
      });
    } else {
      const limpio = valor.replace(/^#/, '');
      prefijo = textoAntes.replace(/(?:^|\s)#([a-zA-Z0-9-]*)$/, (match) => {
        return match.startsWith(' ') ? ` #${limpio} ` : `#${limpio} `;
      });
    }

    const resultado = prefijo + textoDespues;
    setTexto(resultado);
    setMenuTipo(null);

    setTimeout(() => {
      ta.focus();
      const nuevaPos = prefijo.length;
      ta.setSelectionRange(nuevaPos, nuevaPos);
    }, 0);
  };

  // Aplica o quita formato de forma inteligente sobre el texto seleccionado
  const aplicarFormato = (inicio: string, fin: string, placeholderDefault = 'texto') => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const seleccionado = texto.slice(start, end);

    if (seleccionado) {
      // Toggle off si ya está envuelto en el formato
      if (
        seleccionado.startsWith(inicio) &&
        seleccionado.endsWith(fin) &&
        seleccionado.length >= inicio.length + fin.length
      ) {
        const sinFormato = seleccionado.slice(inicio.length, seleccionado.length - fin.length);
        const nuevoTexto = texto.slice(0, start) + sinFormato + texto.slice(end);
        setTexto(nuevoTexto);
        setTimeout(() => {
          ta.focus();
          ta.setSelectionRange(start, start + sinFormato.length);
        }, 0);
        return;
      }

      // Toggle off si el texto alrededor ya tiene exactamente el formato
      const antesFormato = texto.slice(Math.max(0, start - inicio.length), start);
      const despuesFormato = texto.slice(end, end + fin.length);
      if (antesFormato === inicio && despuesFormato === fin) {
        const nuevoTexto = texto.slice(0, start - inicio.length) + seleccionado + texto.slice(end + fin.length);
        setTexto(nuevoTexto);
        setTimeout(() => {
          ta.focus();
          ta.setSelectionRange(start - inicio.length, start - inicio.length + seleccionado.length);
        }, 0);
        return;
      }

      // Envolver selección
      const nuevoTexto = texto.slice(0, start) + inicio + seleccionado + fin + texto.slice(end);
      setTexto(nuevoTexto);
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(start + inicio.length, end + inicio.length);
      }, 0);
    } else {
      // Sin selección: insertar placeholder y seleccionarlo para escribir de inmediato
      const nuevoTexto = texto.slice(0, start) + inicio + placeholderDefault + fin + texto.slice(end);
      setTexto(nuevoTexto);
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(start + inicio.length, start + inicio.length + placeholderDefault.length);
      }, 0);
    }
  };

  const insertarPrefijoLinea = (prefijo: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const antes = texto.slice(0, start);
    const despues = texto.slice(start);
    const necesitaSalto = antes.length > 0 && !antes.endsWith('\n');
    const insercion = (necesitaSalto ? '\n' : '') + prefijo;
    setTexto(antes + insercion + despues);
    setTimeout(() => {
      ta.focus();
      const pos = (antes + insercion).length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  const dispararMencion = () => {
    insertarPrefijoLinea('@');
    setMenuTipo('mencion');
    setMenuQuery('');
    setMenuIndex(0);
  };

  const dispararReferencia = () => {
    insertarPrefijoLinea('#');
    setMenuTipo('referencia');
    setMenuQuery('');
    setMenuIndex(0);
  };

  async function enviar() {
    const t = texto.trim();
    if (!t || !user?.email) return;
    setEnviando(true);
    try {
      await enviarMensaje({ ordenId, ordenLabel, mensaje: t, autorEmail: user.email, autorNombre: autorNombre ?? null });
      setTexto('');
      setMenuTipo(null);
      await cargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar', 'error');
    } finally {
      setEnviando(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 1. Borrado inteligente tipo bloque (dos toques para borrar referencias y menciones)
    if (e.key === 'Backspace' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const ta = textareaRef.current;
      if (ta && ta.selectionStart === ta.selectionEnd) {
        const resultado = ejecutarBorradoToken(texto, ta.selectionStart, nombresMiembros);
        if (resultado.borradoBloque) {
          e.preventDefault();
          setTexto(resultado.nuevoTexto);
          actualizarSugerencias(resultado.nuevoTexto, resultado.nuevaPos);
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus();
              textareaRef.current.setSelectionRange(resultado.nuevaPos, resultado.nuevaPos);
            }
          }, 0);
          return;
        }
      }
    }

    // 2. Navegación en menús emergentes
    if (menuTipo === 'mencion' && miembrosPlana.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenuIndex((prev) => (prev + 1) % miembrosPlana.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenuIndex((prev) => (prev - 1 + miembrosPlana.length) % miembrosPlana.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const elegido = miembrosPlana[menuIndex];
        if (elegido) insertarSugerencia(elegido.nombre, true);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuTipo(null);
        return;
      }
    }

    if (menuTipo === 'referencia' && referenciasFiltradas.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenuIndex((prev) => (prev + 1) % referenciasFiltradas.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenuIndex((prev) => (prev - 1 + referenciasFiltradas.length) % referenciasFiltradas.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const elegido = referenciasFiltradas[menuIndex];
        if (elegido) insertarSugerencia(elegido.codigo, false);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuTipo(null);
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      aplicarFormato('*', '*', 'negrita');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      aplicarFormato('_', '_', 'cursiva');
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  };

  const actionBtnStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted, #9aa6b5)',
    cursor: 'pointer',
    padding: '0 5px',
    minWidth: '22px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    fontSize: '0.8rem',
    lineHeight: 1,
  };

  const tipoLegible = inferirTipoOperacion(ordenLabel, tipoOperacion);
  const faseLegible = formatearFaseOrden(fase);

  return (
    <div
      style={{
        background: 'var(--surface, #23272e)',
        border: '1px solid var(--border, #333944)',
        borderRadius: 'var(--r-md, 10px)',
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Encabezado contextual con tipo de operación y fase */}
      <div
        style={{
          padding: '0.65rem 0.9rem',
          background: 'var(--bg-1, #20242a)',
          borderBottom: '1px solid var(--border, #333944)',
          borderTopLeftRadius: 'var(--r-md, 10px)',
          borderTopRightRadius: 'var(--r-md, 10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '.4rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.95rem' }}>💬</span>
          <span style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text)' }}>
            Chat interno
          </span>
          <span
            style={{
              fontSize: '0.72rem',
              fontFamily: 'var(--font-mono, monospace)',
              background: 'rgba(255, 138, 0, 0.12)',
              color: 'var(--primary, #ff8a00)',
              padding: '1px 6px',
              borderRadius: '4px',
              fontWeight: 600,
              border: '1px solid rgba(255, 138, 0, 0.22)',
            }}
          >
            {ordenLabel}
          </span>
          <span
            style={{
              fontSize: '0.72rem',
              background: 'rgba(255, 255, 255, 0.06)',
              color: 'var(--text-muted, #9aa6b5)',
              padding: '1px 6px',
              borderRadius: '4px',
              fontWeight: 500,
            }}
          >
            {tipoLegible} {faseLegible ? `· ${faseLegible}` : ''}
          </span>
        </div>
        <span className="muted" style={{ fontSize: '0.74rem' }}>
          {ctxModulo === 'tesoreria' ? 'Tesorería ↔ Compras / Administración' : 'Compras ↔ Tesorería'}
        </span>
      </div>

      {/* Lista de mensajes */}
      <div
        style={{
          minHeight: msgs.length ? 150 : 130,
          maxHeight: 250,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          padding: '0.75rem 0.9rem',
          background: 'var(--bg-0, #1c1f24)',
        }}
      >
        {loading && <div className="muted" style={{ fontSize: '.82rem', textAlign: 'center', padding: '1rem 0' }}>Cargando conversación…</div>}
        {!loading && cargaError && (
          <div className="muted" style={{ fontSize: '.82rem', textAlign: 'center', padding: '1rem 0' }}>
            No se pudo cargar el chat.{' '}
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => { setLoading(true); void cargar(); }}
            >
              ↻ Reintentar
            </button>
          </div>
        )}
        {!loading && !cargaError && !msgs.length && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1.5rem 0',
              color: 'var(--text-dim, #6a7585)',
              gap: '0.2rem',
            }}
          >
            <span style={{ fontSize: '1.2rem', opacity: 0.65 }}>💬</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sin mensajes en esta orden</span>
            <span style={{ fontSize: '0.72rem', opacity: 0.8 }}>Escribe abajo para coordinar con el equipo</span>
          </div>
        )}
        {msgs.map((m) => {
          const propio = m.autor_email === user?.email;
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: propio ? 'flex-end' : 'flex-start' }}>
              <div
                style={{
                  maxWidth: '82%',
                  padding: '.45rem .75rem',
                  borderRadius: 8,
                  fontSize: '.84rem',
                  background: propio ? 'rgba(255,138,0,.12)' : 'var(--surface-2, #2b3038)',
                  border: `1px solid ${propio ? 'rgba(255,138,0,.25)' : 'var(--border, #333944)'}`,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '.72rem', marginBottom: '.2rem', color: propio ? 'var(--primary-2, #ffa733)' : 'var(--text-muted)' }}>
                  <Quien nombre={m.autor_nombre} correo={m.autor_email} />
                </div>
                <ChatMensajeContenido mensaje={m.mensaje} />
                <div className="muted" style={{ fontSize: '.65rem', marginTop: '.2rem', textAlign: 'right' }}>
                  {dateTime(m.created_at)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={finRef} />
      </div>

      {/* Compositor de mensaje unificado */}
      <div
        style={{
          padding: '0.6rem 0.85rem',
          background: 'var(--bg-1, #20242a)',
          borderTop: '1px solid var(--border, #333944)',
          borderBottomLeftRadius: 'var(--r-md, 10px)',
          borderBottomRightRadius: 'var(--r-md, 10px)',
        }}
      >
        <div
          style={{
            position: 'relative',
            background: 'var(--bg-2, #262a31)',
            border: inputFocused ? '1px solid var(--primary, #ff8a00)' : '1px solid var(--border, #333944)',
            boxShadow: inputFocused ? '0 0 0 2px rgba(255, 138, 0, 0.16)' : 'none',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
          }}
        >
          {/* Menú emergente de mención (@) agrupado por departamento */}
          {menuTipo === 'mencion' && miembrosPlana.length > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 6px)',
                left: 0,
                right: 0,
                background: 'var(--surface-2, #2b3038)',
                border: '1px solid var(--border-strong, #434a56)',
                borderRadius: 8,
                boxShadow: 'var(--shadow-lg, 0 12px 28px rgba(0,0,0,0.5))',
                maxHeight: 230,
                overflowY: 'auto',
                zIndex: 100,
                padding: '4px',
              }}
            >
              <div
                style={{
                  fontSize: '.68rem',
                  padding: '4px 8px 3px',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Mencionar a (prioridad {ctxModulo}):</span>
                <span style={{ fontSize: '.64rem', color: 'var(--primary, #ff8a00)' }}>Solo activos</span>
              </div>

              {miembrosAgrupados.map(([depto, usuarios]) => (
                <div key={depto} style={{ marginTop: '4px' }}>
                  <div
                    style={{
                      fontSize: '.64rem',
                      fontWeight: 800,
                      color: depto === 'COMPRAS' || depto === 'TESORERIA' ? 'var(--primary-2, #ffa733)' : 'var(--text-dim, #6a7585)',
                      padding: '3px 8px 1px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{depto}</span>
                    <span style={{ opacity: 0.7 }}>{usuarios.length}</span>
                  </div>

                  {usuarios.map((m) => {
                    const itemIdx = miembrosPlana.indexOf(m);
                    const seleccionado = itemIdx === menuIndex;
                    return (
                      <div
                        key={m.email}
                        onClick={() => insertarSugerencia(m.nombre, true)}
                        onMouseEnter={() => itemIdx !== -1 && setMenuIndex(itemIdx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '5px 8px',
                          borderRadius: 5,
                          cursor: 'pointer',
                          background: seleccionado ? 'rgba(255,138,0,.15)' : 'transparent',
                          color: seleccionado ? 'var(--primary, #ff8a00)' : 'inherit',
                          fontSize: '.8rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: '50%',
                              background: seleccionado ? 'var(--primary, #ff8a00)' : 'rgba(255,138,0,.2)',
                              color: seleccionado ? '#1c1f24' : 'var(--primary, #ff8a00)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '.66rem',
                              fontWeight: 800,
                            }}
                          >
                            @
                          </span>
                          <span style={{ fontWeight: 600 }}>{m.nombre}</span>
                        </div>
                        <span className="muted" style={{ fontSize: '.7rem' }}>{m.email}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Menú emergente de referencia (#) */}
          {menuTipo === 'referencia' && referenciasFiltradas.length > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 6px)',
                left: 0,
                right: 0,
                background: 'var(--surface-2, #2b3038)',
                border: '1px solid var(--border-strong, #434a56)',
                borderRadius: 8,
                boxShadow: 'var(--shadow-lg, 0 12px 28px rgba(0,0,0,0.5))',
                maxHeight: 220,
                overflowY: 'auto',
                zIndex: 100,
                padding: '4px',
              }}
            >
              <div
                style={{
                  fontSize: '.68rem',
                  padding: '4px 8px 3px',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Referenciar operación (#):</span>
                <span style={{ fontSize: '.64rem', color: 'var(--info, #4aa8ff)' }}>
                  {menuQuery ? 'Búsqueda por número / motivo' : 'Comandos rápidos'}
                </span>
              </div>
              {referenciasFiltradas.map((r, idx) => {
                const seleccionado = idx === menuIndex;
                const esMadre = r.tipo === 'madre' || r.sublabel?.includes('Madre');
                const esHija = r.tipo === 'hija' || r.sublabel?.includes('Hija');
                const esPar = r.tipo === 'par';
                const esComando = r.tipo === 'prefijo';

                return (
                  <div
                    key={r.codigo}
                    onClick={() => insertarSugerencia(r.codigo, false)}
                    onMouseEnter={() => setMenuIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 8px',
                      borderRadius: 5,
                      cursor: 'pointer',
                      background: seleccionado ? 'rgba(74,168,255,.18)' : 'transparent',
                      color: seleccionado ? 'var(--info, #4aa8ff)' : 'inherit',
                      fontSize: '.8rem',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono, monospace)',
                          color: 'var(--info, #4aa8ff)',
                          flexShrink: 0,
                        }}
                      >
                        #{r.codigo}
                      </span>
                      <span
                        className="muted"
                        style={{
                          fontSize: '.72rem',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                        }}
                      >
                        {r.label}
                      </span>
                    </div>
                    {r.sublabel && (
                      <span
                        style={{
                          fontSize: '.62rem',
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          flexShrink: 0,
                          background: esMadre
                            ? 'rgba(255, 138, 0, 0.2)'
                            : esHija
                            ? 'rgba(168, 85, 247, 0.2)'
                            : esPar
                            ? 'rgba(34, 197, 94, 0.2)'
                            : esComando
                            ? 'rgba(74, 168, 255, 0.15)'
                            : 'rgba(255, 255, 255, 0.08)',
                          color: esMadre
                            ? 'var(--primary, #ff8a00)'
                            : esHija
                            ? '#c084fc'
                            : esPar
                            ? '#4ade80'
                            : esComando
                            ? 'var(--info, #4aa8ff)'
                            : 'var(--text-muted, #9aa6b5)',
                          border: `1px solid ${
                            esMadre
                              ? 'rgba(255, 138, 0, 0.35)'
                              : esHija
                              ? 'rgba(168, 85, 247, 0.35)'
                              : esPar
                              ? 'rgba(34, 197, 94, 0.35)'
                              : esComando
                              ? 'rgba(74, 168, 255, 0.3)'
                              : 'rgba(255, 255, 255, 0.12)'
                          }`,
                        }}
                      >
                        {r.sublabel}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Pastillas de bloques activos en el borrador */}
          {tokensActivos.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexWrap: 'wrap',
                padding: '0.35rem 0.6rem 0.25rem',
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                background: 'rgba(0, 0, 0, 0.15)',
              }}
            >
              <span style={{ fontSize: '0.66rem', color: 'var(--text-dim, #6a7585)', fontWeight: 600 }}>
                Bloques activos:
              </span>
              {tokensActivos.map((tok, idx) => (
                <span
                  key={`${tok.simbolo}-${tok.contenido}-${idx}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    background: tok.tipo === 'mencion' ? 'rgba(255,138,0,0.18)' : 'rgba(74,168,255,0.18)',
                    color: tok.tipo === 'mencion' ? 'var(--primary, #ff8a00)' : 'var(--info, #4aa8ff)',
                    border: `1px solid ${tok.tipo === 'mencion' ? 'rgba(255,138,0,0.35)' : 'rgba(74,168,255,0.35)'}`,
                  }}
                >
                  <span>{tok.simbolo}{tok.contenido}</span>
                  <button
                    type="button"
                    onClick={() => eliminarToken(tok)}
                    title={`Eliminar bloque ${tok.simbolo}${tok.contenido}`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: '0.68rem',
                      lineHeight: 1,
                      opacity: 0.75,
                      marginLeft: '2px',
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Área de texto integrada con Backdrop de bloques visuales */}
          <div style={{ position: 'relative', minHeight: '42px', maxHeight: '120px' }}>
            <div
              ref={backdropRef}
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                overflow: 'hidden',
                padding: '0.55rem 0.75rem',
                fontSize: '0.84rem',
                lineHeight: '1.4',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                pointerEvents: 'none',
                color: 'transparent',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            >
              {renderizarBackdropTexto(texto, nombresMiembros)}
            </div>

            <textarea
              ref={textareaRef}
              rows={2}
              style={{
                position: 'relative',
                width: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                padding: '0.55rem 0.75rem',
                fontSize: '0.84rem',
                color: 'var(--text)',
                fontFamily: 'inherit',
                lineHeight: '1.4',
                minHeight: '42px',
                maxHeight: '120px',
                boxSizing: 'border-box',
              }}
              placeholder="Escribe un mensaje… (@ para mencionar, # para comandos OC-, SP- o buscar orden)"
              value={texto}
              onChange={handleTextoChange}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setTimeout(() => setInputFocused(false), 200)}
              disabled={enviando}
            />
          </div>

          {/* Vista previa en vivo al momento (permite apreciar el efecto inmediato de los modificadores) */}
          {tieneFormato && mostrarPreview && (
            <div
              style={{
                padding: '0.45rem 0.75rem',
                background: 'rgba(0, 0, 0, 0.22)',
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                fontSize: '0.84rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '0.64rem',
                  fontWeight: 700,
                  color: 'var(--text-muted, #9aa6b5)',
                  marginBottom: '0.22rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--primary, #ff8a00)' }}>
                  <span>👁</span> Vista previa al momento:
                </span>
                <span style={{ fontSize: '.6rem', opacity: 0.75 }}>En vivo</span>
              </div>
              <div
                style={{
                  padding: '0.35rem 0.6rem',
                  background: 'var(--bg-0, #1c1f24)',
                  borderRadius: '6px',
                  border: '1px solid var(--border, #333944)',
                  minHeight: '26px',
                  color: 'var(--text, #f0f2f5)',
                }}
              >
                <ChatMensajeContenido mensaje={texto} />
              </div>
            </div>
          )}

          {/* Barra inferior integrada */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.25rem 0.5rem 0.35rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              background: 'rgba(0, 0, 0, 0.1)',
              borderBottomLeftRadius: '7px',
              borderBottomRightRadius: '7px',
            }}
          >
            {/* Formato rápido */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'wrap' }}>
              <button
                type="button"
                title="Negrita (*texto* o Ctrl+B)"
                onClick={() => aplicarFormato('*', '*', 'negrita')}
                style={actionBtnStyle}
              >
                <strong style={{ fontWeight: 800 }}>B</strong>
              </button>
              <button
                type="button"
                title="Cursiva (_texto_ o Ctrl+I)"
                onClick={() => aplicarFormato('_', '_', 'cursiva')}
                style={{ ...actionBtnStyle, fontStyle: 'italic', fontWeight: 600 }}
              >
                I
              </button>
              <button
                type="button"
                title="Tachado (~texto~)"
                onClick={() => aplicarFormato('~', '~', 'tachado')}
                style={{ ...actionBtnStyle, textDecoration: 'line-through' }}
              >
                S
              </button>
              <button
                type="button"
                title="Código inline (`código`)"
                onClick={() => aplicarFormato('`', '`', 'código')}
                style={{ ...actionBtnStyle, fontFamily: 'var(--font-mono, monospace)', fontSize: '.76rem' }}
              >
                &lt;/&gt;
              </button>
              <button
                type="button"
                title="Cita (> texto)"
                onClick={() => insertarPrefijoLinea('> ')}
                style={{ ...actionBtnStyle, fontWeight: 700 }}
              >
                ”
              </button>
              <button
                type="button"
                title="Viñeta (• elemento)"
                onClick={() => insertarPrefijoLinea('• ')}
                style={{ ...actionBtnStyle, color: 'var(--primary, #ff8a00)', fontSize: '.9rem' }}
              >
                •
              </button>

              <div style={{ width: 1, height: 14, background: 'var(--border, #333944)', margin: '0 4px' }} />

              <button
                type="button"
                title="Mencionar persona activa (@)"
                onClick={dispararMencion}
                style={{
                  ...actionBtnStyle,
                  gap: '3px',
                  padding: '0 6px',
                  fontSize: '.74rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                }}
              >
                <span style={{ color: 'var(--primary, #ff8a00)', fontWeight: 800 }}>@</span>
                <span>Mencionar</span>
              </button>
              <button
                type="button"
                title="Referenciar orden (#madre, #hija, #sp, #oc, #cs, #ss, #gf)"
                onClick={dispararReferencia}
                style={{
                  ...actionBtnStyle,
                  gap: '3px',
                  padding: '0 6px',
                  fontSize: '.74rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                }}
              >
                <span style={{ color: 'var(--info, #4aa8ff)', fontWeight: 800 }}>#</span>
                <span>Referencia</span>
              </button>

              <button
                type="button"
                title={mostrarPreview ? 'Ocultar vista previa en vivo' : 'Mostrar vista previa en vivo'}
                onClick={() => setMostrarPreview((p) => !p)}
                style={{
                  ...actionBtnStyle,
                  padding: '0 6px',
                  fontSize: '.74rem',
                  gap: '2px',
                  color: mostrarPreview && tieneFormato ? 'var(--primary, #ff8a00)' : 'var(--text-muted)',
                }}
              >
                <span>👁</span>
                <span style={{ fontSize: '.7rem' }}>Vista previa</span>
              </button>
            </div>

            {/* Botón Enviar */}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void enviar()}
              disabled={enviando || !texto.trim()}
              style={{
                height: '28px',
                padding: '0 0.8rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                borderRadius: '5px',
              }}
            >
              <span>{enviando ? '…' : 'Enviar'}</span>
              <span style={{ fontSize: '0.72rem' }}>➤</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
