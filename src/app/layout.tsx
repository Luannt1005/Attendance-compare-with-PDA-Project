import type { Metadata } from 'next'
import './globals.css'

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
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  )
}
