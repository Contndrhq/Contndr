/**
 * EmailMessageBody — renders an email reply's content with the same
 * fidelity as the sender's mail client.
 *
 * Why this component exists:
 * Replies arrive with EITHER an `htmlBody` (preferred — what Gmail/
 * Outlook actually rendered) OR just `body` (plain text fallback).
 * Previously the inbox always rendered plain text via
 * `whitespace-pre-wrap`, which mangled HTML-only replies into a wall
 * of unstyled raw markup. This component:
 *   - Picks the right representation
 *   - Sanitizes HTML safely (no scripts, no event handlers, links
 *     auto-open in a new tab)
 *   - Splits off the quoted previous-thread block ("On Mon, X wrote:"
 *     and the > prefixed lines) into a collapsed "Show original"
 *     toggle, matching Gmail / iOS Mail behavior.
 */

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { renderEmailBody } from '../lib/email-body';

interface Props {
  body?: string | null;
  htmlBody?: string | null;
  isSent: boolean;
}

export function EmailMessageBody({ body, htmlBody, isSent }: Props) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { freshHtml, quotedHtml, hasQuoted } = useMemo(
    () => renderEmailBody({ body, htmlBody }),
    [body, htmlBody]
  );

  const proseColor = isSent
    ? 'text-zinc-100 dark:text-zinc-900'
    : 'text-zinc-800 dark:text-zinc-200';

  const linkColor = isSent
    ? '[&_a]:text-emerald-300 dark:[&_a]:text-emerald-700'
    : '[&_a]:text-emerald-600 dark:[&_a]:text-emerald-400';

  return (
    <div className={`text-sm leading-relaxed ${proseColor} email-body ${linkColor}`}>
      <div
        className="email-body-fresh"
        dangerouslySetInnerHTML={{ __html: freshHtml || '<em class="opacity-60">(no content)</em>' }}
      />
      {hasQuoted && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowQuoted(v => !v)}
            className={`inline-flex items-center gap-1 text-[11px] font-medium opacity-70 hover:opacity-100 transition-opacity ${
              isSent ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <ChevronDown
              className={`w-3 h-3 transition-transform ${showQuoted ? 'rotate-180' : ''}`}
            />
            {showQuoted ? 'Hide quoted' : 'Show quoted reply'}
          </button>
          {showQuoted && (
            <div
              className={`mt-2 pl-3 border-l-2 opacity-75 text-[13px] ${
                isSent ? 'border-zinc-400/40' : 'border-zinc-300 dark:border-zinc-700'
              }`}
              dangerouslySetInnerHTML={{ __html: quotedHtml }}
            />
          )}
        </div>
      )}
    </div>
  );
}
