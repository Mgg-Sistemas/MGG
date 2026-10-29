/* ============================================================
   MGG · Contabilidad · Almacén simulado (en memoria + localStorage)

   La maqueta NO toca Supabase. El estado BASE se arma con los datos del
   Carril BD (simulacion/datosBd.ts, con import() dinámico) y vive en
   memoria. Solo el repositorio usa este almacén: el día que el módulo
   pase a la base, se cambia el repositorio y las pantallas no.

   En localStorage (`mgg.contabilidad.simulacion`) NO se guarda el estado
   entero (son 1.419 comprobantes, varios MB): se guarda solo la CAPA DE
   CAMBIOS del usuario sobre la base (filas nuevas o cambiadas y filas
   quitadas, por tabla). Al cargar: base + capa.

   · Una capa de otra versión, o ilegible, se descarta (nunca se arranca
     a medias).
   · localStorage puede fallar (modo privado, cuota): se sigue en memoria
     y se avisa una sola vez por consola.
   · El almacenamiento y la fábrica del estado base se inyectan, para
     probarlo sin navegador y con datos chicos.
   ============================================================ */

import type { EstadoSimulacion } from '../tipos';
import { estadoDesdeBd } from './datosBd';

export const CLAVE_SIMULACION = 'mgg.contabilidad.simulacion';

/** Lo mínimo de localStorage que usa el almacén. */
export interface Almacenamiento {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

export function almacenamientoDelNavegador(): Almacenamiento | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

// Un cambio que no devuelve nada da undefined, y JSON.parse(undefined) lanza.
const copia = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

type Tabla = Exclude<keyof EstadoSimulacion, 'version' | 'cont_parametros'>;
type Fila = { id: string } | { codigo: string };
const claveDe = (f: Fila): string => ('id' in f ? f.id : f.codigo);

/** Lo que el usuario cambió sobre la base. */
interface Capa {
  version: number;
  parametros?: EstadoSimulacion['cont_parametros'];
  tablas: Partial<Record<Tabla, { cambiadas: Fila[]; quitadas: string[] }>>;
}

const TABLAS = (e: EstadoSimulacion): Tabla[] =>
  (Object.keys(e) as Array<keyof EstadoSimulacion>).filter((k): k is Tabla => Array.isArray(e[k]));

export class AlmacenSimulado {
  private base: Promise<EstadoSimulacion> | null = null;
  private estado: EstadoSimulacion | null = null;
  private cargando: Promise<EstadoSimulacion> | null = null;
  /** id → JSON de cada fila de la base, para calcular la capa sin volver a serializar la base. */
  private huellasBase: Map<Tabla, Map<string, string>> | null = null;
  private avisado = false;

  constructor(
    private readonly almacenamiento: Almacenamiento | null = almacenamientoDelNavegador(),
    private readonly fabrica: () => Promise<EstadoSimulacion> = () => estadoDesdeBd(),
  ) {}

  /** Una copia del estado: quien la recibe no puede modificar el almacén por accidente. */
  async leer(): Promise<EstadoSimulacion> {
    return copia(await this.cargar());
  }

  /** Aplica un cambio sobre el estado y guarda la capa. Si el cambio lanza, no queda nada a medias. */
  async modificar<R>(cambio: (estado: EstadoSimulacion) => R): Promise<R> {
    const trabajo = copia(await this.cargar());
    const resultado = cambio(trabajo);
    this.estado = trabajo;
    await this.persistir();
    return copia(resultado);
  }

  /** Vuelve a la base y borra la capa guardada. */
  async reiniciar(): Promise<void> {
    this.estado = copia(await this.estadoBase());
    try { this.almacenamiento?.removeItem(CLAVE_SIMULACION); } catch { /* sin almacenamiento: nada que borrar */ }
  }

  private estadoBase(): Promise<EstadoSimulacion> {
    this.base ??= this.fabrica();
    return this.base;
  }

  private cargar(): Promise<EstadoSimulacion> {
    if (this.estado) return Promise.resolve(this.estado);
    this.cargando ??= (async () => {
      const base = copia(await this.estadoBase());
      const capa = this.leerCapa(base.version);
      this.estado = capa ? aplicarCapa(base, capa) : base;
      return this.estado;
    })();
    return this.cargando;
  }

  private leerCapa(version: number): Capa | null {
    try {
      const crudo = this.almacenamiento?.getItem(CLAVE_SIMULACION);
      if (!crudo) return null;
      const capa = JSON.parse(crudo) as Capa;
      return capa && capa.version === version && capa.tablas ? capa : null;
    } catch {
      return null;
    }
  }

  private async persistir(): Promise<void> {
    if (!this.almacenamiento || !this.estado) return;
    const base = await this.estadoBase();
    this.huellasBase ??= new Map(TABLAS(base).map((t) => [t, new Map((base[t] as Fila[]).map((f) => [claveDe(f), JSON.stringify(f)]))]));
    const capa: Capa = { version: this.estado.version, tablas: {} };
    if (JSON.stringify(this.estado.cont_parametros) !== JSON.stringify(base.cont_parametros)) capa.parametros = this.estado.cont_parametros;
    for (const t of TABLAS(this.estado)) {
      const previas = this.huellasBase.get(t) ?? new Map<string, string>();
      const actuales = this.estado[t] as Fila[];
      const cambiadas = actuales.filter((f) => previas.get(claveDe(f)) !== JSON.stringify(f));
      const vivas = new Set(actuales.map(claveDe));
      const quitadas = [...previas.keys()].filter((k) => !vivas.has(k));
      if (cambiadas.length || quitadas.length) capa.tablas[t] = { cambiadas, quitadas };
    }
    try {
      this.almacenamiento.setItem(CLAVE_SIMULACION, JSON.stringify(capa));
    } catch (e) {
      if (!this.avisado) {
        this.avisado = true;
        console.warn('Contabilidad (simulación): no se pudo guardar en localStorage; los cambios duran hasta recargar.', e);
      }
    }
  }
}

/** Base + capa: quita las filas quitadas, reemplaza las cambiadas y agrega las nuevas al final. */
export function aplicarCapa(base: EstadoSimulacion, capa: Capa): EstadoSimulacion {
  const e = copia(base);
  if (capa.parametros) e.cont_parametros = capa.parametros;
  for (const [t, cambio] of Object.entries(capa.tablas) as Array<[Tabla, { cambiadas: Fila[]; quitadas: string[] }]>) {
    if (!Array.isArray(e[t])) continue;
    const quitar = new Set(cambio.quitadas);
    const nuevas = new Map(cambio.cambiadas.map((f) => [claveDe(f), f]));
    const filas = (e[t] as Fila[]).filter((f) => !quitar.has(claveDe(f))).map((f) => {
      const n = nuevas.get(claveDe(f));
      if (n) nuevas.delete(claveDe(f));
      return n ?? f;
    });
    (e as unknown as Record<string, Fila[]>)[t] = [...filas, ...nuevas.values()];
  }
  return e;
}

/** El almacén de la aplicación. Las pruebas crean el suyo con un almacenamiento falso y datos chicos. */
export const almacen = new AlmacenSimulado();
