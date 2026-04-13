'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  CalendarOff,
  Settings,
  Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/shift-table', label: 'シフト表', icon: CalendarDays },
  { href: '/scheduler', label: 'シフト自動生成', icon: Wand2 },
  { href: '/staff', label: 'スタッフ管理', icon: Users },
  { href: '/leave-requests', label: '希望休管理', icon: CalendarOff },
  { href: '/constraints', label: '勤務制約設定', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 border-r border-gray-200 bg-white flex flex-col h-full">
      <div className="px-6 py-5 border-b border-gray-200">
        <p className="text-xs font-semibold text-gray-400 tracking-widest uppercase">Shift</p>
        <p className="text-lg font-bold text-gray-900 leading-tight">Create</p>
      </div>
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
