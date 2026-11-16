/**
 * «Base grande»: siembra la base de la prueba con N usuarios registrados «dormidos» (sin usar la API) para medir cómo escalan
 * las consultas con el tamaño de las tablas. Todo con SQL generado en el propio PostgreSQL (`generate_series`), por lotes:
 *  - `users`: email `sleeper<g>@load.test`, mismo hash de contraseña precalculado que un usuario activo (los dormidos no inician sesión),
 *    país repartido, código de amigo único, alta repartida en 200 días.
 *  - `player_docs`: documento de jugador realista = el documento de un usuario activo (jugó una sesión) ampliado a ~30 Pokémon.
 *  - `league_scores`: semana y mes actuales (≈40 % de los dormidos, puntuación con cola larga) + 2 semanas y 1 mes anteriores (≈25 %).
 *  - `friendships`: ≈8 amigos aceptados por dormido, y 10 amigos dormidos para cada usuario activo (así sus rankings de amigos pesan).
 * Después `ANALYZE` (como haría el autovacuum en un servidor real).
 */
import postgres from 'postgres'
import { monthKey, weekKey } from '../../src/engine'
import type { BigBaseInfo } from './types'

const CHUNK = 5000
/** Especies para ampliar el equipo del documento plantilla. */
const SPECIES = ['bulbasaur', 'charmander', 'squirtle', 'pidgey', 'rattata', 'pikachu', 'sandshrew', 'nidoran-f', 'clefairy', 'vulpix', 'jigglypuff', 'zubat', 'oddish', 'meowth', 'psyduck', 'growlithe', 'poliwag', 'abra', 'machop', 'geodude', 'ponyta', 'slowpoke', 'magnemite', 'gastly', 'onix', 'eevee', 'snorlax', 'dratini', 'mareep', 'togepi', 'marill', 'wooper', 'murkrow', 'larvitar', 'ralts', 'zigzagoon', 'taillow', 'slakoth', 'poochyena', 'shinx']
const COUNTRIES = ['ES', 'MX', 'AR', 'CO', 'US', 'FR', 'BR', 'CL', 'PE', 'DE']

/** UUID determinista de un dormido: permite referirse a él en otras tablas sin guardar los ids. */
const SID = (g: string) => `('00000000-0000-4000-8000-' || lpad(to_hex(${g}), 12, '0'))::uuid`

type Doc = { player?: { pokemon: Record<string, Record<string, unknown>>; team: string[]; pokedex: { seen: string[]; caught: string[] }; counters: { pokemon: number } } }

/** Amplía el documento de un usuario activo hasta `n` Pokémon clonando el primero con otras especies. */
export function growDoc(doc: Doc, n: number): Doc {
  const p = doc.player
  if (!p) throw new Error('El documento plantilla no tiene jugador')
  const first = Object.values(p.pokemon)[0]
  if (!first) throw new Error('El documento plantilla no tiene Pokémon')
  const d = structuredClone(doc) as Required<Doc> & Doc
  const pl = d.player!
  let k = 0
  while (Object.keys(pl.pokemon).length < n) {
    const uid = `s${k}`
    k++
    if (pl.pokemon[uid]) continue
    const species = SPECIES[(k - 1) % SPECIES.length]!
    pl.pokemon[uid] = { ...structuredClone(first), uid, speciesSlug: species, exp: 500 + k * 120 }
    if (!pl.pokedex.caught.includes(species)) pl.pokedex.caught.push(species)
    if (!pl.pokedex.seen.includes(species)) pl.pokedex.seen.push(species)
  }
  pl.counters.pokemon = Math.max(pl.counters.pokemon, Object.keys(pl.pokemon).length + 1)
  pl.team = Object.keys(pl.pokemon).slice(0, 6)
  return d
}

export async function seedBigBase(pgUrl: string, total: number, log: (s: string) => void): Promise<BigBaseInfo | null> {
  const sql = postgres(pgUrl, { max: 1, onnotice: () => {}, idle_timeout: 0, connect_timeout: 10 })
  try {
    const t0 = Date.now()
    const [{ n: existing, s: sleepers0 }] = (await sql`select count(*)::int as n, count(*) filter (where email like 'sleeper%')::int as s from users`) as unknown as [{ n: number; s: number }]
    const need = total - existing
    if (need <= 0) {
      log(`  Base grande: ya hay ${existing} usuarios (objetivo ${total}); no se siembra nada.`)
      return null
    }
    const tpl = await sql`select u.password_hash as hash, d.doc from users u join player_docs d on d.user_id = u.id where d.doc -> 'player' is not null order by d.version desc limit 1`
    if (!tpl[0]) throw new Error('Base grande: no hay ningún usuario activo con jugador del que copiar el documento y el hash (¿fase de altas vacía?)')
    const hash = tpl[0].hash as string
    const doc = growDoc(tpl[0].doc as Doc, 30)
    const docJson = JSON.stringify(doc)
    log(`  Base grande: sembrando ${need} usuarios dormidos (${existing} existentes → ${total}); documento de ~${(docJson.length / 1024).toFixed(0)} KB con ${Object.keys(doc.player!.pokemon).length} Pokémon…`)

    // Claves de periodo de un usuario activo (zona horaria de la plantilla): actuales y anteriores.
    const player = (doc as unknown as { player: Parameters<typeof weekKey>[0] }).player
    const now = Date.now()
    const week = [0, 1, 2].map((k) => weekKey(player, now - k * 7 * 86_400_000))
    const month = [0, 1].map((k) => monthKey(player, now - k * 31 * 86_400_000))
    const periods = [
      ...week.map((key, k) => ({ period: 'week', key, frac: k === 0 ? 0.4 : 0.25, scale: 1500 })),
      ...month.map((key, k) => ({ period: 'month', key, frac: k === 0 ? 0.4 : 0.25, scale: 5000 })),
    ].filter((p, i, a) => a.findIndex((q) => q.period === p.period && q.key === p.key) === i)

    const first = sleepers0 + 1
    const last = sleepers0 + need
    for (let a = first; a <= last; a += CHUNK) {
      const b = Math.min(last, a + CHUNK - 1)
      await sql.unsafe(
        `insert into users (id, email, password_hash, trainer_name, country, friend_code, created_at)
         select ${SID('g')}, 'sleeper' || g || '@load.test', $1, 'Dormido' || g, (array[${COUNTRIES.map((c) => `'${c}'`).join(',')}])[1 + g % ${COUNTRIES.length}], 'Z' || lpad(g::text, 7, '0'), now() - random() * interval '200 days'
         from generate_series($2::int, $3::int) g`,
        [hash, a, b],
      )
      await sql.unsafe(
        `insert into player_docs (user_id, doc, version, updated_at)
         select ${SID('g')}, jsonb_set(jsonb_set($1::text::jsonb, '{player,profile,trainerName}', to_jsonb('Dormido' || g)), '{player,dust}', to_jsonb((g * 37) % 5000)), 1, now() - random() * interval '30 days'
         from generate_series($2::int, $3::int) g`,
        [docJson, a, b],
      )
      for (const p of periods) {
        await sql.unsafe(
          `insert into league_scores (user_id, period, period_key, points, updated_at)
           select ${SID('g')}, $1, $2, 1 + (power(random(), 3) * $3::int)::int, now() - random() * interval '6 days'
           from generate_series($4::int, $5::int) g where random() < $6::float8`,
          [p.period, p.key, p.scale, a, b, p.frac],
        )
      }
      // Amistades entre dormidos (la mitad de los pares generados: el otro extremo con índice menor no se repite al revés).
      await sql.unsafe(
        `insert into friendships (requester_id, addressee_id, status, created_at, accepted_at)
         select ${SID('g')}, ${SID(`(((g * 7919 + k * 104729) % ${last}) + 1)`)}, 'accepted', now() - interval '40 days', now() - interval '39 days'
         from generate_series($1::int, $2::int) g, generate_series(1, 8) k
         where g < (((g * 7919 + k * 104729) % ${last}) + 1)
         on conflict do nothing`,
        [a, b],
      )
      if (b === last || (b - first + 1) % 20000 < CHUNK) log(`    …${b - first + 1}/${need} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
    }
    // Cada usuario activo (load<i>@load.test) con 10 amigos dormidos.
    await sql.unsafe(
      `insert into friendships (requester_id, addressee_id, status, created_at, accepted_at)
       select a.id, ${SID(`(((a.rn * 7919 + k * 104729) % ${last}) + 1)`)}, 'accepted', now() - interval '30 days', now() - interval '29 days'
       from (select id, row_number() over (order by id) rn from users where email like 'load%@load.test') a, generate_series(1, 10) k
       on conflict do nothing`,
    )
    log('  Base grande: ANALYZE…')
    for (const t of ['users', 'player_docs', 'league_scores', 'friendships']) await sql.unsafe(`analyze ${t}`)
    const sizes = await sql`select c.relname as t, c.reltuples::bigint as rows, (pg_total_relation_size(c.oid) / 1048576.0)::float8 as mb from pg_class c where c.relname in ('users', 'player_docs', 'league_scores', 'friendships')`
    const [{ mb }] = (await sql`select (pg_database_size('pokefocus') / 1048576.0)::float8 as mb`) as unknown as [{ mb: number }]
    const [{ n }] = (await sql`select count(*)::int as n from users`) as unknown as [{ n: number }]
    const tables: BigBaseInfo['tables'] = {}
    for (const r of sizes) tables[r.t as string] = { rows: Number(r.rows), mb: r.mb as number }
    const info: BigBaseInfo = { sleepers: last, totalUsers: n, seconds: Math.round((Date.now() - t0) / 1000), dbSizeMb: mb, tables }
    log(`  Base grande lista en ${info.seconds} s: ${n} usuarios, base de ${mb.toFixed(0)} MB (${Object.entries(tables).map(([k, v]) => `${k} ${v.mb.toFixed(0)} MB`).join(', ')})`)
    return info
  } finally {
    await sql.end({ timeout: 5 })
  }
}
