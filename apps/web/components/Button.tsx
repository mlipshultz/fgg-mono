import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'yellow' | 'dark' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface BaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
  children: ReactNode;
}

type LinkProps = BaseProps & { href: string } & Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    'href' | 'className'
  >;
type NativeProps = BaseProps & { href?: undefined } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'className'
  >;

export type ButtonProps = LinkProps | NativeProps;

function classes({ variant = 'secondary', size = 'md', block, className }: BaseProps) {
  return [styles.btn, styles[variant], styles[size], block ? styles.block : '', className ?? '']
    .filter(Boolean)
    .join(' ');
}

/** Sticker-style button or link (handoff §6: hover lifts, active presses). */
export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { variant, size, block, className, children, href, ...rest } = props;
    const cls = classes({ variant, size, block, className, children });
    const external = /^https?:/.test(href) || href.startsWith('mailto:');
    if (external) {
      return (
        <a href={href} className={cls} {...rest}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={cls} {...rest}>
        {children}
      </Link>
    );
  }
  const { variant, size, block, className, children, type = 'button', ...rest } = props;
  return (
    <button
      type={type}
      className={classes({ variant, size, block, className, children })}
      {...rest}
    >
      {children}
    </button>
  );
}
