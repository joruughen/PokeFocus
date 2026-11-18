# Pendientes — 2026-11-15

El prototipo F1 está **completo y jugable** y la **F2 (servidor propio, cuentas, amigos y rankings) está implementada** (ver `docs/F2-plan.md` y `docs/server.md`). Este archivo resume el estado y lo que queda, para que un agente nuevo pueda continuar sin contexto previo.

## Cómo arrancar

```bash
npm install
npm run dev          # app (5173) + API (8787, PGlite en .data/pglite, DEV_TOOLS=1); ?dev = panel de desarrollo
npm test             # 720 tests (motor, reducer, servidor, UI)
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
| `graphify-out/` | Grafo de conocimiento del código y los documentos (`graph.html`, `GRAPH_REPORT.md`). Se actualiza con `graphify update .` (solo código) o `/graphify --update`. Está en `.gitignore` |
| `docs/archive/PENDING-history.md` | Historial: lo hecho por versión, la hoja de ruta A–F, revisiones antiguas y fases F2/F3. Buscar con `grep`, no leer entero |

## Pendiente del prototipo (menor)

Del QA (`docs/qa-report.md`):
1. **R-03 (baja):** con dos pestañas, si la sesión empezó en la pestaña que no es la principal, suenan las dos al terminar. La notificación sí llega una sola vez.
2. **Otros menores:**
   - la animación del contraataque se pierde si recargas a mitad de un lanzamiento;
   - a 390 px se recortan los sprites de los extremos del equipo;
   - a 1024 px el número de Polvo se sale un poco de su tarjeta;
   - la Ball de Estudio sigue seleccionada al elegir un salvaje que no es elegible.

Decisión tomada: **se puede iniciar una sesión con todo el equipo agotado**. Solo se muestra un aviso, porque estudiar siempre compensa (GDD §5.3: los agotados ganan EXP).

Balance a vigilar:
- El maratonista se queda sin Ultra Balls para los legendarios: captura el 21% en el primer encuentro, frente al 52% del jugador constante. Opción: dar Ultra Balls como recompensa al subir de liga en la semana.
- Los puntos de los grinders crecen mucho, porque su equipo sube más rápido de nivel. **Aceptado (2026-11-05):** no se compensa. La ventana de 5 min para reclamar ya frena a quien deja el temporizador corriendo sin estudiar.
- Objetos avanzados (F4): vigilar en uso real que ≈ 1,5 Teralitos y ≈ 1 menta por semana no sean demasiados (`docs/balance-report.md` §12).
- Ultra Balls (2026-11-15): se quitaron de las misiones semanales y se compensó con +1 Ultra cada 5 niveles de entrenador (`docs/balance-report.md` §12). Vigilar en uso real si el maratonista/grinder siguen capturando shiny y legendarios; palanca: `trainer.levelRewards` `step 5` → 2 Ultra o el hito de la Pokédex 25/50. Chapas solo de evento: falta definir los primeros eventos que las den (drops o misiones de evento).

Panel de desarrollo contra un servidor de producción: con `?dev` el panel se abre aunque el servidor tenga `DEV_TOOLS` apagado (Docker, `npm start`). El reloj adelantado y "Terminar la sesión ya" solo cambian la hora del cliente, el servidor ignora `x-dev-now` y responde `409 not_finished` al reclamar (y `403 dev_disabled` en los botones de objetos). Propuesta: que el servidor anuncie si tiene herramientas de desarrollo y que el panel se desactive si no las tiene; y un texto de error específico para `not_finished`.

## ▶ Para continuar (estado al 2026-11-15)

**Kanto completo (paso 9, 2026-11-16):** 158 especies (151 de Kanto + 7 del Pack 1), 115 habilidades, 81 técnicas especiales, sprites descargados, topes de nivel 70/100/140; curación y lo que debe revisar el usuario en `docs/kanto-report.md`. Falta: revisión del usuario (roles, Abra/Gastly/Houndour, etapa única en liga Base), regenerar `docs/balance-report.md` cuando el motor de ligas esté cerrado y repetir la medición de la curva de EXP.

Si abres un chat nuevo, di «continúa con docs/PENDING.md» y empieza por aquí.

**`main` = v0.12.0** (commit local; ver `git status -sb` para saber si falta el push). Sobre la v0.11.0 desplegada añade: F5 intercambios entre amigos (migración 0012), F4 objetos avanzados (MT 15, Tera 20, Menta a elegir 25, Cápsula 30, Chapa 40 solo de eventos; Teralitos desde el nivel 15), recompensas y ventana de subida de nivel, página Perfil (`#/profile`, con acciones dev de EXP), Mochila como página, selección múltiple para soltar en la Caja, importar/exportar JSON en el admin (`docs/admin-json.md`), buscador con filtro para especies y objetos, viñetas de color en las descripciones, probabilidad de aparición en la Pokédex y destacadas «Desde nv. N», menú «Más» móvil, cola de avisos y sprites grandes que caben. Typecheck limpio y 1720 tests.

**Para desplegar v0.12.0:** `git pull` y `docker compose up -d --build` (migración 0012 automática). **No tocar `PASSWORD_PEPPER`** (ya está en el `.env`).

**Recursos:** máximo 2 agentes a la vez y vitest con `--maxWorkers=2`. Los agentes se cortan con el límite de uso de 5 h: se retoman con un mensaje.

**Decididas por el usuario (2026-11-15):** intercambios: los dos pagan el Polvo del Pokémon más caro, el mote se conserva, no da EXP de entrenador por especie nueva, máximo 10 ofertas abiertas; Menta a elegir; Ultra Balls: se quitan de las misiones semanales y cada 5 niveles de entrenador se da 1 extra (los hitos de Pokédex 25/50 siguen dando Ultra); multiplicadores de destacadas sin cambios (las descripciones de eventos dicen la probabilidad real, ver memoria `feedback-event-odds`).

**Estado al 2026-11-17 (v0.13.0, todo subido a `main`, 1807 tests y typecheck en verde):** hecho el plan de `docs/beta-balance-plan.md` (pasos 1-10): rendimiento y seguridad (ranking cacheado, pool, límites, SSE, 503, contenedores, login), pruebas de carga y auditoría, simulador a 104 semanas, Caja 150→400 con capturas pendientes, curva de EXP con codo (nv. 36/50/60 hacia el mes 3/9/18 del constante, medido con Kanto en `docs/longterm-kanto.md`), Polvo `25+3L+0,03L²`, Balls que no hacen atacar solos, evolución con caramelos (25/100) y 3.ª etapa con nivel de entrenador 15, ligas con 40 subrangos (Base/Super/Ultra 1-5, Maestra 1-25) con oleadas y etapas de salvaje por liga y premios de Polvo, Kanto completo (158 especies, 115 habilidades, 81 técnicas; `docs/kanto-report.md`), vista previa del selector de caramelos, nota para jugadores al publicar contenido y mensaje al regalar. **Migraciones nuevas: 0013 (índices de ranking) y 0014 (nota de contenido); se aplican solas.** **Para desplegar:** `git pull` y `docker compose up -d --build`; en el `.env`: `COOKIE_SECURE=1`, `APP_ORIGIN` solo con el dominio, `ADMIN_TOKEN` vacío, y límites `APP_MEM_LIMIT`/`APP_CPUS`/`DB_MEM_LIMIT`/`DB_CPUS` según la máquina. **No tocar `PASSWORD_PEPPER`.** **Pendiente:** revisar a mano lo que el usuario aún no ha visto (Caja llena, ventana de pendientes, ligas, avisos, nota/mensaje del admin, vista previa de caramelos, curación de Kanto: lista en `docs/kanto-report.md`); repetir las pruebas de carga con todo junto (`npm run load:run -- --levels 5000 --big-base 100000 [--scenario peak|event]`, calienta el PC); Turnstile (el usuario crea el widget en Cloudflare y da la clave del sitio); pasar la CSP de solo-informe a obligatoria tras mirar la consola del navegador; borrado y exportación de cuenta (RGPD) y protección del admin (Cloudflare Access o 2FA); Uptime Kuma y copias de seguridad (el usuario las hará después); cosméticos de podio; siguiente pack de contenido en 4-6 meses (Kanto se agota en ~1 año para el constante).

**v0.13.1 (subida) y v0.14.0 (sin commitear, 2026-11-17):** en grupo, todo el equipo gana hasta +5 % de puntos y EXP y la sesión hasta +10 % de Polvo (`conditions.groupTeamBonus` y `groupDustBonus`, v0.13.1). v0.14.0: curaciones entre compañeros (+20 de energía, una por oleada tras una sesión de grupo, a compañeros distintos, el receptor acepta cuando termine su sesión, caduca a las 12 h; `energy.groupHeal`, `server/routes/heals.ts`, migración **0015** automática, `docs/server.md` y GDD §9.2). **Falta:** revisarla en el navegador con dos cuentas reales (390 y 1280 px), medir el bonus de grupo con el simulador (hoy ningún perfil simula grupos) y, si se quiere, aviso push al receptor.

**v0.15.0 (sin commitear, 2026-11-17): caramelos de compañero.** La primera sesión válida del día (≥ 25 min) da 1 caramelo a cada línea evolutiva del equipo y 2 a la del líder (`progression.studyCandy`, `src/engine/studyCandy.ts`, `DaySummary.candySessions`, evento `studyCandy`, bloque en Resultados). Decidido con simulador (GDD §12.2): sin cambios de nivel, +5-6 % de puntos en casuales, ruido en intensos. Sin migración. **Falta:** revisar el bloque de Resultados en el navegador (390 y 1280 px) y decidir si `perDay` pasa a 2; el informe `docs/longterm-report.md` no se ha regenerado con la regla nueva.

**Plan de balance para la beta (2026-11-16):** decisiones cerradas y pasos en `docs/beta-balance-plan.md` (ligas con subrangos, curva de EXP, Polvo como freno, 3.ª etapa, Kanto 151, pruebas de estrés). Alpha sin reset.

**Pendiente:**
- Decisiones de balance: reescalado ×0,85 del Foco, `legendaryChance`, suelo de Foco Interno, +14 % del noctámbulo, +35 % de capturas del casual por las recompensas de nivel, regla de la parálisis.
- Recuperar la contraseña por correo (opción A: enlace desde el admin; opción B: servicio de correo gratuito); paquetes de especies nuevos; detección de anomalías; push para eventos con la app cerrada; aviso cuando un objeto propio ya lo usa otro evento; nota para jugadores al publicar contenido; mensaje al regalar desde Jugadores.
- Revisar en navegador lo que nadie ha visto aún: Perfil, intercambios con dos cuentas reales, Pokédex con probabilidad, ventanas de nivel y de evento.
- Detalles menores: horas con punto decimal en Vínculo y Dominio, ventana de llegada de intercambio lenta (≈2,5 s), barra de EXP vacía en la ficha de algunos Pokémon, ayuda del modo Seleccionar con «Mayús/Esc» en móvil.
- Pruebas en real: PostgreSQL, micrófono, avisos push, sonido con dos pestañas.

## Abierto de revisiones anteriores

El detalle está en `docs/archive/PENDING-history.md`:
- **Revisión del Foco: por decidir** (quitar el reescalado ×0,85, suelos de Foco Interno y Pie Tambaleante).
- **Revisión del 2026-11-06:** privacidad en grupos y en solicitudes de amistad, anillo de foco en la elección de inicial, etiqueta «Oculto para los demás» solo en rankings global y de país.
- **Sin probar en real:** micrófono con la pestaña oculta y calibración, PostgreSQL con `DATABASE_URL`, avisos push de un navegador real, `ADMIN_TOKEN` y claves VAPID en el servidor desplegado.
- **Despliegue:** `https://pokefocus.helicocraft.com` por túnel de Cloudflare (`cloudflared-pokefocus.service`, `/etc/cloudflared/pokefocus.yml`), `TRUST_PROXY=1`. Cuando solo se use el dominio, `COOKIE_SECURE=1` y quitar la URL de Tailscale de `APP_ORIGIN`.
- **F5:** faltan más packs de especies (GDD §20.1). Recuperar la contraseña por correo sigue pendiente.
