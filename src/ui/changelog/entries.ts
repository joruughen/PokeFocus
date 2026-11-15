/**
 * What changed in each version, written for players (not for developers).
 * Newest first. Every text has a Spanish and an English version.
 *
 * To publish a release: add an entry at the top, with the next version, today's
 * date (YYYY-MM-DD, UTC) and a few short lines, then bump `version` in
 * package.json. Keep each line to what the player notices.
 */
export type ChangeKind = 'new' | 'improved' | 'fixed'

export interface Localized {
  es: string
  en: string
}

export interface ChangeItem {
  kind: ChangeKind
  text: Localized
}

export interface ChangelogEntry {
  /** MAJOR.MINOR.PATCH */
  version: string
  /** YYYY-MM-DD (UTC). */
  date: string
  title: Localized
  items: ChangeItem[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.12.0',
    date: '2026-11-15',
    title: { es: 'Intercambios y objetos avanzados', en: 'Trades and advanced items' },
    items: [
      {
        kind: 'new',
        text: {
          es: 'Intercambios con amigos: ofrece un Pokémon, tu amigo elige qué te da a cambio y los dos confirman. Kadabra, Machoke, Graveler y Haunter evolucionan al llegar. Necesitas 3 días de amistad y cuesta algo de Polvo. El Pokémon conserva su mote.',
          en: 'Trades with friends: offer a Pokémon, your friend picks what to give you back and you both confirm. Kadabra, Machoke, Graveler and Haunter evolve when they arrive. You need 3 days of friendship and it costs some Dust. The Pokémon keeps its nickname.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Objetos avanzados en la ficha de cada Pokémon: Teracristalización (nivel 20), MT, Mentas (nivel 10), Chapas (nivel 25) y Cápsula Habilidad (nivel 30). Salen en las misiones semanales según tu nivel de entrenador; la Menta es «a elegir» y los Teralitos empiezan a salir en el nivel 15.',
          en: 'Advanced items on each Pokémon’s page: Terastallization (level 20), TMs, Mints (level 10), Bottle Caps (level 25) and Ability Capsule (level 30). They come from weekly missions depending on your trainer level; the Mint is a “Choice Mint” and Tera Shards start dropping at level 15.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Caja: botón «Seleccionar» para soltar varios Pokémon a la vez, con un resumen de los caramelos que ganas y avisos si hay shiny, legendarios o Pokémon con mote.',
          en: 'Box: a “Select” button to release several Pokémon at once, with a summary of the candies you get and warnings for shinies, legendaries or nicknamed Pokémon.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'En el móvil, el menú de abajo tiene Inicio, Caja, Equipo, Misiones y «Más» con el resto. Los avisos ya no se amontonan y los consejos siempre caben en pantalla.',
          en: 'On phones, the bottom menu has Home, Box, Team, Missions and “More” with the rest. Notices no longer pile up and tips always fit on screen.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'El desglose de puntos muestra «Reclamado tarde» como paso propio, y los caramelos de la Mochila ya no listan los Pokémon de su línea.',
          en: 'The points breakdown shows “Claimed late” as its own step, and Bag candies no longer list the Pokémon of their line.',
        },
      },
      {
        kind: 'fixed',
        text: {
          es: 'Los Pokémon grandes (Moltres, Articuno, Charizard…) ya no se salen de su recuadro en la sesión, la ficha, la Pokédex, la elección de inicial ni la evolución.',
          en: 'Big Pokémon (Moltres, Articuno, Charizard…) no longer stick out of their frame in the session, the Pokémon page, the Pokédex, the starter choice or the evolution.',
        },
      },
    ],
  },
  {
    version: '0.11.0',
    date: '2026-11-10',
    title: { es: 'Eventos', en: 'Events' },
    items: [
      {
        kind: 'new',
        text: {
          es: 'Nueva página de Eventos: mira los eventos activos, los próximos y los pasados, con sus fechas en tu hora, las especies destacadas, el shiny o los legendarios del evento, los objetos que pueden caer y sus misiones.',
          en: 'New Events page: see active, upcoming and past events, with their dates in your time zone, featured species, the event’s shiny or legendary boost, the items that can drop and its missions.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Durante un evento, sus especies destacadas aparecen más (con la marca «Destacada» en la oleada), pueden caer objetos del evento (los ves en Resultados) y hay misiones propias que puedes reclamar hasta 7 días después de que termine. Un aviso en el inicio te dice cuándo hay uno activo.',
          en: 'During an event its featured species show up more often (marked “Featured” in the wave), event items can drop (you see them in Results) and it has its own missions, which you can claim up to 7 days after it ends. A banner on the home screen tells you when one is on.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Cuando empieza un evento te sale una ventana con su imagen, su descripción y las especies destacadas. Nunca aparece mientras estudias: espera a que termines.',
          en: 'When an event starts, a window shows you its image, its description and the featured species. It never appears while you study: it waits until you finish.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'En el móvil, el panel para lanzar la Ball ya no tapa a los salvajes de la oleada.',
          en: 'On phones, the ball-throwing panel no longer covers the wild Pokémon in the wave.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Subir de nivel de entrenador ahora tiene premio: Polvo y Poké Balls en cada nivel, Super Balls y una Poción cada 5 niveles y Ultra Balls cada 10. Una ventana de «¡Felicidades!» te cuenta lo que ganaste (nunca mientras estudias).',
          en: 'Leveling up as a trainer now pays off: Dust and Poké Balls every level, Great Balls and a Potion every 5 levels and Ultra Balls every 10. A “Congratulations!” window tells you what you got (never while you study).',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'La Mochila tiene su propia página: busca tus objetos por nombre, fíltralos por tipo (Balls, curación, evolución, caramelos, objetos de evento…) y mira para qué sirve cada uno y en qué Pokémon puedes usarlo.',
          en: 'The Bag has its own page: search your items by name, filter them by kind (Balls, healing, evolution, candies, event items…) and see what each one does and which Pokémon can use it.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'La Ball de Estudio ya no hace que tu equipo ataque solo ni le quita Energía: después de usarla puedes seguir eligiendo a qué salvaje ataca cada Pokémon. Ahora sirve con salvajes base de nivel 9 o menor al principio, y ese límite sube con tu nivel de entrenador hasta 25.',
          en: 'The Study Ball no longer makes your team attack on its own or costs it Energy: after using it you can still choose which wild Pokémon each of yours attacks. It now works on base wild Pokémon of level 9 or lower at first, and that limit rises with your trainer level up to 25.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'La «Energía de captura» de las técnicas de daño ahora se llama «Puntos de captura», para no confundirla con la Energía (la vida) de tus Pokémon.',
          en: '“Catch energy” from damage techniques is now called “Capture Points”, so it isn’t confused with your Pokémon’s Energy (their HP).',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'En «Sumar desde la Caja», el nombre de cada Pokémon abre su ficha completa.',
          en: 'In “Add from the Box”, each Pokémon’s name opens its full page.',
        },
      },
      {
        kind: 'fixed',
        text: {
          es: 'Varios arreglos de diseño: los Pokémon grandes (como Machamp) ya no se salen de su tarjeta, y a 390 px el mote en «Energía del equipo», los globos de ayuda que se salían de la pantalla y los equipos guardados con seis Pokémon.',
          en: 'Several layout fixes: big Pokémon (like Machamp) no longer stick out of their card, and at 390 px the nickname in “Team Energy”, help bubbles that went off screen and saved teams with six Pokémon.',
        },
      },
    ],
  },
  {
    version: '0.10.0',
    date: '2026-11-10',
    title: { es: 'Sesiones largas y números claros', en: 'Long sessions and clear numbers' },
    items: [
      {
        kind: 'new',
        text: {
          es: 'Al pasar el ratón por la probabilidad de captura (o tocarla bajo el botón Lanzar) ves de dónde sale: el ratio de captura de la especie, la vida que le queda, la Ball, el estado y las habilidades, y cuánto subiría si lo duermes, lo paralizas o usas una Ultra Ball.',
          en: 'Hover over the catch chance (or tap it under the Throw button) to see where it comes from: the species’ capture rate, its remaining HP, the ball, its status and your abilities, and how much it would rise if you put it to sleep, paralyze it or use an Ultra Ball.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'Abandonar una sesión larga ya no lo pierde todo: si planeaste más de 25 min y llevas al menos 15, conservas los puntos, la EXP y el Polvo de los minutos estudiados y una oleada por cada bloque de 25 min completo. La confirmación te dice exactamente qué conservas.',
          en: 'Giving up a long session no longer loses everything: if you planned more than 25 min and have studied at least 15, you keep the points, EXP and Dust of the minutes you studied and one wave per full 25-min block. The confirmation tells you exactly what you keep.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Al pasar el ratón (o tocar) por Daño, Pasiva o Activable de una técnica ves cuándo se activa y con qué probabilidad, con los números de ese Pokémon. En las de daño, también para qué sirven los Puntos de captura.',
          en: 'Hover over or tap Damage, Passive or Activable on a technique to see when it triggers and how likely it is, with that Pokémon’s own numbers. Damage techniques also explain what Capture Points are for.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Resultados: un desglose de cómo se calculan tus puntos (base, condición, Vínculo, Foco, Aguante, habilidades y rendimiento diario), para el equipo y para cada Pokémon.',
          en: 'Results: a breakdown of how your points are calculated (base, condition, Bond, Focus, Grit, abilities and daily yield), for the team and for each Pokémon.',
        },
      },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-10',
    title: { es: 'Combate, Energía y gestión del equipo', en: 'Combat, Energy and team management' },
    items: [
      {
        kind: 'improved',
        text: {
          es: 'Mandar a un Pokémon contra un salvaje es un ataque definitivo: el salvaje le contraataca a él. Si antes lo duermes o lo paralizas, no puede responder. Si falla una Ball, el contraataque va siempre a tu líder.',
          en: 'Sending a Pokémon against a wild one is a final attack: the wild one strikes back at it. Put it to sleep or paralyze it first and it can’t answer. When a Ball fails, the counterattack always goes to your leader.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'Los salvajes pegan más fuerte (×1,5), pero cada acción gasta menos Energía: un Pokémon aguanta unas 4–6 sesiones seguidas sin descanso. Ves la Energía de todo el equipo durante la sesión y en las oleadas.',
          en: 'Wild Pokémon hit harder (×1.5), but each action costs less Energy: a Pokémon lasts about 4–6 back-to-back sessions without breaks. You can see the whole team’s Energy during the session and in the waves.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Motes: ponle a cada Pokémon un nombre propio de hasta 12 caracteres desde su ficha.',
          en: 'Nicknames: give each Pokémon a name of its own, up to 12 characters, from its detail page.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Equipos guardados: guarda tu equipo con un nombre y cámbiate a él con un toque, en Equipo o en el inicio antes de empezar.',
          en: 'Saved teams: save your team under a name and switch to it in one tap, from Team or from the home screen before you start.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Desde la ficha de un Pokémon puedes meterlo en el equipo o cambiarlo por otro, con una comparación antes de confirmar.',
          en: 'From a Pokémon’s detail page you can add it to the team or swap it for another member, with a comparison before you confirm.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Tras cada actualización, una ventana te cuenta qué hay de nuevo (solo una vez y nunca en mitad de una sesión).',
          en: 'After each update, a window tells you what’s new (only once, and never in the middle of a session).',
        },
      },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-11-09',
    title: { es: 'Música en los descansos y arreglos', en: 'Break music and fixes' },
    items: [
      {
        kind: 'new',
        text: {
          es: 'Música de los descansos: ahora puedes silenciarla con el botón «Música» de la pantalla de descanso, sin salir de ella, y desde Ajustes → Sonido. Los efectos y el aviso de fin siguen sonando.',
          en: 'Break music: you can now mute it with the “Music” button on the break screen without leaving it, and from Settings → Sound. Sound effects and the end chime keep playing.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'Si eliges un salvaje donde la Ball de Estudio no sirve, se cambia sola a una Ball válida. Con una sala de estudio en grupo abierta, el botón Empezar individual se desactiva y explica por qué.',
          en: 'If you pick a wild Pokémon the Study Ball can’t be used on, the ball switches to a valid one. With a study group room open, the solo Start button is disabled and says why.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'Reclamar antes de tiempo ahora explica por qué no se puede, y los avisos de nombre o país bloqueados muestran la fecha exacta en que se desbloquean.',
          en: 'Claiming too early now explains why it can’t be done, and the locked name or country messages show the exact unlock date.',
        },
      },
      {
        kind: 'fixed',
        text: {
          es: 'Con dos pestañas abiertas, el sonido de fin de sesión suena una sola vez, aunque empezaras la sesión en la pestaña que no es la principal.',
          en: 'With two tabs open, the end-of-session sound now plays only once, even if you started the session in the tab that is not the main one.',
        },
      },
      {
        kind: 'fixed',
        text: {
          es: 'En el móvil (390 px) ya no se recortan los Pokémon de los extremos del equipo en la sesión, al reclamar, en el descanso ni en los resultados. El Polvo cabe en su tarjeta del menú lateral.',
          en: 'On phones (390 px) the outer team Pokémon are no longer cropped during the session, when claiming, on break or on the results screen. Dust now fits its card in the side rail.',
        },
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-11-06',
    title: { es: 'Foco más claro, estadísticas y equipo', en: 'Clearer Focus, stats and team' },
    items: [
      {
        kind: 'improved',
        text: {
          es: 'El Foco ahora se entiende solo: 100% si reclamas a tiempo y 50% si tardas. El Aguante de cada Pokémon lo sube hasta un 10% más, y eso se nota en sus puntos y su EXP. Tus recompensas totales se mantienen.',
          en: 'Focus is now simple: 100% if you claim on time and 50% if you are late. Each Pokémon’s Grit raises it up to 10% more, which shows in its points and EXP. Your overall rewards stay the same.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'En la ficha de un Pokémon, la tarjeta de datos tiene dos pestañas: «Estadísticas» (lo que rinde ahora) e «IVs» (el valor exacto de 0 a 31 de cada estadística y cuánto suma hoy; no cambia nunca).',
          en: 'On a Pokémon’s detail screen, the data card has two tabs: “Stats” (how it performs now) and “IVs” (the exact 0–31 value of each stat and how much it adds today; it never changes).',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'Al pasar el ratón (o tocar) una estadística ves de dónde sale su número: tu especie y su nivel, la naturaleza y el IV. Ya no se muestran los nombres internos de las estadísticas.',
          en: 'Hover (or tap) a stat to see where its number comes from: your species and its level, the nature and the IV. The internal stat names are no longer shown.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Antes de evolucionar puedes ver cuánto subirá cada estadística («Ver cambios de estadísticas»). Algunas evoluciones bajan alguna estadística y se muestra en rojo.',
          en: 'Before evolving you can see how much each stat will change (“See stat changes”). Some evolutions lower a stat, and it shows in red.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'En Equipo, haz clic en cualquier Pokémon del equipo para ver sus datos en el panel de la derecha, sin ir a la Caja.',
          en: 'On the Team screen, click any team member to see its details in the right panel, without going to the Box.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'Las etiquetas Daño, Pasiva y Activable de las técnicas ahora explican qué hacen al pasar el ratón (o al tocarlas).',
          en: 'The Damage, Passive and Activable labels on techniques now explain what they do when you hover (or tap) them.',
        },
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-11-06',
    title: { es: 'Avisos que llegan aunque la pestaña duerma', en: 'Notices that arrive even if the tab sleeps' },
    items: [
      {
        kind: 'new',
        text: {
          es: 'En Ajustes → Sesiones puedes activar «Avisos aunque la pestaña esté dormida o cerrada»: el servidor también te avisa cuando termina tu sesión, así no pierdes la ventana de 5 minutos si tu navegador duerme la pestaña mientras estudias en otra.',
          en: 'In Settings → Sessions you can turn on “Notices even when the tab is asleep or closed”: the server also tells you when your session ends, so you do not miss the 5-minute window if your browser puts the tab to sleep while you study in another one.',
        },
      },
      {
        kind: 'fixed',
        text: {
          es: 'Los textos del Foco ya dicen cómo funciona de verdad (85 % si reclamas a tiempo, la mitad si tardas) y el Aguante explica cuánto Foco recupera.',
          en: 'The Focus texts now say how it really works (85% if you claim on time, half if you are late) and Grit explains how much Focus it recovers.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Con los avisos activados hay un botón «Enviar aviso de prueba» para comprobar que te llegan.',
          en: 'With the notices on there is a “Send a test notice” button to check that they reach you.',
        },
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-11-06',
    title: { es: 'Habilidad nueva, cuenta y ajustes', en: 'New ability, account and fixes' },
    items: [
      {
        kind: 'improved',
        text: {
          es: 'Despiste (Swinub y Piloswine) ahora hace algo: el 15% de los contraataques de los salvajes falla contra cualquier miembro del equipo. No se acumula con Velo Arena ni Manto Níveo.',
          en: 'Oblivious (Swinub and Piloswine) now does something: 15% of wild counterattacks miss any team member. It does not stack with Sand Veil or Snow Cloak.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Tu nombre y tu país quedan bloqueados 30 días después de cambiarlos (el primer cambio es libre). El país decide en qué ranking apareces.',
          en: 'Your name and country are locked for 30 days after you change them (the first change is free). Your country decides which leaderboard you are on.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Modo anónimo: en Ajustes puedes aparecer como «Entrenador anónimo» en los rankings global y de país. Tus amigos siguen viendo tu nombre.',
          en: 'Anonymous mode: in Settings you can appear as “Anonymous trainer” in the global and country leaderboards. Your friends still see your name.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Si recargas la página durante una sesión, un botón «Toca para activar el sonido» te deja activar el aviso sonoro de fin (el navegador lo bloquea hasta que tocas la página).',
          en: 'If you reload the page during a session, a “Tap to turn sound on” button lets you enable the end-of-session sound (the browser blocks it until you tap the page).',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'El micrófono sigue analizando bien el sonido aunque cambies de pestaña mientras estudias.',
          en: 'The microphone keeps analysing sound correctly even if you switch tabs while you study.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'El rol de cada Pokémon tiene una etiqueta propia y una explicación (es de la especie, no su naturaleza), y la ficha avisa cuando su naturaleza va a favor o en contra de su rol.',
          en: 'Each Pokémon’s role has its own label and an explanation (it belongs to the species, not the nature), and the detail screen tells you when its nature works for or against its role.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'Al cambiar de pantalla con el teclado, el foco pasa al contenido nuevo.',
          en: 'When you change screens with the keyboard, focus moves to the new content.',
        },
      },
      {
        kind: 'fixed',
        text: {
          es: 'El botón «Soltar» de la ficha de un Pokémon se confundía con el fondo: ahora es un botón rojo bien visible.',
          en: 'The “Release” button on a Pokémon’s detail screen blended into the background: it is now a clearly visible red button.',
        },
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-11-06',
    title: { es: 'Novedades, versión y avisos', en: 'News, version and notices' },
    items: [
      {
        kind: 'new',
        text: {
          es: 'Esta página de novedades: aquí verás qué cambió en cada versión.',
          en: 'This news page: here you will see what changed in each version.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Etiqueta «Alfa» con la versión del juego, en el menú y al iniciar sesión.',
          en: 'An “Alpha” label with the game version, in the menu and on the sign-in screen.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Avisos de mantenimiento: un banner te dice desde qué día y hora hasta cuándo habrá mantenimiento, en tu zona horaria.',
          en: 'Maintenance notices: a banner tells you the day and time maintenance starts and ends, in your time zone.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'Caja: ahora puedes buscar por nombre, filtrar por tipo y ordenar la lista; cada Pokémon muestra sus tipos y condiciones.',
          en: 'Box: you can now search by name, filter by type and sort the list; each Pokémon shows its types and conditions.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'Con el equipo completo, el botón «Cambiar» sustituye a un miembro por otro Pokémon de la Caja.',
          en: 'With a full team, the “Swap” button replaces a member with another Pokémon from the Box.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'En la sesión de estudio, el botón de la música lleva la etiqueta «Música».',
          en: 'During a study session, the music button now has a “Music” label.',
        },
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-05',
    title: { es: 'Sesiones con más profundidad', en: 'Deeper study sessions' },
    items: [
      {
        kind: 'new',
        text: {
          es: 'Reparto del daño: elige a qué salvaje ataca cada Pokémon de tu equipo, o deja el modo Auto.',
          en: 'Damage split: choose which wild Pokémon each member of your team attacks, or leave it on Auto.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Informe de la sesión: qué técnicas y habilidades se activaron y por qué aparecieron esos salvajes.',
          en: 'Session report: which moves and abilities fired and why those wild Pokémon showed up.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Sesiones de estudio en grupo con amigos. El bonus de tipo Hada crece con el tiempo que estudiáis juntos.',
          en: 'Group study sessions with friends. The Fairy-type bonus grows with the time you study together.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Guía de los 18 tipos, con cuándo se activa cada uno y un planificador «¿Y si empiezo a las…?».',
          en: 'A guide to the 18 types, with when each one is active and an “What if I start at…?” planner.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Micrófono opcional: mide el ruido en tu navegador (no se envía audio) y activa los tipos Volador y Psíquico. Incluye calibración.',
          en: 'Optional microphone: it measures noise in your browser (no audio is sent) and activates the Flying and Psychic types. Includes calibration.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Clima real con Open-Meteo, según tu ubicación aproximada o la ciudad que escribas.',
          en: 'Real weather from Open-Meteo, based on your approximate location or the city you type.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Botón para silenciar la música durante la sesión de estudio.',
          en: 'A button to mute the music during a study session.',
        },
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-04',
    title: { es: 'Cuentas, amigos y rankings', en: 'Accounts, friends and leaderboards' },
    items: [
      {
        kind: 'new',
        text: {
          es: 'Cuentas con correo y contraseña: tu progreso se guarda en el servidor y lo tienes en cualquier dispositivo.',
          en: 'Accounts with email and password: your progress is saved on the server and follows you across devices.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Amigos: añádelos con su código y mira su nivel, liga y equipo.',
          en: 'Friends: add them with their code and see their level, league and team.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Rankings semanales y mensuales: global, de tu país y de tus amigos.',
          en: 'Weekly and monthly leaderboards: global, your country and your friends.',
        },
      },
      {
        kind: 'improved',
        text: {
          es: 'Solo puedes tener una sesión de estudio activa a la vez, aunque entres desde varios dispositivos.',
          en: 'You can only have one study session running at a time, even if you sign in on several devices.',
        },
      },
      {
        kind: 'fixed',
        text: {
          es: 'Las cargas de estado ya no se gastan sobre un salvaje que ya tiene un estado.',
          en: 'Status charges are no longer wasted on a wild Pokémon that already has a status.',
        },
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-11-03',
    title: { es: 'Primer prototipo', en: 'First prototype' },
    items: [
      {
        kind: 'new',
        text: {
          es: 'Estudia con un temporizador: cada sesión trae oleadas de Pokémon salvajes que tu equipo debilita y tú capturas.',
          en: 'Study with a timer: each session brings waves of wild Pokémon that your team weakens and you capture.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Caja, equipo, Pokédex, ligas y misiones diarias, semanales y de Pokédex, con 56 especies del Pack 1.',
          en: 'Box, team, Pokédex, leagues and daily, weekly and Pokédex missions, with 56 species from Pack 1.',
        },
      },
      {
        kind: 'new',
        text: {
          es: 'Español e inglés, arte pixel, efectos de sonido y música generados en tu navegador.',
          en: 'Spanish and English, pixel art, and sound effects and music generated in your browser.',
        },
      },
      {
        kind: 'fixed',
        text: {
          es: 'Primera ronda de pruebas de calidad: 13 problemas de la interfaz corregidos.',
          en: 'First quality-assurance pass: 13 interface problems fixed.',
        },
      },
    ],
  },
]
