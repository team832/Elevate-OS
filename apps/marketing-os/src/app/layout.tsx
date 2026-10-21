import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@elevate/shared-ui/styles.css';

export const metadata: Metadata = {
  title: { default: 'Marketing OS · Elevate OS', template: '%s · Elevate OS' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
