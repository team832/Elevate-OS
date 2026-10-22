'use client';

import { useState } from 'react';

/** "Copy summary": copies the plain-text report; the text stays visible for manual copying. */
export function CopySummary({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => setState('copied'),
      () => setState('failed'),
    );
  return (
    <div className="el-stack">
      <div className="el-inline-form">
        <button type="button" className="el-button el-button-secondary" onClick={copy}>
          Copy summary
        </button>
        <span role="status">
          {state === 'copied'
            ? 'Copied. Paste it where you need it.'
            : state === 'failed'
              ? 'Your browser blocked copying. Select the text below and copy it.'
              : ''}
        </span>
      </div>
      <details>
        <summary>Show the summary text</summary>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>
      </details>
    </div>
  );
}
