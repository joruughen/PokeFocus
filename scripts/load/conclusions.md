## Conclusiones

Escritas a mano a partir de las mediciones de arriba (`scripts/load/conclusions.md`; el informe las incluye al regenerarse). Todo lo medido es **en esta máquina, con el generador de carga y PostgreSQL en el mismo equipo** y con la mezcla de uso descrita arriba.

### Qué aguanta esta máquina

- **Hasta ~5.000 usuarios conectados a la vez, sin problemas**: 0 errores, p50 1,5 ms, p95 53 ms, p99 62 ms con ~260 peticiones/s; el servidor Node usó ~0,3 núcleos y ~1,1 GB de RAM (casi todo son las 5.000 conexiones SSE y la cola de peticiones), PostgreSQL ~2,6 núcleos y ~100 MB. Hay margen en Node; el recurso que se gasta es la **CPU de PostgreSQL**.
- **Entre ~6.000 y ~7.500 usuarios empieza la saturación** (la latencia p95 pasa de 0,5 s con 7.300-7.800 usuarios activos en las dos pruebas de 10.000). PostgreSQL llega a ~9 núcleos de CPU y el pool de 10 conexiones del servidor se llena; las peticiones se encolan, la latencia crece hasta ~20 s y el RAM de Node sube hasta ~2 GB (peticiones en cola).
- **Con 10.000 usuarios el servidor se cuelga y no se recupera solo.** Pasó en las dos pruebas: tras ~4 minutos de saturación, PostgreSQL pasa a 0 % de CPU, las 10 conexiones del pool quedan «idle in transaction» y todas las rutas que tocan la base agotan el tiempo (`/api/config`, que no usa la base, sigue respondiendo en <2 ms: el proceso no está caído, está bloqueado en sus accesos a la base). Hay que reiniciar el servidor. **Es un hallazgo importante por sí mismo**, más que el techo de usuarios (ver abajo).
- Con 100 y 1.000 usuarios todo es trivial (p95 6 y 14 ms, CPU <20 %).

«Usuario simultáneo» aquí = app abierta con su conexión SSE y una acción cada ~20 s (±50 %, es decir ~0,05 peticiones/s por usuario; el 10 % estudia en bucle). Una app de estudio por pomodoros pasa la mayor parte del tiempo parada (25-50 min por sesión), así que el uso real podría ser **más ligero** que este modelo, pero no hay datos de uso real para afirmarlo: si los jugadores consultan rankings más a menudo, el techo baja proporcionalmente.

### Cuello de botella y hallazgos

1. **Ranking global (`GET /api/leaderboard?scope=global`)**: p50 ~51 ms con 5.000 jugadores (los demás endpoints están en 0,2-12 ms) y es la mayor parte de la CPU de PostgreSQL (~2,6 núcleos con solo ~260 peticiones/s). Hace un `count(*)` con join sobre toda la tabla y otro conteo para «mi posición» en cada petición, así que su coste **crece con el número de jugadores**. Candidato claro de mejora: cachear la respuesta global/por país unos segundos en memoria (todos los jugadores ven lo mismo salvo `mine`) o mantener el total aparte. No se ha modificado nada del servidor en esta tarea.
2. **Bloqueo del pool bajo saturación (hipótesis, no demostrada con un cambio de código)**: en el momento del cuelgue las 10 conexiones están «idle in transaction» y la última consulta de todas es `select … from player_docs … for update` (el inicio de `runGameAction`), es decir, cada transacción espera algo que **no es la base**. Lo único compartido que se espera ahí es la recarga del contenido vivo (`ensureLoaded` en `server/content/service.ts`: una promesa `loading` compartida, cada 60 s): si la dispara alguien que usa el pool normal (`GET /api/content`, el tick de 30 s) mientras las 10 conexiones están ocupadas por transacciones que esperan esa misma promesa, nadie avanza. Encaja con que también `content.get` falle. Para confirmarlo y arreglarlo: recargar el contenido fuera de las transacciones (o con una conexión reservada) y poner tiempos máximos (`statement_timeout`, `idle_in_transaction_session_timeout`) para que un bloqueo se cure solo.
3. **Registro e inicio de sesión (scrypt)**: ~60 ms de CPU cada uno en el pool de 4 hilos de libuv; el máximo medido fue ~75 altas/s con 4 hilos (a costa de ~440 % de CPU del proceso y latencias de ~1,3 s por la cola). Un pico de registros (p. ej. un lanzamiento) se atiende a ese ritmo; no hay límite global, solo por IP (5 altas/hora/IP).
4. **RAM**: base ~260 MB; con 5.000 SSE ~0,9-1,1 GB; con 10.000 y cola ~2,1 GB. Estimación: ~0,1-0,17 MB por usuario conectado, más lo que ocupen las peticiones encoladas. PostgreSQL solo 50-130 MB de RAM (la base de 10.000 jugadores pesa ~70 MB).
5. **Red**: ~2 MB/s de HTTP con 5.000 usuarios (~0,4 KB/s por usuario) y ~0,6 KB/s de PostgreSQL↔servidor por usuario; las SSE solo mandan un `: ping` cada 25 s. No es un límite en ningún nivel (todo fue por loopback: **no se ha medido** la red real, TLS ni la latencia de los clientes).
6. **Descriptores de fichero**: ~1 por usuario conectado (+ conexiones de peticiones); el límite del sistema aquí es 524.288, pero en un contenedor/servidor con `ulimit -n 1024` el servidor se quedaría sin descriptores a unos 1.000 usuarios SSE. Comprobarlo en producción.
7. Un solo proceso: bus de eventos, límites de uso y recarga de contenido viven en memoria (ya documentado en `docs/server.md`); no se puede escalar a varias instancias sin cambiarlo.

### Qué esperar en producción

**No lo sé.** No conozco la máquina real de producción (CPU, RAM, disco, si PostgreSQL comparte núcleos con la app, ni su proxy/TLS): `docker-compose.yml` no fija límites y no he tocado ni consultado el servidor real. Lo que sí se puede decir con lo medido, para dimensionarlo tú:

- Para ~5.000 usuarios conectados con este patrón hacen falta, como orden de magnitud, **~1 núcleo para Node, ~3 núcleos para PostgreSQL (mientras el ranking global siga sin caché), ~1,5 GB de RAM para la app y ~0,2 GB para PostgreSQL**. Con 1-2 vCPU compartidas el techo estará mucho más abajo que aquí (esta CPU es un Ryzen 5 7500F, rápido), probablemente en el orden de cientos o pocos miles de usuarios con este patrón; es una extrapolación, no una medida.
- El inicio de sesión cuesta ~60 ms de CPU: con 2 hilos efectivos, una oleada de 1.000 inicios de sesión simultáneos tardaría del orden de 30 s en atenderse.
- Antes de cualquier lanzamiento a miles de jugadores: arreglar/confirmar el bloqueo del punto 2, cachear el ranking global y volver a ejecutar estas pruebas (`npm run load:run -- --levels 5000,10000`). Para saber el techo real en producción, ejecutar el mismo script **contra una réplica local con los mismos recursos** (el script no admite apuntar a producción a propósito).

### Limitaciones de estas pruebas

- Mismo equipo para generador, servidor y PostgreSQL (el generador gastó solo ~5-20 % de CPU, no es el límite, pero compite por la memoria y el planificador); en el equipo había ~8 GB ya ocupados por otros procesos (RAM libre mínima medida: ~4 GB).
- Una sola ejecución por nivel (más una repetición de 10.000 que dio el mismo resultado): sin intervalos de confianza.
- Modelo de uso inventado (cada ~20 s, 10 % estudia); el ritmo real puede ser distinto. No cubierto: grupos de estudio, intercambios, amigos escribiendo, push, clima, panel de admin, subida de imágenes, difusión masiva de eventos SSE (`content`/`event_announce` a todos), acciones de oleadas (`throwBall`…), cierres de sesión reales a los 25 min.
- Las sesiones de estudio adelantan el reloj con `x-dev-now` (`DEV_TOOLS=1`); el coste del servidor es el mismo, pero `DEV_TOOLS` también desactiva los bloqueos de cambio de nombre/país (irrelevante aquí).
- PostgreSQL 16 sin ajustar (valores por defecto) en docker, con disco real; producción usa PostgreSQL 17. Una configuración afinada (p. ej. `shared_buffers`) o un pool mayor cambiaría los números.
