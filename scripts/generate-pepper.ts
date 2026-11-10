/**
 * Prints a fresh password pepper as a ready-to-paste `.env` line.
 *   npm run pepper
 * Writes nothing. Generate it ONCE per deployment and keep a copy somewhere safe and
 * separate from the database backups (a password manager): if it is lost, nobody whose
 * hash uses it can log in. To rotate, move the old value to PASSWORD_PEPPER_PREVIOUS.
 */
import { randomBytes } from 'node:crypto'

console.log(`PASSWORD_PEPPER=${randomBytes(32).toString('base64url')}`)
console.error('# Keep it secret and back it up apart from the database. Never change it without PASSWORD_PEPPER_PREVIOUS.')
