import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@elevate/shared-ui/styles.css';

export const metadata: Metadata = {
  title: { default: 'Academic OS · elevate', template: '%s · Academic OS · elevate' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
