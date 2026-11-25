export type AccountExportFormat = 'csv' | 'json' | 'md'

export type AccountExportField =
  | 'site'
  | 'url'
  | 'group'
  | 'username'
  | 'password'
  | 'note'
  | 'otp'
  | 'lastUsedAt'

export interface AccountExportRow {
  site: string
  url: string
  group: string
  username: string
  password: string
  note: string
  otp: string
  lastUsedAt: string
}

export interface AccountExportFieldOption {
  key: AccountExportField
  label: string
  secret?: boolean
}

export const ACCOUNT_EXPORT_FIELDS: AccountExportFieldOption[] = [
  { key: 'site', label: '站点' },
  { key: 'url', label: '登录地址' },
  { key: 'group', label: '分组' },
  { key: 'username', label: '用户名' },
  { key: 'password', label: '密码', secret: true },
  { key: 'otp', label: '两步验证' },
  { key: 'note', label: '备注' },
  { key: 'lastUsedAt', label: '最近使用' }
]

export const DEFAULT_EXPORT_FIELDS: AccountExportField[] = [
  'site',
  'url',
  'group',
  'username',
  'note',
  'lastUsedAt'
]

function cell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function exportRowsToCsv(
  rows: AccountExportRow[],
  fields: AccountExportField[]
): string {
  const header = fields
    .map((field) => ACCOUNT_EXPORT_FIELDS.find((entry) => entry.key === field)?.label ?? field)
    .map(cell)
    .join(',')
  const body = rows.map((row) => fields.map((field) => cell(row[field] ?? '')).join(','))
  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`
}

export function exportRowsToJson(
  rows: AccountExportRow[],
  fields: AccountExportField[]
): string {
  const records = rows.map((row) => {
    const record: Record<string, string> = {}
    for (const field of fields) record[field] = row[field] ?? ''
    return record
  })
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      count: records.length,
      records
    },
    null,
    2
  )}\n`
}

export function exportRowsToMarkdown(
  rows: AccountExportRow[],
  fields: AccountExportField[],
  title = 'AutoLogin 账号导出'
): string {
  const labels = fields.map(
    (field) => ACCOUNT_EXPORT_FIELDS.find((entry) => entry.key === field)?.label ?? field
  )
  const escape = (value: string): string => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  const lines = [
    `# ${title}`,
    '',
    `- 导出时间：${new Date().toISOString()}`,
    `- 条目数：${rows.length}`,
    '',
    `| ${labels.join(' | ')} |`,
    `| ${labels.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (row) => `| ${fields.map((field) => escape(row[field] ?? '')).join(' | ')} |`
    ),
    ''
  ]
  return lines.join('\n')
}

export function filterExportFields(
  fields: AccountExportField[],
  includePasswords: boolean
): AccountExportField[] {
  return includePasswords ? fields : fields.filter((field) => field !== 'password')
}
