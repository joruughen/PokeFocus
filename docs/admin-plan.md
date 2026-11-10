# Plan Fase E: administración en vivo y eventos (PokeFocus)

> Diseño generado el 2026-11-09 por un agente de planificación. Decisión del usuario: cambios en vivo desde la base de datos, con versiones. Ver «Hoja de ruta» en docs/PENDING.md.


## 0. Lo que hay hoy (verificado en el código)

**Carga de datos y config**
- `src/data/index.ts` importa de forma estática `src/data/game/{species,moves,abilities,types,natures,items}.json` y exporta `gameData`.
- `src/engine/config.ts`: `buildConfig(overrides, json)` combina, de menos a más prioridad, `ENGINE_DEFAULTS`, `custom-game-config.json` y los overrides, con `deepMerge` (los arrays se sustituyen y las claves `_` se ignoran).
- `src/engine/context.ts`: `createEngineContext({config,data,techniques,abilities,missions})` monta `EngineContext` (indexa, avisa de kinds desconocidos). `defaultContext()` lo memoriza en un `cached` del módulo. Todas las funciones del motor aceptan `ctx = defaultContext()` como último parámetro, unas 100 firmas.
- **Servidor:** `src/game/actions.ts` `applyAction(doc, action, env)` ya acepta `env.ctx` (línea 114: `env.ctx ?? defaultContext()`). `server/routes/game.ts` `runGameAction` no lo pasa todavía. `server/validation.ts:50` y `server/push.ts:136,195` leen `defaultContext().config.session` al cargar el módulo o al llamar.
- **Cliente:** el servidor es autoritativo y el cliente solo usa el motor para las vistas. Hay unos 35 módulos de UI que capturan el contexto al cargar (`const ctx = defaultContext()` o `const cfg = defaultContext().config`): `src/ui/store/game.ts:56`, `screens/home/{Waves,Claim,FocusSession,PreSession,Results,Break,SessionReport,TypesGuide,SoundStyle,GroupStudy}.tsx`, `screens/box/*`, `screens/league/League.tsx`, `screens/missions/Missions.tsx`, `lib/names.ts`, `lib/conditions.ts`, `components/{Sprite,MonTile,StatRow}.tsx`, etc. Ese es el principal obstáculo para tener config en vivo en el cliente.
- **Simulador:** `scripts/sim/experiments.ts` `makeContext(config, speciesPatch)` y `runMatrix({ctx,…})` ya reciben un ctx. Se puede reutilizar con un contexto resuelto desde la BD. El `Dockerfile` no copia `scripts/`.

**Puntos de enganche del motor**
- `src/engine/waves.ts`:
  - `speciesWeight()` (l.221): peso = captureRate^(1/boost) × condición × sonido × equipo × typeWeightMults. No existe un peso por especie ni condiciones por especie.
  - `rollWild()` (l.236): legendario con `legendaryChance` y `pick` uniforme; shiny con `e.shinyChance * (0.5+focus)` (l.256). `weightedPick` cae en `pool[0]` si todos los pesos son 0.
- `src/engine/session.ts` `completeSession` (l.534): recompensas en l.948 (EXP), l.1074 (dust) y l.1075 (pokeBalls). El encuentro queda en `PlayerState.encounter` después de reclamar (`throwBall`, `rerollWild` y `assignDamage` usan el ctx más tarde).
- `src/engine/missions.ts`:
  - `generateSlots` sortea por día o semana con la semilla `missions|createdAt|period|key`.
  - Los slots guardan `defId` y el reward ya resuelto.
  - `defOf()` busca la definición en `ctx.missions.pool`. Si un def desaparece, el slot deja de verse (`slotView` → null) y no avanza.
- `src/engine/state.ts`: `ActiveSession` (l.82) ya fija `weather` al empezar, que es el patrón a copiar. Existen también `EncounterState` (l.242) y `MissionsState`.

**Servidor**
- Hono. Middleware CSRF: Origin más `Content-Type: application/json` obligatorio en las mutaciones. `BODY_LIMIT = 64 KB` (`server/app.ts:29`).
- `/api/events` **ya es SSE** (`server/routes/events.ts`), así que los eventos de juego necesitan otro nombre: uso `live-events`.
- `EventBus.publish(userId, ev)` publica por usuario, no hay broadcast.
- Hay un programador cada 15 s en `server/index.ts` (push).
- Esquema en `server/db/schema.ts`. Migraciones de la 0000 a la 0004 aplicadas al arrancar (PG o PGlite).
- zod v4 ya se usa en `server/validation.ts`, `env.ts` y `http.ts`.

**Admin actual**
- `server/routes/admin.ts`: Bearer `ADMIN_TOKEN`, límite por IP, solo `maintenance`.
- UI en `src/ui/screens/admin/Admin.tsx`, con el token en sessionStorage. Ruta `admin` en `src/ui/routes.tsx:47`, carga diferida y `nav:false`.

## 1. Config en vivo: modelo de capas, distribución y fijado

### Capas (de menos a más prioridad)
1. **Base del repo:** lo generado en `src/data/game/*.json` por `npm run build:data`. Va en el bundle del cliente y del servidor. `build:data` escribe también `src/data/game/meta.json` con `{ baseHash }` (sha256 del JSON canónico de los 10 ficheros). Un test comprueba que está al día.
2. **Override de admin versionado** (`content_versions.patch`): es un **patch completo sobre la base**, no un delta sobre la versión anterior. Cada versión es autocontenida, así que un rollback consiste en republicar un patch antiguo.
3. **Overlays de evento** (`live_events.overlay`): solo los eventos con `starts_at ≤ t < ends_at`, en orden `(starts_at, id)`. El overlay solo admite un conjunto cerrado de claves (destacadas, shiny, legendario, drops, misiones), no config arbitraria.

### Tipo del patch: `src/engine/content.ts` (nuevo, puro, sin dependencias)
```ts
interface ContentPatch {
  config?: GameConfigOverrides                    // solo rutas de la whitelist (ver §2)
  species?: Record<slug, { captureRate?: number; spawn?: SpeciesSpawn }>
  moves?: Record<slug, { power?: number|null; accuracy?: number|null }>
  techniques?: Record<slug, TechniqueDef>         // reemplazo por slug
  abilities?: Record<slug, AbilityDef>
  missions?: { dailyCount?; weeklyCount?; pool?: MissionDef[]; pokedex?: PokedexMilestoneDef[]; placeholderItems? }
}
interface SpeciesSpawn { enabled?: boolean; weightMult?: number; hours?: [number,number][]; weather?: ('rain'|'sun'|'snow'|'clear')[]; minTrainerLevel?: number }
interface EventOverlay {
  id; slug; startsAt; endsAt
  featured: { species: string; weightMult: number }[]
  shiny?: { chance: number; scope: 'all'|'featured' }
  legendaryChanceMult?: number
  drops: { item: string; perWaveChance: number; max: number }[]
  missions: MissionDef[]                          // period: 'event'
  items?: Record<slug, { names; description? }>   // objetos propios del evento
}
export function resolveContent(patch: ContentPatch, events: EventOverlay[], allEventItems): ContextOptions
```
`EngineContext` gana estos campos:
- `contentHash: string` (`'base'` si no hay patch)
- `spawn: Map<slug, {weightMult, hours, weather, enabled, minTrainerLevel}>`, con el mult del admin × el mult de destacada de cada evento
- `events: ActiveEvent[]`, para la UI y el informe

Los objetos de **todos** los eventos publicados, también los pasados, entran en `missions.placeholderItems` para que el inventario siga mostrando su nombre cuando el evento termina.

En `context.ts` se añade `setDefaultContext(ctx | null)`: `defaultContext()` devuelve el contexto activo y, si no hay ninguno, el memorizado de la base. Los tests lo ponen a null en `afterEach`.

**Invariante de oro (test):** `createEngineContext(resolveContent({}, [], {}))` es profundamente igual a `createEngineContext()`, y `session.test.ts`/`capture.test.ts` dan resultados idénticos bit a bit. Los multiplicadores solo se aplican si están definidos (sin `w*1` innecesarios ni tiradas extra de RNG).

### Servidor: `server/content/service.ts` (nuevo, en `Deps.content`)
- Tiene en memoria las versiones publicadas y los eventos publicados. Recarga al escribir desde admin (mismo proceso) y cada 60 s por seguridad.
- `current(now) → { hash, ctx }`:
  - Elige la versión activa: la publicada con mayor `effective_at ≤ now`.
  - Elige los eventos activos en `now`.
  - Clave = `versionId + [eventId@revision]`, memorizada.
  - `hash = sha256(baseHash + canonical(resolvedPatch))` con `node:crypto`. El motor no calcula hashes.
- `byHash(hash) → ctx | null`: LRU (unos 32) y, si no está, lee `content_snapshots`.
- Al primer uso de un hash hace `INSERT … ON CONFLICT DO NOTHING` en `content_snapshots`, dentro de la transacción de la acción que lo fija.
- Tick en `server/index.ts` cada 30 s: si cambia `current().hash`, envía `bus.broadcast({type:'content', hash})`. Hay que añadir `broadcast` a `server/events.ts` y el tipo `ServerEvent` en `src/game/protocol.ts`. Así se cubren el inicio y el fin de eventos y las publicaciones programadas.

### Fijado por sesión (determinismo y reclamo)
- `ActiveSession.contentHash?: string` y `EncounterState.contentHash?: string` (en `src/engine/state.ts`).
- `ActionEnv.contentHash` en `src/game/actions.ts`: en `start`, el reducer escribe `activeSession.contentHash = env.contentHash`. En `claim`, `completeSession` copia el hash al `encounter`.
- En `runGameAction` (`server/routes/game.ts`) se elige el ctx según la acción y se pasa `env.ctx`:
  - `start`: `content.current(now)`.
  - `claim` y `cancel`: `byHash(doc.player.activeSession.contentHash)`.
  - `throwBall`, `applyStatus`, `reroll`, `assignDamage`, `autoAssignDamage`, `nextWave`, `finishWaves`: `byHash(encounter.contentHash)`.
  - El resto (caramelos, evolución, misiones, equipo): `current(now)`.
  - Si no hay hash (partidas antiguas) o el snapshot no existe, se usa `current`.
- Las sesiones de grupo (`server/groups.ts`) pasan por `runGameAction`, así que no hace falta nada extra.
- Una sesión que empezó durante un evento conserva las destacadas, el shiny y los drops aunque el evento termine antes del reclamo. Una que empezó antes no las recibe. Así queda documentado para el jugador.

### Cliente
- `GET /api/content` (público, porque el splash lo necesita):
  - Devuelve `{ hash, baseHash, patch, events: EventPublic[] }` con `ETag: hash` y `Cache-Control: no-cache`; si el ETag coincide, 304.
  - Si `baseHash` no coincide con el `meta.json` del bundle, el cliente está desfasado tras un redespliegue y muestra «Hay una versión nueva, recarga».
- `GET /api/content/:hash`: inmutable (`Cache-Control: public, max-age=31536000, immutable`). Lo usa el cliente para las pantallas de una sesión fijada.
- Store nuevo `src/ui/store/content.ts` (zustand):
  - Al arrancar descarga y aplica `setDefaultContext(createEngineContext(resolveContent(...)))`.
  - Con el SSE `content`, vuelve a pedirlo. Si hay una sesión activa en `focus`/`claim`/`waves`, **no** cambia el ctx global para esas pantallas.
  - `useSessionContext()` devuelve el ctx de `activeSession.contentHash`/`encounter.contentHash` (con un `Map` en memoria).
- Refactor mecánico de los unos 35 módulos: `const ctx = defaultContext()` del nivel del módulo pasa a llamarse dentro del componente o función, o a `useEngineContext()`. Al cambiar de hash fuera de sesión se vuelve a montar la app con `key={hash}`.

### Riesgos de determinismo y de tests
- **Orden del RNG:** los drops y cualquier tirada nueva usan un RNG derivado (`createRng(\`${sessionId}|drops|${eventId}\`)`), nunca el flujo principal. Sin eventos, el flujo no cambia.
- **Defs de misión borrados o cambiados:** los slots activos se rompen (`defOf` devuelve undefined → misión invisible). Reglas del validador:
  - El `id` es inmutable.
  - No se puede cambiar el `kind` de un id existente.
  - No se borra un def: se pone `weight: 0` o `enabled:false`.
  - Los defs de evento siguen en el contenido resuelto hasta `endsAt + 7 días`, para poder reclamar.
- **Especies, movimientos, técnicas y habilidades no se borran**, porque los Pokémon guardados los referencian. El patch solo modifica entradas existentes. Las técnicas y habilidades nuevas son un caso aparte, en una entrega futura.
- **Cambios no fijables** que afectan al instante a todos: técnicas o habilidades de Pokémon ya capturados (en vistas y energía), `levelCaps`, umbrales de liga, caramelos. Es aceptable, pero:
  - `leagues.weeklyThresholds` se aplica a la semana en curso. La UI de publicación avisa y propone programar el cambio para el lunes a las 00:00.
  - `session.*`, `focus.screenshot*`, `progression.ivMax/maxLevel`, `statCurves`, `starters` y `historyLimit` **no son editables en vivo**: `server/validation.ts:50` y `push.ts` los leen al cargar y cambiarlos invalidaría partidas.
- **Tests:** el `cached` global se sustituye por un contexto activo que se puede cambiar, así que hay que resetearlo en el setup de vitest (`src/ui/test/setup` y en server). El servidor tiene tests con PGlite `memory://`.
- **Test de integración clave:**
  1. Se empieza una sesión.
  2. Se publica `encounters.shinyChance = 1`.
  3. Al reclamar, sale **sin** shinies forzados.
  4. Repitiendo con la publicación antes de empezar, todos son shiny.

## 2. Esquema (Drizzle, `server/db/schema.ts`) y validación

### Migración `0005_admin_roles_audit`
- `users.role text not null default 'player'`, con `check (role in ('player','support','admin'))`.
- `auth_sessions.elevated_until timestamptz null`: modo sudo para publicar y conceder.
- `admin_audit`:
  - Columnas: `id uuid pk`, `actor_id uuid → users (set null)`, `actor_label text` (sirve también para el token heredado), `action text`, `target_type text`, `target_id text`, `before jsonb`, `after jsonb`, `note text`, `ip text`, `created_at`.
  - Índices: `(created_at desc)` y `(target_type, target_id)`.

### Migración `0006_content_versions`
- `content_versions`:
  - Columnas: `id serial pk`, `status text check in ('draft','published','archived')`, `patch jsonb not null`, `base_hash text`, `hash text` (del patch canónico), `parent_id int null`, `title text`, `note text`, `effective_at timestamptz null` (null mientras es borrador; en el futuro = programada), `validation jsonb` (resultado y warnings), `created_by uuid`, `created_at`, `published_by`, `published_at`.
  - Índice `(status, effective_at)`.
  - Las versiones publicadas son **inmutables**. Rollback = nueva versión con `parent_id` igual al de la antigua y su patch copiado.
- `content_snapshots`: `hash text pk`, `base_hash`, `version_id int`, `event_revs jsonb`, `resolved jsonb` (patch más los overlays ya resueltos), `created_at`. Nunca se borra si alguna sesión o encuentro lo usa; en la práctica se poda a los 90 días.

### Migración `0007_live_events_uploads`
- `live_events`:
  - Columnas: `id uuid pk`, `slug text unique`, `status ('draft','published','archived')`, `starts_at`, `ends_at` (con `check ends_at > starts_at`), `name jsonb {es,en}`, `description jsonb {es,en}`, `image_id uuid → uploads null`, `overlay jsonb` (EventOverlay sin fechas), `revision int not null default 1` (+1 en cada edición publicada), `created_by`, `updated_at`.
  - Índice `(status, starts_at, ends_at)`.
- `uploads`: `id uuid pk`, `sha256 text unique`, `mime text`, `bytes int`, `width int`, `height int`, `path text`, `created_by`, `created_at`.

### Migración `0008_session_log_sim_runs`
- `session_log`: `id bigserial`, `user_id`, `session_id`, `started_at`, `ended_at`, `minutes`, `content_hash`, `points`, `catches`, `shinies`, `legendaries`, `event_ids text[]`. Índice `(ended_at)`. Se escribe en `runGameAction` en el claim y en las finalizaciones de encuentro.
- `content_sim_runs`: `id`, `version_id`, `status ('queued','running','done','failed')`, `params jsonb`, `report jsonb`, `error`, `created_by`, `created_at`, `finished_at`.

Las migraciones se generan con `npm run db:generate` **en serie**, porque el journal de `server/db/migrations/meta` provoca conflictos. La fase D (motes y equipos) vive en el jsonb del documento y no debería migrar; si lo hace, se renumera al rebasar.

### Validación: `src/game/content/` (compartida con el admin del cliente y cargada solo en su chunk diferido)
- **`limits.ts`:** whitelist de rutas editables de config con metadatos `{path, min, max, step, unit, kind: 'prob'|'mult'|'int'|…, labelKey, group}`. Sirve también para generar los formularios.
  - Grupos: Encuentros (legendaryChance ≤ 0.05, shinyChance ≤ 0.02, condition/sound/team weights 1–5, baseWaveSize…), Captura (balls.mult 0.5–5, statusMult, counter.*, captureDamageScale), Energía (costBase, breakRecoverPct 0–1, potions), Acciones/Daño (pointsBase, divisores, techMult*, maxActivationChance ≤ 0.9), Economía (rewards.*, trainer.expPerMinute, progression.candy*), Ligas (weeklyThresholds, monthlyMultiplier).
- **`schema.ts`** (zod):
  - `ContentPatch` y `EventOverlay` en modo `strict()` (sin claves desconocidas).
  - `TechniqueDef` y `AbilityDef` como `z.discriminatedUnion('kind', …)` por cada `EFFECT_KINDS` de `src/engine/effect-types.ts`, con rangos.
  - `MissionDef` con `MISSION_KINDS`.
  - Textos `{es,en}` de 1–80 o 1–400 caracteres.
- **`validate.ts` → `{ errors[], warnings[] }`** (semántica sobre el ctx resuelto):
  - Las especies, movimientos e items referenciados existen (o están en placeholderItems / items del evento).
  - Los umbrales de liga son estrictamente crecientes; `wildLevelByTrainerLevel` está ordenado.
  - **Cobertura de apariciones:** para cada hora 0–23 × clima (lluvia/sol/nieve/despejado/null) × tramo de nivel, el pool no legendario tiene peso total > 0 y al menos 5 especies.
  - Ids de misión inmutables y sin cambio de kind respecto a la versión publicada.
  - `ctx.warnings` vacío.
  - **Smoke test:** unas 200 sesiones sintéticas deterministas con `startSession`/`completeSession`/`throwBall` y semillas fijas, sin excepciones ni NaN/Infinity en puntos, EXP, polvo, daño o energía.
  - **Guarda de cambio grande:** cualquier número que se multiplique o divida por más de 3 respecto a la base, o una probabilidad × 5, da un warning que exige marcar «confirmo» al publicar.
- El servidor valida **siempre** al guardar el borrador y al publicar (rechaza con 422 y la lista de errores). El cliente admin valida en vivo con el mismo código.

## 3. Imágenes de eventos (self-hosted)
- **Almacenamiento:**
  - Variable `UPLOADS_DIR` (por defecto `.data/uploads`) en `server/env.ts`.
  - `docker-compose.yml` añade el volumen `uploads:/app/.data/uploads`. El `Dockerfile` ya crea `.data` con dueño `node`.
- **Subida:** `POST /api/admin/uploads` con cuerpo binario crudo (`Content-Type: image/png|image/jpeg|image/webp`).
  - Es una excepción explícita al middleware que exige JSON, **solo para esa ruta**, y sigue comprobando el Origin.
  - `bodyLimit` propio de 3 MB.
- **Saneado:**
  - Se comprueban los magic bytes; no se acepta SVG, GIF ni HEIC.
  - Se decodifica y vuelve a codificar con **`sharp`** (tiene binarios para musl/alpine): quita EXIF/ICC, limita a 1600×900 como máximo, mínimo 320×180, y sale como WebP calidad 82. Un segundo tamaño de 480 px va a la tarjeta.
  - Se rechazan imágenes de más de 40 MP (`limitInputPixels`) para evitar bombas de descompresión.
  - El nombre del fichero es `sha256.webp`; el nombre original no se usa nunca. Si el sha ya existe, se reutiliza.
- **Servir:** `GET /media/events/:sha.webp`.
  - En producción y en desarrollo (no depende de `env.production`).
  - Valida `^[a-f0-9]{64}(-480)?\.webp$` y resuelve la ruta dentro de `UPLOADS_DIR`.
  - Cabeceras: `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`.
- **Limpieza:** una imagen no se borra si la referencia algún evento publicado. `DELETE /api/admin/uploads/:id` solo funciona con imágenes sin referencias. Límite de unas 500 MB en total, y 409 si se supera.

## 4. API admin y permisos

### Permisos
- `requireRole('support'|'admin')` va después de `requireAuth` (en `server/http.ts`).
  - `support`: Jugadores (leer, desbloquear, conceder con límite) y Métricas.
  - `admin`: todo.
- Las acciones sensibles (publicar, programar, rollback, conceder, cambiar roles) piden `elevated_until > now`, que se obtiene con `POST /api/admin/reauth {password}` y dura 30 min.
- Rate limit `adminUser` por usuario.
- **Arranque:**
  - `ADMIN_EMAILS` (env): al iniciar, se promueve a admin a esos correos.
  - CLI `npm run admin:role -- <email> <role>` (`scripts/admin-role.ts`).
- `ADMIN_TOKEN` se mantiene **solo** para `maintenance` en esta fase y se marca como obsoleto: en la auditoría aparece como `actor_label: 'token'`. Se elimina en la versión siguiente.
- **Auditoría:** helper `audit(tx, c, {action, targetType, targetId, before, after, note})` en `server/admin/audit.ts`, que se llama dentro de la misma transacción en **todas** las mutaciones de admin.

### Rutas
Están en `server/routes/admin/*.ts`, montadas en `/api/admin`. El JSON tiene un límite de 512 KB en `/content*` y `/events*`.

| Ruta | Rol | Qué hace |
|---|---|---|
| `GET /admin/me` | support | rol y estado del modo elevado |
| `POST /admin/reauth` | support | pide la contraseña y pone `elevated_until` |
| `GET /admin/content/live` | support | versión activa, hash, eventos activos y próxima programada |
| `GET /admin/content/versions?status=` | support | lista de versiones |
| `GET /admin/content/versions/:id` | support | patch, validación, diff contra su padre o contra la activa |
| `POST /admin/content/drafts` | admin | `{fromVersionId?}`: borrador nuevo copiado de la activa |
| `PUT /admin/content/drafts/:id` | admin | `{patch, title, note}`: valida (422 si hay errores) y guarda `validation` |
| `POST /admin/content/drafts/:id/validate` | admin | validación más smoke test |
| `POST /admin/content/drafts/:id/simulate` | admin | `{profiles, seeds≤20, weeks≤8}` → `simRunId` (worker; una ejecución a la vez, 409 `busy`) |
| `GET /admin/content/sim-runs/:id` | admin | estado e informe de la simulación |
| `POST /admin/content/drafts/:id/publish` | admin + elevado | `{effectiveAt?: now|futuro, confirmRisky}` |
| `POST /admin/content/versions/:id/unschedule` | admin + elevado | vuelve a borrador una versión programada |
| `POST /admin/content/versions/:id/rollback` | admin + elevado | publica ya una copia del patch indicado |
| `GET /admin/content/spawn-preview` | admin | `?versionId&eventId&hour&weather&trainerLevel` → tabla de probabilidades por especie |
| `GET/POST /admin/events`, `GET/PUT/DELETE /admin/events/:id` | admin | CRUD de eventos (DELETE solo en borrador; los publicados se archivan) |
| `POST /admin/events/:id/publish` | admin + elevado | publica el evento |
| `POST /admin/events/:id/archive` | admin + elevado | archiva el evento |
| `POST /admin/uploads` | admin | subida de imagen |
| `DELETE /admin/uploads/:id` | admin | borra imágenes sin referencias |
| `GET /admin/players?q=` | support | busca por email, nombre o friendCode (máx. 20 resultados) |
| `GET /admin/players/:id` | support | perfil, rol, bloqueos, resumen del documento (nivel, inventario, equipo, sesión activa, últimas 20 de `session_log`) |
| `POST /admin/players/:id/grant` | admin + elevado | `{items?, dust?, reason}` con topes por petición |
| `POST /admin/players/:id/unlock` | support | `{field: 'trainerName'|'country'|'timezone'}` |
| `POST /admin/players/:id/cancel-session` | support | cancela una sesión atascada |
| `POST /admin/players/:id/logout-all` | support | cierra todas sus sesiones |
| `PUT /admin/players/:id/role` | admin + elevado | cambia el rol |
| `GET /admin/metrics?from&to` | support | métricas de §5 |
| `GET /admin/audit?targetType&targetId&cursor` | support | registro de auditoría |
| Mantenimiento | — | se queda como está, aceptando el rol admin o el token |

- **Concesiones:** función pura `applyAdminGrant(doc, grant)` en `src/game/admin.ts`, que **no** forma parte de la unión `GameAction` de los clientes. Se aplica en la transacción con `SELECT … FOR UPDATE` sobre `player_docs`, `version+1` y `bus.publish(userId,{type:'game'})`, igual que `runGameAction`.
- **Públicas:**
  - `GET /api/content` y `GET /api/content/:hash` (§1).
  - `GET /api/live-events` → `{ active[], upcoming[] (próximos 60 días), past[] (cursor, 90 días), serverNow }`. Solo eventos publicados; nunca devuelve borradores.
- **Tipos** en `src/game/protocol.ts`: `ContentResponse`, `LiveEventPublic`, `Admin*` y `ServerEvent {type:'content'}`.

## 5. UI admin (`src/ui/screens/admin/`, chunk diferido, sin enlace en el menú salvo para el rol admin/support)

`Admin.tsx` pasa a ser un contenedor con pestañas. El login es la sesión normal, ya no hay token (salvo en Mantenimiento durante la transición). Las pestañas:

- **Resumen/Métricas:** DAU/WAU, sesiones y minutos al día, distribución de ligas de la semana, shinies y legendarios por cada 100 sesiones (desde `session_log`), comparación durante el evento frente a la semana anterior. Tarjetas y gráficas sencillas.
- **Contenido:** lista de versiones (activa, programadas, borradores, archivadas) y editor de borrador con subpestañas:
  - *Parámetros* (**formularios** generados desde `limits.ts`, agrupados, con el valor base al lado y el cambio en %).
  - *Especies* (**tabla**: sprite, nombre, tipos, captureRate, aparece sí/no, multiplicador de peso, horas y clima en una fila desplegable; filtros por tipo y etapa).
  - *Movimientos* (**tabla**: potencia y precisión).
  - *Técnicas* y *Habilidades* (**tabla** más **formulario** de detalle, con un editor de efectos por kind generado desde el discriminated union).
  - *Misiones* (**tabla** de diarias y semanales más formulario de detalle con escalones de recompensa; hitos de Pokédex).
  - *Ligas* (formulario).
  - **Flujo, con barra fija:** borrador (autoguardado) → **Validar** (errores con enlace al campo) → **Simular** (informe comparando la versión activa con la propuesta: puntos semanales por perfil, % por liga, shinies y legendarios por semana, sesiones hasta agotar la energía) → **Diff** → **Publicar ahora** o **Programar** (fecha en la zona del admin y en UTC) con reautenticación. En Versiones, **Rollback** («Republicar esta») y **Cancelar programación**.
- **Eventos:** lista (activos, programados, borradores, pasados) y **formulario**:
  - Nombre y descripción es/en, imagen (subida con vista previa recortada 16:9), inicio y fin.
  - **Tabla** de especies destacadas (selector y multiplicador 1–10).
  - Shiny del evento (probabilidad y alcance), multiplicador de legendario.
  - **Tabla** de drops (objeto, probabilidad por oleada, máximo).
  - Objetos propios del evento.
  - **Tabla** de misiones de evento.
  - Vista previa de la tarjeta tal como la ve el jugador, y **vista previa de apariciones** (llama a `spawn-preview`: probabilidad por especie sin evento y con evento, por hora y clima).
- **Jugadores:** buscador, ficha, acciones (conceder con motivo obligatorio, desbloquear, cancelar sesión, cerrar sesiones, rol).
- **Auditoría:** tabla filtrable con el diff de before y after.
- **Mantenimiento:** lo actual, sin cambios.

## 6. Eventos para jugadores y enganches en el motor

### Página de Eventos
- Ruta `events` en `src/ui/routes.tsx`, con `nav: true` e icono.
- `src/ui/screens/events/Events.tsx`: secciones «Activos», «Próximos» y «Pasados». Cada tarjeta lleva imagen 16:9, nombre, fechas en la zona del jugador, cuenta atrás, descripción, especies destacadas con sprite, «Shiny ×N», drops y misiones del evento (con progreso si está activo).
- `src/ui/store/liveEvents.ts`, que se refresca con el SSE `content`.
- **Banner** del evento activo en Home y PreSession.
- En `SessionReport`/`sessionReportModel.ts` se añade un factor «Evento X» a «por qué salieron esos salvajes».

### Enganches en `src/engine`
- **`src/engine/spawn.ts` (nuevo):**
  - `spawnMultiplier(sp, {localHour, weather, trainerLevel}, ctx)`: devuelve 0 si `enabled:false`, si la hora o el clima no encajan, o si `trainerLevel < minTrainerLevel`; si no, `weightMult` (ya incluye las destacadas).
  - `shinyChanceFor(sp, ctx)`: el máximo entre la base y el shiny de los eventos con el alcance correspondiente.
  - `legendaryChanceFor(ctx)`.
  - `spawnOdds(ctx, params)`, que se usa en la vista previa del admin y en tests.
- **`waves.ts`:**
  - En `speciesWeight`, `w *= spawnMultiplier(...)` solo si `ctx.spawn.has(slug)`.
  - En `rollWild`, l.247: `legendaryChanceFor(ctx)`. El `pick(legendaryPool)` pasa a `weightedPick` por `spawnMultiplier` solo si hay entradas de spawn para legendarios.
  - En l.256: `shinyChanceFor(sp, ctx)`.
  - `RollWildParams` gana `env?: {localHour, weather}`, que `session.ts` ya tiene en `EncounterState.env`.
  - Son cambios de 4–6 líneas para chocar lo menos posible con la fase A.
- **`session.ts` `completeSession`:** tras las recompensas (l.1074–1075), `rollEventDrops(sessionId, waves, ctx)` con RNG derivado. Se añade a `SessionResult.rewards.items` y se aplica en `applySessionResult` (l.1121).
- **`missions.ts`:**
  - `MissionPeriod` suma `'event'`.
  - `MissionsState.event?: Record<eventId, {rev, slots}>` con ids `e:<eventId>:<defId>`.
  - `refreshMissions` crea los slots de los eventos activos en `ctx.events` (lista fija, sin sorteo) y conserva los de eventos terminados hasta `endsAt + 7d`.
  - `recordMissionEvent` avanza también los de evento si el evento está en `ctx.events` (es decir, activo al empezar la sesión fijada).
  - `claimMission` acepta `e:`.
  - `missionsView` añade el grupo `event` y `Missions.tsx` lo muestra.
- **`context.ts`:** campos `contentHash`, `spawn` y `events`, más `setDefaultContext`.

## 7. Entregas (paralelizables) con dependencias y modelo

| # | Entrega | Archivos principales | Depende de | Modelo |
|---|---|---|---|---|
| E0 | Contenido en el motor: `content.ts` (tipos y `resolveContent`), campos nuevos en `EngineContext`, `setDefaultContext`, `meta.json` con baseHash en `build-data`, tests de oro «patch vacío = base» | `src/engine/content.ts`, `context.ts`, `config.ts`, `scripts/build-data.ts`, `src/data/game/meta.json` | — | opus |
| E1 | Validación: `limits.ts`, esquemas zod, `validate.ts` con cobertura de apariciones y smoke test | `src/game/content/*` | E0 | opus |
| E2 | Roles y auditoría: migración 0005, `requireRole`, reautenticación, `audit()`, `ADMIN_EMAILS`, CLI, mantenimiento con rol | `server/http.ts`, `server/db/schema.ts`, `server/admin/audit.ts`, `server/routes/admin.ts`, `server/env.ts`, `scripts/admin-role.ts` | — | sonnet |
| E3 | ContentService y fijado: migración 0006, `/api/content(/:hash)`, `contentHash` en ActiveSession/Encounter, ctx por acción en `runGameAction`, broadcast y tick, test de fijado | `server/content/service.ts`, `server/routes/content.ts`, `server/routes/game.ts`, `src/game/actions.ts`, `src/engine/state.ts`, `server/events.ts`, `server/index.ts` | E0 (**rebase tras A y D**, que tocan state.ts) | opus |
| E4 | Cliente en vivo: `store/content.ts`, refactor de los unos 35 `defaultContext()` del nivel de módulo, `useSessionContext`, remontaje por hash y aviso de base desfasada | `src/ui/store/content.ts`, `src/ui/**` | E0 (puede usar un endpoint simulado) | sonnet |
| E5 | API admin de contenido: borradores, validación, diff, publicar, programar, rollback y spawn-preview | `server/routes/admin/content.ts`, `src/game/protocol.ts` | E1, E2, E3 | sonnet |
| E6 | UI admin de contenido: contenedor con pestañas, formularios desde `limits`, tablas, flujo de publicación y versiones | `src/ui/screens/admin/*`, `src/ui/api/endpoints.ts` | contratos de E5 (puede empezar con mocks), E1 | sonnet |
| E7 | Enganches de eventos en el motor: `spawn.ts`, waves (peso, shiny, legendario), drops con RNG derivado, misiones de evento | `src/engine/spawn.ts`, `waves.ts`, `session.ts`, `missions.ts` | E0, **después de fusionar A** (waves/capture/energía) | opus |
| E8 | Backend de eventos: migración 0007, subidas con sharp, `/media`, CRUD admin de eventos, `/api/live-events`, eventos en la resolución de ContentService | `server/routes/admin/events.ts`, `server/routes/liveEvents.ts`, `server/uploads.ts`, `docker-compose.yml` | E2, E3 | sonnet |
| E9 | UI de eventos: página `#/events`, banner, grupo de misiones de evento, editor admin con vista previa de apariciones | `src/ui/screens/events/*`, `src/ui/screens/admin/events/*`, `Missions.tsx` | E8, E7 | sonnet |
| E10 | Simulación desde admin: worker_threads con `runMatrix` de `scripts/sim` sobre el ctx resuelto (activa contra propuesta), migración parcial 0008 (`content_sim_runs`), copiar `scripts/sim` en el `Dockerfile`, timeout 5 min y cola de 1 | `server/content/simWorker.ts`, `scripts/sim/experiments.ts`, `Dockerfile` | E0, E5 | opus |
| E11 | Soporte de jugadores: búsqueda, ficha, `applyAdminGrant`, desbloqueos, cancelar sesión, cerrar sesiones | `server/routes/admin/players.ts`, `src/game/admin.ts`, UI `admin/players` | E2 | sonnet |
| E12 | Métricas: `session_log` (0008) escrito en el claim, `/admin/metrics`, panel | `server/routes/game.ts`, `server/routes/admin/metrics.ts`, UI | E2 (y E3 para `content_hash`) | sonnet |
| E13 | Documentación: `docs/server.md` (API y variables de entorno), `docs/admin.md` (flujo y límites), `docs/engine-api.md` (content, spawn), GDD, PENDING | docs | todas | sonnet/haiku |

**Oleadas:**
1. E0, E2.
2. E1, E3, E4, E11, E12.
3. E5, E8, y E7 cuando A esté fusionada.
4. E6, E9, E10.
5. E13.

E4 y E6/E9 tocan la UI en paralelo: asignar a E4 solo el refactor del contexto, y que E6 y E9 trabajen en carpetas nuevas.

### Riesgos
- **Conflicto con A** en `waves.ts`/`capture.ts`/`session.ts`/`energy.ts`: E7 va después de A y con cambios mínimos en helpers de `spawn.ts`. Las claves nuevas de A (`capture.counter.damageMult`, energía) tienen que entrar en `limits.ts` al fusionar.
- **Conflicto con D** en `state.ts` (motes, equipos guardados): E3 añade solo dos campos opcionales; se rebasa.
- **Migraciones:** numeración y journal se generan en serie, con una sola persona que las genere.
- **Coste de la simulación** en el VPS: limitar semillas y semanas, una ejecución a la vez y fuera del hilo principal. La comparación activa/propuesta duplica el coste.
- **Cliente con contexto desfasado:** el servidor manda, así que solo afecta a la presentación. El SSE y el ETag lo corrigen.
- **Instancia única:** el tick, el LRU y el bus en memoria asumen una sola instancia (ya es así en push y grupos).
- **Rendimiento de `current()`:** se memoriza por clave y la resolución es O(especies). Hacerlo en cada acción es barato.
- **Seguridad:**
  - Rol en la BD y reautenticación para lo crítico.
  - Excepción de CSRF solo para subidas.
  - `sharp` vuelve a codificar las imágenes y `/media` las sirve sin HTML.
  - Los borradores nunca salen por los endpoints públicos.
  - Auditoría en la misma transacción.
- **Balance:** el validador evita romper el juego, pero no evita lo absurdo. La guarda de cambio > ×3 con confirmación y la simulación obligatoria (aviso si se publica sin simulación reciente) lo mitigan.

### Critical Files for Implementation
- /home/jorughen/Projects/PokeFocus/src/engine/context.ts
- /home/jorughen/Projects/PokeFocus/src/engine/waves.ts
- /home/jorughen/Projects/PokeFocus/src/engine/missions.ts
- /home/jorughen/Projects/PokeFocus/server/routes/game.ts
- /home/jorughen/Projects/PokeFocus/server/db/schema.ts

Otros relevantes: /home/jorughen/Projects/PokeFocus/src/game/actions.ts, /home/jorughen/Projects/PokeFocus/src/engine/state.ts, /home/jorughen/Projects/PokeFocus/src/engine/session.ts, /home/jorughen/Projects/PokeFocus/server/routes/admin.ts, /home/jorughen/Projects/PokeFocus/server/app.ts, /home/jorughen/Projects/PokeFocus/src/ui/store/game.ts, /home/jorughen/Projects/PokeFocus/scripts/sim/experiments.ts, /home/jorughen/Projects/PokeFocus/Dockerfile, /home/jorughen/Projects/PokeFocus/docker-compose.yml