import type { ToastAction } from './components/Toast'

type Translate = (zh: string, en: string, tw: string) => string

/** 「打开文件 / 打开文件夹」两个动作，用于导出成功后的提示。 */
export function fileToastActions(
  tr: Translate,
  filePath?: string
): ToastAction[] | undefined {
  if (!filePath) return undefined
  return [
    {
      label: tr('打开文件', 'Open file', '開啟檔案'),
      onClick: () => {
        void window.autologin.data.openExportPath(filePath)
      }
    },
    {
      label: tr('打开文件夹', 'Show in folder', '開啟資料夾'),
      onClick: () => {
        void window.autologin.data.revealExportPath(filePath)
      }
    }
  ]
}
