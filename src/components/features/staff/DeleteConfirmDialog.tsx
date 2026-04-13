'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface DeleteConfirmDialogProps {
  open: boolean
  targetName: string
  onClose: () => void
  onConfirm: () => void
}

export function DeleteConfirmDialog({
  open,
  targetName,
  onClose,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>スタッフを削除</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600 py-2">
          <span className="font-medium text-gray-900">{targetName}</span> を削除します。この操作は取り消せません。
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            variant="destructive"
            onClick={() => { onConfirm(); onClose() }}
          >
            削除する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
