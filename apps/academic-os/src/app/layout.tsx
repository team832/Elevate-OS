import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@elevate/shared-ui/styles.css';
import '../ui/workspace.css';

export const metadata: Metadata = {
  title: { default: 'Academic OS · Elevate OS', template: '%s · Elevate OS' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f4f1eb',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
