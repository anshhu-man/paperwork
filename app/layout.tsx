import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'http://localhost:3000';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: 'PaperWork — Understand any paper',
  description: 'Turn confusing documents, images, and links into clear, evidence-backed action plans.',
  openGraph: {
    title: 'PaperWork',
    description: 'From confusing paper to clear next steps.',
    url: '/',
    siteName: 'PaperWork',
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: 'PaperWork — From confusing paper to clear next steps.' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PaperWork',
    description: 'From confusing paper to clear next steps.',
    images: ['/og.jpg'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
