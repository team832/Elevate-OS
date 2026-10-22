import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@elevate/shared-ui/styles.css';

export const metadata: Metadata = {
  title: { default: 'Elevate OS', template: '%s · Elevate OS' },
  description: 'Elevate OS — internal operating system for Elevate Education.',
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
