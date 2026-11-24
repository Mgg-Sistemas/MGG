/* ============================================================
   Compatibilidad multi-empresa MGG / GT · Plan de cuentas
   Re-exporta el plan de cuentas oficial de MGG adaptado al ecosistema.
   ============================================================ */

export * from './planCuentasMgg';
export {
  PARAMETROS_MGG as PARAMETROS_GT,
  CENTROS_COSTO_MGG as CENTROS_COSTO_GT,
  generarPlanCuentasMGG as generarPlanCuentasGT,
} from './planCuentasMgg';
