import { LoaderCircle } from 'lucide-react'

export function LoadingSpinner({
  size = 14,
  className
}: {
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={`loading-spinner${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      <LoaderCircle size={size} className="spin" />
    </span>
  )
}
