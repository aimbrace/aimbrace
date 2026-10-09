/**
 * Save the app to its own repository: commit, and push when it has a remote. Extracted from ACRYL (`runtime/app-persistence`), as a
 * use case over two ports (Clean Architecture): git and the hosting service. Two guards run before anything is committed:
 *
 * - a private app (anything but an explicit `visibility: public` in aimbrace.yaml) never goes to a remote the host says is public;
 * - a staged file that looks like it holds a secret stops the save, and everything is unstaged again.
 */
import { parse } from 'yaml'
import { findSecrets, type SecretFinding } from './secrets.ts'

export type Visibility = 'private' | 'public'

export interface GitPort {
  isRepository(): boolean
  init(): void
  /** Stage every change (the app's .gitignore keeps runtime data out). */
  stageAll(): void
  /** Paths staged for the next commit (added or modified; deletions excluded). */
  stagedFiles(): string[]
  /** The staged content of one file, or undefined for a binary file. */
  stagedText(path: string): string | undefined
  unstageAll(): void
  hasStagedChanges(): boolean
  commit(message: string): string
  remoteUrl(name?: string): string | undefined
  push(): void
}

export interface HostingPort {
  /** Whether a remote is public, private, or unknown (a host the adapter cannot ask). */
  visibilityOf(remoteUrl: string): Visibility | 'unknown'
}

export type SaveResult =
  | {
      readonly status: 'saved'
      readonly commit: string
      readonly pushed: boolean
      readonly remote?: string
    }
  | { readonly status: 'nothing-to-save' }
  | {
      readonly status: 'refused'
      readonly reason: string
      readonly secrets?: readonly SecretFinding[]
    }

/** Anything but an explicit `public` is private: a missing or mistyped value must never make work public. */
export function visibilityOf(manifestText: string): Visibility {
  const document = parse(manifestText) as { metadata?: { visibility?: unknown } } | null
  return document?.metadata?.visibility === 'public' ? 'public' : 'private'
}

export function saveApp(
  input: { readonly manifestText: string; readonly message: string },
  git: GitPort,
  hosting: HostingPort,
): SaveResult {
  const visibility = visibilityOf(input.manifestText)
  const remote = git.remoteUrl()
  if (
    remote !== undefined &&
    visibility === 'private' &&
    hosting.visibilityOf(remote) === 'public'
  ) {
    return {
      status: 'refused',
      reason: `this app is private (aimbrace.yaml metadata.visibility) but its remote ${remote} is public. Make the remote private, or set visibility: public if you mean to open it.`,
    }
  }
  if (!git.isRepository()) git.init()
  git.stageAll()
  if (!git.hasStagedChanges()) return { status: 'nothing-to-save' }
  const files = git.stagedFiles().flatMap((path) => {
    const text = git.stagedText(path)
    return text === undefined ? [] : [{ path, text }]
  })
  const secrets = findSecrets(files)
  if (secrets.length > 0) {
    git.unstageAll()
    return {
      status: 'refused',
      reason:
        "these files contain what looks like a secret; nothing was saved. Move the value out of the app (a key belongs in the app's settings, which are not committed).",
      secrets,
    }
  }
  const commit = git.commit(input.message)
  if (remote === undefined) return { status: 'saved', commit, pushed: false }
  git.push()
  return { status: 'saved', commit, pushed: true, remote }
}
