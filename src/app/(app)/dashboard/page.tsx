'use client'

import Link from 'next/link'
import { Users, FileText, BarChart3, ChevronRight, Calendar, UserPlus, Sparkles, ClipboardList } from 'lucide-react'

// ------
// TODO: Supabase 接続後にここをサーバーサイドデータに差し替え
// ------

interface ActivityItem {
  id: string
  message: string
  date: string
  color: 'rose' | 'green' | 'blue' | 'gray'
}

interface NoteItem {
  name: string
  date: string
  note: string
}

const MOCK_ACTIVITIES: ActivityItem[] = [
  { id: '1', message: '山田 太郎さんの希望休を登録しました', date: '4/15', color: 'rose' },
  { id: '2', message: '2025年4月のシフトが自動生成されました', date: '4/13', color: 'green' },
  { id: '3', message: '鈴木 花子さんの希望を登録しました', date: '4/10', color: 'blue' },
  { id: '4', message: '新スタッフ「田中 一郎」を登録しました', date: '4/2', color: 'gray' },
]

const MOCK_NOTES: NoteItem[] = [
  { name: '山田 太郎', date: '4月15日（火）', note: '私用のため' },
  { name: '鈴木 花子', date: '4月20日（日）', note: '私用のため緊急不可' },
  { name: '田中 一郎', date: '4月23日（水）', note: '—' },
]

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
    href: '/leave-requests',
    icon: <ClipboardList className="h-5 w-5 text-rose-400" />,
    title: '希望休を管理する',
    sub: 'スタッフ希望・休暇申請を入力',
  },
  {
    href: '/staff',
    icon: <UserPlus className="h-5 w-5 text-rose-400" />,
    title: 'スタッフを管理する',
    sub: 'スタッフ情報の確認・編集',
  },
]

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* KPI カード */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* 今月のスタッフ数 */}
        <div className="rounded-xl border border-rose-100 bg-white p-5 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 shrink-0">
            <Users className="h-6 w-6 text-rose-400" />
          </div>
          <div>
            <p className="text-xs text-gray-400">今月のスタッフ数</p>
            <p className="text-3xl font-bold text-gray-900 leading-tight">5<span className="text-base font-normal text-gray-500 ml-1">人</span></p>
            <p className="text-xs text-gray-400 mt-0.5">在籍中</p>
          </div>
        </div>

        {/* 当月の申請数 */}
        <div className="rounded-xl border border-rose-100 bg-white p-5 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 shrink-0">
            <FileText className="h-6 w-6 text-rose-400" />
          </div>
          <div>
            <p className="text-xs text-gray-400">当月の申請数</p>
            <p className="text-3xl font-bold text-gray-900 leading-tight">3<span className="text-base font-normal text-gray-500 ml-1">件</span></p>
            <p className="text-xs text-gray-400 mt-0.5">先月比 +1件</p>
          </div>
        </div>

        {/* シフト充足率 */}
        <div className="rounded-xl border border-rose-100 bg-white p-5 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 shrink-0">
            <BarChart3 className="h-6 w-6 text-rose-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400">シフト充足率</p>
            <p className="text-3xl font-bold text-gray-900 leading-tight">80<span className="text-base font-normal text-gray-500 ml-0.5">%</span></p>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100">
              <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: '80%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* 中段: 直近のアクション + クイックアクション */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 直近のアクション */}
        <div className="rounded-xl border border-rose-100 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">直近のアクション</h2>
          <ul className="space-y-3">
            {MOCK_ACTIVITIES.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${ACTIVITY_DOT[item.color]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 leading-snug">{item.message}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{item.date}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* クイックアクション */}
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
          <Link href="/leave-requests" className="text-xs text-rose-500 hover:text-rose-600 font-medium">
            すべて見る →
          </Link>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {MOCK_NOTES.map((n, i) => (
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
      </div>
    </div>
  )
}
