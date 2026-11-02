export function passwordStrength(password: string): {
  score: number
  label: string
  hint: string
} {
  let score = 0
  if (password.length >= 10) score += 1
  if (password.length >= 14) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password) && /[^a-zA-Z0-9]/.test(password)) score += 1
  score = Math.min(4, score)
  const labels = ['尚未设置', '偏弱', '可用', '良好', '很强']
  const hints = [
    '至少使用 10 个字符',
    '增加长度，并混合不同字符',
    '再增加长度或符号会更安全',
    '强度足够，请妥善保管',
    '强度很高，请妥善保管'
  ]
  return { score, label: labels[score] ?? labels[0]!, hint: hints[score] ?? hints[0]! }
}

export function PasswordStrength({ password }: { password: string }): React.JSX.Element {
  const strength = passwordStrength(password)
  return (
    <div className="password-strength" aria-live="polite">
      <div className="password-strength__bars">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={index < strength.score ? `is-filled strength-${strength.score}` : ''}
          />
        ))}
      </div>
      <div className="password-strength__copy">
        <strong>{strength.label}</strong>
        <span>{strength.hint}</span>
      </div>
    </div>
  )
}
