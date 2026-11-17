# Informe de progresión a largo plazo

> Generado por `npm run simulate -- --longterm --weeks 104 --seeds 6 --profile constant,casual-real,marathoner,night-owl --out /tmp/claude-1000/-home-jorughen-Projects-PokeFocus/a228c3ad-ca28-4639-92d3-df93489ee298/scratchpad/lt-kanto-final.md`. Las tablas se regeneran con `npm run simulate -- --longterm` (no editarlas a mano); la sección final «Lectura» es manual y hay que revisarla si se regenera.

- Horizonte: **104 semanas**; **6 semillas** por perfil (las mismas semillas 1..6 en cada ejecución, así que dos configuraciones se comparan en pareado); misiones del motor reclamadas: sí.
- Configuración: la actual del juego (`src/data/game/custom-game-config.json`).
- Pack: **158 especies** (5 legendarias/míticas). Topes de nivel por Pokédex: 0 especies → nv. 30, 55 especies → nv. 40, 100 especies → nv. 50, 140 especies → nv. 60. Nivel máximo: 100.
- Ligas semanales con subrangos (40 escalones; puntos del primer subrango): Super ≥ 4,000, Ultra ≥ 30,000, Master ≥ 100,000; último escalón (Master 25) ≥ 1,000,000. Oleadas de hasta 2–10 salvajes según el escalón; las etapas evolutivas y los legendarios dependen de la liga (GDD §10.2).
- Tiempo de cálculo: 263 s.

Las cifras son **medianas entre semillas** salvo que se indique. «Nivel EXP máx.» es el nivel que daría la EXP del mejor miembro sin tope; «Nivel máx.» es el real (limitado por el tope de Pokédex). «Pts/sem» es la media de las 4 semanas hasta la muestra (las semanas en blanco cuentan 0) y la liga se calcula con esa media.

## Perfiles

- **constante**: 4 × 25 min todos los días (mañana + tarde), con descansos.
- **casual real**: 1 × 25 min en ~3 días a la semana (2–4), por la tarde; ~15 % de las semanas en blanco.
- **maratonista**: 2 × 100 min todos los días.
- **noctámbulo**: 3 × 50 min cada noche, empezando entre las 21:00 y las 23:00.

## constante

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 26.1 | 28 | 28 | 40 | 80 | 18 | 28,533 | 6,459 | 23,731 | Super 5 | 0.0 |
| 8 | 32.0 | 34 | 34 | 50 | 107 | 24 | 57,801 | 367 | 42,261 | Ultra 2 | 0.0 |
| 12 | 35.0 | 37 | 37 | 50 | 117 | 28 | 88,835 | 1,464 | 52,983 | Ultra 3 | 0.0 |
| 26 | 43.6 | 49 | 49 | 50 | 136 | 41 | 191,721 | 241 | 77,894 | Ultra 4 | 0.0 |
| 39 | 49.7 | 53 | 53 | 60 | 146 | 50 | 286,651 | 347 | 99,927 | Ultra 5 | 0.0 |
| 52 | 55.6 | 60 | 60 | 60 | 151 | 50 | 377,234 | 420 | 126,025 | Master 3 | 0.2 |
| 78 | 59.1 | 60 | 64 | 60 | 153 | 50 | 558,383 | 413 | 144,340 | Master 4 | 0.7 |
| 104 | 59.3 | 60 | 65 | 60 | 154 | 50 | 742,462 | 630 | 155,773 | Master 5 | 1.5 |

Mejor semana (mediana entre semillas): **159,254 puntos → Master 5**.

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 35 (sem. 5) | día 35 (sem. 5) |
| nivel 36 (real) | día 71 (sem. 11) | día 71 (sem. 11) |
| nivel 40 (real) | día 102 (sem. 15) | día 102 (sem. 15) |
| nivel 50 (real) | día 181 (sem. 26) | día 181 (sem. 26) |
| nivel 60 (real) | día 314 (sem. 45) | día 314 (sem. 45) |
| 55 especies | día 12 (sem. 2) |  |
| 100 especies | día 47 (sem. 7) |  |
| 140 especies | día 208 (sem. 30) |  |
| 158 especies | no |  |
| 1 legendario | día 507 (sem. 73) | – |
| 3 legendarios | no | – |
| 5 legendarios | no | – |

## casual real

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 13.0 | 15 | 15 | 30 | 18 | 6 | 2,497 | 657 | 750 | Base 3 | 0.0 |
| 8 | 15.9 | 18 | 18 | 30 | 31 | 9 | 5,240 | 2,093 | 1,298 | Base 4 | 0.0 |
| 12 | 19.0 | 21 | 21 | 30 | 40 | 10 | 8,131 | 3,821 | 1,748 | Base 4 | 0.0 |
| 26 | 22.8 | 24 | 24 | 40 | 59 | 14 | 16,842 | 6,676 | 2,281 | Base 5 | 0.0 |
| 39 | 25.1 | 27 | 27 | 40 | 64 | 16 | 24,100 | 8,495 | 2,685 | Base 5 | 0.0 |
| 52 | 26.8 | 29 | 29 | 40 | 70 | 18 | 32,453 | 11,524 | 2,997 | Base 5 | 0.0 |
| 78 | 30.7 | 32 | 32 | 40 | 81 | 21 | 50,550 | 18,379 | 4,062 | Super 1 | 0.0 |
| 104 | 32.6 | 35 | 35 | 40 | 93 | 23 | 64,942 | 23,397 | 3,626 | Base 5 | 0.0 |

Mejor semana (mediana entre semillas): **6,953 puntos → Super 2**.

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 389 (sem. 56) | día 389 (sem. 56) |
| nivel 36 (real) | no | no |
| nivel 40 (real) | no | no |
| nivel 50 (real) | no | no |
| nivel 60 (real) | no | no |
| 55 especies | día 160 (sem. 23) |  |
| 100 especies | no |  |
| 140 especies | no |  |
| 158 especies | no |  |
| 1 legendario | no | – |
| 3 legendarios | no | – |
| 5 legendarios | no | – |

## maratonista

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 30.1 | 32 | 32 | 40 | 93 | 24 | 53,524 | 14,953 | 55,453 | Ultra 3 | 0.0 |
| 8 | 35.9 | 40 | 40 | 50 | 116 | 32 | 108,610 | 27,303 | 106,072 | Master 1 | 0.0 |
| 12 | 39.5 | 44 | 44 | 50 | 128 | 39 | 165,906 | 17,829 | 138,453 | Master 4 | 0.3 |
| 26 | 54.1 | 59 | 59 | 60 | 152 | 50 | 355,022 | 11,355 | 255,897 | Master 10 | 1.2 |
| 39 | 55.7 | 60 | 62 | 60 | 156 | 50 | 525,078 | 22,537 | 302,573 | Master 12 | 1.2 |
| 52 | 59.3 | 60 | 65 | 60 | 157 | 50 | 699,603 | 82,995 | 323,834 | Master 13 | 1.3 |
| 78 | 59.3 | 60 | 68 | 60 | 158 | 50 | 1,046,237 | 276,811 | 336,260 | Master 13 | 1.7 |
| 104 | 59.3 | 60 | 71 | 60 | 158 | 50 | 1,397,110 | 560,649 | 351,152 | Master 14 | 2.3 |

Mejor semana (mediana entre semillas): **364,859 puntos → Master 14**.

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 21 (sem. 3) | día 21 (sem. 3) |
| nivel 36 (real) | día 42 (sem. 6) | día 42 (sem. 6) |
| nivel 40 (real) | día 56 (sem. 8) | día 56 (sem. 8) |
| nivel 50 (real) | día 90 (sem. 13) | día 90 (sem. 13) |
| nivel 60 (real) | día 158 (sem. 23) | día 158 (sem. 23) |
| 55 especies | día 6 (sem. 1) |  |
| 100 especies | día 33 (sem. 5) |  |
| 140 especies | día 119 (sem. 17) |  |
| 158 especies | día 460 (sem. 66) |  |
| 1 legendario | día 139 (sem. 20) · 83% | – |
| 3 legendarios | no (50% lo logra) | – |
| 5 legendarios | no | – |

## noctámbulo

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 29.2 | 31 | 31 | 40 | 93 | 21 | 41,642 | 12,279 | 42,091 | Ultra 2 | 0.0 |
| 8 | 34.6 | 36 | 36 | 50 | 114 | 29 | 83,357 | 18,925 | 77,572 | Ultra 4 | 0.0 |
| 12 | 38.7 | 40 | 40 | 50 | 127 | 34 | 126,258 | 8,769 | 100,355 | Master 1 | 0.0 |
| 26 | 49.3 | 53 | 53 | 60 | 147 | 50 | 275,889 | 654 | 150,750 | Master 5 | 1.0 |
| 39 | 55.7 | 60 | 60 | 60 | 154 | 50 | 406,630 | 1,266 | 205,630 | Master 8 | 2.3 |
| 52 | 58.3 | 60 | 62 | 60 | 157 | 50 | 539,448 | 4,152 | 237,159 | Master 10 | 2.7 |
| 78 | 59.5 | 60 | 66 | 60 | 158 | 50 | 804,424 | 66,349 | 258,045 | Master 10 | 3.7 |
| 104 | 59.9 | 60 | 70 | 60 | 158 | 50 | 1,073,303 | 190,804 | 268,685 | Master 11 | 5.3 |

Mejor semana (mediana entre semillas): **284,192 puntos → Master 11**.

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 24 (sem. 4) | día 24 (sem. 4) |
| nivel 36 (real) | día 53 (sem. 8) | día 53 (sem. 8) |
| nivel 40 (real) | día 73 (sem. 11) | día 73 (sem. 11) |
| nivel 50 (real) | día 122 (sem. 18) | día 122 (sem. 18) |
| nivel 60 (real) | día 194 (sem. 28) | día 194 (sem. 28) |
| 55 especies | día 8 (sem. 2) |  |
| 100 especies | día 33 (sem. 5) |  |
| 140 especies | día 135 (sem. 20) |  |
| 158 especies | día 511 (sem. 73) · 83% |  |
| 1 legendario | día 178 (sem. 26) | – |
| 3 legendarios | día 360 (sem. 52) · 83% | – |
| 5 legendarios | día 627 (sem. 90) · 67% | – |

## Hallazgos (calculados de esta ejecución)

- **constante**: Pokédex completa (158) no; nivel 60 día 314 (sem. 45); a la semana 104 lleva 154 especies, nivel máx. 60 (por EXP 65), Polvo acumulado 742,462 de los que sobran 630 (0%).
- **casual real**: Pokédex completa (158) no; nivel 60 no; a la semana 104 lleva 93 especies, nivel máx. 35 (por EXP 35), Polvo acumulado 64,942 de los que sobran 23,397 (36%).
- **maratonista**: Pokédex completa (158) día 460 (sem. 66); nivel 60 día 158 (sem. 23); a la semana 104 lleva 158 especies, nivel máx. 60 (por EXP 71), Polvo acumulado 1,397,110 de los que sobran 560,649 (40%).
- **noctámbulo**: Pokédex completa (158) día 511 (sem. 73) · 83%; nivel 60 día 194 (sem. 28); a la semana 104 lleva 158 especies, nivel máx. 60 (por EXP 70), Polvo acumulado 1,073,303 de los que sobran 190,804 (18%).
