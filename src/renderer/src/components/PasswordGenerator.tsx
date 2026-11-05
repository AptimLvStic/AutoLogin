import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Sparkles,
  X
} from 'lucide-react'
import {
  DEFAULT_PASSWORD_GENERATOR_OPTIONS,
  PASSWORD_GENERATOR_MAX_LENGTH,
  PASSWORD_GENERATOR_MIN_LENGTH,
  generatePassword,
  passwordGeneratorEntropy,
  passwordGeneratorStrength,
  type PasswordGeneratorOptions
} from '@shared/password-generator'
import { useI18n } from '../i18n'

const OPTIONS_STORAGE_KEY = 'autologin.passwordGenerator.options'
const COMPACT_POPOVER_WIDTH = 332

function readOptions(): PasswordGeneratorOptions {
  try {
    const stored = window.localStorage.getItem(OPTIONS_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_PASSWORD_GENERATOR_OPTIONS }
    const value = JSON.parse(stored) as Partial<PasswordGeneratorOptions>
    const options = {
      ...DEFAULT_PASSWORD_GENERATOR_OPTIONS,
      ...value,
      length:
        typeof value.length === 'number'
          ? Math.max(
              PASSWORD_GENERATOR_MIN_LENGTH,
              Math.min(PASSWORD_GENERATOR_MAX_LENGTH, Math.round(value.length))
            )
          : DEFAULT_PASSWORD_GENERATOR_OPTIONS.length
    }
    if (!options.uppercase && !options.lowercase && !options.numbers && !options.symbols) {
      options.lowercase = true
    }
    return options
  } catch {
    return { ...DEFAULT_PASSWORD_GENERATOR_OPTIONS }
  }
}

export function PasswordGenerator({
  compact = false,
  onApply,
  onClose,
  notify
}: {
  compact?: boolean
  onApply?: (password: string) => void
  onClose?: () => void
  notify?: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const { tr } = useI18n()
  const [options, setOptions] = useState<PasswordGeneratorOptions>(readOptions)
  const [password, setPassword] = useState(() => generatePassword(readOptions()))
  const [revealed, setRevealed] = useState(!compact)
  const strength = useMemo(() => passwordGeneratorStrength(options), [options])
  const entropy = useMemo(() => passwordGeneratorEntropy(options), [options])
  const strengthLabel =
    strength === 'strong'
      ? tr('强', 'Strong', '強')
      : strength === 'good'
        ? tr('良好', 'Good', '良好')
        : tr('较弱', 'Weak', '較弱')

  useEffect(() => {
    window.localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(options))
  }, [options])

  useEffect(() => {
    setPassword(generatePassword(options))
  }, [options])

  function regenerate(): void {
    setPassword(generatePassword(options))
  }

  async function copyPassword(): Promise<void> {
    try {
      await navigator.clipboard.writeText(password)
      notify?.('success', tr('密码已复制', 'Password copied', '密碼已複製'))
    } catch {
      notify?.('error', tr('复制密码失败', 'Could not copy password', '複製密碼失敗'))
    }
  }

  function patchOptions(patch: Partial<PasswordGeneratorOptions>): void {
    setOptions((current) => ({ ...current, ...patch }))
  }

  const characterTypes = [
    ['uppercase', 'A-Z', tr('大写字母', 'Uppercase letters', '大寫字母')],
    ['lowercase', 'a-z', tr('小写字母', 'Lowercase letters', '小寫字母')],
    ['numbers', '0-9', tr('数字', 'Numbers', '數字')],
    ['symbols', '#$&', tr('符号', 'Symbols', '符號')]
  ] as const

  return (
    <section
      className={`password-generator${compact ? ' password-generator--compact' : ''}`}
      aria-label={tr('随机密码生成器', 'Random password generator', '隨機密碼產生器')}
    >
      <header className="password-generator__header">
        <div>
          <span className="eyebrow">SECURE RANDOM</span>
          <h2>{tr('密码生成器', 'Password generator', '密碼產生器')}</h2>
          {!compact && (
            <p>
              {tr(
                '在本地使用系统安全随机源生成强密码，不会上传或记录生成结果。',
                'Generate strong passwords locally with the system secure random source. Results are never uploaded or logged.',
                '在本機使用系統安全隨機來源產生強密碼，不會上傳或記錄產生結果。'
              )}
            </p>
          )}
        </div>
        {compact ? (
          onClose && (
            <button
              type="button"
              className="icon-button icon-button--small"
              onClick={onClose}
              aria-label={tr('关闭密码生成器', 'Close password generator', '關閉密碼產生器')}
            >
              <X size={15} />
            </button>
          )
        ) : (
          <span className="password-generator__mark" aria-hidden="true">
            <Sparkles size={20} />
          </span>
        )}
      </header>

      <div className="password-generator__preview">
        <code>{revealed ? password : '•'.repeat(Math.min(password.length, 38))}</code>
        <button
          type="button"
          className="password-generator__icon-button"
          onClick={() => setRevealed((current) => !current)}
          aria-label={revealed ? tr('隐藏密码', 'Hide password', '隱藏密碼') : tr('显示密码', 'Show password', '顯示密碼')}
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button
          type="button"
          className="password-generator__icon-button"
          onClick={regenerate}
          aria-label={tr('重新生成', 'Generate again', '重新產生')}
          title={tr('重新生成', 'Generate again', '重新產生')}
        >
          <RefreshCw size={16} />
        </button>
        <button
          type="button"
          className="password-generator__icon-button"
          onClick={() => void copyPassword()}
          aria-label={tr('复制密码', 'Copy password', '複製密碼')}
          title={tr('复制密码', 'Copy password', '複製密碼')}
        >
          <Copy size={16} />
        </button>
      </div>

      <div className={`password-generator__strength is-${strength}`}>
        <span>
          {tr('密码强度', 'Strength', '密碼強度')}：<strong>{strengthLabel}</strong>
        </span>
        <span>
          {tr('字符', 'Characters', '字元')} {options.length}
        </span>
        <span>
          {tr('熵', 'Entropy', '熵')} {entropy} bit
        </span>
        <div aria-hidden="true">
          <span />
        </div>
      </div>

      <label className="password-generator__length">
        <span>{tr('长度', 'Length', '長度')}</span>
        <input
          type="range"
          min={PASSWORD_GENERATOR_MIN_LENGTH}
          max={PASSWORD_GENERATOR_MAX_LENGTH}
          value={options.length}
          onChange={(event) => patchOptions({ length: Number(event.target.value) })}
        />
        <input
          type="number"
          min={PASSWORD_GENERATOR_MIN_LENGTH}
          max={PASSWORD_GENERATOR_MAX_LENGTH}
          value={options.length}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value)) {
              patchOptions({
                length: Math.max(
                  PASSWORD_GENERATOR_MIN_LENGTH,
                  Math.min(PASSWORD_GENERATOR_MAX_LENGTH, Math.round(value))
                )
              })
            }
          }}
          aria-label={tr('密码长度', 'Password length', '密碼長度')}
        />
      </label>

      <div className="password-generator__types" role="group" aria-label={tr('字符类型', 'Character types', '字元類型')}>
        {characterTypes.map(([key, sample, label]) => {
          const checked = options[key]
          return (
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              className={checked ? 'is-active' : ''}
              key={key}
              onClick={() => {
                const enabledCount = characterTypes.filter(
                  ([type]) => options[type]
                ).length
                if (checked && enabledCount === 1) return
                patchOptions({ [key]: !checked })
              }}
              title={label}
            >
              <span>{sample}</span>
              <small>{label}</small>
              <span className="password-generator__check" aria-hidden="true">
                {checked && <Check size={11} />}
              </span>
            </button>
          )
        })}
      </div>

      <label className="password-generator__exclude">
        <input
          type="checkbox"
          checked={options.excludeSimilar}
          onChange={(event) => patchOptions({ excludeSimilar: event.target.checked })}
        />
        <span>
          {tr(
            '排除易混淆字符（I、l、1、O、0、o）',
            'Exclude look-alike characters (I, l, 1, O, 0, o)',
            '排除易混淆字元（I、l、1、O、0、o）'
          )}
        </span>
      </label>

      {compact && (
        <footer className="password-generator__footer">
          <button type="button" className="button button--ghost" onClick={onClose}>
            {tr('取消', 'Cancel', '取消')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => onApply?.(password)}
          >
            {tr('使用此密码', 'Use this password', '使用此密碼')}
          </button>
        </footer>
      )}
    </section>
  )
}

export function PasswordGeneratorPopover({
  onApply,
  notify
}: {
  onApply: (password: string) => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const { tr } = useI18n()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const reposition = (): void => {
      const anchor = triggerRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(COMPACT_POPOVER_WIDTH, window.innerWidth - 24)
      const estimatedHeight = 372
      setPosition({
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top:
          rect.bottom + estimatedHeight + 10 <= window.innerHeight
            ? rect.bottom + 8
            : Math.max(12, rect.top - estimatedHeight - 8)
      })
    }
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        (popoverRef.current?.contains(event.target) ||
          triggerRef.current?.contains(event.target))
      ) {
        return
      }
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    reposition()
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`input-action password-generator-trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-label={tr('随机密码生成器', 'Random password generator', '隨機密碼產生器')}
        title={tr('随机密码生成器', 'Random password generator', '隨機密碼產生器')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Sparkles size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="password-generator-popover"
            role="dialog"
            aria-modal="false"
            aria-label={tr('随机密码生成器', 'Random password generator', '隨機密碼產生器')}
            style={position}
          >
            <PasswordGenerator
              compact
              notify={notify}
              onClose={() => setOpen(false)}
              onApply={(value) => {
                onApply(value)
                setOpen(false)
              }}
            />
          </div>,
          document.body
        )}
    </>
  )
}
