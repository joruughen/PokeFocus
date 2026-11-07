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
