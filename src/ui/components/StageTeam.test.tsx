/** StageTeam (server-side render): the player's character stands at the left of the team when given. */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StageTeam, teamStageHeight, type StageTeamMember } from './StageTeam'

const mons: StageTeamMember[] = ['pikachu', 'eevee', 'snorlax'].map((slug, i) => ({ uid: `m${i}`, slug, name: slug }))
const imgs = (html: string) => [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]!)

describe('StageTeam trainer', () => {
  it('without a trainer it is unchanged: only the team, in the usual 96 px cells', () => {
    const html = renderToStaticMarkup(<StageTeam members={mons} />)
    expect(imgs(html).every((s) => s.startsWith('/sprites/showdown/'))).toBe(true)
    expect(imgs(html)).toHaveLength(3)
    expect(html).toContain('relative flex w-24 flex-col items-center sm:w-28')
    expect(html).not.toContain('order-')
    expect(html).not.toContain('sm:gap-x-4')
  })

  it('with a trainer: the character comes first (the server render is the wide layout), then the team', () => {
    const html = renderToStaticMarkup(<StageTeam members={mons} trainer="hilbert" dim />)
    const found = imgs(html)
    expect(found[0]).toBe('/sprites/trainers/hilbert.png')
    expect(found.slice(1).every((s) => s.startsWith('/sprites/showdown/'))).toBe(true)
    expect(found).toHaveLength(4)
    expect(html).toContain('order-first')
    expect(html).toContain('sm:gap-x-4')
    // The character is decorative (the team's names stay as the accessible content).
    expect(html).toMatch(/<img[^>]*alt=""[^>]*hilbert\.png|<img[^>]*hilbert\.png[^>]*alt=""/)
  })

  it('a null trainer (signed out, or none) draws nothing extra', () => {
    expect(imgs(renderToStaticMarkup(<StageTeam members={mons} trainer={null} />))).toHaveLength(3)
  })
})

describe('teamStageHeight', () => {
  it('is 18 rem; a phone gets 24 rem only for a team of six with the trainer in front', () => {
    expect(teamStageHeight(6, false)).toBe('h-72')
    expect(teamStageHeight(5, true)).toBe('h-72')
    expect(teamStageHeight(6, true)).toBe('h-72 max-sm:h-96')
  })
})
