import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })


export const metadata: Metadata = {
  title: 'TimeKeeping & OT Manager | Milwaukee Tool Vietnam',
  description: 'Hệ thống quản lý chấm công và tăng ca cho nhà máy Milwaukee Tool Vietnam',
  icons: {
    icon: '/milwaukee_logo.png',
    shortcut: '/milwaukee_logo.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-slate-50 text-slate-900 antialiased`}>
        {children}
      </body>
    </html>
  )
}
