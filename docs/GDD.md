# PokeFocus — Documento de Diseño (GDD)

> Versión 0.1 · 2026-11-03 · Proyecto personal, uso privado entre amigos.
> Este documento es la fuente de verdad del diseño. Los números marcados con **[calibrar]** son valores iniciales que se ajustarán con el simulador de balance (ver §20).

---

## 0. Resumen

PokeFocus es una aplicación web de escritorio que recompensa el estudio con Pokémon. Cada sesión de estudio (pomodoro) hace que tu **equipo de 6 Pokémon** genere **Puntos de Equipo**, suba de nivel y aprenda técnicas. Al terminar la sesión aparece un **grupo de Pokémon salvajes** que puedes intentar capturar. Los Puntos de Equipo deciden tu **liga** y tu posición en los **rankings semanal y mensual** entre amigos.

### Pilares de diseño

1. **Estudiar es el combustible; el equipo es el motor.** Sin estudio no pasa nada, pero dos personas con las mismas horas pueden obtener resultados muy distintos según cómo armaron su equipo.
2. **Nunca castigar, siempre premiar.** Las condiciones de tipo solo suman, perder una racha no quita lo ganado, y el análisis de micrófono no tiene respuestas "malas".
3. **Lo raro debe sentirse raro.** Los legendarios nunca están garantizados, pero el jugador puede prepararse para aumentar sus probabilidades.
4. **Siempre hay algo que mejorar.** Individuos únicos (IVs, naturaleza, habilidad, técnicas extra), límites de nivel ligados a la Pokédex y objetos de mejora para que el juego no se agote.
5. **Libertad para estudiar.** Puedes usar cualquier app o pestaña. El antitrampas se basa en que hacer trampa no compense, no en vigilar.

---

## 1. Plataforma y alcance

| Aspecto | Decisión |
|---|---|
| Plataforma v1 | **Web de escritorio** (Chrome, Edge, Firefox). Todas las funciones disponibles. |
| Celular | **Fuera de alcance en v1.** Los navegadores móviles no permiten capturar pantalla ni mantener el micrófono en segundo plano. Más adelante se evaluará una app nativa. |
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

**Cuenta** (Supabase Auth):
- Registro con email y contraseña (con verificación de email) o con Google.
- Inicio y cierre de sesión, sesión persistente y recuperación de contraseña.
- **Nombre de usuario** único (3–20 caracteres: letras, números y `_`). Se puede cambiar una vez cada 30 días.
- Eliminar la cuenta borra todos sus datos.

**Primer inicio (onboarding):**
1. Idioma (ES/EN) y zona horaria (detectada automáticamente, se puede corregir). Ciudad opcional, para el clima (§9.2).
2. **Elegir un Pokémon inicial**: Bulbasaur, Charmander o Squirtle, a nivel 5, con 1 técnica. Así el equipo nunca empieza vacío.
3. 5 Poké Balls de regalo.
4. Explicación breve del bucle (sesión → oleadas → captura) y de los permisos de pantalla y micrófono, qué hacen y qué no se guarda (§4).

**Perfil:**
- Avatar: el sprite de uno de tus Pokémon.
- Muestra liga actual, equipo con técnicas, medallas de liga, progreso de la Pokédex y minutos de la semana.
- Opción de privacidad: aparecer o no con tu nombre en los rankings de zona y global. Si no, apareces como "Entrenador anónimo". En el ranking de amigos siempre apareces con tu nombre.

**Amigos:**
- Buscar por nombre de usuario o por **código de amigo** (8 caracteres, compartible).
- Enviar, aceptar y rechazar solicitudes, eliminar amigos y bloquear usuarios.
- Ver el perfil de un amigo y si está **estudiando ahora** (necesario para la condición Hada, §9.2).
- Intercambiar Pokémon (§12.8).

**Ajustes:** idioma, zona horaria y ciudad (bloqueadas 30 días tras cada cambio, §15), privacidad, notificaciones del navegador (fin de sesión, ventana de Reclamar), permisos y eliminar cuenta.

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

---

## 4. Foco (índice de concentración)

**Foco** es un valor de 0.0 a 1.0 por sesión. Afecta a las **recompensas** (puntos, EXP, Polvo) y a la **calidad de los encuentros** (número de Pokémon, probabilidad de raros y shiny).

### 4.1 Componentes

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

Si el usuario no concedió el permiso de compartir pantalla: `valor_captura = 0.85` **[calibrar]**. Es un valor neutro que no penaliza mucho, pero da un pequeño incentivo para activarlo.

### 4.2 Captura de pantalla: implementación

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

- Es opcional y se analiza **en el navegador** con Web Audio API. **El audio nunca sale del dispositivo.**
- Cada 2 s se clasifica la ventana actual como `silencio` / `voz` / `música` / `ruido_ambiente` (con RMS, detección de actividad de voz y rasgos espectrales simples).
- Al final de la sesión se guardan los porcentajes, por ejemplo `{silencio: 0.62, música: 0.30, voz: 0.08}`.
- **No afecta al Foco.** Solo modifica **qué tipos aparecen** en el grupo salvaje:

| Perfil dominante | Tipos con más probabilidad (×1.5) |
|---|---|
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
| Puntos por acción | Ataque Esp. | `puntos = (5 + AtEsp / 4) · M` |
| Energía de captura | Ataque | `energía = (Atq / 5) · (potencia_técnica / 60)` |
| Activación de técnicas | Def. Esp. | `Mult_Técnica = min(2.0, 0.5 + DefEsp / 100)`, multiplica la probabilidad base de cada técnica (§7.2) |
| Aguante con poco Foco y ante contraataques | Defensa | `Foco_efectivo = Foco + (1 − Foco) · min(0.5, Def / 400)`; también reduce el daño de los contraataques (§11.4) |
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
| Defensa (`defense`) | **Aguante** | **Grit** | Cuánto rinde aunque tu Foco sea bajo, y cuánto resiste los contraataques (§11.4) |

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
| EXP (a cada miembro del equipo) | `29 · minutos · Foco_efectivo` → 725 EXP por sesión de 25 min con Foco 1.0 (calibrado para un Foco real ≈ 0.9) |
| Polvo de Estudio (del jugador) | `10 · minutos · Foco` → 250 por sesión de 25 min |
| Poké Balls | 2 por sesión completada |
| Ball de Estudio | 1 por oleada (cada 25 min), solo para esa oleada (no acumulable, §11.1) |

### 5.3 Energía diaria (PS)

Los PS son la **energía del Pokémon a lo largo del día**. Se gastan al actuar y se recuperan cada día.

- **Gasto:** cada acción cuesta `0.5 + Nivel / 25` de energía **[calibrar]**. Como el costo es por acción, los Pokémon rápidos se cansan antes. La Velocidad y los PS se equilibran entre sí: Jolteon actúa mucho y se agota pronto; Snorlax actúa poco y aguanta todo el día.
- **Objetivo de diseño:** un Pokémon promedio aguanta unas **5 sesiones de 25 min al día** **[calibrar]**. Los de PS alto (Snorlax, Chansey, Lapras) son los aliados de los maratones de estudio.
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

- La interfaz muestra la barra de PS de cada miembro del equipo en la pantalla previa a la sesión y avisa cuando alguno no va a llegar al final.

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

La diferencia crece con el nivel; a nivel bajo casi no se nota. Si se quiere más variación entre individuos, el máximo de IV (`iv_max`, por defecto 31) es un parámetro de `game_config` **[calibrar]**.

### 6.2 Naturalezas

Cada naturaleza sube una estadística un 10% y baja otra un 10%. Con los roles de §5.1, **cada naturaleza es una decisión de estilo de juego**. (En la interfaz se muestran con los nombres en pantalla de §5.1: Atq = Captura, Def = Aguante, AtEsp = Rendimiento, DefEsp = Técnica, Vel = Ritmo).

| Naturaleza | +10% | −10% | Lectura en PokeFocus |
|---|---|---|---|
| Fuerte, Dócil, Seria, Tímida, Rara | — | — | Neutras |
| Huraña | Atq | Def | Más captura, menos aguante con poco Foco |
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
| Foco Interno | Rinde como si tu Foco fuera al menos del 75% |
| Sincronía | Los salvajes tienen un 50% de probabilidad de tener su misma naturaleza |
| Levitación | Reclamar tarde no reduce lo que genera |
| Robustez | Los contraataques nunca lo dejan agotado |
| Cálculo Final | Su última acción de cada sesión da el triple de puntos |
| Despiste | Ignora las distracciones: el chat y las redes cuentan como 80% de Foco para él |
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
- La hora, el día y el clima se calculan con la **zona horaria y la ciudad del perfil**, que solo pueden cambiarse una vez cada 30 días (antitrampas).

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
| Hada | Sesión simultánea con un amigo (≥ 80% de solapamiento) | ×1.40 |

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

**Clima:** se consulta en el servidor (por ejemplo con Open-Meteo, que no requiere API key) con la ciudad del perfil al iniciar la sesión.

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

**Tamaño de cada oleada:** 4 salvajes, ±1 al azar, +1 con Dulce Aroma (en una oleada), −1 si `Foco < 0.5`. Mínimo 3.

**Máximo por oleada según tu liga actual** (§14):

| Liga | Máximo de salvajes por grupo |
|---|---|
| Base | 5 |
| Super | 6 |
| Ultra | 7 |
| Maestra | 8 |

### 10.2 Qué especies aparecen

Para cada hueco del grupo:

1. **Tirada de legendario o mítico:** `0.2% × Foco` **[calibrar]**.
2. Si no, se elige una especie con peso `= capture_rate` (dato de PokeAPI), multiplicado por:
   - ×2 si el tipo de la especie tiene su condición activa en ese momento (p. ej. Fantasma de noche),
   - ×1.5 por el perfil sonoro (§4.3),
   - ×1.25 si comparte tipo con algún miembro del equipo.
3. **Shiny:** `1/512 × (0.5 + Foco)`.

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
- Cada lanzamiento fallido provoca un **contraataque** del salvaje (§11.4). Tras `max_fallos_captura` lanzamientos fallidos (por defecto **3** **[calibrar]**), el salvaje **escapa**.

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

Si un lanzamiento falla, el salvaje **contraataca** a uno de tus Pokémon y le quita energía (PS, §5.3).

- **A quién ataca:** al **líder** del equipo (hueco 1). Si el líder está agotado (0 PS), al siguiente del equipo con PS. Elegir líder es una decisión: conviene uno con mucha Energía y Aguante, y con tipos que resistan a lo que esperas encontrar.
- **Daño** **[calibrar]**:

```
daño_contraataque = PS_máx_líder · 0.08 · (Nivel_salvaje / Nivel_líder)^0.5 · Efectividad(tipo_salvaje, tipos_líder) · (1 − min(0.5, Def_líder / 400))
```

  - El tipo del ataque es uno de los tipos del salvaje, el más efectivo contra el líder.
  - La **Defensa** (en pantalla, Aguante) reduce el daño recibido, hasta un 50%.
  - Los legendarios y míticos hacen ×2.
- Si el líder llega a 0 PS queda **agotado** (§5.3) y deja de actuar hasta que se recupere.
- Tras `max_fallos_captura` fallos, el salvaje escapa (§11.1).

---

## 12. Progresión

### 12.1 Curva de EXP **[calibrar]**

```
EXP total para alcanzar el nivel L = round(4 · L^2.8)
```

Referencia con 4 sesiones de 25 min al día, Foco 1.0, el Pokémon siempre en el equipo y **sin** caramelos:

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
| **Amigos** | Tú y tus amigos |
| **Zona** | Usuarios con el mismo desfase horario (UTC) en su perfil (p. ej. todos los de UTC−5) |
| **Global** | Todos los usuarios |

- **Cierres:** la semana de cada usuario va del lunes 00:00 al domingo 23:59 **de su zona horaria**, y el mes del día 1 al último día. El ranking de **zona** cierra a la vez para todos sus miembros. Los rankings de **amigos** y **global** comparan las semanas locales de cada uno y se cierran cuando termina la última zona (lunes ≈ 12:00 UTC).
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
- La mejor liga alcanzada se guarda como medalla en el perfil.
- El perfil público muestra el equipo, las técnicas y el historial, para que los demás vean *cómo* conseguiste tus puntos.

---

## 15. Antitrampas

1. **Servidor como autoridad:** la hora de inicio y fin y todas las tiradas al azar (acciones, encuentros, capturas) ocurren en el servidor. El cliente solo muestra resultados.
2. **Una sola sesión activa por usuario**, en todas sus pestañas y dispositivos, y nunca más larga que su duración declarada:
   - Se garantiza **en la base de datos**: un índice único parcial sobre `sessions(owner_id) WHERE status = 'active'`. Si dos pestañas pulsan "Iniciar" a la vez, solo una lo consigue, aunque las peticiones lleguen en el mismo milisegundo.
   - La otra pestaña recibe el error y muestra *"Ya tienes una sesión activa"*, con una **vista de solo lectura** de esa sesión (temporizador y equipo, sincronizados con Supabase Realtime). No puede iniciar otra ni reclamar por duplicado.
   - **Pestaña principal:** la que inició la sesión es la que tiene el permiso de compartir pantalla y hace las capturas. Si se cierra, la sesión sigue en el servidor y se puede **retomar** desde otra pestaña, que vuelve a pedir el permiso.
   - Si toca una captura y no hay ninguna pestaña que pueda hacerla, esa captura cuenta como **0.6** **[calibrar]**. Así cerrar la pestaña para esquivar las capturas no compensa, pero un cierre accidental tampoco hunde la sesión.
   - Reclamar es **idempotente**: si se pulsa dos veces (o desde dos pestañas), las recompensas se entregan una sola vez.
3. **Ventana de Reclamar** (§3.2).
4. **Rendimiento decreciente diario** (§3.3).
5. **Foco por captura de pantalla** (§4).
6. **Zona horaria y ciudad bloqueadas** durante 30 días tras cada cambio.
7. **Nota opcional** de una línea sobre qué estudiaste, visible para tus amigos (presión social).
8. **Detección de anomalías** (fase posterior): patrones como sesiones 24/7 se marcan para revisión.

---

## 16. Estadísticas y gráficas

Por sesión se guarda: inicio y fin, duración, pausas, Foco y sus componentes (etiqueta de la captura y confianza, reclamo a tiempo), perfil sonoro, puntos, EXP, Polvo, condiciones activas, encuentros y capturas, y la nota y etiqueta de materia (opcionales).

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
- En el prototipo se enlazan los sprites directamente desde el repositorio. Antes de usar la app en grupo, se copian los del pack activo al almacenamiento propio.
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
| Backend | **Supabase**: Auth, Postgres con RLS, Edge Functions, `pg_cron`, Storage |
| Internacionalización | `i18next` (react-i18next), con textos en `es` y `en` |
| Configuración del juego | Tabla `game_config` con parámetros editables sin desplegar: `screenshots_per_session`, `focus_model`, umbrales de liga, probabilidades |
| Lógica del servidor (Edge Functions) | `session/start`, `session/claim` (cálculo de acciones, recompensas y encuentros), `capture/throw`, `focus/classify` (Claude Haiku 5.5), `weather/current` |
| Tareas programadas (`pg_cron`) | Cierre de rankings semanal y mensual, rotación de misiones |
| Datos de Pokémon | Datos propios en el repo, importados de PokeAPI con un script (ver §19.2). **La app nunca llama a PokeAPI.** |
| Clima | Open-Meteo (servidor) |
| Audio | Web Audio API, análisis local |
| Pantalla | `getDisplayMedia` + canvas para el fotograma |

### 19.0 Datos del juego: PokeAPI solo como fuente

PokeAPI solo se usa como **fuente de importación**. La app (frontend y backend) lee **únicamente los datos propios del proyecto**.

```
scripts/import-pokeapi   ──(una vez, o al añadir un pack)──►   data/generated/*.json
                                                                       │
data/overrides/*.json   (ediciones a mano: stats, tipos, técnicas,     │  se fusionan;
                         capture_rate, efectos, textos ES/EN…)  ───────┤  el override gana
                                                                       ▼
                                                              data/game/*.json  ──►  semilla de las tablas de Postgres
```

- `data/generated/` lo escribe solo el script; nunca se edita a mano.
- `data/overrides/` es donde se **edita cualquier dato**: la base de un stat de una especie, su tipo, su `capture_rate`, su learnset, los efectos de las técnicas… Cada override afecta solo a los campos que cambia.
- Volver a importar de PokeAPI **no borra los overrides**. Un validador comprueba que los overrides apuntan a especies y campos que existen.
- Los sprites siguen la misma idea: se copian los del pack activo al Storage propio (§17).
- Los parámetros de balance (no los datos de especies) viven en `game_config` (§19).

### 19.1 Modelo de datos (borrador)

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
| **F2 — Online** | Registro e inicio de sesión, onboarding con inicial, perfil, amigos (solicitudes, código de amigo), sesiones y tiradas en el servidor, Puntos de Equipo, ligas, rankings de amigos, zona y global. |
| **F3 — Foco** | Reclamar, captura de pantalla con IA, perfil sonoro, gráficas. |
| **F4 — Progresión profunda** | Caramelos, Polvo, naturalezas, habilidades, límite de nivel, misiones, evoluciones especiales, nivel de entrenador, Tera. |
| **F5 — Contenido y social** | Más packs, intercambios entre amigos, condición Hada, detección de anomalías. |

### 20.1 Estrategia de balance de stats

Los stats de PokeAPI fueron diseñados para combates, no para PokeFocus (§5.1), así que **hay que reajustarlos**. Editar a mano más de 1,000 especies no escala, así que se hace en tres capas, de lo general a lo particular:

| Capa | Dónde | Qué hace | Ejemplo |
|---|---|---|---|
| **1. Transformación global por stat** | `game_config` | Una curva por stat que comprime los extremos antes de usarlo (p. ej. `efectiva = 50 + (base − 50) · k`, o una raíz) | Que la Velocidad de Ninjask (160) no le dé 30 veces más acciones que Shuckle (5) |
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

Valores ajustados con el simulador (`npm run simulate`, informe en `docs/balance-report.md`): ligas 6,000 / 60,000 / 95,000; EXP 29/min; tope de nivel 50 con 36 especies (y 60 con 50); legendario 0.16% por hueco y captura mínima 13; rangos de nivel salvaje ampliados hasta 70; ajustes de Rendimiento en 10 especies (`data/overrides/species.json`).

---

## 21. Preguntas abiertas

Ninguna por ahora. Los valores **[calibrar]** se cierran con el simulador (F0).
