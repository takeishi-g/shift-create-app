'use client'

import { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

export function TopBar() {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center px-6 gap-3 shrink-0">
      <CalendarDays className="h-5 w-5 text-gray-500" />
      <span className="text-sm font-bold text-gray-900">
        {now ? format(now, 'yyyy年M月d日（E）', { locale: ja }) : ''}
      </span>
      <span className="text-sm text-gray-500 tabular-nums">
        {now ? format(now, 'HH:mm:ss') : ''}
      </span>
    </header>
  )
}
