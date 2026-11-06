# Pendientes — 2026-11-04

El prototipo F1 está **completo y jugable** y la **F2 (servidor propio, cuentas, amigos y rankings) está implementada** (ver `docs/F2-plan.md` y `docs/server.md`). Este archivo resume el estado y lo que queda, para que un agente nuevo pueda continuar sin contexto previo.

## Cómo arrancar

```bash
npm install
npm run dev          # app (5173) + API (8787, PGlite en .data/pglite, DEV_TOOLS=1); ?dev = panel de desarrollo
npm test             # 243 tests (motor, reducer, servidor, UI)
npm start            # producción: API + dist/ en un solo origen (requiere npm run build)
docker compose up --build   # PostgreSQL 17 + app (cuando haya Docker)
npm run simulate     # simulador de balance → docs/balance-report.md
```

## Documentos

| Documento | Para qué |
|---|---|
| `docs/GDD.md` | Diseño completo del juego (fuente de verdad), con la calibración aplicada en §20.2 |
| `docs/effects.md` | Primitivas de efecto de técnicas y habilidades |
| `docs/engine-api.md` | API del motor: modelo de daño, misiones, reglas de sueño |
| `docs/ui-foundation.md` | Sistema de diseño, componentes, motor de pistas, cómo añadir pantallas |
| `docs/audio.md` | Módulo de audio: efectos sintetizados y música generativa |
| `docs/balance-report.md` | Informe del simulador (§9: métricas tras las correcciones del motor) |
| `docs/qa-report.md` | Resultado del QA: qué se probó, fallos corregidos y pendientes |
| `docs/ux-research.md` | Investigación de UX que guió el frontend |
| `public/art/README.md` | Arte pixel generado por código (`npx tsx scripts/art/build.ts`) |

## Hecho

- **Datos:** 56 especies del Pack 1 importadas de PokeAPI. Overrides con el balance calibrado, 41 técnicas, 49 habilidades y las misiones. Sprites locales.
- **Motor** (`src/engine/`):
  - sesiones, oleadas con bonus por liga, daño de captura sincronizado por nivel, contraataques, energía, progresión, ligas;
  - misiones diarias, semanales y de Pokédex;
  - determinista con semilla.
- **Interfaz** (`src/ui/`):
  - todas las pantallas del prototipo: primer inicio, inicio, sesión, Reclamar y resultados, oleadas, caja, ficha, equipo, Pokédex, liga y estadísticas, misiones, ajustes, descanso y panel de desarrollo;
  - ES/EN;
  - motor de pistas con Profe Pika y checklist de primeros pasos.
- **Arte:** mascota en 5 poses, logo, favicon e iconos, generados como SVG pixel desde `scripts/art/`.
- **Audio:** 27 efectos chiptune y 4 pistas generativas (focus, home, encounter, results), con ajustes de volumen.
- **Balance:** simulador con 6 perfiles de jugador, calibración aplicada y 0 especies fuera de banda.
- **QA:** 13 fallos corregidos. No queda ninguno de severidad alta.

## Pendiente del prototipo (menor)

Del QA (`docs/qa-report.md`):
1. **R-01 (media):** si recargas a mitad de sesión, el aviso sonoro de fin puede no sonar hasta que hagas clic (política de autoplay del navegador). Propuesta: un chip "toca para activar el sonido".
2. **R-03 (baja):** con dos pestañas, si la sesión empezó en la pestaña que no es la principal, suenan las dos al terminar. La notificación sí llega una sola vez.
3. **Otros menores:**
   - la animación del contraataque se pierde si recargas a mitad de un lanzamiento;
   - a 390 px se recortan los sprites de los extremos del equipo;
   - a 1024 px el número de Polvo se sale un poco de su tarjeta;
   - el foco no se mueve al cambiar de pantalla;
   - la Ball de Estudio sigue seleccionada al elegir un salvaje que no es elegible.

Decisión tomada: **se puede iniciar una sesión con todo el equipo agotado**. Solo se muestra un aviso, porque estudiar siempre compensa (GDD §5.3: los agotados ganan EXP).

Balance a vigilar:
- El maratonista se queda sin Ultra Balls para los legendarios: captura el 21% en el primer encuentro, frente al 52% del jugador constante. Opción: dar Ultra Balls como recompensa al subir de liga en la semana.
- Los puntos de los grinders crecen mucho, porque su equipo sube más rápido de nivel. **Aceptado (2026-11-05):** no se compensa. La ventana de 5 min para reclamar ya frena a quien deja el temporizador corriendo sin estudiar.
- Los objetos Teralito y MT ya se ganan en misiones, pero todavía no sirven para nada (la Teracristalización y las MT llegan en F4).

Panel de desarrollo contra un servidor de producción: con `?dev` el panel se abre aunque el servidor tenga `DEV_TOOLS` apagado (Docker, `npm start`). El reloj adelantado y "Terminar la sesión ya" solo cambian la hora del cliente, el servidor ignora `x-dev-now` y responde `409 not_finished` al reclamar (y `403 dev_disabled` en los botones de objetos). Propuesta: que el servidor anuncie si tiene herramientas de desarrollo y que el panel se desactive si no las tiene; y un texto de error específico para `not_finished`.

## En curso: profundidad de la sesión (2026-11-05)

La especificación completa está en `docs/session-depth-plan.md`.

- **A. Reparto del daño por Pokémon.**
  - Cada Pokémon es una ficha "×N" con el desglose de ataques en un tooltip, y se asigna a un salvaje.
  - Se puede reasignar hasta lanzar la primera Ball de la oleada.
  - Botón Auto en la oleada.
  - Preferencia "Auto": se puede cambiar antes, durante y en la pantalla de Reclamar, y queda fija al reclamar.
  - Un agente de balance lo valida con el simulador. Un jugador hábil gana ventaja, pero los legendarios y los Pokémon de nivel alto siguen siendo un reto.
- **B. Informe de la sesión.**
  - Qué técnicas y habilidades pasivas se activaron, con qué probabilidad, y quién produjo cada carga de Sueño o Parálisis.
  - Por qué salieron esos salvajes: hora, condiciones, estilo de estudio y habilidades.
  - Va detrás de un botón o un tooltip, sin llenar la pantalla.
- **C. Sesiones de estudio en grupo con amigos.**
  - Se invita a amigos, que empiezan sincronizados.
  - Pausar o abandonar = salir del grupo.
  - El bonus Hada es proporcional al tiempo acompañado (solo para el tipo Hada), y siempre se informa al usuario.
- **D. Guía de los 18 tipos**, con "cuándo se activa" y un planificador "¿Y si empiezo a las…?".
- **D. Botón para silenciar la música** en la pantalla de la sesión de estudio.
- **F. Micrófono**, analizado en el navegador sin enviar audio. Define estilos de estudio que influyen ligeramente en los tipos de salvajes y activa Volador y Psíquico.
- **F. Clima real con Open-Meteo**, con el clima manual como respaldo.

## Fases siguientes (GDD §20)

- **F2 — Online: HECHA.** Pendientes menores de la F2:
  - Probar el driver postgres-js (`DATABASE_URL`) con un PostgreSQL real (solo se probó PGlite).
  - Probar de punta a punta: cambio de contraseña, revocar otra sesión, cerrar sesión en todos los dispositivos, rate limit (cubiertos por tests de integración, no por la prueba con navegador).
  - El bus de eventos y el rate limit viven en memoria: una sola instancia del servidor.
  - Recuperación de contraseña por correo (no hay envío de correos todavía).
- **F3 — Foco real:** perfil sonoro con el micrófono (se mide el ruido en el navegador, sin enviar audio; activa Volador con ruido y Psíquico con silencio) y, opcional, clima real con Open-Meteo para Fuego/Hielo. El micrófono exige un contexto seguro: funciona en `localhost` (dev y Docker local) y en HTTPS, pero no en `http://<ip-tailscale>`. Sin dominio: `tailscale serve` da HTTPS en `https://<máquina>.<tailnet>.ts.net`. Con dominio: proxy inverso con HTTPS automático (p. ej. Caddy). Sin permiso o sin contexto seguro, la sesión sigue sin perfil sonoro.
  - **Descartado (2026-11-05):** capturas de pantalla clasificadas con IA. El Foco se queda en la etiqueta neutra; `focus.model` en la config queda sin uso.
- **F4 — Progresión profunda:** Teracristalización, MT, Mentas, Chapas, Cápsula Habilidad.
- **F5:** intercambios entre amigos (evoluciones por intercambio) y más packs de especies (proceso de curación en GDD §20.1).
- **graphify:** generar el grafo de conocimiento del código con `/graphify` (opcional).
