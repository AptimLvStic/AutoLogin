import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LoginSessionManager,
  mergePendingRecipes,
  migratePendingRecipeFiles
} from '../../src/main/login-session'
import { appLogPath } from '../../src/main/app-log'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/theme'
import type {
  LoginViewState,
  RecipeStep,
  Site,
  StoredAccount,
  VaultData
} from '../../src/shared/types'
import type { VaultManager } from '../../src/main/vault'

vi.mock('../../src/main/external-browser', () => ({
  ExternalBrowserHost: class ExternalBrowserHost {}
}))

const directories: string[] = []
const NOW = '2026-11-16T00:00:00.000Z'

afterEach(() => {
  vi.useRealTimers()
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

function createRecordingManager(): {
  manager: LoginSessionManager
  data: VaultData
  account: StoredAccount
  site: Site
  directory: string
  vault: {
    requireData: () => VaultData
    save: ReturnType<typeof vi.fn>
    saveAsync: ReturnType<typeof vi.fn>
    getSettings: () => VaultData['settings']
  }
  emittedStates: LoginViewState[]
} {
  const directory = mkdtempSync(join(tmpdir(), 'autologin-recording-'))
  directories.push(directory)
  const site: Site = {
    id: 'site-1',
    tabId: 'local',
    name: '录制站点',
    startUrl: 'https://recording.example/login',
    allowedOrigins: ['https://recording.example'],
    autoSubmit: true,
    createdAt: NOW,
    updatedAt: NOW
  }
  const account: StoredAccount = {
    id: 'account-1',
    tabId: 'local',
    siteId: site.id,
    label: '录制账号',
    username: 'tester@example.test',
    password: 'secret',
    favorite: false,
    loginStrategy: 'auto',
    loginBrowser: 'standalone',
    createdAt: NOW,
    updatedAt: NOW
  }
  const data: VaultData = {
    schemaVersion: 1,
    tabs: [],
    sites: [site],
    accounts: [account],
    groupDefinitions: [],
    deletedAccounts: [],
    favoriteGroups: [],
    settings: structuredClone(DEFAULT_APP_SETTINGS)
  }
  const emittedStates: LoginViewState[] = []
  const vault = {
    requireData: () => data,
    save: vi.fn(),
    saveAsync: vi.fn(async () => undefined),
    getSettings: () => data.settings
  } as unknown as VaultManager
  const manager = new LoginSessionManager(
    vault,
    directory,
    undefined,
    false,
    (state) => emittedStates.push(state)
  )
  const state: LoginViewState = {
    active: true,
    accountId: account.id,
    mode: 'record',
    status: 'authenticated',
    message: '登录成功',
    currentUrl: 'https://recording.example/home',
    currentOrigin: 'https://recording.example',
    pageTitle: '首页',
    isLoading: false,
    originTrusted: true,
    recording: true,
    recipeExists: false,
    recordingStepCount: 1,
    recordingSteps: [
      {
        id: 'step-1',
        type: 'fillUsername',
        selectorLabel: '#username'
      }
    ],
    recordingPaused: false,
    recordingStartedAt: NOW,
    browserName: 'Google Chrome'
  }
  const steps: RecipeStep[] = [
    {
      id: 'step-1',
      type: 'fillUsername',
      selector: { candidates: ['#username'] }
    }
  ]
  Object.assign(manager, {
    account,
    site,
    mode: 'record',
    recordingSteps: steps,
    recordingOrigins: new Set(['https://recording.example']),
    recordedStepKeys: new Set(['username']),
    state
  })
  return {
    manager,
    data,
    account,
    site,
    directory,
    vault: vault as unknown as {
      requireData: () => VaultData
      save: ReturnType<typeof vi.fn>
      saveAsync: ReturnType<typeof vi.fn>
      getSettings: () => VaultData['settings']
    },
    emittedStates
  }
}

describe('login recording completion', () => {
  it('saves captured steps after the browser page has closed', async () => {
    const { manager, data, account, vault, directory } = createRecordingManager()

    const result = await manager.finishRecording()

    expect(result.saved).toBe(true)
    expect(result.recipe?.successCheck).toEqual({
      urlPrefix: 'https://recording.example/home'
    })
    expect(account.recipes).toHaveLength(1)
    expect(account.recipes?.[0]?.recipe.steps).toHaveLength(1)
    expect(data.accounts[0]?.activeRecipeId).toBe(account.recipes?.[0]?.id)
    expect(vault.saveAsync).toHaveBeenCalledWith({ tabIds: ['local'] })
    expect(readdirSync(join(directory, 'pending-recipes'))).toEqual([])
    expect(manager.getState()).toMatchObject({
      recording: false,
      recordingStepCount: 0
    })
    await vi.waitFor(() =>
      expect(manager.getState()).toMatchObject({
        active: false,
        status: 'idle'
      })
    )
  })

  it('writes a recoverable draft before waiting for the final page inspection', async () => {
    const { manager, directory } = createRecordingManager()
    const never = new Promise<never>(() => undefined)
    Object.assign(manager, {
      browser: {
        getSnapshot: () => ({
          url: 'https://recording.example/home',
          title: '首页',
          loading: false
        }),
        runAgentCommand: vi.fn(() => never),
        close: vi.fn(async () => undefined)
      }
    })
    vi.useFakeTimers()

    const pending = manager.finishRecording('前置副本')

    expect(readdirSync(join(directory, 'pending-recipes'))).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(2_600)
    await expect(pending).resolves.toMatchObject({ saved: true })
  })

  it('reuses a completed save when the renderer retries the same flow', async () => {
    const { manager, vault } = createRecordingManager()

    const first = await manager.finishRecording('幂等保存')
    expect(vault.saveAsync).toHaveBeenCalledOnce()
    expect(manager.getRecordingSaveStatus()).toMatchObject({
      state: 'saved',
      result: { recipeId: first.recipeId, saved: true }
    })
    await vi.waitFor(() =>
      expect(manager.getState()).toMatchObject({ active: false, status: 'idle' })
    )

    vault.saveAsync.mockClear()
    const retried = await manager.finishRecording('幂等保存')

    expect(retried).toEqual(first)
    expect(vault.saveAsync).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent save requests and reports the in-flight state', async () => {
    const { manager, vault } = createRecordingManager()
    let releaseSave: (() => void) | undefined
    const pendingSave = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    vault.saveAsync.mockImplementationOnce(() => pendingSave)

    const first = manager.finishRecording('并发保存')
    const second = manager.finishRecording('并发保存')

    expect(manager.getRecordingSaveStatus()).toMatchObject({
      state: 'saving',
      stage: '写入保险库（同步快照与备份）'
    })
    expect(vault.saveAsync).toHaveBeenCalledOnce()
    releaseSave?.()
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(secondResult).toEqual(firstResult)
    expect(vault.saveAsync).toHaveBeenCalledOnce()
    expect(manager.getRecordingSaveStatus()).toMatchObject({
      state: 'saved',
      stage: '写入完成',
      result: { recipeId: firstResult.recipeId }
    })
  })

  it('uses a requested name and keeps pasted credentials out of the recipe', async () => {
    const { manager } = createRecordingManager()
    const recordAction = (
      manager as unknown as {
        recordAction: (step: unknown) => void
      }
    ).recordAction.bind(manager)
    recordAction({
      id: 'paste-1',
      type: 'paste',
      selector: { candidates: ['#password'] },
      source: 'password',
      value: 'secret'
    })

    const result = await manager.finishRecording('生产环境登录')

    expect(result.saved).toBe(true)
    expect(result.recipe?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'paste',
          source: 'password'
        })
      ])
    )
    expect(JSON.stringify(result.recipe)).not.toContain('"value"')
    expect(JSON.stringify(result.recipe)).not.toContain('"secret"')
    expect(result.recipe?.steps.at(-1)?.id).toBe('paste-1')
  })

  it('saves captured steps when the final page inspection does not return', async () => {
    const { manager, account } = createRecordingManager()
    const never = new Promise<never>(() => undefined)
    const close = vi.fn(async () => undefined)
    Object.assign(manager, {
      browser: {
        getSnapshot: () => ({
          url: 'https://recording.example/home',
          title: '首页',
          loading: false
        }),
        runAgentCommand: vi.fn(() => never),
        close
      }
    })
    vi.useFakeTimers()

    const pending = manager.finishRecording('超时后保存')
    await vi.advanceTimersByTimeAsync(2_600)
    const result = await pending

    expect(result.saved).toBe(true)
    expect(account.recipes).toHaveLength(1)
    expect(account.recipes?.[0]?.name).toBe('超时后保存')
    expect(close).toHaveBeenCalledOnce()
  })

  it('returns saved before browser cleanup finishes', async () => {
    const { manager, account } = createRecordingManager()
    const never = new Promise<never>(() => undefined)
    const runAgentCommand = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementation(() => never)
    const close = vi.fn(() => never)
    Object.assign(manager, {
      browser: {
        getSnapshot: () => ({
          url: 'https://recording.example/home',
          title: '首页',
          loading: false
        }),
        runAgentCommand,
        close
      }
    })
    vi.useFakeTimers()

    const result = await manager.finishRecording('后台收尾')

    expect(result.saved).toBe(true)
    expect(account.recipes?.[0]?.name).toBe('后台收尾')
    expect(manager.getState()).toMatchObject({
      recording: false,
      status: 'authenticated',
      message: '录制流程已保存'
    })
    expect(close).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(4_000)
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects a duplicate recorded flow name', async () => {
    const { manager, account } = createRecordingManager()
    account.recipes = [
      {
        id: 'recipe-existing',
        name: '生产环境登录',
        recipe: {
          version: 1,
          startUrl: 'https://recording.example/login',
          allowedOrigins: ['https://recording.example'],
          steps: [],
          createdAt: NOW,
          updatedAt: NOW
        }
      }
    ]

    await expect(manager.finishRecording('生产环境登录')).rejects.toThrow(
      '录制流程名称已存在'
    )
  })

  it('keeps the account unchanged and returns a safe draft when the vault write fails', async () => {
    const { manager, account, vault, emittedStates, directory } =
      createRecordingManager()
    const previousRecipes = account.recipes
    vault.saveAsync.mockRejectedValueOnce(new Error('磁盘空间不足'))

    const result = await manager.finishRecording('保存失败测试')

    expect(result).toMatchObject({ saved: false, draftSaved: true })
    expect(account.recipes).toEqual(previousRecipes)
    expect(emittedStates.map((state) => state.message)).toEqual(
      expect.arrayContaining([
        '正在整理录制步骤…',
        '正在写入录制流程…',
        '保险库暂时未写入，录制草稿已保存；重启后会自动恢复'
      ])
    )
    expect(readFileSync(appLogPath(directory), 'utf8')).toContain(
      '阶段：写入录制流程；原因：磁盘空间不足'
    )
    expect(manager.getRecordingSaveStatus()).toMatchObject({
      state: 'draft_saved',
      stage: '草稿已落盘',
      result: { saved: false, draftSaved: true }
    })
    expect(readdirSync(join(directory, 'pending-recipes'))).toEqual([
      expect.stringMatching(/\.json$/)
    ])
  })

  it('writes and clears drafts in a configured directory', async () => {
    const { manager, directory, data, vault } = createRecordingManager()
    const customDirectory = mkdtempSync(join(tmpdir(), 'autologin-recording-custom-'))
    directories.push(customDirectory)
    data.settings.recordingDraftDirectory = customDirectory
    vault.saveAsync.mockRejectedValueOnce(new Error('保存暂时失败'))

    const result = await manager.finishRecording('自定义副本目录')

    expect(result).toMatchObject({ saved: false, draftSaved: true })
    expect(readdirSync(customDirectory)).toEqual([
      expect.stringMatching(/\.json$/)
    ])
    expect(existsSync(join(directory, 'pending-recipes'))).toBe(false)
  })

  it('appends each captured step to the configured live draft before saving', () => {
    const { manager, directory, data, account, site } = createRecordingManager()
    const customDirectory = mkdtempSync(join(tmpdir(), 'autologin-recording-live-'))
    directories.push(customDirectory)
    data.settings.recordingDraftDirectory = customDirectory
    const recording = manager as unknown as {
      openDraftSession: (accountId: string, siteId: string, startUrl: string) => void
      recordAction: (step: unknown) => void
    }

    recording.openDraftSession(account.id, site.id, site.startUrl)
    recording.recordAction({
      id: 'live-password',
      type: 'fillPassword',
      selector: { candidates: ['#password'] }
    })

    const entries = readdirSync(customDirectory)
    expect(entries).toEqual([expect.stringMatching(/\.jsonl$/)])
    const draft = readFileSync(join(customDirectory, entries[0]!), 'utf8')
    expect(draft).toContain('"kind":"header"')
    expect(draft).toContain('"kind":"step"')
    expect(draft).toContain('"id":"live-password"')
    expect(existsSync(join(directory, 'pending-recipes'))).toBe(false)
  })

  it('keeps only one recoverable copy when the final json is safe', async () => {
    const { manager, directory, account, site, vault } = createRecordingManager()
    const recording = manager as unknown as {
      openDraftSession: (accountId: string, siteId: string, startUrl: string) => void
      appendDraftStep: (step: RecipeStep) => void
    }
    recording.openDraftSession(account.id, site.id, site.startUrl)
    recording.appendDraftStep({
      id: 'persisted-step',
      type: 'fillUsername',
      selector: { candidates: ['#username'] }
    })
    vault.saveAsync.mockRejectedValueOnce(new Error('保险库被占用'))

    const result = await manager.finishRecording('单副本兜底')

    expect(result).toMatchObject({ saved: false, draftSaved: true })
    expect(readdirSync(join(directory, 'pending-recipes'))).toEqual([
      expect.stringMatching(/\.json$/)
    ])
  })

  it('keeps the complete jsonl when the final json cannot be written', async () => {
    const { manager, directory, account, site, vault } = createRecordingManager()
    const recording = manager as unknown as {
      openDraftSession: (accountId: string, siteId: string, startUrl: string) => void
      appendDraftStep: (step: RecipeStep) => void
      writePendingRecipe: () => boolean
    }
    recording.openDraftSession(account.id, site.id, site.startUrl)
    recording.appendDraftStep({
      id: 'draft-only-step',
      type: 'fillUsername',
      selector: { candidates: ['#username'] }
    })
    vi.spyOn(
      manager as unknown as { writePendingRecipe: () => boolean },
      'writePendingRecipe'
    ).mockReturnValue(false)
    vault.saveAsync.mockRejectedValueOnce(new Error('保险库写入失败'))

    const result = await manager.finishRecording('仅草稿可用')

    expect(result).toMatchObject({ saved: false, draftSaved: true })
    expect(readdirSync(join(directory, 'pending-recipes'))).toEqual([
      expect.stringMatching(/\.jsonl$/)
    ])
  })

  it('recovers a jsonl draft without activating it and collapses a pasted credential', async () => {
    const { directory, account, vault } = createRecordingManager()
    const pendingDirectory = join(directory, 'pending-recipes')
    const draftFile = join(pendingDirectory, 'recover-me.jsonl')
    mkdirSync(pendingDirectory, { recursive: true })
    writeFileSync(
      draftFile,
      [
        JSON.stringify({
          kind: 'header',
          accountId: account.id,
          siteId: account.siteId,
          startUrl: 'https://recording.example/login'
        }),
        JSON.stringify({
          kind: 'step',
          step: {
            id: 'fill-password',
            type: 'fillPassword',
            selector: { candidates: ['#password'] }
          },
          url: 'https://recording.example/login'
        }),
        JSON.stringify({
          kind: 'step',
          step: {
            id: 'paste-password',
            type: 'paste',
            selector: { candidates: ['#password'] },
            source: 'password'
          },
          url: 'https://recording.example/login'
        })
      ].join('\n') + '\n',
      'utf8'
    )

    const merged = await mergePendingRecipes(
      directory,
      vault as unknown as VaultManager
    )

    expect(merged).toBe(1)
    expect(account.recipes).toHaveLength(1)
    expect(account.recipes?.[0]?.name).toBe('录制流程 1（恢复）')
    expect(account.recipes?.[0]?.recipe.steps).toEqual([
      expect.objectContaining({ type: 'paste', id: 'paste-password' })
    ])
    expect(account.activeRecipeId).toBeUndefined()
    expect(existsSync(draftFile)).toBe(false)
  })

  it('replays undo events when recovering a jsonl draft', async () => {
    const { directory, account, vault } = createRecordingManager()
    const pendingDirectory = join(directory, 'pending-recipes')
    const draftFile = join(pendingDirectory, 'undo-me.jsonl')
    mkdirSync(pendingDirectory, { recursive: true })
    writeFileSync(
      draftFile,
      [
        JSON.stringify({
          kind: 'header',
          accountId: account.id,
          siteId: account.siteId,
          startUrl: 'https://recording.example/login'
        }),
        JSON.stringify({
          kind: 'step',
          step: {
            id: 'first-step',
            type: 'fillUsername',
            selector: { candidates: ['#username'] }
          }
        }),
        JSON.stringify({
          kind: 'step',
          step: {
            id: 'undone-step',
            type: 'fillPassword',
            selector: { candidates: ['#password'] }
          }
        }),
        JSON.stringify({ kind: 'undo' })
      ].join('\n') + '\n',
      'utf8'
    )

    const merged = await mergePendingRecipes(
      directory,
      vault as unknown as VaultManager
    )

    expect(merged).toBe(1)
    expect(account.recipes?.[0]?.recipe.steps).toEqual([
      expect.objectContaining({ type: 'fillUsername', id: 'first-step' })
    ])
  })

  it('keeps a draft file when the account already has three flows', async () => {
    const { directory, account, vault } = createRecordingManager()
    const pendingDirectory = join(directory, 'pending-recipes')
    const draftFile = join(pendingDirectory, 'too-many.jsonl')
    account.recipes = Array.from({ length: 3 }, (_, index) => ({
      id: `recipe-${index}`,
      name: `流程 ${index + 1}`,
      recipe: {
        version: 1 as const,
        startUrl: 'https://recording.example/login',
        allowedOrigins: ['https://recording.example'],
        steps: [],
        createdAt: NOW,
        updatedAt: NOW
      }
    }))
    mkdirSync(pendingDirectory, { recursive: true })
    writeFileSync(
      draftFile,
      [
        JSON.stringify({
          kind: 'header',
          accountId: account.id,
          siteId: account.siteId,
          startUrl: 'https://recording.example/login'
        }),
        JSON.stringify({
          kind: 'step',
          step: {
            id: 'overflow-step',
            type: 'fillUsername',
            selector: { candidates: ['#username'] }
          }
        })
      ].join('\n') + '\n',
      'utf8'
    )

    const merged = await mergePendingRecipes(
      directory,
      vault as unknown as VaultManager
    )

    expect(merged).toBe(0)
    expect(existsSync(draftFile)).toBe(true)
    expect(vault.saveAsync).not.toHaveBeenCalled()
  })

  it('moves existing drafts when the configured directory changes', () => {
    const { directory, account } = createRecordingManager()
    const defaultDirectory = join(directory, 'pending-recipes')
    const customDirectory = mkdtempSync(join(tmpdir(), 'autologin-recording-move-'))
    directories.push(customDirectory)
    mkdirSync(defaultDirectory, { recursive: true })
    const source = join(defaultDirectory, 'draft-to-move.json')
    writeFileSync(
      source,
      JSON.stringify({
        accountId: account.id,
        siteId: account.siteId,
        recipeId: 'draft-to-move',
        name: '迁移中的副本',
        recipe: {
          version: 1,
          startUrl: 'https://recording.example/login',
          allowedOrigins: ['https://recording.example'],
          steps: [],
          createdAt: NOW,
          updatedAt: NOW
        },
        createdAt: NOW
      }),
      'utf8'
    )

    expect(migratePendingRecipeFiles(defaultDirectory, customDirectory)).toBe(1)
    expect(existsSync(join(customDirectory, 'draft-to-move.json'))).toBe(true)
    expect(existsSync(source)).toBe(false)
  })

  it('merges a pending recording into the vault and removes the fallback file', async () => {
    const { directory, account, vault } = createRecordingManager()
    const pendingDirectory = join(directory, 'pending-recipes')
    const pendingFile = join(pendingDirectory, 'recipe-pending.json')
    mkdirSync(pendingDirectory, { recursive: true })
    writeFileSync(
      pendingFile,
      JSON.stringify({
        accountId: account.id,
        siteId: account.siteId,
        recipeId: 'recipe-pending',
        name: '崩溃前保存的流程',
        recipe: {
          version: 1,
          startUrl: 'https://recording.example/login',
          allowedOrigins: ['https://recording.example'],
          steps: [
            {
              id: 'pending-step',
              type: 'fillUsername',
              selector: { candidates: ['#username'] }
            }
          ],
          createdAt: NOW,
          updatedAt: NOW
        },
        createdAt: NOW
      }),
      'utf8'
    )

    const merged = await mergePendingRecipes(
      directory,
      vault as unknown as VaultManager
    )

    expect(merged).toBe(1)
    expect(account.recipes).toEqual([
      expect.objectContaining({
        id: 'recipe-pending',
        name: '崩溃前保存的流程'
      })
    ])
    expect(account.activeRecipeId).toBe('recipe-pending')
    expect(vault.saveAsync).toHaveBeenCalledWith({ tabIds: ['local'] })
    expect(existsSync(pendingFile)).toBe(false)
  })

  it('merges pending files from a configured directory', async () => {
    const { directory, account, vault } = createRecordingManager()
    const customDirectory = mkdtempSync(join(tmpdir(), 'autologin-recording-merge-'))
    directories.push(customDirectory)
    const pendingFile = join(customDirectory, 'recipe-custom.json')
    writeFileSync(
      pendingFile,
      JSON.stringify({
        accountId: account.id,
        siteId: account.siteId,
        recipeId: 'recipe-custom',
        name: '自定义目录副本',
        recipe: {
          version: 1,
          startUrl: 'https://recording.example/login',
          allowedOrigins: ['https://recording.example'],
          steps: [],
          createdAt: NOW,
          updatedAt: NOW
        },
        createdAt: NOW
      }),
      'utf8'
    )

    const merged = await mergePendingRecipes(
      directory,
      vault as unknown as VaultManager,
      customDirectory
    )

    expect(merged).toBe(1)
    expect(account.recipes?.[0]?.id).toBe('recipe-custom')
    expect(existsSync(pendingFile)).toBe(false)
  })

  it('pauses, resumes and undoes captured steps', async () => {
    const { manager } = createRecordingManager()

    expect((await manager.pauseRecording()).recordingPaused).toBe(true)
    expect((await manager.resumeRecording()).recordingPaused).toBe(false)
    expect((await manager.undoRecordingStep()).recordingStepCount).toBe(0)
  })

  it('updates pause state immediately when the browser command does not respond', async () => {
    const { manager } = createRecordingManager()
    const never = new Promise<never>(() => undefined)
    Object.assign(manager, {
      browser: {
        runAgentCommand: vi.fn(() => never)
      }
    })
    vi.useFakeTimers()

    await expect(manager.pauseRecording()).resolves.toMatchObject({
      recordingPaused: true
    })
    await expect(manager.resumeRecording()).resolves.toMatchObject({
      recordingPaused: false
    })

    await vi.advanceTimersByTimeAsync(1_000)
  })

  it('updates undo state immediately when the browser command does not respond', async () => {
    const { manager } = createRecordingManager()
    const never = new Promise<never>(() => undefined)
    Object.assign(manager, {
      browser: {
        runAgentCommand: vi.fn(() => never)
      }
    })
    vi.useFakeTimers()

    await expect(manager.undoRecordingStep()).resolves.toMatchObject({
      recordingStepCount: 0
    })

    await vi.advanceTimersByTimeAsync(1_000)
  })
})
