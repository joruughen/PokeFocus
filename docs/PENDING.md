# Pendientes — 2026-11-04

El prototipo F1 está **completo y jugable**. Este archivo resume el estado y lo que queda, para que un agente nuevo pueda continuar sin contexto previo.

## Cómo arrancar

```bash
npm install
npm run dev          # app en http://localhost:5173  (añade ?dev para el panel de desarrollo)
npm test             # 198 tests
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
- Los puntos de los grinders crecen mucho, porque su equipo sube más rápido de nivel. Se compensará con el Foco real por capturas de pantalla (F3).
- Los objetos Teralito y MT ya se ganan en misiones, pero todavía no sirven para nada (la Teracristalización y las MT llegan en F4).

## Fases siguientes (GDD §20)

- **F2 — Online:** Supabase (cuentas, amigos, sesiones y tiradas en el servidor, rankings de amigos, zona y global). El almacenamiento de la UI ya está preparado para cambiar de backend (`docs/ui-foundation.md`).
- **F3 — Foco real:** capturas de pantalla en momentos aleatorios clasificadas con Claude Haiku 5.5 (`focus.model` en la config) y perfil sonoro con el micrófono.
- **F4 — Progresión profunda:** Teracristalización, MT, Mentas, Chapas, Cápsula Habilidad.
- **F5:** intercambios entre amigos (evoluciones por intercambio) y más packs de especies (proceso de curación en GDD §20.1).
- **graphify:** generar el grafo de conocimiento del código con `/graphify` (opcional).
