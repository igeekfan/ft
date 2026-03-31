import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'

interface ConfirmDialogProps {
    open: boolean
    count: number
    onConfirm: () => void
    onCancel: () => void
}

function ConfirmDialog({open, count, onConfirm, onCancel}: ConfirmDialogProps) {
    return (
        <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>确认删除</DialogTitle>
                    <DialogDescription>
                        你即将删除 <strong className="text-destructive">{count}</strong> 个文件。
                        此操作无法撤销，请确认是否继续。
                    </DialogDescription>
                </DialogHeader>
                <div className="text-xs text-destructive/80 py-2">
                    ⚠️ 文件将被永久删除，无法恢复
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        取消
                    </Button>
                    <Button variant="destructive" onClick={onConfirm}>
                        确认删除
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default ConfirmDialog
