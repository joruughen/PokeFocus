/**
 * The JSON Schema of the admin import formats, generated from the zod schemas (adminJson.ts) so it cannot drift:
 * `npm run admin:schema` writes it to `docs/admin-json/*.schema.json` and a test fails when the files are stale.
 */
import { z } from 'zod'
import { contentImportSchema, CONTENT_FORMAT, eventImportSchema, EVENT_FORMAT } from './adminJson'

export const ADMIN_SCHEMA_FILES = ['event.schema.json', 'content.schema.json'] as const
export type AdminSchemaFile = (typeof ADMIN_SCHEMA_FILES)[number]

function build(schema: z.ZodType, id: string, title: string, description: string): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  const { $schema, ...rest } = json
  return { $schema, $id: id, title, description, ...rest }
}

/** The generated schemas by file name. */
export function adminJsonSchemas(): Record<AdminSchemaFile, Record<string, unknown>> {
  return {
    'event.schema.json': build(
      eventImportSchema,
      'https://pokefocus.local/admin-json/event.schema.json',
      `PokeFocus admin import: event (${EVENT_FORMAT})`,
      'An event (dates, featured species, shiny and legendary boosts, drops, missions, own items) and optionally the content patch that goes live with it. See docs/admin-json.md.',
    ),
    'content.schema.json': build(
      contentImportSchema,
      'https://pokefocus.local/admin-json/content.schema.json',
      `PokeFocus admin import: content (${CONTENT_FORMAT})`,
      'A live content patch (config values, species spawn rules, moves, techniques, abilities, missions) for a content draft. See docs/admin-json.md.',
    ),
  }
}

/** The file text: stable formatting, trailing newline. */
export function adminSchemaText(schema: Record<string, unknown>): string {
  return `${JSON.stringify(schema, null, 2)}\n`
}
