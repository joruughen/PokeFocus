# Informe de balance — PokeFocus (simulador F0)

> Generado el 2026-11-04 con `npm run simulate -- --no-propose` en 65 s. 20 semillas × 12 semanas × 6 perfiles · config del repositorio.
> Solo usa la API pública del motor, con semillas fijas: la misma orden da el mismo informe. Las políticas del jugador simulado están al principio de `scripts/simulate.ts`.

## Resumen

1. **Los umbrales de liga encajan con la escala de puntos.** El constante pasa de 16.5k puntos/semana (sem. 1) a 102k (sem. 12), ×6.2; con 6,000/60,000/95,000 es Maestra desde la semana 11 (en 23% de las semanas estables). Propuesta en 8.1.
2. **Nivelado:** el Pokémon de referencia (sin caramelos) llega a nv. 30 el día 21 (objetivo 21) y a nv. 50 el día 87 (objetivo ~91): con el Foco real (~0.9) la curva va en objetivo.
3. **Pokédex sin frenar:** el constante lleva 41 especies a la semana 12 (tope nv. 50); el tope 50 (36 especies) se abre el día 45; deja sin gastar el 1% del Polvo.
4. **La vida del salvaje no cuenta:** 100% de los salvajes quedan en el mínimo de 5 % (mediana daño ÷ PS = 35.2). La captura depende de la rareza, las cargas de estado (3.0 por sesión) y las Balls, no del daño.
5. **Legendarios:** el constante se cruza con 1.6 nuevos en 12 semanas (objetivo 1–3) y captura el 41% en el primer encuentro (objetivo ≈ 50 %; 69% al final, con las reapariciones; sin las Ultra/Super Balls modeladas: 43% en el primero); el maratonista se cruza con 6.6 por la ventaja de las oleadas largas.
6. **Energía:** el maratonista tiene algún agotado en 46% de sus sesiones (constante: 1%); rotación moderada, como se pretendía.
7. **Antitrampas:** el grinder (14 h/día) cobra 480 min pagados/día de 800 y saca 4.0× los puntos del maratonista (9.3× el constante): acotado (aviso a partir de 4.5×).
8. **Oleadas:** el tamaño medio es el mismo en todas las ligas (4.00–4.14); los topes 6/7/8 no se alcanzan nunca (8.3).
9. **Especies:** 1 de 56 fuera de banda (±40% de la mediana de su etapa), más 6 transitorias: Jolteon (alto +44%).
10. **Condiciones de tipo:** casi nunca activas: Hada; casi siempre: Roca.

## Cómo leer este informe

Perfiles (zona horaria fija UTC−5; la semana empieza en lunes; clima por día: lluvia 25 %, sol 30 %, frío 15 %, resto despejado):

- **casual**: 1–2 × 25 min en ~4 días laborales al azar, por la tarde
- **constante**: 4 × 25 min todos los días (mañana + tarde), con descansos
- **maratonista**: 2 × 100 min todos los días
- **noctámbulo**: 3 × 50 min cada noche, empezando entre las 21:00 y las 23:00
- **irregular**: ~50 % de los días, 1–4 × 25 min a hora aleatoria
- **grinder**: sonda antitrampas: 14 h/día de sesiones de 50 min seguidas

Supuestos del simulador (no vienen del motor): ~15 % de las sesiones con etiqueta chat/social/juego (Foco medio ≈ 0.9), 20 % de sesiones con una pausa, 5 % de reclamaciones tardías, micrófono activo en el 60 % de las sesiones, sin amigos (Hada nunca activa) y las misiones modeladas de la sección 3. Todo jugador empieza con un inicial al azar. "Semanas estables" = 4–12. Cada (perfil, semilla) repite siempre el mismo calendario, clima y etiquetas aunque cambie la config, así que las comparaciones antes/después son pareadas.

Fuera del modelo: Pociones y Revivir, caramelos de tipo, Tera, intercambios, amistad (Hada), Dominio elegido a mano (se usa la carga por defecto), misiones distintas de las Balls y piedras, y cualquier decisión estética del jugador. Los topes y umbrales propuestos dependen de que el jugador real capture con una eficiencia parecida a la simulada.

## 1. Puntos semanales y ligas

Mediana (p25–p75) de los Puntos de Equipo por semana, sobre 20 semillas por perfil:

| Sem. | casual | constante | maratonista | noctámbulo | irregular | grinder |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 2.0k (1.7k–2.3k) | 16.5k (15.7k–18.0k) | 35.1k (30.6k–40.4k) | 27.7k (27.1k–29.0k) | 3.1k (2.0k–4.4k) | 117k (112k–119k) |
| 2 | 2.8k (2.5k–3.3k) | 28.7k (26.6k–33.0k) | 71.1k (60.8k–83.3k) | 53.1k (51.0k–59.5k) | 6.3k (4.2k–7.6k) | 222k (211k–230k) |
| 3 | 3.4k (3.3k–3.9k) | 38.7k (35.8k–41.6k) | 102k (87.7k–112k) | 74.3k (70.6k–83.8k) | 5.9k (4.1k–9.2k) | 350k (333k–365k) |
| 4 | 4.9k (4.0k–5.7k) | 49.3k (46.1k–53.8k) | 122k (113k–130k) | 89.8k (84.1k–99.5k) | 6.3k (4.7k–8.8k) | 471k (452k–492k) |
| 5 | 5.3k (4.4k–5.8k) | 58.3k (54.4k–65.6k) | 140k (129k–162k) | 103k (97.5k–108k) | 7.3k (4.7k–8.6k) | 590k (549k–619k) |
| 6 | 5.9k (4.9k–6.6k) | 64.1k (62.7k–70.6k) | 161k (155k–172k) | 112k (108k–124k) | 9.6k (5.0k–12.4k) | 705k (637k–731k) |
| 7 | 6.5k (5.7k–7.5k) | 75.4k (67.4k–79.3k) | 171k (164k–180k) | 128k (123k–135k) | 10.9k (8.6k–12.7k) | 759k (715k–793k) |
| 8 | 7.1k (6.5k–7.8k) | 81.8k (74.5k–86.7k) | 189k (182k–199k) | 143k (128k–152k) | 11.1k (6.5k–15.1k) | 820k (775k–838k) |
| 9 | 7.5k (6.9k–8.5k) | 90.7k (82.1k–92.6k) | 201k (193k–212k) | 152k (144k–159k) | 11.6k (8.6k–18.1k) | 838k (807k–861k) |
| 10 | 7.4k (6.3k–9.0k) | 95.0k (90.6k–102k) | 211k (202k–221k) | 159k (146k–163k) | 13.0k (11.5k–16.6k) | 853k (816k–882k) |
| 11 | 8.3k (7.1k–9.7k) | 95.5k (92.2k–105k) | 222k (205k–234k) | 158k (149k–169k) | 13.9k (11.2k–19.8k) | 861k (842k–897k) |
| 12 | 8.1k (7.4k–9.0k) | 102k (99.0k–111k) | 240k (219k–251k) | 164k (162k–171k) | 16.7k (14.2k–22.4k) | 894k (822k–900k) |

Los puntos crecen a medida que el equipo sube de nivel y se llena la Pokédex, y se estancan al chocar con los topes de nivel. Estado estable (semanas 4–12, todas las semillas juntas):

| Perfil | Min/día | p10 | p25 | p50 | p75 | p90 |
|---|---:|---:|---:|---:|---:|---:|
| casual | 21 | 4.6k | 5.4k | 6.8k | 8.2k | 9.6k |
| constante | 100 | 52.6k | 64.1k | 81.3k | 94.4k | 106k |
| maratonista | 200 | 128k | 161k | 190k | 213k | 236k |
| noctámbulo | 150 | 96.9k | 113k | 136k | 157k | 167k |
| irregular | 32 | 4.7k | 7.1k | 11.0k | 15.1k | 21.0k |
| grinder | 800 | 503k | 660k | 789k | 854k | 896k |

**Umbrales actuales** (Super 6,000 / Ultra 60,000 / Maestra 95,000): porcentaje de semanas estables en que se alcanza cada liga (y día de la semana mediano):

| Perfil | Super | Ultra | Maestra |
|---|---:|---:|---:|
| casual | 67% (jue) | 0% | 0% |
| constante | 100% (lun) | 83% (vie) | 23% (dom) |
| maratonista | 100% (lun) | 100% (mié) | 99% (jue) |
| noctámbulo | 100% (lun) | 100% (jue) | 90% (vie) |
| irregular | 82% (jue) | 0% | 0% |
| grinder | 100% (lun) | 100% (lun) | 100% (lun) |

Regla usada para proponer: Super = percentil 35 semanal del casual (lo alcanza en ~65 % de las semanas, hacia el final); Ultra = percentil 15 del constante (lo alcanza en ~85 % de las semanas, hacia el viernes); Maestra = percentil 75 del constante (su cuartil superior; maratonistas y noctámbulos la superan sobrados).

**Antitrampas (rendimiento decreciente diario, GDD §3.3).** Semanas estables (4–12):

| Perfil | Min/día (sesiones) | Min "pagados"/día | Puntos/semana | Puntos por min pagado | × constante | × maratonista |
|---|---:|---:|---:|---:|---:|---:|
| constante | 100 | 100 | 80.1k | 114.4 | 1.0× | 0.4× |
| maratonista | 200 | 200 | 186k | 132.9 | 2.3× | 1.0× |
| grinder | 800 | 480 | 746k | 222.0 | 9.3× | 4.0× |

El tramo 360–600 min paga 50% y lo que pasa de 600 min no paga. El grinder estudia 800 min/día pero cobra 480 (60%); su ventaja sobre el maratonista (4.0× en puntos frente a 2.4× en minutos pagados) viene de rotar un banquillo grande y de subir de nivel con 2.5× el Polvo. Veredicto: acotado: gana menos que proporcional a sus minutos reales y la ventaja se explica por los minutos pagados y la rotación (límite de aviso: 4.5× el maratonista).

## 2. Nivelado frente al GDD §12.1

**Referencia** (el inicial solo, siempre en el equipo, sin caramelos, perfil constante, Foco real ≈ 0.90, 5 semillas, 16 semanas). La curva actual es `round(4·L^2.8)` con 29 EXP/min:

| Nivel | Objetivo GDD | Medido (mediana) | Veredicto |
|---|---:|---:|---:|
| nv. 10 | día 1 (≈ día 1) | día 1 | en objetivo |
| nv. 20 | — | día 7 |  |
| nv. 30 | día 21 (≈ 3 semanas) | día 21 | en objetivo |
| nv. 40 | — | día 47 |  |
| nv. 50 | día 91 (≈ 3 meses) | día 87 | en objetivo |

Nivel del inicial por EXP: día 1: nv. 10 · día 2: nv. 13 · día 7: nv. 20 · día 14: nv. 25 · día 21: nv. 30 · día 28: nv. 33 · día 56: nv. 42 · día 84: nv. 49 · día 112: nv. 54.

**Perfil constante con la política completa** (caramelos, capturas, evoluciones; mediana del equipo):

| Momento | Nivel por EXP | Nivel real | Tope | Especies | Entrenador |
|---|---:|---:|---:|---:|---:|
| día 7 | 20.0 | 20.0 | 30 | 21 | 7 |
| día 14 | 26.0 | 26.0 | 30 | 24 | 9 |
| día 21 | 30.0 | 30.0 | 40 | 29 | 11 |
| día 28 | 33.5 | 33.5 | 40 | 33 | 12 |
| día 42 | 38.8 | 38.8 | 40 | 35 | 15 |
| día 56 | 43.0 | 43.0 | 50 | 36 | 18 |
| día 70 | 47.0 | 46.8 | 50 | 38 | 20 |
| día 84 | 50.0 | 50.0 | 50 | 41 | 22 |

"Nivel por EXP" ignora el tope por Pokédex; si supera al "Nivel real" el equipo está topado y la EXP sobrante se guarda sin usarse (Polvo y caramelos también quedan parados).

Nivel real medio del equipo en otros perfiles:

| Perfil | día 28 | día 56 | día 84 | Tope (sem. 12) |
|---|---:|---:|---:|---:|
| casual | 18.5 | 24.3 | 28.0 | 40 |
| maratonista | 34.5 | 43.8 | 50.0 | 50 |
| noctámbulo | 38.0 | 48.5 | 50.0 | 50 |
| irregular | 21.5 | 27.8 | 32.8 | 40 |
| grinder | 50.0 | 60.0 | 60.0 | 60 |

Caramelos: 1 caramelo = 300 EXP a un coste de 25 + 3·nivel Polvo. Con el Polvo de una sesión de 25 min (≈ 225) y todo en un solo Pokémon a nv. 30 se obtienen ≈ 2.0 caramelos ≈ 587 EXP, frente a 653 EXP de la propia sesión (el GDD dice "como mucho duplican": se cumple solo si se concentra el Polvo).

## 3. Economía

El motor aún no tiene misiones. El simulador modela su aporte (supuesto): 1 Super Ball por día con ≥ 75 min (entrenador ≥ 5), 1 Ultra Ball por semana con ≥ 5 días activos y piedras al registrar 10/25/50 especies. Los totales son por jugador en 12 semanas (media de semillas).

**Balls.** "Estudio" = Balls de Estudio lanzadas por oleada; "Tasa" = capturas ÷ lanzamientos sin contar la Ball de Estudio (que siempre captura).

| Perfil | Poké (sesión) | Poké (conv.) | Poké lanzadas (% de las ganadas) | Super gan./lanz. | Ultra gan./lanz. | Estudio/oleada | Tasa | Capturas | Capt./día |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| casual | 144 | 0 | 142 (99%) | 0 / 0 | 0 / 0 | 100% | 79% | 184 | 2.2 |
| constante | 672 | 9 | 690 (101%) | 83 / 83 | 12 / 4 | 96% | 82% | 959 | 11.4 |
| maratonista | 336 | 87 | 440 (104%) | 83 / 83 | 12 / 11 | 85% | 52% | 853 | 10.2 |
| noctámbulo | 503 | 28 | 542 (102%) | 82 / 82 | 12 / 8 | 93% | 61% | 852 | 10.1 |
| irregular | 212 | 0 | 216 (102%) | 21 / 17 | 2 / 1 | 100% | 78% | 288 | 3.4 |
| grinder | 1,596 | 1,444 | 3,066 (101%) | 84 / 84 | 12 / 12 | 27% | 52% | 2,180 | 26.0 |

Sin misiones (solo las Poké Balls de sesión), el constante lanza 688 Poké Balls y captura 849 Pokémon (con misiones: 776 lanzamientos, 959 capturas).

**Polvo y caramelos.**

| Perfil | Polvo ganado | Polvo gastado | % gastado | Polvo final | Caram. captura | Caram. soltar | Caram. gastados | Caram. final | Soltados |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| casual | 15,929 | 15,371 | 96% | 558 | 551 | 127 | 225 | 453 | 120 |
| constante | 75,369 | 74,728 | 99% | 641 | 2,876 | 1,110 | 800 | 3,187 | 860 |
| maratonista | 150,595 | 148,651 | 99% | 1,945 | 2,559 | 1,004 | 1,301 | 2,263 | 741 |
| noctámbulo | 112,199 | 109,825 | 98% | 2,374 | 2,556 | 1,020 | 1,049 | 2,527 | 750 |
| irregular | 23,873 | 23,619 | 99% | 255 | 863 | 246 | 326 | 783 | 212 |
| grinder | 371,311 | 369,071 | 99% | 2,240 | 6,540 | 3,986 | 2,701 | 7,825 | 2,052 |

**Tasa de captura por rareza** (lanzamientos entre paréntesis; sin Ball de Estudio; común = capture_rate ≥ 150, medio 75–149, raro < 75):

| Perfil | Común | Medio | Raro | Legendario |
|---|---:|---:|---:|---:|
| casual | 87% (118) | 52% (15) | 24% (9) | 14% (1) |
| constante | 96% (490) | 83% (110) | 41% (168) | 14% (8) |
| maratonista | 81% (143) | 52% (169) | 36% (199) | 19% (22) |
| noctámbulo | 85% (238) | 57% (183) | 38% (197) | 18% (14) |
| irregular | 90% (167) | 71% (27) | 31% (37) | 13% (3) |
| grinder | 82% (735) | 54% (1,057) | 34% (1,300) | 13% (70) |

**Especies capturadas** (mediana al final de cada semana; Pack 1 tiene 56, de ellas 5 legendarias):

| Semana | casual | constante | maratonista | noctámbulo | irregular | grinder |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 13 | 21 | 23.5 | 22 | 14.5 | 32 |
| 2 | 17 | 24 | 31 | 28 | 19 | 41 |
| 3 | 19 | 29 | 34 | 33 | 20 | 46 |
| 4 | 20 | 33 | 36.5 | 35 | 21.5 | 49 |
| 6 | 21 | 35 | 41 | 37 | 23 | 52.5 |
| 8 | 23 | 36 | 43 | 40 | 24 | 54 |
| 10 | 24 | 38 | 43.5 | 42 | 29 | 55 |
| 12 | 25 | 41 | 48 | 42.5 | 31.5 | 55 |

**Pokédex frente a los topes de nivel** (topes: nv. 30 con 0, nv. 40 con 25, nv. 50 con 36, nv. 60 con 50 especies). "Topado" = fracción de días de las semanas estables en que el nivel mediano del equipo está en el tope; "Study conv." = oleadas cuya Ball de Estudio se convirtió en Poké Ball por falta de salvajes elegibles.

| Perfil | 25 especies | 36 especies | Topado | Study conv. |
|---|---:|---:|---:|---:|
| casual | día 82 (55%) | no (0% lo logra) | 0% | 0% |
| constante | día 18 | día 45 | 13% | 3% |
| maratonista | día 9 | día 27 | 10% | 13% |
| noctámbulo | día 12 | día 34 | 38% | 5% |
| irregular | día 59 | no (0% lo logra) | 0% | 0% |
| grinder | día 3 | día 10 | 58% | 72% |

Especies que menos de la mitad de las semillas constantes llegó a capturar en 12 semanas (32):

| Especie | % de semillas | Motivo |
|---|---:|---|
| Venusaur | 0% | poco frecuente (peso de captura 45) |
| Charizard | 0% | nivel salvaje mínimo 36 > máximo 32 (entrenador nv. 22) |
| Blastoise | 0% | nivel salvaje mínimo 36 > máximo 32 (entrenador nv. 22) |
| Pidgeot | 0% | nivel salvaje mínimo 36 > máximo 32 (entrenador nv. 22) |
| Machamp | 0% | nivel salvaje mínimo 43 > máximo 32 (entrenador nv. 22) |
| Golem | 0% | nivel salvaje mínimo 40 > máximo 32 (entrenador nv. 22) |
| Gengar | 0% | nivel salvaje mínimo 40 > máximo 32 (entrenador nv. 22) |
| Dragonite | 0% | nivel salvaje mínimo 55 > máximo 32 (entrenador nv. 22) |
| Crobat | 0% | nivel salvaje mínimo 37 > máximo 32 (entrenador nv. 22) |
| Piloswine | 0% | nivel salvaje mínimo 33 > máximo 32 (entrenador nv. 22) |
| Kadabra | 5% | poco frecuente (peso de captura 100) |
| Magneton | 5% | poco frecuente (peso de captura 60) |
| Haunter | 5% | poco frecuente (peso de captura 90) |
| Houndoom | 5% | poco frecuente (peso de captura 45) |
| Articuno | 15% | legendario |
| Mewtwo | 15% | legendario |
| Mew | 15% | legendario |
| Metapod | 20% | poco frecuente (peso de captura 120) |
| Butterfree | 20% | poco frecuente (peso de captura 45) |
| Machoke | 20% | poco frecuente (peso de captura 90) |
| Moltres | 20% | legendario |
| Zapdos | 25% | legendario |
| Ivysaur | 30% | poco frecuente (peso de captura 45) |
| Charmeleon | 30% | poco frecuente (peso de captura 45) |

…y 8 más.

## 4. Encuentros

**Tamaño de oleada por liga** (todas las sesiones recompensadas de todos los perfiles; "liga" = la que fija el máximo; base 4 ± 1, mín. 3):

| Liga | Máx. | Oleadas | Tamaño medio | % en el máximo | Mayor visto |
|---|---:|---:|---:|---:|---:|
| Base | 5 | 7,107 | 4.00 | 33% | 5 |
| Super | 6 | 21,057 | 4.06 | 3% | 6 |
| Ultra | 7 | 8,835 | 4.08 | 0% | 7 |
| Maestra | 8 | 37,095 | 4.14 | 0% | 7 |

| Perfil | Tamaño medio | Rango | Oleadas/día | Salvajes/sesión |
|---|---:|---:|---:|---:|
| casual | 3.91 | 3–5 | 0.9 | 4.2 |
| constante | 4.08 | 3–6 | 4.0 | 4.4 |
| maratonista | 4.06 | 3–7 | 8.0 | 17.0 |
| noctámbulo | 4.06 | 3–7 | 6.0 | 8.4 |
| irregular | 3.96 | 3–6 | 1.3 | 4.5 |
| grinder | 4.13 | 3–7 | 24.0 | 6.4 |

**Daño de la Energía a los salvajes** (perfil constante). "Daño ÷ PS" es la Energía de la oleada aplicada al salvaje antes del mínimo del 5 % de vida; ≥ 0.95 deja al salvaje en el mínimo:

| Semana | p10 | mediana | p90 | % en el mínimo (5 %) |
|---|---:|---:|---:|---:|
| 1 | 2.31 | 6.24 | 13.64 | 96% |
| 2 | 8.24 | 17.00 | 37.73 | 100% |
| 4 | 10.90 | 21.39 | 45.95 | 100% |
| 8 | 21.14 | 39.84 | 80.47 | 100% |
| 12 | 20.22 | 37.10 | 68.35 | 100% |

En las semanas estables 100% de los salvajes llegan al mínimo de vida; la mediana del daño es 35.2× sus PS. La barra de vida y el "preparar el daño" casi nunca importan.

**Legendarios y shinies** en 12 semanas (por jugador). "Nuevos" = legendarios que aparecen por primera vez; "Reapar." = reapariciones de uno que escapó (GDD §10.4: 35% por sesión durante 3 sesiones); "1.er enc." = % capturado en el primer encuentro; "Al final" = capturados ÷ nuevos, contando los reintentos; "% prep." = lanzamientos a legendarios con el salvaje dormido o paralizado; "P(≥1/≥2/≥4)" = fracción de jugadores que se cruza con al menos 1/2/4 nuevos.

| Perfil | Nuevos | Reapar. | Capturados | 1.er enc. | Al final | P(≥1 / ≥2 / ≥4) | % prep. | Shiny vistos | Shiny capt. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| casual | 0.2 | 0.3 | 0.2 | 25% | 75% | 20% / 0% / 0% | 0% | 1.2 | 1.2 |
| constante | 1.6 | 1.0 | 1.1 | 41% | 69% | 70% / 55% / 0% | 84% | 4.4 | 4.4 |
| maratonista | 6.6 | 4.5 | 4.1 | 41% | 63% | 100% / 100% / 95% | 81% | 8.6 | 7.1 |
| noctámbulo | 3.5 | 2.3 | 2.5 | 49% | 71% | 95% / 90% / 45% | 92% | 5.5 | 5.2 |
| irregular | 0.7 | 0.4 | 0.4 | 38% | 54% | 50% / 15% / 0% | 55% | 1.2 | 1.2 |
| grinder | 16.0 | 18.8 | 9.2 | 20% | 57% | 100% / 100% / 100% | 86% | 26.3 | 17.0 |
| constante sin misiones | 1.7 | 1.6 | 1.1 | 43% | 60% | 85% / 35% / 20% | 93% | 4.3 | 4.1 |

**Cargas de estado y de sustitución** (por sesión, Hipnosis/Onda Trueno… y Rugido/Remolino con la carga de técnicas por defecto):

| Perfil | Estado/sesión | Usadas | Sustituir/sesión | Usadas |
|---|---:|---:|---:|---:|
| casual | 0.8 | 94% | 0.3 | 100% |
| constante | 3.0 | 74% | 0.3 | 99% |
| maratonista | 3.7 | 78% | 0.7 | 100% |
| noctámbulo | 3.9 | 60% | 0.3 | 100% |
| irregular | 1.2 | 91% | 0.5 | 100% |
| grinder | 2.1 | 90% | 0.2 | 86% |

## 5. Energía

"Agotado" = un miembro despierto que llega a 0 de Energía durante la sesión. El equipo se elige cada vez con la política voraz (banquillo incluido), así que esto mide cuánto empuja cada perfil más allá de lo que rota.

| Perfil | Sesiones | % con algún agotado | Agotados/sesión | % miembros agotados | % equipo entero agotado | Energía final media | Dormidos (Descanso) |
|---|---:|---:|---:|---:|---:|---:|---:|
| casual | 1,435 | 0% | 0.00 | 0% | 0% | 78% | 0% |
| constante | 6,720 | 1% | 0.01 | 0% | 0% | 63% | 0% |
| maratonista | 3,360 | 46% | 0.66 | 11% | 0% | 22% | 0% |
| noctámbulo | 5,031 | 33% | 0.72 | 12% | 0% | 43% | 1% |
| irregular | 2,117 | 0% | 0.00 | 0% | 0% | 68% | 0% |
| grinder | 20,160 | 56% | 0.96 | 16% | 0% | 45% | 0% |

Sesiones con algún agotado según el orden dentro del día:

| Perfil | 1.ª | 2.ª | 3.ª | 4.ª o más |
|---|---:|---:|---:|---:|
| constante | 0% | 0% | 0% | 3% |
| maratonista | 19% | 72% | — | — |
| noctámbulo | 42% | 9% | 34% | 83% |

## 6. Valor de estudio de las especies

Un Pokémon solo, perfil constante (4 × 25 min/día con descansos, 5 semanas de días idénticos para todas las especies), IVs 15, naturaleza neutra, técnicas por nivel con la carga por defecto, habilidades promediadas según su probabilidad. Incluye condiciones de tipo, Vínculo 0 y la Energía diaria (se agota si no llega). "Pts/ses" = media de las 4 sesiones; "vs etapa" = diferencia con la mediana de su etapa (legendarios: con la mediana de los finales).

Medianas de referencia (pts/día):

| Grupo | nv. 30 | nv. 50 |
|---|---:|---:|
| Etapa 1 | 526 | 910 |
| Etapa 2 | 766 | 1,551 |
| Etapa 3 | 896 | 1,873 |
| Legendarios | 887 | 1,800 |

Finales (sin más evoluciones): mediana 887 / 1,800, percentil 25 = 742 / 1,431. Banda: ±40% de la mediana de su etapa; legendarios entre 1.0× y 1.6× la mediana de los finales. Marcas: **7** fuera de banda (6 son transitorias: evolucionan por nivel antes de nv. 30), 7 finales bajo el p25.

| Especie | Etapa | Rol | Pts/ses 30 | Pts/día 30 | vs etapa | Pts/ses 50 | Pts/día 50 | vs etapa | Marcas |
|---|---:|---|---:|---:|---:|---:|---:|---:|---|
| Moltres | leg. | scholar | 321 | 1,282 | +45% | 666 | 2,666 | +48% |  |
| Alakazam | 3 | scholar | 302 | 1,209 | +35% | 628 | 2,511 | +34% |  |
| Mewtwo | leg. | scholar | 292 | 1,167 | +32% | 612 | 2,448 | +36% |  |
| Zapdos | leg. | scholar | 282 | 1,128 | +27% | 645 | 2,578 | +43% |  |
| Jolteon | 2 | sprinter | 275 | 1,102 | +44% | 522 | 2,088 | +35% | alto +44% — nota: AtEsp 110 → 80 (simulador: +76% sobre la mediana de su etapa). Sigue siendo velocista: su valor viene del Ritmo. |
| Charizard | 3 | scholar | 267 | 1,067 | +19% | 524 | 2,097 | +12% |  |
| Houndoom | 2 | scholar | 265 | 1,061 | +38% | 509 | 2,036 | +31% |  |
| Gengar | 3 | scholar | 255 | 1,021 | +14% | 547 | 2,186 | +17% |  |
| Magneton | 2 | scholar | 255 | 1,018 | +33% | 472 | 1,888 | +22% |  |
| Kadabra | 2 | scholar | 254 | 1,014 | +32% | 534 | 2,136 | +38% |  |
| Espeon | 2 | scholar | 248 | 992 | +29% | 528 | 2,113 | +36% |  |
| Dragonite | 3 | allrounder | 248 | 991 | +11% | 572 | 2,286 | +22% |  |
| Haunter | 2 | scholar | 239 | 957 | +25% | 471 | 1,885 | +22% |  |
| Mew | leg. | allrounder | 238 | 953 | +7% | 472 | 1,890 | +5% |  |
| Crobat | 3 | sprinter | 235 | 939 | +5% | 468 | 1,873 | +0% |  |
| Articuno | leg. | technician | 233 | 933 | +5% | 555 | 2,220 | +23% |  |
| Abra | 1 | scholar | 233 | 930 | +77% | 447 | 1,789 | +97% | alto +97%; transitoria: evoluciona a nv. 16 — nota: PS 25 → 30: frágil pero jugable una sesión entera. |
| Venusaur | 3 | technician | 224 | 896 | +0% | 539 | 2,157 | +15% |  |
| Flareon | 2 | hunter | 224 | 895 | +17% | 406 | 1,625 | +5% |  |
| Vaporeon | 2 | marathoner | 220 | 880 | +15% | 402 | 1,609 | +4% |  |
| Raichu | 2 | sprinter | 217 | 870 | +14% | 450 | 1,798 | +16% |  |
| Dragonair | 2 | allrounder | 209 | 837 | +9% | 395 | 1,582 | +2% |  |
| Pidgeot | 3 | sprinter | 204 | 817 | -9% | 450 | 1,801 | -4% |  |
| Golem | 3 | guardian | 198 | 791 | -12% | 373 | 1,493 | -20% |  |
| Gastly | 1 | scholar | 197 | 787 | +49% | 391 | 1,564 | +72% | alto +72%; transitoria: evoluciona a nv. 25 |
| Houndour | 1 | scholar | 192 | 767 | +46% | 345 | 1,378 | +51% | alto +51%; transitoria: evoluciona a nv. 24 |
| Charmeleon | 2 | scholar | 192 | 767 | +0% | 380 | 1,521 | -2% |  |
| Golbat | 2 | sprinter | 191 | 765 | 0% | 358 | 1,433 | -8% |  |
| Butterfree | 3 | technician | 190 | 760 | -15% | 344 | 1,374 | -27% | final < p25 |
| Machamp | 3 | hunter | 184 | 736 | -18% | 364 | 1,458 | -22% | final < p25 |
| Blastoise | 3 | guardian | 179 | 717 | -20% | 356 | 1,422 | -24% | final < p25 |
| Ivysaur | 2 | technician | 173 | 694 | -9% | 421 | 1,686 | +9% |  |
| Magnemite | 1 | scholar | 170 | 681 | +29% | 310 | 1,241 | +36% |  |
| Piloswine | 2 | marathoner | 168 | 671 | -12% | 313 | 1,252 | -19% | final < p25 |
| Charmander | 1 | scholar | 166 | 665 | +26% | 293 | 1,171 | +29% |  |
| Sandslash | 2 | hunter | 164 | 656 | -14% | 294 | 1,174 | -24% | final < p25 |
| Dratini | 1 | allrounder | 159 | 635 | +21% | 299 | 1,196 | +31% |  |
| Pikachu | 1 | sprinter | 159 | 635 | +21% | 308 | 1,233 | +35% | se agota |
| Umbreon | 2 | guardian | 156 | 626 | -18% | 281 | 1,122 | -28% | final < p25 |
| Bulbasaur | 1 | technician | 155 | 621 | +18% | 337 | 1,349 | +48% | alto +48%; transitoria: evoluciona a nv. 16 |
| Pidgeotto | 2 | sprinter | 152 | 608 | -21% | 312 | 1,247 | -20% |  |
| Clefable | 2 | support | 151 | 603 | -21% | 308 | 1,234 | -20% | final < p25 |
| Machoke | 2 | hunter | 148 | 591 | -23% | 274 | 1,096 | -29% |  |
| Pidgey | 1 | sprinter | 139 | 558 | +6% | 229 | 916 | +1% |  |
| Wartortle | 2 | guardian | 136 | 546 | -29% | 303 | 1,213 | -22% |  |
| Graveler | 2 | guardian | 129 | 517 | -33% | 236 | 943 | -39% |  |
| Zubat | 1 | sprinter | 124 | 495 | -6% | 211 | 844 | -7% |  |
| Eevee | 1 | allrounder | 121 | 483 | -8% | 210 | 842 | -8% |  |
| Squirtle | 1 | guardian | 120 | 481 | -9% | 226 | 904 | -1% |  |
| Swinub | 1 | marathoner | 112 | 448 | -15% | 192 | 769 | -16% |  |
| Geodude | 1 | guardian | 109 | 435 | -17% | 172 | 689 | -24% |  |
| Clefairy | 1 | support | 102 | 409 | -22% | 186 | 744 | -18% |  |
| Sandshrew | 1 | hunter | 102 | 407 | -23% | 176 | 706 | -22% |  |
| Machop | 1 | hunter | 92 | 368 | -30% | 171 | 684 | -25% |  |
| Caterpie | 1 | allrounder | 83 | 331 | -37% | 135 | 540 | -41% | bajo -41%; transitoria: evoluciona a nv. 7 — nota: Débil a propósito: evoluciona a nivel 7. |
| Metapod | 2 | guardian | 78 | 311 | -59% | 133 | 532 | -66% | bajo -66%; transitoria: evoluciona a nv. 10 — nota: Sin técnicas de daño: genera Energía Normal al 50%. Evoluciona a nivel 10. |

Evoluciones que no mejoran al menos un 10 % a la forma anterior: Caterpie→Metapod nv. 30 (×0.94); Caterpie→Metapod nv. 50 (×0.99); Pidgey→Pidgeotto nv. 30 (×1.09); Abra→Kadabra nv. 30 (×1.09); Haunter→Gengar nv. 30 (×1.07).

## 7. Cobertura de las condiciones de tipo

Multiplicador medio de la condición (1.00 = inactiva) y % de sesiones recompensadas en que está activa, por perfil (el grinder no se cuenta; los supuestos de clima, pausas y micrófono están en la cabecera). "Activa" aquí es "multiplicador > 1": para Bicho y Veneno depende del equipo y de las sesiones previas del día.

| Tipo | Mult. medio | % activa | casual | constante | maratonista | noctámbulo | irregular | Condición | Marca |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| Normal | 1.10 | 100% | 100% | 100% | 100% | 100% | 100% | siempre activa (por diseño) |  |
| Fuego | 1.21 | 60% | 100% | 65% | 47% | 29% | 59% | sol/≥ 25 °C o 12–18 h | ≥ 90 % en casual |
| Agua | 1.12 | 24% | 24% | 25% | 24% | 23% | 24% | lluvia (25 % de los días en la simulación) |  |
| Eléctrico | 1.07 | 19% | 32% | 48% | 0% | 0% | 13% | sesión ≤ 25 min tras otra en ≤ 15 min |  |
| Planta | 1.10 | 30% | 0% | 50% | 74% | 0% | 25% | 05–12 h |  |
| Hielo | 1.08 | 15% | 15% | 15% | 15% | 16% | 15% | ≤ 12 °C o nieve (15 % de los días) |  |
| Lucha | 1.16 | 40% | 0% | 0% | 100% | 100% | 0% | sesión ≥ 50 min | ≥ 90 % en maratonista, noctámbulo |
| Veneno | 1.07 | 57% | 33% | 75% | 50% | 67% | 61% | +8 % por sesión previa del día |  |
| Tierra | 1.08 | 23% | 0% | 29% | 29% | 29% | 28% | sábado/domingo |  |
| Volador | 1.12 | 33% | 35% | 34% | 34% | 33% | 32% | música+ruido ≥ 30 % (micrófono en 60 % de las sesiones) |  |
| Psíquico | 1.17 | 50% | 71% | 34% | 56% | 42% | 47% | 1.ª sesión del día o silencio ≥ 70 % |  |
| Bicho | 1.01 | 14% | 14% | 17% | 6% | 12% | 18% | +7 % por Bicho en el equipo (activa solo con alguno) |  |
| Roca | 1.24 | 80% | 79% | 80% | 80% | 79% | 80% | sin pausas (20 % de las sesiones pausan) | casi siempre activa |
| Fantasma | 1.10 | 24% | 0% | 0% | 0% | 100% | 19% | 20–05 h | ≥ 90 % en noctámbulo |
| Dragón | 1.22 | 56% | 0% | 93% | 93% | 93% | 1% | racha ≥ 7 días | ≥ 90 % en constante, maratonista, noctámbulo |
| Siniestro | 1.05 | 10% | 23% | 0% | 0% | 0% | 26% | ≥ 2 días sin estudiar |  |
| Acero | 1.12 | 35% | 33% | 45% | 49% | 40% | 5% | inicio ±1 h del de ayer |  |
| Hada | 1.00 | 0% | 0% | 0% | 0% | 0% | 0% | amigo simultáneo (no hay amigos en el prototipo) | casi nunca activa |

## 8. Recomendaciones

### 8.1 Configuración

Sin cambios de configuración propuestos: todos los objetivos medidos están dentro de banda.

La configuración completa propuesta está en `docs/balance-proposed-config.json`. Para repetir la simulación con ella: `npm run simulate -- --config docs/balance-proposed-config.json` (y `--species docs/balance-proposed-species.json` para los parches de especies).

### 8.2 Especies (`data/overrides/species.json`)

| Especie | Cambio | Motivo |
|---|---|---|
| Jolteon | `baseStats.specialAttack` 80 → 66 | +44% frente a la mediana de etapa 2; Rendimiento (Atq. Esp.) 80→66 lo deja en +31% |

Parches para `data/overrides/species.json` (se fusionan con lo que ya hay; también en `docs/balance-proposed-species.json`):

```json
{
  "jolteon": {
    "baseStats": {
      "specialAttack": 66
    },
    "_note": "+44% frente a la mediana de etapa 2; Rendimiento (Atq. Esp.) 80→66 lo deja en +31%"
  }
}
```

### 8.3 Cambios de motor o de diseño (no se arreglan con un valor)

- **El máximo de salvajes por liga no tiene efecto.** El tamaño de la oleada es 4 ± 1 (+1 con Dulce Aroma, −1 con Foco bajo), así que solo roza el tope de Base (5); los topes 6/7/8 de Super/Ultra/Maestra nunca se alcanzan y el tamaño medio es el mismo en todas las ligas (4.10). El GDD §14 busca que "las oleadas crezcan a medida que estudias". Propuesta de motor: sumar al tamaño un bono por liga antes de aplicar el tope (`leagueWaveBonus: { base: 0, super: 1, ultra: 2, master: 3 }` ⇒ medias 4/5/6/7).
- **La vida del salvaje casi nunca importa.** 100% de los salvajes quedan en el mínimo del 5 % en las semanas estables (mediana daño ÷ PS = 35.2; en la semana 1 ya es 6.2). Cada salvaje recibe la Energía de toda la oleada de un equipo de 6, que crece con el cuadrado del nivel mientras los salvajes solo suben con el nivel de entrenador. Un único divisor no sirve (habría que dividir por ~35 al final, pero en la semana 1 dejaría a los salvajes sin tocar). Opciones de motor: repartir la Energía de la oleada entre sus salvajes (÷ ~4); normalizar por el nivel medio del equipo frente al del salvaje; o subir los niveles salvajes con el nivel real del equipo, no solo el de entrenador.
- **Sobran caramelos; el límite es el Polvo** (como quiere el GDD §12.3, pero con mucho margen). El constante gana 3,987 caramelos en 12 semanas (capturas 2,876 + soltar 1,110) y solo puede pagar 800 (20%); los caramelos aportan ≈ 15% de la EXP del equipo. Hoy capturar un duplicado casi no vale nada. Si se quiere que importe: bajar el coste en Polvo (`progression.candyDustBase` / `candyDustPerLevel`) o subir `progression.candyExp`; si se prefiere que el Polvo siga mandando, reducir `candiesOnCatch` es inocuo.
- **La Ball de Estudio se queda sin objetivos con el nivel de entrenador.** Solo vale para base ≤ nv. 20 y los salvajes suben (entrenador 20: 10–32). Se convierte en Poké Ball en 13% de las oleadas del maratonista, 72% de las oleadas del grinder. Alternativa: `encounters.studyBallMaxLevel` ligado al rango salvaje (p. ej. el nivel medio del rango).
- **Evoluciones por intercambio imposibles en el prototipo:** Kadabra→Alakazam, Machoke→Machamp, Graveler→Golem, Haunter→Gengar. Esos finales solo se consiguen salvajes (nivel salvaje mínimo = nivel de la etapa previa + 15). Dragonite (Dragonair nv. 55) queda sobre el tope de nivel 50: solo aparece como salvaje a nivel ≥ 55, fuera de todo rango.
- **Descanso puede dejar dormido a un Pokémon de la caja indefinidamente:** `asleepNextSession` solo se limpia si el Pokémon está en el equipo durante una sesión (`applySessionResult`). El simulador mete a las estrellas dormidas en el equipo para despertarlas; aun así, al final de 12 semanas quedan hasta 1.6 dormidos en la caja de un jugador (Descanso se activó hasta 32 veces por jugador). La UI debería limpiar el estado al sacarlo del equipo o al cambiar de día.
- **Hada (×1.4) está muerta sin amigos** (0 % de sesiones): se activa en F2; hasta entonces su multiplicador no cuenta para ninguna comparación.



## 9. Post-fix (motor: daño clásico, bono de oleada por liga, Ball de Estudio, Descanso, misiones)

> `npm run simulate -- --no-propose` (20 semillas × 12 semanas × 6 perfiles, 75 s) tras los cambios de motor; mismos calendarios que arriba, así que las cifras "antes" de las secciones 1–8 son pareadas. Para regenerar el informe completo con el motor nuevo basta repetir `npm run simulate`.

**Cambios.** (1) Cada acción golpea a **un** salvaje de la oleada de su bloque con la fórmula clásica `((2·L/5+2)·Potencia·A/D/50+2)·STAB·efectividad·captureDamageScale`, eligiendo objetivo con probabilidad ∝ PS máx. del salvaje; el atacante pelea como máximo al nivel del salvaje (*level sync*) y el daño por acción se escala por su intervalo (la Velocidad da puntos, no daño por minuto). Sin esas dos normalizaciones el daño ÷ PS crecía ×5–10 de la semana 1 a la 8 (el equipo sube a nv. 45–50 y los salvajes siguen en 5–22 por nivel de entrenador) y ninguna escala única cumplía los dos objetivos. (2) `encounters.leagueWaveBonus` suma 0/1/2/3 al tamaño de la oleada. (3) Ball de Estudio: nivel ≤ max(20, mínimo del rango salvaje + 10). (4) Descanso se despierta en el reinicio diario o tras una sesión completada fuera del equipo. (5) Misiones reales del motor (`data/overrides/custom-missions.json`); el simulador ya no las modela: reclama las del motor.

**Claves nuevas:** `capture.captureDamageScale` 0.065 · `capture.levelSync` {ratio 1, gap 0} · `capture.damageReferenceSpeed` 70 · `capture.hitTargeting` "maxHp" · `encounters.leagueWaveBonus` {0, 1, 2, 3} · `encounters.studyBallLevelMargin` 10.

**Vida restante del salvaje al aparecer** (perfil constante, mediana; antes: 96–100 % de los salvajes en el mínimo del 5 % y daño ÷ PS mediano 6.2 en la semana 1 y 35.2 en las estables):

| Semana | 1 | 2 | 4 | 8 | 12 | Estables (4–12) |
|---|---:|---:|---:|---:|---:|---:|
| Vida restante (mediana) | 72% | 61% | 46% | 30% | 30% | 34% |
| % en el mínimo (5 %) | 2% | 7% | 19% | 30% | 30% | 28% |

Objetivo: 45–65 % en la semana 1 y 25–45 % en las estables. Las estables cumplen; la semana 1 queda algo alta (72 %): es la semana del inicial solo y de técnicas de potencia 40. Subir la escala la baja pero empuja las estables hacia el 25 % y por debajo.

**Tamaño de oleada por liga** (todas las sesiones recompensadas):

| Liga | Máx. | Antes | Ahora | % en el máximo |
|---|---:|---:|---:|---:|
| Base | 5 | 4.00 | 3.99 | 33% |
| Super | 6 | 4.06 | 4.99 | 34% |
| Ultra | 7 | 4.08 | 6.00 | 35% |
| Maestra | 8 | 4.14 | 7.04 | 37% |

**Ball de Estudio convertida en Poké Ball** (oleadas sin salvaje elegible): constante 3% → 1%, maratonista 13% → 4%, noctámbulo 5% → 3%, grinder 72% → 15%. Estudio/oleada (Balls de Estudio lanzadas): constante 96% → 97%, maratonista 85% → 95%, grinder 27% → 84%.

**Legendarios, captura en el primer encuentro** (objetivo constante ≈ 40–55 %):

| Perfil | Antes (misiones modeladas) | Ahora (misiones del motor) | Al final, con reapariciones |
|---|---:|---:|---:|
| constante | 41% | **52%** | 73% |
| constante sin misiones | 43% | 25% | 50% |
| noctámbulo | 49% | 40% | 72% |
| maratonista | 41% | 21% | 45% |
| casual | 25% | 17% | 33% |

Ahora la vida del legendario sí cuenta (sale a nv. ≥ 50, sin *level sync* a su favor), así que sin preparar el daño y sin las Ultra/Super Balls de las misiones la captura cae a la mitad. El maratonista se cruza con 9 legendarios nuevos en 12 semanas y no le llegan las Ultra Balls (gana 23 y lanza 22) y su equipo llega más agotado a las oleadas tardías.

**Economía de Balls con misiones** (por jugador en 12 semanas; misiones reclamadas: casual 39, constante 236, maratonista 227):

| Perfil | Poké sesión | Poké conv. | Poké misiones | Super misiones / lanz. | Ultra misiones / lanz. | Polvo de misiones | Tasa (sin Estudio) | Capturas |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| casual | 144 | 0 | 48 | 13 / 9 | 1 / 0 | 2.1k | 58% (antes 79%) | 190 (184) |
| constante | 672 | 4 | 170 | 129 / 129 | 14 / 7 | 11.6k | 65% (antes 82%) | 974 (959) |
| maratonista | 336 | 24 | 124 | 111 / 111 | 23 / 22 | 11.8k | 41% (antes 52%) | 900 (853) |

Las misiones dan ≈ 25 % más Poké Balls, ≈ 1.5 Super Balls al día y ≈ 1 Ultra Ball por semana al constante, y ≈ 15 % más Polvo. La tasa de captura baja porque los salvajes ya no están siempre al 5 %; las Balls extra de las misiones compensan y el número de capturas queda igual (sin misiones el constante captura 707). Las Super Balls se gastan todas: siguen siendo el recurso escaso.

**Descanso:** 0.0 Pokémon dormidos en la caja al final (antes hasta 1.6).
