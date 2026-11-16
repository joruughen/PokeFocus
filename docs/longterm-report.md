# Informe de progresión a largo plazo

> Generado por `npm run simulate -- --longterm --seeds 10`. Las tablas se regeneran con `npm run simulate -- --longterm` (no editarlas a mano); la sección final «Lectura» es manual y hay que revisarla si se regenera.

- Horizonte: **104 semanas**; **10 semillas** por perfil (las mismas semillas 1..10 en cada ejecución, así que dos configuraciones se comparan en pareado); misiones del motor reclamadas: sí.
- Configuración: la actual del juego (`src/data/game/custom-game-config.json`).
- Pack: **56 especies** (5 legendarias/míticas). Topes de nivel por Pokédex: 0 especies → nv. 30, 25 especies → nv. 40, 36 especies → nv. 50, 50 especies → nv. 60. Nivel máximo: 100.
- Ligas semanales (puntos): Super ≥ 6,000, Ultra ≥ 60,000, Master ≥ 95,000.
- Tiempo de cálculo: 182 s.

Las cifras son **medianas entre semillas** salvo que se indique. «Nivel EXP máx.» es el nivel que daría la EXP del mejor miembro sin tope; «Nivel máx.» es el real (limitado por el tope de Pokédex). «Pts/sem» es la media de las 4 semanas hasta la muestra (las semanas en blanco cuentan 0) y la liga se calcula con esa media.

## Perfiles

- **casual**: 1–2 × 25 min en ~4 días laborales al azar, por la tarde.
- **constante**: 4 × 25 min todos los días (mañana + tarde), con descansos.
- **maratonista**: 2 × 100 min todos los días.
- **noctámbulo**: 3 × 50 min cada noche, empezando entre las 21:00 y las 23:00.
- **irregular**: ~50 % de los días, 1–4 × 25 min a hora aleatoria.
- **casual real**: 1 × 25 min en ~3 días a la semana (2–4), por la tarde; ~15 % de las semanas en blanco.
- **exámenes**: ráfagas de 2–3 semanas (~6 días, 3–4 × 25 min) seguidas de 2–4 semanas casi vacías (~8 % de los días, 1 × 25 min).
- **abandono**: empieza constante (3 × 25 min casi a diario) y decae hasta dejar de jugar entre las semanas 6 y 10.

## casual

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 18.3 | 20 | 20 | 30 | 21 | 7 | 6,195 | 277 | 3,643 | Base | 0.0 |
| 8 | 24.0 | 26 | 26 | 30 | 23 | 8 | 12,254 | 531 | 6,498 | Super | 0.0 |
| 12 | 27.9 | 30 | 30 | 35 | 25 | 10 | 18,492 | 287 | 8,395 | Super | 0.0 |
| 26 | 36.5 | 40 | 40 | 40 | 32 | 15 | 38,051 | 313 | 13,095 | Super | 0.1 |
| 39 | 40.0 | 40 | 45 | 40 | 35 | 18 | 57,202 | 3,693 | 16,371 | Super | 0.3 |
| 52 | 47.3 | 50 | 51 | 50 | 38 | 21 | 77,690 | 327 | 21,296 | Super | 0.5 |
| 78 | 50.0 | 50 | 58 | 50 | 42 | 27 | 117,495 | 7,553 | 24,506 | Super | 0.8 |
| 104 | 49.9 | 50 | 63 | 50 | 47 | 32 | 156,536 | 310 | 26,273 | Super | 1.4 |

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 85 (sem. 13) | día 85 (sem. 13) |
| nivel 36 (real) | día 134 (sem. 20) | día 134 (sem. 20) |
| nivel 40 (real) | día 182 (sem. 26) | día 182 (sem. 26) |
| nivel 50 (real) | día 339 (sem. 49) | día 339 (sem. 49) |
| nivel 60 (real) | no (20% lo logra) | día 618 (sem. 89) |
| 25 especies | día 83 (sem. 12) |  |
| 36 especies | día 314 (sem. 45) |  |
| 50 especies | no (20% lo logra) |  |
| 56 especies | no |  |
| 1 legendario | día 434 (sem. 62) · 80% | – |
| 3 legendarios | no (10% lo logra) | – |
| 5 legendarios | no | – |

## constante

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 32.2 | 33 | 33 | 40 | 31 | 12 | 27,379 | 271 | 30,802 | Super | 0.4 |
| 8 | 41.7 | 46 | 48 | 45 | 36 | 18 | 55,526 | 785 | 65,783 | Ultra | 0.6 |
| 12 | 48.3 | 50 | 56 | 50 | 41 | 22 | 85,117 | 275 | 89,216 | Ultra | 0.8 |
| 26 | 50.0 | 50 | 67 | 50 | 49 | 35 | 184,017 | 3,796 | 121,317 | Master | 1.6 |
| 39 | 59.1 | 60 | 76 | 60 | 53 | 45 | 276,041 | 2,559 | 158,142 | Master | 2.6 |
| 52 | 59.8 | 60 | 82 | 60 | 55 | 50 | 366,021 | 1,118 | 166,598 | Master | 3.4 |
| 78 | 60.0 | 60 | 91 | 60 | 56 | 50 | 533,721 | 23,614 | 173,813 | Master | 5.3 |
| 104 | 60.0 | 60 | 100 | 60 | 56 | 50 | 702,675 | 17,978 | 177,115 | Master | 6.3 |

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 20 (sem. 3) | día 20 (sem. 3) |
| nivel 36 (real) | día 32 (sem. 5) | día 32 (sem. 5) |
| nivel 40 (real) | día 42 (sem. 6) | día 42 (sem. 6) |
| nivel 50 (real) | día 52 (sem. 8) | día 52 (sem. 8) |
| nivel 60 (real) | día 191 (sem. 28) | día 112 (sem. 16) |
| 25 especies | día 18 (sem. 3) |  |
| 36 especies | día 57 (sem. 9) |  |
| 50 especies | día 191 (sem. 28) |  |
| 56 especies | día 548 (sem. 79) · 80% |  |
| 1 legendario | día 74 (sem. 11) | – |
| 3 legendarios | día 402 (sem. 58) · 70% | – |
| 5 legendarios | no (50% lo logra) | – |

## maratonista

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 42.1 | 50 | 55 | 40 | 35 | 18 | 51,375 | 2,460 | 84,826 | Ultra | 1.1 |
| 8 | 49.2 | 50 | 63 | 50 | 43 | 26 | 104,188 | 4,391 | 180,610 | Master | 1.5 |
| 12 | 50.0 | 50 | 68 | 50 | 47 | 33 | 158,813 | 12,487 | 213,491 | Master | 1.8 |
| 26 | 59.2 | 60 | 80 | 60 | 55 | 50 | 342,040 | 17,302 | 336,000 | Master | 2.5 |
| 39 | 60.0 | 60 | 85 | 60 | 56 | 50 | 500,753 | 98,811 | 354,455 | Master | 3.3 |
| 52 | 60.0 | 60 | 88 | 60 | 56 | 50 | 661,040 | 171,595 | 360,804 | Master | 3.7 |
| 78 | 60.0 | 60 | 100 | 60 | 56 | 50 | 981,678 | 410,322 | 387,013 | Master | 4.4 |
| 104 | 60.0 | 60 | 100 | 60 | 56 | 50 | 1,303,090 | 654,963 | 399,087 | Master | 5.3 |

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 10 (sem. 2) | día 10 (sem. 2) |
| nivel 36 (real) | día 14 (sem. 2) | día 14 (sem. 2) |
| nivel 40 (real) | día 14 (sem. 2) | día 14 (sem. 2) |
| nivel 50 (real) | día 14 (sem. 2) | día 14 (sem. 2) |
| nivel 60 (real) | día 106 (sem. 16) | día 46 (sem. 7) |
| 25 especies | día 9 (sem. 2) |  |
| 36 especies | día 33 (sem. 5) |  |
| 50 especies | día 106 (sem. 16) |  |
| 56 especies | día 211 (sem. 31) |  |
| 1 legendario | día 23 (sem. 4) | – |
| 3 legendarios | día 145 (sem. 21) | – |
| 5 legendarios | día 481 (sem. 69) · 60% | – |

## noctámbulo

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 37.9 | 44 | 45 | 40 | 32 | 15 | 39,679 | 654 | 60,787 | Ultra | 0.5 |
| 8 | 48.5 | 50 | 57 | 50 | 39 | 22 | 79,188 | 600 | 121,995 | Master | 1.1 |
| 12 | 49.2 | 50 | 61 | 50 | 43 | 28 | 121,063 | 712 | 157,005 | Master | 1.6 |
| 26 | 58.9 | 60 | 77 | 60 | 53 | 45 | 263,609 | 530 | 248,502 | Master | 3.2 |
| 39 | 60.0 | 60 | 86 | 60 | 55 | 50 | 389,292 | 1,984 | 273,825 | Master | 4.5 |
| 52 | 60.0 | 60 | 90 | 60 | 55 | 50 | 511,567 | 7,675 | 289,496 | Master | 4.8 |
| 78 | 60.0 | 60 | 100 | 60 | 56 | 50 | 754,949 | 13,552 | 300,762 | Master | 5.8 |
| 104 | 60.0 | 60 | 100 | 60 | 56 | 50 | 1,000,224 | 177,285 | 302,932 | Master | 7.4 |

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 14 (sem. 2) | día 14 (sem. 2) |
| nivel 36 (real) | día 23 (sem. 4) | día 23 (sem. 4) |
| nivel 40 (real) | día 26 (sem. 4) | día 26 (sem. 4) |
| nivel 50 (real) | día 28 (sem. 4) | día 28 (sem. 4) |
| nivel 60 (real) | día 124 (sem. 18) | día 69 (sem. 10) |
| 25 especies | día 12 (sem. 2) |  |
| 36 especies | día 43 (sem. 7) |  |
| 50 especies | día 124 (sem. 18) |  |
| 56 especies | día 387 (sem. 56) |  |
| 1 legendario | día 36 (sem. 6) | – |
| 3 legendarios | día 126 (sem. 18) | – |
| 5 legendarios | día 364 (sem. 52) · 90% | – |

## irregular

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 20.2 | 22 | 22 | 30 | 21 | 7 | 7,898 | 321 | 5,038 | Base | 0.0 |
| 8 | 27.2 | 29 | 29 | 40 | 26 | 10 | 17,141 | 383 | 9,887 | Super | 0.3 |
| 12 | 31.9 | 34 | 34 | 40 | 31 | 12 | 26,338 | 330 | 13,912 | Super | 0.3 |
| 26 | 40.8 | 45 | 49 | 45 | 36 | 18 | 57,413 | 383 | 22,396 | Super | 0.5 |
| 39 | 48.8 | 50 | 56 | 50 | 40 | 22 | 87,590 | 475 | 31,005 | Super | 0.7 |
| 52 | 50.0 | 50 | 60 | 50 | 43 | 26 | 117,053 | 348 | 34,724 | Super | 1.2 |
| 78 | 50.0 | 50 | 68 | 50 | 49 | 33 | 172,299 | 301 | 37,108 | Super | 1.8 |
| 104 | 59.8 | 60 | 74 | 60 | 51 | 40 | 231,087 | 2,425 | 42,218 | Super | 2.5 |

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 62 (sem. 9) | día 62 (sem. 9) |
| nivel 36 (real) | día 97 (sem. 14) | día 97 (sem. 14) |
| nivel 40 (real) | día 117 (sem. 17) | día 117 (sem. 17) |
| nivel 50 (real) | día 146 (sem. 21) | día 146 (sem. 21) |
| nivel 60 (real) | día 623 (sem. 89) · 90% | día 365 (sem. 53) |
| 25 especies | día 51 (sem. 8) |  |
| 36 especies | día 174 (sem. 25) |  |
| 50 especies | día 621 (sem. 89) · 90% |  |
| 56 especies | no |  |
| 1 legendario | día 338 (sem. 49) | – |
| 3 legendarios | no (40% lo logra) | – |
| 5 legendarios | no (10% lo logra) | – |

## casual real

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 13.3 | 15 | 15 | 30 | 16 | 5 | 2,523 | 342 | 916 | Base | 0.0 |
| 8 | 16.3 | 18 | 18 | 30 | 19 | 6 | 4,763 | 500 | 1,571 | Base | 0.0 |
| 12 | 19.8 | 21 | 21 | 30 | 21 | 7 | 7,244 | 1,241 | 2,278 | Base | 0.0 |
| 26 | 26.8 | 28 | 28 | 30 | 24 | 10 | 14,972 | 572 | 3,332 | Base | 0.1 |
| 39 | 30.8 | 33 | 33 | 40 | 28 | 12 | 22,250 | 392 | 4,569 | Base | 0.2 |
| 52 | 34.1 | 36 | 36 | 40 | 31 | 13 | 30,031 | 323 | 5,232 | Base | 0.4 |
| 78 | 40.0 | 40 | 42 | 40 | 35 | 16 | 46,698 | 486 | 7,452 | Super | 0.5 |
| 104 | 44.8 | 50 | 52 | 50 | 36 | 19 | 62,604 | 346 | 7,317 | Super | 0.8 |

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 211 (sem. 31) | día 211 (sem. 31) |
| nivel 36 (real) | día 345 (sem. 50) | día 345 (sem. 50) |
| nivel 40 (real) | día 463 (sem. 67) | día 463 (sem. 67) |
| nivel 50 (real) | día 611 (sem. 88) · 70% | día 611 (sem. 88) · 70% |
| nivel 60 (real) | no | no |
| 25 especies | día 190 (sem. 28) |  |
| 36 especies | día 708 (sem. 102) · 60% |  |
| 50 especies | no |  |
| 56 especies | no |  |
| 1 legendario | día 675 (sem. 97) · 60% | – |
| 3 legendarios | no (10% lo logra) | – |
| 5 legendarios | no | – |

## exámenes

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 25.8 | 28 | 28 | 30 | 23 | 9 | 14,377 | 280 | 10,194 | Super | 0.0 |
| 8 | 31.2 | 32 | 32 | 40 | 30 | 11 | 23,227 | 248 | 15,130 | Super | 0.0 |
| 12 | 34.7 | 36 | 36 | 40 | 33 | 14 | 33,899 | 322 | 16,225 | Super | 0.1 |
| 26 | 45.8 | 50 | 55 | 50 | 37 | 20 | 70,620 | 333 | 29,520 | Super | 0.7 |
| 39 | 50.0 | 50 | 59 | 50 | 42 | 25 | 102,397 | 291 | 36,947 | Super | 1.2 |
| 52 | 50.0 | 50 | 64 | 50 | 44 | 28 | 132,225 | 333 | 38,813 | Super | 1.8 |
| 78 | 58.2 | 60 | 70 | 60 | 51 | 37 | 199,708 | 1,388 | 51,226 | Super | 2.8 |
| 104 | 59.8 | 60 | 77 | 60 | 53 | 43 | 265,945 | 10,669 | 60,345 | Ultra | 3.5 |

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 46 (sem. 7) | día 46 (sem. 7) |
| nivel 36 (real) | día 79 (sem. 12) | día 79 (sem. 12) |
| nivel 40 (real) | día 95 (sem. 14) | día 95 (sem. 14) |
| nivel 50 (real) | día 110 (sem. 16) | día 110 (sem. 16) |
| nivel 60 (real) | día 485 (sem. 70) · 90% | día 284 (sem. 41) |
| 25 especies | día 47 (sem. 7) |  |
| 36 especies | día 173 (sem. 25) |  |
| 50 especies | día 484 (sem. 70) · 90% |  |
| 56 especies | no |  |
| 1 legendario | día 221 (sem. 32) | – |
| 3 legendarios | día 535 (sem. 77) · 80% | – |
| 5 legendarios | no (10% lo logra) | – |

## abandono

| Sem. | Nivel medio equipo | Nivel máx. | Nivel EXP máx. | Tope Pokédex | Especies | Entrenador | Polvo acum. | Polvo sin gastar | Pts/sem | Liga | Legend. (media) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 4 | 25.8 | 27 | 27 | 30 | 24 | 9 | 15,099 | 265 | 12,321 | Super | 0.0 |
| 8 | 28.6 | 30 | 30 | 40 | 26 | 10 | 19,802 | 249 | 5,516 | Base | 0.1 |
| 12 | 28.8 | 30 | 30 | 40 | 26 | 10 | 19,802 | 249 | 255 | Base | 0.1 |
| 26 | 28.8 | 30 | 30 | 40 | 26 | 10 | 19,802 | 249 | 0 | Base | 0.1 |
| 39 | 28.8 | 30 | 30 | 40 | 26 | 10 | 19,802 | 249 | 0 | Base | 0.1 |
| 52 | 28.8 | 30 | 30 | 40 | 26 | 10 | 19,802 | 249 | 0 | Base | 0.1 |
| 78 | 28.8 | 30 | 30 | 40 | 26 | 10 | 19,802 | 249 | 0 | Base | 0.1 |
| 104 | 28.8 | 30 | 30 | 40 | 26 | 10 | 19,802 | 249 | 0 | Base | 0.1 |

Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):

| Hito | Cuándo | Por EXP sin tope |
|---|---:|---:|
| nivel 30 (real) | día 55 (sem. 8) · 60% | día 55 (sem. 8) · 60% |
| nivel 36 (real) | no (10% lo logra) | no (10% lo logra) |
| nivel 40 (real) | no (10% lo logra) | no (10% lo logra) |
| nivel 50 (real) | no (10% lo logra) | no (10% lo logra) |
| nivel 60 (real) | no | no |
| 25 especies | día 40 (sem. 6) · 80% |  |
| 36 especies | no |  |
| 50 especies | no |  |
| 56 especies | no |  |
| 1 legendario | no (10% lo logra) | – |
| 3 legendarios | no | – |
| 5 legendarios | no | – |

## Hallazgos (calculados de esta ejecución)

- **casual**: Pokédex completa (56) no; nivel 60 no (20% lo logra); a la semana 104 lleva 47 especies, nivel máx. 50 (por EXP 63), Polvo acumulado 156,536 de los que sobran 310 (0%).
- **constante**: Pokédex completa (56) día 548 (sem. 79) · 80%; nivel 60 día 191 (sem. 28); a la semana 104 lleva 56 especies, nivel máx. 60 (por EXP 100), Polvo acumulado 702,675 de los que sobran 17,978 (3%).
- **maratonista**: Pokédex completa (56) día 211 (sem. 31); nivel 60 día 106 (sem. 16); a la semana 104 lleva 56 especies, nivel máx. 60 (por EXP 100), Polvo acumulado 1,303,090 de los que sobran 654,963 (50%).
- **noctámbulo**: Pokédex completa (56) día 387 (sem. 56); nivel 60 día 124 (sem. 18); a la semana 104 lleva 56 especies, nivel máx. 60 (por EXP 100), Polvo acumulado 1,000,224 de los que sobran 177,285 (18%).
- **irregular**: Pokédex completa (56) no; nivel 60 día 623 (sem. 89) · 90%; a la semana 104 lleva 51 especies, nivel máx. 60 (por EXP 74), Polvo acumulado 231,087 de los que sobran 2,425 (1%).
- **casual real**: Pokédex completa (56) no; nivel 60 no; a la semana 104 lleva 36 especies, nivel máx. 50 (por EXP 52), Polvo acumulado 62,604 de los que sobran 346 (1%).
- **exámenes**: Pokédex completa (56) no; nivel 60 día 485 (sem. 70) · 90%; a la semana 104 lleva 53 especies, nivel máx. 60 (por EXP 77), Polvo acumulado 265,945 de los que sobran 10,669 (4%).
- **abandono**: Pokédex completa (56) no; nivel 60 no; a la semana 104 lleva 26 especies, nivel máx. 30 (por EXP 30), Polvo acumulado 19,802 de los que sobran 249 (1%).
## Lectura de la línea base (manual; configuración actual, 104 semanas, 10 semillas)

- **La Pokédex de 56 especies se agota** (mediana) hacia la semana 31 el maratonista, la 56 el noctámbulo, la 79 el constante (80 % lo logra). Irregular, exámenes, casual, casual real y abandono **no la completan en 2 años** (51, 53, 47, 36 y 26 especies a la semana 104). Las 5 legendarias cuestan más: el 5.º legendario llega a la semana 52 (noctámbulo, 90 %), la 69 (maratonista, 60 %) y casi nunca al resto. Con 151 especies (paso 9) el problema cambia de escala: los topes de Pokédex proporcionales y el contenido nuevo importan más que la curva.
- **Topes de nivel.** El nivel real lo manda el tope de Pokédex, no la EXP: a 104 semanas el nivel por EXP es 100 (máximo) para constante/maratonista/noctámbulo, 74-77 para irregular/exámenes, 63 para casual, 52 para casual real. El constante llega al nv. 50 en la semana 8 y al 60 en la 28 (por EXP lo habría hecho en la 16); el maratonista toca el 50 en la semana 2 y el 60 en la 16; el noctámbulo 50 en la 4 y 60 en la 18; irregular tarda 21 sem. al 50 y 89 al 60; exámenes 16 y 70; casual 49 y solo 20 % llega al 60; **casual real llega al 30 en la semana 31, al 40 en la 67 y al 50 solo el 70 % en la 88**; el abandono se queda en nv. ~30 para siempre (26 especies, nivel máx. 30).
- **Tramo muerto de los jugadores intensos:** constante y maratonista pasan de nv. 50 a nv. 60 solo tras completar casi toda la Pokédex (50 especies), y desde ese punto su EXP es ya excedente (nivel por EXP 100 de 100). Para esos perfiles el 60 es techo duro desde la semana ~16-28.
- **Polvo.** No frena a nadie salvo en el techo: en los perfiles moderados el Polvo sin gastar queda en ~300 durante todo el horizonte (se gasta tan pronto como entra), así que el coste de caramelos no es el cuello de botella; el cuello de botella son los topes y el ritmo de sesiones. El Polvo **sobra** solo cuando el equipo ya está en el tope: maratonista 655 k sin gastar de 1,30 M acumulados (50 %), noctámbulo 177 k (18 %), constante 18 k (3 %). Aun así «Polvo acumulado» crece a 0,2-1,3 M en 2 años: no hay sumidero de Polvo a largo plazo.
- **Ligas semanales** (umbrales actuales Super 6.000, Ultra 60.000, Master 95.000): constante, maratonista y noctámbulo llegan a Master y se estancan allí (sin escalón superior); irregular y casual se quedan en Super; casual real tarda hasta la semana ~78 en promediar Super y exámenes solo roza Ultra a las 104 semanas; el abandono vuelve a Base. Master es un escalón que ~3 perfiles alcanzan en el mes 1-6, sin nada por encima para los siguientes 18 meses.
- **Limitaciones.** 10 semillas por perfil (medianas con alta varianza en hitos tardíos; «· X %» indica la proporción que llega). El jugador simulado optimiza siempre (equipo, caramelos, liberaciones) y reclama todo; los humanos reales irán por detrás. El grinder no está en esta ejecución (use `--profile all`).
