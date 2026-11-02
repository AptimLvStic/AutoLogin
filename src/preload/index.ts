import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccountCreateInput,
  AccountUpdateInput,
  AppSettings,
  AutologinApi,
  LoginStartInput,
  LoginViewState,
  SiteInput
} from '@shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    const cleaned = raw
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '')
    throw new Error(cleaned || '操作失败')
  }
}

const api: AutologinApi = {
  vault: {
    status: () => invoke('vault:status'),
    create: (masterPassword) => invoke('vault:create', masterPassword),
    unlock: (masterPassword) => invoke('vault:unlock', masterPassword),
    lock: () => invoke('vault:lock'),
    changePassword: (currentPassword, nextPassword) =>
      invoke('vault:change-password', { currentPassword, nextPassword })
  },
  sites: {
    list: () => invoke('sites:list'),
    save: (input: SiteInput) => invoke('sites:save', input),
    delete: (siteId) => invoke('sites:delete', siteId)
  },
  accounts: {
    list: () => invoke('accounts:list'),
    create: (input: AccountCreateInput) => invoke('accounts:create', input),
    update: (accountId, patch: AccountUpdateInput) =>
      invoke('accounts:update', accountId, patch),
    delete: (accountId) => invoke('accounts:delete', accountId),
    reveal: (accountId) => invoke('accounts:reveal', accountId),
    copyUsername: (accountId) => invoke('accounts:copy-username', accountId),
    copy: (accountId) => invoke('accounts:copy', accountId)
  },
  login: {
    start: (input: LoginStartInput) => invoke('login:start', input),
    close: () => invoke('login:close'),
    retry: () => invoke('login:retry'),
    trustCurrentOrigin: () => invoke('login:trust-origin'),
    focusBrowser: () => invoke('login:focus-browser'),
    finishRecording: () => invoke('login:finish-recording'),
    cancelRecording: () => invoke('login:cancel-recording'),
    clearSession: (accountId) => invoke('login:clear-session', accountId),
    getState: () => invoke('login:get-state')
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (settings: AppSettings) => invoke('settings:update', settings)
  },
  app: {
    getVersion: () => invoke('app:get-version'),
    reportActivity: () => ipcRenderer.send('app:activity'),
    clearAllData: () => invoke('app:clear-all-data'),
    openPrivacy: () => invoke('app:open-privacy')
  },
  events: {
    onVaultLocked: (callback) => subscribe('vault:locked', callback),
    onLoginState: (callback: (state: LoginViewState) => void) =>
      subscribe('login:state', callback)
  }
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('autologin', api)
