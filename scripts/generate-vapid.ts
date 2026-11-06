/**
 * Prints a fresh VAPID key pair (Web Push) as ready-to-paste `.env` lines.
 *   npm run vapid
 * Writes nothing: copy the lines into `.env` (or your secret store) yourself and
 * edit VAPID_SUBJECT. Generate the pair once: changing the keys invalidates every
 * existing browser subscription (players must enable notifications again).
 */
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
console.log('VAPID_SUBJECT=mailto:you@example.com')
console.error('# Edit VAPID_SUBJECT (mailto: or https:// contact for the push services). Keep VAPID_PRIVATE_KEY secret.')
