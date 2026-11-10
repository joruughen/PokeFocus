# PokeFocus — Documento de Diseño (GDD)

> Versión 0.1 · 2026-11-03 · Proyecto personal, uso privado entre amigos.
> Este documento es la fuente de verdad del diseño. Los números marcados con **[calibrar]** son valores iniciales que se ajustarán con el simulador de balance (ver §20).
> **Actualizado el 2026-11-06 con lo construido.** La F2 se hizo con un **servidor propio** (Node + Hono + PostgreSQL), no con Supabase, y el Foco por captura de pantalla con IA se **descartó** el 2026-11-05. Lo que cambió respecto al diseño inicial lleva la etiqueta "Diseño original (reemplazado por F2: …)". El detalle técnico de la F2 está en `docs/F2-plan.md` y `docs/server.md`; el estado y lo pendiente, en `docs/PENDING.md`.

---

## 0. Resumen

PokeFocus es una aplicación web de escritorio que recompensa el estudio con Pokémon. Cada sesión de estudio (pomodoro) hace que tu **equipo de 6 Pokémon** genere **Puntos de Equipo**, suba de nivel y aprenda técnicas. Al terminar la sesión aparece un **grupo de Pokémon salvajes** que puedes intentar capturar. Los Puntos de Equipo deciden tu **liga** y tu posición en los **rankings semanal y mensual** (de tus amigos, de tu país y global).

### Pilares de diseño

1. **Estudiar es el combustible; el equipo es el motor.** Sin estudio no pasa nada, pero dos personas con las mismas horas pueden obtener resultados muy distintos según cómo armaron su equipo.
2. **Nunca castigar, siempre premiar.** Las condiciones de tipo solo suman, perder una racha no quita lo ganado, y el análisis de micrófono no tiene respuestas "malas".
3. **Lo raro debe sentirse raro.** Los legendarios nunca están garantizados, pero el jugador puede prepararse para aumentar sus probabilidades.
4. **Siempre hay algo que mejorar.** Individuos únicos (IVs, naturaleza, habilidad, técnicas extra), límites de nivel ligados a la Pokédex y objetos de mejora para que el juego no se agote.
5. **Libertad para estudiar.** Puedes usar cualquier app o pestaña. El antitrampas se basa en que hacer trampa no compense, no en vigilar. Cambiar de pestaña o de aplicación nunca reduce las recompensas: el temporizador se calcula con marcas de tiempo (`endsAt`) y ni el motor ni el servidor leen la visibilidad de la página.

---

## 1. Plataforma y alcance

| Aspecto | Decisión |
|---|---|
| Plataforma v1 | **Web de escritorio** (Chrome, Edge, Firefox). Todas las funciones disponibles. |
| Celular | **Fuera de alcance en v1.** Los navegadores móviles no permiten mantener el micrófono en segundo plano. Más adelante se evaluará una app nativa. |
| Usuarios | Grupo de amigos, pensado para crecer (cientos o miles de usuarios). |
| Idioma | **Español e inglés** desde la v1 (i18n). El usuario lo elige en su perfil; por defecto, el idioma del navegador. Los nombres de Pokémon, técnicas, habilidades y naturalezas se toman de PokeAPI en ambos idiomas. |
| Copyright | Uso personal y privado, sin publicar. Se usan sprites y datos oficiales vía PokeAPI. |

---

## 2. Bucle principal

```
 Preparar equipo (6 Pokémon, 1–4 técnicas cada uno según su nivel)
        │
        ▼
 Sesión de estudio ──► el equipo actúa: genera Puntos, EXP, Polvo de Estudio y Energía
        │                   (modificado por condiciones de tipo, Foco y estadísticas)
        ▼
 Reclamar al terminar (ventana de 5 min)
        │
        ▼
 Oleadas salvajes (1 cada 25 min, 3–8 Pokémon) ──► la Energía les "baja la vida" (mín. 5%) según la tabla de tipos
        │
        ▼
 Captura (Ball de Estudio + Poké/Super/Ultra Balls; cada fallo = contraataque)
        │
        ▼
 Mejorar: EXP, caramelos, evoluciones, naturalezas, técnicas, Tera
        │
        └──► Ligas y rankings con los Puntos de Equipo
```

### 2.1 Cuentas, inicio y amigos

> **Construido en F2 con un servidor propio** (Node + Hono + PostgreSQL), **no con Supabase**. Detalle en `docs/F2-plan.md` y `docs/server.md`.

**Cuenta:**
- Registro **solo con correo y contraseña** (8–128 caracteres), con un **nombre de entrenador** (3–20 caracteres: letras, números, espacios y `_`; no es único, lo que identifica a cada jugador es el código de amigo) y un **país**, que se elige al registrarse y decide el ranking por país (§14). Ambos se pueden cambiar en Ajustes → Cuenta, pero cada uno queda **bloqueado 30 días** tras cambiarlo (el primer cambio es libre, y cada campo tiene su propio bloqueo), porque el país decide en qué ranking apareces y el nombre es tu identidad pública.
- Inicio y cierre de sesión. La sesión es un **token opaco en una cookie `HttpOnly`** (30 días deslizantes), no un JWT. Puedes tener **varias sesiones de login a la vez** (pestañas y dispositivos); en Ajustes → Cuenta se ven y se pueden cerrar una por una o todas a la vez, y se puede cambiar la contraseña (eso cierra las demás sesiones).
- **El progreso vive en el servidor** y se guarda con cada acción: al iniciar sesión en otro dispositivo, tu partida ya está ahí. La partida local del prototipo (F1) no se migró.
- Pendiente: recuperación de contraseña por correo (todavía no hay envío de correos).

**Primer inicio (onboarding):**
1. Idioma (ES/EN) y zona horaria (detectada automáticamente, se puede corregir). El clima real se configura después, en Ajustes (ubicación o ciudad, §9.2).
2. **Elegir un Pokémon inicial**: Bulbasaur, Charmander o Squirtle, a nivel 5, con 1 técnica. Así el equipo nunca empieza vacío.
3. 5 Poké Balls de regalo.
4. Explicación breve del bucle (sesión → oleadas → captura). El micrófono es opcional y se pide más tarde, desde la preparación de la sesión (§4.3).

**Amigos:**
- Se agrega por **código de amigo** (8 caracteres, compartible; no hay búsqueda por nombre).
- Enviar, aceptar, rechazar y cancelar solicitudes, y eliminar amigos. Si los dos se envían solicitud, quedan como amigos al instante.
- La lista de amigos muestra su equipo (el líder primero), nivel de entrenador, puntos de la semana y liga.
- **Estudiar con amigos:** una sala de grupo con invitaciones; el bonus del tipo Hada depende del tiempo acompañado (§9.2). Ver `docs/session-depth-plan.md` (paquete C).
- Intercambiar Pokémon (§12.8): F5, todavía no existe.

**Ajustes:** idioma, zona horaria (bloqueada 30 días tras cada cambio, §15), clima (usar mi ubicación, redondeada a ~10 km, o escribir una ciudad; sin enfriamiento), audio, micrófono y su calibración, notificaciones del navegador (fin de sesión, ventana de Reclamar), cuenta (nombre y país, con su bloqueo de 30 días; privacidad; contraseña; sesiones abiertas) y consejos.

**Diseño original (reemplazado por F2: servidor propio y solo correo, ver `docs/F2-plan.md`).** El diseño inicial usaba Supabase Auth e incluía varias cosas que F2 no construyó. Quedan como ideas, no como estado actual:
- Registro con Google y verificación de correo (las decisiones de F2 son solo correo y contraseña; la verificación y la recuperación por correo esperan a que haya envío de correos).
- Nombre de usuario único, con un cambio cada 30 días, y búsqueda de amigos por nombre.
- Eliminar la cuenta desde Ajustes.
- Opción de privacidad para aparecer como "Entrenador anónimo" en los rankings global y de zona. **Construida en v0.5.0** (Ajustes → Cuenta → Privacidad) para los rankings global y de país: los amigos y tu propia fila siguen viendo tu nombre, y el país se sigue mostrando.
- Bloquear usuarios, y ver si un amigo está "estudiando ahora" (la condición Hada pasó a usar los grupos de estudio).
- Perfil público con equipo y técnicas, medallas de liga, progreso de la Pokédex e historial.

---

## 3. La sesión de estudio

### 3.1 Duraciones

- Preajustes: **25, 50, 75 y 100 min** (múltiplos de 25, que es el tamaño de una oleada, §10.1), y duración personalizada de 15 a 120 min.
- El descanso es opcional y no da puntos, pero **completarlo recupera energía** del equipo (§5.3).
- La sesión puede pausarse. Usar pausas afecta a la condición del tipo Roca (§9).

### 3.2 Reclamar

- Al terminar el temporizador hay una **ventana de 5 min** para pulsar **Reclamar**.
- Si reclamas a tiempo, recibes el 100% de las recompensas. Si reclamas tarde, el 50% **[calibrar]**. Así, dejar el temporizador corriendo sin estar presente no compensa.

### 3.3 Rendimiento decreciente diario

| Minutos de estudio en el día (zona horaria del perfil) | Recompensas |
|---|---|
| 0 – 360 min | 100% |
| 360 – 600 min | 50% |
| > 600 min | 0% (la sesión se registra en las estadísticas, pero no da recompensas) |

### 3.4 Abandonar una sesión (decidido el 2026-11-09)

«Abandonar» corta la sesión mientras el temporizador corre o está en pausa. **Lo decide el servidor con su reloj**, en minutos enteros estudiados (`min(planeados, transcurrido − pausas)`; en pausa cuenta hasta el inicio de la pausa).

| Sesión | Qué se conserva |
|---|---|
| Planeada de **25 min o menos** | Nada (como siempre). |
| Larga (**más de 25 min**), con **menos de 15 min** estudiados | Nada (es el mínimo de cualquier sesión, §3.1). |
| Larga, con **15 min o más** estudiados | Los **puntos, la EXP y el Polvo de los minutos estudiados** (exactamente lo que daría una sesión completada de esa duración, con su Vínculo, Dominio, energía gastada y condiciones), y **una oleada por cada bloque de 25 min completo** (ninguna antes del primero). La energía de captura producida después del último bloque completo va a la última oleada, como en una sesión normal; sin bloque completo se pierde. |

Además, una sesión abandonada:
- **nunca es un reclamo tardío** (Foco 100 %), pero **solo se puede abandonar antes del fin**: con el temporizador ya terminado hay que reclamar, con la ventana de 5 min (§3.2). Así no sirve para esquivar el ×0,5;
- **no da las 2 Poké Balls por sesión** (§5.2), ni consume un turno de los legendarios errantes si no tiene oleadas. La Ball de Estudio sí, una por oleada;
- cuenta para la racha, los minutos del día (§3.3), la liga, las misiones de minutos, días y sesión larga (por los minutos estudiados), pero **no para «completa N sesiones»**;
- en un grupo de estudio sale del grupo (`left_reason = cancel`) y su bonus Hada es el tiempo acompañado ÷ el tiempo transcurrido desde que entró;
- no deja aviso: el temporizador desaparece, así que ni la campana ni el aviso push suenan.

**Por qué no se puede explotar:** lo que da es lo mismo que una sesión completada de la misma duración, con menos oleadas (`floor(min/25)` en vez de `max(1, floor(min/25))`) y sin las Poké Balls por sesión. Cancelar y volver a empezar da como mucho lo que daría planear esas dos sesiones más cortas desde el principio. Simulador (`npx tsx scripts/simulate-cancel.ts`, 10 semillas × 4 semanas, reclamos a tiempo): cancelar al 40/60/90 % rinde −2 % a −97 % de puntos frente a completar; cancelar al 50 % y reiniciar, entre −2,6 % y +2,9 % (ruido: el control «2 sesiones de la mitad» va de −3,2 % a +9,9 %). Polvo y oleadas nunca suben. Los perfiles que no cancelan no cambian.

---

## 4. Foco (índice de concentración)

**Foco** es un valor de 0.0 a 1.0 por sesión. Afecta a las **recompensas** (puntos, EXP, Polvo) y a la **calidad de los encuentros** (número de Pokémon, probabilidad de raros y shiny). El Aguante de cada Pokémon sube su propio Foco por encima del 100 % (hasta ×1.10, solo para sus puntos y su EXP; §5.1).

> **Estado (2026-11-06): la clasificación de pantalla con IA fue descartada (2026-11-05) y el Foco se simplificó.** El Foco no mira tu pantalla ni vigila otras pestañas o aplicaciones (principio 5). Es igual para todos y lo único que lo cambia es reclamar a tiempo (aparte de algunas habilidades: Foco Interno, Levitación…):
>
> `Foco = 1.0 si reclamas dentro de los 5 minutos tras terminar, 0.5 si tarde` (`focus.baseValue` × `session.lateClaimMultiplier`).
>
> Después el **Aguante** (Defensa) de cada Pokémon sube **su** Foco por encima del 100 %: `Foco_efectivo = Foco × (1 + 0.10 · min(1, Def / 200))` (§5.1), solo para sus puntos y su EXP. El Polvo, el tamaño de la oleada y las tiradas de legendario y shiny usan el Foco de la sesión, sin Aguante.
>
> Hasta el 2026-11-06 el valor base era 0.85 (el que el diseño original daba a "sin permiso de pantalla", `focus.noPermissionValue`) y el Aguante "recuperaba" parte del Foco que faltaba. Al pasar a 1.0 se multiplicaron por 0.85 los valores base (puntos por acción, EXP/min, Polvo/min, legendario; shiny ×0.9) para que las recompensas reales no cambien (verificado con el simulador). En lugar de las capturas, la fase F3 entregó el **perfil sonoro con el micrófono** (§4.3) y el **clima real** con Open-Meteo (§9.2); ver `docs/PENDING.md` (F3). En la configuración, `focus.model` y las claves de las capturas (`screenshotsPerSession`, `screenshotWindow`, `screenshotMinGapMinutes`, `missedCaptureValue`) quedan sin uso. Solo el panel de desarrollo (`DEV_TOOLS=1`) puede simular una etiqueta de pantalla, para probar el motor.

### 4.1 Componentes (diseño original, descartado el 2026-11-05)

> **Diseño original (reemplazado: la captura de pantalla con IA se descartó el 2026-11-05).** De esta tabla solo sobrevive **Reclamar a tiempo**; el resto se conserva como historia del diseño y no describe lo construido.

| Componente | Cómo se mide | Peso |
|---|---|---|
| **Capturas de pantalla con IA** | N fotogramas en momentos aleatorios de la sesión, clasificados por IA (§4.2) | Principal |
| **Reclamar a tiempo** | Pulsar Reclamar dentro de la ventana | Multiplicador |

**Clasificación de la captura** → valor:

| Etiqueta | Valor | Ejemplos |
|---|---|---|
| `estudiando` | 1.0 | Editor de código, Blender, PDF, documento, cuaderno digital |
| `material_educativo` | 1.0 | Tutorial en YouTube, clase en video, curso en línea |
| `chat` | 0.6 | Un chat ocupa la mayor parte de la pantalla |
| `redes_sociales` | 0.4 | Feed de redes sociales |
| `juego` | 0.2 | Un videojuego activo |
| `indeterminado` | 0.9 | La IA no puede decidir con confianza |

`valor_captura` = media de los valores de las N capturas de la sesión.

`Foco = valor_captura × (1.0 si reclamó a tiempo, 0.5 si tarde)`

Si el usuario no concedió el permiso de compartir pantalla: `valor_captura = 0.85` **[calibrar]**. Es un valor neutro que no penaliza mucho, pero da un pequeño incentivo para activarlo. *(Hoy, sin capturas, el valor base es 1.0: ver el estado al principio de §4.)*

### 4.2 Captura de pantalla: implementación (diseño original, no construido)

> **Diseño original, descartado el 2026-11-05.** Nada de esto existe en el código: no hay `getDisplayMedia`, ni llamada a un modelo de IA, ni captura que enviar. Se conserva por si algún día se retoma con otro enfoque.


- Al iniciar la sesión, la app pide `navigator.mediaDevices.getDisplayMedia()`. El navegador muestra su diálogo y el indicador de "compartiendo".
- **Número de capturas configurable:** `screenshots_per_session` (por defecto **1**) es un parámetro del servidor, no está fijado en el código. Subirlo solo multiplica el costo, así que se puede aumentar con más presupuesto o con un modelo más barato.
- Los momentos se eligen al azar **en el servidor** entre el 10% y el 95% de la duración, con al menos 3 min de separación entre capturas. El cliente no los conoce de antemano: el servidor le avisa cuando toca capturar.
- **Aviso al usuario:** al iniciar la sesión, la app dice: *"Durante la sesión se tomarán capturas de pantalla en momentos aleatorios para medir tu Foco."* **No dice cuántas**, así el usuario no sabe si ya pasó la última y se mantiene atento.
- Cada fotograma se reduce a un máximo de 1280 px de ancho y se envía al backend.
- El backend (Edge Function) llama a **Claude Haiku 5.5** (`claude-haiku-5-5`) con un prompt de clasificación y salida estructurada (`etiqueta`, `confianza`).
- **Privacidad:** la imagen **no se guarda**; se descarta tras clasificarla. Solo se guardan la etiqueta y la confianza. La API key vive solo en el servidor.
- **Costo estimado:** unos 1,500 tokens de entrada y 30 de salida por análisis, a $0.10 y $0.50 por millón respectivamente, ≈ **$0.0002 por captura**. Con 1 captura por sesión: 50 usuarios × 6 sesiones al día × 30 días ≈ **$1.50 al mes**. Escala de forma lineal: con 3 capturas por sesión, ≈ $4.50 al mes.
- El modelo es otro parámetro (`focus_model`), así que se puede cambiar sin tocar el código.
- **Principio del prompt:** ser generoso. Cualquier contenido que pueda ser material de estudio (tutoriales, documentación, software creativo) cuenta como estudio. Solo bajan el valor las distracciones evidentes.

### 4.3 Micrófono (perfil sonoro)

- Es opcional (interruptor en la preparación de la sesión, recordado en el navegador) y se analiza **en el navegador** con Web Audio API. **El audio nunca sale del dispositivo.**
- Solo funciona en un contexto seguro (`localhost` o HTTPS). Sin él, o sin permiso, se explica en una línea y la sesión sigue sin perfil.
- **El ruido propio del micrófono no cuenta como sonido.** Todo micrófono sisea y muchos zumban (armónicos de la red a 50/60 Hz). Por eso:
  - un filtro paso alto a 100 Hz quita el zumbido grave y los golpes en la mesa antes de medir nada;
  - la calibración mide el **perfil de ruido** del micrófono (potencia por celdas de 50 Hz entre 100 y 8000 Hz, mediana de los fotogramas en silencio);
  - a cada fotograma se le resta ese perfil (resta espectral: potencia − 2 × ruido, con un suelo pequeño) **antes** de calcular cualquier rasgo, y un pico tonal tiene que estar al menos 10 dB sobre el ruido de su banda, así que el siseo y el zumbido ya no parecen música;
  - **silencio = nada claramente por encima del ruido propio del micrófono** (menos de ~4–5 dB sobre el perfil, según la calibración);
  - el perfil se mantiene al día durante la sesión: baja enseguida si el cuarto está más callado y sube despacio (~1 min) solo con ratos de silencio o de ruido estable sin tonos, como un ventilador; nunca con voz ni música, y como mucho 12 dB sobre lo calibrado. Un cuarto ruidoso de verdad sigue siendo ruido ambiente.
- Cada 2 s se clasifica la ventana actual como `silencio` / `voz` / `música` / `ruido_ambiente` con reglas simples sobre el espectro ya limpio: nivel sobre el ruido del micrófono (silencio), planitud espectral (ruido), energía en la banda de voz (300–3400 Hz) con modulación y pausas (voz), y picos tonales con un espectro estable (música). Las pausas no cuentan, y el micrófono se libera al pausar, terminar o cancelar.
- **Calibración (~15 s), necesaria para activar el micrófono** en un dispositivo sin calibrar; se puede repetir en Ajustes y desde la preparación de la sesión. Paso 1, **obligatorio**: 5 s de silencio (perfil de ruido). Si se cancela, el micrófono queda apagado. Paso 2, recomendado (se puede saltar): 5 s hablando. Paso 3, opcional y explícito: "Pon música por los altavoces (5 s)" o "Saltar este paso". De esas medidas salen el perfil de ruido y umbrales personales (margen de silencio entre el ruido y la voz; referencias de banda de voz, modulación y estabilidad; picos tonales y estabilidad de la música si se midió), siempre dentro de límites razonables y con los valores estándar para lo que no se midió. Se guardan por dispositivo (navegador, por `deviceId` del micrófono, ~1 KB). Al terminar, una **comprobación en vivo** pide "Quédate en silencio: debería decir Silencio" y "Habla: debería decir Voz", con el medidor y una marca en cada una, y ofrece "Repetir calibración". Las calibraciones antiguas sin perfil siguen cargando: la sesión aprende el ruido de sus primeros ratos en silencio, y se pide calibrar otra vez al activar el micrófono.
- **El estilo es solo lo que mide el micrófono.** La música cuenta cuando suena por los altavoces (también la música de enfoque de la propia app, aceptado); la de los audífonos no se oye y no cuenta. No hay estilo declarado. Sin micrófono no se aplica nada de esto.
- **Transparencia.** Durante la sesión, el indicador dice lo que oye y cuánto lleva analizado ("Silencio · 3 min analizados"), o por qué no escucha (en pausa, permiso denegado, micrófono desconectado…). En Resultados, si el micrófono estaba activado en esa sesión, siempre hay una línea: el estilo dominante con los cuatro porcentajes, o por qué no se aplicó ("No se aplicó el micrófono: solo se analizaron 7 s (mínimo 30 s)", "… permiso denegado"). El navegador guarda para eso un pequeño registro de la sesión (segundos por tipo y el último problema); el servidor solo recibe los porcentajes.
- Al reclamar se envían solo los porcentajes, por ejemplo `{silencio: 0.62, música: 0.30, voz: 0.08, ruido: 0}` (cada uno entre 0 y 1, suma ≤ 1,05; hacen falta al menos **30 s** analizados). Antes era 1 min; se bajó porque las sesiones reales duran ≥ 15 min, así que el mínimo solo descarta muestras casi vacías (micrófono perdido al momento, reloj de desarrollo), y 15 ventanas bastan para unos porcentajes que solo inclinan un poco los encuentros.
- **No afecta al Foco.** Activa las condiciones de Volador (música o ruido ≥ 30 %) y Psíquico (silencio ≥ 70 %) (§9.2), y el perfil dominante, o **estilo de estudio**, inclina **ligeramente** qué tipos aparecen en el grupo salvaje:

| Perfil dominante | Tipos con algo más de probabilidad (×1.2) |
|---|---|
| Silencio | Psíquico, Fantasma, Hielo |
| Música | Hada, Normal, Eléctrico, Volador |
| Voz | Normal, Lucha |
| Ruido ambiente | Veneno, Roca, Acero |

El peso era ×1.5; se bajó a ×1.2 (`encounters.soundProfileWeight`) para que sea un matiz y no domine sobre las condiciones activas (×2) ni sobre los tipos del equipo (×1.25). El estilo se muestra en Resultados.

---|---|
| Silencio | Psíquico, Fantasma, Hielo |
| Música | Hada, Normal, Eléctrico, Volador |
| Voz | Normal, Lucha |
| Ruido ambiente | Veneno, Roca, Acero |

---

## 5. El equipo y la generación de puntos

- El **equipo activo** tiene 6 Pokémon. Solo se puede cambiar **entre sesiones**.
- Durante la sesión, cada Pokémon **actúa** cada cierto tiempo. Cada acción genera **Puntos de Equipo**, **Energía** (para la captura) y puede **activar una técnica**.
- El cálculo se hace en el **servidor** al reclamar, a partir de la duración validada. No hace falta simular en tiempo real; el cliente solo anima.

### 5.1 Fórmulas **[calibrar]**

Estadísticas reales (sin EVs, al estilo de los juegos principales):

```
PS    = floor((2·Base + IV) · Nivel / 100) + Nivel + 10
Otras = floor((floor((2·Base + IV) · Nivel / 100) + 5) · Naturaleza)     // Naturaleza ∈ {0.9, 1.0, 1.1}
```

| Rol | Estadística | Fórmula |
|---|---|---|
| Frecuencia de acción | Velocidad | `intervalo_seg = 300 · 60 / (60 + Vel)` |
| Puntos por acción | Ataque Esp. | `puntos = 0.85 · (5 + AtEsp / 4) · M` (en la configuración, `pointsBase` 4.25 y `pointsSpAtkDivisor` 4 / 0.85; el 0.85 compensa que el Foco base pasara de 0.85 a 1.0) |
| Energía de captura | Ataque | `energía = (Atq / 5) · (potencia_técnica / 60)` |
| Activación de técnicas | Def. Esp. | `Mult_Técnica = min(2.0, 0.5 + DefEsp / 100)`, multiplica la probabilidad base de cada técnica (§7.2) |
| Aguante: más rendimiento y resistencia a los contraataques | Defensa | `Foco_efectivo = Foco × (1 + 0.10 · min(1, Def / 200))`: Def 100 → ×1.05, Def ≥ 200 → ×1.10 (`defenseFocusMaxBonus`, `defenseFocusCap`), solo para los puntos y la EXP del Pokémon; también reduce el daño de los contraataques (§11.4) |
| Energía diaria | PS | Cuántas acciones puede hacer al día (ver §5.3) |

#### Nombres en pantalla

Internamente se usan las estadísticas reales de PokeAPI (los valores base de cada especie), pero **la interfaz nunca muestra los nombres originales**, sino lo que hace cada estadística en PokeFocus:

| Estadística (PokeAPI) | En pantalla (ES) | En pantalla (EN) | Qué le dice al usuario |
|---|---|---|---|
| PS (`hp`) | **Energía** | **Energy** | Cuánto aguanta estudiando a lo largo del día |
| Velocidad (`speed`) | **Ritmo** | **Pace** | Cada cuánto actúa durante la sesión |
| Ataque Esp. (`special-attack`) | **Rendimiento** | **Output** | Cuántos puntos da cada acción |
| Ataque (`attack`) | **Captura** | **Catch** | Cuánta Energía de captura genera para debilitar salvajes |
| Def. Esp. (`special-defense`) | **Técnica** | **Technique** | Probabilidad de activar técnicas |
| Defensa (`defense`) | **Aguante** | **Grit** | Hasta un 10 % más de puntos y EXP, y cuánto resiste los contraataques (§11.4) |

- En la ficha del Pokémon, cada estadística tiene un tooltip con su explicación y, en letra pequeña, en qué estadística original se basa (por ejemplo, *"basada en Velocidad"*). Así quien conoce los juegos entiende por qué un Jolteon tiene tanto Ritmo.
- Las naturalezas se muestran con estos nombres: Miedosa = *"+Ritmo −Captura"*.
- En el resto de este documento se siguen usando los nombres originales en las fórmulas.

Multiplicador total por acción:

```
M = Condición_de_tipo (1.0–1.5) × Vínculo (1.0–1.2) × Foco_efectivo × Efectos_de_técnicas × Rendimiento_diario
```

### 5.2 Recompensas por sesión

| Recompensa | Fórmula base **[calibrar]** |
|---|---|
| Puntos de Equipo | Suma de los puntos de todas las acciones del equipo |
| EXP (a cada miembro del equipo) | `24.65 · minutos · Foco_efectivo` (= 0.85 × 29) → ≈ 616 EXP por sesión de 25 min con Foco 1.0 y sin Aguante (lo mismo que daban 29/min con el antiguo Foco 0.85) |
| Polvo de Estudio (del jugador) | `8.5 · minutos · Foco` (= 0.85 × 10) → ≈ 213 por sesión de 25 min a tiempo |
| Poké Balls | 2 por sesión completada (no por una abandonada, §3.4) |
| Ball de Estudio | 1 por oleada (cada 25 min), solo para esa oleada (no acumulable, §11.1) |

### 5.3 Energía diaria (PS)

Los PS son la **energía del Pokémon a lo largo del día**. Se gastan al actuar y se recuperan cada día.

- **Gasto:** cada acción cuesta `0.4 + Nivel / 45` de energía (`energy.costBase`, `energy.costLevelDivisor`) **[calibrar]**. Como el costo es por acción, los Pokémon rápidos se cansan antes. La Velocidad y los PS se equilibran entre sí: Jolteon actúa mucho y se agota pronto; Snorlax actúa poco y aguanta todo el día.
- **Objetivo de diseño:** un Pokémon que hace **todas** las sesiones de 25 min seguidas, sin descansos ni pociones, se agota en **~4–6 sesiones**, contando el gasto de sus acciones y el contraataque de cada salvaje al que ataca (§11.4). Simulador: mediana 4.3–4.5 sesiones en los niveles 10–50 (p10–p90: 3.6–5.2), docs/balance-report.md §11. Los de PS alto (Snorlax, Chansey, Lapras) son los aliados de los maratones de estudio.
- **Agotado (0 PS):** deja de actuar (no genera puntos, Energía de captura ni técnicas), pero **sigue ganando la EXP de la sesión**. Estudiar siempre compensa; rotar el equipo es lo que mantiene los puntos.
- **Reinicio diario:** todos los Pokémon recuperan el 100% de su energía a las **05:00** de la zona horaria del perfil.
- **Recuperación durante el día:**

| Fuente | Efecto |
|---|---|
| **Completar el descanso** del pomodoro | +10% de PS a todo el equipo (premia descansar de verdad) |
| Estar en la caja (fuera del equipo) | +10% de PS por hora |
| Técnicas de curación (§7.1) | Se activan durante la sesión con su probabilidad (§7.2) |
| Habilidades (§6.3) | Regeneración, Cura Natural |
| Objetos | Poción (+20 PS), Superpoción (+50), Hiperpoción (+120), Revivir (de 0 al 50%) desde misiones y Recogida |

- La interfaz muestra la barra de PS de cada miembro del equipo en la pantalla previa a la sesión, durante la sesión y en las oleadas, y avisa cuando alguno no va a llegar al final.

---

## 6. Individuos: IVs, naturalezas y habilidades

Cada Pokémon capturado es **único**. No existen "duplicados" idénticos.

### 6.1 IVs

- De 0 a 31 en cada una de las 6 estadísticas, al azar al capturar.
- Los legendarios y míticos tienen garantizados **3 IVs en 31**.
- Las **Chapas** (objeto avanzado) suben un IV a 31.

**Rangos resultantes.** La estadística final de un individuo = base de la especie + IV + nivel + naturaleza (§5.1). Ejemplo con Bulbasaur al nivel 50:

| Estadística | Peor individuo (IV 0, naturaleza en contra) | Mejor individuo (IV 31, naturaleza a favor) |
|---|---|---|
| PS (Energía) | 105 | 120 |
| Ataque Esp. (Rendimiento) | 63 | 93 |

La diferencia crece con el nivel; a nivel bajo casi no se nota. Si se quiere más variación entre individuos, el máximo de IV (`ivMax`, por defecto 31) es un parámetro de la configuración del juego (`custom-game-config.json`, §19) **[calibrar]**.

### 6.2 Naturalezas

Cada naturaleza sube una estadística un 10% y baja otra un 10%. Con los roles de §5.1, **cada naturaleza es una decisión de estilo de juego**. (En la interfaz se muestran con los nombres en pantalla de §5.1: Atq = Captura, Def = Aguante, AtEsp = Rendimiento, DefEsp = Técnica, Vel = Ritmo).

| Naturaleza | +10% | −10% | Lectura en PokeFocus |
|---|---|---|---|
| Fuerte, Dócil, Seria, Tímida, Rara | — | — | Neutras |
| Huraña | Atq | Def | Más captura, menos Aguante |
| Audaz | Atq | Vel | Más captura, actúa menos veces |
| Firme | Atq | AtEsp | **Cazador:** más captura, menos puntos |
| Pícara | Atq | DefEsp | Más captura, activa menos técnicas |
| Osada | Def | Atq | Aguante a costa de captura |
| Plácida | Def | Vel | Aguante a costa de frecuencia |
| Agitada | Def | AtEsp | Aguante a costa de puntos |
| Floja | Def | DefEsp | Aguante a costa de técnicas |
| Miedosa | Vel | Atq | **Velocista:** más acciones, menos captura |
| Activa | Vel | Def | Más acciones, menos aguante |
| Alegre | Vel | AtEsp | Más acciones, menos puntos por acción |
| Ingenua | Vel | DefEsp | Más acciones, menos técnicas |
| Modesta | AtEsp | Atq | **Estudioso:** más puntos, menos captura |
| Afable | AtEsp | Def | Más puntos, menos aguante |
| Mansa | AtEsp | Vel | Más puntos por acción, menos acciones |
| Alocada | AtEsp | DefEsp | Más puntos, menos técnicas |
| Serena | DefEsp | Atq | **Técnico:** más técnicas, menos captura |
| Amable | DefEsp | Def | Más técnicas, menos aguante |
| Grosera | DefEsp | Vel | Más técnicas, menos acciones |
| Cauta | DefEsp | AtEsp | Más técnicas, menos puntos |

Las **Mentas** (objeto avanzado) cambian el efecto de la naturaleza.

### 6.3 Habilidades

- **Solo existen en el juego las habilidades con efecto definido para PokeFocus.** Las demás habilidades de la especie (según PokeAPI) **no se muestran en ninguna parte y nunca salen** en un salvaje.
- Al capturar, la habilidad se elige al azar **solo entre las habilidades definidas** de esa especie. La **habilidad oculta** sale con un 5% de probabilidad, si está definida.
- La ficha de curación de cada especie (§20.1) debe definir **al menos una** habilidad. Si una especie no tiene ninguna definida, no se añade al pack.
- Si más adelante se define una habilidad nueva para una especie, los individuos ya capturados conservan la suya; pueden obtener la nueva con la Cápsula Habilidad.

La lista completa del Pack 1 está en `data/overrides/custom-abilities.json` y se construye con las primitivas de `docs/effects.md`. Algunos ejemplos:

| Habilidad | Efecto |
|---|---|
| Espesura / Mar Llamas / Torrente | +30% de puntos cuando le queda menos de un tercio de Energía |
| Foco Interno | Si reclamas tarde, su Foco no baja del 75% (en vez del 50%) |
| Sincronía | Los salvajes tienen un 50% de probabilidad de tener su misma naturaleza |
| Levitación | Reclamar tarde no reduce lo que genera |
| Robustez | Los contraataques nunca lo dejan agotado |
| Cálculo Final | Su última acción de cada sesión da el triple de puntos |
| Despiste | Los salvajes se despistan al contraatacar: el 15% de sus contraataques falla contra cualquier miembro del equipo (no se acumula: si quien recibe el golpe ya tiene Velo Arena o Manto Níveo, vale el mayor de los dos) |
| Sebo | Gasta un 15% menos de Energía por acción |

La **Cápsula Habilidad** (objeto avanzado) cambia la habilidad.

---

## 7. Técnicas

- Las técnicas son movimientos reales que el Pokémon **aprende al subir de nivel** según su learnset de PokeAPI.
- Cada individuo, además, obtiene **2 o 3 técnicas extra al azar** del resto del repertorio de su especie (huevo, tutor, MT). Dos Bulbasaur pueden tener repertorios distintos.
- Cada Pokémon tiene **huecos de técnica** que se desbloquean con su nivel. En ellos se equipan técnicas elegidas entre las aprendidas, y solo se cambian entre sesiones:

| Nivel del Pokémon | Huecos de técnica |
|---|---|
| 1 – 14 | 1 |
| 15 – 29 | 2 |
| 30 – 49 | 3 |
| 50+ | 4 |

- Cualquier técnica (de daño, pasiva o activable) ocupa un hueco. Si el Pokémon **no lleva ninguna técnica de daño**, sus acciones generan Energía de tipo Normal al 50%. Al principio hay una decisión real: ¿equipar el ataque para capturar o la técnica para potenciar la sesión?
- Las **MT** (drops raros) enseñan una técnica de MT compatible con la especie.

### 7.1 Tipos de efecto

Cada técnica pertenece a **una de tres categorías**, que definen **cuándo** tiene efecto:

| Categoría | Cuándo actúa | Ejemplo |
|---|---|---|
| **De daño** (potencia > 0) | En **cada acción**: el Pokémon usa al azar una de sus técnicas de daño equipadas y produce Energía de **ese tipo** (§11.3) | Ascuas → Energía Fuego |
| **Pasiva** | **Siempre activa** mientras esté equipada, si se cumple su condición | Paz Mental en sesiones ≥ 50 min |
| **Activable** | En cada acción, **cada** técnica activable equipada tira su propia probabilidad (§7.2). **Puede activarse varias veces por sesión**, hasta su límite | Recuperación cura cuando se activa |

Las activaciones se calculan en el servidor a lo largo de la sesión y se muestran en el **resumen al terminar** ("Gengar activó Hipnosis ×2").

Técnicas especiales del Pack 1 (41, diseñadas a mano; la lista completa y sus parámetros están en `data/overrides/custom-techniques.json`, construidas con las primitivas de `docs/effects.md`). La **probabilidad base** es por acción **[calibrar]**:

| Técnica | Categoría | Efecto en PokeFocus | Prob. base | Límite por sesión |
|---|---|---|---|---|
| Paz Mental | Pasiva | +30% de puntos del Pokémon en sesiones ≥ 50 min | — | — |
| Meditación / Corpulencia | Pasiva | +15% de Energía de captura | — | — |
| Teletransporte | Pasiva | Reclamar tarde no reduce las recompensas de este Pokémon | — | — |
| Amnesia | Pasiva | Si un día no estudias, protege tu racha | — | 1 por semana |
| Foco Energía | Activable | Las 5 acciones siguientes del Pokémon dan ×2 puntos | 4% | 1 |
| Danza Lluvia / Día Soleado / Granizo | Activable | Activa la condición de Agua / Fuego / Hielo para todo el equipo durante el resto de la sesión | 5% | 1 |
| Dulce Aroma | Activable | +1 Pokémon en el grupo salvaje | 4% | 1 |
| Hipnosis / Somnífero / Bostezo | Activable | Un salvaje que elijas sale **dormido** (×2.5 a la captura) | 6% | 2 |
| Onda Trueno / Paralizador | Activable | Un salvaje que elijas sale **paralizado** (×1.5 a la captura) | 8% | 2 |
| Rugido / Remolino | Activable | Puedes **descartar** un salvaje del grupo y sustituirlo por otro | 5% | 1 |
| Recuperación / Respiro | Activable | Cura el 50% de los PS del Pokémon | 8% | 2 |
| Síntesis / Sol Matinal | Activable | Cura el 50% de día, el 25% de noche | 9% | 2 |
| Luz Lunar | Activable | Cura el 50% de noche, el 25% de día | 9% | 2 |
| Descanso | Activable | Cura el 100%, pero el Pokémon **no actúa en la sesión siguiente** (se duerme) | 10% | 1 |
| Deseo | Activable | Al empezar la sesión siguiente, cura el 50% al miembro del equipo con menos PS | 6% | 1 |
| Campana Cura | Activable | Cura el 20% a todo el equipo | 5% | 1 |
| Acua Aro / Arraigo | Activable | Cura el 5% después de cada acción durante el resto de la sesión | 6% | 1 |
| Agilidad | Pasiva | +15% de Ritmo | — | — |
| Maquinación | Pasiva | +15% de puntos | — | — |
| Desarrollo | Pasiva | +20% de puntos de día | — | — |
| Danza Dragón | Pasiva | +10% de Ritmo y de Energía de captura | — | — |
| Refuerzo / Relevo | Pasiva | +5% de puntos / +10% de probabilidad de técnicas a todo el equipo (no se acumula) | — | — |
| Protección / Detección | Pasiva | Como líder, −40% de daño de contraataques | — | — |
| Velo Sagrado | Pasiva | −15% de daño de contraataques a todo el equipo (no se acumula) | — | — |
| Mal de Ojo / Bloqueo | Pasiva | Los salvajes aguantan 1 fallo más antes de escapar (no se acumula) | — | — |
| Profecía / Rastreo | Pasiva | Muestra la calidad (IVs) de los salvajes | — | — |

### 7.2 Probabilidad de activación y Dominio

```
p_activación = p_base_técnica × Mult_Técnica × Mult_Dominio      (máximo 40% por acción)
Mult_Técnica = min(2.0, 0.5 + DefEsp / 100)                         // sube con el nivel del Pokémon
```

**La probabilidad sube al estudiar, por dos vías:**

1. **Nivel del Pokémon:** la Def. Esp. (en pantalla, "Técnica") crece con el nivel, y con ella **todas** sus técnicas. Por ejemplo, un Pokémon con Def. Esp. base 100 tiene `Mult_Técnica` ≈ 0.8 al nivel 10 y ≈ 1.6 al nivel 50.
2. **Dominio de cada técnica:** cada técnica acumula los **minutos de estudio que ha estado equipada** en ese Pokémon. Se muestra con estrellas:

| Dominio | Horas equipada **[calibrar]** | Mult_Dominio |
|---|---|---|
| ★ | 0 h | ×1.00 |
| ★★ | 5 h | ×1.15 |
| ★★★ | 15 h | ×1.30 |
| ★★★★ | 40 h | ×1.45 |
| ★★★★★ | 100 h | ×1.60 |

- El Dominio pertenece al Pokémon: si desequipas una técnica, conserva su Dominio para cuando vuelvas a equiparla.
- **Ejemplo:** Hipnosis (6%) en un Gengar de nivel 50 (Def. Esp. ≈ 80, `Mult_Técnica` 1.3) con ★★★ → 6% × 1.3 × 1.3 ≈ **10% por acción**. En unas 12 acciones por sesión, eso son de media ~1.2 activaciones, hasta el límite de 2.

---

## 8. Vínculo

- Cada Pokémon acumula **Vínculo** según los minutos que ha estudiado en tu equipo: `Vínculo = 1.0 + min(0.20, minutos / 30000)` **[calibrar]** (el +20% se alcanza tras unas 500 h).
- Permite que tu Pokémon favorito siga siendo competitivo aunque no sea el óptimo.
- Las evoluciones por amistad (p. ej. Golbat → Crobat, Eevee → Espeon/Umbreon) requieren Vínculo ≥ 1.05.

---

## 9. Tipos

Los tipos importan **dos veces**:
1. **Condiciones:** cuánto rinde el Pokémon según cómo, cuándo y dónde estudias.
2. **Tabla de tipos:** cuánta Energía efectiva hace contra los Pokémon salvajes (captura).

### 9.1 Principios

- Las condiciones **solo suman**: sin condición, el multiplicador es ×1.0; con ella, ×1.25 a ×1.5 **[calibrar]**.
- **Cada estilo de estudio tiene al menos 3 tipos a favor.**
- La hora y el día se calculan con la **zona horaria del perfil**, que solo puede cambiarse una vez cada 30 días (antitrampas). El clima sale de la **ubicación o la ciudad del perfil** (ver "Clima" más abajo), que no tienen enfriamiento.

### 9.2 Condiciones de los 18 tipos

| Tipo | Condición | Multiplicador |
|---|---|---|
| Normal | Siempre activa | ×1.10 |
| Fuego | Clima soleado o temperatura ≥ 25 °C, o entre las 12:00 y las 18:00 | ×1.35 |
| Agua | Lluvia en tu ciudad | ×1.50 |
| Planta | Entre las 05:00 y las 12:00 | ×1.35 |
| Eléctrico | Sesión ≤ 25 min y comenzada ≤ 15 min después de la anterior | ×1.40 |
| Hielo | Temperatura ≤ 12 °C o nieve | ×1.50 |
| Lucha | Sesión ≥ 50 min | ×1.40 |
| Veneno | +8% por cada sesión anterior ese día (máximo +40%) | hasta ×1.40 |
| Tierra | Sábado o domingo | ×1.35 |
| Volador | Perfil sonoro con ≥ 30% de música o ruido | ×1.35 |
| Psíquico | Primera sesión del día, o perfil sonoro con ≥ 70% de silencio | ×1.35 |
| Bicho | +7% por cada Bicho en el equipo (incluido él mismo) | hasta ×1.42 |
| Roca | Sesión sin pausas | ×1.30 |
| Fantasma | Entre las 20:00 y las 05:00 | ×1.40 |
| Dragón | Racha ≥ 7 días | ×1.40 |
| Siniestro | Vuelves tras ≥ 2 días sin estudiar (durante ese día) | ×1.50 |
| Acero | Sesión iniciada ±1 h de la hora de inicio de la primera sesión de ayer | ×1.35 |
| Hada | Sesión en grupo con amigos: proporcional al tiempo acompañado, `1 + 0.40 × fracción` (sin umbral) | hasta ×1.40 |

**Cobertura por estilo:**

| Estilo | Tipos a favor |
|---|---|
| Sesiones cortas | Eléctrico, Bicho, Veneno, Normal |
| Sesiones largas | Lucha, Roca, (PS alto) |
| Noctámbulo | Fantasma, Psíquico (silencio), Normal |
| Madrugador | Planta, Psíquico, Fuego |
| Constante | Dragón, Acero, Veneno |
| Irregular | Siniestro, Normal, Tierra |
| Social | Hada, Volador (ruido) |
| Fin de semana | Tierra, Normal |

**Clima:** el servidor consulta Open-Meteo (tiempo actual, sin API key) al iniciar la sesión, y lo fija en la sesión activa. Nunca hace esperar más de 2 s.

- **Ubicación del dispositivo** (Ajustes → "Usar mi ubicación", o el aviso compacto de la preparación de la sesión): la Geolocation API del navegador, que exige un contexto seguro (`localhost` o HTTPS). El cliente redondea las coordenadas a una celda de ~0,1° (~10 km) **antes de enviarlas**, y el perfil guarda solo esa celda (`profile.location`). El servidor la manda tal cual a Open-Meteo, sin geocodificación, y cachea 30 min por celda. El jugador puede quitarla cuando quiera.
- **Ciudad escrita** (respaldo): si no hay ubicación, o su consulta falla, se geocodifica la ciudad del perfil (caché de 30 min por ciudad).
- **Si no se detecta nada, no hay clima:** Agua y Hielo no se activan, y Fuego solo por su franja de 12:00 a 18:00. **El jugador no elige el clima.** El clima manual existe solo en el panel de desarrollo y el servidor solo lo acepta con `DEV_TOOLS=1` (entonces sustituye al detectado); en producción se rechaza y se ignora también en partidas antiguas que lo tengan guardado.
- Sin enfriamiento para cambiar la ciudad o la ubicación.
- Lluvia, llovizna, chubascos y tormenta cuentan como lluvia; cielo despejado de día, como sol; los códigos de nieve, como nieve.

Se guarda la celda redondeada en el perfil, y no se envía con cada `start`, porque el servidor también inicia sesiones sin el cliente: al arrancar un grupo de estudio empieza la sesión de cada invitado, que puede no tener la app abierta.

### 9.3 Doble tipo

- **Condiciones:** se aplica **la mejor** de las dos (no se suman). Su ventaja es ser versátiles.
- **Tabla de tipos (captura):** la efectividad se calcula de forma normal contra el doble tipo del salvaje.

### 9.4 Teracristalización

- Se desbloquea con el nivel de entrenador 20 **[calibrar]**.
- Cuesta **Teralitos** (de misiones). Cambia el tipo del Pokémon a un tipo único durante **24 h o 5 sesiones**, lo que ocurra primero.
- Afecta a las condiciones. Las técnicas siguen produciendo Energía de su propio tipo.
- Permite usar a tu favorito en cualquier situación, o estrategias como un Gengar teracristalizado a Siniestro durante una semana irregular.

---

## 10. Encuentros

### 10.1 Oleadas y tamaño del grupo

Para que las sesiones largas no salgan perjudicadas frente a varias cortas, los encuentros van por **oleadas**: **cada bloque de 25 min completado genera una oleada** (un grupo de salvajes).

```
oleadas = max(1, floor(minutos / 25))
```

| Sesión | Oleadas | Equivale a |
|---|---|---|
| 15–49 min | 1 | 1 pomodoro |
| 50–74 min | 2 | 2 pomodoros |
| 75–99 min | 3 | 3 pomodoros |
| 100–120 min | 4 | 4 pomodoros |

- Al reclamar, las oleadas se muestran **una tras otra**. Cada oleada trae su **propia Ball de Estudio** (§11.1) y recibe la Energía generada **en su bloque de 25 min** (§11.3).
- **Bono de sesión larga:** cada oleada después de la primera aumenta la rareza. La tirada de legendario sube ×1.5 en la 2.ª oleada y ×2 desde la 3.ª, y el peso de las especies con `capture_rate` bajo también sube **[calibrar]**. Estudiar de seguido atrae a los raros.

**Tamaño de cada oleada:** 4 salvajes, ±1 al azar, +1 con Dulce Aroma (en una oleada), −1 si `Foco < 0.75` (`lowFocusThreshold`: es decir, al reclamar tarde, Foco 0.5; el Aguante no cuenta). Mínimo 3.

**Máximo por oleada según tu liga actual** (§14):

| Liga | Máximo de salvajes por grupo |
|---|---|
| Base | 5 |
| Super | 6 |
| Ultra | 7 |
| Maestra | 8 |

### 10.2 Qué especies aparecen

Para cada hueco del grupo:

1. **Tirada de legendario o mítico:** `0.136% × Foco` **[calibrar]** (0.16 % × 0.85; Foco de la sesión, sin Aguante).
2. Si no, se elige una especie con peso `= capture_rate` (dato de PokeAPI), multiplicado por:
   - ×2 si el tipo de la especie tiene su condición activa en ese momento (p. ej. Fantasma de noche),
   - ×1.2 por el perfil sonoro dominante (§4.3),
   - ×1.25 si comparte tipo con algún miembro del equipo.
3. **Shiny:** `0.9/512 × (0.5 + Foco)` (Foco de la sesión: con 1.0 da lo mismo que 1/512 con el antiguo 0.85).

### 10.3 Nivel de los salvajes

- Base y forma: un rango que crece con el nivel de entrenador. Por ejemplo, entrenador nivel 1: niveles 2–10; nivel 30: niveles 15–40 **[calibrar]**.
- Las formas evolucionadas solo aparecen con un nivel ≥ su nivel de evolución.
- Legendarios y míticos: nivel 50 o más.

### 10.4 Legendarios que vuelven

Si un legendario o mítico **se escapa**, durante tus **3 sesiones siguientes** tiene un **35% de probabilidad** **[calibrar]** de reaparecer en el grupo, aparte de la tirada normal. **El daño no se acumula** entre apariciones; cada encuentro empieza de cero. Esto da tiempo a prepararse: cambiar el equipo, equipar técnicas de estado, hacer una sesión larga.

---

## 11. Captura

### 11.1 Balls

| Ball | Fuente | Captura asegurada | Si no es asegurada |
|---|---|---|---|
| **Ball de Estudio** | 1 por oleada, **solo para esa oleada** | Pokémon **base**, no legendario ni mítico, nivel ≤ 20 | No se puede usar en otros |
| **Poké Ball** | 2 por sesión, misiones | **Shiny** base de nivel ≤ 25 | ×1.0 |
| **Super Ball** | Misiones diarias | **Shiny** de 2.ª etapa o nivel 26–45 | ×1.5 |
| **Ultra Ball** | Misiones semanales, recompensas de liga | **Shiny** de nivel > 45 o 3.ª etapa | ×2.0 |

- Las capturas aseguradas de shiny solo funcionan con la Ball **correspondiente o superior**.
- La **Ball de Estudio no es acumulable**: no entra en el inventario y solo puede usarse en la oleada que la generó. Si pasas a la siguiente oleada sin usarla, se pierde.
- Si la oleada no tiene ningún Pokémon elegible para la Ball de Estudio, esta se convierte en una Poké Ball (que sí va al inventario).
- Cada lanzamiento fallido provoca un **contraataque** del salvaje contra el líder (§11.4); atacar a un salvaje también provoca el suyo contra el atacante. Tras `max_fallos_captura` lanzamientos fallidos (por defecto **3** **[calibrar]**), el salvaje **escapa**.

### 11.2 Fórmula de captura

```
R = capture_rate de la especie (mínimo 13 para legendarios y míticos; calibrado con el simulador)
h = vida restante como fracción = max(0.05, 1 − Daño / PS_salvaje)
p = min(1, (1 − 2h/3) · (R / 255) · Ball · Estado)
Estado: dormido ×2.5, paralizado ×1.5, ninguno ×1.0
```

Ejemplo con Mewtwo (R ajustado = 13):
- Sin preparación (vida completa, Ultra Ball): **≈ 3.4%** por lanzamiento.
- Preparado (h = 0.1, Ultra Ball, dormido): **≈ 24%** por lanzamiento (≈ 56% en 3 lanzamientos).

### 11.3 Daño: la Energía de la sesión

- Durante la sesión, cada acción de un Pokémon produce Energía **del tipo de la técnica de daño usada** (§5.1, §7.1).
- Al reclamar, la Energía generada en cada bloque de 25 min se aplica **a cada salvaje de su oleada**:

```
Daño = Σ_tipo  Energía[tipo] · Efectividad(tipo, tipos_del_salvaje)
```

- Se usa la tabla de tipos oficial: ×2, ×0.5, ×0 y combinaciones.
- **El salvaje nunca se debilita:** su vida restante tiene un **mínimo del 5%** (el `max(0.05, …)` de §11.2), por fuerte que sea tu equipo. Siempre puedes intentar capturarlo.
- Al aparecer cada salvaje se muestra su **barra de vida tras el daño** de tu equipo y su estado (dormido, paralizado).
- Las técnicas de estado activadas durante la sesión permiten **elegir** a qué salvaje se aplica cada estado.

### 11.4 Contraataque del salvaje

Un salvaje quita energía (PS, §5.3) a tus Pokémon en dos momentos:

1. **Cuando lo atacas.** Mandar la ficha de daño de un Pokémon a un salvaje (§10, reparto del daño) **es un ataque y es definitivo**: no se puede deshacer ni cambiar de salvaje. El salvaje responde al momento con su mejor ataque **contra ese Pokémon**.
   - **Auto** (botón o preferencia) también ataca de forma definitiva: cada Pokémon que falta ataca con el reparto automático y recibe el contraataque del salvaje al que más daño hace. Con la preferencia Auto activada, el ataque ocurre al lanzar la primera Ball de la oleada; la primera Ball también hace atacar a quien no lo haya hecho en el modo manual. Así cada Pokémon que actuó recibe **un** contraataque por oleada.
   - **Un Pokémon agotado (0 PS) no puede atacar** (§5.3: no actúa): su ficha no se puede asignar y Auto o la primera Ball lo dejan fuera, así que su daño de esa oleada se pierde. Es lo coherente con "agotado = deja de actuar" y evita que un Pokémon a 0 sirva de escudo gratis.
   - **Estados del salvaje.** Si una técnica de estado ha funcionado (Somnífero, Hipnosis, Onda Trueno…: el salvaje está **dormido** o **paralizado**), el salvaje **no contraataca** a quien le ataque. Da igual quién le puso el estado. No existe congelación en PokeFocus; si se añade, contaría igual. Por eso conviene usar las cargas de estado **antes** de atacar.
2. **Cuando falla una Ball.** El contraataque va **siempre al líder** (hueco 1); si está agotado, al siguiente del equipo con PS. Aquí el estado del salvaje no cuenta. Elegir líder es una decisión: conviene uno con mucha Energía y Aguante, y con tipos que resistan a lo que esperas encontrar.

- **Daño** **[calibrar]**:

```
daño_contraataque = PS_máx_objetivo · 0.08 · (Nivel_salvaje / Nivel_objetivo)^0.5 · Efectividad(tipo_salvaje, tipos_objetivo) · (1 − min(0.5, Def_objetivo / 400)) · 1.5
```

  - **objetivo** = el atacante (1) o el líder (2).
  - El tipo del ataque es uno de los tipos del salvaje, el más efectivo contra el objetivo.
  - La **Defensa** (en pantalla, Aguante) reduce el daño recibido, hasta un 50%.
  - Los legendarios y míticos hacen ×2.
  - **×1.5** = `capture.counter.damageMult`, el daño de los salvajes. Con él y el nuevo coste por acción (§5.3), un Pokémon que estudia sesiones de 25 min seguidas, sin descanso ni pociones, se agota en **~4–5 sesiones** (objetivo §5.3: 4–6; docs/balance-report.md §11).
- Las habilidades de contraataque (Velo Arena, Manto Níveo, Espejo Mágico, Cuerpo Maldito, Robustez, Absorbe Agua…) son **de quien recibe el golpe**: el atacante o el líder. Las de equipo (Despiste, Compiescolta) protegen a todos; Nerviosismo (sin contraataque en el primer fallo) solo afecta a las Balls (docs/effects.md).
- Si el objetivo llega a 0 PS queda **agotado** (§5.3) y deja de actuar hasta que se recupere.
- Tras `max_fallos_captura` fallos, el salvaje escapa (§11.1).
- **Interfaz:** en la sesión y en las oleadas se ve la Energía de **todo el equipo**. Al atacar se ve el contraataque en la fila de ese Pokémon y en su ficha de daño; el panel de lanzamiento dice quién recibirá el de la Ball (el líder).

---

## 12. Progresión

### 12.1 Curva de EXP **[calibrar]**

```
EXP total para alcanzar el nivel L = round(4 · L^2.8)
```

Referencia de diseño con 4 sesiones de 25 min al día, 29 EXP/min y Foco 1.0 (hoy son 24.65 EXP/min con Foco 1.0, lo mismo que 29 con el antiguo Foco 0.85; el simulador da nv. 30 hacia el día 23 y nv. 50 hacia el 93), el Pokémon siempre en el equipo y **sin** caramelos:

| Nivel | EXP total | Tiempo aproximado |
|---|---|---|
| 10 | ~2,500 | 1 día |
| 30 | ~55,000 | 3 semanas |
| 50 | ~230,000 | 3 meses |
| 100 | ~1,600,000 | Objetivo a muy largo plazo (los caramelos son clave) |

### 12.1.1 Qué mejora al subir de nivel

| Mejora | Detalle |
|---|---|
| Estadísticas | Más Energía, Ritmo, Rendimiento, Captura, Técnica y Aguante (§5.1) |
| Probabilidad de técnicas | La Técnica (Def. Esp.) sube, así que todas sus técnicas se activan más (§7.2) |
| Huecos de técnica | 1 → 2 (nv. 15) → 3 (nv. 30) → 4 (nv. 50) (§7) |
| Nuevas técnicas | Aprende las técnicas de su learnset real al nivel correspondiente |
| Evolución | A su nivel de evolución real (§12.6) |
| Gasto de energía | El costo por acción sube con el nivel, pero los PS suben más rápido, así que aguanta más acciones al día (§5.3) |

Además, con las horas de estudio (no con el nivel) crecen el **Vínculo** (§8) y el **Dominio** de cada técnica equipada (§7.2).

### 12.2 Caramelos de especie

- **Capturar** da 3 caramelos de esa línea evolutiva (Bulbasaur, Ivysaur y Venusaur comparten caramelos).
- **Soltar** da 1 caramelo (2 si estaba en 2.ª etapa, 3 si en 3.ª).
- **1 caramelo = 300 EXP** (media sesión de estudio) para cualquier Pokémon de esa línea.

### 12.3 Polvo de Estudio: el freno

Usar caramelos **cuesta Polvo de Estudio**, que **solo se gana estudiando** (§5.2). Así el estudio sigue siendo el límite:

```
Costo en Polvo por caramelo = 25 + 3 · Nivel_actual_del_Pokémon
```

| Nivel | Costo por caramelo | Caramelos con el Polvo de una sesión (250) | EXP extra / EXP de la sesión |
|---|---|---|---|
| 10 | 55 | ~4.5 | ~1,350 / 600 |
| 30 | 115 | ~2.2 | ~650 / 600 |
| 50 | 175 | ~1.4 | ~430 / 600 |

Conclusión: los caramelos **aceleran mucho a niveles bajos** (ponerse al día con un Pokémon nuevo) y **como mucho duplican** la velocidad a niveles medios y altos. Además, el Polvo es único para todos tus Pokémon, así que hay que decidir en quién invertirlo.

### 12.4 Caramelos de tipo

- Se obtienen con **misiones de tipo** (§13). Por ejemplo: "Captura 10 tipo Bicho" → 5 Caramelos Bicho.
- **1 Caramelo de tipo = 200 EXP** (2/3 de un caramelo de especie) para **cualquier** Pokémon de ese tipo (incluidos los de doble tipo). Mismo costo en Polvo.
- Magnitud de la ayuda: una misión semanal típica equivale a unas **1.7 sesiones** de EXP. Es una ayuda útil pero no rompe el balance.

### 12.5 Límite de nivel por Pokédex

| Nivel máximo | Requisito (especies distintas capturadas) |
|---|---|
| 30 | — |
| 40 | 25 |
| 50 | 36 |
| 60 | 50 |
| 60+ | Se amplía con cada pack de contenido **[calibrar]** |

### 12.6 Evolución

| Método original | En PokeFocus |
|---|---|
| Por nivel | Igual que en los juegos |
| Piedras | Las piedras son drops raros (misiones, Recogida) |
| Amistad | Vínculo ≥ 1.05 (y la hora del día en Espeon/Umbreon: Espeon de día, Umbreon de noche) |
| Intercambio | Al intercambiarlo con un amigo (§12.8): Kadabra, Machoke, Graveler y Haunter evolucionan al llegar |

### 12.7 Nivel de entrenador

Sube con el total de minutos estudiados y las especies capturadas. Desbloquea, por ejemplo **[calibrar]**:

| Nivel | Desbloqueo |
|---|---|
| 5 | Super Balls en misiones diarias |
| 10 | Mentas |
| 15 | Equipos guardados (3 configuraciones) |
| 20 | Teracristalización |
| 25 | Chapas |
| 30 | Cápsula Habilidad |

### 12.8 Intercambios entre amigos

- **Solo entre amigos**, con al menos **3 días** de amistad (evita crear cuentas para pasarse Pokémon).
- **Asíncrono, 1 por 1**: uno ofrece, el otro elige qué dar a cambio, y los dos confirman.
- **Costo en Polvo de Estudio** para ambos **[calibrar]**: 100 normal, ×5 si es shiny, ×10 si es legendario o mítico.
- **Límites:** 3 intercambios al día por usuario. Un legendario o mítico solo se puede intercambiar **una vez en su vida**.
- **No se puede recibir un Pokémon de nivel superior a tu límite de nivel** (§12.5). Así un jugador veterano no puede saltarse la progresión de uno nuevo.
- **Qué conserva y qué pierde:** conserva nivel, IVs, naturaleza, habilidad, técnicas y su Dominio. Su **Vínculo vuelve a 0** con su nuevo entrenador.
- Las evoluciones por intercambio ocurren al recibirlo (§12.6).
- El Pokémon recibido cuenta para tu Pokédex.

---

## 13. Misiones

| Tipo | Ejemplos | Recompensas |
|---|---|---|
| Diarias (3) | Completa 3 sesiones · Captura 2 Pokémon · Haz una sesión ≥ 50 min | Poké/Super Balls, Polvo, Pociones |
| Semanales (3) | Captura 10 tipo Bicho · Estudia 5 días · Activa 20 técnicas | Caramelos de tipo, Ultra Ball, Teralitos |
| Pokédex | Registra 10/25/50 especies | Piedras, MT |

---

## 14. Ligas y rankings

- La puntuación son los **Puntos de Equipo** (§5).
- **Rankings semanal y mensual**, cada uno en **tres ámbitos**:

| Ámbito | Quién aparece |
|---|---|
| **Amigos** | Tú y tus amigos aceptados |
| **País** | Usuarios del mismo país: el que elegiste al registrarte (§2.1) |
| **Global** | Todos los usuarios |

- **Diseño original (reemplazado por F2: ranking por país, ver `docs/F2-plan.md`).** El diseño inicial tenía un ámbito "Zona" que agrupaba a los usuarios con el mismo desfase horario (UTC) y una tabla `leaderboard_snapshots` cerrada por una tarea programada (`pg_cron`). F2 usa el país elegido al registrarse y no tiene tarea de cierre.
- **Semanas y meses:** la semana de cada usuario va del lunes 00:00 al domingo 23:59 **de su zona horaria**, y el mes del día 1 al último día. Cada puntuación se guarda con la clave de su periodo (el lunes local, p. ej. `2026-11-02`; el mes, `2026-11`), y cada ranking compara las puntuaciones que tienen la misma clave. Lo que ves es el ranking de tu semana o mes en curso.
- **Qué muestra:** solo los jugadores con puntos en el periodo, los 100 primeros más tu propia fila. Los empates comparten puesto (1, 2, 2, 4) y se ordenan por quién llegó antes a esa puntuación. Cada fila lleva el nombre de entrenador, el país, los puntos, la liga y el líder del equipo como avatar. Quien activa el modo anónimo (§2.1) aparece como «Entrenador anónimo» en los rankings global y de país; en el de amigos y en tu propia fila siempre se ve el nombre.
- **Ligas** por umbral de puntos semanales **[calibrar con el simulador]**:

| Liga | Puntos semanales (inicial) | Máximo de salvajes por grupo |
|---|---|---|
| Base | 0 | 5 |
| Super | 6,000 | 6 |
| Ultra | 60,000 | 7 |
| Maestra | 95,000 | 8 |

- **La liga se reinicia cada semana:** el lunes a las 00:00 todos vuelven a la liga **Base** y suben a medida que acumulan puntos esa semana. La **liga actual** (la que fija el máximo de salvajes por oleada) es la que llevas en la semana en curso.
- Consecuencia buscada: a principio de semana las oleadas son más pequeñas y crecen a medida que estudias. Cada semana es una escalada nueva.
- La liga mensual usa los mismos nombres con umbrales ×4 y se reinicia el día 1 de cada mes. Es solo de ranking: no afecta al tamaño de las oleadas.
- La mejor liga alcanzada se guarda y se muestra en la pantalla de Liga.
- Tus amigos ven tu equipo (el líder primero), tu nivel de entrenador y tus puntos y liga de la semana en su lista de amigos (§2.1), para ver *cómo* conseguiste tus puntos. Un perfil público con técnicas, medallas e historial es del diseño original y no está construido.

---

## 15. Antitrampas

1. **Servidor como autoridad:** la hora de inicio y fin y todas las tiradas al azar (acciones, encuentros, capturas) ocurren en el servidor. El cliente solo muestra resultados.
2. **Una sola sesión activa por usuario**, en todas sus pestañas y dispositivos, y nunca más larga que su duración declarada:
   - Se garantiza **en la base de datos**: la tabla `active_study_sessions` tiene al usuario como clave primaria. Se inserta al iniciar la sesión y se borra al reclamar o cancelar, en la misma transacción que guarda el documento del jugador (que además se bloquea con `SELECT … FOR UPDATE`). Si dos pestañas pulsan "Iniciar" a la vez, solo una lo consigue, aunque las peticiones lleguen en el mismo milisegundo; la otra recibe 409 `session_active` ("Ya tienes una sesión en curso").
   - Todas las pestañas y dispositivos leen **el mismo documento del servidor**, y se les avisa de cada escritura por SSE (`GET /api/events`), así que ven la misma sesión en marcha con el mismo temporizador. No hace falta una vista aparte. Nadie puede iniciar otra sesión ni reclamar por duplicado. Se pueden tener varias sesiones de login a la vez (§2.1); lo único exclusivo es la sesión de estudio.
   - **Pestaña líder:** una sola pestaña (un candado de Web Locks) envía la notificación de fin de sesión, para que no llegue repetida. No es necesaria para que la sesión siga: si se cierra, la sesión sigue en el servidor y se puede **retomar** desde cualquier otra pestaña o dispositivo.
   - **Diseño original (reemplazado por F2: servidor propio, ver `docs/F2-plan.md`).** Tenía un índice único parcial sobre `sessions(owner_id) WHERE status = 'active'` y una vista de solo lectura sincronizada con Supabase Realtime. También daba la "pestaña principal" a la que tenía el permiso de compartir pantalla y hacía las capturas, y una captura sin pestaña que la hiciera contaba como 0.6 **[calibrar]**. Nada de eso se construyó: no hay capturas (§4).
   - Reclamar es **idempotente**: si se pulsa dos veces (o desde dos pestañas), las recompensas se entregan una sola vez.
3. **Ventana de Reclamar** (§3.2).
4. **Rendimiento decreciente diario** (§3.3).
5. ~~Foco por captura de pantalla~~ (descartado el 2026-11-05, §4). El Foco ya no mide la pantalla: el antitrampas se apoya en el servidor como autoridad, la ventana de Reclamar y el rendimiento decreciente.
6. **Zona horaria bloqueada** durante 30 días tras cada cambio. La ciudad y la ubicación del clima no tienen enfriamiento (§9.2).
7. **Nota opcional** de una línea sobre qué estudiaste, visible para tus amigos (presión social).
8. **Detección de anomalías** (fase posterior): patrones como sesiones 24/7 se marcan para revisión.

---

## 16. Estadísticas y gráficas

Por sesión se guarda: inicio y fin, duración, pausas, Foco (y si se reclamó a tiempo), perfil sonoro, puntos, EXP, Polvo, condiciones activas, encuentros y capturas, y la nota y etiqueta de materia (opcionales).

Vistas **diaria, semanal y mensual**:
- Minutos estudiados y Foco medio.
- Distribución del perfil sonoro.
- Puntos de Equipo y evolución de la liga.
- Horas del día más productivas (útil para elegir tipos).
- Capturas y progreso de la Pokédex.
- Las materias son **etiquetas libres** y opcionales, solo para estadísticas personales. No afectan al juego.

---

## 17. Arte y presentación

| Lugar | Sprite | Fuente |
|---|---|---|
| Caja (box), listas, Pokédex | **Iconos pixel art de caja** | PokeAPI/sprites: `sprites/pokemon/versions/generation-vii/icons/{id}.png` (los de gen VIII no existen en el repo) |
| Pantalla previa a la sesión, la sesión, el grupo salvaje, la ficha del Pokémon | **Sprites animados de Showdown** | PokeAPI/sprites: `sprites/pokemon/other/showdown/{id}.gif` y `…/showdown/shiny/{id}.gif` |
| Tipos, objetos, Balls | Iconos pixel art | PokeAPI/sprites: `sprites/items/…` |

- Estética general: **pixel art**, con una UI limpia que acompaña a los sprites.
- Los sprites del pack activo están copiados en `public/sprites/` (`npm run download:sprites`), y la app no los enlaza desde el repositorio de PokeAPI en tiempo de ejecución.
- Hay que verificar las rutas exactas al montar el script de datos.

---

## 18. Contenido: Pack 1

Unas **50 especies** elegidas para cubrir los 18 tipos, más 4 legendarios y míticos:

| Línea evolutiva | Tipos |
|---|---|
| Bulbasaur → Ivysaur → Venusaur | Planta/Veneno |
| Charmander → Charmeleon → Charizard | Fuego (Charizard: Fuego/Volador) |
| Squirtle → Wartortle → Blastoise | Agua |
| Caterpie → Metapod → Butterfree | Bicho (Butterfree: Bicho/Volador) |
| Pidgey → Pidgeotto → Pidgeot | Normal/Volador |
| Pikachu → Raichu | Eléctrico |
| Sandshrew → Sandslash | Tierra |
| Clefairy → Clefable | Hada |
| Zubat → Golbat → Crobat | Veneno/Volador |
| Abra → Kadabra → Alakazam | Psíquico |
| Machop → Machoke → Machamp | Lucha |
| Geodude → Graveler → Golem | Roca/Tierra |
| Magnemite → Magneton | Eléctrico/Acero |
| Gastly → Haunter → Gengar | Fantasma/Veneno |
| Eevee → Vaporeon / Jolteon / Flareon / Espeon / Umbreon | Normal y sus evoluciones |
| Dratini → Dragonair → Dragonite | Dragón (Dragonite: Dragón/Volador) |
| Houndour → Houndoom | Siniestro/Fuego |
| Swinub → Piloswine | Hielo/Tierra |
| **Legendarios y míticos:** Articuno, Zapdos, Moltres, Mewtwo, Mew | |

- Unas **40 técnicas especiales** (§7.1) y las **habilidades** de estas especies (§6.3).
- **Packs siguientes:** el resto de Kanto → Johto → … Todo el contenido son **datos** (JSON o tablas), no código.

---

## 19. Arquitectura técnica

| Capa | Tecnología |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind |
| Backend | **Servidor propio** (`server/`): Node + Hono. Cuentas, el reducer del juego, amigos, rankings, grupos de estudio, avisos de mantenimiento y eventos en tiempo real. Detalle en `docs/server.md` |
| Base de datos | **PostgreSQL con Drizzle** (migraciones en `server/db/migrations/`). En desarrollo, PGlite embebido (sin Docker); en producción, `DATABASE_URL` y `docker compose` |
| Cuentas | Correo y contraseña (`scrypt`). Sesión con un token opaco en una cookie `HttpOnly` (`docs/F2-plan.md` §Seguridad) |
| Estado del jugador | Un documento JSON por usuario (tabla `player_docs`) que **solo escribe el servidor**, con el reducer puro `src/game/actions.ts` y el mismo motor que usa el cliente para mostrar (`src/engine/`). Se guarda en cada acción |
| Tiempo real | SSE (`GET /api/events`): otra pestaña cambió la partida, solicitudes de amistad, grupos de estudio, sesión cerrada |
| Internacionalización | `i18next` (react-i18next), con textos en `es` y `en` |
| Configuración del juego | `data/overrides/custom-game-config.json`, que `npm run build:data` copia a `src/data/game/`: umbrales de liga, probabilidades y demás parámetros. Vive en el repositorio, así que cambiarla exige desplegar |
| Lógica del servidor | `POST /api/game/action` ejecuta cada acción con el reducer (`start`, `claim`, `throwBall`…); `GET /api/weather`; rutas de amigos, rankings y grupos |
| Tareas programadas | Ninguna. Los rankings se separan por la clave del periodo (§14) y el motor renueva las misiones con la fecha. El servidor solo borra cada hora las sesiones de login caducadas |
| Datos de Pokémon | Datos propios en el repo, importados de PokeAPI con un script (ver §19.0). **La app nunca llama a PokeAPI.** |
| Clima | Open-Meteo (servidor) |
| Audio | Web Audio API, análisis local |

**Diseño original (reemplazado por F2: servidor propio, ver `docs/F2-plan.md`).** El diseño inicial usaba **Supabase** (Auth, Postgres con RLS, Edge Functions, `pg_cron`, Storage) con Edge Functions `session/start`, `session/claim`, `capture/throw`, `focus/classify` (Claude Haiku 5.5) y `weather/current`; `pg_cron` para cerrar los rankings y rotar las misiones; una tabla `game_config` editable sin desplegar (`screenshots_per_session`, `focus_model`…); y `getDisplayMedia` más un canvas para el fotograma. F2 lo reemplazó por lo de arriba, y la captura de pantalla se descartó (§4).

### 19.0 Datos del juego: PokeAPI solo como fuente

PokeAPI solo se usa como **fuente de importación**. La app (frontend y backend) lee **únicamente los datos propios del proyecto**.

```
scripts/import-pokeapi   ──(una vez, o al añadir un pack)──►   data/generated/*.json
                                                                       │
data/overrides/*.json   (ediciones a mano: stats, tipos, técnicas,     │  se fusionan;
                         capture_rate, efectos, textos ES/EN…)  ───────┤  el override gana
                                                                       ▼
                                                              src/data/game/*.json  (npm run build:data; lo importan
                                                              la app y el servidor)
```

- `data/generated/` lo escribe solo el script; nunca se edita a mano.
- `data/overrides/` es donde se **edita cualquier dato**: la base de un stat de una especie, su tipo, su `capture_rate`, su learnset, los efectos de las técnicas… Cada override afecta solo a los campos que cambia.
- Volver a importar de PokeAPI **no borra los overrides**. Un validador comprueba que los overrides apuntan a especies y campos que existen.
- Los sprites siguen la misma idea: `npm run download:sprites` descarga los del pack activo a `public/sprites/`, así que la app no los enlaza desde GitHub en tiempo de ejecución (§17).
- Los parámetros de balance (no los datos de especies) viven en `data/overrides/custom-game-config.json` (§19).

### 19.1 Modelo de datos

**Construido en F2** (`server/db/schema.ts`; detalle en `docs/F2-plan.md` §Esquema y `docs/server.md`). Los datos del juego de cada jugador (equipo, Caja, objetos, Pokédex, misiones, historial, sesión activa, encuentro) **no están en tablas propias**: son un único documento JSON por usuario.

| Tabla | Qué guarda |
|---|---|
| `users` | Correo, hash de la contraseña, nombre de entrenador, país y código de amigo |
| `auth_sessions` | Sesiones de login (solo `sha256` del token), con caducidad deslizante |
| `player_docs` | El documento del jugador (`doc` jsonb) y su `version` |
| `active_study_sessions` | Una fila por usuario con sesión de estudio en marcha (garantiza que solo haya una, §15) |
| `league_scores` | Puntos por usuario, periodo (`week` o `month`) y clave del periodo, para los rankings (§14) |
| `friendships` | Solicitudes y amistades (`pending` o `accepted`) |
| `study_groups`, `study_group_members`, `study_group_invites` | Estudiar con amigos: la sala, quién entró y cuándo salió, y las invitaciones |
| `maintenance_windows` | Avisos programados de mantenimiento |

**Diseño original (reemplazado por F2: un documento por jugador y servidor propio, ver `docs/F2-plan.md`).** El borrador inicial repartía todo en tablas relacionales de Supabase. Se conserva como referencia de qué datos tiene cada Pokémon y cada sesión; no es el esquema real (por ejemplo, no existen `profiles`, `species` ni `moves` como tablas, ni `leaderboard_snapshots`, ni `trades`, ni el estado `blocked`):

```
profiles(id, username, username_changed_at, friend_code, avatar_pokemon_id, locale, timezone, utc_offset_zone,
         city, tz_locked_until, public_in_rankings, trainer_level, trainer_exp, polvo)
species(id, name, types[], base_stats, capture_rate, evolution_chain_id, stage, is_legendary, is_mythical, pack)
moves(id, name, type, power, category, special_effect_key)
pokemon(id, owner_id, species_id, level, exp, ivs, nature, ability, is_shiny, vinculo_minutes,
        learned_moves[], extra_moves[], equipped_moves[1–4], move_mastery{move_id: minutes},
        tera_type, tera_until,
        hp_current, hp_updated_at, asleep_next_session)
team_slots(owner_id, slot 1–6, pokemon_id)
candies(owner_id, chain_id | type, amount)
items(owner_id, item_key, amount)
sessions(id, owner_id, started_at, planned_minutes, ended_at, claimed_at, paused_seconds,
         focus, screen_label, screen_conf, audio_profile, active_conditions, points, note, subject_tag)
encounters(id, session_id, species_id, level, ivs, nature, ability, is_shiny, damage, status, outcome)
roaming_legendaries(owner_id, species_id, sessions_left)
missions(owner_id, mission_key, progress, period)
leaderboard_snapshots(period_type, period_start, scope, zone, owner_id, points, league, rank)
friendships(a, b, status, created_at)          // status: pending | accepted | blocked
trades(id, from_id, to_id, offered_pokemon_id, requested_pokemon_id, status, created_at, completed_at)
```

---

## 20. Hoja de ruta

| Fase | Entregable |
|---|---|
| **F0 — Simulador de balance** | Script que simula semanas de estudio con distintos perfiles de jugador y equipos. Ajusta los valores [calibrar]: puntos, EXP, Polvo, ligas, probabilidades de captura. |
| **F1 — Núcleo local** | Datos del Pack 1, temporizador, equipo y técnicas, encuentros, captura, caja y Pokédex. Sin backend (localStorage). |
| **F2 — Online** | **Hecha, con servidor propio** (Node + Hono + PostgreSQL), no con Supabase: registro con correo y contraseña (país al registrarse), inicio de sesión con cookie `HttpOnly`, onboarding con inicial, amigos (solicitudes, código de amigo), progreso, sesiones y tiradas en el servidor, Puntos de Equipo, ligas y rankings semanal y mensual de amigos, país y global. Ver `docs/F2-plan.md`. Pendientes: recuperación de contraseña por correo, probar con PostgreSQL real (`docs/PENDING.md`). |
| **F3 — Foco** | **Hecha.** Reclamar, perfil sonoro con el micrófono (con calibración), clima real con Open-Meteo y gráficas (ver `docs/PENDING.md`, F3). **Descartada (2026-11-05): la captura de pantalla con IA**; el Foco se queda como una etiqueta neutra (§4). |
| **F4 — Progresión profunda** | Los objetos avanzados y lo que se hace con ellos: la **Teracristalización** (§9.4) y las **MT** (§7), cuyos objetos (Teralitos y MT) ya caen de misiones pero todavía no sirven para nada, y las **Mentas** (§6.2), las **Chapas** (§6.1) y la **Cápsula Habilidad** (§6.3), que aún no existen. Salvo las MT, se desbloquean con el nivel de entrenador (§12.7). Lo demás que decía esta fase (Caramelos, Polvo, naturalezas, habilidades, límite de nivel, misiones, evoluciones especiales y nivel de entrenador) salió en F1. Ver `docs/PENDING.md`. |
| **F5 — Contenido y social** | Más packs, intercambios entre amigos, detección de anomalías. La condición Hada ya existe: llegó con las sesiones de estudio en grupo (`docs/session-depth-plan.md`, paquete C). |

### 20.1 Estrategia de balance de stats

Los stats de PokeAPI fueron diseñados para combates, no para PokeFocus (§5.1), así que **hay que reajustarlos**. Editar a mano más de 1,000 especies no escala, así que se hace en tres capas, de lo general a lo particular:

| Capa | Dónde | Qué hace | Ejemplo |
|---|---|---|---|
| **1. Transformación global por stat** | Configuración del juego (`statCurves` en `custom-game-config.json`) | Una curva por stat que comprime los extremos antes de usarlo (p. ej. `efectiva = 50 + (base − 50) · k`, o una raíz) | Que la Velocidad de Ninjask (160) no le dé 30 veces más acciones que Shuckle (5) |
| **2. Curación por especie en cada pack** | `data/overrides/` | **Cada especie que se añade se revisa** y se ajustan sus stats base según su identidad y el rol que debe tener en PokeFocus. Es un paso obligatorio de cada pack | Machamp: brutal en Captura, pero con un Rendimiento suficiente para no quedar fuera del ranking. Shedinja (1 PS base) necesita Energía jugable. Shuckle (Def. 230) y Blissey (PS 255) se moderan |
| **3. Detección con el simulador** | F0 | Calcula un **"valor de estudio"** por especie (puntos esperados al día con perfiles de jugador típicos) y marca las especies fuera de banda | Ninguna evolución final por debajo del percentil 25 de su etapa; legendarios arriba, pero con techo |

Reglas de diseño:
- **Las etapas de evolución deben notarse**: una 3.ª etapa siempre supera a su forma base.
- **Ningún rol queda vacío**: cada stat debe tener especies que destaquen en él, para que todos los estilos de equipo funcionen.
- Cada override lleva un comentario con su motivo, para revisarlo al añadir packs.
- **Los roles de los stats no cambian** (§5.1): Ataque = Captura, Ataque Esp. = Rendimiento. El problema de que los atacantes físicos generen pocos puntos se resuelve **especie por especie** en la curación (capa 2), no con una fórmula general.

**Proceso al añadir un pack:**
1. Importar las especies de PokeAPI (§19.0).
2. Rellenar la **ficha de curación** de cada especie: rol buscado (p. ej. "cazador", "estudioso", "maratonista", "técnico"), stats base ajustados y motivo.
3. Ejecutar el simulador: comprobar el "valor de estudio" de cada especie frente a su etapa y frente al resto del pack.
4. Iterar hasta que ninguna especie quede fuera de banda.

---

## 20.2 Calibración aplicada

Valores ajustados con el simulador (`npm run simulate`, informe en `docs/balance-report.md`): ligas 6,000 / 60,000 / 95,000; EXP 29/min (24.65 desde que el Foco base es 1.0, §4); tope de nivel 50 con 36 especies (y 60 con 50); legendario 0.16% por hueco y captura mínima 13; rangos de nivel salvaje ampliados hasta 70; ajustes de Rendimiento en 10 especies (`data/overrides/species.json`).

---

## 21. Preguntas abiertas

Ninguna por ahora. Los valores **[calibrar]** se cierran con el simulador (F0).
