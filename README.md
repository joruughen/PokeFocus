# PokeFocus

PokeFocus es una aplicación web de escritorio que recompensa el estudio con Pokémon. Cada sesión de estudio (pomodoro) hace que tu **equipo de 6 Pokémon** genere **Puntos de Equipo**, suba de nivel y aprenda técnicas. Al terminar la sesión aparece un **grupo de Pokémon salvajes** que puedes intentar capturar. Los Puntos de Equipo deciden tu **liga** y tu posición en los **rankings semanal y mensual** (de amigos, de tu país y global).

Es un proyecto personal, de uso privado entre amigos. Estado: **alfa**; lo que falta y lo que está sin probar está en [`docs/PENDING.md`](docs/PENDING.md).

**Stack:** React + Vite + TypeScript + Tailwind en el cliente; servidor propio con Node + Hono + PostgreSQL (Drizzle; PGlite embebido en desarrollo); motor de juego puro y determinista en `src/engine/`; datos de especies importados de PokeAPI.

## Cómo arrancar

```bash
npm install
npm run dev          # app (5173) + API (8787, PGlite en .data/pglite, DEV_TOOLS=1); ?dev = panel de desarrollo
npm test             # tests (motor, reducer, servidor, UI)
npm start            # producción: API + dist/ en un solo origen (requiere npm run build)
docker compose up --build   # PostgreSQL 17 + app (cuando haya Docker)
npm run simulate     # simulador de balance → docs/balance-report.md
```

Las variables de entorno del servidor están en `.env.example` y se explican en [`docs/server.md`](docs/server.md) (incluye la API de administración y los avisos de mantenimiento). Para administrar el juego en vivo (cambiar números, apariciones y misiones sin desplegar, crear **eventos**, dar soporte a jugadores, métricas) hace falta una cuenta con rol `admin` (`ADMIN_EMAILS`) y la pantalla `#/admin`; la guía está en [`docs/admin.md`](docs/admin.md), que también explica las **copias de seguridad** (PostgreSQL, `UPLOADS_DIR` y `PASSWORD_PEPPER`).

## Documentos

| Documento | Para qué |
|---|---|
| [`docs/GDD.md`](docs/GDD.md) | Diseño completo del juego (fuente de verdad), con la calibración aplicada en §20.2 |
| [`docs/PENDING.md`](docs/PENDING.md) | Estado actual, decisiones tomadas y lo que queda por hacer |
| [`docs/F2-plan.md`](docs/F2-plan.md) | F2: servidor propio, cuentas, amigos y rankings (decisiones y arquitectura) |
| [`docs/server.md`](docs/server.md) | El servidor: estructura, entorno, API, seguridad, grupos de estudio, contenido en vivo, eventos, API de administración y avisos de mantenimiento |
| [`docs/admin.md`](docs/admin.md) | Guía del administrador: roles, flujo borrador → publicar, eventos, soporte, métricas y copias de seguridad |
| [`docs/admin-plan.md`](docs/admin-plan.md) | Plan de la fase E (administración en vivo y eventos) y las desviaciones de lo implementado |
| [`docs/session-depth-plan.md`](docs/session-depth-plan.md) | Profundidad de la sesión: reparto del daño, informe, grupos, guía de tipos, micrófono y clima real |
| [`docs/effects.md`](docs/effects.md) | Primitivas de efecto de técnicas y habilidades |
| [`docs/engine-api.md`](docs/engine-api.md) | API del motor: modelo de daño, misiones, reglas de sueño, contenido en vivo y eventos |
| [`docs/ui-foundation.md`](docs/ui-foundation.md) | Sistema de diseño, componentes, estado del cliente, motor de pistas, cómo añadir pantallas |
| [`docs/audio.md`](docs/audio.md) | Módulo de audio: efectos sintetizados y música generativa |
| [`docs/balance-report.md`](docs/balance-report.md) | Informe del simulador de balance |
| [`docs/qa-report.md`](docs/qa-report.md) | Resultado del QA: qué se probó, fallos corregidos y pendientes |
| [`docs/ux-research.md`](docs/ux-research.md) | Investigación de UX que guió el frontend |
| [`public/art/README.md`](public/art/README.md) | Arte pixel generado por código (`npx tsx scripts/art/build.ts`) |
