'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { addDays, format, getDay, startOfMonth, endOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Users, FileText, ChevronRight, Calendar, UserPlus, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface NoteItem {
  name: string
  date: string
  note: string
}

interface DayShift {
  label: string
  日: number
  夜: number
}

interface ActivityItem {
  id: string
  message: string
  date: string
  color: 'rose' | 'green' | 'blue' | 'gray'
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

const SHIFT_BADGE: Record<string, string> = {
  日: 'text-gray-600',
  夜: 'bg-violet-100 text-violet-700',
}

const ACTIVITY_DOT: Record<ActivityItem['color'], string> = {
  rose:  'bg-rose-400',
  green: 'bg-emerald-400',
  blue:  'bg-blue-400',
  gray:  'bg-gray-300',
}

const QUICK_ACTIONS = [
  {
    href: '/scheduler',
    icon: <Sparkles className="h-5 w-5 text-rose-400" />,
    title: 'シフトを生成する',
    sub: 'コンフィグ / スタッフ・希望休を確認',
  },
  {
    href: '/staff',
    icon: <UserPlus className="h-5 w-5 text-rose-400" />,
    title: 'スタッフを管理する',
    sub: 'スタッフ情報の確認・編集',
  },
]

export default function DashboardPage() {
  const supabase = createClient()
  const today = new Date()

  const [staffCount, setStaffCount] = useState<number>(0)
  const [leaveCount, setLeaveCount] = useState<number>(0)
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [dayShifts, setDayShifts] = useState<DayShift[]>([])

  useEffect(() => {
    async function load() {
      const yearMonth = format(today, 'yyyy-MM')
      const monthStart = format(startOfMonth(today), 'yyyy-MM-dd')
      const monthEnd = format(endOfMonth(today), 'yyyy-MM-dd')

      const [
        { count: sCount },
        { data: leaveData },
        { data: scheduleMonth },
      ] = await Promise.all([
        supabase.from('staff_profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase
          .from('leave_requests')
          .select('id, date, note, type, staff:staff_profiles(name)')
          .gte('date', monthStart)
          .lte('date', monthEnd)
          .order('date', { ascending: false }),
        supabase.from('schedule_months').select('id').eq('year_month', yearMonth).single(),
      ])

      if (sCount !== null) setStaffCount(sCount)

      if (leaveData) {
        setLeaveCount(leaveData.length)

        setNotes(
          leaveData.slice(0, 5).map((r) => ({
            name: (Array.isArray(r.staff) ? r.staff[0] : r.staff as { name: string } | null)?.name ?? '不明',
            date: format(new Date(r.date), 'M月d日（E）', { locale: ja }),
            note: r.note ?? r.type ?? '—',
          }))
        )

        const colors: ActivityItem['color'][] = ['rose', 'blue', 'green', 'gray']
        setActivities(
          leaveData.slice(0, 4).map((r, i) => ({
            id: r.id,
            message: `${(Array.isArray(r.staff) ? r.staff[0] : r.staff as { name: string } | null)?.name ?? '不明'}さんの${r.type}を登録しました`,
            date: format(new Date(r.date), 'M/d'),
            color: colors[i % colors.length],
          }))
        )
      }

      if (scheduleMonth) {
        const dates = [today, addDays(today, 1), addDays(today, 2)].map((d) =>
          format(d, 'yyyy-MM-dd')
        )
        const { data: assignments } = await supabase
          .from('shift_assignments')
          .select('date, shift_code')
          .eq('schedule_month_id', scheduleMonth.id)
          .in('date', dates)

        setDayShifts(
          dates.map((dateStr, i) => {
            const d = addDays(today, i)
            const dayAssignments = assignments?.filter((a) => a.date === dateStr) ?? []
            const count = (code: string) => dayAssignments.filter((a) => a.shift_code === code).length
            return {
              label: `${format(d, 'M/d')}（${DAY_LABELS[getDay(d)]}）`,
              日: count('日'),
              夜: count('夜'),
            }
          })
        )
      } else {
        setDayShifts(
          [0, 1, 2].map((i) => {
            const d = addDays(today, i)
            return {
              label: `${format(d, 'M/d')}（${DAY_LABELS[getDay(d)]}）`,
              日: 0, 夜: 0,
            }
          })
        )
      }
    }

    load()
  }, [])

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* KPI カード */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-rose-100 bg-white p-5 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 shrink-0">
            <Users className="h-6 w-6 text-rose-400" />
          </div>
          <div>
            <p className="text-xs text-gray-400">今月のスタッフ数</p>
            <p className="text-3xl font-bold text-gray-900 leading-tight">
              {staffCount}<span className="text-base font-normal text-gray-500 ml-1">人</span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">在籍中</p>
          </div>
        </div>

        <div className="rounded-xl border border-rose-100 bg-white p-5 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 shrink-0">
            <FileText className="h-6 w-6 text-rose-400" />
          </div>
          <div>
            <p className="text-xs text-gray-400">当月の申請数</p>
            <p className="text-3xl font-bold text-gray-900 leading-tight">
              {leaveCount}<span className="text-base font-normal text-gray-500 ml-1">件</span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">今月の希望休・有給</p>
          </div>
        </div>
      </div>

      {/* 直近3日のシフト */}
      <div className="rounded-xl border border-rose-100 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">直近3日のシフト</h2>
          <Link href="/shift-table" className="text-xs text-rose-500 hover:text-rose-600 font-medium">
            シフト表を見る →
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {dayShifts.map((day, i) => (
            <div key={i} className={`rounded-lg border p-3 space-y-2 ${i === 0 ? 'border-rose-200 bg-rose-50/40' : 'border-gray-100 bg-gray-50/40'}`}>
              <p className={`text-xs font-semibold ${i === 0 ? 'text-rose-600' : 'text-gray-500'}`}>
                {i === 0 ? '今日 ' : ''}{day.label}
              </p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {(['日', '夜'] as const).map((shift) => (
                  <div key={shift} className="flex items-center gap-1">
                    <span className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold ${SHIFT_BADGE[shift]}`}>
                      {shift}
                    </span>
                    <span className="text-xs text-gray-600">{day[shift]}人</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 直近のアクション + クイックアクション */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-rose-100 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">直近のアクション</h2>
          {activities.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">今月の申請はまだありません</p>
          ) : (
            <ul className="space-y-3">
              {activities.map((item) => (
                <li key={item.id} className="flex items-start gap-3">
                  <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${ACTIVITY_DOT[item.color]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 leading-snug">{item.message}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{item.date}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-rose-100 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">クイックアクション</h2>
          <div className="space-y-2">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-100 hover:border-rose-200 hover:bg-rose-50/50 transition-colors group"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-50 shrink-0 group-hover:bg-rose-100 transition-colors">
                  {action.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{action.title}</p>
                  <p className="text-xs text-gray-400">{action.sub}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-rose-400 transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* 備考（今月の希望休メモ） */}
      <div className="rounded-xl border border-rose-100 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">備考</h2>
          <Link href="/scheduler" className="text-xs text-rose-500 hover:text-rose-600 font-medium">
            シフト編集で確認 →
          </Link>
        </div>
        {notes.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">今月の希望休・申請はありません</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {notes.map((n, i) => (
                <tr key={i} className="hover:bg-rose-50/30 transition-colors">
                  <td className="py-2.5 pr-4 font-medium text-gray-800 whitespace-nowrap w-28">{n.name}</td>
                  <td className="py-2.5 pr-4 text-gray-500 whitespace-nowrap w-36">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-gray-300" />
                      {n.date}
                    </span>
                  </td>
                  <td className="py-2.5 text-gray-500">{n.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
