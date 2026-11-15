# JSON de importación del panel de admin

Cómo describirle un evento (o un cambio de contenido) a un asistente como Claude, que te devuelva un **JSON** y que lo **pegues o subas** en el panel (`#/admin`) para rellenar el editor sin ajustar campo a campo. Este documento está escrito **para el asistente**: si eres Claude u otro asistente y te han pasado esta página, sigue las reglas de la sección 2 y devuelve **solo el JSON**.

Hay dos formatos versionados:

| `format` | Para qué | Dónde se importa |
| --- | --- | --- |
| `pokefocus.event@1` | Un evento: fechas, especies destacadas, shiny/legendarios, objetos propios, drops, misiones y, opcionalmente, un parche de contenido que entra en vigor con él. | Pestaña **Eventos** → «Importar JSON» (en la lista, o dentro del editor para rellenarlo). |
| `pokefocus.content@1` | Un parche de contenido (parámetros, especies, movimientos, técnicas, habilidades, misiones). | Pestaña **Contenido** → «Importar JSON». |

Importar **nunca publica nada**: solo crea o rellena un **borrador** que el admin revisa, valida, simula y publica él (con su contraseña). El esquema de ambos formatos está en [`admin-json/event.schema.json`](admin-json/event.schema.json) y [`admin-json/content.schema.json`](admin-json/content.schema.json) (JSON Schema, generado desde el mismo código que valida el servidor; `npm run admin:schema` lo regenera y un test falla si está desactualizado).

## 1. El flujo

1. El admin le describe el evento al asistente («Del 1 al 8 de diciembre, semana de Pikachu: Pikachu sale el triple, shiny al 0,8 %, una misión de atrapar tipo eléctrico…»).
2. El asistente genera el JSON siguiendo este documento.
3. **Opcional pero recomendado**: comprobarlo sin servidor ni base de datos con el mismo validador que usa el servidor:

   ```bash
   npm run admin:validate -- evento.json
   ```

   Imprime los errores con su ruta (`missions.0.rewards.0.items.great-ball`) en español, los avisos, y termina con código 0 si es válido, 1 si hay errores y 2 si no se pudo leer el archivo. Con `--no-smoke` se salta la prueba de humo del motor (más rápido; el servidor la hace siempre al publicar).
4. El admin pega el JSON (o sube el `.json`) en «Importar JSON». El panel lo vuelve a comprobar, muestra los errores con su ruta y, si es válido, crea el borrador y abre el editor. **La imagen se sube aparte** en el editor.
5. El admin revisa, guarda, valida con el servidor y publica o programa.

## 2. Reglas para el asistente

1. Devuelve **un solo objeto JSON**, sin comentarios (JSON no los admite), sin comas finales y sin texto alrededor (si lo envuelves en un bloque ```json está bien: el panel lo quita).
2. Pon siempre `"format": "pokefocus.event@1"` (evento) o `"pokefocus.content@1"` (contenido).
3. **Textos en español Y en inglés, siempre**: `name`, `description`, y los `title`/`description` de misiones y los `names` de objetos llevan `{ "es": "…", "en": "…" }`. Si el admin solo da uno, traduce el otro.
4. **Slugs** (`slug` del evento, `id` de misiones, claves de `items`): minúsculas, números y guiones, sin espacios, tildes ni mayúsculas (`semana-pikachu-2026`). El `slug` de un evento es **único para siempre** (también frente a los archivados): añade el año o la edición.
5. **Especies, objetos, movimientos, técnicas, habilidades y claves de `config` van por el slug/clave del juego**, no por el nombre. **No los inventes ni los recuerdes de memoria**: consúltalos (sección 7). Los únicos slugs nuevos permitidos son los de `items` (objetos propios del evento, que no deben existir ya en el juego) y los `id` de las misiones.
6. **Fechas ISO 8601 con zona**. Si el admin no dice otra, usa la hora de **Lima (`-05:00`, sin horario de verano)**: `2026-12-01T18:00:00-05:00`. Si la dan en UTC, `Z`. `endsAt` es **exclusivo** y debe ser posterior a `startsAt`; el evento dura **como mucho 62 días**. Para «del lunes al domingo» pon el fin el lunes siguiente a las 00:00.
7. **Probabilidades como fracción, no como porcentaje**: `0.01` = 1 %. Esto vale para `shiny.chance` y `drops[].perWaveChance`. Los multiplicadores son números normales (`3` = ×3).
8. Respeta los **rangos** de la sección 6. Un valor fuera de rango se rechaza; no lo «redondees» por tu cuenta: dile al admin que se sale y propón el máximo.
9. **No incluyas la imagen**. Si el admin habla de una imagen, resúmela en `imageNote` (el editor se la muestra como recordatorio).
10. Los campos opcionales que no se usan **se omiten** (no pongas `null`). `featured`, `drops` y `missions` pueden omitirse o ir vacíos.
11. **No pidas más de lo que pone la descripción**: no actives shiny, legendarios ni misiones que el admin no haya mencionado.
12. Si el admin pide algo que el formato no soporta (ver sección 8), dilo en lugar de inventar campos: el formato es **estricto** y rechaza cualquier campo desconocido.
13. Antes de entregarlo, si puedes ejecutar comandos, guarda el JSON en un archivo y pasa `npm run admin:validate -- archivo.json`; corrige hasta que diga `OK`.

### Formato del texto (`description` del evento)

Solo la `description` del evento admite formato; es un texto con marcas, **no HTML**:

| Marca | Resultado |
| --- | --- |
| `**texto**` | negrita |
| `*texto*` | cursiva |
| `[red]texto[/red]` | color: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink` |
| `- texto` (al principio de la línea) | punto de lista; en JSON, las líneas se separan con `\n` |
| `-[green] texto` | punto de lista con viñeta de color |
| `\*`, `\[`, `\\` | muestran `*`, `[` y `\` tal cual |

Límite: **400 caracteres visibles** por idioma (las marcas no cuentan). Los nombres y los textos de misiones y objetos son texto plano. En los textos de misión puedes usar `{n}` (objetivo), `{minutes}` (minutos mínimos de una `longSession`) y `{type}` (tipo de una `catchType`).

## 3. Formato de evento (`pokefocus.event@1`)

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `format` | sí | `"pokefocus.event@1"` |
| `slug` | sí | Identificador único para siempre. |
| `name` | sí | `{ "es", "en" }`, hasta 80 caracteres. |
| `description` | sí | `{ "es", "en" }` con el formato de texto de arriba. |
| `startsAt`, `endsAt` | sí | ISO 8601 con zona (ver reglas). |
| `imageNote` | no | Recordatorio sobre la imagen (no se importa ninguna imagen). |
| `featured` | no | Lista de `{ "species": "<slug>", "weightMult": <×> }`: cuánto más probable es esa especie. Sin repetir especies. |
| `shiny` | no | `{ "chance": <fracción>, "scope": "all" \| "featured" }`. `"featured"` exige al menos una especie en `featured`. Solo tiene efecto si supera la probabilidad base. |
| `legendaryChanceMult` | no | Multiplicador de la probabilidad de legendario. |
| `drops` | no | Lista de `{ "item": "<slug>", "perWaveChance": <fracción>, "max": <por sesión> }`. Sin objetos repetidos. El objeto debe ser del juego o uno de `items`. |
| `items` | no | Objetos propios del evento: `{ "<slug>": { "names": { "es", "en" }, "description": { "es", "en" } } }` (`description` es opcional). El slug no puede existir ya en el juego. |
| `missions` | no | Misiones del evento (ver abajo). |
| `content` | no | Contenido atado (sección 5). |
| `$schema` | no | Ruta al `.schema.json`, para que el editor del asistente autocomplete. |

### Misiones de evento

Cada elemento de `missions`:

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `id` | sí | Slug único dentro del evento. |
| `kind` | sí | `sessions` (sesiones completadas), `studyMinutes` (minutos de estudio), `longSession` (sesiones largas; exige `minMinutes`), `studyDays` (días de estudio), `techniques` (técnicas activadas), `catch` (capturas), `catchType` (capturas de un tipo), `catchFirstThrow` (capturas al primer lanzamiento), `studyBall` (capturas con Bola Estudio), `evolve` (evoluciones). |
| `target` | sí | Cuántas veces (o minutos, en `studyMinutes`). |
| `minMinutes` | solo `longSession` | Minutos mínimos de la sesión. |
| `type` | solo `catchType` | Tipo (`electric`, `water`…) o `"random"`; sin él se sortea uno. Lista: `--list types`. |
| `minTrainerLevel` | no | Nivel de entrenador mínimo para tener la misión. |
| `title`, `description` | sí | `{ "es", "en" }`. |
| `rewards` | sí | Lista de tramos de recompensa ordenados por `minTrainerLevel` creciente; se usa el último cuyo nivel ya se alcanzó. Cada tramo: `minTrainerLevel`, `items` (`{ "<slug>": unidades }`), `dust`, `typeCandies` (solo con `catchType` de un tipo concreto) y `randomItem` (`{ "pool": ["<slug>", …], "count": n }`). Un tramo vacío da un aviso. |
| `period` | no | Si lo pones, siempre `"event"`; se asume. |

Las misiones de evento se pueden reclamar hasta 7 días después de que termine.

## 4. Formato de contenido (`pokefocus.content@1`)

```json
{
  "format": "pokefocus.content@1",
  "title": "Más Pikachu por la tarde",
  "note": "Prueba de una semana",
  "applyOver": "live",
  "patch": { "species": { "pikachu": { "spawn": { "weightMult": 2 } } } }
}
```

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `format` | sí | `"pokefocus.content@1"` |
| `title` | sí | Nombre del borrador (hasta 80 caracteres). |
| `note` | no | Nota interna (hasta 400). |
| `applyOver` | no | `"live"` (por defecto): el `patch` lista **solo los cambios** y se mezcla sobre lo que esté en vivo al importar. `"base"`: el `patch` es un parche **completo** sobre los datos base del juego (lo que produce «Exportar JSON»). |
| `patch` | sí | El `ContentPatch`: `config` (solo las claves de `--list config`, con sus rangos), `species` (`captureRate`, `spawn`: `enabled`, `weightMult`, `hours`, `weather`, `minTrainerLevel`), `moves` (`power`, `accuracy`), `techniques` y `abilities` (reemplazo por slug de las que ya existen) y `missions` (`dailyCount`, `weeklyCount`, `pool`, `pokedex`, `placeholderItems`). |

Un parche publicado es siempre un parche completo sobre la base; por eso con `"live"` el panel **mezcla** tu parche sobre lo vivo al crear el borrador (campo a campo; las listas, como `hours`, se **reemplazan** enteras). Vuelve a ponerse a la base un valor quitándolo del borrador en el editor, no desde el JSON.

## 5. Contenido atado a un evento

Un evento puede llevar un parche de contenido que entra en vigor **a la vez que él**, como la opción «Junto a un evento» del diálogo de publicar. En el JSON del evento:

```json
"content": {
  "title": "Pikachu más frecuente en la semana",
  "note": "Atado al evento semana-pikachu",
  "applyOver": "live",
  "revertWhenEnds": true,
  "patch": { "species": { "pikachu": { "spawn": { "weightMult": 2 } } } }
}
```

- `title` y `note` son opcionales (por defecto, el nombre del evento). `applyOver` funciona como en el formato de contenido.
- `revertWhenEnds: true` equivale a la casilla «Volver a lo anterior cuando termine el evento».
- Al importar se crea **un borrador de contenido** (el panel te lo enlaza). El evento tiene que estar publicado o programado para atarle una versión: **publica el evento y después publica ese borrador con «Junto a un evento»**; el editor del evento te lo recuerda. El panel no lo ata ni lo publica solo.
- El evento se valida con ese parche de base, y el parche se valida con el evento encima (rutas `content.patch…`).

## 6. Rangos y límites

Salen de `src/game/content/limits.ts`; esta tabla se regenera con `npm run admin:schema`.

<!-- limits:start (generado por npm run admin:schema; no editar a mano) -->
| Campo | Rango o límite |
| --- | --- |
| `featured` (especies destacadas) | como mucho 20 |
| `featured[].weightMult` | ×1 a 10 |
| `shiny.chance` | 0 a 0.05 (fracción: 0 % a 5 %) |
| `legendaryChanceMult` | ×1 a 10 |
| `drops` (objetos que caen) | como mucho 10 |
| `drops[].perWaveChance` | 0 a 1 (fracción: 0 % a 100 %) |
| `drops[].max` (por sesión) | 1 a 99 |
| `missions` (misiones de evento) | como mucho 10 |
| `missions[].target` | 1 a 100000 |
| `missions[].minMinutes` (solo `longSession`) | 15 a 600 min |
| `missions[].minTrainerLevel` | 1 a 100 lv |
| `missions[].rewards` (tramos de recompensa) | de 1 a 6 |
| recompensa `dust` | 0 a 100000 |
| recompensa `items[slug]` (unidades) | 1 a 99 |
| recompensa `typeCandies` | 1 a 100 |
| recompensa `randomItem.count` | 1 a 10 |
| `items` (objetos propios del evento) | como mucho 20 |
| nombres y títulos (`name`, `missions[].title`, `items[].names`) | 1 a 80 caracteres |
| `description` del evento | 1 a 400 caracteres **visibles** (las marcas no cuentan) |
| `missions[].description`, `items[].description` | 1 a 400 caracteres |
| duración del evento (`endsAt` − `startsAt`) | como mucho 62 días |
| `patch.species[].captureRate` | 1 a 255 |
| `patch.species[].spawn.weightMult` | ×0 a 20 |
| `patch.species[].spawn.hours` (franjas `[desde, hasta)`) | horas 0 a 24 h, como mucho 6 franjas |
| `patch.species[].spawn.minTrainerLevel` | 1 a 100 lv |
| `patch.moves[].power` | 1 a 250 |
| `patch.moves[].accuracy` | 1 a 100 % |
| `patch.missions.dailyCount` / `weeklyCount` | 0 a 6 |
| `patch.missions.pool` (misiones diarias y semanales) | como mucho 100 |
| `patch.techniques[].limitPerSession` / `limitPerWeek` | 1 a 20 |
<!-- limits:end -->

Además, cualquier número fuera de rango, texto demasiado largo o campo desconocido se rechaza. Algunos valores grandes (peso de una destacada > ×3, legendarios > ×3, shiny > ×5 la base) **no son errores**, pero al publicar el admin tendrá que marcar la casilla de confirmación; el validador los avisa.

## 7. Consultar los valores válidos

No hace falta abrir ningún archivo: el validador lista lo que existe, un valor por línea (slug, número y nombres):

```bash
npm run admin:validate -- --list species        # especies (y cuáles son legendarias)
npm run admin:validate -- --list items          # objetos del juego y objetos de misiones
npm run admin:validate -- --list moves          # movimientos
npm run admin:validate -- --list techniques     # técnicas editables
npm run admin:validate -- --list abilities      # habilidades editables
npm run admin:validate -- --list types          # tipos
npm run admin:validate -- --list mission-kinds  # tipos de misión
npm run admin:validate -- --list config         # claves de config editables, con su rango
```

Los datos están en `src/data/game/` (`species.json`, `items.json`…). Un evento puede usar también los objetos propios de **otros eventos ya publicados o archivados**; esos no salen en la lista (el validador sin servidor los dará por desconocidos: el panel y el servidor sí los conocen).

## 8. Lo que el formato no puede hacer

- **Subir la imagen** (se sube en el editor).
- **Cambiar la configuración desde un evento**: un evento solo toca especies destacadas, shiny, legendarios, drops, misiones y objetos propios. Para cambiar parámetros usa un parche de contenido (`content` atado o el formato de contenido).
- **Cambiar en vivo** `session.*`, `focus.*`, `statCurves`, `starters`, nivel máximo… (ni crear especies, movimientos o técnicas nuevas, ni borrar misiones): se rechazan como «campo desconocido o no editable».
- **Publicar, programar o atar** nada: eso lo hace el admin en el panel, con su contraseña.

## 9. Ejemplos

Los cuatro ejemplos se validan en un test (`src/game/content/adminJson.test.ts`), así que son correctos con los datos actuales.

### 9.1 Evento sencillo

```json
{
  "format": "pokefocus.event@1",
  "slug": "semana-pikachu-2026",
  "name": { "es": "Semana Pikachu", "en": "Pikachu Week" },
  "description": {
    "es": "**Pikachu** sale mucho más.\n- Más probabilidad de encontrarlo\n-[yellow] Shiny aumentado para las destacadas",
    "en": "**Pikachu** shows up much more.\n- Higher chance to find it\n-[yellow] Boosted shiny for the featured species"
  },
  "startsAt": "2026-12-01T00:00:00-05:00",
  "endsAt": "2026-12-08T00:00:00-05:00",
  "imageNote": "Imagen de Pikachu con fondo amarillo, sin texto cerca de los bordes.",
  "featured": [{ "species": "pikachu", "weightMult": 3 }],
  "shiny": { "chance": 0.008, "scope": "featured" }
}
```

### 9.2 Evento con misiones, drops y objeto propio

```json
{
  "format": "pokefocus.event@1",
  "slug": "noche-electrica-2026",
  "name": { "es": "Noche eléctrica", "en": "Electric Night" },
  "description": {
    "es": "Una semana **eléctrica**: premios extra y [yellow]misiones especiales[/yellow].",
    "en": "An **electric** week: extra rewards and [yellow]special missions[/yellow]."
  },
  "startsAt": "2026-12-14T18:00:00-05:00",
  "endsAt": "2026-12-21T18:00:00-05:00",
  "featured": [
    { "species": "pikachu", "weightMult": 3 },
    { "species": "eevee", "weightMult": 2 }
  ],
  "legendaryChanceMult": 2,
  "items": {
    "spark-token": {
      "names": { "es": "Ficha chispa", "en": "Spark token" },
      "description": { "es": "Recuerdo de la Noche eléctrica.", "en": "A keepsake of Electric Night." }
    }
  },
  "drops": [
    { "item": "poke-ball", "perWaveChance": 0.2, "max": 3 },
    { "item": "spark-token", "perWaveChance": 0.1, "max": 2 }
  ],
  "missions": [
    {
      "id": "atrapa-electricos",
      "kind": "catchType",
      "type": "electric",
      "target": 5,
      "title": { "es": "Cazador eléctrico", "en": "Electric hunter" },
      "description": { "es": "Atrapa {n} Pokémon de tipo {type}.", "en": "Catch {n} {type}-type Pokémon." },
      "rewards": [
        { "dust": 100, "items": { "great-ball": 2 } },
        { "minTrainerLevel": 10, "dust": 250, "typeCandies": 3, "items": { "spark-token": 1 } }
      ]
    },
    {
      "id": "sesion-larga",
      "kind": "longSession",
      "minMinutes": 45,
      "target": 2,
      "title": { "es": "Concentración total", "en": "Total focus" },
      "description": { "es": "Haz {n} sesiones de al menos {minutes} minutos.", "en": "Finish {n} sessions of at least {minutes} minutes." },
      "rewards": [{ "dust": 150, "items": { "spark-token": 1 } }]
    }
  ]
}
```

### 9.3 Evento con contenido atado

```json
{
  "format": "pokefocus.event@1",
  "slug": "fin-de-semana-fantasma-2026",
  "name": { "es": "Fin de semana fantasma", "en": "Ghost Weekend" },
  "description": {
    "es": "Por la **noche** salen más Pokémon fantasma.",
    "en": "More **Ghost** Pokémon appear at night."
  },
  "startsAt": "2026-12-04T18:00:00-05:00",
  "endsAt": "2026-12-07T06:00:00-05:00",
  "imageNote": "Pendiente: ilustración de Gastly de noche.",
  "featured": [{ "species": "gastly", "weightMult": 3 }],
  "content": {
    "title": "Fantasmas de noche",
    "note": "Atado a fin-de-semana-fantasma-2026",
    "applyOver": "live",
    "revertWhenEnds": true,
    "patch": {
      "species": { "gastly": { "spawn": { "hours": [[19, 24], [0, 6]] } } }
    }
  }
}
```

### 9.4 Contenido

```json
{
  "format": "pokefocus.content@1",
  "title": "Ajuste de capturas de Eevee",
  "note": "Eevee un poco más fácil de atrapar",
  "applyOver": "live",
  "patch": {
    "species": { "eevee": { "captureRate": 60 } },
    "config": { "encounters": { "shinyChance": 0.0015 } }
  }
}
```

## 10. Errores frecuentes

| Error | Causa |
| --- | --- |
| «Fecha no válida» | Falta la zona (`-05:00` o `Z`) o el día no existe. |
| «Identificador no válido» | Mayúsculas, espacios, tildes o guiones bajos en un slug. |
| «Campo desconocido o no editable» | Un campo inventado o una clave de `config` que no se puede cambiar en vivo (`--list config`). |
| «No existe la especie / el objeto» | Slug inventado o con el nombre en vez del slug (`pikachu`, no «Pikachu»). |
| «Demasiado grande / pequeño» | Un valor fuera de rango (sección 6); recuerda que las probabilidades son fracciones. |
| «El shiny «solo destacados» necesita al menos una especie destacada» | `shiny.scope: "featured"` sin `featured`. |
| «Ya existe ese objeto en el juego» | Un `items` propio con el slug de un objeto del juego: usa otro. |
| «Ya hay un borrador / un evento con ese identificador» (panel) | El slug existe: el panel ofrece actualizar el borrador o crear otro con otro slug; si el existente está publicado o archivado, solo otro slug. |
