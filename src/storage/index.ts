import type { StudyRepository, StorageKind } from './types'
import { WebIndexedDbRepository } from './indexeddb'

/** 平台检测只允许出现在这里与入口适配层，不允许散落在业务代码里。 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export interface RepositoryHandle {
  repo: StudyRepository
  kind: StorageKind
}

export async function createRepository(): Promise<RepositoryHandle> {
  if (isTauri()) {
    const { TauriSqliteRepository } = await import('./sqlite')
    const repo = new TauriSqliteRepository()
    return { repo, kind: 'sqlite' }
  }
  const repo = new WebIndexedDbRepository()
  return { repo, kind: 'indexeddb' }
}
