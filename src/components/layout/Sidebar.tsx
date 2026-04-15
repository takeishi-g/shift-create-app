'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  CalendarOff,
  Settings,
  Wand2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/shift-table', label: 'シフト表', icon: CalendarDays },
  { href: '/scheduler', label: 'シフト編集', icon: Wand2 },
  { href: '/leave-requests', label: '希望休管理', icon: CalendarOff },
  { href: '/staff', label: 'スタッフ管理', icon: Users },
  { href: '/constraints', label: '勤務制約設定', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        'shrink-0 border-r border-gray-200 bg-white flex flex-col h-full transition-all duration-200',
        collapsed ? 'w-14' : 'w-56'
      )}
    >
      {/* ロゴ */}
      <div className="px-3 py-5 border-b border-gray-200 flex items-center justify-between min-h-[65px]">
        {!collapsed && (
          <div>
            <p className="text-xs font-semibold text-gray-400 tracking-widest uppercase">Shift</p>
            <p className="text-lg font-bold text-gray-900 leading-tight">Create</p>
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="ml-auto p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* ナビ */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={collapsed ? label : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
              collapsed ? 'justify-center' : '',
              pathname.startsWith(href)
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
