import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import {useI18n} from '../i18n/context'

interface ConfirmDialogProps {
    open: boolean
    count: number
    deleteMode: 'recycle-bin' | 'permanent'
    onConfirm: () => void
    onCancel: () => void
}

function ConfirmDialog({open, count, deleteMode, onConfirm, onCancel}: ConfirmDialogProps) {
    const {t} = useI18n()
    return (
        <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>{t('confirmDialog.title')}</DialogTitle>
                    <DialogDescription>
                        {t('confirmDialog.description', {count})}
                    </DialogDescription>
                </DialogHeader>
                <div className="text-xs text-destructive/80 py-2">
                    {deleteMode === 'permanent' ? t('confirmDialog.hintPermanent') : t('confirmDialog.hintRecycleBin')}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        {t('confirmDialog.cancel')}
                    </Button>
                    <Button variant="destructive" onClick={onConfirm}>
                        {t('confirmDialog.confirm')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default ConfirmDialog
