'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { TIMEZONE } from '@elevate/shared-types';
import { COMPANY_NAME } from './brand';
import { Button } from './forms';

/** Opens the browser's print dialog (PageHeader shows it on every page; paper hides it). */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      Print
    </Button>
  );
}

const PRINTED_AT = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIMEZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});
const PrintedBy = createContext<string | undefined>(undefined);

/** AppShell passes the signed-in name down to the print line of the page's header. */
export function PrintedByName({ name, children }: { name: string; children: ReactNode }) {
  return <PrintedBy value={name}>{children}</PrintedBy>;
}

/** The line at the top of a printout; hidden on screen. `renderedAt` is the server's clock. */
export function PrintHeader({ title, renderedAt }: { title: string; renderedAt: string }) {
  const by = useContext(PrintedBy);
  const [at, setAt] = useState(renderedAt);
  useEffect(() => {
    // A page left open prints the moment of printing (the button and Ctrl+P alike).
    const stamp = () => flushSync(() => setAt(new Date().toISOString()));
    window.addEventListener('beforeprint', stamp);
    return () => window.removeEventListener('beforeprint', stamp);
  }, []);
  return (
    <p className="el-print-header">
      {`${COMPANY_NAME} · ${title} · Printed `}
      {/* Node's and the browser's date data can space "10:30 am" differently: not a hydration error. */}
      <time dateTime={at} suppressHydrationWarning>
        {`${PRINTED_AT.format(new Date(at))} IST`}
      </time>
      {by ? ` · Printed by ${by}` : null}
    </p>
  );
}
