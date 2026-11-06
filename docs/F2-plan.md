# F2 — Servidor propio, cuentas, amigos y rankings

Decisiones del usuario (2026-11-04):
- **Servidor propio**, no Supabase: Node + Hono + PostgreSQL (Drizzle). En desarrollo, PGlite embebido (sin Docker); en producción, PostgreSQL vía `DATABASE_URL` y `docker compose`.
- **Solo correo + contraseña.**
- **Sesión opaca en cookie `HttpOnly`**, no JWT.
- **Rankings:** global, por país (elegido al registrarse) y de amigos; semanal y mensual.
- **El progreso vive en el servidor:** cada acción es una petición; al iniciar sesión se carga desde la BD. La partida local del prototipo no se migra (todos empiezan de cero).
- **Varias sesiones de login** a la vez (pestañas, dispositivos); **una sola sesión de estudio activa** por usuario.

## Arquitectura

```
navegador (React)  ──fetch /api/* (cookie pf_session)──▶  server/ (Hono, Node)
      ▲                                                     │  src/engine (mismo código)
      └──────────── SSE /api/events (game, friends) ◀───────┤  src/game/actions.ts (reducer)
                                                            ▼
                                                PostgreSQL / PGlite (Drizzle)
```

- `src/game/protocol.ts` — **contrato** compartido (tipos de acciones, respuestas, payloads).
- `src/game/actions.ts` — **reducer puro** `applyAction(doc, action, { now, rng, dev }) → { doc, result } | { error }`. Es la lógica que antes vivía en `src/ui/store/game.ts`, sin zustand. Solo lo ejecuta el servidor.
- `server/` — Hono: auth, game, friends, leaderboard, events. Arranca con `tsx`.
- En desarrollo, Vite hace proxy de `/api` a `http://localhost:8787`. `npm run dev` levanta ambos.

## Seguridad (confirmada al usuario)

| Tema | Implementación |
|---|---|
| Contraseñas | `crypto.scrypt` (N=2^15, r=8, p=1, 64 bytes) con sal aleatoria de 16 bytes; formato `scrypt$N$r$p$salt_b64$hash_b64`; comparación con `timingSafeEqual`. 8–128 caracteres. Nunca en logs. |
| Login sin enumeración | Mismo error (`invalid_credentials`) y mismo tiempo: si el correo no existe se verifica contra un hash ficticio. |
| Token de sesión | 32 bytes de `crypto.randomBytes` (base64url). En BD solo `sha256(token)`. Nuevo token en cada login (evita fijación de sesión). |
| Cookie | `pf_session`; `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` cuando `NODE_ENV=production`; `Max-Age` 30 días. |
| Caducidad | 30 días deslizantes: si `last_seen_at` tiene más de 24 h se renueva `expires_at`. Sesiones caducadas se borran. |
| Revocación | Logout borra la fila. Cambio de contraseña borra todas las demás sesiones. "Cerrar sesión en todos los dispositivos". Lista de sesiones en Ajustes. |
| CSRF | En toda petición no-GET: `Origin` debe estar en `APP_ORIGIN` (lista separada por comas). Además `SameSite=Lax` y JSON obligatorio (`Content-Type: application/json`). |
| Fuerza bruta | Rate limit en memoria: login 10/15 min por IP y 5/15 min por correo; registro 5/h por IP. Respuesta 429 con `Retry-After`. |
| Validación | zod en todos los cuerpos. Correos normalizados (trim + minúsculas). Límite de tamaño de cuerpo (64 KB). |
| SQL | Solo Drizzle (consultas parametrizadas). |
| Autoridad | Tiradas, puntos, capturas y tiempo los decide el servidor. Cabeceras `x-dev-now` / `x-dev-seed` y acciones `dev*` solo con `DEV_TOOLS=1` (nunca en producción). |
| Cabeceras | `secureHeaders()` de Hono. |

## Esquema (Drizzle, `server/db/schema.ts`)

- `users` — `id uuid pk`, `email text unique` (minúsculas), `password_hash text`, `trainer_name text` (3–20, letras/números/espacio/_), `country char(2)`, `friend_code text unique` (8 chars, alfabeto sin 0/O/1/I), `created_at timestamptz`, `trainer_name_changed_at timestamptz null` y `country_changed_at timestamptz null` (último cambio; null = nunca), `anonymous_rankings boolean default false`.
- `auth_sessions` — `id uuid pk`, `user_id fk on delete cascade`, `token_hash text unique`, `created_at`, `last_seen_at`, `expires_at`, `user_agent text null`. Índice por `user_id`.
- `player_docs` — `user_id pk fk`, `doc jsonb` (`GameDoc`), `version int`, `updated_at`.
- `active_study_sessions` — `user_id pk fk`, `session_id text`, `started_at`. **Unicidad = una sesión de estudio por usuario.** Se inserta en `start` y se borra en `claim`/`cancel`, en la misma transacción que el doc.
- `league_scores` — `user_id fk`, `period ('week'|'month')`, `period_key text`, `points int`, `updated_at`; PK `(user_id, period, period_key)`; índice `(period, period_key, points desc)`. Se actualiza tras cada acción que cambie `player.league.*Points`.
- `friendships` — `requester_id`, `addressee_id`, `status ('pending'|'accepted')`, `created_at`; PK `(requester_id, addressee_id)`; restricción `requester_id <> addressee_id`.

Escrituras del doc: transacción con `SELECT … FOR UPDATE` sobre `player_docs` → `applyAction` → `UPDATE … version = version + 1`. Así dos pestañas nunca se pisan.

## API

Todas bajo `/api`, JSON, cookie `pf_session`. Errores: `{ error: string }` con 400 (validación), 401 (sin sesión), 403 (origen / dev), 404, 409 (regla del juego), 429.

**Auth**
- `POST /auth/register` `{ email, password, trainerName, country }` → 201 `{ user: PublicUser }` + cookie.
- `POST /auth/login` `{ email, password }` → `{ user }` + cookie.
- `POST /auth/logout` → 204. `POST /auth/logout-all` → 204.
- `GET /auth/me` → `{ user }` | 401.
- `PATCH /auth/me` `{ trainerName?, country?, anonymousRankings? }` → `{ user }`. Cambiar el nombre o el país bloquea ese campo 30 días (cada uno por separado): 409 `name_locked` / `country_locked` con `{ unlockAt }`; reenviar el valor actual no cambia nada. `DEV_TOOLS=1` ignora el bloqueo. Detalle en `docs/server.md`.
- `POST /auth/password` `{ current, next }` → 204 (revoca las demás sesiones).
- `GET /auth/sessions` → `{ sessions: AuthSessionInfo[] }`. `DELETE /auth/sessions/:id` → 204.

**Juego**
- `GET /game` → `GameSnapshot`.
- `POST /game/action` `GameAction` → `ActionResponse` | 409 `{ error }`.

**Amigos**
- `GET /friends` → `{ friends: FriendSummary[] }` (aceptados + solicitudes entrantes/salientes).
- `POST /friends/request` `{ friendCode }` → 201. Si ya existe una solicitud inversa pendiente, se acepta directamente.
- `POST /friends/:userId/accept` → 204. `DELETE /friends/:userId` → 204 (rechazar, cancelar o eliminar).

**Rankings**
- `GET /leaderboard?scope=global|country|friends&period=week|month` → `LeaderboardResponse` (top 100 + fila propia). `periodKey` = clave actual del jugador que consulta. Con `anonymousRankings`, en `global` y `country` la fila de ese usuario lleva `trainerName: null` salvo la propia; `anonymous` va en todas las filas.

**Eventos**
- `GET /events` (SSE) → `ServerEvent`: `game` (otra pestaña cambió el doc), `friends` (solicitud nueva/aceptada), `logout` (sesión revocada). Ping cada 25 s.

## Cliente

- `src/ui/api/` — cliente `fetch` (`credentials: 'include'`, cabeceras dev cuando el panel lo pide, errores tipados).
- Store de auth (`useAuth`): `status: 'loading' | 'anon' | 'authed'`, `user`.
- `useGame` pasa a ser una caché del `GameDoc` del servidor: acciones `async` que llaman a `/game/action` y reemplazan el doc con la respuesta; versión para descartar respuestas viejas; SSE para sincronizar pestañas. Ya no persiste en `localStorage` (las preferencias sí).
- Pantallas nuevas: inicio de sesión / registro (con país), Amigos, Rankings (pestañas en Liga), Cuenta en Ajustes (cambiar contraseña, sesiones, cerrar sesión).
- Panel dev: el reloj acelerado y la semilla viajan como cabeceras; el servidor las acepta solo con `DEV_TOOLS=1`.

## Cómo correr

```bash
npm run dev            # Vite (5173) + API (8787) con PGlite en .data/pglite y DEV_TOOLS=1
npm run db:generate    # nueva migración tras cambiar server/db/schema.ts
docker compose up      # producción local: PostgreSQL + app (cuando haya Docker)
```

## Notas de implementación (backend, 2026-11-04)

Detalle completo en `docs/server.md`. Diferencias o precisiones respecto a lo de arriba:

- **`createPlayer`**: el cliente no envía `trainerName`; el servidor pasa el nombre de la cuenta al reducer (`ActionEnv.trainerName`). `PATCH /auth/me` con `trainerName` también lo actualiza dentro del doc (sube `version` y emite `game`).
- **Códigos HTTP**: login fallido → 401 `invalid_credentials`; contraseña actual incorrecta en `POST /auth/password` → 403 `wrong_password`; acciones `dev*` sin `DEV_TOOLS` → 403 `dev_disabled`; cuerpo > 64 KB → 413 `body_too_large`; sin `Content-Type: application/json` → 415 `json_required` (en **todas** las peticiones no-GET, también las que no llevan cuerpo).
- **Reducer**: `pause`/`resume` repetidos son idempotentes; `pause` después de `endsAt` → `already_finished`; sin sesión → `no_session`; `startBreak` dos veces para la misma sesión → `already_claimed`. Nuevo error de motor `already_has_status` (una carga de sueño/parálisis ya no se gasta en un salvaje que ya tiene estado).
- **`league_scores`**: en lugar de recalcular solo las claves actuales, se comparan los mapas `weeklyPoints`/`monthlyPoints` antes y después de la acción y se hace upsert de toda clave que cambió (cubre la clave usada por el motor al reclamar, aunque cambie la semana entre inicio y reclamo). `resetAll` (dev) borra las puntuaciones del usuario.
- **`active_study_sessions`**: se sincroniza con `player.activeSession` en la misma transacción (insert al aparecer una sesión nueva, delete al desaparecer). Un segundo `start` con el doc ya en sesión responde 409 `session_active` (lo detecta el motor bajo `FOR UPDATE`); `session_active_elsewhere` solo aparece si la tabla ya tiene una fila para el usuario.
- **Rankings**: solo filas con puntos > 0; empates comparten puesto (1, 2, 2, 4) y se listan por quién llegó primero (`updated_at`). Las claves de semana son las del motor (lunes local, p. ej. `2026-11-02`), no `2026-W45`.
- **`POST /friends/request`** → 201 `{ userId, status: 'outgoing' | 'friend' }`; máximo 200 relaciones por usuario.
- **Variables nuevas**: `TRUST_PROXY` (IP real detrás de Caddy para el rate limit) y `STATIC_DIR` (cliente compilado en producción). `tsx` pasa a `dependencies` porque `npm start` lo usa en producción.
- **Rate limit de login**: cuenta intentos (no solo fallos); un login correcto reinicia el contador del correo.
