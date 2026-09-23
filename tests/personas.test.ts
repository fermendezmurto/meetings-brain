import { describe, expect, it } from 'vitest'
import { normalizar } from '@/lib/personas'

describe('normalizar', () => {
  it('trata como la misma persona lo que una persona leeria igual', () => {
    expect(normalizar('Fernando Méndez')).toBe(normalizar('fernando mendez'))
    expect(normalizar('  Juan   Antonio ')).toBe(normalizar('Juan Antonio'))
    expect(normalizar('DIANA')).toBe(normalizar('Diana'))
  })

  it('no confunde a dos personas distintas', () => {
    expect(normalizar('Juan Antonio')).not.toBe(normalizar('Juan Martín'))
  })
})
