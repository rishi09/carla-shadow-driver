import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'human' | 'ai' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-gradient-to-r from-accent to-accent-light text-dark-400 font-semibold
    hover:from-accent-light hover:to-accent
    shadow-lg shadow-accent/20 hover:shadow-accent/40
    focus:ring-accent
  `,
  human: `
    bg-gradient-to-r from-human to-human-light text-white font-semibold
    hover:from-human-light hover:to-human
    shadow-lg shadow-human/20 hover:shadow-human/40
    focus:ring-human
  `,
  ai: `
    bg-gradient-to-r from-ai to-ai-light text-white font-semibold
    hover:from-ai-light hover:to-ai
    shadow-lg shadow-ai/20 hover:shadow-ai/40
    focus:ring-ai
  `,
  ghost: `
    bg-transparent border border-white/20 text-white
    hover:bg-white/10 hover:border-white/40
    focus:ring-white/50
  `,
  outline: `
    bg-transparent border-2 border-accent text-accent
    hover:bg-accent/10
    focus:ring-accent
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-sm rounded-sm',
  md: 'px-6 py-3 text-base rounded-md',
  lg: 'px-8 py-4 text-lg rounded-lg',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`
        inline-flex items-center justify-center gap-2
        font-medium transition-all duration-200 ease-out
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-dark-300
        disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
        active:scale-[0.98]
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <svg
          className="animate-spin h-5 w-5"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        <>
          {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
          {children}
          {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
        </>
      )}
    </button>
  );
}
