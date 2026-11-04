# Pendientes — checkpoint 2026-11-03

Estado del repo al cerrar la sesión y qué falta, para que un agente nuevo pueda continuar sin contexto previo.

## Lee primero

1. `docs/GDD.md`: diseño completo del juego (fuente de verdad).
2. `docs/effects.md`: primitivas de efecto de técnicas y habilidades (contrato del motor).
3. `docs/engine-api.md`: API pública del motor.
4. `docs/ux-research.md`: investigación para el frontend (onboarding contextual, temporizador, fuentes pixel, sprites).
5. `.claude/skills/frontend-design/SKILL.md` y `.claude/skills/webapp-testing/SKILL.md`: skills oficiales de Anthropic instaladas en el proyecto.

## Hecho (estable, verificado)

`npm run typecheck`, `npm test` (77 tests) y `npm run build` pasan.

| Pieza | Dónde | Notas |
|---|---|---|
| Scaffold | raíz | Vite + React 19 + TS strict + Tailwind v4 + i18next + zustand + vitest + tsx |
| Importación de PokeAPI | `scripts/import-pokeapi.ts` → `data/generated/` | 56 especies del Pack 1, 428 movimientos, 51 habilidades, tabla de tipos, naturalezas, objetos. La caché (`data/cache/`) está en `.gitignore`; `npm run import:pokeapi` la regenera |
| Fusión con overrides | `scripts/build-data.ts` → `src/data/game/` | `npm run build:data`. Los overrides van en `data/overrides/`; los `custom-*.json` se copian tal cual |
| Contenido y balance inicial | `data/overrides/` | `custom-game-config.json` (todos los parámetros [calibrar]), `custom-techniques.json` (41 técnicas), `custom-abilities.json` (49 habilidades, todas las del Pack 1), `species.json` (rol de cada especie + ajustes de stats) |
| Sprites locales | `public/sprites/` | Iconos de caja (gen VII), Showdown animados normales y shiny, objetos. `npm run download:sprites` |
| Motor del juego | `src/engine/` | TS puro, determinista con semilla. Sesiones, oleadas, captura con contraataques, energía, progresión, ligas, efectos, condiciones de tipo. Incluye el desbloqueo por nivel de los movimientos extra |

## Pendiente

### 1. Frontend del prototipo (F1) — prioridad alta, apenas empezado

El agente del frontend se detuvo al principio. Solo dejó instaladas estas dependencias en `package.json`: `@floating-ui/react-dom`, `@fontsource/pixelify-sans`, `@fontsource/jersey-10`, `@fontsource/atkinson-hyperlegible-next`. No hay pantallas: `src/ui/App.tsx` sigue siendo el placeholder del scaffold. **Hay que empezar el frontend desde cero** con este encargo:

- Seguir el proceso de `frontend-design`: plan de diseño con tokens → revisión contra el brief → construcción → crítica con capturas de pantalla.
- Solo local: estado del motor (`PlayerState`) persistido con zustand `persist`. Sin backend.
- ES/EN con i18next. Los nombres de Pokémon, técnicas, habilidades, naturalezas y tipos salen de los datos.
- Sprites locales: `/sprites/icons/{id}.png` para la caja; `/sprites/showdown/{id}.gif` y `/sprites/showdown-shiny/{id}.gif` para la sesión, la pantalla previa, los salvajes y la ficha; `/sprites/items/{slug}.png` para objetos. Escalado entero con `image-rendering: pixelated`.
- Las estadísticas se muestran con los nombres de PokeFocus, nunca con los originales (GDD §5.1): Energía, Ritmo, Rendimiento, Captura, Técnica, Aguante. Cada una lleva un tooltip con "basada en X".
- **Pantallas:**
  - primer inicio con elección de inicial;
  - inicio/pre-sesión: equipo, energía, condiciones activas ahora, liga, preajustes y selector manual de clima;
  - sesión activa;
  - Reclamar y resultados con el "por qué" de los puntos;
  - oleadas y captura: vida tras el daño, Ball de Estudio, contraataques y huida;
  - caja;
  - ficha del Pokémon: huecos de técnica, Dominio, caramelos, evolucionar, soltar, movimientos extra bloqueados "se desbloquea al nivel X";
  - editor de equipo con líder;
  - Pokédex con el siguiente límite de nivel;
  - liga y estadísticas;
  - ajustes;
  - **panel de desarrollo** (`?dev`): tiempo acelerado (1 min = 1 s), terminar la sesión ya, etiqueta de Foco simulada, añadir Balls/Polvo/caramelos, semilla fija.
- **La app debe enseñarse sola** (petición explícita del usuario): motor de pistas con id, disparador y "vista" persistida, nunca durante la sesión, y un tope por pantalla. Además: la primera oleada guiada, estados vacíos que enseñan, y un "?" en los widgets complejos.
- **Temporizador** según `docs/ux-research.md`: `endsAt` persistido, completado idempotente, Notification al terminar.
- **Verificación:** recorrer el flujo completo con Playwright (`npx playwright`, instalar chromium si falta) usando el tiempo acelerado. Capturas en ES y EN.

### 2. Simulador de balance (F0) — prioridad alta, no empezado

- Crear `scripts/simulate.ts` (script npm `simulate`) usando solo la API pública del motor (`createEngineContext` para sobrescribir la config y `createRng(seed)`).
- **Perfiles:** casual, constante (4×25/día), maratonista (2×100/día), noctámbulo (3×50 desde las 21–23 h), irregular y "grinder" (14 h/día, para probar el antitrampas). Unas 20 semillas por perfil, 12 semanas.
- **Políticas automáticas razonables:** capturas, elección de equipo, caramelos, evoluciones y soltar duplicados.
- **Salida:** `docs/balance-report.md`, con:
  - umbrales de liga recomendados;
  - nivelado frente a los objetivos del GDD §12.1 (nv. 10 ≈ día 1, nv. 30 ≈ 3 semanas, nv. 50 ≈ 3 meses en el perfil constante);
  - economía (Balls, Polvo, caramelos, tasa de captura);
  - legendarios vistos y capturados (objetivo: 1–3 en 3 meses para el perfil constante);
  - frecuencia de agotamiento por perfil;
  - **"valor de estudio" de las 56 especies** a nivel 30 y 50, con las atípicas marcadas;
  - cobertura de las condiciones de tipo;
  - lista de cambios concretos (ruta de config: valor actual → propuesto, con su motivo).
- Un test de humo determinista (1 semana, 1 semilla).

### 3. Calibración (después del simulador)

El responsable del proyecto aplica las recomendaciones del informe en `data/overrides/` (config y `species.json`), ejecuta `npm run build:data` y vuelve a simular hasta que no queden especies fuera de banda (GDD §20.1).

### 4. Decisiones del motor que conviene revisar con el usuario

Tomadas por el agente del motor ante huecos del GDD (detalle en `docs/engine-api.md`):
- La Energía de captura no se escala con el Foco ni con la condición de tipo.
- El bono de rareza de las sesiones largas aplana la distribución con `captureRate^(1/boost)`.
- Los legendarios que rondan sustituyen un hueco de la primera oleada.
- Un legendario shiny no tiene captura asegurada.
- Los Pokémon dormidos por Descanso no aportan efectos de equipo.
- La EXP por encima del límite de nivel se guarda y se aplica cuando sube el límite.
- Los números que faltaban en la config están en `ENGINE_DEFAULTS` (`src/engine/config.ts`): pociones, curva de nivel de entrenador, ventana de madrugada…

### 5. Contenido conocido a revisar

- Abra (solo Teletransporte) y Metapod (solo Fortaleza, que no existe en el juego) no tienen técnica de daño: generan Energía Normal al 50%. Es intencionado, pero conviene confirmarlo con el usuario.
- Meditación, Bostezo, Descanso, Deseo, Campana Cura, Arraigo y Bloqueo solo se obtienen como movimientos extra (huevo, tutor o MT), nunca por nivel.

### 6. Fases posteriores (GDD §20)

- **F2:** Supabase (cuentas, amigos, sesiones y tiradas en el servidor, rankings de amigos, zona y global).
- **F3:** Foco real (capturas de pantalla con Claude Haiku 5.5, micrófono).
- **F4:** progresión profunda.
- **F5:** intercambios y más packs.
- **graphify:** generar el grafo de conocimiento del código cuando el frontend exista (`/graphify`).
