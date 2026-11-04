/** Join class names, skipping falsy values. Order matters: later wins only if specificity is equal, so avoid passing conflicting utilities. */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
  return parts.filter(Boolean).join(' ')
}
