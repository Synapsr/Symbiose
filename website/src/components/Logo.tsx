import './Logo.css';

/**
 * The Symbiose mark: two living things that meet. With `animate`, the circles
 * glide together and the core appears, like the app's splash.
 */
export function Logo({ size = 28, animate = false, className = '' }: { size?: number; animate?: boolean; className?: string }) {
  return (
    <svg
      className={`logo${animate ? ' logo--animate' : ''}${className ? ` ${className}` : ''}`}
      viewBox="8 8 84 84"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false">
      <circle className="logo-a" cx="37.5" cy="50" r="27.5" />
      <circle className="logo-b" cx="62.5" cy="50" r="27.5" />
      <circle className="logo-core" cx="50" cy="50" r="13" />
    </svg>
  );
}
