import { describe, expect, it } from 'vitest'
import phoneInfo from '../src/main/modules/phone/phoneInfo'
import { entity, runModule } from './helpers/context'

describe('phone.info', () => {
  it('analyse un mobile français hors ligne', async () => {
    const out = await runModule(phoneInfo, entity('phone', '+33612345678'))
    expect(out.properties?.e164).toBe('+33612345678')
    expect(out.properties?.country).toBe('France')
    expect(out.properties?.line_type).toBe('Mobile')
    expect(out.entities?.some((e) => e.type === 'carrier')).toBe(true)
  })
})
