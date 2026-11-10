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

## 10. Reparto manual del daño (fichas), 2026-11-05

> Estudio del paquete A de `docs/session-depth-plan.md`, con la config del repositorio tras integrar A, B, C, D y F (estilo de estudio ×1.2, Hada proporcional). Órdenes: `npm run simulate:damage -- matrix --policy <P> --seeds 100` para cada política, `npm run simulate:damage -- replay --seeds 40 --reps 40` y `npm run simulate:damage -- report <json…>` (`scripts/simulate-damage.ts`). Unos 9 min con las 7 tareas en paralelo.

**Método.**

- **Partida completa:** cada política juega 6 perfiles × 100 semillas × 12 semanas, es decir, 600 jugadores por política y 3,600 en total. Los calendarios son los mismos para todas las políticas. A partir del primer reparto, el azar del motor diverge, así que la comparación es entre muestras grandes y no pareada.
- **Experimento de legendarios:** con la política `auto`, 40 semillas por perfil, se guarda el estado justo antes de las capturas de cada encuentro con legendario. Salen 1,648 encuentros con 1,671 legendarios nuevos. Cada encuentro se rejuega completo 40 veces con cada política, con las mismas semillas aleatorias en todas, así que la comparación sí es pareada. Para las políticas manuales, el encuentro se convierte al modo manual (`toManualWave`), con los mismos golpes tirados.
- **IC 95 %:**
  - en las tasas, intervalo de Wilson sobre los conteos agregados;
  - en las capturas, media ± 1.96·SE entre jugadores;
  - en el experimento, ± 1.96·SE entre encuentros.

**Políticas** (`scripts/sim/capture-policy.ts`):

| Política | Qué hace |
|---|---|
| `auto` | Preferencia "Auto": el reparto de hoy, ponderado por PS máx. Es la línea base calibrada. |
| `concentrate-valuable` | Todas las fichas al legendario, si no al shiny, si no a la especie nueva, si no al de nivel más alto. Es la versión ingenua. |
| `type-smart` | Cada ficha al salvaje al que más daño hace. |
| `concentrate-status` | Concentra en el más valioso que no se vaya a llevar ya la Ball de Estudio. Pone la mejor carga (Sueño primero) en ese mismo salvaje y guarda una carga por cada legendario o shiny de una oleada posterior. |
| `smart` | Jugador bueno y realista: `concentrate-status` solo si en la oleada hay un legendario, un shiny o una especie nueva; si no, "Auto". Las cargas se guardan igual que en `concentrate-status`. |
| `best-ev` | Techo de habilidad. Va ficha a ficha, de la mayor a la menor, y manda cada una al salvaje donde más sube el valor esperado capturado (valor × P(captura antes de que huya)). Las cargas, como `concentrate-status`. |

**Métricas nuevas del simulador** (`Tally`):

- salvajes de **nivel alto**: el cuarto superior del rango de nivel para el nivel de entrenador, sin contar legendarios; vistos y capturados;
- **evoluciones finales**: etapa ≥ 2 sin evolución pendiente; vistas y capturadas;
- **daño desperdiciado**: Σ daño ÷ PS por debajo del mínimo de vida, entre Σ daño ÷ PS;
- **lanzamientos a legendarios sin Ultra Ball**.

### 10.1 Resultados clave

| Perfil | Política | Leg. 1.er enc. (partida) | Leg. 1.er enc. (pareado) | Vida leg. al lanzar | Nv. alto capt. | Evo. final capt. | Capturas 12 sem. | Daño perdido |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| constante | auto | 44% | 46% | 42% | 65% | 63% | 980 | 15% |
| constante | concentrate-valuable | 50% | 54% | 17% | 55% | 48% | 792 (−19%) | 74% |
| constante | type-smart | 36% | 41% | 55% | 58% | 47% | 871 (−11%) | 65% |
| constante | concentrate-status | 45% | 54% | 17% | 54% | 48% | 766 (−22%) | 75% |
| constante | smart | 49% | 54% | 17% | 65% | 63% | 971 (−1%) | 17% |
| constante | best-ev | 49% | 52% | 22% | 70% | 69% | 1,038 (+6%) | 23% |
| maratonista | auto | 21% | 22% | 58% | 17% | 16% | 898 | 14% |
| maratonista | smart | 33% | 30% | 21% | 17% | 16% | 901 | 16% |
| maratonista | best-ev | 28% | 27% | 37% | 22% | 19% | 967 (+8%) | 21% |
| noctámbulo | auto | 36% | 39% | 50% | 33% | 34% | 904 | 16% |
| noctámbulo | smart | 50% | 48% | 22% | 33% | 33% | 911 | 17% |
| noctámbulo | best-ev | 50% | 46% | 31% | 41% | 40% | 1,024 (+13%) | 23% |
| grinder | auto | 11% | 11% | 65% | 13% | 16% | 2,553 | 17% |
| grinder | smart | 17% | 17% | 16% | 12% | 16% | 2,557 | 19% |
| grinder | best-ev | 15% | 14% | 48% | 15% | 19% | 2,734 (+7%) | 25% |
| todos (pareado) | auto → smart | | 19% → 26% | 61% → 19% | | | | |

Las tablas completas, con los seis perfiles, las seis políticas y los IC, están en 10.4.

### 10.2 Conclusiones frente a los criterios

1. **El jugador hábil gana ventaja, y es una ventaja acotada.**
   - **`smart`, el jugador bueno realista:**
     - +5 pp de legendario en el primer encuentro en el constante, +12 en el maratonista y +14 en el noctámbulo;
     - en el experimento pareado, de +2 a +9 pp según el perfil (+7 en total, de 19 % a 26 %);
     - casi el mismo número de capturas que en Auto.
   - **`best-ev`, el techo de habilidad:**
     - de +6 % a +13 % de capturas;
     - de +2 a +8 pp en la captura de salvajes de nivel alto y de +3 a +11 pp en la de evoluciones finales;
     - de +4 a +14 pp de legendario en los perfiles con muestra suficiente (constante, maratonista, noctámbulo y grinder).
   - **La Pokédex y el nivel de entrenador apenas cambian** (±0.5 especies a la semana 12, y el mismo nivel de entrenador). La habilidad da Pokémon mejores y más legendarios, no un ritmo de progresión distinto.
2. **El legendario sigue siendo difícil.**
   - Con las mejores políticas, la captura en el primer encuentro queda en **49–54 % en el constante** y en **≤ 50 % en todos los perfiles**.
   - El techo es estructural. Con R = 13 (los 5 legendarios tienen `capture_rate` 3), al 5 % de vida, con Ultra Ball (×2) y Sueño (×2.5), la probabilidad por lanzamiento es 0.967 · 13/255 · 2 · 2.5 = **24.6 %**, y con 3 lanzamientos queda en **57 %**. Con las dos habilidades de captura que existen (`ballMult` 1.1 y `nextThrowBonus` 1.15 del líder) el techo sube a **≈ 67 %**.
   - Además, ni concentrando todo el equipo el legendario baja del 5 %: queda en el **16–22 % de vida**, porque sale a nv. ≥ 50, tiene más Defensa y no hay *level sync* a su favor.
   - Ni con Sueño se acerca a "casi seguro".
3. **Los Pokémon de nivel alto y las evoluciones finales siguen siendo un reto.**
   - Concentrar todo **empeora** su captura en todos los perfiles (constante: de 65 % a 54–55 %), porque el resto de la oleada se queda con toda la vida.
   - Incluso `best-ev` solo sube de +2 a +8 pp. En el maratonista y el grinder siguen por debajo del 25 %.
4. **El coste de concentrar se nota.**
   - Concentrarlo todo siempre (`concentrate-valuable`/`-status`) cuesta **del −6 % al −22 % de capturas**, según el perfil (constante −19/−22 %, casual −19/−22 %, grinder −10 %).
   - El **74–81 % del daño se pierde** por debajo del mínimo de vida, frente al 15 % de Auto.
   - `type-smart` también pierde: −11 % de capturas y un 65 % de daño perdido. Mandar cada ficha a su mejor objetivo de tipo apila el daño en los mismos salvajes.
   - Solo compensa concentrar cuando hay algo que lo merece, que es lo que hace `smart`.

**Umbrales propuestos** (para vigilar en futuros cambios de config o de motor):

| Indicador | Umbral | Hoy |
|---|---|---|
| Legendario en el 1.er encuentro con la mejor política, perfil constante | 45–60 %. Por encima del 65 % deja de ser un reto. La línea base Auto es 44–46 %, y el GDD apunta a ≈ 40–55 % para Auto. | 49–54 % |
| Ventaja pareada de concentrar en el legendario (`smart` − `auto`) | ≤ +12 pp | de +2 a +9 pp |
| Techo teórico por encuentro (mejor Ball × mejor estado × mejores habilidades, al mínimo de vida) | < 80 % | ≈ 67 % |
| Captura de salvajes de nivel alto con `best-ev` | ≤ Auto + 10 pp | de +2 a +8 pp |
| Capturas totales con `best-ev` | ≤ Auto + 15 % | de +6 % a +13 % |
| Capturas al concentrarlo todo siempre | ≤ Auto − 10 % (el coste debe notarse) | del −6 % al −22 % |

**Veredicto:** los criterios se cumplen con la config actual. **No se cambia la config ni el motor.** La palanca de reserva prevista, una vida mínima mayor para legendarios (p. ej. `capture.legendaryMinHpFraction` 0.25), solo restaría ~3 pp en el constante, porque el legendario concentrado ya queda al 17–22 %. Hoy no hace falta.

### 10.3 Qué vigilar

- **Ultra Balls (problema conocido; no depende del reparto).**
  - El maratonista lanza **≈ 22 Ultra Balls y ≈ 23–30 lanzamientos a legendarios con otra Ball** en 12 semanas. El grinder, 25 frente a 80–130.
  - Por eso el maratonista se queda en el 21–33 % en el primer encuentro, frente al 44–54 % del constante.
  - Concentrar lo mejora un poco, porque gasta menos Balls por legendario, pero no lo resuelve.
  - Se arregla en la economía de misiones: más Ultra Balls para quien estudia muchas horas, o una Ultra Ball garantizada al aparecer un legendario. No en el daño.
- **El reparto Auto ya pone Sueño o Parálisis** en el 80–90 % de los lanzamientos a legendarios del constante, el noctámbulo y el grinder: el simulador ya apunta las cargas de estado a lo más valioso. Guardar cargas para un legendario de una oleada posterior solo sube los lanzamientos preparados de 79–91 % a 86–92 %, y en el casual y el irregular, con pocas cargas, no cambia nada.
- **Si se añaden fuentes de multiplicador de captura**, el techo de 10.2 sube. Cada una se multiplica con las demás: más `ballMult`, una Ball mejor que la Ultra, `extraFailedThrows` o un estado más fuerte que el Sueño. Con 4 lanzamientos y las habilidades actuales, el techo ya sería ≈ 77 %. En ese caso conviene revisar `legendaryMinCaptureRate` o añadir una vida mínima para legendarios.
- **La propuesta genérica del simulador** (`npm run simulate`, regenerada en `docs/balance-proposed-config.json` con la config actual) sugiere `legendaryChance` 0.00093 y bajar un poco los umbrales de liga: con la config integrada, el constante se cruza con 2.9–3.5 legendarios nuevos en 12 semanas (objetivo 1–3). Es independiente del reparto del daño y **no se aplica aquí**: queda para quien decida la frecuencia de legendarios.
- **Fuera del modelo:** los jugadores reales no hacen el cálculo de `best-ev`. Pero la interfaz (`estimateTokenDamage`, el aviso de "sobra daño") les da la información para acercarse a él, así que conviene tratar `best-ev` como un techo alcanzable.

### 10.4 Tablas completas

Las columnas de las tablas por perfil son estas:

- **1.er enc.:** legendarios nuevos capturados en su primera aparición, con IC de Wilson.
- **Al final:** contando las reapariciones.
- **Vida leg.:** vida media del legendario tras el reparto.
- **% prep.:** lanzamientos a legendarios dormidos o paralizados.
- **Nv. alto** y **Evo. final:** capturados ÷ vistos.
- **Pokédex:** especies capturadas al final de las semanas 4, 8 y 12.
- **Daño perdido:** fracción del daño por debajo del mínimo de vida.
- **Ultra lanz. / sin Ultra:** Ultra Balls lanzadas y lanzamientos a legendarios con otra Ball, por jugador.

**casual** (100 jugadores por política, 12 semanas; media ± IC 95 %)

| Política | Leg. nuevos | 1.er enc. | Al final | Vida leg. | % prep. | Nv. alto | Evo. final | Capturas | Pokédex s4/s8/s12 | Nv. entr. | Daño perdido | Ultra lanz. / sin Ultra |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| auto | 0.5 | 16% (9%–29%) | 22% | 76% | 33% | 68% (67%–69%) | 53% (45%–61%) | 194.8 ± 4.4 | 20.9 / 23.3 / 25.3 | 9.9 | 8% | 0.1 / 3.3 |
| concentrate-valuable | 0.5 | 8% (3%–19%) | 35% | 67% | 37% | 59% (58%–60%) | 51% (44%–57%) | 157.9 ± 3.4 | 20.8 / 23.4 / 25.6 | 9.9 | 59% | 0.1 / 3.9 |
| type-smart | 0.4 | 20% (10%–34%) | 34% | 84% | 39% | 68% (67%–69%) | 50% (42%–58%) | 188.8 ± 4.2 | 20.7 / 23.4 / 25.2 | 9.9 | 48% | 0.0 / 2.8 |
| concentrate-status | 0.5 | 10% (4%–21%) | 37% | 67% | 48% | 61% (60%–61%) | 46% (38%–53%) | 152.1 ± 3.3 | 20.8 / 23.4 / 25.3 | 9.9 | 61% | 0.1 / 5.1 |
| smart | 0.5 | 17% (9%–30%) | 32% | 67% | 48% | 69% (68%–70%) | 61% (53%–68%) | 195.1 ± 4.1 | 20.7 / 23.4 / 25.9 | 9.9 | 10% | 0.1 / 3.2 |
| best-ev | 0.5 | 13% (6%–26%) | 20% | 83% | 38% | 74% (73%–75%) | 56% (49%–63%) | 211.7 ± 4.3 | 20.8 / 23.4 / 25.7 | 9.9 | 15% | 0.1 / 3.2 |

**constant** (100 jugadores por política, 12 semanas; media ± IC 95 %)

| Política | Leg. nuevos | 1.er enc. | Al final | Vida leg. | % prep. | Nv. alto | Evo. final | Capturas | Pokédex s4/s8/s12 | Nv. entr. | Daño perdido | Ultra lanz. / sin Ultra |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| auto | 2.9 | 44% (38%–50%) | 65% | 47% | 83% | 65% (65%–65%) | 63% (62%–64%) | 980.4 ± 12.8 | 32.2 / 36.6 / 41.5 | 22.0 | 15% | 7.5 / 7.9 |
| concentrate-valuable | 2.6 | 50% (44%–56%) | 72% | 25% | 84% | 55% (54%–55%) | 48% (47%–49%) | 792.0 ± 12.4 | 32.2 / 36.4 / 41.3 | 22.1 | 74% | 7.3 / 6.1 |
| type-smart | 2.8 | 36% (30%–41%) | 56% | 60% | 83% | 58% (57%–58%) | 47% (45%–48%) | 870.9 ± 14.9 | 31.5 / 35.6 / 40.6 | 22.0 | 65% | 7.9 / 10.9 |
| concentrate-status | 2.8 | 45% (39%–51%) | 66% | 28% | 82% | 54% (54%–55%) | 48% (47%–49%) | 766.0 ± 13.0 | 32.2 / 36.4 / 41.2 | 22.1 | 75% | 7.6 / 7.3 |
| smart | 2.7 | 49% (43%–55%) | 67% | 28% | 80% | 65% (64%–65%) | 63% (62%–64%) | 971.4 ± 12.3 | 32.4 / 36.5 / 41.6 | 22.1 | 17% | 7.1 / 6.5 |
| best-ev | 2.7 | 49% (43%–55%) | 70% | 36% | 84% | 70% (70%–70%) | 69% (68%–70%) | 1038.1 ± 12.6 | 32.4 / 36.7 / 41.7 | 22.1 | 23% | 7.1 / 6.7 |

**marathoner** (100 jugadores por política, 12 semanas; media ± IC 95 %)

| Política | Leg. nuevos | 1.er enc. | Al final | Vida leg. | % prep. | Nv. alto | Evo. final | Capturas | Pokédex s4/s8/s12 | Nv. entr. | Daño perdido | Ultra lanz. / sin Ultra |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| auto | 9.1 | 21% (18%–24%) | 49% | 55% | 86% | 17% (17%–17%) | 16% (15%–16%) | 897.5 ± 4.5 | 35.3 / 42.4 / 47.3 | 33.1 | 14% | 21.6 / 29.7 |
| concentrate-valuable | 9.1 | 29% (26%–32%) | 58% | 21% | 85% | 16% (15%–16%) | 13% (12%–13%) | 839.5 ± 3.4 | 35.7 / 43.0 / 47.9 | 33.1 | 75% | 21.8 / 22.9 |
| type-smart | 8.6 | 16% (14%–18%) | 44% | 78% | 85% | 15% (15%–15%) | 12% (12%–12%) | 857.2 ± 4.5 | 34.7 / 41.4 / 46.3 | 33.1 | 66% | 21.8 / 32.9 |
| concentrate-status | 9.6 | 29% (26%–32%) | 60% | 22% | 93% | 18% (17%–18%) | 13% (12%–13%) | 847.5 ± 4.0 | 35.8 / 43.1 / 48.0 | 33.2 | 75% | 21.8 / 23.7 |
| smart | 9.2 | 33% (30%–36%) | 63% | 23% | 90% | 17% (17%–17%) | 16% (16%–16%) | 900.5 ± 4.5 | 36.0 / 43.1 / 48.3 | 33.1 | 16% | 21.5 / 22.7 |
| best-ev | 8.8 | 28% (25%–31%) | 56% | 42% | 90% | 22% (22%–22%) | 19% (19%–20%) | 967.3 ± 6.2 | 35.9 / 43.0 / 48.2 | 33.1 | 21% | 21.2 / 24.2 |

**night-owl** (100 jugadores por política, 12 semanas; media ± IC 95 %)

| Política | Leg. nuevos | 1.er enc. | Al final | Vida leg. | % prep. | Nv. alto | Evo. final | Capturas | Pokédex s4/s8/s12 | Nv. entr. | Daño perdido | Ultra lanz. / sin Ultra |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| auto | 5.4 | 36% (32%–40%) | 62% | 52% | 89% | 33% (33%–33%) | 34% (33%–35%) | 904.4 ± 6.6 | 33.6 / 40.2 / 42.8 | 28.0 | 16% | 18.1 / 13.1 |
| concentrate-valuable | 5.2 | 48% (44%–53%) | 75% | 25% | 84% | 29% (28%–29%) | 26% (25%–27%) | 790.7 ± 4.4 | 34.0 / 40.4 / 43.1 | 28.0 | 76% | 17.4 / 9.0 |
| type-smart | 5.0 | 33% (29%–37%) | 59% | 71% | 89% | 29% (29%–29%) | 24% (23%–24%) | 842.0 ± 6.7 | 32.7 / 38.9 / 41.8 | 28.0 | 67% | 17.9 / 15.3 |
| concentrate-status | 5.3 | 48% (44%–52%) | 74% | 22% | 89% | 31% (31%–32%) | 26% (26%–27%) | 800.3 ± 5.4 | 34.1 / 40.3 / 43.3 | 28.0 | 76% | 17.3 / 9.6 |
| smart | 5.2 | 50% (46%–54%) | 75% | 20% | 88% | 33% (33%–33%) | 33% (32%–34%) | 910.5 ± 6.2 | 33.7 / 40.4 / 43.5 | 28.0 | 17% | 17.2 / 7.7 |
| best-ev | 5.0 | 50% (45%–54%) | 74% | 33% | 91% | 41% (41%–41%) | 40% (40%–41%) | 1023.6 ± 8.0 | 34.0 / 40.6 / 43.4 | 28.0 | 23% | 16.8 / 8.5 |

**irregular** (100 jugadores por política, 12 semanas; media ± IC 95 %)

| Política | Leg. nuevos | 1.er enc. | Al final | Vida leg. | % prep. | Nv. alto | Evo. final | Capturas | Pokédex s4/s8/s12 | Nv. entr. | Daño perdido | Ultra lanz. / sin Ultra |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| auto | 0.7 | 23% (15%–34%) | 42% | 73% | 63% | 74% (73%–74%) | 65% (62%–69%) | 311.5 ± 9.3 | 21.5 / 25.3 / 29.9 | 12.0 | 8% | 0.8 / 4.3 |
| concentrate-valuable | 0.8 | 28% (19%–39%) | 44% | 63% | 59% | 65% (64%–66%) | 59% (56%–63%) | 257.5 ± 7.9 | 21.8 / 25.8 / 30.0 | 12.0 | 62% | 0.9 / 3.8 |
| type-smart | 0.7 | 23% (15%–35%) | 40% | 85% | 52% | 71% (70%–71%) | 54% (51%–58%) | 293.8 ± 8.8 | 21.7 / 25.5 / 29.3 | 11.9 | 51% | 0.7 / 3.3 |
| concentrate-status | 0.6 | 27% (17%–40%) | 44% | 56% | 67% | 64% (63%–65%) | 59% (56%–62%) | 244.4 ± 7.1 | 21.7 / 25.6 / 29.9 | 12.0 | 62% | 0.7 / 3.1 |
| smart | 0.7 | 21% (13%–32%) | 49% | 59% | 60% | 73% (72%–74%) | 69% (65%–72%) | 306.7 ± 9.3 | 21.7 / 25.5 / 30.0 | 12.0 | 10% | 0.7 / 3.9 |
| best-ev | 0.6 | 33% (22%–46%) | 55% | 73% | 76% | 79% (79%–80%) | 76% (73%–78%) | 333.7 ± 8.9 | 21.6 / 25.7 / 30.2 | 11.9 | 14% | 0.9 / 2.8 |

**grinder** (100 jugadores por política, 12 semanas; media ± IC 95 %)

| Política | Leg. nuevos | 1.er enc. | Al final | Vida leg. | % prep. | Nv. alto | Evo. final | Capturas | Pokédex s4/s8/s12 | Nv. entr. | Daño perdido | Ultra lanz. / sin Ultra |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| auto | 24.6 | 11% (10%–13%) | 34% | 62% | 88% | 13% (12%–13%) | 16% (16%–16%) | 2553.3 ± 11.1 | 48.4 / 54.2 / 55.1 | 50.0 | 17% | 24.9 / 103.3 |
| concentrate-valuable | 24.9 | 15% (14%–17%) | 45% | 15% | 85% | 10% (10%–10%) | 11% (11%–11%) | 2286.2 ± 8.3 | 48.9 / 54.7 / 55.5 | 50.0 | 81% | 25.0 / 84.6 |
| type-smart | 25.9 | 7% (6%–8%) | 25% | 96% | 86% | 9% (9%–9%) | 10% (10%–11%) | 2282.6 ± 9.2 | 46.9 / 53.5 / 54.6 | 50.0 | 75% | 25.0 / 128.8 |
| concentrate-status | 23.7 | 19% (17%–20%) | 47% | 15% | 87% | 11% (11%–11%) | 11% (11%–11%) | 2294.2 ± 11.2 | 48.8 / 54.7 / 55.5 | 50.0 | 81% | 24.9 / 78.5 |
| smart | 25.4 | 17% (15%–18%) | 47% | 15% | 87% | 12% (12%–13%) | 16% (16%–16%) | 2556.5 ± 11.4 | 49.1 / 54.9 / 55.6 | 50.0 | 19% | 25.0 / 85.7 |
| best-ev | 25.2 | 15% (13%–16%) | 39% | 49% | 87% | 15% (15%–15%) | 19% (18%–19%) | 2734.4 ± 11.9 | 48.6 / 54.5 / 55.3 | 50.0 | 25% | 25.0 / 95.2 |

**Experimento de legendarios** (1648 encuentros con legendario nuevo, 1671 legendarios, 40 repeticiones por encuentro y política, mismas semillas aleatorias en todas: comparación pareada)

| Política | Captura 1.er enc. | Vida leg. al lanzar | % lanz. preparados | Otros capturados / encuentro |
|---|---|---:|---:|---:|
| auto | 19% ± 1 pp | 61% | 82% | 2.9 |
| concentrate-valuable | 25% ± 1 pp | 19% | 80% | 2.7 |
| type-smart | 15% ± 1 pp | 88% | 82% | 2.7 |
| concentrate-status | 26% ± 1 pp | 19% | 87% | 2.6 |
| smart | 26% ± 1 pp | 19% | 87% | 2.8 |
| best-ev | 23% ± 1 pp | 42% | 87% | 3.0 |

casual: 15 encuentros

| Política | Captura 1.er enc. | Vida leg. al lanzar | % lanz. preparados | Otros capturados / encuentro |
|---|---|---:|---:|---:|
| auto | 14% ± 6 pp | 80% | 40% | 1.8 |
| concentrate-valuable | 16% ± 7 pp | 70% | 40% | 1.6 |
| type-smart | 11% ± 5 pp | 92% | 40% | 2.0 |
| concentrate-status | 16% ± 7 pp | 70% | 40% | 1.6 |
| smart | 16% ± 7 pp | 70% | 40% | 1.6 |
| best-ev | 12% ± 6 pp | 85% | 40% | 2.0 |

constant: 120 encuentros

| Política | Captura 1.er enc. | Vida leg. al lanzar | % lanz. preparados | Otros capturados / encuentro |
|---|---|---:|---:|---:|
| auto | 46% ± 3 pp | 42% | 91% | 1.9 |
| concentrate-valuable | 54% ± 3 pp | 17% | 91% | 1.6 |
| type-smart | 41% ± 3 pp | 55% | 92% | 1.8 |
| concentrate-status | 54% ± 3 pp | 17% | 91% | 1.6 |
| smart | 54% ± 3 pp | 17% | 91% | 1.6 |
| best-ev | 52% ± 3 pp | 22% | 91% | 1.9 |

marathoner: 350 encuentros

| Política | Captura 1.er enc. | Vida leg. al lanzar | % lanz. preparados | Otros capturados / encuentro |
|---|---|---:|---:|---:|
| auto | 22% ± 2 pp | 58% | 79% | 5.1 |
| concentrate-valuable | 27% ± 2 pp | 21% | 75% | 4.8 |
| type-smart | 18% ± 2 pp | 75% | 79% | 4.9 |
| concentrate-status | 29% ± 2 pp | 21% | 91% | 4.7 |
| smart | 30% ± 2 pp | 21% | 91% | 5.0 |
| best-ev | 27% ± 2 pp | 37% | 91% | 5.4 |

night-owl: 199 encuentros

| Política | Captura 1.er enc. | Vida leg. al lanzar | % lanz. preparados | Otros capturados / encuentro |
|---|---|---:|---:|---:|
| auto | 39% ± 3 pp | 50% | 89% | 3.2 |
| concentrate-valuable | 46% ± 3 pp | 22% | 87% | 2.8 |
| type-smart | 32% ± 3 pp | 71% | 89% | 3.1 |
| concentrate-status | 47% ± 3 pp | 22% | 92% | 2.8 |
| smart | 48% ± 3 pp | 22% | 92% | 3.1 |
| best-ev | 46% ± 3 pp | 31% | 92% | 3.5 |

irregular: 28 encuentros

| Política | Captura 1.er enc. | Vida leg. al lanzar | % lanz. preparados | Otros capturados / encuentro |
|---|---|---:|---:|---:|
| auto | 22% ± 4 pp | 75% | 60% | 1.9 |
| concentrate-valuable | 26% ± 5 pp | 58% | 59% | 1.7 |
| type-smart | 18% ± 3 pp | 86% | 60% | 2.0 |
| concentrate-status | 26% ± 5 pp | 58% | 59% | 1.7 |
| smart | 26% ± 5 pp | 58% | 59% | 1.7 |
| best-ev | 21% ± 4 pp | 77% | 60% | 2.0 |

grinder: 936 encuentros

| Política | Captura 1.er enc. | Vida leg. al lanzar | % lanz. preparados | Otros capturados / encuentro |
|---|---|---:|---:|---:|
| auto | 11% ± 1 pp | 65% | 80% | 2.2 |
| concentrate-valuable | 16% ± 1 pp | 16% | 79% | 2.0 |
| type-smart | 7% ± 1 pp | 100% | 80% | 2.0 |
| concentrate-status | 16% ± 1 pp | 16% | 86% | 2.0 |
| smart | 17% ± 1 pp | 16% | 86% | 2.1 |
| best-ev | 14% ± 1 pp | 48% | 86% | 2.3 |

## 11. Combate y Energía: Ball fallida al líder, ataques irreversibles, agotado en 4–6 sesiones, 2026-11-10

> Regla final (GDD §11.4): **una Ball fallida** hace que el salvaje contraataque **al líder** (o al siguiente con Energía). **Asignar** la ficha de daño de un Pokémon a un salvaje es un **ataque irreversible** y ese salvaje contraataca **a ese Pokémon** al momento; Auto y la primera Ball hacen atacar a quien falte. Si una técnica de estado ha funcionado (salvaje **dormido o paralizado**), no hay contraataque. Daño de los salvajes ×1.5 (`capture.counter.damageMult`). Coste de Energía por acción `0.5 + nivel/28` → **`0.4 + nivel/45`** (`energy.costBase`, `energy.costLevelDivisor`) para que un Pokémon que estudia todas las sesiones seguidas se agote en **~4–6 sesiones** (GDD §5.3).
>
> Órdenes: `npx tsx scripts/sim/exhaustion.ts [config.json]` (tabla de sesiones hasta agotarse) y `npm run simulate -- --no-propose --no-species` sobre tres motores: **v0.8.0** (`main`, contraataque al líder, sin ataques), **nuevo** (esta regla y este coste) y **nuevo con el coste anterior** (`{"energy":{"costBase":0.5,"costLevelDivisor":28}}`). 20 semillas × 12 semanas × 6 perfiles, mismos calendarios, política de daño `auto`.

**Sesiones de 25 min hasta agotarse, un Pokémon solo** (sin descansos, Caja ni pociones; cada sesión = acciones reales del motor + un contraataque de un salvaje de su nivel, eficacia neutra, ×1.5; todas las especies no legendarias, IVs 15, naturaleza neutra):

| Nivel | Coste anterior (0.5 + nv/28) | **Coste nuevo (0.4 + nv/45)** | Nuevo, sin contraataque | Gasto/sesión (nuevo) | Contraataque | Energía máx. | Poción / Superpoción (sesiones) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | 3.6 (3.4–4.0) | **4.3 (4.1–4.7)** | 8.6 | 3.7 | 3.8 | 33 | 2.7 / 6.7 |
| 20 | 3.7 (3.3–4.2) | **4.5 (4.1–5.1)** | 9.1 | 5.9 | 6.3 | 57 | 1.6 / 4.1 |
| 30 | 3.6 (3.0–4.2) | **4.5 (3.9–5.2)** | 8.6 | 9.6 | 8.6 | 81 | 1.1 / 2.8 |
| 50 | 3.3 (2.7–4.0) | **4.3 (3.6–5.1)** | 7.4 | 16.6 | 12.5 | 129 | 0.7 / 1.7 |

Mediana (p10–p90) sobre las especies. Con el coste anterior, sumar el contraataque de cada ataque dejaba al Pokémon en 3.3–3.7 sesiones (por debajo del objetivo, y peor a nivel alto). Con el nuevo, **4.3–4.5 sesiones en todos los niveles**: el coste sube más despacio con el nivel, así que el número ya no cae al subir. Un descanso completado devuelve ~0.4 sesiones.

**En partida (equipo completo, por perfil).** "Gasto" y "contraataque" = fracción de la Energía máxima por miembro y bloque de 25 min; "sesiones" = 1 ÷ (gasto + contraataque). "Sin respuesta" = ataques a un salvaje dormido o paralizado.

| Perfil | Ball/sesión | Ataques/sesión | Daño por ataque | Sin respuesta | Gasto/25 min | Contraataque/25 min | Sesiones hasta agotarse (coste anterior) | **Sesiones (nuevo)** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| casual | 1.05 | 4.85 | 4.5 | 14% | 13% | 7% | 3.9 | **4.9** |
| constante | 0.94 | 2.72 | 6.9 | 53% | 14% | 4% | 3.9 | **5.5** |
| maratonista | 2.13 | 15.63 | 8.2 | 17% | 14% | 5% | 4.1 | **5.3** |
| noctámbulo | 1.56 | 6.82 | 7.9 | 34% | 15% | 5% | 3.8 | **5.1** |
| irregular | 1.08 | 4.23 | 5.2 | 26% | 13% | 6% | 3.9 | **5.0** |
| grinder | 1.39 | 6.66 | 11.3 | 22% | 15% | 5% | 3.8 | **5.0** |

En partida sale algo más alto (4.9–5.5) que el Pokémon solo porque no todos los miembros atacan en cada oleada (los de pocas acciones a veces no tienen ficha) y parte de los ataques no tienen respuesta. Ambos quedan dentro de 4–6.

**Puntos semanales** (estado estable, semanas 4–12, mediana p50 y p10–p90):

| Perfil | v0.8.0 | Nuevo | Δ p50 | Nuevo con coste anterior | Δ p50 |
|---|---:|---:|---:|---:|---:|
| casual | 5.9k (4.2k–8.2k) | 6.0k (4.1k–8.5k) | +2% | 6.0k | +2% |
| constante | 73.4k (49.5k–100k) | 70.3k (48.9k–95.3k) | −4% | 70.5k | −4% |
| maratonista | 168k (112k–211k) | 176k (116k–230k) | +5% | 162k | −4% |
| noctámbulo | 124k (85.3k–159k) | 141k (93.5k–174k) | +14% | 109k | −12% |
| irregular | 9.9k (4.2k–18.2k) | 10.0k (4.1k–18.5k) | +1% | 10.3k | +4% |
| grinder | 744k (431k–846k) | 764k (450k–859k) | +3% | 702k | −6% |

**Ligas** (semanas estables que alcanzan Maestra): constante 14% → 11%, maratonista 96% → 98%, noctámbulo 83% → 88%; Super y Ultra sin cambios de más de 3 puntos.

**Agotados** (% de sesiones con algún miembro a 0): constante 1% → 2%, maratonista 41% → 42%, noctámbulo 35% → 25%, grinder 61% → 59%. Con el coste anterior: constante 9%, maratonista 29% pero con 3.67 contraataques que agotan por sesión (frente a 0.85).

Lectura:

- **Objetivo cumplido:** 4.3–4.5 sesiones (Pokémon solo) y 4.9–5.5 (en partida). El contraataque pesa casi lo mismo que el gasto de las acciones (≈ 5 % frente a ≈ 14 % de la Energía por bloque en partida; 3.8–12.5 frente a 3.7–16.6 en la tabla del Pokémon solo), así que dormir o paralizar antes de atacar se nota.
- **Puntos casi iguales para los perfiles normales** (casual, constante, irregular: −4 % a +2 %, dentro del ruido de 20 semillas). Los perfiles de muchas horas suben algo (+3 % a +14 %) porque el coste por acción a nivel alto baja ~30 % y rotan menos; el contraataque por ataque lo compensa solo en parte. Con el coste anterior perdían puntos (−4 % a −12 %) y se agotaban antes de la 4.ª sesión.
- **Riesgo:** el noctámbulo +14 % es el cambio mayor. La palanca es `energy.costBase`: con 0.45 el Pokémon solo baja a 4.2–4.4 sesiones (medido con `exhaustion.ts`; su efecto en los puntos no está simulado).
- Capturas y Pokédex no cambian de forma apreciable (tasas por rareza y especies por semana dentro de ±3 puntos/±1.5 especies, ruido de muestra): el contraataque no toca la probabilidad de captura salvo por Espejo Mágico, Cuerpo Maldito e Impasible.
