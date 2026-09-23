import { describe, expect, it } from 'vitest'
import { cargar, TODOS } from './cargar'

const { normalizarNombre, buscarPersona } = cargar(...TODOS)

const gente = [
  { nombre: 'Diana Valiente', email: 'diana@empresa.com' },
  { nombre: 'Juan Antonio Pérez', email: 'ja@empresa.com' },
  { nombre: 'Juan Martín Gómez', email: 'jm@empresa.com' },
  { nombre: 'Christian Aponte', email: 'ca@empresa.com' },
]

describe('normalizarNombre', () => {
  it('trata igual lo que una persona leería igual', () => {
    expect(normalizarNombre('  Fernando   Méndez ')).toBe(normalizarNombre('fernando mendez'))
  })
})

describe('buscarPersona', () => {
  it('encuentra por nombre de pila cuando hay una sola persona así', () => {
    expect(buscarPersona(gente, 'Diana').persona.email).toBe('diana@empresa.com')
  })

  it('encuentra aunque falten los acentos', () => {
    expect(buscarPersona(gente, 'juan antonio perez').persona.email).toBe('ja@empresa.com')
  })

  it('encuentra por el comienzo del nombre, palabra por palabra', () => {
    expect(buscarPersona(gente, 'Juan Antonio').persona.email).toBe('ja@empresa.com')
  })

  it('no adivina cuando hay dos personas con ese nombre', () => {
    const r = buscarPersona(gente, 'Juan')
    expect(r.persona).toBeNull()
    expect(r.candidatos).toHaveLength(2)
  })

  it('no confunde un pedazo de palabra con un nombre', () => {
    // "Chris" no es "Christian": en la oficina serían dos personas distintas.
    expect(buscarPersona(gente, 'Chris').persona).toBeNull()
  })

  it('encuentra por correo', () => {
    expect(buscarPersona(gente, 'CA@empresa.com').persona.nombre).toBe('Christian Aponte')
  })

  it('con nombre vacío no devuelve a nadie', () => {
    expect(buscarPersona(gente, '  ').persona).toBeNull()
  })
})
