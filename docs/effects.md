# Primitivas de efecto (contrato del motor)

Las técnicas (`data/overrides/custom-techniques.json`) y las habilidades (`data/overrides/custom-abilities.json`) no tienen código propio: cada una es una lista de **efectos** construidos con las primitivas de este documento. El motor (`src/engine/`) implementa cada primitiva una sola vez. Añadir una técnica o habilidad nueva no requiere programar, salvo que necesite una primitiva nueva.

## Estructura

```jsonc
// Técnica
{
  "category": "passive" | "activable",
  "baseChance": 0.06,          // solo activables: probabilidad base por acción (GDD §7.2)
  "limitPerSession": 2,        // solo activables
  "limitPerWeek": 1,           // opcional
  "effects": [Effect, ...],
  "description": { "es": "...", "en": "..." }
}
// Habilidad: { "effects": [Effect, ...], "description": {...} }  — siempre pasiva
```

- **Pasivo** (técnica pasiva o habilidad): el efecto se aplica siempre que se cumpla su `when`.
- **Activable**: en cada acción del Pokémon se tira `baseChance × Mult_Técnica × Mult_Dominio × techChance` (máx. `actions.maxActivationChance`). Si sale, se aplican sus efectos ahora. Cada técnica respeta su `limitPerSession`.
- `scope: "team"` en un efecto pasivo (`statMod` y `counterMiss`): afecta a todo el equipo, pero **no se acumula** entre miembros: si dos miembros dan el mismo efecto de equipo sobre el mismo `stat` (o `counterMiss`), se aplica el más fuerte.

## Condiciones (`when`)

Todas las claves presentes deben cumplirse (AND). Sin `when`, el efecto siempre se aplica.

| Clave | Significado |
|---|---|
| `sessionMinMinutes: n` | La sesión dura ≥ n minutos |
| `energyBelow: f` | Energía actual del Pokémon < f · máxima (se evalúa en cada acción) |
| `energyFull: true` | Energía actual = máxima |
| `timeWindow` | Hora local **de inicio** de la sesión. `daylight` 05–18, `notDaylight`, `night` 20–05, `notNight`, `earlyMorning` 05–09 |
| `weather` | `rain`, `sun` (soleado o ≥ `conditions.fireHotCelsius`), `cold` (≤ `conditions.iceColdCelsius` o nieve) |
| `weekend: true` | Sábado o domingo (hora local) |
| `noPauses: true` | La sesión no tuvo pausas |
| `isLeader: true` | El Pokémon está en el hueco 1 del equipo |
| `targetLegendary: true` | Al calcular el daño contra un salvaje legendario o mítico |

## Primitivas

| `kind` | Campos | Efecto |
|---|---|---|
| `statMod` | `stat`, `mult`, `scope`, `when?` | Multiplica una magnitud. `stat` ∈ `points`, `pace` (divide el intervalo de acción), `captureEnergy`, `techChance`, `energyCost`, `exp`, `bondGain`, `counterDamageTaken` |
| `heal` | `pct`, `target` (`self`, `team`, `lowestAlly`), `timing?` (`now` por defecto, `sessionEnd`, `nextSessionStart`), `when?` | Recupera `pct` de la Energía máxima |
| `healOverTime` | `pctPerAction` | Desde que se activa, recupera ese % tras cada acción del Pokémon el resto de la sesión |
| `restFullHeal` | — | Recupera el 100% y marca `asleepNextSession` (no actúa la próxima sesión) |
| `wildStatus` | `status` (`sleep`, `paralysis`) | Da al jugador una "carga" de estado que aplica a un salvaje de su elección al ver las oleadas |
| `statusOnAction` | `status`, `chance`, `limit` | Pasivo: en cada acción, con `chance`, igual que `wildStatus` (hasta `limit` por sesión) |
| `extraWild` | `count` | +`count` salvajes en una oleada (la primera por defecto) |
| `rerollWild` | — | Da una "carga" para sustituir un salvaje por otro nuevo |
| `activateCondition` | `type` | La condición de ese tipo se considera activa para todo el equipo el resto de la sesión (afecta a las acciones posteriores) |
| `pointsBurst` | `actions`, `mult` | Las siguientes `actions` acciones del Pokémon multiplican sus puntos |
| `lastActionMult` | `mult` | Multiplica los puntos de la última acción del Pokémon en la sesión |
| `conditionBonusMult` | `mult` | Su bonificación de condición `(M − 1)` se multiplica: `1 + (M − 1) · mult` |
| `streakProtect` | — | Si el día anterior no hubo sesiones, la racha no se rompe (respeta `limitPerWeek`) |
| `lateClaimImmune` | — | Reclamar tarde no le aplica `lateClaimMultiplier` |
| `focusFloor` | `min` | Para este Pokémon, `Foco_efectivo = max(Foco_efectivo, min)`, después del bono de Aguante. Como a tiempo el Foco es 1.0, solo actúa al reclamar tarde (Foco 0.5, hasta 0.55 con Aguante) |
| `focusLabelFloor` | `labels`, `value` | Para este Pokémon, las capturas con esas etiquetas valen al menos `value`. **Hoy ninguna habilidad la usa:** el Foco por captura de pantalla se descartó el 2026-11-05 (Despiste era la única y ahora es un `counterMiss` de equipo). La primitiva se conserva, con sus pruebas, por si vuelve a hacer falta |
| `effectivenessFloor` | `from`, `to` | Su Puntos de captura: los multiplicadores de tipo iguales a `from` pasan a `to` |
| `encounterWeight` | `match` (`{type}` o `{natureOfSelf: true}`), `mult` | Equipo, no acumulable. `{type}`: multiplica el peso de esas especies al generar oleadas. `{natureOfSelf}`: `mult` es la probabilidad de que el salvaje tenga la misma naturaleza que este Pokémon |
| `ballMult` | `mult` | Equipo, no acumulable: multiplica la probabilidad de captura de cualquier Ball |
| `maxFailedThrows` | `add` | Equipo, no acumulable: suma lanzamientos fallidos permitidos antes de que el salvaje escape |
| `revealWildIvs` | — | Equipo: la UI muestra la calidad (IVs) de los salvajes |
| `counterImmuneType` | `type` | Si el contraataque es de ese tipo, cura el 25% de Energía en vez de dañar |
| `counterMinHp1` | — | Un contraataque nunca le deja a 0 de Energía |
| `counterMiss` | `chance`, `scope?` (`self` por defecto, o `team`), `when?` | `self`: los contraataques contra él fallan con esa probabilidad (Velo Arena, Manto Níveo: `chance` 0.25). `team`: los contraataques contra **cualquier** miembro del equipo fallan con esa probabilidad; ejemplo, Despiste: `{ "kind": "counterMiss", "chance": 0.15, "scope": "team" }`. No se acumula: la probabilidad final es la **mayor** entre el `counterMiss` propio de quien recibe el golpe y el mejor `counterMiss` de equipo (nunca la suma ni el producto). Como los demás efectos de equipo, aporta todo miembro del equipo (también uno agotado, que no puede ser el objetivo) y su `when` se evalúa con su propio contexto; un Pokémon fuera del equipo no aporta. Solo se tira el dado si la probabilidad final es mayor que 0 |
| `counterReflect` | `wildHpPct` | Al recibir un contraataque, el salvaje pierde ese % de vida (respetando el mínimo del 5%) |
| `counterStatus` | `status`, `chance` | Al recibir un contraataque, con `chance`, el salvaje queda con ese estado |
| `counterNoFirst` | — | Equipo: el primer fallo de cada salvaje no provoca contraataque |
| `nextThrowBonus` | `mult`, `when?` | Tras recibir un contraataque, el siguiente lanzamiento multiplica su probabilidad |
| `noSleepFromRest` | `when?` | Descanso no le marca `asleepNextSession` |
| `copyTeammate` | — | Marca la técnica de transformación (Ditto, **Transformación**): quien la **conoce** puede copiar a un compañero del equipo (`setCopy`, `src/engine/transform.ts`, GDD §7.3). No pasa por el flujo de pasivas ni ocupa hueco: copiado el compañero, usa sus **tipos** (condiciones, STAB, bonus de tipos del equipo, defensa), sus **primeras N técnicas equipadas** (N = huecos de técnica por nivel del copiador) con el Dominio del compañero, y su aspecto. Conserva sus stats, habilidad, nivel y Vínculo. Un transformador no puede copiar a otro |

### Quién recibe el contraataque

Las primitivas `counter*`, `nextThrowBonus` y los `statMod` de `counterDamageTaken` con `scope: "self"` se evalúan sobre **el Pokémon que recibe el contraataque**. Ese Pokémon es **el líder** (o el siguiente con Energía) cuando falla una Ball, y **el atacante** cuando el contraataque responde a un ataque (asignar su ficha de daño, GDD §11.4); si el salvaje está dormido o paralizado no responde a los ataques. Así, Velo Arena, Manto Níveo, Espejo Mágico, Cuerpo Maldito, Polvo Escudo, Muro Mágico o Robustez protegen a quien las lleva cuando ataca, y al líder también en las Balls falladas. Las de equipo (Despiste, Compiescolta) protegen a todos; Nerviosismo (sin contraataque en el primer fallo) solo afecta a las Balls. Las que piden `isLeader: true` (Sacapecho, Impasible) solo actúan cuando el líder recibe el golpe.

## Técnicas y movimientos no definidos

- Un movimiento **de daño** (potencia > 0) que no esté en `custom-techniques.json` es una técnica de daño genérica: produce Puntos de captura de su tipo, con su potencia y su categoría.
- Un movimiento **de estado** que no esté definido **no existe en el juego**: no se aprende, no se muestra y no se puede equipar.
- Una habilidad que no esté definida no existe en el juego (GDD §6.3).
