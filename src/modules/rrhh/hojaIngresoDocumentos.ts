/* ============================================================
   MGG · RRHH · Documentos a consignar por oficina

   La lista de papeles que la persona tiene que traer, agrupada por tema. Va en
   la segunda página de la hoja de ingreso, con una casilla por renglón: se
   entrega junto con el formulario y quien recibe va tildando.

   POR QUÉ ESTÁ ACÁ Y NO ADENTRO DEL PDF
   Para poder probar la lista sin dibujar una página: que no falte un grupo,
   que no haya dos renglones iguales, que «si aplica» esté donde corresponde.

   POR QUÉ NO PIDE DATOS BANCARIOS
   Misma razón que la hoja de ingreso: la cuenta se carga en el sistema cuando
   la persona ya está dada de alta, no queda dando vueltas en una carpeta.
   ============================================================ */

export interface GrupoDocumentos {
  titulo: string;
  /** Los renglones, en el orden en que se piden. */
  items: string[];
}

/**
 * Los grupos, en el orden en que se revisan en la oficina: primero lo que
 * identifica a la persona, después lo que respalda el cargo, la salud, la
 * familia y por último el empleo anterior.
 *
 * «(si aplica)» está escrito a propósito en los renglones que no le tocan a
 * todo el mundo: sin eso, una carpeta queda «incompleta» para siempre porque
 * la persona no es casada o no maneja.
 */
export const DOCUMENTOS_A_CONSIGNAR: GrupoDocumentos[] = [
  {
    titulo: 'Personales',
    items: [
      'Copia de la cédula de identidad (ampliada y legible)',
      'Copia del RIF vigente (SENIAT)',
      'Partida de nacimiento (original o copia certificada)',
      'Dos (2) fotos tipo carnet, fondo blanco',
      'Constancia de residencia',
      'Copia de la licencia de conducir y certificado médico vial (si aplica)',
      'Antecedentes penales o carta de buena conducta',
    ],
  },
  {
    titulo: 'Académicos',
    items: [
      'Título o certificado que acredite el grado de instrucción declarado',
      'Notas certificadas',
      'Certificados de cursos, talleres y adiestramientos',
      'Inscripción en el colegio o gremio profesional (si aplica)',
      'Currículum actualizado',
    ],
  },
  {
    titulo: 'De salud',
    items: [
      'Certificado médico de pre-empleo',
      'Exámenes de laboratorio (hematología completa, orina, heces, VDRL)',
      'Tarjeta o constancia de vacunación (toxoide tetánico)',
      'Informe médico de la enfermedad declarada en este formulario (si aplica)',
      'Constancia de alergia emitida por el médico tratante (si aplica)',
      'Constancia de inscripción en el IVSS',
    ],
  },
  {
    titulo: 'Matrimonio y carga familiar',
    items: [
      'Acta de matrimonio o constancia de concubinato (si aplica)',
      'Partidas de nacimiento de los hijos (si aplica)',
      'Copia de la cédula del cónyuge y de los hijos que ya la tengan',
      'Constancia de estudios de los hijos en edad escolar',
      'Copia de la cédula del contacto de emergencia',
    ],
  },
  {
    titulo: 'Laborales',
    items: [
      'Constancia de trabajo del último empleo (si aplica)',
      'Constancia de liquidación o retiro del último empleo (si aplica)',
      'Dos (2) cartas de recomendación laboral',
      'Dos (2) referencias personales con teléfono',
    ],
  },
];

/** Cuántos papeles pide la lista completa. Para el pie de la página. */
export function totalDocumentos(grupos: GrupoDocumentos[] = DOCUMENTOS_A_CONSIGNAR): number {
  return grupos.reduce((n, g) => n + g.items.length, 0);
}

/** Los que no le tocan a todo el mundo: llevan «(si aplica)» escrito. */
export function documentosOpcionales(grupos: GrupoDocumentos[] = DOCUMENTOS_A_CONSIGNAR): string[] {
  return grupos.flatMap((g) => g.items).filter((t) => /\(si aplica\)$/.test(t));
}
