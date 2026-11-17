# Plan de balance y progresión para la beta (decidido el 2026-11-16)

Objetivo: que el juego dure **años** (no infinito, pero sostenible) y que un jugador con un buen equipo siga motivado. Beta con miles de jugadores. Referencia: Pokémon Sleep.

## Decisiones cerradas (confirmadas por el usuario)

1. **Bucles de retención:** escalera relativa (ligas con subrangos), techo móvil (el nivel máximo sube con cada pack), metas laterales (shiny, Dominio, Vínculo, Pokédex por regiones, formas), eventos y social. Sin «prestigio».
2. **Ligas como Pokémon Sleep, con reinicio semanal:** Base 1-5, Super 1-5, Ultra 1-5, Master 1-25 (35 escalones). Un equipo bueno sube rápido hasta su mejor semana y ahí cuesta; esa es la sensación buscada. Umbrales geométricos (cada escalón pide un % más que el anterior), calculados con el simulador, con el techo reservado por encima del mejor equipo actual.
3. **Salvajes por liga (acumulativo):** Base solo 1.ª forma; Super 1.ª y 2.ª; Ultra 1.ª, 2.ª y 3.ª (la 3.ª rara en Ultra 1, más común en Ultra 5); Master todo más legendarios muy raros. Un jugador de nv. ~20 apenas llega a Ultra 1; si lo logra (por evento o suerte) sí puede ver y capturar una 3.ª.
4. **Tamaño de oleada por liga y subrango (interpolado):** Base 2→4, Super 4→6, Ultra 6→7, Master 7→10 entre Master 1 y 5; de Master 6 a 25, 10 fijo. Sustituye los topes actuales 5/6/7/8.
5. **Rankings:** por defecto el del rango actual del jugador + su país; puede ver otros rangos y ligas, el global y el de amigos. Premios: Polvo por subir de rango (una vez por semana) y premios de podio por tablero. Cosméticos o Polvo, nada de poder. Tableros con pocos jugadores: caer al ranking del rango global.
6. **Límite diario (§3.3) se mantiene.** El techo de puntos lo fija el poder del equipo por el máximo de estudio pagado; los escalones se calculan a partir de eso.
7. **Curva de EXP (referencia confirmada el 2026-11-16: jugador «constante», 4 sesiones al día; el casual real tarda unas 4-5 veces más; el tryhard puede llegar al nv. 60 en unos 5-7 meses si arma muy bien el equipo, con el techo de 10 h diarias):** rápida al inicio (engancha también al casual) y mucho más lenta después. Objetivo del jugador constante sin caramelos: nv. 36 ≈ 2-3 meses, nv. 50 ≈ 9 meses, nv. 60 ≈ 18 meses. Primer cálculo (a verificar con el simulador): `EXP(L) ≈ 0,2·L^3,85`, o exponente 2,8 hasta nv. ~20 y más alto después.
8. **Polvo como freno real:** coste por caramelo creciente más que lineal (idea: `25 + 3·L + 0,05·L²`), al estilo de los Fragmentos de Sueño de Sleep. Hoy sobra el 99 % del Polvo. Decidir con el simulador.
9. **Tope de nivel por Pokédex:** se reescribe en proporción al total de especies; sube 5-10 niveles con cada pack.
10. **Evolucionar cuesta caramelos de su línea** (idea del usuario, 2026-11-16, importe a criterio de Claude): provisional **25 caramelos a 2.ª etapa y 100 a 3.ª** (como en Pokémon GO), a comprobar con el simulador porque compiten con los caramelos de subir nivel (hoy una evolución no cuesta nada, solo el objeto en las de piedra). Se aplica en el paso 6.
10b. **3.ª etapa (el usuario quitó el 2026-11-16 los requisitos de Vínculo y de 20 especies; queda solo el nivel de entrenador 15 y el coste en caramelos):** solo nivel de entrenador mínimo (15) y el coste en caramelos de la decisión 10. La 2.ª etapa sigue fácil. Comprobar que los salvajes de 3.ª etapa no se capturen pronto fuera de la liga Ultra.
11. **Contenido:** Kanto completo (151 especies) para la beta; un pack cada 4-6 meses, rellenando con eventos entre medias.
12. **Alpha:** NO se resetea a los jugadores (son ~6 amigos de nivel bajo). Si hay que cambiar técnicas o pasivas, se ven afectados.
13. **Pruebas de estrés automatizadas**, midiendo CPU, RAM, red, conexiones y latencia según la carga de usuarios, para saber si el servidor actual aguanta.
14. **UI:** en el selector de caramelos, vista previa del nivel y de la barra de EXP resultantes, sin aplicar hasta pulsar el botón.
15. **Revisión de estadísticas, técnicas y probabilidades** con el usuario, una por una: la agenda la decide Claude (ver «Cuándo» abajo).

## Plan por pasos

| # | Paso | Detalle | Modelo |
|---|---|---|---|
| 1 | Pruebas de estrés | `scripts/load/`: registro, login, reclamar sesión, rankings, conexiones en tiempo real; 1.000, 5.000 y 10.000 usuarios simulados contra PostgreSQL real; mide CPU, RAM, red, conexiones, p50/p95; informe con gráficas (`docs/load-report.md`) | sonnet |
| 2 | Simulador a 1-2 años | 52-104 semanas; perfiles casual real, exámenes (ráfagas) y abandono; escalones de liga nuevos | sonnet |
| 3 | Curva de EXP y Polvo | Ajustar con el simulador (paso 2); tabla de tiempos por perfil | modelo principal |
| 4 | Ligas con subrangos (motor) | Umbrales, oleadas, etapas de salvaje por liga; compatibilidad con datos existentes | modelo principal |
| 5 | Ligas (servidor y UI) | Ranking rango+país con selector, premios de subida y podio, i18n ES/EN, changelog, versión | sonnet + frontend-design |
| 6 | 3.ª etapa | Requisitos acumulativos y revisión de apariciones | modelo principal |
| 7 | Selector de caramelos | Vista previa de nivel y barra de EXP | sonnet + frontend-design |
| 8 | **Revisión con el usuario** | Estadísticas → técnicas → probabilidades (captura, shiny, legendarios, condiciones de tipo) | conversación |
| 9 | Kanto (151) | Importar y curar cada especie con el valor de estudio; topes de Pokédex proporcionales | sonnet (mecánico) + revisión |
| 10 | Pendientes de admin | Nota para jugadores al publicar; mensaje al regalar desde Jugadores | sonnet |

Pasos 1 y 2 son independientes y pueden ir en paralelo (máximo 2 subagentes, vitest con `--maxWorkers=2`).

**Cuándo revisar el paso 8:** después de los pasos 3 y 4 (la curva y las ligas fijan cuánto tardan los jugadores en llegar a cada cosa) y **antes** del paso 9 (no tiene sentido curar 151 especies con fórmulas aún sin cerrar).

## Robustez y seguridad (decidido el 2026-11-16, tras `docs/load-report.md` y `docs/security-audit.md`)

**Hecho (sin commit):** caché y consulta del ranking (migración 0013); arreglo del bloqueo del pool en `server/content/service.ts`; A1 (límite de 120 acciones/min y 3 simultáneas por jugador, clima fuera de la transacción); A2 (tope de conexiones SSE por jugador y total); descarte de carga con 503 `server_busy`; límites de memoria/CPU y logs rotados en `docker-compose.yml`; M5 (solo cuentan los intentos fallidos, por IP + cuenta); CSP en modo solo-informe y Permissions-Policy (M6). Detalle en `docs/server.md` «Resource limits and load protection».

**Pendiente:**
- M3: Turnstile (captcha de Cloudflare) en registro, y reglas de límite de peticiones en Cloudflare. Requiere claves de la cuenta de Cloudflare.
- M6: tras revisar la consola del navegador, pasar la CSP de solo-informe a obligatoria.
- M7/M8: borrado y exportación de cuenta (RGPD); 2FA y recuperación de contraseña para el admin.
- M4: solo hay un correo en `ADMIN_EMAILS` y ya tiene cuenta; confirmar que `ADMIN_TOKEN` no está definido en producción.
- Monitor de disponibilidad (Uptime Kuma) con aviso.
- Copias de seguridad de PostgreSQL y de `uploads` a otro disco o a la nube (el usuario las hará después).
- **Límite de Pokémon en la Caja** (decidido y confirmado el 2026-11-16): capacidad 150 al nivel 1 de entrenador, +25 cada 5 niveles, tope 400 al nivel 50 (~0,85 KB por Pokémon en el documento, unos 340 KB a 400; a largo plazo, guardarlos en su propia tabla). Con la Caja llena la captura queda pendiente y una ventana deja cambiarla por un Pokémon de la Caja, convertirla en caramelos o guardarla (hasta 10 pendientes; shiny y legendarios siempre pendientes; GDD §12.9). Valores editables desde el admin.
- Repetir las pruebas de carga (5.000 y 10.000, base de 100.000, pico y evento) con estas protecciones.

## Paso 3 — resultados del simulador (2026-11-16, 104 semanas, 6 semillas, medida: nivel MEDIO del equipo)

Candidatas con el codo en el nivel 20 (`expCurve.kneeLevel`, `exponentAfter`; exponente 2,8 hasta el nv. 20):

| Jugador constante, nivel medio del equipo | Sem. 4 | 12 | 26 | 39 | 52 | 78 | 104 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Curva actual (referencia) | 33 | 48 | 50 | 60 | 60 | 60 | 60 |
| **Codo 20, exponente 4,0** | 27 | 36 | 46 | 51 | 57 | 59 | 60 |
| Codo 20, exponente 4,4 | 27 | 34 | 45 | 49 | 55 | 58 | 59 |
| Codo 20, exponente 4,25 + Polvo `0,05·L²` | 27 | 37 | 45 | 51 | 56 | 59 | 59 |

Objetivo del constante: nv. 36 a los ~2-3 meses (sem. 11), nv. 50 a los ~9 meses (sem. 39), nv. 60 a los ~18 meses (sem. 78). El nivel avanza en proporción a los minutos de estudio: el maratonista (200 min/día) llega al 60 hacia el mes 9-12; 60 en ~6 meses exige unas 5 h al día. El Polvo ya es el límite de los caramelos (el constante gasta ~97-100 %); los caramelos aportan ~15 % de la EXP al principio y más a niveles altos. El tope por Pokédex (56 especies) pesa mucho: con Kanto (151) hay que repetir la medición.

**Aplicado el 2026-11-16 (confirmado por el usuario):** `expCurve` con codo en el nivel 20 y exponente 4,0 después; coste de Polvo `25 + 3·L + 0,03·L²`. Ver GDD §12.1 y §12.3. Pendiente: repetir la medición con Kanto (151) y reajustar los topes por Pokédex en proporción.
**Cambio de combate (2026-11-16, a petición del usuario):** lanzar una Ball en una oleada manual ya no hace atacar a nadie ni bloquea la oleada (GDD §11.4).

**Kanto (paso 9, hecho por un agente el 2026-11-16, ver `docs/kanto-report.md`):** 158 especies (151 de Kanto + 7 de Johto del Pack 1), 115 habilidades, 81 técnicas especiales. Topes de nivel por Pokédex: 0→30, **55**→40 (bajado de 70 el 2026-11-16 para que el casual no se quede topado un año en el nv. 30), 100→50, 140→60. Pendiente: repetir la medición de la curva de EXP con Kanto cuando las ligas estén cerradas (el simulador con Kanto dio nv. 60 hacia la semana 40 con la métrica del nivel máximo, que se contamina con salvajes de nivel alto; hay que mirar el nivel medio del equipo).

## Pasos 4 y 5 — ligas con subrangos (hecho el 2026-11-17)

**Hecho:** escalera de 40 escalones (Base/Super/Ultra 1-5, Maestra 1-25; el «35» del plan era una errata) con umbrales geométricos calculados de 5 valores editables (`leagues.secondRankPoints` 400, `weeklyThresholds` 4 k / 30 k / 100 k, `topRankPoints` 1 M); oleadas por rango (`encounters.leagueWaveSize`, Base 2→4, Super 4→6, Ultra 6→7, Maestra 7→10 y 10 fijo desde Maestra 5); etapas por liga (`encounters.leagueStageWeights`); Polvo por subir de rango (10 + 2·escalón) y podio semanal por rango + país (50 + 10·escalón × 1/0,6/0,4, mínimo 20 jugadores) liquidado al consultar (`POST /api/leaderboard/podium`, sin tareas en segundo plano); ranking por rango (por defecto el mío en mi país, con caída al global del rango si hay menos de 20); ventana «¡Subiste de liga!» / «¡Podio!» y aviso breve para escalones dentro de la misma liga; pantalla de Liga con la escalera completa; acción de desarrollo `devAddLeaguePoints`. Sin migración. Detalle y tabla en GDD §10.1, §10.2 y §14; informe en `docs/longterm-report.md`.

**Pendiente / a revisar con el usuario:**
- El casual real se queda de media en Base 5 (mejores semanas: Super 2). Valorar bajar Super 1 a ~3.000.
- Cosméticos de podio (marco o insignia) no hechos: de momento solo Polvo.
- El podio solo cierra la semana inmediatamente anterior: quien no abre la app en toda una semana pierde ese podio.
- Repetir la medición con la curva y los topes definitivos del paso 6 (el informe actual usa el árbol con el paso 6 sin commitear).

**Medición final con todo junto (2026-11-17: Kanto 158 especies, ligas con subrangos, curva con codo, evolución con caramelos; 6 semillas, 104 semanas; informe completo en `docs/longterm-kanto.md`)** — nivel medio del equipo:

| Perfil | Sem. 12 | 26 | 39 | 52 | 78 | 104 |
|---|---:|---:|---:|---:|---:|---:|
| Constante (objetivo 36 / – / 50 / – / 60) | 35 | 44 | **50** | 56 | **59** | 59 |
| Maratonista | 40 | 54 | 56 | 59 | 59 | 59 |
| Noctámbulo | 39 | 49 | 56 | 58 | 60 | 60 |
| Casual (1-2 sesiones, 4 días) | 19 | 23 | 25 | 27 | 31 | 33 |

El constante cumple el calendario acordado con Kanto. Ojo: el constante captura 136 especies hacia la semana 26 y 151 hacia la 52, así que **Kanto se acaba en ~1 año** (un pack nuevo cada 4-6 meses lo cubre).
