# Plan — profundidad de la sesión (2026-11-05)

Decisiones del usuario del 2026-11-05 y reparto del trabajo entre agentes.
`docs/PENDING.md` resume el estado y este documento es la especificación.
Los textos visibles van en ES y EN (`src/i18n/locales/{es,en}.json`).

## Reglas comunes para todos los paquetes

- El servidor manda. Las reglas viven en el motor (`src/engine/`) y en el reducer (`src/game/actions.ts`). El cliente solo muestra y envía acciones (`docs/F2-plan.md`).
- Las partidas guardadas existentes deben seguir cargando. Los campos nuevos del `GameDoc`/`PlayerState` son opcionales o tienen un valor por defecto al leerlos.
- Cada acción nueva necesita lo siguiente:
  - su tipo en `src/game/protocol.ts` (`GameAction` y `ActionResults`);
  - validación en `server/validation.ts`;
  - su rama en el reducer;
  - helper en `src/ui/store/game.ts`;
  - tests.
- **Claves de i18n:** cada paquete añade sus claves bajo su propio espacio de nombres (ver cada paquete) para no chocar al integrar.
- **No se rompe la interfaz actual.** Lo que hoy se ve bien se queda. El detalle nuevo va detrás de un botón, un tooltip o un panel desplegable. En móvil, los tooltips se abren con un toque.
- **Antes de terminar:** `npm run typecheck` y `npm test` en verde. Haz commit en tu rama del worktree, con mensajes en inglés.
- **No arranques servidores en los puertos 8787 ni 5173**, que están ocupados. Si necesitas probar en el navegador, usa `PORT=8790` y `vite --port 5180`, y apágalos al terminar.

## A — Reparto del daño por Pokémon, más "Auto"

**Hoy:** al reclamar, cada acción de daño de la sesión golpea a un salvaje al azar, ponderado por PS máximos (`assignHits` en `src/engine/session.ts`). El jugador no decide nada.

**Decisión:**

- **Fichas de daño.** En cada oleada, cada Pokémon del equipo que hizo daño en ese bloque es una **ficha**. En la ficha se ven su icono y "×N", con N calculado como hoy en `hittersOf`. Al pasar el ratón o tocarla, un tooltip muestra los ataques que la componen, por ejemplo "Látigo Cepa ×6 · Placaje ×3", y el daño estimado contra el salvaje elegido, con la efectividad de tipo.
- **Asignar.** Tocas una ficha y luego un salvaje, y todo el daño de esa ficha va a ese salvaje. Se puede reasignar libremente **hasta lanzar la primera Ball de la oleada**. En ese momento la oleada queda bloqueada, y las fichas sin asignar se asignan automáticamente con el reparto de hoy, ponderado por PS máximos.
- **Daño desperdiciado.** El daño por debajo de `capture.minHpFraction` se pierde, como hoy. La interfaz debe hacerlo visible, p. ej. "sobra daño".
- **Botón Auto en la oleada.** Reparte las fichas que queden sin asignar con el algoritmo de hoy. Es para quien tiene prisa.
- **Preferencia "Auto"** (`PlayerState.autoDamage`, `false` por defecto; los documentos antiguos se leen como `false`):
  - se puede cambiar antes de la sesión (PreSession), durante (FocusSession) y en la pantalla de Reclamar, con la acción `setAutoDamage { value }`;
  - al reclamar se copia en `EncounterState.damageMode: 'auto' | 'manual'` y ya no se puede cambiar para ese encuentro;
  - en modo `auto` todo funciona como hoy, sin pantalla de asignación.
- **Acciones nuevas:**
  - `assignDamage { waveIndex, uid, wildIndex | null }`;
  - `autoAssignDamage { waveIndex }`;
  - `setAutoDamage { value }`.
- **Estados y cambios de salvaje.** Aplicar Sueño o Parálisis no bloquea la oleada. Si una carga de cambio sustituye a un salvaje, el daño asignado a esa posición pasa al nuevo salvaje.
- **El contraataque no cambia:** uno por cada lanzamiento fallido.
- **Compatibilidad:** los encuentros guardados sin fichas usan `Wave.hits` como hoy.
- **Simulador** (`scripts/sim/`): añadir políticas de reparto:
  - `auto` (la de hoy);
  - `concentrate-valuable`: todo al legendario, shiny, especie nueva o el de nivel más alto;
  - `type-smart`: cada ficha al salvaje donde hace más daño.
  
  Así el agente de balance puede compararlas.
- **i18n:** `damage.*`. También se pueden tocar las claves `waves.*` existentes.

## B — Informe de la sesión, o "qué se activó"

**Decisión:** el usuario tiene que poder entender por qué pasó lo que pasó y decidir qué cambiar en su equipo, sin llenar la pantalla.

- **El motor registra más datos en el resultado de la sesión** (`MemberResult` y el resultado guardado en `outcome`/historial):
  - habilidades pasivas que se activaron, con cuántas veces y qué efecto;
  - técnicas activables: veces, intentos y probabilidad por acción usada (la `activationChance`);
  - ataques de daño usados, con veces por técnica;
  - cargas producidas, con quién, la técnica o habilidad, y el estado;
  - multiplicador de condición con el tipo y el motivo.
- **"Por qué salieron estos salvajes":** factores de la generación de la oleada:
  - tipos con condición activa;
  - hora, p. ej. noche, más Fantasma;
  - perfil sonoro dominante o estilo de estudio (lo rellena el paquete F);
  - pesos por habilidades como `encounterWeight` y Sincronía;
  - liga y tamaño de oleada.
  
  Ya están en `EncounterState.gen` y en `Wave.activeConditionTypes`. Solo falta mostrarlos.
- **Interfaz, de menos a más detalle:**
  1. Lo que se ve hoy no cambia. Solo cada carga de Sueño o Parálisis en Oleadas muestra un mini-icono del Pokémon que la produjo, con un tooltip tipo "Parálisis · Pikachu (Estático)". `Charge.sourceUid`/`source` ya existen.
  2. Un botón "Informe de la sesión" en Resultados y en Oleadas abre un panel lateral o modal con una fila por Pokémon, desplegable, y la sección "Por qué salieron estos salvajes".
- Usa componentes nuevos en archivos propios, como `src/ui/screens/home/SessionReport.tsx` y `ChargeChip`, y toca lo mínimo en `Waves.tsx` y `Results.tsx`, porque el paquete A también cambia `Waves.tsx`.
- **i18n:** `report.*`.

## C — Sesiones de estudio en grupo, con Hada proporcional

**Decisión:**

- **Crear e invitar.** Al iniciar una sesión, "Estudiar con amigos": eliges la duración e invitas a uno o más amigos aceptados. Los invitados reciben la invitación en tiempo real (SSE, `server/events.ts`) y la aceptan o rechazan. El anfitrión pulsa iniciar, y todos los que aceptaron empiezan su sesión con la misma duración y el mismo inicio.
- **Unirse tarde.** Quien acepta tarde puede unirse a una sesión de grupo ya empezada, pero va acompañado menos tiempo.
- **Pausar o abandonar.** Pausar en una sesión de grupo = **salir del grupo**. Tu sesión sigue en solitario, y lo mismo pasa si la cancelas. No se puede volver a entrar.
- **Bonus proporcional al tiempo acompañado.** `friendOverlap` = fracción de tu sesión (0–1) en la que al menos otro miembro estaba en el grupo y sin pausar. El multiplicador Hada pasa a `1 + (fairy − 1) × friendOverlap` y se quita el umbral del 80 %. Ajusta el GDD §9.2 y `conditions.ts`. **Solo afecta a los Pokémon de tipo Hada.**
- **Si queda una sola persona**, deja de sumar tiempo acompañado. Sale solo de la regla anterior.
- **Lo calcula el servidor al reclamar**, con los intervalos guardados en la base de datos. Nunca lo envía el cliente. Pásalo al reducer por `ActionEnv`, igual que `now`.
- **Informar siempre:**
  - durante la sesión, quién sigue en el grupo y "acompañado X de Y min · Hada ×Z estimado";
  - cuando alguien sale, un aviso;
  - en Resultados, el bonus Hada final y por qué.
  
  El usuario nunca debe quedarse sin saber qué pasó con su bonus.
- **Base de datos:** tablas nuevas para el grupo, los miembros con su intervalo `joinedAt`/`leftAt` y las invitaciones, con migración de Drizzle (`npm run db:generate`). Tests de integración en `server/app.test.ts` o en un archivo nuevo.
- **i18n:** `group.*`.

## D — Guía de tipos con planificador, y silenciar la música en la sesión

- **Guía de tipos.** En el panel de condiciones (`PreSession.tsx`, `ConditionsPanel`), un botón "Todos los tipos" abre una tabla con los 18 tipos: regla (`conditions.rule.*` ya existe), multiplicador, si está activo ahora y **cuándo se activa**, p. ej. "Planta: mañana a las 05:00" o "Tierra: el sábado".
- **Planificador.** Un selector "¿Y si empiezo a las…?", con día, hora y duración, que recalcula la tabla con `conditionEnvAt`. Si hace falta, el motor puede exponer un helper puro "próxima activación" en `src/engine/conditions.ts`, con tests.
- **Silenciar.** Un botón con icono en la pantalla de la sesión (`FocusSession.tsx`) que silencia o activa la música (`audio.muted` o el volumen de música, `src/audio/settings.ts`), sin ir a Ajustes. Debe ser accesible: `aria-pressed` y etiqueta.
- **i18n:** `typesGuide.*`, `focus.mute*`.

## F — Perfil sonoro con el micrófono, y clima real

- **Micrófono (GDD §4.3):**
  - es opcional y se pide permiso desde PreSession;
  - se analiza en el navegador con Web Audio; cada 2 s se clasifica la ventana como `silence`/`voice`/`music`/`noise` (RMS, actividad de voz y rasgos espectrales simples);
  - **el audio nunca sale del dispositivo**; al reclamar se envían solo los porcentajes, en la acción `claim` con el campo nuevo `soundProfile`;
  - el reducer lo pasa a `completeSession`, que ya acepta `soundProfile`;
  - el servidor lo valida: números entre 0 y 1, y que sumen 1,05 como mucho;
  - durante la sesión, un indicador discreto del estilo actual;
  - **contexto seguro:** solo en `localhost` o HTTPS (`window.isSecureContext`). Sin permiso o sin contexto seguro, se explica en una línea y la sesión sigue sin perfil.
- **Estilos de estudio:** el perfil dominante (silencio, música, voz o ruido) influye **ligeramente** en los tipos que aparecen, además de la hora y las condiciones. El motor ya lo hace con `soundDominant` en `WaveGenParams`. Revisa el peso actual, que el GDD pone en ×1,5, y bájalo a algo "ligero" si hace falta. Que se vea en el informe del paquete B, con el campo ya existente.
- **Activa las condiciones Volador (música o ruido ≥ 30 %) y Psíquico (silencio ≥ 70 %).**
- **Clima real:**
  - el servidor consulta Open-Meteo (geocodificación más tiempo actual, sin clave) con la ciudad del perfil al iniciar la sesión;
  - lo cachea unos 30 min por ciudad y lo pasa al reducer por `ActionEnv`, que lo guarda en la sesión activa y lo usa al reclamar;
  - si falla la red, `null` (el clima manual quedó solo para desarrollo en el paquete G);
  - en tests se inyecta un fetch falso (`Deps`);
  - Ajustes muestra el clima detectado.
- **i18n:** `mic.*`, `weather.*`.

## G — Clima por ubicación, sin clima manual, y calibración del micrófono

- **Sin clima manual para jugadores.** Si no se detecta, no hay clima (Agua y Hielo apagados; Fuego solo por su franja de la tarde). `setWeather` es una acción de desarrollo (`DEV_ACTIONS`): el servidor la rechaza sin `DEV_TOOLS=1`, y `resolveSessionWeather` ignora `profile.weather` fuera de desarrollo, también en partidas antiguas. El selector solo está en el panel de desarrollo.
- **Clima por la ubicación del dispositivo**, con la ciudad escrita como respaldo. "Usar mi ubicación" en Ajustes y como aviso compacto en la preparación de la sesión (Geolocation API, contexto seguro). El cliente redondea a ~0,1° (~10 km) antes de enviar; el reducer vuelve a redondear y guarda solo la celda en `profile.location` (opcional; las partidas antiguas = null). El servidor consulta Open-Meteo por lat/lon sin geocodificar y cachea por celda. Se puede quitar. Sin enfriamiento.
  - Por qué en el perfil y no con `start`: el servidor inicia las sesiones de los invitados de un grupo de estudio, que pueden no tener la app abierta. La celda de ~10 km es el mínimo necesario para eso.
- **Calibración del micrófono** (~15 s, opcional): silencio 5 s, voz 5 s y música 5 s opcional ("Saltar: uso audífonos", que activa la opción de audífonos). `calibrate()` (puro, `src/ui/lib/mic/calibrate.ts`) deriva umbrales personales con límites; lo no medido usa `DEFAULT_THRESHOLDS`. Se guarda por `deviceId` en localStorage (`calibration-store.ts`). Medidor en vivo en el asistente y en Ajustes.
- **"Escucho música con audífonos"** (opcional, recordado): las ventanas de silencio cuentan como música (`applyHeadphones`). La música por parlantes, también la de enfoque de la app, ya cuenta como música.
- **i18n:** `mic.*`, `weather.*`, `location.*`.

## Balance (después de A)

Un agente aparte simula con datos reales (`npm run simulate`, `scripts/sim/`) las tres políticas de reparto con los 6 perfiles de jugador.

**Comprueba:**

- probabilidad de capturar legendarios en el primer encuentro;
- captura de Pokémon de nivel alto y de evolución final;
- progresión (nivel de entrenador, Pokédex por semana);
- daño desperdiciado.

**Criterio:**

- un jugador hábil que concentra el daño **debe** ganar ventaja: se recompensa;
- pero un legendario y un Pokémon de nivel alto deben seguir siendo un reto;
- no puede ser "casi seguro" con un equipo normal, ni siquiera combinado con Sueño;
- el coste de concentrar (no dañar a los otros salvajes) tiene que notarse.

**Si se rompe,** se ajusta la config, p. ej. con una vida mínima mayor para legendarios o un tope de daño por salvaje, y se documenta en `docs/balance-report.md`.

## Integración

El agente principal fusiona las ramas en este orden: A, B, D, F, C. Resuelve los conflictos, sobre todo en las claves de i18n y en `Waves.tsx`, `FocusSession.tsx` y `actions.ts`. Después lanza el agente de balance, actualiza `docs/PENDING.md` y verifica `npm run typecheck`, `npm test` y la app en el navegador.
