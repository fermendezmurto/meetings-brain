/**
 * Vive aparte de session.ts a proposito: el middleware corre en el runtime edge
 * y no puede arrastrar nada de node:fs. Aca solo hay constantes.
 */
export const COOKIE = 'mb_sesion'
export const COOKIE_ESTADO = 'mb_estado'
