# Historial de PENDING.md

Archivo de lo ya hecho y de las revisiones antiguas, movido desde `docs/PENDING.md` el 2026-11-15 para que ese archivo sea corto. El texto está tal cual estaba. **No hace falta leerlo entero:** búscalo con `grep -n` por tema.

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

## Hecho: C, sesiones largas cancelables (2026-11-10, sin versión)

Regla completa en el GDD §3.4. Al abandonar una sesión de **más de 25 min** con **15 min o más** estudiados (reloj del servidor, pausas excluidas) se conservan los puntos, la EXP y el Polvo de esos minutos y **una oleada por bloque de 25 min completo**. Sesiones de 25 min o menos, o menos de 15 min estudiados: nada, como antes. Nunca es reclamo tardío, pero tras el fin del temporizador `cancel` responde 409 `already_finished` (hay que reclamar). Sin las 2 Poké Balls por sesión; no cuenta como sesión completada en las misiones (sus minutos sí). Grupo: Hada = acompañado ÷ transcurrido. Confirmación con lo que conservas y pantalla de Resultados «Sesión abandonada».

- Simulador: `npx tsx scripts/simulate-cancel.ts` (opciones `cancel` y `onTimeClaims` de `runPlayer`). Los perfiles que no cancelan dan exactamente lo mismo que antes.
- **Por decidir:** cancelar y reiniciar da lo mismo que planear dos sesiones más cortas, que ya rinden algo más que una larga para el maratonista y el noctámbulo (efecto de la duración en sí: energía y elección del equipo entre sesiones, no de cancelar). Si se quiere que una sesión larga nunca rinda menos que dos cortas, es un cambio de balance aparte.
- Sin probar en el navegador a 390 px (el diálogo de confirmación es texto y una lista corta).

## Hecho: v0.8.0 (2026-11-09)

- Botón «Música» en el descanso y `musicDuringBreak` en Ajustes → Sonido (la pista `home` lleva la marca `rest` solo en el descanso).
- `GET /api/config` → `{ devTools }`: el panel `?dev` se desactiva contra un servidor sin herramientas; texto propio para `not_finished`; `ApiError.body` y `unlockAt` directo.
- R-03 arreglado (Web Lock `pokefocus-end-bell:<sessionId>`). Pendiente: probar en navegador real. Fallo aparte conocido: pausar o cancelar desde la pestaña A no cancela la campana programada en B.
- `StageTeam` (equipo en filas a 390 px) en la sesión, al reclamar, el descanso y los resultados; Polvo a 1024 px; la Ball de Estudio se cambia sola si no sirve; «Empezar» desactivado con una sala de grupo abierta. R-04 (animación del contraataque tras recargar) documentado, sin arreglar.

## Hoja de ruta (decidida 2026-11-09)

Orden por dependencias. Decisiones del usuario entre paréntesis.

**A. Combate y energía** (rama `worktree-agent-a68709049b34a75ad`, a rehacer):
- Si falla la Ball, el contraataque va al **líder**.
- Asignar un Pokémon a un salvaje es un ataque **irreversible**; el salvaje contraataca a **ese** Pokémon. Si una técnica de estado (Somnífero…) funciona, no hay contraataque.
- Daño del salvaje ×1,5 (`capture.counter.damageMult`).
- Energía: un Pokémon que hace todas las sesiones de 25 min seguidas, sin descansos ni pociones, se agota en **~4–6 sesiones**. Calibrar con el simulador.
- Vida de todo el equipo en la sesión y las oleadas, tutorial y docs.

**B. Que se entienda** (después de A): al pasar el ratón por las etiquetas Daño, Pasiva y Activable, cuándo se activan y con qué probabilidad, con los números del Pokémon (en las de daño, para qué sirve acumular Energía); desglose de cómo se calculan los puntos de la sesión.

**C. Sesiones largas cancelables** (después de A): cancelar conserva las oleadas de los bloques de 25 min cumplidos **y** los puntos, EXP y Polvo de los minutos estudiados. El servidor decide.

**D. Gestión del equipo:**
- Equipos guardados con nombre y cambio rápido.
- **Motes** (nombre propio, máximo 12 caracteres).
- Desde la ficha: poner en el equipo o cambiar por otro, con ventana de comparación y confirmación.

**E. Administración y eventos** (cambios **en vivo desde la base de datos**, con versiones; diseño en `docs/admin-plan.md`):
- Contenido: aparición por especie, técnicas, habilidades, captura, shiny, legendarios, multiplicadores, economía, ligas.
- Misiones diarias, semanales y de evento, con sus recompensas.
- Eventos: nombre, descripción, imagen, inicio y fin, especies destacadas, *drops*, shiny del evento.
- Versiones con auditoría y vuelta atrás; simular antes de publicar; soporte de jugadores; métricas; rol de administrador.
- Página de Eventos para los jugadores.

**F. «¿Qué hay de nuevo?»:** ventana una vez por versión, con enlace a `#/changelog`.

## Hecho: estudiar con otras pestañas, y pendientes de UX y código (2026-11-06)

**Regla de producto:** cambiar de pestaña o de app nunca descuenta recompensas (GDD, principio 5). El temporizador usa marcas de tiempo y ni el motor ni el servidor leen la visibilidad de la página: `src/game/tabSwitching.test.ts` falla si alguien lo introduce.

- **Micrófono en pestaña oculta:** el muestreo va por un Worker (no lo frena el navegador) y las ventanas con menos de 5 muestras se descartan en vez de clasificarse mal. Antes, con la pestaña oculta, la voz podía salir como música o ruido. Pendiente de verificar con un navegador y un micrófono reales: que el Worker mantenga 100 ms con la pestaña oculta.
- **R-01 (aviso de fin sin sonido tras recargar):** chip «Toca para activar el sonido» en la sesión y en el descanso, verificado en un navegador real. Re-sincroniza la campana en la pestaña líder.
- **R-07 (foco del teclado):** al cambiar de pantalla y al terminar el primer inicio el foco va a `<main>`; con Anterior/Siguiente en la ficha se queda en el botón. Verificado en un navegador real.
- **Rol vs naturaleza:** etiqueta de rol hueca con icono y pestaña «Rol» (distinta de los tipos), explicación en la ficha y en Estadísticas → Naturaleza, y un aviso cuando la naturaleza sube o baja la estadística del rol. El rol está curado a mano por especie (en 42 de 48 especies con estadística asociada coincide con su mejor estadística base; las excepciones son Charmander, Blastoise, Butterfree, Sandshrew, Umbreon y Houndoom). Sin efecto propio.
- Arreglado además: el título «¡Sesión terminada!» de una pestaña oculta se sobrescribía al desmontarse la sesión.

## Hecho: Foco 100 %, pestañas de estadísticas y equipo (2026-11-06, v0.7.0)

- **Foco rediseñado:** 100 % si reclamas a tiempo, 50 % si tardas (la ventana sigue en 5 min). El Aguante sube el Foco **de cada Pokémon** por encima de 100 %: `Foco × (1 + 0,10 × min(1, Aguante/200))`, solo para sus puntos y EXP; Polvo, tamaño de oleada, legendarios y shiny usan el Foco de la sesión (sin Aguante). Claves renombradas: `focus.baseValue` (antes `noPermissionValue`), `actions.defenseFocusMaxBonus` / `defenseFocusCap`.
- **Economía neutral:** como pasar de 0,85 a 1,0 subía todo un 17,6 %, se escalaron ×0,85 `pointsBase`/`pointsSpAtkDivisor`, `expPerMinute`, `dustPerMinute`, `legendaryChance` (y `shinyChance` ×0,9); `lowFocusThreshold` 0,5 → 0,75 para que reclamar tarde siga quitando un salvaje. Simulador, 60 semillas × 12 semanas: puntos semanales −0,8 % a +1,8 %, ligas, curva de nivel y polvo iguales.
- **Estadísticas | IVs** en la ficha: la pestaña por defecto muestra lo que rinde ahora; la de IVs muestra, por estadística, el **número exacto** (`iv/31`), su calidad (estrellas y palabra) y cuánto suma hoy a esa estadística (`+N`). **«Al evolucionar»:** vista previa de cuánto cambia cada estadística (no todas suben: Caterpie → Metapod baja Ritmo y Captura; Metapod → Butterfree baja Aguante).
- **Equipo:** clic en un Pokémon del equipo para ver sus datos en el panel de la derecha. **Etiquetas Daño / Pasiva / Activable** con globo de ayuda.

## Revisión del Foco: por decidir

- **La calibración original asumía un Foco medio de ≈0,90, pero producción daba 0,85:** el simulador con etiquetas (como antes) da 82,8k puntos semanales para el jugador constante y 32 % llega a Maestra; con el Foco real de producción da 71,2k y 13 %. Es decir, los jugadores reales llevaban ~14 % menos de lo diseñado. Se mantuvo la economía como estaba (neutral). **Si quitas el reescalado ×0,85** (y dejas el Foco al 100 % sin compensar), las recompensas suben un 17,6 % y quedan en lo calibrado (≈83k, Maestra 32 %). Decisión tuya.
- **El Aguante ya no «asegura» contra reclamar tarde:** con Aguante 200 y reclamo tardío, antes rendía el 77 % de lo normal y ahora el 50 %. A tiempo, el Aguante paga un poco más (+0,6 % con Aguante 100, +1,1 % con 200). Con Aguante típico (25–120) el tope de +10 % casi no se alcanza.
- **Suelos de Foco Interno (75 %) y Pie Tambaleante (70 %)** se mantuvieron como valores absolutos: ahora solo importan al reclamar tarde y, en recompensa real, son algo menores que antes (Foco Interno ≈0,64 en la escala antigua). Para igualar habría que subirlo a 0,88.
- El número de «puntos por acción» de la ficha ahora es ~15 % menor porque ya es el valor real con Foco al 100 %.

## Hecho: Despiste, cuenta y limpieza (2026-11-06, v0.5.0)

- **Despiste** (Swinub y Piloswine) ya hace algo: `counterMiss` ahora tiene `scope: 'self' | 'team'`, y Despiste es un 15 % de fallo en el contraataque contra **cualquier** miembro del equipo. No se acumula: vale el mayor entre el fallo propio (Velo Arena / Manto Níveo, 25 %) y el de equipo. Es un −15 % de daño de contraataque, más no activar `counterReflect`, `counterStatus` ni `nextThrowBonus` cuando falla. Un portador agotado sigue contando (igual que el resto de efectos de equipo); uno que está en la Caja no. Se descartó copiar solo «el contraataque falla» porque ya existe en Velo Arena y Manto Níveo (y Swinub puede tener Manto Níveo). `focusLabelFloor` sigue siendo una primitiva válida pero ninguna habilidad la usa desde que se descartaron las capturas.
- **Nombre y país bloqueados 30 días** tras cambiarlos (cada campo por separado, el primer cambio es libre, `DEV_TOOLS=1` los ignora como la zona horaria). Error 409 `name_locked` / `country_locked` con `unlockAt`. Migración `0003_account_locks_privacy`.
- **Modo anónimo** («Entrenador anónimo») en los rankings global y de país; los amigos y tu propia fila siempre ven el nombre. Interruptor en Ajustes → Cuenta → Privacidad.
- **Rol en Pokédex y en la elección de inicial** con la etiqueta nueva; el medidor del micrófono (`live.ts`) usa el Worker; quitados `prefs.tzChangedAt` y `STORAGE_KEYS.game`; fila de F4 del GDD corregida.
- **`soundProfileWeight`:** la fuente (`data/overrides`) tenía el 1.5 original y solo la copia generada tenía el 1.2 que el GDD documenta («se bajó a ×1.2»). El juego usaba 1.2, pero `npm run build:data` lo habría vuelto a subir. Ya está en 1.2 en la fuente y `build:data` no cambia nada.

## Hecho: avisos push de respaldo (2026-11-06, v0.6.0)

Si el navegador congela una pestaña oculta (Ahorro de memoria/energía de Chrome), nadie muestra el aviso de fin de sesión y el jugador reclama pasados los 5 minutos con el ×0.5. Ahora, además, **el servidor manda un aviso push** (Mozilla en Zen/Firefox, Google en Chrome, Apple en Safari).

- **Regla** (`server/push.ts`, `src/game/protocol.ts` «Web Push»): se envía una vez por sesión si el jugador tiene alguna suscripción, el temporizador no está en pausa, la página **no** avisó ya (`timer.notified` es el dedupe: con la pestaña viva no se duplica), han pasado 20 s del fin y no más de 30 min. El programador corre cada 15 s.
- **Interruptor** en Ajustes → Sesiones («Avisos aunque la pestaña esté dormida o cerrada», por navegador) y botón «Enviar aviso de prueba». El service worker (`public/sw.js`) no muestra nada si hay una ventana visible, y usa la misma etiqueta que la página para que un aviso reemplace al otro. Al cerrar sesión, el navegador deja de recibir los avisos de esa cuenta.
- **Seguridad:** el servidor solo acepta endpoints `https` de servicios de push conocidos (FCM, Mozilla, Apple, Windows) para que nadie use el servidor para llamar a direcciones internas; 10 suscripciones por usuario como máximo; límites de peticiones.
- **Para activarlo en el servidor desplegado:** `npm run vapid` genera las tres líneas (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:tu@correo`); ponlas en el entorno (en `docker-compose.yml` ya se pasan) y reinicia (la migración `0004_web_push` se aplica sola). Sin claves, el interruptor dice «Este servidor no tiene los avisos activados». **Guarda la clave privada en secreto y no la cambies:** si cambia, las suscripciones existentes dejan de valer.
- **Verificado:** validación de endpoints, programador (envía solo la sesión vencida y sin aviso previo; no la que sigue en curso ni la que ya avisó la página) y que FCM acepta la firma VAPID y el cifrado (responde 410 al destinatario falso). **No verificado:** la suscripción real de un navegador y la llegada del aviso (el Chromium de pruebas no tiene servicio push). Pruébalo en tu Zen con el botón «Enviar aviso de prueba».
- **Pendiente / detalles:** `web-push` está fijado en la 3.x (la 4.0.0 salió el mismo día; revisar más adelante); una sola instancia del servidor (el programador y el bus de eventos viven en memoria); un fallo al consultar `/api/push/config` aparece como «servidor sin avisos»; no hay un segundo recordatorio antes de que cierre la ventana de 5 minutos (se podría añadir).

## Revisión del 2026-11-06: abierto y por decidir

- **Reclamar tarde: decidido (2026-11-06).** La ventana **se queda en 5 minutos**. Para no perderla si el navegador duerme la pestaña, el servidor manda un aviso push de respaldo (ver «Hecho: avisos push»).
- **Probar con un navegador y un micrófono reales** que el Worker mantiene el muestreo a 100 ms con la pestaña oculta.
- **Privacidad, lo que no se oculta** (a propósito, pero conviene saberlo): en los grupos de estudio, dos invitados del mismo anfitrión se ven el nombre aunque no sean amigos entre sí; y quien envía una solicitud a un código de amigo ve el nombre del dueño aunque sea anónimo.
- **`ApiError` del cliente descarta el cuerpo de la respuesta**, así que `unlockAt` del 409 no llega a la interfaz: la fecha se recalcula con la misma fórmula (`changedAt + 30 días`) desde el usuario refrescado. Si se quiere usar `unlockAt` directo, añadir `body` a `ApiError` (`src/ui/api/client.ts`) y cambiar una línea en `AccountPanel.tsx` (`lockedMeanwhile`).
- **Elección de inicial:** las etiquetas de rol son paradas extra al tabular dentro del grupo de radios, y el anillo de foco rodea solo la parte del radio, no toda la tarjeta (la etiqueta es un botón y no puede ir dentro del radio).
- **Etiqueta «Oculto para los demás»** solo en los rankings global y de país (no en el de amigos).

## Hecho: novedades, etapa y avisos de mantenimiento (2026-11-06)

- **Etapa: Alfa** (`src/ui/changelog/release.ts`). Motivo: el ciclo principal funciona, pero faltan F4 y F5, la recuperación de contraseña por correo, hay decisiones de balance abiertas y dos piezas sin probar en real (micrófono y PostgreSQL). **Pasar a Beta** cuando F4/F5 estén hechas y lo que dice "Pendiente" más abajo esté probado: basta cambiar `RELEASE_STAGE` (los textos de beta ya existen).
- **Página de novedades** (`#/changelog`): changelog por versión en ES y EN, con la etiqueta «ALFA v0.4.0» en el menú, en el inicio de sesión y en Ajustes → Acerca de. Cada versión nueva se añade en `src/ui/changelog/entries.ts` y se sube `version` en `package.json` (hay un test que lo comprueba). La versión vieja «0.3 (F2)» de Ajustes ya no está escrita a mano.
- **Avisos de mantenimiento** con inicio y fin (día y hora) en la zona de cada jugador. Se programan en `#/admin` con `ADMIN_TOKEN` (API en `docs/server.md`). Solo informan: el servidor no se detiene ni bloquea nada.
- Pendiente de esta tanda:
  - **Poner `ADMIN_TOKEN` en el servidor desplegado** (≥ 24 caracteres, p. ej. `openssl rand -hex 24`) y reiniciarlo: sin eso `#/admin` responde «administración no activada». Reiniciar también aplica la migración `0002_maintenance_windows`.
  - `#/admin` no tiene enlace en la interfaz (a propósito); hay que escribir la URL.
  - Probado con un servidor real y navegador (crear, ver, borrar, token incorrecto sin cerrar sesión), pero no con PostgreSQL real, solo PGlite.
  - Un aviso se ve desde que se publica hasta que termina la ventana (no hay «mostrar solo X horas antes»).

## Hecho: profundidad de la sesión (2026-11-05)

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
- **F. Clima real con Open-Meteo**, por la ubicación del dispositivo (redondeada a ~10 km) o la ciudad escrita. Sin clima manual para jugadores (solo en el panel de desarrollo, con DEV_TOOLS=1): si no se detecta, no hay clima.
- **G. Calibración del micrófono** (~15 s, por dispositivo; el silencio es obligatorio para activarlo), perfil del ruido propio del micrófono restado en cada fotograma, comprobación y medidor en vivo, y explicación en la sesión y en Resultados. Sin opción de audífonos: solo cuenta lo que oye el micrófono.

Pendiente de esta tanda:
- **Probar el micrófono con un micrófono real.** La resta del ruido propio solo se probó con espectros sintéticos, y el asistente no se probó en un navegador. Si un cuarto en silencio sigue dando "Ruido" o "Música", anotar el valor "+N dB" del medidor para ajustar los umbrales.
- **Balance, decisiones abiertas** (`docs/balance-report.md` §10):
  - más Ultra Balls para quien hace sesiones largas (una garantizada al aparecer un legendario, o en las misiones);
  - bajar `encounters.legendaryChance` de 0.0016 a 0.00093 y los umbrales de liga (salen 3–3,5 legendarios nuevos en 12 semanas; el objetivo es 1–3).
- **Grupos:**
  - el botón "Empezar" normal sigue visible mientras tienes una sala abierta;
  - el aviso sonoro de fin de una sesión iniciada por el servidor lo da el `SessionWatcher`.
- **Oleadas:** con 3 o más Pokémon golpeando a un salvaje, la fila "Golpes" se desborda un poco.
- **Despliegue:** `https://pokefocus.helicocraft.com` por un túnel propio de Cloudflare (`cloudflared-pokefocus.service`, configuración en `/etc/cloudflared/pokefocus.yml`), con `TRUST_PROXY=1`. Cuando solo se use el dominio, poner `COOKIE_SECURE=1` y quitar la URL de Tailscale de `APP_ORIGIN`.

## Fases siguientes (GDD §20)

- **F2 — Online: HECHA.** Pendientes menores de la F2:
  - Probar el driver postgres-js (`DATABASE_URL`) con un PostgreSQL real (solo se probó PGlite).
  - Probar de punta a punta: cambio de contraseña, revocar otra sesión, cerrar sesión en todos los dispositivos, rate limit (cubiertos por tests de integración, no por la prueba con navegador).
  - El bus de eventos y el rate limit viven en memoria: una sola instancia del servidor.
  - Recuperación de contraseña por correo (no hay envío de correos todavía).
- **F3 — Foco real: HECHA** (micrófono con calibración y clima real, ver arriba). Texto original:
  perfil sonoro con el micrófono (se mide el ruido en el navegador, sin enviar audio; activa Volador con ruido y Psíquico con silencio) y, opcional, clima real con Open-Meteo para Fuego/Hielo. El micrófono exige un contexto seguro: funciona en `localhost` (dev y Docker local) y en HTTPS, pero no en `http://<ip-tailscale>`. Sin dominio: `tailscale serve` da HTTPS en `https://<máquina>.<tailnet>.ts.net`. Con dominio: proxy inverso con HTTPS automático (p. ej. Caddy). Sin permiso o sin contexto seguro, la sesión sigue sin perfil sonoro.
  - **Descartado (2026-11-05):** capturas de pantalla clasificadas con IA. El Foco se queda en la etiqueta neutra; `focus.model` en la config queda sin uso.
- ~~**F4 — Progresión profunda**~~: hecha (2026-11-14), ver «Para continuar».
- **F5:** ~~intercambios entre amigos~~ hechos (2026-11-15); falta: más packs de especies (proceso de curación en GDD §20.1).
- **graphify: HECHO (2026-11-06).** Grafo en `graphify-out/`. Lo que reveló y ya está arreglado:
  - **Ciclo de imports en el motor** (`context` → `missions` → `individual` → `context` y variantes): eliminado moviendo `MISSION_KINDS` a `src/engine/mission-kinds.ts`. `src/engine/no-cycles.test.ts` falla si vuelve un ciclo de imports de valores.
  - **Documentación desactualizada:** el GDD, `docs/ui-foundation.md` (§4 y Persistencia) y el README describen ya lo que existe (servidor propio, rankings por país, Foco neutro sin capturas, `useGame` como caché del servidor). El diseño original se conserva marcado como «Diseño original (reemplazado por F2…)».
  - Lo que sigue abierto se lista en «Revisión del 2026-11-06» más abajo.
