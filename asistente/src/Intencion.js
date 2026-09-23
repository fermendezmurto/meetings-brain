/**
 * Los pedidos que se entienden sin llamar al modelo. Son los de todos los dias
 * ("pendientes", "listo 4"): resolverlos aca es instantaneo, no gasta cuota de
 * Gemini y nunca se equivoca.
 *
 * Todo lo que no calza aca se lo pasa a Gemini como mensaje libre.
 */
function interpretarComando(texto) {
  const t = String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.]/g, '')
    .replace(/^\//, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!t) return { tipo: 'vacio' };

  if (/^(ayuda|help|hola|comandos|que podes hacer|como funciona)$/.test(t)) {
    return { tipo: 'ayuda' };
  }
  if (/^(pendientes|mis pendientes|tareas|mis tareas|que tengo|que tengo pendiente|que tengo que hacer|que me toca)$/.test(t)) {
    return { tipo: 'pendientes' };
  }
  if (/^(pedidos|mis pedidos|lo que pedi|que pedi|que pedi yo|lo que encargue)$/.test(t)) {
    return { tipo: 'pedidos' };
  }

  const cierre = t.match(/^(listo|lista|hecho|hecha|cerrar|cerrada|terminado|terminada|ok)\s*(?:la\s+)?#?\s*(\d+)$/);
  if (cierre) return { tipo: 'cerrar', numero: Number(cierre[2]) };

  return { tipo: 'libre', texto: String(texto).trim() };
}
