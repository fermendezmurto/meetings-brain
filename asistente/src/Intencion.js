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
    .replace(/[¿?¡!.,;:]/g, ' ')
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

  // "listo 3", "listo, la 3", "ya cerré la #3", "terminé la tarea 3" o al revés,
  // "la 3 está lista". Una frase con más palabras va al modelo.
  const HECHO = '(?:listo|lista|hecho|hecha|cerrar|cerrada|cerrado|cerre|terminado|terminada|termine|completada|completado|complete|hice|ok)';
  const NUMERO = '(?:(?:la|el)\\s+)?(?:tarea\\s+)?#?\\s*(\\d+)';
  const cierre = t.match(new RegExp('^(?:ya\\s+)?' + HECHO + '\\s+' + NUMERO + '$')) ||
    t.match(new RegExp('^' + NUMERO + '\\s+(?:ya\\s+)?(?:esta\\s+)?' + HECHO + '$'));
  if (cierre) return { tipo: 'cerrar', numero: Number(cierre[1]) };

  return { tipo: 'libre', texto: String(texto).trim() };
}
