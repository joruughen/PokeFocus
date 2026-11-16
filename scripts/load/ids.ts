/** Identidades de los usuarios virtuales (compartidas entre el worker y el orquestador). */
export const PASSWORD = 'LoadTest#2026'
export const emailOf = (i: number) => `load${i}@load.test`
export const ipOf = (i: number) => `10.${((i + 1) >> 16) & 255}.${((i + 1) >> 8) & 255}.${(i + 1) & 255}`
