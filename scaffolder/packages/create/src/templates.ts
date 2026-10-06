import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The host a template is built on. */
export type Host = 'hono' | 'fastify'

/** The four templates. Each is one host, with or without the offline agent. */
export const TEMPLATES = ['hono', 'hono-agent', 'fastify', 'fastify-agent'] as const
export type TemplateId = (typeof TEMPLATES)[number]

/** The template for a host and an agent choice. */
export function templateFor(host: Host, agent: boolean): TemplateId {
  return agent ? (`${host}-agent` as TemplateId) : host
}

/** Where the template folders are: next to the built package (`templates/`). */
export function templatesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')
}

/** Absolute path of a template folder, or throws when the package is missing it. */
export function templateDir(id: TemplateId): string {
  const dir = join(templatesRoot(), id)
  if (!existsSync(dir)) throw new Error(`template "${id}" is missing from this package (looked in ${dir})`)
  return dir
}

/** Human label for a host, used in generated READMEs. */
export const HOST_LABEL: Record<Host, string> = { hono: 'Hono', fastify: 'Fastify' }
