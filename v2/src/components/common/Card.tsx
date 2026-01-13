import type { HTMLAttributes, ReactNode } from 'react';

type CardVariant = 'default' | 'human' | 'ai' | 'accent' | 'interactive';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: CardVariant;
  hoverable?: boolean;
  glowOnHover?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const variantStyles: Record<CardVariant, string> = {
  default: `
    bg-dark-200/40 backdrop-blur-md
    border border-white/10
  `,
  human: `
    bg-dark-200/40 backdrop-blur-md
    border border-human/30
    hover:border-human/50
  `,
  ai: `
    bg-dark-200/40 backdrop-blur-md
    border border-ai/30
    hover:border-ai/50
  `,
  accent: `
    bg-dark-200/40 backdrop-blur-md
    border border-accent/30
    hover:border-accent/50
  `,
  interactive: `
    bg-dark-200/60 backdrop-blur-lg
    border border-white/10
    cursor-pointer
    hover:bg-dark-100/60 hover:border-white/20
  `,
};

const glowStyles: Record<CardVariant, string> = {
  default: 'hover:shadow-[0_0_30px_rgba(255,255,255,0.1)]',
  human: 'hover:shadow-glow-human',
  ai: 'hover:shadow-glow-ai',
  accent: 'hover:shadow-glow-accent',
  interactive: 'hover:shadow-[0_0_30px_rgba(255,255,255,0.15)]',
};

const paddingStyles = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export function Card({
  children,
  variant = 'default',
  hoverable = false,
  glowOnHover = false,
  padding = 'md',
  className = '',
  ...props
}: CardProps) {
  return (
    <div
      className={`
        rounded-lg
        shadow-card
        transition-all duration-300 ease-out
        ${variantStyles[variant]}
        ${paddingStyles[padding]}
        ${hoverable ? 'hover:translate-y-[-2px] hover:shadow-card-hover' : ''}
        ${glowOnHover ? glowStyles[variant] : ''}
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  );
}

// Sub-components for structured cards
interface CardHeaderProps {
  children: ReactNode;
  className?: string;
}

export function CardHeader({ children, className = '' }: CardHeaderProps) {
  return (
    <div className={`mb-4 ${className}`}>
      {children}
    </div>
  );
}

interface CardTitleProps {
  children: ReactNode;
  className?: string;
}

export function CardTitle({ children, className = '' }: CardTitleProps) {
  return (
    <h3 className={`text-xl font-semibold text-white ${className}`}>
      {children}
    </h3>
  );
}

interface CardDescriptionProps {
  children: ReactNode;
  className?: string;
}

export function CardDescription({ children, className = '' }: CardDescriptionProps) {
  return (
    <p className={`text-sm text-white/60 mt-1 ${className}`}>
      {children}
    </p>
  );
}

interface CardContentProps {
  children: ReactNode;
  className?: string;
}

export function CardContent({ children, className = '' }: CardContentProps) {
  return (
    <div className={className}>
      {children}
    </div>
  );
}

interface CardFooterProps {
  children: ReactNode;
  className?: string;
}

export function CardFooter({ children, className = '' }: CardFooterProps) {
  return (
    <div className={`mt-4 pt-4 border-t border-white/10 ${className}`}>
      {children}
    </div>
  );
}
