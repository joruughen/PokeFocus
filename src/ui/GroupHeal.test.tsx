import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import type { GroupHealView, HealsResponse } from '../game/protocol'
import { HealNoticeList } from './GroupHealNotice'
import { HealPanelView } from './screens/home/GroupHealPanel'

const T = Date.UTC(2026, 10, 17, 12, 0)
const heal = (o: Partial<GroupHealView> = {}): GroupHealView => ({
  id: 'h1',
  groupId: 'g1',
  from: { userId: 'u1', trainerName: 'Ash' },
  to: { userId: 'u2', trainerName: 'Misty' },
  pokemonUid: 'p1',
  speciesSlug: 'pikachu',
  amount: 20,
  status: 'pending',
  createdAt: T,
  expiresAt: T + 12 * 3_600_000,
  respondedAt: null,
  ...o,
})
const noop = () => {}
const notice = (heals: GroupHealView[], studying = false) => renderToStaticMarkup(<HealNoticeList heals={heals} studying={studying} busy={false} onAccept={noop} onDecline={noop} />)
const panel = (group: NonNullable<HealsResponse['group']>) => renderToStaticMarkup(<HealPanelView group={group} amount={20} busy={false} onSend={noop} onCancel={noop} />)

describe('GroupHealNotice (heals I received)', () => {
  it('renders nothing without heals', () => {
    expect(notice([])).toBe('')
  })

  for (const lng of ['es', 'en'] as const) {
    it(`shows who heals which Pokémon, with accept and decline (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = notice([heal()])
      expect(html).not.toMatch(/heal\.[a-zA-Z]/)
      expect(html).toContain('Ash')
      expect(html).toContain('Pikachu')
      expect(html).toContain('+20')
      expect(html).toContain(lng === 'es' ? 'Aceptar' : 'Accept')
      expect(html).toContain(lng === 'es' ? 'Rechazar' : 'Decline')
    })
  }
})

describe('GroupHealPanel (heals I can send on my waves)', () => {
  const group: NonNullable<HealsResponse['group']> = {
    id: 'g1',
    until: T + 3 * 3_600_000,
    remaining: 1,
    targets: [
      { userId: 'u2', trainerName: 'Misty', pokemon: [{ uid: 'p1', speciesSlug: 'pikachu', level: 12, isShiny: false }], sent: false },
      { userId: 'u3', trainerName: 'Brock', pokemon: [{ uid: 'p2', speciesSlug: 'onix', level: 30, isShiny: false }], sent: true },
    ],
    sent: [heal({ id: 'h9', to: { userId: 'u3', trainerName: 'Brock' }, speciesSlug: 'onix' })],
  }

  it('renders nothing when there is nobody to heal and nothing sent', () => {
    expect(panel({ ...group, targets: [], sent: [] })).toBe('')
  })

  for (const lng of ['es', 'en'] as const) {
    it(`lists members and their Pokémon, marks the sent one and offers to withdraw it (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = panel(group)
      expect(html).not.toMatch(/heal\.[a-zA-Z]/)
      expect(html).toContain('Misty')
      expect(html).toContain('Brock')
      expect(html).toContain(lng === 'es' ? 'Ya enviada' : 'Already sent')
      expect(html).toContain(lng === 'es' ? 'Retirar' : 'Withdraw')
      // One button to pick Pikachu; Brock's Pokémon are not offered again.
      expect(html).toContain(lng === 'es' ? 'Curar a Pikachu de Misty' : "Heal Misty&#x27;s Pikachu")
      expect(html).not.toContain(lng === 'es' ? 'Curar a Onix' : 'Onix (')
    })
  }

  it('tells a player who is still studying that they accept it later (the accept button is off)', async () => {
    await i18n.changeLanguage('en')
    const html = notice([heal()], true)
    expect(html).toContain('when your session is over')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*(<[^>]+>)*[^<]*Accept/)
  })

  it('says there are no heals left when the wave allowance is used', async () => {
    await i18n.changeLanguage('en')
    const html = panel({ ...group, remaining: 0 })
    expect(html).toContain('No heals left for now')
    expect(html).toContain('disabled')
  })
})
