/**
 * Nombres de personas: compararlos y encontrarlos como lo haria alguien de la
 * oficina. Sin dependencias de Google, para poder probarlo afuera.
 */

/**
 * "Fernando Méndez", "fernando mendez" y "  FERNANDO  MENDEZ " son la misma
 * persona. Sin esto la lista se llena de duplicados que nadie ve venir.
 */
function normalizarNombre(nombre) {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca a alguien en la lista de la empresa a partir de como lo nombraron.
 *
 * En la oficina nadie dice el nombre completo: se dice "Diana". Si hay una sola
 * Diana, es ella. Si hay dos, no se adivina: se devuelven las candidatas para
 * preguntar. Asignarle una tarea a la persona equivocada es peor que no
 * asignarla.
 *
 * @return {{persona: Object|null, candidatos: Object[]}}
 */
function buscarPersona(personas, nombre) {
  const buscado = normalizarNombre(nombre);
  if (!buscado) return { persona: null, candidatos: [] };

  if (buscado.indexOf('@') !== -1) {
    const porCorreo = personas.filter(function (p) {
      return normalizarNombre(p.email) === buscado;
    });
    return { persona: porCorreo[0] || null, candidatos: porCorreo };
  }

  const exactas = personas.filter(function (p) {
    return normalizarNombre(p.nombre) === buscado;
  });
  if (exactas.length === 1) return { persona: exactas[0], candidatos: exactas };

  // "Diana" contra "Diana Valiente", o "Juan Antonio" contra "Juan Antonio Pérez":
  // coincide si lo dicho es el comienzo del nombre, palabra por palabra.
  const palabras = buscado.split(' ');
  const parciales = personas.filter(function (p) {
    const suyas = normalizarNombre(p.nombre).split(' ');
    return palabras.every(function (w, i) { return suyas[i] === w; });
  });
  if (parciales.length === 1) return { persona: parciales[0], candidatos: parciales };

  return { persona: null, candidatos: parciales.length ? parciales : exactas };
}
