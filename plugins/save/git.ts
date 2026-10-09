/**
 * Adapters for the ports: the user's own git, and GitHub through the user's own gh login. Extracted from ACRYL. Nothing reads, stores or
 * asks for a token; git and gh use the user's credential helpers, and nothing ever waits on a credentials prompt.
 */
import { spawnSync } from 'node:child_process'
import type { GitPort, HostingPort } from './save.ts'

export class SaveError extends Error {
  override name = 'SaveError'
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error !== undefined)
    throw new SaveError(`${command} is not available: ${result.error.message}`)
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function must(command: string, args: readonly string[], cwd: string): string {
  const result = run(command, args, cwd)
  if (result.status !== 0)
    throw new SaveError(
      `${command} ${args[0] ?? ''} failed: ${result.stderr.trim().split('\n').at(-1) ?? result.status}`,
    )
  return result.stdout
}

export function gitCli(appDir: string): GitPort {
  return {
    isRepository: () => run('git', ['rev-parse', '--show-toplevel'], appDir).status === 0,
    init: () => void must('git', ['init', '--quiet'], appDir),
    stageAll: () => void must('git', ['add', '--all', '.'], appDir),
    stagedFiles: () =>
      must('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], appDir)
        .split('\0')
        .filter(Boolean),
    stagedText: (path) => {
      const numstat = must('git', ['diff', '--cached', '--numstat', '--', path], appDir)
      if (numstat.startsWith('-\t-\t')) return undefined
      return must('git', ['show', `:${path}`], appDir)
    },
    unstageAll: () => void run('git', ['reset', '--quiet'], appDir),
    hasStagedChanges: () => run('git', ['diff', '--cached', '--quiet'], appDir).status !== 0,
    commit: (message) => {
      must('git', ['commit', '--quiet', '-m', message], appDir)
      return must('git', ['rev-parse', 'HEAD'], appDir).trim()
    },
    remoteUrl: (name = 'origin') => {
      const result = run('git', ['remote', 'get-url', name], appDir)
      return result.status === 0 ? result.stdout.trim() : undefined
    },
    push: () => {
      const branch = must('git', ['rev-parse', '--abbrev-ref', 'HEAD'], appDir).trim()
      must('git', ['push', '--quiet', '--set-upstream', 'origin', branch], appDir)
    },
  }
}

/** GitHub through the user's gh login. Other hosts are 'unknown'. */
export function githubHosting(appDir: string): HostingPort {
  const githubRepo = (url: string) => /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/u.exec(url)?.[1]
  return {
    visibilityOf: (url) => {
      const repo = githubRepo(url)
      if (repo === undefined) return 'unknown'
      let result: { status: number; stdout: string }
      try {
        result = run(
          'gh',
          ['repo', 'view', repo, '--json', 'visibility', '--jq', '.visibility'],
          appDir,
        )
      } catch {
        return 'unknown'
      }
      if (result.status !== 0) return 'unknown'
      const value = result.stdout.trim().toLowerCase()
      return value === 'public'
        ? 'public'
        : value === 'private' || value === 'internal'
          ? 'private'
          : 'unknown'
    },
  }
}
