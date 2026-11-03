import { useI18n } from '../i18n'

export function passwordStrength(password: string): number {
  let score = 0
  if (password.length >= 10) score += 1
  if (password.length >= 14) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password) && /[^a-zA-Z0-9]/.test(password)) score += 1
  return Math.min(4, score)
}

export function PasswordStrength({ password }: { password: string }): React.JSX.Element {
  const { tr } = useI18n()
  const score = passwordStrength(password)
  const labels = [
    tr('尚未设置', 'Not set', '尚未設定'),
    tr('偏弱', 'Weak', '偏弱'),
    tr('可用', 'Fair', '可用'),
    tr('良好', 'Good', '良好'),
    tr('很强', 'Strong', '很強')
  ]
  const hints = [
    tr('至少使用 10 个字符', 'Use at least 10 characters.', '至少使用 10 個字元'),
    tr('增加长度，并混合不同字符', 'Add length and mix different character types.', '增加長度，並混合不同字元類型'),
    tr('再增加长度或符号会更安全', 'A little more length or a symbol would help.', '再增加長度或符號會更安全'),
    tr('强度足够，请妥善保管', 'Strong enough. Keep it safe.', '強度足夠，請妥善保管'),
    tr('强度很高，请妥善保管', 'Very strong. Keep it safe.', '強度很高，請妥善保管')
  ]
  return (
    <div className="password-strength" aria-live="polite">
      <div className="password-strength__bars">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={index < score ? `is-filled strength-${score}` : ''}
          />
        ))}
      </div>
      <div className="password-strength__copy">
        <strong>{labels[score] ?? labels[0]}</strong>
        <span>{hints[score] ?? hints[0]}</span>
      </div>
    </div>
  )
}
