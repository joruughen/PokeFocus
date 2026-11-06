/** Render smoke test of the role tag (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import type { SpeciesRole } from '../../engine'
import { RoleBadge } from './RoleBadge'
import { TypeBadge } from './TypeBadge'

const ROLES: SpeciesRole[] = ['scholar', 'hunter', 'sprinter', 'marathoner', 'technician', 'guardian', 'support', 'allrounder']

describe('RoleBadge', () => {
  it('renders nothing without a role', () => {
    expect(renderToStaticMarkup(<RoleBadge role={undefined} />)).toBe('')
  })

  for (const lng of ['es', 'en'] as const) {
    it(`shows the role name with an icon, never as a raw key (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      for (const role of ROLES) {
        for (const size of ['sm', 'md'] as const) {
          for (const onLight of [false, true]) {
            const html = renderToStaticMarkup(<RoleBadge role={role} size={size} onLight={onLight} />)
            expect(html, role).not.toMatch(/roles?\.[a-z]|roleInfo\./) // no raw i18n keys
            expect(html).toContain(i18n.t(`roles.${role}.name`))
            expect(html).toContain('<svg') // role icon
            expect(html).toContain(`aria-label="${i18n.t('roleInfo.aria', { name: i18n.t(`roles.${role}.name`) })}"`)
          }
        }
      }
    })

    it(`the large size adds the "${lng === 'es' ? 'Rol' : 'Role'}" label, the small one does not (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const prefix = `>${i18n.t('roleInfo.prefix')}<`
      expect(renderToStaticMarkup(<RoleBadge role="sprinter" size="md" onLight />)).toContain(prefix)
      expect(renderToStaticMarkup(<RoleBadge role="sprinter" />)).not.toContain(prefix)
    })
  }

  it('is an empty outline, unlike the solid type badges', () => {
    const role = renderToStaticMarkup(<RoleBadge role="sprinter" onLight />)
    const type = renderToStaticMarkup(<TypeBadge type="flying" />)
    expect(role).toContain('border-2')
    expect(role).not.toMatch(/\sbg-type-|shadow-frame/)
    expect(type).toContain('shadow-frame')
    expect(type).not.toContain('border-2')
  })
})
