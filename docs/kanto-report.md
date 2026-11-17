# Kanto completo: informe de importación y curación (paso 9)

> Generado el 2026-11-16. Datos: `data/generated/` (PokeAPI), `data/overrides/` (curación) y `src/data/game/` (lo que usa la app). Valor de estudio calculado con `scripts/sim/species-value.ts` (perfil constante, 4 × 25 min al día, IV 15, naturaleza neutra, técnicas por defecto) sobre el motor del árbol de trabajo de ese día.

## Resumen

- **Especies:** 56 → **158** (+102). Están las 151 de Kanto y 7 de otras regiones que ya tenía el Pack 1 (Crobat, Espeon, Umbreon, Swinub, Piloswine, Houndour, Houndoom), que se conservan. No se añadió ninguna forma de otra generación.
- **Habilidades:** 51 → **115** (+64). Todas las habilidades de las 158 especies tienen efecto definido con primitivas que ya existían (`docs/effects.md`); no hizo falta código nuevo.
- **Técnicas especiales:** 40 → **81** (+41). Movimientos importados: 428 → 534; los de daño son técnicas de daño genéricas sin más trabajo.
- **Sprites:** descargados los 306 que faltaban (icono, animado y shiny de las 102 especies nuevas) en `public/sprites/`. No falta ninguno.
- **Topes de nivel por Pokédex:** 0→30, **70→40, 100→50, 140→60** (antes 25/36/50). Ver «Topes de nivel».
- **Curación:** las 102 especies nuevas tienen rol y nota; 2 especies del Pack 1 se retocaron (Jolteon y Moltres).
- **Resultado del simulador:** ninguna especie fuera de banda salvo 6 formas transitorias (ver «Fuera de banda»); ninguna etapa final por debajo de −20 % de la mediana de su grupo; toda etapa final supera a su forma base.

## Cómo se curó (GDD §20.1)

1. **Capa 1** (`statCurves`): sin cambios; las curvas globales ya comprimen los extremos.
2. **Capa 2** (`data/overrides/species.json`), por especie:
   - Rol: el de la forma final de la línea (por su stat más destacado), igual para toda la línea.
   - Extremos moderados a mano: Chansey (PS 250 → 170), Snorlax (PS 160 → 140), Wigglytuff y Jigglypuff (PS), Cloyster (Def 180 → 150), Onix (Def 160 → 140); mínimos jugables para Diglett y Dugtrio (PS); algo más de Ritmo para Snorlax, Lickitung, Parasect y Chansey, para no tener que darles un Rendimiento impropio.
   - Mínimo de Rendimiento por etapa, la regla del Pack 1: final ≥ 75, intermedia ≥ 55, base ≥ 35 (excepciones a propósito: Weedle, Kakuna y Magikarp, como Caterpie y Metapod; Aerodactyl se queda en 60 porque su valor viene del Ritmo).
   - Ajuste de Rendimiento (Atq. Esp.) con el simulador, en varias pasadas, hasta dejar cada especie dentro de ±30 % de la mediana de su grupo (la banda de aviso es ±40 %), las finales nunca por debajo de −20 % y cada evolución al menos un 10 % por encima de la etapa anterior. Los roles de los stats no cambian (§5.1): como en el Pack 1 con Machamp o Golem, los cazadores y guardianes reciben el Rendimiento mínimo para no quedar fuera del ranking.
3. **Capa 3** (simulador): tabla de abajo.

**Cambio en el análisis del simulador** (`scripts/sim/species-analysis.ts`): las especies de **una sola etapa** (Tauros, Lapras, Snorlax, Scyther… 20 en Kanto) se comparan ahora con las 2.as etapas. Antes no existía ninguna; comparadas con las formas base salían todas «altas». Objetivo de diseño: una especie de etapa única rinde como una 2.ª etapa.

**Tasas de captura:** se mantienen las de PokeAPI, que ya son coherentes con la rareza (comunes 190-255, intermedias 90-127, finales y etapa única 45-75, Chansey 30, Snorlax 25, legendarios 3; Mew sigue en 3 por el override del Pack 1). En ninguna línea una evolución es más fácil de capturar que su etapa anterior. Como el peso de aparición es la tasa de captura (§10.2), las especies raras también aparecen poco.

## Valor de estudio por especie

Puntos por día a nivel 30 y 50. Medianas: 1.ª etapa 453 / 843; 2.ª etapa y etapa única 681 / 1357; 3.ª etapa 801 / 1621; finales (referencia de los legendarios) 731 / 1466. «Desv.» = diferencia con la mediana de su grupo. «T» = transitoria (evoluciona por nivel antes del 30).

| N.º | Especie | Grupo | Rol | Pts/día nv. 30 | Desv. | Pts/día nv. 50 | Desv. | Notas |
|---:|---|---|---|---:|---:|---:|---:|---|
| 1 | Bulbasaur | 1.ª | Técnico | 558 | +23 % | 1016 | +20 % | T |
| 2 | Ivysaur | 2.ª / única | Técnico | 627 | -8 % | 1272 | -6 % |  |
| 3 | Venusaur | 3.ª | Técnico | 810 | +1 % | 1631 | +1 % | final |
| 4 | Charmander | 1.ª | Estudioso | 593 | +31 % | 1029 | +22 % | T |
| 5 | Charmeleon | 2.ª / única | Estudioso | 685 | +0 % | 1349 | -1 % |  |
| 6 | Charizard | 3.ª | Estudioso | 959 | +20 % | 1885 | +16 % | final |
| 7 | Squirtle | 1.ª | Guardián | 443 | -2 % | 840 | 0 % | T |
| 8 | Wartortle | 2.ª / única | Guardián | 504 | -26 % | 1121 | -17 % |  |
| 9 | Blastoise | 3.ª | Guardián | 662 | -17 % | 1320 | -19 % | final |
| 10 | Caterpie | 1.ª | Polivalente | 298 | -34 % | 488 | -42 % | T, **fuera de banda** |
| 11 | Metapod | 2.ª / única | Guardián | 279 | -59 % | 481 | -64 % | T, **fuera de banda** |
| 12 | Butterfree | 3.ª | Técnico | 681 | -15 % | 1233 | -24 % | final |
| 13 | Weedle | 1.ª | Cazador | 317 | -30 % | 520 | -38 % | T, nueva |
| 14 | Kakuna | 2.ª / única | Cazador | 298 | -56 % | 512 | -62 % | T, nueva, **fuera de banda** |
| 15 | Beedrill | 3.ª | Cazador | 683 | -15 % | 1493 | -8 % | nueva, final |
| 16 | Pidgey | 1.ª | Velocista | 496 | +9 % | 820 | -3 % | T |
| 17 | Pidgeotto | 2.ª / única | Velocista | 540 | -21 % | 1119 | -18 % |  |
| 18 | Pidgeot | 3.ª | Velocista | 728 | -9 % | 1621 | +0 % | final |
| 19 | Rattata | 1.ª | Velocista | 451 | 0 % | 869 | +3 % | T, nueva |
| 20 | Raticate | 2.ª / única | Velocista | 734 | +8 % | 1456 | +7 % | nueva, final |
| 21 | Spearow | 1.ª | Cazador | 552 | +22 % | 999 | +19 % | T, nueva |
| 22 | Fearow | 2.ª / única | Cazador | 768 | +13 % | 1829 | +35 % | nueva, final |
| 23 | Ekans | 1.ª | Cazador | 392 | -14 % | 677 | -20 % | T, nueva |
| 24 | Arbok | 2.ª / única | Cazador | 598 | -12 % | 1169 | -14 % | nueva, final |
| 25 | Pikachu | 1.ª | Velocista | 576 | +27 % | 1057 | +25 % |  |
| 26 | Raichu | 2.ª / única | Velocista | 788 | +16 % | 1635 | +20 % | final |
| 27 | Sandshrew | 1.ª | Cazador | 372 | -18 % | 678 | -20 % | T |
| 28 | Sandslash | 2.ª / única | Cazador | 597 | -12 % | 1160 | -14 % | final |
| 29 | Nidoran♀ | 1.ª | Guardián | 412 | -9 % | 713 | -15 % | T, nueva |
| 30 | Nidorina | 2.ª / única | Guardián | 551 | -19 % | 1004 | -26 % | nueva |
| 31 | Nidoqueen | 3.ª | Guardián | 691 | -14 % | 1371 | -16 % | nueva, final |
| 32 | Nidoran♂ | 1.ª | Cazador | 446 | -2 % | 799 | -5 % | T, nueva |
| 33 | Nidorino | 2.ª / única | Cazador | 580 | -15 % | 1062 | -22 % | nueva |
| 34 | Nidoking | 3.ª | Cazador | 760 | -5 % | 1536 | -5 % | nueva, final |
| 35 | Clefairy | 1.ª | Apoyo | 367 | -19 % | 745 | -12 % |  |
| 36 | Clefable | 2.ª / única | Apoyo | 543 | -20 % | 1293 | -5 % | final |
| 37 | Vulpix | 1.ª | Técnico | 538 | +19 % | 929 | +10 % | nueva |
| 38 | Ninetales | 2.ª / única | Técnico | 854 | +25 % | 1631 | +20 % | nueva, final |
| 39 | Jigglypuff | 1.ª | Maratonista | 378 | -17 % | 617 | -27 % | nueva |
| 40 | Wigglytuff | 2.ª / única | Maratonista | 609 | -11 % | 1142 | -16 % | nueva, final |
| 41 | Zubat | 1.ª | Velocista | 433 | -5 % | 745 | -12 % | T |
| 42 | Golbat | 2.ª / única | Velocista | 674 | -1 % | 1280 | -6 % |  |
| 43 | Oddish | 1.ª | Estudioso | 618 | +36 % | 1064 | +26 % | T, nueva |
| 44 | Gloom | 2.ª / única | Estudioso | 844 | +24 % | 1670 | +23 % | nueva |
| 45 | Vileplume | 3.ª | Estudioso | 1023 | +28 % | 1883 | +16 % | nueva, final |
| 46 | Paras | 1.ª | Técnico | 392 | -14 % | 845 | +0 % | T, nueva |
| 47 | Parasect | 2.ª / única | Técnico | 575 | -16 % | 1268 | -7 % | nueva, final |
| 48 | Venonat | 1.ª | Estudioso | 399 | -12 % | 689 | -18 % | nueva |
| 49 | Venomoth | 2.ª / única | Estudioso | 859 | +26 % | 1619 | +19 % | nueva, final |
| 50 | Diglett | 1.ª | Velocista | 456 | +0 % | 818 | -3 % | T, nueva |
| 51 | Dugtrio | 2.ª / única | Velocista | 720 | +6 % | 1434 | +6 % | nueva, final |
| 52 | Meowth | 1.ª | Velocista | 481 | +6 % | 988 | +17 % | T, nueva |
| 53 | Persian | 2.ª / única | Velocista | 650 | -5 % | 1535 | +13 % | nueva, final |
| 54 | Psyduck | 1.ª | Polivalente | 529 | +17 % | 964 | +14 % | nueva |
| 55 | Golduck | 2.ª / única | Polivalente | 750 | +10 % | 1491 | +10 % | nueva, final |
| 56 | Mankey | 1.ª | Cazador | 408 | -10 % | 711 | -16 % | T, nueva |
| 57 | Primeape | 2.ª / única | Cazador | 668 | -2 % | 1286 | -5 % | nueva, final |
| 58 | Growlithe | 1.ª | Polivalente | 508 | +12 % | 1041 | +24 % | nueva |
| 59 | Arcanine | 2.ª / única | Polivalente | 870 | +28 % | 1704 | +26 % | nueva, final |
| 60 | Poliwag | 1.ª | Guardián | 559 | +23 % | 1008 | +20 % | T, nueva |
| 61 | Poliwhirl | 2.ª / única | Guardián | 638 | -6 % | 1230 | -9 % | nueva |
| 62 | Poliwrath | 3.ª | Guardián | 751 | -6 % | 1372 | -15 % | nueva, final |
| 63 | Abra | 1.ª | Estudioso | 807 | +78 % | 1571 | +86 % | T, **fuera de banda** |
| 64 | Kadabra | 2.ª / única | Estudioso | 883 | +30 % | 1866 | +38 % |  |
| 65 | Alakazam | 3.ª | Estudioso | 1053 | +31 % | 2202 | +36 % | final |
| 66 | Machop | 1.ª | Cazador | 328 | -28 % | 608 | -28 % | T |
| 67 | Machoke | 2.ª / única | Cazador | 528 | -22 % | 994 | -27 % |  |
| 68 | Machamp | 3.ª | Cazador | 684 | -15 % | 1316 | -19 % | final |
| 69 | Bellsprout | 1.ª | Cazador | 608 | +34 % | 1123 | +33 % | T, nueva |
| 70 | Weepinbell | 2.ª / única | Cazador | 855 | +26 % | 1616 | +19 % | nueva |
| 71 | Victreebel | 3.ª | Cazador | 966 | +20 % | 1845 | +14 % | nueva, final |
| 72 | Tentacool | 1.ª | Técnico | 531 | +17 % | 918 | +9 % | nueva |
| 73 | Tentacruel | 2.ª / única | Técnico | 753 | +10 % | 1451 | +7 % | nueva, final |
| 74 | Geodude | 1.ª | Guardián | 448 | -1 % | 777 | -8 % | T |
| 75 | Graveler | 2.ª / única | Guardián | 598 | -12 % | 1043 | -23 % |  |
| 76 | Golem | 3.ª | Guardián | 801 | +0 % | 1486 | -8 % | final |
| 77 | Ponyta | 1.ª | Velocista | 515 | +14 % | 1071 | +27 % | nueva |
| 78 | Rapidash | 2.ª / única | Velocista | 738 | +8 % | 1732 | +28 % | nueva, final |
| 79 | Slowpoke | 1.ª | Guardián | 387 | -15 % | 610 | -28 % | nueva |
| 80 | Slowbro | 2.ª / única | Guardián | 617 | -9 % | 1200 | -12 % | nueva, final |
| 81 | Magnemite | 1.ª | Estudioso | 615 | +36 % | 1126 | +34 % |  |
| 82 | Magneton | 2.ª / única | Estudioso | 934 | +37 % | 1757 | +30 % | final |
| 83 | Farfetch’d | 2.ª / única | Cazador | 567 | -17 % | 1247 | -8 % | nueva, final |
| 84 | Doduo | 1.ª | Velocista | 495 | +9 % | 888 | +5 % | nueva |
| 85 | Dodrio | 2.ª / única | Velocista | 851 | +25 % | 1665 | +23 % | nueva, final |
| 86 | Seel | 1.ª | Maratonista | 428 | -6 % | 747 | -11 % | nueva |
| 87 | Dewgong | 2.ª / única | Maratonista | 634 | -7 % | 1141 | -16 % | nueva, final |
| 88 | Grimer | 1.ª | Maratonista | 344 | -24 % | 610 | -28 % | nueva |
| 89 | Muk | 2.ª / única | Maratonista | 610 | -10 % | 1141 | -16 % | nueva, final |
| 90 | Shellder | 1.ª | Guardián | 433 | -4 % | 760 | -10 % | nueva |
| 91 | Cloyster | 2.ª / única | Guardián | 765 | +12 % | 1503 | +11 % | nueva, final |
| 92 | Gastly | 1.ª | Estudioso | 703 | +55 % | 1401 | +66 % | T, **fuera de banda** |
| 93 | Haunter | 2.ª / única | Estudioso | 855 | +26 % | 1692 | +25 % |  |
| 94 | Gengar | 3.ª | Estudioso | 923 | +15 % | 1982 | +22 % | final |
| 95 | Onix | 2.ª / única | Guardián | 766 | +12 % | 1474 | +9 % | nueva, final |
| 96 | Drowzee | 1.ª | Técnico | 394 | -13 % | 695 | -18 % | T, nueva |
| 97 | Hypno | 2.ª / única | Técnico | 678 | 0 % | 1216 | -10 % | nueva, final |
| 98 | Krabby | 1.ª | Cazador | 387 | -15 % | 670 | -20 % | T, nueva |
| 99 | Kingler | 2.ª / única | Cazador | 623 | -9 % | 1226 | -10 % | nueva, final |
| 100 | Voltorb | 1.ª | Velocista | 573 | +26 % | 1044 | +24 % | nueva |
| 101 | Electrode | 2.ª / única | Velocista | 867 | +27 % | 1710 | +26 % | nueva, final |
| 102 | Exeggcute | 1.ª | Estudioso | 562 | +24 % | 1071 | +27 % | nueva |
| 103 | Exeggutor | 2.ª / única | Estudioso | 858 | +26 % | 1678 | +24 % | nueva, final |
| 104 | Cubone | 1.ª | Guardián | 391 | -14 % | 730 | -13 % | T, nueva |
| 105 | Marowak | 2.ª / única | Guardián | 604 | -11 % | 1192 | -12 % | nueva, final |
| 106 | Hitmonlee | 2.ª / única | Cazador | 584 | -14 % | 1246 | -8 % | nueva, final |
| 107 | Hitmonchan | 2.ª / única | Técnico | 596 | -12 % | 1221 | -10 % | nueva, final |
| 108 | Lickitung | 2.ª / única | Maratonista | 611 | -10 % | 1142 | -16 % | nueva, final |
| 109 | Koffing | 1.ª | Guardián | 418 | -8 % | 774 | -8 % | nueva |
| 110 | Weezing | 2.ª / única | Guardián | 576 | -15 % | 1191 | -12 % | nueva, final |
| 111 | Rhyhorn | 1.ª | Cazador | 388 | -14 % | 694 | -18 % | nueva |
| 112 | Rhydon | 2.ª / única | Cazador | 634 | -7 % | 1172 | -14 % | nueva, final |
| 113 | Chansey | 2.ª / única | Apoyo | 576 | -15 % | 1168 | -14 % | nueva, final |
| 114 | Tangela | 2.ª / única | Guardián | 704 | +3 % | 1707 | +26 % | nueva, final |
| 115 | Kangaskhan | 2.ª / única | Polivalente | 663 | -3 % | 1267 | -7 % | nueva, final |
| 116 | Horsea | 1.ª | Estudioso | 456 | +0 % | 1109 | +32 % | nueva |
| 117 | Seadra | 2.ª / única | Estudioso | 726 | +6 % | 1701 | +25 % | nueva, final |
| 118 | Goldeen | 1.ª | Polivalente | 500 | +10 % | 903 | +7 % | nueva |
| 119 | Seaking | 2.ª / única | Polivalente | 725 | +6 % | 1365 | +1 % | nueva, final |
| 120 | Staryu | 1.ª | Velocista | 554 | +22 % | 1049 | +24 % | nueva |
| 121 | Starmie | 2.ª / única | Velocista | 820 | +20 % | 1705 | +26 % | nueva, final |
| 122 | Mr. Mime | 2.ª / única | Técnico | 828 | +22 % | 1682 | +24 % | nueva, final |
| 123 | Scyther | 2.ª / única | Velocista | 923 | +36 % | 1875 | +38 % | nueva, final |
| 124 | Jynx | 2.ª / única | Estudioso | 853 | +25 % | 1687 | +24 % | nueva, final |
| 125 | Electabuzz | 2.ª / única | Velocista | 815 | +20 % | 1697 | +25 % | nueva, final |
| 126 | Magmar | 2.ª / única | Estudioso | 864 | +27 % | 1723 | +27 % | nueva, final |
| 127 | Pinsir | 2.ª / única | Cazador | 642 | -6 % | 1304 | -4 % | nueva, final |
| 128 | Tauros | 2.ª / única | Cazador | 708 | +4 % | 1458 | +7 % | nueva, final |
| 129 | Magikarp | 1.ª | Cazador | 383 | -16 % | 651 | -23 % | T, nueva |
| 130 | Gyarados | 2.ª / única | Cazador | 647 | -5 % | 1375 | +1 % | nueva, final |
| 131 | Lapras | 2.ª / única | Maratonista | 626 | -8 % | 1323 | -2 % | nueva, final |
| 132 | Ditto | 2.ª / única | Polivalente | 596 | -12 % | 1093 | -20 % | nueva, final |
| 133 | Eevee | 1.ª | Polivalente | 436 | -4 % | 761 | -10 % |  |
| 134 | Vaporeon | 2.ª / única | Maratonista | 811 | +19 % | 1490 | +10 % | final |
| 135 | Jolteon | 2.ª / única | Velocista | 895 | +31 % | 1859 | +37 % | final |
| 136 | Flareon | 2.ª / única | Cazador | 800 | +17 % | 1456 | +7 % | final |
| 137 | Porygon | 2.ª / única | Estudioso | 654 | -4 % | 1191 | -12 % | nueva, final |
| 138 | Omanyte | 1.ª | Estudioso | 477 | +5 % | 1048 | +24 % | nueva |
| 139 | Omastar | 2.ª / única | Estudioso | 841 | +23 % | 1638 | +21 % | nueva, final |
| 140 | Kabuto | 1.ª | Cazador | 552 | +22 % | 1006 | +19 % | nueva |
| 141 | Kabutops | 2.ª / única | Cazador | 747 | +10 % | 1446 | +7 % | nueva, final |
| 142 | Aerodactyl | 2.ª / única | Velocista | 877 | +29 % | 1639 | +21 % | nueva, final |
| 143 | Snorlax | 2.ª / única | Maratonista | 613 | -10 % | 1142 | -16 % | nueva, final |
| 144 | Articuno | Legendario | Técnico | 838 | +15 % | 2003 | +37 % |  |
| 145 | Zapdos | Legendario | Estudioso | 1003 | +37 % | 2304 | +57 % |  |
| 146 | Moltres | Legendario | Estudioso | 1087 | +49 % | 2269 | +55 % |  |
| 147 | Dratini | 1.ª | Polivalente | 530 | +17 % | 1000 | +19 % |  |
| 148 | Dragonair | 2.ª / única | Polivalente | 700 | +3 % | 1326 | -2 % |  |
| 149 | Dragonite | 3.ª | Polivalente | 828 | +3 % | 1942 | +20 % | final |
| 150 | Mewtwo | Legendario | Estudioso | 1035 | +42 % | 2183 | +49 % |  |
| 151 | Mew | Legendario | Polivalente | 1081 | +48 % | 2213 | +51 % |  |
| 169 | Crobat | 3.ª | Velocista | 832 | +4 % | 1679 | +4 % | final |
| 196 | Espeon | 2.ª / única | Estudioso | 880 | +29 % | 1878 | +38 % | final |
| 197 | Umbreon | 2.ª / única | Guardián | 566 | -17 % | 1023 | -25 % | final |
| 220 | Swinub | 1.ª | Maratonista | 400 | -12 % | 688 | -18 % |  |
| 221 | Piloswine | 2.ª / única | Maratonista | 600 | -12 % | 1128 | -17 % | final |
| 228 | Houndour | 1.ª | Estudioso | 682 | +50 % | 1230 | +46 % | T, **fuera de banda** |
| 229 | Houndoom | 2.ª / única | Estudioso | 945 | +39 % | 1822 | +34 % | final |

## Fuera de banda (lo que queda)

| Especie | Desviación | Motivo |
|---|---|---|
| Caterpie | -34 % / -42 % | Débil a propósito, evoluciona al nivel 7 (Pack 1). |
| Metapod | -59 % / -64 % | Sin técnicas de daño, evoluciona al nivel 10 (Pack 1). |
| Kakuna | -56 % / -62 % | Igual que Metapod: evoluciona al nivel 10. |
| Abra | +78 % / +86 % | Pack 1, sin tocar: transitoria (evoluciona al 16). Al bajar la mediana de las formas base con Kanto, destaca más que antes. |
| Gastly | +55 % / +66 % | Pack 1, sin tocar: transitoria (evoluciona al 25). |
| Houndour | +50 % / +46 % | Pack 1, sin tocar: transitoria (evoluciona al 24). |

Abra, Gastly y Houndour quedan por encima de +40 % frente a las demás formas base. El simulador ya excluía a las transitorias de sus propuestas y son especies que los jugadores de la alpha tienen, así que **no se tocaron**: decide el usuario si se les baja el Rendimiento (Abra 105, Gastly 100, Houndour 80).

Evoluciones que mejoran menos de un 10 % a su etapa anterior (todas del Pack 1 o capullos): Caterpie → Metapod y Weedle → Kakuna (a propósito), Pidgey → Pidgeotto (+9 % a nv. 30), Abra → Kadabra (+9 %), Haunter → Gengar (+8 %).

## Ajustes de curación y su motivo

Stats base de PokeAPI → valor en el juego. Las especies nuevas que no salen aquí solo tienen rol (sus stats originales ya entraban en banda).

| Especie | Rol | Ajuste | Motivo |
|---|---|---|---|
| Beedrill | Cazador | AtEsp 45 → 75 | AtEsp 45 → 75: mínimo de Rendimiento de su etapa (75). |
| Rattata | Velocista | AtEsp 25 → 35 | AtEsp 25 → 35: mínimo de Rendimiento de su etapa (35). |
| Raticate | Velocista | AtEsp 50 → 75 | AtEsp 50 → 75: mínimo de Rendimiento de su etapa (75). |
| Spearow | Cazador | AtEsp 31 → 35 | AtEsp 31 → 35: mínimo de Rendimiento de su etapa (35). |
| Fearow | Cazador | AtEsp 61 → 75 | AtEsp 61 → 75: mínimo de Rendimiento de su etapa (75). |
| Arbok | Cazador | AtEsp 65 → 75 | Deslumbrar (parálisis) + Enrosque + Intimidación. AtEsp 65 → 75: mínimo de Rendimiento de su etapa (75). |
| Nidorina | Guardián | AtEsp 55 → 73 | AtEsp 55 → 73: el simulador lo dejaba -37 % frente a la mediana de su grupo. |
| Nidoqueen | Guardián | AtEsp 75 → 87 | AtEsp 75 → 87: el simulador lo dejaba -23 % frente a la mediana de su grupo. |
| Ninetales | Técnico | AtEsp 81 → 76 | AtEsp 81 → 76: el simulador lo dejaba +30 % sobre la mediana de su grupo. |
| Jigglypuff | Maratonista | PS 115 → 105, AtEsp 45 → 54 | PS 115 → 105, en línea con Wigglytuff. Canto duerme salvajes. AtEsp 45 → 54: el simulador lo dejaba -33 % frente a la mediana de su grupo. |
| Wigglytuff | Maratonista | PS 140 → 125, AtEsp 85 → 100 | PS 140 → 125 (extremo moderado). AtEsp 85 → 100: el simulador lo dejaba -24 % frente a la mediana de su grupo. |
| Oddish | Estudioso | AtEsp 75 → 44 | AtEsp 75 → 44: el simulador lo dejaba +75 % sobre la mediana de su grupo. |
| Gloom | Estudioso | AtEsp 85 → 82 | AtEsp 85 → 82: para que Vileplume lo supere en al menos un 10 %. |
| Vileplume | Estudioso | AtEsp 110 → 125 | AtEsp 110 → 125: para superar a Gloom en al menos un 10 %. |
| Parasect | Técnico | Vel 30 → 40, AtEsp 60 → 75 | Espora: el mejor dormidor de salvajes. Vel 30 → 40. AtEsp 60 → 75: mínimo de Rendimiento de su etapa (75). |
| Venomoth | Estudioso | AtEsp 90 → 83 | AtEsp 90 → 83: el simulador lo dejaba +32 % sobre la mediana de su grupo. |
| Diglett | Velocista | PS 10 → 25 | PS 10 → 25: frágil pero jugable una sesión entera (como Abra). |
| Dugtrio | Velocista | PS 35 → 45, AtEsp 50 → 75 | PS 35 → 45: velocista frágil, pero no se agota en la primera sesión. AtEsp 50 → 75: mínimo de Rendimiento de su etapa (75). |
| Persian | Velocista | AtEsp 65 → 75 | AtEsp 65 → 75: mínimo de Rendimiento de su etapa (75). |
| Primeape | Cazador | AtEsp 60 → 75 | AtEsp 60 → 75: mínimo de Rendimiento de su etapa (75). |
| Growlithe | Polivalente | AtEsp 70 → 57 | AtEsp 70 → 57: el simulador lo dejaba +41 % sobre la mediana de su grupo. |
| Poliwhirl | Guardián | AtEsp 50 → 55 | AtEsp 50 → 55: mínimo de Rendimiento de su etapa (55). |
| Poliwrath | Guardián | AtEsp 70 → 97 | AtEsp 70 → 97: mínimo de Rendimiento de su etapa (75); el simulador lo dejaba -28 % frente a la mediana de su grupo. |
| Bellsprout | Cazador | AtEsp 70 → 42 | AtEsp 70 → 42: el simulador lo dejaba +78 % sobre la mediana de su grupo. |
| Weepinbell | Cazador | AtEsp 85 → 70 | AtEsp 85 → 70: el simulador lo dejaba +40 % sobre la mediana de su grupo. |
| Ponyta | Velocista | AtEsp 65 → 35 | AtEsp 65 → 35: el simulador lo dejaba +77 % sobre la mediana de su grupo. |
| Rapidash | Velocista | AtEsp 80 → 75 | AtEsp 80 → 75: el simulador lo dejaba +32 % sobre la mediana de su grupo. |
| Farfetch’d | Cazador | AtEsp 58 → 75 | Etapa única en Kanto. Danza Espada: cazador temprano. AtEsp 58 → 75: mínimo de Rendimiento de su etapa (75). |
| Dodrio | Velocista | AtEsp 60 → 75 | AtEsp 60 → 75: mínimo de Rendimiento de su etapa (75). |
| Dewgong | Maratonista | AtEsp 70 → 75 | AtEsp 70 → 75: mínimo de Rendimiento de su etapa (75). |
| Muk | Maratonista | AtEsp 65 → 95 | AtEsp 65 → 95: mínimo de Rendimiento de su etapa (75); el simulador lo dejaba -28 % frente a la mediana de su grupo. |
| Cloyster | Guardián | Def 180 → 150 | Def 180 → 150: el Aguante satura en 200 y no debe eclipsar a los demás líderes. |
| Onix | Guardián | Def 160 → 140, AtEsp 30 → 75 | Def 160 → 140 (extremo moderado). Etapa única en Kanto (Steelix no está). AtEsp 30 → 75: mínimo de Rendimiento de su etapa (75). |
| Hypno | Técnico | AtEsp 73 → 75 | AtEsp 73 → 75: mínimo de Rendimiento de su etapa (75). |
| Krabby | Cazador | AtEsp 25 → 35 | AtEsp 25 → 35: mínimo de Rendimiento de su etapa (35). |
| Kingler | Cazador | AtEsp 50 → 75 | AtEsp 50 → 75: mínimo de Rendimiento de su etapa (75). |
| Voltorb | Velocista | AtEsp 55 → 47 | AtEsp 55 → 47: el simulador lo dejaba +38 % sobre la mediana de su grupo. |
| Electrode | Velocista | AtEsp 80 → 75 | AtEsp 80 → 75: el simulador lo dejaba +31 % sobre la mediana de su grupo. |
| Exeggutor | Estudioso | AtEsp 125 → 107 | AtEsp 125 → 107: el simulador lo dejaba +40 % sobre la mediana de su grupo. |
| Marowak | Guardián | AtEsp 50 → 75 | AtEsp 50 → 75: mínimo de Rendimiento de su etapa (75). |
| Hitmonlee | Cazador | AtEsp 35 → 75 | Etapa única (Tyrogue no está). Captura muy alta. AtEsp 35 → 75: mínimo de Rendimiento de su etapa (75). |
| Hitmonchan | Técnico | AtEsp 35 → 75 | Etapa única (Tyrogue no está). Técnica alta: activa mucho sus técnicas. AtEsp 35 → 75: mínimo de Rendimiento de su etapa (75). |
| Lickitung | Maratonista | Vel 30 → 45, AtEsp 60 → 95 | Etapa única en Kanto (Lickilicky no está). Vel 30 → 45 para no depender solo del Rendimiento. AtEsp 60 → 95: mínimo de Rendimiento de su etapa (75); el simulador lo dejaba -28 % frente a la mediana de su grupo. |
| Rhyhorn | Cazador | AtEsp 30 → 35 | AtEsp 30 → 35: mínimo de Rendimiento de su etapa (35). |
| Rhydon | Cazador | AtEsp 45 → 75 | Etapa final en Kanto (Rhyperior no está). AtEsp 45 → 75: mínimo de Rendimiento de su etapa (75). |
| Chansey | Apoyo | PS 250 → 170, Vel 50 → 60, AtEsp 35 → 92 | PS 250 → 170 y Vel 50 → 60: se modera el extremo (§20.1); sigue siendo la que más Energía tiene. Ovocuración, Pulso Cura y Alma Cura: sostiene al equipo. AtEsp 35 → 92: mínimo de Rendimiento de su etapa (75); el simulador lo dejaba -25 % frente a la mediana de su grupo. |
| Tangela | Guardián | AtEsp 100 → 93 | Etapa única en Kanto (Tangrowth no está). AtEsp 100 → 93: el simulador lo dejaba +32 % sobre la mediana de su grupo. |
| Kangaskhan | Polivalente | AtEsp 40 → 75 | Etapa única. Buena en todo y con mucha Energía. AtEsp 40 → 75: mínimo de Rendimiento de su etapa (75). |
| Horsea | Estudioso | AtEsp 70 → 35 | AtEsp 70 → 35: el simulador lo dejaba +89 % sobre la mediana de su grupo. |
| Seadra | Estudioso | AtEsp 95 → 81 | Etapa final en Kanto (Kingdra no está). AtEsp 95 → 81: el simulador lo dejaba +40 % sobre la mediana de su grupo. |
| Seaking | Polivalente | AtEsp 65 → 75 | AtEsp 65 → 75: mínimo de Rendimiento de su etapa (75). |
| Staryu | Velocista | AtEsp 70 → 60 | AtEsp 70 → 60: el simulador lo dejaba +38 % sobre la mediana de su grupo. |
| Starmie | Velocista | AtEsp 100 → 90 | AtEsp 100 → 90: el simulador lo dejaba +35 % sobre la mediana de su grupo. |
| Scyther | Velocista | AtEsp 55 → 75 | Etapa única en Kanto (Scizor no está). Velocista con Captura alta. AtEsp 55 → 75: mínimo de Rendimiento de su etapa (75). |
| Pinsir | Cazador | AtEsp 55 → 75 | Etapa única. Captura muy alta + Danza Espada. AtEsp 55 → 75: mínimo de Rendimiento de su etapa (75). |
| Tauros | Cazador | AtEsp 40 → 75 | Etapa única. Intimidación como líder. AtEsp 40 → 75: mínimo de Rendimiento de su etapa (75). |
| Gyarados | Cazador | AtEsp 60 → 75 | Evoluciona de Magikarp a nivel 20: cazador con Intimidación. AtEsp 60 → 75: mínimo de Rendimiento de su etapa (75). |
| Ditto | Polivalente | AtEsp 48 → 75 | Sin técnicas de daño: Transformación (+15 % de puntos y de Puntos de captura). Comodín sin tipo fuerte. AtEsp 48 → 75: mínimo de Rendimiento de su etapa (75). |
| Jolteon | Velocista | AtEsp 110 → 75, Vel 130 → 124 | AtEsp 110 → 75 y Vel 130 → 124 (simulador: +76% sobre la mediana de su etapa con el dato original; con Kanto completo seguía en +46% con AtEsp 80). Sigue siendo velocista: su valor viene del Ritmo. |
| Omanyte | Estudioso | AtEsp 90 → 52 | AtEsp 90 → 52: el simulador lo dejaba +75 % sobre la mediana de su grupo. |
| Kabutops | Cazador | AtEsp 65 → 75 | AtEsp 65 → 75: mínimo de Rendimiento de su etapa (75). |
| Snorlax | Maratonista | PS 160 → 140, Vel 30 → 45, AtEsp 65 → 99 | PS 160 → 140 y Vel 30 → 45: maratonista de referencia sin ser obligatorio; con Ritmo 30 solo entraba en banda con un Rendimiento impropio de él. AtEsp 65 → 99: mínimo de Rendimiento de su etapa (75); el simulador lo dejaba -30 % frente a la mediana de su grupo. |
| Moltres | Estudioso | AtEsp 125 → 115 | AtEsp 125 → 115: con Kanto completo quedaba +65% sobre la mediana de los finales (techo de legendario: +60%). La rareza no cambia. |

Solo rol, sin cambios de stats (41): Weedle, Kakuna, Ekans, Nidoran♀, Nidoran♂, Nidorino, Nidoking, Vulpix, Paras, Venonat, Meowth, Psyduck, Golduck, Mankey, Arcanine, Poliwag, Victreebel, Tentacool, Tentacruel, Slowpoke, Slowbro, Doduo, Seel, Grimer, Shellder, Drowzee, Exeggcute, Cubone, Koffing, Weezing, Goldeen, Mr. Mime, Jynx, Electabuzz, Magmar, Magikarp, Lapras, Porygon, Omastar, Kabuto, Aerodactyl.

## Habilidades nuevas (64)

| Habilidad | Efecto en PokeFocus | Especies |
|---|---|---|
| Hedor (`stench`) | Los contraataques contra él fallan un 20% de las veces. | Gloom*, Grimer, Muk, Koffing*, Weezing* |
| Armadura Batalla (`battle-armor`) | Recibe un 20% menos de daño de los contraataques. | Cubone*, Marowak*, Kabuto, Kabutops |
| Caparazón (`shell-armor`) | Recibe un 20% menos de daño de los contraataques. | Shellder, Cloyster, Krabby, Kingler, Lapras, Omanyte, Omastar |
| Humedad (`damp`) | +20% de puntos con lluvia. | Paras*, Parasect*, Psyduck, Golduck, Poliwag, Poliwhirl, Poliwrath, Horsea*, Seadra* |
| Flexibilidad (`limber`) | Gasta un 10% menos de Energía por acción. | Persian, Hitmonlee, Ditto |
| Aclimatación (`cloud-nine`) | Si reclamas tarde, su Foco no baja del 70% (en vez de quedarse en el 50%). | Psyduck, Golduck, Lickitung* |
| Insomnio (`insomnia`) | Usar Descanso no lo duerme. +15% de puntos de noche. | Drowzee, Hypno |
| Espíritu Vital (`vital-spirit`) | Usar Descanso no lo duerme. Gasta un 5% menos de Energía por acción. | Mankey, Primeape, Electabuzz*, Magmar* |
| Inmunidad (`immunity`) | Recupera un 10% de Energía al terminar cada sesión. | Snorlax |
| Ritmo Propio (`own-tempo`) | Si reclamas tarde, su Foco no baja del 75% (en vez de quedarse en el 50%). | Slowpoke, Slowbro, Lickitung |
| Intimidación (`intimidate`) | Como líder, todo el equipo recibe un 20% menos de daño de los contraataques (no se acumula). | Ekans, Arbok, Growlithe, Arcanine, Tauros, Gyarados |
| Efecto Espora (`effect-spore`) | A veces duerme a un salvaje durante la sesión. | Vileplume*, Paras, Parasect |
| Cuerpo Puro (`clear-body`) | Recibe un 20% menos de daño de los contraataques. | Tentacool, Tentacruel |
| Cura Natural (`natural-cure`) | Recupera un 15% de Energía al terminar cada sesión. | Chansey, Staryu, Starmie |
| Dicha (`serene-grace`) | +30% de probabilidad de activar sus técnicas. | Chansey |
| Nado Rápido (`swift-swim`) | +25% de Ritmo con lluvia. | Psyduck*, Golduck*, Poliwag*, Poliwhirl*, Poliwrath*, Horsea, Goldeen, Seaking, Magikarp, Omanyte, Omastar, Kabuto, Kabutops |
| Iluminación (`illuminate`) | Muestra la calidad (IVs) de los salvajes antes de lanzar. | Staryu, Starmie |
| Alerta (`forewarn`) | Muestra la calidad (IVs) de los salvajes antes de lanzar. | Drowzee, Hypno, Jynx |
| Cacheo (`frisk`) | Muestra la calidad (IVs) de los salvajes antes de lanzar. | Wigglytuff* |
| Calco (`trace`) | Los salvajes tienen un 50% de probabilidad de tener su misma naturaleza. | Porygon |
| Punto Tóxico (`poison-point`) | Si recibe un contraataque, puede paralizar al salvaje (20%). | Nidoran♀, Nidorina, Nidoqueen, Nidoran♂, Nidorino, Nidoking, Seadra |
| Velo Agua (`water-veil`) | Los contraataques de tipo Fuego le curan en vez de dañarle. | Goldeen, Seaking |
| Insonorizar (`soundproof`) | Si reclamas tarde, su Foco no baja del 70% (en vez de quedarse en el 50%). | Voltorb, Electrode, Mr. Mime |
| Corte Fuerte (`hyper-cutter`) | +10% de Puntos de captura. | Krabby, Kingler, Pinsir |
| Recogida (`pickup`) | Gana un 15% más de EXP. | Meowth |
| Entusiasmo (`hustle`) | +25% de Puntos de captura, pero gasta un 10% más de Energía. | Rattata*, Raticate*, Nidoran♀*, Nidorina*, Nidoran♂*, Nidorino* |
| Viscosidad (`sticky-hold`) | Los salvajes aguantan 1 lanzamiento fallido más (no se acumula). | Grimer, Muk |
| Trampa Arena (`arena-trap`) | Los salvajes aguantan 1 lanzamiento fallido más (no se acumula). | Diglett, Dugtrio |
| Lodo Líquido (`liquid-ooze`) | Cuando recibe un contraataque, el salvaje pierde un 10% de vida. | Tentacool, Tentacruel |
| Enjambre (`swarm`) | +30% de Puntos de captura cuando le queda menos de un tercio de Energía. | Beedrill, Scyther |
| Irascible (`anger-point`) | +30% de Puntos de captura cuando le queda menos de un tercio de Energía. | Mankey, Primeape, Tauros |
| Sequía (`drought`) | Su bonificación por condición de tipo es un 50% mayor. | Vulpix*, Ninetales* |
| Rivalidad (`rivalry`) | Como líder, +15% de Puntos de captura. | Nidoran♀, Nidorina, Nidoqueen, Nidoran♂, Nidorino, Nidoking |
| Gula (`gluttony`) | Recupera un 12% de Energía al terminar cada sesión. | Bellsprout*, Weepinbell*, Victreebel*, Snorlax* |
| Liviano (`unburden`) | +25% de Ritmo por debajo de la mitad de Energía. | Hitmonlee* |
| Piel Seca (`dry-skin`) | Con lluvia, recupera un 20% de Energía al terminar cada sesión. Con sol gasta un 10% más de Energía. | Paras, Parasect, Jynx* |
| Descarga (`download`) | +10% de puntos en sesiones sin pausas. | Porygon |
| Puño Férreo (`iron-fist`) | +15% de Puntos de captura. | Hitmonchan |
| Encadenado (`skill-link`) | +15% de probabilidad de activar sus técnicas. | Shellder, Cloyster |
| Francotirador (`sniper`) | +30% de Puntos de captura contra legendarios y míticos. | Beedrill*, Spearow*, Fearow*, Horsea, Seadra |
| Experto (`technician`) | +20% de probabilidad de activar sus técnicas. | Meowth, Persian, Mr. Mime*, Scyther |
| Defensa Hoja (`leaf-guard`) | De día, recibe un 30% menos de daño de los contraataques. | Tangela |
| Rompemoldes (`mold-breaker`) | Sus Puntos de captura no se reducen contra tipos que los resisten. | Pinsir |
| Detonación (`aftermath`) | Cuando recibe un contraataque, el salvaje pierde un 15% de vida. | Voltorb*, Electrode* |
| Filtro (`filter`) | Recibe un 25% menos de daño de los contraataques. | Mr. Mime |
| Intrépido (`scrappy`) | Sus Puntos de captura hacen daño normal contra tipos inmunes. | Kangaskhan |
| Gélido (`ice-body`) | Con frío o nieve, recupera un 20% de Energía al terminar cada sesión. | Seel*, Dewgong* |
| Audaz (`reckless`) | +20% de Puntos de captura, pero gasta un 10% más de Energía. | Hitmonlee, Rhyhorn*, Rhydon* |
| Potencia Bruta (`sheer-force`) | +20% de Puntos de captura, pero un 20% menos de probabilidad de activar sus técnicas. | Nidoqueen*, Nidoking*, Krabby*, Kingler*, Tauros* |
| Competitivo (`defiant`) | Tras recibir un contraataque, el siguiente lanzamiento tiene +15%. | Mankey*, Primeape*, Farfetch’d* |
| Tenacidad (`competitive`) | +20% de puntos por debajo de la mitad de Energía. | Jigglypuff, Wigglytuff |
| Alma Cura (`healer`) | Al terminar cada sesión, cura un 10% al compañero con menos Energía. | Chansey* |
| Armadura Frágil (`weak-armor`) | +15% de Ritmo, pero recibe un 20% más de daño de los contraataques. | Onix*, Omanyte*, Omastar*, Kabuto*, Kabutops* |
| Cosecha (`harvest`) | De día, recupera un 15% de Energía al terminar cada sesión. | Exeggcute*, Exeggutor* |
| Funda (`overcoat`) | Recibe un 15% menos de daño de los contraataques. | Shellder*, Cloyster* |
| Toque Tóxico (`poison-touch`) | A veces paraliza a un salvaje durante la sesión. | Grimer*, Muk* |
| Regeneración (`regenerator`) | Recupera un 20% de Energía al terminar cada sesión. | Slowpoke*, Slowbro*, Tangela* |
| Piel Milagro (`wonder-skin`) | Los contraataques contra él fallan un 20% de las veces. | Venomoth* |
| Impostor (`imposter`) | Su bonificación por condición de tipo es un 50% mayor. | Ditto* |
| Autoestima (`moxie`) | +20% de Puntos de captura en sesiones de 50 min o más. | Pinsir*, Gyarados* |
| Justiciero (`justified`) | Los contraataques de tipo Siniestro le curan en vez de dañarle. | Growlithe*, Arcanine* |
| Cobardía (`rattled`) | +20% de Ritmo por debajo de la mitad de Energía. | Magikarp* |
| Poder Arena (`sand-force`) | +20% de Puntos de captura los fines de semana. | Diglett*, Dugtrio* |
| Gas Reactivo (`neutralizing-gas`) | Los salvajes no contraatacan tras el primer lanzamiento fallido. | Koffing, Weezing |

\* = habilidad oculta (5 %).

## Técnicas especiales nuevas (41)

| Técnica | Tipo | Efecto | Prob. base / límite por sesión |
|---|---|---|---|
| Canto (`sing`) | activable | Duerme a un salvaje que elijas (×2.5 a la captura). | 0.05 / 2 |
| Beso Amoroso (`lovely-kiss`) | activable | Duerme a un salvaje que elijas (×2.5 a la captura). | 0.06 / 2 |
| Espora (`spore`) | activable | Duerme a un salvaje que elijas (×2.5 a la captura). | 0.08 / 2 |
| Deslumbrar (`glare`) | activable | Paraliza a un salvaje que elijas (×1.5 a la captura). | 0.08 / 2 |
| Ovocuración (`soft-boiled`) | activable | Recupera el 50% de su Energía. | 0.08 / 2 |
| Relajo (`slack-off`) | activable | Recupera el 50% de su Energía. | 0.08 / 2 |
| Alivio (`refresh`) | activable | Recupera el 25% de su Energía. | 0.08 / 2 |
| Pulso Cura (`heal-pulse`) | activable | Cura el 40% al compañero con menos Energía. | 0.06 / 2 |
| Aromaterapia (`aromatherapy`) | activable | Cura el 20% de Energía a todo el equipo. | 0.05 / 1 |
| Deseo Cura (`healing-wish`) | activable | Al empezar la próxima sesión, cura el 50% al compañero con menos Energía. | 0.06 / 1 |
| Drenadoras (`leech-seed`) | activable | Recupera un 5% de Energía tras cada acción el resto de la sesión. | 0.06 / 1 |
| Metrónomo (`metronome`) | activable | Sus 3 acciones siguientes dan el doble de puntos. | 0.05 / 1 |
| Tormenta de Arena (`sandstorm`) | activable | Activa la condición de los tipo Tierra para todo el equipo el resto de la sesión. | 0.05 / 1 |
| Campo de Hierba (`grassy-terrain`) | activable | Activa la condición de los tipo Planta para todo el equipo el resto de la sesión. | 0.05 / 1 |
| Campo Eléctrico (`electric-terrain`) | activable | Activa la condición de los tipo Eléctrico para todo el equipo el resto de la sesión. | 0.05 / 1 |
| Campo de Niebla (`misty-terrain`) | activable | Activa la condición de los tipo Hada para todo el equipo el resto de la sesión. | 0.05 / 1 |
| Campo Psíquico (`psychic-terrain`) | activable | Activa la condición de los tipo Psíquico para todo el equipo el resto de la sesión. | 0.05 / 1 |
| Danza Espada (`swords-dance`) | pasiva | +20% de Puntos de captura. | — |
| Enrosque (`coil`) | pasiva | +15% de Puntos de captura. | — |
| Afilar (`sharpen`) | pasiva | +10% de Puntos de captura. | — |
| Aullido (`howl`) | pasiva | +10% de Puntos de captura. | — |
| Avivar (`work-up`) | pasiva | +8% de puntos y de Puntos de captura. | — |
| Tambor (`belly-drum`) | pasiva | +40% de Puntos de captura, pero gasta un 25% más de Energía. | — |
| Rompecoraza (`shell-smash`) | pasiva | +15% de Ritmo y de Puntos de captura, pero gasta un 15% más de Energía. | — |
| Danza Aleteo (`quiver-dance`) | pasiva | +10% de puntos y de Ritmo. | — |
| Pulimento (`rock-polish`) | pasiva | +15% de Ritmo (actúa más a menudo). | — |
| Viento Afín (`tailwind`) | pasiva | +5% de Ritmo a todo el equipo (no se acumula). | — |
| Pantalla de Luz (`light-screen`) | pasiva | Todo el equipo recibe un 15% menos de daño de los contraataques (no se acumula). | — |
| Reflejo (`reflect`) | pasiva | Todo el equipo recibe un 15% menos de daño de los contraataques (no se acumula). | — |
| Barrera (`barrier`) | pasiva | Recibe un 25% menos de daño de los contraataques. | — |
| Armadura Ácida (`acid-armor`) | pasiva | Recibe un 25% menos de daño de los contraataques. | — |
| Defensa Férrea (`iron-defense`) | pasiva | Recibe un 25% menos de daño de los contraataques. | — |
| Reducción (`minimize`) | pasiva | Los contraataques contra él fallan un 20% de las veces. | — |
| Doble Equipo (`double-team`) | pasiva | Los contraataques contra él fallan un 20% de las veces. | — |
| Aguante (`endure`) | pasiva | Los contraataques nunca lo dejan agotado. | — |
| Levitón (`magnet-rise`) | pasiva | Reclamar tarde no reduce lo que genera este Pokémon. | — |
| Fijar Blanco (`lock-on`) | pasiva | +5% de probabilidad de captura con cualquier Ball (no se acumula). | — |
| Telépata (`mind-reader`) | pasiva | +5% de probabilidad de captura con cualquier Ball (no se acumula). | — |
| Encanto (`charm`) | pasiva | Gana Vínculo un 30% más rápido. | — |
| Camaradería (`play-nice`) | pasiva | Gana Vínculo un 20% más rápido. | — |
| Transformación (`transform`) | pasiva | Imita a los salvajes: +15% de puntos y de Puntos de captura. | — |
## Apariciones (GDD §10.2) y ligas

- No se cambió ninguna regla de aparición: el peso de cada especie sigue siendo su tasa de captura, y la etapa de cada especie (`stage`) es la que usa la regla por liga (Base solo 1.ª forma; Super 1.ª y 2.ª; Ultra también 3.ª; Master todo y legendarios). Esa regla ya está en el motor del árbol de trabajo (`encounters.leagueStageWeights`, la implementa el agente de ligas); aquí solo se dejaron los datos coherentes.
- Reparto actual: 76 especies de 1.ª etapa (20 de ellas de etapa única), 60 de 2.ª, 17 de 3.ª y 5 legendarios. Suma de pesos: 1.ª 11.420, 2.ª 4.387, 3.ª 815.
- **Las especies de etapa única son 1.ª etapa para el motor**, así que Tauros, Lapras, Snorlax o Aerodactyl pueden salir en liga Base (con peso 25-45 frente a 190-255 de las comunes: cada una ≈ 0,3 % de los salvajes). Rinden como una 2.ª etapa. Si se prefiere que no salgan hasta Super, el motor necesitaría un campo por especie (p. ej. `spawnStage`) o una lista en la configuración; hoy no existe.
- **Los iniciales son mucho más raros:** Bulbasaur pasa de ≈ 1,5 % de los salvajes (1 de cada 65) a ≈ 0,4 % (1 de cada 260) a nivel bajo, porque ahora comparte la bolsa con muchas especies comunes (peso 255). Es el comportamiento natural de la fórmula, pero cambia la experiencia del principio.
- Tipos con pocas especies en Kanto: Acero (2: Magnemite y Magneton), Fantasma (3), Dragón (3), Siniestro (3, de Johto), Hada (5) y Hielo (7). Los 18 tipos siguen cubiertos.

## Topes de nivel por Pokédex (GDD §12.5)

`progression.levelCaps`: 0 → 30, 70 → 40, 100 → 50, 140 → 60. Se calcularon con los mismos porcentajes de antes (≈ 45 %, 64 % y 89 %) sobre las **158** especies que hay en el juego, no sobre 151, porque las 7 de Johto del Pack 1 también cuentan para la Pokédex (con 151 saldrían 68 / 97 / 135). El techo real es `progression.maxLevel` (100), así que añadir un escalón con el siguiente pack es solo un dato.

Simulación a 52 semanas (4 semillas, `npm run simulate -- --longterm --weeks 52 --seeds 4 --profile constant,casual-real`), con el motor del árbol de trabajo:

| Perfil | 70 especies | 100 especies | 140 especies | Nivel 40 | Nivel 50 | Nivel 60 | Especies en la sem. 52 |
|---|---|---|---|---|---|---|---:|
| Constante | día 19 | día 48 | día 202 | día 103 | día 192 | día 280 (sem. 40) | 151 |
| Casual real | la mitad llega | no | no | no | no | no | 69 |

- Para el constante el tope casi nunca frena: llega a las especies antes que al nivel (solo el de 140 coincide con el nivel 50, hacia el día 200).
- **El constante llega al nivel 60 en la semana 40**, antes del objetivo de ~78 semanas del plan (decisión 7). Esa medición depende de la curva de EXP y del motor de ligas, que estaban cambiando el mismo día; hay que repetirla cuando el paso 4-6 esté cerrado.
- El casual real se queda en el tope de 30 durante todo el año (69 especies en la semana 52). Si se quiere que llegue al 40 dentro del primer año, el primer umbral tendría que bajar a unas 55-60 especies.

## Huecos conocidos

- **Habilidades con efecto aproximado** (no hay primitiva que represente la original): Recogida (`pickup`: +15 % de EXP, porque no existe una primitiva de objetos encontrados), Punto Tóxico y Toque Tóxico (paralizan, porque el juego no tiene veneno), Iluminación / Alerta / Cacheo (muestran los IVs, como Vista Lince), Calco (misma naturaleza, como Sincronía), Impostor y Sequía (bonificación de condición, como Pararrayos), Gas Reactivo (como Nerviosismo), Aclimatación e Insonorizar (suelo de Foco al reclamar tarde). Todas funcionan; lo que hay que juzgar es si el efecto encaja.
- **Movimientos de estado sin definir** (no existen en el juego, como ya pasaba): 114, entre ellos los muy repetidos Malicioso, Látigo, Gruñido, Chirrido, Supersónico, Ataque Arena, Anulación, Polvo Veneno, Tóxico, Rayo Confuso, Fortaleza y Rizo Defensa. Se dejaron fuera para no dar el mismo efecto a 15-30 especies.
- **Ditto y Kakuna no tienen técnicas de daño** (generan Energía Normal al 50 %, como Metapod). Ditto tiene Transformación como técnica pasiva.
- **Especies sin ninguna técnica especial por nivel** (solo daño; pueden tener alguna por MT o tutor): Weedle, Nidoqueen, Diglett, Dugtrio, Koffing, Weezing, Rhyhorn, Rhydon y Magikarp.
- **Evoluciones que salen de Kanto** no existen: Onix, Scyther, Chansey, Porygon, Electabuzz, Magmar, Lickitung, Tangela, Rhydon, Seadra, Golbat → Crobat sí (ya estaba). Eevee conserva sus cinco evoluciones del Pack 1.
- **Sprites:** no falta ninguno.
- **Textos:** nombres, géneros y descripciones en ES y EN vienen de PokeAPI; las descripciones de habilidades y técnicas nuevas están escritas en los dos idiomas.
- **`docs/balance-report.md` no se regeneró** (el informe completo falla mientras el motor de ligas está a medias: `scripts/sim/report.ts` lee `encounters.leagueMaxWaveSize`, que ya no existe). La tabla de este informe sale de las mismas funciones (`species-value.ts`, `species-analysis.ts`).

## Qué debe revisar el usuario

1. **Roles** de las 102 especies nuevas (tabla de arriba): se asignaron por el stat destacado de la forma final. Hay 27 cazadores y solo 2 líneas de apoyo (Clefairy y Chansey).
2. **Rendimiento subido a los lentos y a los físicos** para entrar en banda: Wigglytuff 100, Muk 95, Lickitung 95, Poliwrath 97, Snorlax 99, Chansey 92, y el mínimo de 75 para una veintena de finales (Tauros, Pinsir, Kingler, Rhydon…). Es la misma receta de Machamp y Golem en el Pack 1, pero aplicada a muchos.
3. **Rendimiento bajado a formas base fuertes:** Oddish 75 → 44, Bellsprout 70 → 42, Ponyta 65 → 35, Horsea 70 → 35, Omanyte 90 → 52, Growlithe 70 → 57. Son recortes grandes; la alternativa es aceptar que esas formas base destaquen.
4. **Dos retoques al Pack 1** que afectan a Pokémon que los jugadores ya tienen: Jolteon (AtEsp 80 → 75, Vel 130 → 124) y Moltres (AtEsp 125 → 115).
5. **Abra, Gastly y Houndour** siguen fuera de banda por arriba (transitorias): decidir si se tocan.
6. **Efectos de las 64 habilidades y 41 técnicas nuevas:** valores puestos siguiendo los del Pack 1 (mismos porcentajes para efectos equivalentes), sin partidas reales. Las más fuertes a mirar: Espora (0,08 por acción), Tambor (+40 % de Puntos de captura), Dicha (+30 % de activación), Regeneración (20 % de Energía por sesión), Intimidación (−20 % de daño a todo el equipo como líder).
7. **Etapa única en liga Base** y **rareza de los iniciales** (apartado «Apariciones»).
8. **Topes 70 / 100 / 140** frente a 68 / 97 / 135, y si el casual debe poder pasar del nivel 30 en su primer año.
