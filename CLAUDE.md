# PokeFocus

App web de estudio (pomodoro) que recompensa con Pokémon. React + Vite + TS + Tailwind (cliente), Node + Hono + PostgreSQL/Drizzle (servidor, PGlite en dev), motor de juego puro y determinista. Proyecto personal; el usuario habla español.

## Para continuar un trabajo
Lee solo la sección **«▶ Para continuar»** de `docs/PENDING.md`. El historial está en `docs/archive/PENDING-history.md` (buscar con `grep`, no leer entero).

## Comandos
- `npm run dev` (app 5173 + API 8787, `?dev` = panel de desarrollo), `npm run typecheck`, `npm run build`
- Tests: `npx vitest run --maxWorkers=2 [ruta]`. **Siempre `--maxWorkers=2`** (con más se agota la memoria). Para un cambio acotado, corre solo los tests de esa carpeta.
- Simulador de balance: `npm run simulate` (escribe `docs/balance-report.md`)
- Contenido para el admin: `npm run admin:validate`, `npm run admin:schema`

## Estructura
- `src/engine/`: motor puro (sesiones, capturas, daño, misiones, ligas). Sin imports circulares (`no-cycles.test.ts`).
- `src/game/`: acciones, protocolo cliente-servidor, grupos, clima.
- `src/ui/`: pantallas y componentes; `src/ui/changelog/entries.ts` = novedades por versión.
- `src/i18n/`: textos ES/EN. Todo texto visible va en los dos idiomas.
- `server/`: `routes/`, `db/schema.ts` + `db/migrations`, `admin/`, `push.ts`, `events.ts`.
- `scripts/`: importación, simulador, arte pixel, admin.

## Documentos: qué leer según el tema (no los leas enteros)
Usa `grep -n` o rangos de líneas. Pesan 20-90 KB cada uno.
- Reglas del juego y balance → `docs/GDD.md` (fuente de verdad)
- API del motor, daño, misiones → `docs/engine-api.md`; efectos de técnicas/habilidades → `docs/effects.md`
- Servidor, API, variables de entorno → `docs/server.md`
- Sistema de diseño y componentes → `docs/ui-foundation.md`
- Admin y eventos → `docs/admin.md`, `docs/admin-plan.md`; importar JSON → `docs/admin-json.md`
- Números de balance → `docs/balance-report.md`; QA → `docs/qa-report.md`
- Estructura del código ya indexada: `graphify-out/GRAPH_REPORT.md` (puede estar desactualizado; compara con `git rev-parse HEAD`).

## Ahorro de tokens (para el agente)
- Al terminar una tarea grande o cuando la conversación ya es larga, di una línea al usuario: «tarea cerrada: conviene `/clear` (o `/compact` si sigue el mismo tema) y `/usage` para ver el gasto». No lo repitas en cada turno.
- Si el usuario cambia de tema a algo no relacionado en una sesión ya larga, sugiérele `/clear` antes de seguir.
- No explores a ciegas: usa el mapa de arriba, `grep` y lecturas por rango. No releas archivos que ya tienes en contexto ni los que acabas de editar.
- Los docs grandes (`GDD`, `server`, `balance-report`, `ui-foundation`, `engine-api`) se leen por sección, nunca enteros.
- Tareas pequeñas o mecánicas (JSON de admin, textos, un cambio en un archivo): hazlas directamente, sin subagentes ni planes largos. Respuestas cortas: sin repetir lo ya dicho ni resumir lo que muestra el diff.
- Subagentes: solo si la tarea es grande y separable. Prompt con los archivos exactos, resultado esperado y límite de alcance; modelo barato para lo mecánico.
- El nivel de esfuerzo no se controla desde aquí: si una tarea es trivial, recuerda al usuario que puede bajarlo con `/effort`.

## Reglas del proyecto
- **Nunca tocar ni volver a añadir `PASSWORD_PEPPER`** en producción. Al responder sobre despliegue, recuérdalo.
- Cada versión nueva: entrada en `src/ui/changelog/entries.ts` y subir `version` en `package.json` (hay un test que lo comprueba).
- Contenido o eventos descritos en el chat: generar JSON de importación validado (`docs/admin-json.md`); nunca publicarlo.
- Descripciones de eventos: dicen la probabilidad real calculada por el motor; avisa de las especies que no pueden aparecer. No cambiar los multiplicadores de destacadas sin pedirlo.
- Frontend nuevo: debe verse bien y usar los componentes del juego, sin widgets nativos; comprobar a 390 y 1280 px (skill `frontend-design`).
- Trabajo grande: subagentes en paralelo, **máximo 2 a la vez**, modelo según la tarea (el barato para lo mecánico). Cada subagente recibe los archivos exactos y una tarea acotada.
- Antes de commitear: `npm run typecheck` y los tests del área tocada.
