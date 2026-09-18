import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'GridWise operator console', description: 'LLM-assisted campus energy scheduling' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
