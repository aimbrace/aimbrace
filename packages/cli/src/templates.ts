/** The two templates: a Cordis app, and the same app with the offline agent. */
export const TEMPLATES = ['app', 'agent'] as const
export type Template = (typeof TEMPLATES)[number]

/** The template for an agent choice. */
export function templateFor(agent: boolean): Template {
  return agent ? 'agent' : 'app'
}

/** The folder holding a template, next to this package's source. There is no build, so the path is fixed. */
export function templateDir(template: Template): URL {
  return new URL(`../templates/${template}/`, import.meta.url)
}
