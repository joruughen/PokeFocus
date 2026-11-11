/**
 * Key that remounts the screens when the live content changes (so nothing keeps values of the old rules).
 *
 * The admin screen is the one that changes the content: when it publishes, its own hash moves and a remount would
 * throw away the open tab and the draft or event being edited. So while the route is the admin one the key stays
 * as it was; the first game screen opened afterwards picks up the new hash (and remounts, as it always did).
 */
export function nextRemountKey(current: string, contentHash: string, route: string): string {
  return route === 'admin' ? current : contentHash
}
