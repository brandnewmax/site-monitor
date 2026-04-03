import './globals.css'

export const metadata = {
  title: '网站监控',
  description: '实时监控网站可用性',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
