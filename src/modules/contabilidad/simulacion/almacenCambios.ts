/* ============================================================
   MGG · Contabilidad · Almacén de «Cambio» (cont_cambios)

   Las tasas que carga el usuario en la tabla «Cambio» de Galac viven en su
   PROPIO almacén, aparte del estado simulado (Master, 29/10 05:10 y 05:13):
   en la base serán su propia tabla y Contabilidad no escribe en las tasas
   del sistema (aislamiento, contrato §4 quater). cont_tasas no cambia.
   · Arranca vacío: la tabla «Cambio» de la compañía real es de la Fase 3.
   · Se guarda entero en localStorage (`mgg.contabilidad.cambios`): son
     pocas filas. Si falla, sigue en memoria.
   · «Reiniciar datos de ejemplo» también lo vacía.
   ============================================================ */

import type { ContCambio } from '../tipos';
import { almacenamientoDelNavegador, type Almacenamiento } from './almacen';

export const CLAVE_CAMBIOS = 'mgg.contabilidad.cambios';
const VERSION = 1;

const copia = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

export class AlmacenCambios {
  private filas: ContCambio[] | null = null;

  constructor(private readonly almacenamiento: Almacenamiento | null = almacenamientoDelNavegador()) {}

  async leer(): Promise<ContCambio[]> {
    return copia(this.cargar());
  }

  /** Aplica un cambio y lo guarda. Si el cambio lanza, no queda nada a medias. */
  async modificar<R>(cambio: (filas: ContCambio[]) => R): Promise<R> {
    const trabajo = copia(this.cargar());
    const resultado = cambio(trabajo);
    this.filas = trabajo;
    try {
      this.almacenamiento?.setItem(CLAVE_CAMBIOS, JSON.stringify({ version: VERSION, filas: trabajo }));
    } catch { /* sin almacenamiento: dura hasta recargar */ }
    return copia(resultado);
  }

  async reiniciar(): Promise<void> {
    this.filas = [];
    try { this.almacenamiento?.removeItem(CLAVE_CAMBIOS); } catch { /* nada que borrar */ }
  }

  private cargar(): ContCambio[] {
    if (this.filas) return this.filas;
    try {
      const crudo = this.almacenamiento?.getItem(CLAVE_CAMBIOS);
      const datos = crudo ? (JSON.parse(crudo) as { version: number; filas: ContCambio[] }) : null;
      this.filas = datos && datos.version === VERSION && Array.isArray(datos.filas) ? datos.filas : [];
    } catch {
      this.filas = [];
    }
    return this.filas;
  }
}

export const almacenCambios = new AlmacenCambios();
