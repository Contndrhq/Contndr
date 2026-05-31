/**
 * CheckboxToggle — bulletproof toggle for WKWebView (iOS native app shell)
 * and every desktop browser.
 *
 * Why a hidden checkbox instead of a styled <button>?
 *   iOS WebKit applies aggressive native styling to <button> elements
 *   (rounded corners, padding, tap highlights, focus rings) that overrode
 *   our Tailwind pill and made the toggle render as a giant black/white
 *   circle. Using a real <input type="checkbox"> sidesteps all of that —
 *   iOS handles the input state natively, and we just paint the visual
 *   pill + thumb with plain CSS using the :checked sibling selector.
 *
 * Layout: a <label> wraps a visually-hidden checkbox + a styled <span> pill.
 * Toggling fires both on label-tap and on checkbox-change, so it's
 * accessible (real form control) and reliable across every webview.
 */

import { useId } from 'react';

interface CheckboxToggleProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
}

export function CheckboxToggle({ checked, disabled, onChange, ariaLabel }: CheckboxToggleProps) {
  const id = useId();
  const trackColor = checked
    ? 'rgb(24 24 27)' // zinc-900
    : 'rgb(228 228 231)'; // zinc-200
  const thumbColor = '#fff';

  return (
    <label
      htmlFor={id}
      style={{
        position: 'relative',
        display: 'inline-block',
        width: 44,
        height: 24,
        flexShrink: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        WebkitTapHighlightColor: 'transparent',
      }}
      onClick={(e) => {
        // Some webviews don't fire onChange reliably on label-tap when the
        // input is offscreen. Manually flip state if not disabled.
        if (disabled) {
          e.preventDefault();
          return;
        }
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        style={{
          position: 'absolute',
          opacity: 0,
          width: 0,
          height: 0,
          margin: 0,
          padding: 0,
          pointerEvents: 'none',
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: trackColor,
          borderRadius: 9999,
          transition: 'background-color 180ms ease',
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 3,
          left: 3,
          width: 18,
          height: 18,
          backgroundColor: thumbColor,
          borderRadius: '50%',
          boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
          transform: `translateX(${checked ? 20 : 0}px)`,
          transition: 'transform 180ms ease',
        }}
      />
    </label>
  );
}

export default CheckboxToggle;
