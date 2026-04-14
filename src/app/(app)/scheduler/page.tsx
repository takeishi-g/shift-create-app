'use client'

import { useState } from 'react'
import { CheckCircle2, AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ------
// TODO: Supabase 接続後にここをサーバーサイドデータに差し替え
// ------
interface CheckItem {
  label: string
  detail: string
  ok: boolean
}

function useMockChecklist(month: string): CheckItem[] {
  // 月が変わってもモックは固定
  void month
  return [
    { label: 'スタッフ情報', detail: '登録済み 5人', ok: true },
    { label: 'シフト種別', detail: '早番 / 日勤 / 遅番 / 夜勤', ok: true },
    { label: '希望休申請', detail: '承認済み 3件', ok: true },
    { label: '勤務制約', detail: '設定済み', ok: true },
    { label: 'ペア制約', detail: '設定済み 2件', ok: true },
  ]
}

type GenerateStatus = 'idle' | 'running' | 'done' | 'error'

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const month = (i + 1).toString().padStart(2, '0')
  return { value: `2025-${month}`, label: `2025年${i + 1}月` }
})

export default function SchedulerPage() {
  const [selectedMonth, setSelectedMonth] = useState('2025-04')
  const [status, setStatus] = useState<GenerateStatus>('idle')

  const checklist = useMockChecklist(selectedMonth)
  const allOk = checklist.every((c) => c.ok)

  function handleGenerate() {
    if (!allOk || status === 'running') return
    setStatus('running')
    // TODO: POST /api/generate を呼び出す
    setTimeout(() => {
      setStatus('done')
    }, 2500)
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* ページヘッダー */}
      <h1 className="text-xl font-bold text-gray-900">シフト自動生成</h1>

      {/* 対象月 */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600 shrink-0">対象月</span>
        <Select value={selectedMonth} onValueChange={(v) => { if (v) { setSelectedMonth(v); setStatus('idle') } }}>
          <SelectTrigger className="w-[160px] bg-white border-gray-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 事前チェックリスト */}
      <div className="rounded-xl border border-rose-100 bg-white p-5 space-y-3">
        {checklist.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <CheckCircle2
              className={`h-4.5 w-4.5 shrink-0 ${item.ok ? 'text-green-500' : 'text-gray-300'}`}
              size={18}
            />
            <span className="text-sm text-gray-700 w-28 shrink-0">{item.label}</span>
            <span className="text-sm text-gray-500">{item.detail}</span>
          </div>
        ))}
      </div>

      {/* 生成ボタン */}
      <button
        onClick={handleGenerate}
        disabled={!allOk || status === 'running' || status === 'done'}
        className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors
          ${status === 'done'
            ? 'bg-green-500 text-white cursor-default'
            : status === 'running'
            ? 'bg-rose-400 text-white cursor-not-allowed'
            : !allOk
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-rose-500 hover:bg-rose-600 text-white'
          }`}
      >
        {status === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
        {status === 'done' && <CheckCircle2 className="h-4 w-4" />}
        {status === 'idle' && <Sparkles className="h-4 w-4" />}
        {status === 'running'
          ? '生成中...'
          : status === 'done'
          ? '生成完了 — 下書きに保存しました'
          : 'シフトを自動生成する'}
      </button>

      {/* 注意書き */}
      {status !== 'done' && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
          <span>生成後は下書きとして保存されます。内容を確認してから「確定」ボタンで確定してください。</span>
        </div>
      )}

      {status === 'done' && (
        <div className="flex items-start gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-green-500" />
          <span>シフトを生成しました。シフト表画面で内容を確認・調整してください。</span>
        </div>
      )}
    </div>
  )
}
