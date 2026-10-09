/**
 * Durable task records (`ctx.tasks`).
 *
 * The idea comes from Pi Durable (see spec 013, "Ideas from Pi Durable"), kept to what Cordis does not already do: every piece of work
 * gets a record with an id, an optional owner (parent), its input, status, result or error, and timestamps. Each change is appended to
 * `<home>/tasks.jsonl` before the call that made it returns, so nothing is presented as done before it is recorded. At startup the log is
 * folded back into records, and a task still `running` is marked `interrupted`: it is reported, never silently run again, because an
 * external side effect may already have happened. Cancelling a task cancels the tasks it owns and aborts their signals.
 */

import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Context, Service } from '@deepseek-ai/cordis'
import type {} from '../instance/index.ts'

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface TaskRecord {
  readonly id: string
  readonly kind: string
  readonly parent?: string
  readonly input: unknown
  readonly status: TaskStatus
  readonly result?: unknown
  readonly error?: string
  /** Free-form progress the owner attached (for example a tool-call trace). */
  readonly detail?: unknown
  readonly createdAt: string
  readonly updatedAt: string
}

/** What the owner of a running task holds. */
export interface TaskHandle {
  readonly id: string
  /** Aborted when the task, or a task that owns it, is cancelled. */
  readonly signal: AbortSignal
  /** Record progress without changing the status. */
  progress(detail: unknown): void
  complete(result: unknown, detail?: unknown): void
  fail(error: unknown, detail?: unknown): void
}

export interface TaskFilter {
  readonly status?: TaskStatus
  readonly parent?: string
  readonly kind?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tasks: Tasks
  }

  interface Events {
    /** A task record changed (after the change was written). */
    'tasks/changed'(record: TaskRecord): void
  }
}

type Change = Partial<TaskRecord> & { readonly id: string }

const FINAL: ReadonlySet<TaskStatus> = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export class Tasks extends Service {
  readonly file: string
  /** Tasks found running at startup and marked interrupted. */
  readonly interrupted: readonly string[]
  private readonly records = new Map<string, TaskRecord>()
  private readonly controllers = new Map<string, AbortController>()

  constructor(ctx: Context) {
    super(ctx, 'tasks')
    this.file = join(ctx.appInstance.home, 'tasks.jsonl')
    this.load()
    const interrupted: string[] = []
    for (const record of this.records.values()) {
      if (record.status === 'running') {
        this.write({
          id: record.id,
          status: 'interrupted',
          error: 'the app stopped while this task was running',
        })
        interrupted.push(record.id)
      }
    }
    this.interrupted = interrupted
    // Work still running when the app stops is cancelled, so its owner's signal fires and the record says what happened.
    ctx.effect(
      () => () => {
        for (const id of [...this.controllers.keys()])
          this.finish(id, { status: 'cancelled', error: 'the app stopped' })
      },
      'tasks: cancel running work',
    )
  }

  /** Start a task. The record is written before this returns. */
  start(kind: string, input: unknown, options: { parent?: string } = {}): TaskHandle {
    if (options.parent !== undefined && !this.records.has(options.parent))
      throw new Error(`tasks: no task "${options.parent}" to own this one`)
    const id = randomUUID()
    const now = new Date().toISOString()
    const controller = new AbortController()
    if (options.parent !== undefined) {
      const parentSignal = this.controllers.get(options.parent)?.signal
      if (parentSignal?.aborted) controller.abort()
    }
    this.controllers.set(id, controller)
    this.write({
      id,
      kind,
      ...(options.parent === undefined ? {} : { parent: options.parent }),
      input,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    })
    return {
      id,
      signal: controller.signal,
      progress: (detail) => {
        if (!this.isRunning(id)) return
        this.write({ id, detail })
      },
      complete: (result, detail) =>
        this.finish(id, {
          status: 'completed',
          result,
          ...(detail === undefined ? {} : { detail }),
        }),
      fail: (error, detail) =>
        this.finish(id, {
          status: 'failed',
          error: message(error),
          ...(detail === undefined ? {} : { detail }),
        }),
    }
  }

  get(id: string): TaskRecord | undefined {
    return this.records.get(id)
  }

  /** Records, newest first. */
  list(filter: TaskFilter = {}): TaskRecord[] {
    return [...this.records.values()]
      .filter(
        (record) =>
          (filter.status === undefined || record.status === filter.status) &&
          (filter.parent === undefined || record.parent === filter.parent) &&
          (filter.kind === undefined || record.kind === filter.kind),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  }

  /** Cancel a running task and every running task it owns, children first. Returns the ids cancelled. */
  cancel(id: string): string[] {
    const cancelled: string[] = []
    const visit = (taskId: string) => {
      for (const child of this.list({ parent: taskId })) visit(child.id)
      if (this.isRunning(taskId)) {
        this.finish(taskId, { status: 'cancelled', error: 'cancelled' })
        cancelled.push(taskId)
      }
    }
    if (!this.records.has(id)) throw new Error(`tasks: no task "${id}"`)
    visit(id)
    return cancelled
  }

  private isRunning(id: string): boolean {
    return this.records.get(id)?.status === 'running'
  }

  private finish(id: string, change: Omit<Change, 'id'>): void {
    if (!this.isRunning(id)) return
    this.write({ id, ...change })
    const controller = this.controllers.get(id)
    this.controllers.delete(id)
    controller?.abort()
  }

  /** Append one change and apply it. The line is on disk before the record changes in memory. */
  private write(change: Change): void {
    const now = new Date().toISOString()
    const line = { updatedAt: now, ...change }
    mkdirSync(join(this.file, '..'), { recursive: true })
    appendFileSync(this.file, `${JSON.stringify(line)}\n`)
    const record = this.apply(line)
    this.ctx.emit('tasks/changed', record)
  }

  private apply(change: Change): TaskRecord {
    const current = this.records.get(change.id)
    const next = { ...(current ?? {}), ...change } as TaskRecord
    if (current && FINAL.has(current.status) && change.status !== undefined) return current
    this.records.set(change.id, next)
    return next
  }

  private load(): void {
    if (!existsSync(this.file)) return
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        this.apply(JSON.parse(line) as Change)
      } catch {
        // A torn last line (the app stopped mid-write) is skipped; every complete line before it still counts.
      }
    }
  }
}

/** The plugin: mount it after `instance`. */
export const tasks = {
  name: 'tasks',
  inject: ['appInstance'],
  apply(ctx: Context) {
    new Tasks(ctx)
  },
}
