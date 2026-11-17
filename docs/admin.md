# Guía del administrador

Cómo cambiar el juego **en vivo** (números, apariciones, misiones y eventos) sin desplegar, y cómo cuidar el servidor mientras tanto. Está escrita para quien opera PokeFocus; los detalles de la API están en [`server.md`](server.md), el diseño original en [`admin-plan.md`](admin-plan.md) y lo que hace el motor con el contenido en [`engine-api.md`](engine-api.md) («Contenido en vivo»).

La pantalla es `#/admin` (no aparece en el menú: se entra por la dirección, p. ej. `https://tu-sitio/#/admin`). Tiene cinco pestañas: **Contenido**, **Eventos**, **Jugadores**, **Métricas** y **Mantenimiento**. El servidor es quien decide qué puede hacer cada rol; la pantalla solo oculta lo que se rechazaría.

## 1. Roles y cómo dar el rol admin

| Rol | Puede |
|---|---|
| `player` | Jugar. No ve nada de administración. |
| `support` | **Leer** el contenido en vivo, las versiones y las simulaciones; **Métricas**; buscar jugadores y ver su ficha; desbloquear nombre/país/zona horaria, cancelar una sesión atascada y cerrar sus sesiones de login (solo sobre cuentas `player`). |
| `admin` | Todo lo anterior sobre cualquier cuenta, más: editar borradores, validar, simular, publicar, programar, hacer rollback, gestionar eventos e imágenes, **conceder objetos y Polvo**, y los avisos de mantenimiento. |

Los roles nunca se piden desde la app. Para dar el rol:

1. **Registra la cuenta** con el flujo normal de la app (el correo no se verifica, así que usa uno tuyo).
2. Pon el correo en `ADMIN_EMAILS` (varios, separados por comas) y **reinicia el servidor**. Al arrancar, esas cuentas pasan a `admin` (no se baja a nadie de rango; quitar un correo de la lista no le quita el rol). Si la cuenta no existe todavía, el arranque lo avisa en el log: registra primero y reinicia.
   - Con Docker: `ADMIN_EMAILS=tu@correo.com` en `.env` y `docker compose up -d`.
3. Alternativa en desarrollo o desde una máquina con acceso a la base: `npm run admin:role -- tu@correo.com admin` (roles `player|support|admin`). Con PGlite hay que parar el servidor antes. **Dentro de la imagen de producción este comando no está disponible** (el Dockerfile no copia `scripts/admin-role.ts`): usa `ADMIN_EMAILS`.

Para dar `support` a otra persona usa el CLI (`npm run admin:role -- otro@correo.com support`); `ADMIN_EMAILS` solo promueve a `admin`. No hay pantalla para cambiar roles.

> `ADMIN_TOKEN` está **en desuso** y se quitará en la próxima versión. Solo abre los avisos de mantenimiento y nunca toca datos de jugadores. Déjalo vacío y usa tu cuenta admin.

### Reautenticación («modo sudo»)

Las acciones delicadas piden **volver a escribir tu contraseña**: publicar, programar, cancelar una programación, rollback, conceder objetos o Polvo, publicar o archivar un evento, **notificar a los jugadores** y editar un evento ya publicado. La pantalla abre un diálogo cuando hace falta. La contraseña da un permiso de **30 minutos solo en esa sesión del navegador**; pasado ese tiempo se vuelve a pedir. Cinco contraseñas erróneas en 15 minutos bloquean los intentos un rato.

## 2. Contenido: del borrador a producción

Todo cambio de contenido es una **versión**. (Publicar desde la pantalla de administración no la recarga ni cierra la pestaña o el editor abiertos; el resto de pantallas sí se recargan con el contenido nuevo.) Una versión publicada es **inmutable**: no se edita, se publica otra encima. Cada versión es un *parche completo sobre los datos base del repositorio* (no una diferencia con la versión anterior), así que volver atrás es republicar un parche antiguo.

Qué se puede cambiar (todo con límites; lo que no está en la lista se rechaza):

- **Parámetros** (formularios agrupados: Encuentros, Captura, Energía, Acciones, Economía, Ligas, Condiciones), con el valor base al lado.
- **Especies**: tasa de captura y reglas de aparición (activar/desactivar, multiplicador de peso, horas, clima, nivel mínimo de entrenador).
- **Movimientos**: potencia y precisión.
- **Técnicas, habilidades y misiones**: se editan como JSON en la sección **Avanzado** (con «Copiar de la base»); el esquema los valida al escribir.
- **No se puede** cambiar en vivo: `session.*`, `focus.*`, `statCurves`, `starters`, `historyLimit`, el nivel máximo, etc. (se leen al arrancar o invalidarían partidas). Ni borrar especies, movimientos o definiciones de misión (se desactivan con `weight: 0` / `enabled: false`).

### El flujo

1. **Borrador.** En *Contenido*, crea un borrador a partir de lo que está en vivo, de una versión anterior (copiar), en blanco o **importando un JSON** (ver «Importar y exportar con JSON», en §3). «Borrador nuevo…» pide **un nombre** en un diálogo y no crea nada hasta que lo confirmas (cancelar no deja borradores vacíos). Se guarda solo mientras escribes y **se guarda aunque tenga errores**: así no pierdes trabajo. Máximo 20 borradores abiertos.
2. **Validar.** La pestaña *Revisión* muestra los errores (que bloquean) y los avisos en vivo, y el botón **Validar** ejecuta la validación completa en el servidor: forma, referencias (especies, movimientos y objetos que existen), umbrales de liga crecientes (toda la escalera de subrangos: escalón 2 por debajo de Super 1 y último escalón por encima de Maestra 1), **cobertura de apariciones** (para cada hora, clima y tramo de nivel debe haber al menos 5 especies no legendarias con peso), ids de misión inmutables, y una **prueba de humo** del motor (unas 200 sesiones sintéticas sin NaN ni excepciones). Tarda ~0,3 s.
3. **Vista previa de apariciones** (opcional): qué especies y con qué probabilidad salen para una hora, un clima y un nivel dados, con el borrador frente a lo vivo (y con un evento encima, si eliges uno).
4. **Simular** (muy recomendable). Pestaña *Simulación*: el simulador de balance juega los mismos perfiles y semillas con el parche **activo** y con el del **borrador**, y compara puntos semanales, ligas alcanzadas, capturas, legendarios y shinies, Polvo y Energía. Por defecto 3 perfiles, 4 semillas, 4 semanas (máximo 20 semillas, 8 semanas, 480 «jugador-semana» en total). Solo corre **una simulación a la vez** en todo el servidor (otra petición recibe «ocupado»), con un tope de 5 minutos. Los eventos no entran en la simulación. Un resultado vale 7 días y solo para el parche exacto que se simuló: si editas el borrador, hay que repetirla.
   - Simular **no es obligatorio**: publicar sin una simulación reciente se permite, pero la pantalla lo avisa y el registro de auditoría anota que se publicó sin simular.
5. **Revisar el diff.** La pestaña *Revisión* lista cada ruta cambiada con su valor antes y después.
6. **Publicar o programar.** *Publicar ya*, o *Programar* con una fecha de **como mucho 60 días** por delante (la pantalla muestra tu zona horaria y la hora en UTC), o *Junto a un evento* (ver abajo). Pide la contraseña (sudo) y, si hay avisos de cambio grande, el tick de confirmación (ver abajo). El servidor **vuelve a validar** al publicar; con errores no se publica.
7. **Rollback.** En *Versiones*, **Republicar** sobre una versión que ya estuvo en vigor: crea una versión **nueva** (título «Rollback to #N») con el parche antiguo, en vigor ya. No borra nada del historial. Una versión *programada para más tarde* seguirá sustituyéndola cuando llegue su hora.
8. **Cancelar una programación.** Mientras una versión programada no haya entrado en vigor, *Versiones* (y su ficha) tiene **Cancelar programación** (admin + sudo): vuelve a ser un **borrador** con el mismo contenido, que puedes editar, borrar o programar de nuevo. Una versión que ya está en vigor no se puede cancelar: se sustituye con otra publicación o con un rollback. La tarjeta de una versión programada dice **Empieza** (no «Desde», que es para la que ya está en vigor).

### Contenido junto a un evento

La tercera opción del diálogo de publicar, **Junto a un evento**, ata la versión a un evento para que **entre en vigor a la vez que él**:

- El selector lista los eventos **publicados o programados que no hayan terminado** (nombre y fechas en tu zona horaria). Al elegir uno, el diálogo dice cuándo entrará en vigor: **al empezar el evento**, o **ahora mismo** si el evento ya está en marcha. No se puede elegir a la vez una fecha propia. Valen las mismas reglas que un publicar normal (validación completa, tick ×3 / ×5, contraseña); queda en la auditoría como `content.schedule` con el evento.
- **Sigue al evento.** Mientras la versión esté programada, si **cambias las fechas del evento** (un evento publicado, desde su editor) la versión se mueve con él en el mismo guardado; si el nuevo inicio ya pasó, entra en vigor al momento. Si **archivas el evento antes de que empiece**, sus versiones programadas **vuelven a borrador** (como *Cancelar programación*; el editor y la respuesta lo dicen) y puedes publicarlas de otra forma. Si el evento **ya empezó**, archivarlo o cambiar sus fechas **no toca** lo que ya está en vigor.
- **Volver a lo anterior cuando termine el evento** (casilla opcional). Además de la versión del evento, se programa para el **fin del evento** una segunda versión (título «Back after <slug>») que es una **copia de lo que esté en vigor justo antes de que empiece** (sin contar la versión atada; si no hay nada publicado, la base). Está atada al mismo evento: se mueve si cambias el **fin**, se cancela (vuelve a borrador) con el evento y, si cancelas a mano la versión de inicio, **se va con ella**; también puedes cancelarla sola.
- **Qué pasa si publicas otra versión a mano mientras tanto**: la vuelta **sigue programada** y se aplicará al terminar el evento con lo que copió, es decir, **pisará** esa otra versión. No se recalcula ni se cancela sola. Para avisarte, la versión de vuelta muestra un **aviso ámbar** («después de programar esta vuelta se publicó o programó otra versión…») en la lista de versiones, en su ficha, en la tarjeta *Programada* y en el editor del evento, cuando hay otra versión (no atada a ese evento) que entra en vigor entre el inicio y el fin del evento, o cuando lo que había antes del inicio ya no es lo copiado. Revísala y cancélala si no la quieres (una versión que programes *después* del fin del evento no cuenta: es lo que quieres que mande).
- Dónde se ve: la lista de versiones y las tarjetas dicen **«con el evento X»** (o «vuelta a lo anterior al terminar el evento X»), y el editor de cada evento tiene la sección **Contenido atado a este evento** con un enlace a cada versión, su estado (programada, en vigor, ya entró) y el aviso de que se moverán / se cancelarán si cambias las fechas o archivas.
- Límites: una versión atada solo se crea al publicar un borrador; una versión que **ya está en vigor** conserva el nombre del evento pero ya no se mueve, y los borradores no llevan ninguna atadura.

Qué ven los jugadores y cuándo: los jugadores descargan el contenido al abrir la app y cuando el servidor les avisa (cada 30 s como mucho). **Una sesión de estudio conserva el contenido con el que empezó** hasta que se acaban sus oleadas, así que publicar a mitad de una sesión no la cambia. Lo que **sí** afecta a todos de golpe, porque afecta a lo que ya tienen: caramelos, topes de nivel, técnicas y habilidades de Pokémon ya capturados, y los umbrales de liga de la semana en curso. La pantalla de publicación lo avisa; para los umbrales de liga conviene programarlos a primera hora del lunes (la semana de liga empieza el lunes en la zona horaria de cada jugador, así que no hay un único instante limpio).

### Qué pide confirmación (×3 / ×5)

El servidor marca como **aviso que exige confirmar** cualquier cambio grande respecto a **lo que está en vivo ahora** (la versión en vigor; si no hay ninguna publicada, la base). Un borrador creado «desde lo vivo» no vuelve a pedir confirmación por valores que ya estaban en vivo y que no toca; sí la pide un valor que se aleja más de lo vivo, o uno que vuelves a poner en la base cuando lo vivo ya estaba lejos de ella. El aviso muestra los números igual que la tabla (una probabilidad en %, no 0,00136 → 0,01):

- un número que se **multiplica o divide por más de 3** (multiplicadores, pesos, recompensas…);
- una **probabilidad que se multiplica por más de 5**;
- en eventos: peso de una especie destacada > ×3, multiplicador de legendario > ×3 y probabilidad de shiny > ×5 sobre la base. Al **editar un evento publicado** solo se pide confirmar los valores grandes que la edición cambia, no los que ya se confirmaron al publicarlo.

Hasta que marques la casilla de confirmación, publicar devuelve «confirmación requerida». Los avisos sin esa marca (p. ej. los de cambio con efecto inmediato) se muestran pero no bloquean.

## 3. Eventos

*Eventos* (solo admin): lista por estado (borrador, publicado, archivado) y un editor. Un evento es un **sobre** de reglas que se activa entre dos fechas y **no puede cambiar la configuración**: solo estas cosas.

- **Datos**: identificador (*slug*, único **para siempre**, también entre archivados), nombre y descripción en español e inglés, inicio y fin (duración máxima 62 días) y **imagen** (opcional).
- **Especies destacadas** (hasta 20, peso ×1–10; siguen sin salir por debajo de su nivel mínimo).
- **Shiny del evento**: probabilidad (hasta 5 %) y alcance (todas las especies o solo las destacadas). Se usa si es mayor que la base.
- **Multiplicador de legendario** (×1–10).
- **Drops**: objetos del evento, probabilidad por oleada (0–100 %) y **máximo por sesión** (1–99). Se tiran con un azar aparte: no cambian qué salvajes salen.
- **Misiones de evento** (hasta 10) y **objetos propios** (hasta 20; conservan su nombre en el inventario cuando el evento termina, también si se archiva).

#### Cómo leer la probabilidad de una destacada y qué escribir en la descripción

Junto a cada especie destacada, el editor muestra una **estimación** de su probabilidad **por Pokémon salvaje** (no por oleada), sin el evento y con él, para un **nivel de entrenador de referencia** que eliges (1, 10, 20 o 30):

- Se lee así: «1 de cada 70» significa que, de cada 70 Pokémon salvajes que salen, uno es esa especie. Cada oleada trae varios salvajes (de 2 en Base 1 a 10 en Maestra 5 o más; ~4 en Super 1), así que la probabilidad de **ver al menos uno en una oleada** es mayor: `1 − (1 − p)^n`. Con p = 1,5 % y 6 salvajes, ≈ 9 %.
- Es una **estimación con condiciones neutras**: hora 12, clima despejado, sin reglas de admin ni otros eventos, sin condición del día, sonido ni equipo (esos factores mueven el número de cada jugador: los tipos con condición activa salen ×2, los del equipo ×1,25, etc.). La tabla *Vista previa de apariciones* de más abajo usa el contenido real (con tus reglas de admin y la hora y el clima que elijas) y es la referencia final.
- Si la especie **no puede aparecer a ese nivel** (p. ej. una evolución final a nivel de entrenador 1), el editor lo avisa en ámbar con el nivel desde el que sí sale. Una evolución que ningún nivel alcanza como salvaje no sale nunca por sí sola: destacarla no cambia nada. Los legendarios tampoco cambian de frecuencia por destacarlos (usa el multiplicador de legendarios).
- Al validar (en el editor y en el servidor) hay un **aviso** (no un error, no pide confirmación) si una destacada solo sale como salvaje a partir del nivel de entrenador 20 o superior, o nunca. Se puede publicar igual; los jugadores con nivel bajo la ven **atenuada** y con la etiqueta «Desde nv. N» en la ventana y la página del evento, sin ocultarla.

**Cómo redactar la descripción con expectativas realistas.** El editor sugiere la frase: «1 de cada N salvajes es X; en una oleada de ~4 salvajes la probabilidad de ver al menos uno es ≈ P % (de media 1 cada K oleadas)». Úsala como base y no prometas más de lo que da el número: con ×3 una especie común pasa de ~1,5 % a ~4 % por salvaje, es decir, **de media una por cada ~6 oleadas**, no «aparece por todas partes». Mejor «sale bastante más a menudo» que «lluvia de X»; si es una evolución final, di desde qué nivel sale. La probabilidad también aparece al jugador en la Pokédex («Aparición: ≈1 de cada N salvajes a tu nivel») con un «?» que explica las oleadas.

Vida de un evento:

1. **Borrador** (se guarda aunque tenga errores semánticos; máximo 50 borradores). La vista previa de apariciones usa el evento aunque sea borrador.
2. **Publicar** (admin + sudo): necesita fin en el futuro e inicio a como mucho 60 días vista; con inicio futuro queda **programado**. Se valida con la prueba de humo y pide el tick de confirmación si hay cambios grandes.
3. **Editar un evento publicado** también pide sudo y validación completa; el *slug* ya no se puede cambiar. Se aplican las mismas comprobaciones de fechas que al publicar: el fin tiene que estar en el futuro y el inicio a como mucho 60 días vista (un evento ya en marcha, con el inicio en el pasado, se puede seguir editando; uno ya terminado solo si no tocas sus fechas, p. ej. para corregir un texto). El cambio se aplica **a la vez**, pero las sesiones ya empezadas siguen con lo suyo. Cada edición guarda una revisión. Si cambias las fechas, el contenido programado atado al evento se mueve con ellas (el editor avisa antes de guardar).
4. **Archivar** (admin + sudo): el evento sale del juego y de la página pública al instante. Si **aún no ha empezado**, el contenido programado atado a él vuelve a borrador (ver «Contenido junto a un evento», en §2). Los jugadores que ya empezaron una sesión durante el evento la terminan con sus reglas. Los borradores se pueden **borrar**; los publicados solo se archivan.
5. **Notificar a los jugadores** (admin + sudo; solo eventos publicados que no hayan terminado, activos **o programados**). Botón *Notificar a los jugadores…* del editor (desactivado si hay cambios sin guardar: los jugadores ven la versión guardada). El diálogo de confirmación dice **cuántos jugadores hay conectados ahora** (el servidor cuenta las conexiones abiertas; solo vale para un servidor) y cuántas veces se ha avisado ya. Al confirmar, la ventana del evento vuelve a salir a **todos**, también a quienes ya la cerraron, y a quienes abran el juego más tarde. Para un evento programado la ventana dice «Próximamente» con la fecha de inicio. Máximo **5 avisos por hora y por evento**; cada uno queda en la auditoría (`event.announce`) y no cambia la revisión ni el contenido del juego.

### La ventana del evento

Los jugadores ven una ventana con la imagen grande, el nombre, la descripción con formato, las fechas en **su** zona horaria, las especies destacadas y los botones *Ver evento* (lleva a `#/events`) y *Cerrar*:

- Sale **sola** cuando hay un evento activo que ese dispositivo aún no ha visto (una vez por evento y por aviso; se recuerda en el navegador, así que otro dispositivo o borrar los datos del sitio la vuelve a mostrar). Con *Notificar a los jugadores* sale otra vez.
- **Nunca durante una sesión de estudio** (en marcha, en pausa, esperando el reclamo, oleadas de captura o descanso), ni encima de una pista de Profe Pika, de otro diálogo ni de «¿Qué hay de nuevo?» (esa va primero). Se pospone y sale cuando el jugador vuelve al inicio o a los resultados. Si hay varias, de una en una. Si el jugador ya está en `#/events`, se da por vista sin abrirla.

### Formato de la descripción

La descripción (y solo ella) admite un formato propio y seguro; no hay HTML. Se guarda como texto con estas marcas:

| Marca | Resultado |
| --- | --- |
| `**texto**` | negrita |
| `*texto*` | cursiva |
| `[red]texto[/red]` | color: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink` (nombres en inglés en lo guardado; el editor los muestra traducidos: rojo, naranja, amarillo, verde, azul, morado, rosa) |
| `- texto` (al principio de la línea; también `• `) | punto de lista; varias líneas seguidas forman una lista. El botón **«• Lista»** pone o quita la viñeta en las líneas seleccionadas |
| `-[green] texto` | punto de lista con la viñeta de color (mismos colores que arriba; sin color, amarilla). El selector **«Color de viñeta»** lo aplica a las líneas seleccionadas |
| `\*`, `\[`, `\\` | muestran `*`, `[` y `\` tal cual |

Se puede anidar (`**a [red]b[/red]**`, hasta 6 niveles). Lo que no se entiende (etiqueta desconocida como `[rojo]`, cierre sin apertura, marca sin cerrar) **se ve como se escribió**. Los asteriscos rodeados de espacios (`2 * 3`) no son formato. El editor tiene una barra con *Negrita*, *Cursiva* y los siete colores (envuelven la selección) y una **vista previa en vivo** idéntica a lo que verá el jugador. Los colores son una paleta fija pensada para el tema oscuro. **Límite**: 400 caracteres **visibles** por idioma (las marcas no cuentan); lo guardado puede llegar a 1200 caracteres en total. La tarjeta de `#/events` y la ventana muestran el formato; el banner y el resto de textos cortos, no.

Cuando cae un objeto de evento, el jugador lo ve en *Resultados* («Objeto (evento) +N») y en el informe de la sesión; las especies destacadas por un evento activo (el de la sesión, no el de ahora) llevan una marca discreta **Destacada** en las oleadas. Los jugadores ven los eventos en `#/events` (activos, próximos y pasados con tarjeta, cuenta atrás, destacadas, drops y misiones) y un **banner** del evento activo en la pantalla previa a la sesión. Las misiones de evento se pueden reclamar hasta 7 días después de que termine.

### Imágenes de eventos

Se suben desde el editor (PNG, JPEG o WebP, **hasta 3 MB**, como mínimo 320×180). El servidor **nunca guarda ni sirve el original**: lo vuelve a codificar a WebP 16:9 recortado desde el centro (máximo 1600×900), sin metadatos, y genera una miniatura de 480 px. Consejos:

- No pongas texto ni caras cerca de los bordes: el recorte 16:9 se hace desde el centro.
- No valen SVG, GIF (ni animados), HEIC ni HTML. Una imagen idéntica ya subida se reutiliza.
- Un borrado solo funciona si **ningún** evento (ni borrador ni archivado) usa la imagen. El almacén tiene un tope de 500 MB.
- Los ficheros están en `UPLOADS_DIR/events/<sha256>.webp`: son parte de lo que hay que respaldar (§6).

### Importar y exportar con JSON

Para no ajustar campo a campo, un evento o un cambio de contenido puede **describirse a un asistente (Claude) y entrar por un JSON**. El formato está documentado para el asistente en [`admin-json.md`](admin-json.md) (versionado: `pokefocus.event@1` y `pokefocus.content@1`; JSON Schema en `docs/admin-json/*.schema.json`).

- **Eventos → «Importar JSON»** (en la lista, y dentro del editor de un evento nuevo o en borrador). Pega el texto (vale con las comillas ```json del chat) o sube un `.json`. El panel lo comprueba en el navegador con las **mismas reglas del servidor** (forma, referencias, reglas; la prueba de humo del motor se hace al publicar) y lista cada problema con su ruta dentro del JSON. Si es válido, **crea un borrador** (nunca publica) y abre el editor para que lo revises. Desde la lista, si el identificador ya existe: si es un **borrador**, puedes **actualizarlo** (se sustituyen sus campos; la imagen se conserva) o crear otro con otro identificador; si está publicado o archivado, solo otro identificador (son únicos para siempre). Desde el editor, «Importar JSON» **rellena el formulario** (sin guardar) conservando la imagen. La **imagen no va en el JSON**: se sube aparte, y el campo opcional `imageNote` se muestra como recordatorio.
- **Contenido atado**: si el JSON del evento trae `content`, se crea además un **borrador de contenido** (enlazado desde el aviso del editor). Para que entre en vigor con el evento: publica el evento y después publica ese borrador con **«Junto a un evento»** (y la casilla de volver a lo anterior si el JSON la pedía). Nada se ata ni se publica solo.
- **Contenido → «Importar JSON»**: crea un **borrador de contenido nuevo** con el parche. Con `applyOver: "live"` (por defecto) el JSON lista solo los cambios y se **mezclan sobre lo que está en vivo**; con `"base"` es un parche completo. Se puede cambiar en el diálogo. Luego se valida, se simula y se publica como cualquier borrador.
- **«Exportar JSON»** (en el editor de eventos y en el de contenido): el borrador o evento actual en el mismo formato, para copiarlo (a otro evento, o a un asistente para pedirle cambios). Las fechas salen en la zona de tu navegador; el contenido sale como parche completo (`applyOver: "base"`). La imagen y el contenido atado no se exportan.
- **Comprobarlo antes, sin servidor**: `npm run admin:validate -- archivo.json` valida con el mismo código (forma, referencias, reglas y prueba de humo) e imprime los errores con su ruta en español; `npm run admin:validate -- --list species|items|moves|techniques|abilities|types|mission-kinds|config` lista los valores válidos. `npm run admin:schema` regenera el JSON Schema y la tabla de rangos de `admin-json.md` (un test falla si están desactualizados).

## 4. Soporte de jugadores

*Jugadores* (support y admin): busca por correo, nombre de entrenador o código de amigo (2–60 caracteres, hasta 20 resultados). La ficha muestra perfil, rol, bloqueos de 30 días, un resumen de la partida (nivel, equipo, sesión activa), las últimas 20 sesiones y los navegadores con sesión abierta. Acciones, todas con un **motivo opcional** y todas auditadas:

- **Desbloquear** nombre, país o zona horaria (los cambios tienen un bloqueo de 30 días).
- **Cancelar la sesión** atascada. Es la misma acción `cancel` del jugador: sigue sus reglas normales (GDD §3.4: una sesión larga conserva los minutos) y **no sirve si la sesión ya pasó de su hora de fin**: esa la tiene que reclamar el jugador.
- **Cerrar todas sus sesiones** de login (no sobre ti mismo).
- **Conceder objetos o Polvo** (solo admin + sudo): **motivo obligatorio** (5–280 caracteres, queda en la auditoría), como mucho 10 tipos de objeto, 50 unidades de cada uno y 5000 de Polvo por petición. Límite de 20 concesiones cada 15 minutos. El jugador ve el cambio al instante.

`support` solo puede actuar sobre cuentas `player`; un admin sobre cualquiera.

## 5. Métricas

*Métricas* (support y admin): agregados por **día o semana UTC** (por defecto, últimos 28 días; máximo 120 tramos): jugadores activos, sesiones, minutos, puntos, oleadas, capturas, shinies y legendarios, reparto de Foco (bajo < 0,75, medio, completo ≥ 1) y una retención sencilla (de los activos del tramo anterior, cuántos volvieron). Salen de la tabla `session_log`, que guarda **una fila por sesión válida reclamada** (y por las sesiones largas canceladas que conservan minutos); la historia empieza el día que se aplicó esa migración. Nunca salen ids ni nombres de jugadores.

## 6. Copias de seguridad

Hay **tres cosas** que respaldar, y las tres hacen falta para restaurar:

1. **PostgreSQL** (cuentas, partidas, versiones de contenido y sus *snapshots*, eventos, metadatos de imágenes, auditoría, métricas). Con Docker:
   ```bash
   docker compose exec -T db pg_dump -U pokefocus pokefocus > backup-$(date +%F).sql
   ```
   Restaurar en una base vacía: `docker compose exec -T db psql -U pokefocus pokefocus < backup.sql`. En desarrollo, PGlite vive en `.data/pglite` (copia el directorio con el servidor parado); no es para producción.
2. **`UPLOADS_DIR`** (en Docker, el volumen `uploads` montado en `/app/.data/uploads`): las imágenes de eventos. La base solo guarda sus metadatos: **`pg_dump` solo no contiene las imágenes**, y restaurar una sin la otra deja eventos con la imagen rota. Con Docker: `docker compose cp app:/app/.data/uploads ./uploads-backup` (al restaurar, comprueba que los ficheros pertenecen al usuario `node`). Si pierdes el directorio pero conservas la base, volver a subir la misma imagen reescribe los ficheros (se nombran por su hash).
3. **`PASSWORD_PEPPER`**, **guardado aparte de la base** (un gestor de contraseñas, no en el mismo sitio que el volcado). Se mezcla en todos los hashes de contraseña: **si se pierde, nadie puede iniciar sesión** y no hay recuperación por correo. Para rotarlo, pon el valor nuevo en `PASSWORD_PEPPER` y el antiguo en `PASSWORD_PEPPER_PREVIOUS`; cada cuenta se re-hashea con el nuevo en su siguiente login. Quita el antiguo solo cuando ya no queden cuentas por migrar.

Haz una copia **antes de cada despliegue con migraciones** y antes de operaciones grandes (rollback masivo, borrar imágenes). Prueba una restauración al menos una vez.

## 7. Qué no hacer

- **No edites la base a mano** (`content_versions`, `content_snapshots`, `live_events`…). Las versiones publicadas son inmutables a propósito y las sesiones en curso se apoyan en sus *snapshots*; borrarlos o cambiarlos puede dejar sesiones sin su contenido. Todo lo que se puede hacer desde la pantalla debe hacerse desde la pantalla (queda auditado).
- **No publiques cambios grandes sin simular** ni sin leer el diff. El tick ×3/×5 existe para eso, no para saltártelo.
- **No cambies umbrales de liga a mitad de semana** sin necesidad: aplican de inmediato a la semana en curso.
- **Ligas con subrangos** (grupo *Ligas*): `weeklyThresholds.*` es el subrango 1 de cada liga, `secondRankPoints` el escalón Base 2 y `topRankPoints` el último (Maestra 25); los escalones intermedios se calculan solos (geométricos). Ahí también están el Polvo por subir de rango (`rankUpDust`) y el del podio (`podium`). En *Encuentros*: el tamaño de oleada por liga (`leagueWaveSize`, primer y último subrango), en cuántos subrangos crece (`leagueRampSubranks`) y el peso de 2.ª/3.ª etapa y de legendarios por liga (`leagueStageWeights`). El número de subrangos y los multiplicadores de puesto del podio no se editan en vivo.
- **No pierdas ni cambies `PASSWORD_PEPPER`** sin `PASSWORD_PEPPER_PREVIOUS`.
- **No pongas en `ADMIN_EMAILS` un correo que no controles**: el correo no se verifica, así que quien lo registre sería admin.
- **No uses `ADMIN_TOKEN`** ni lo compartas; está en desuso.
- **No arranques dos instancias del servidor** sobre la misma base: el aviso en vivo de contenido, los límites de uso, las notificaciones push y la cola de simulaciones viven en memoria del proceso.
- **No des `admin` por comodidad**: para ayudar a un jugador basta `support`; las concesiones y las publicaciones son de admin.
- **No esperes que archivar o hacer rollback «deshaga» lo ya ocurrido**: lo que los jugadores ya ganaron (drops, capturas, misiones reclamadas) se queda.
- **No reutilices el *slug* de un evento** archivado: es único para siempre; añade el año o la edición.
- **No hagas pruebas de carga ni abras la pantalla en muchas pestañas**: las peticiones de administración tienen límite (600 cada 15 minutos por persona, y límites propios por acción).

## 8. Mantenimiento programado

*Mantenimiento* (solo admin): avisa a los jugadores de una parada (banner con la hora en su zona). Es **solo informativo**: el servidor no se para ni se ralentiza solo. Ventana de hasta 14 días, nota de hasta 280 caracteres, como mucho 20 ventanas pendientes. Parar el servidor, desplegar o tocar la base sigue siendo manual.
