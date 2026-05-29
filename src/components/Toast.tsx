'use client'

import { useEffect, useState } from 'react'
import { toastEmitter } from '@/lib/toast'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ToastItem {
    id: number
    message: string
    type: 'success' | 'error' | 'warning' | 'info'
}

const ICONS = {
    success: CheckCircle2,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
}

const STYLES = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
}

const ICON_STYLES = {
    success: 'text-emerald-500',
    error: 'text-red-500',
    warning: 'text-amber-500',
    info: 'text-blue-500',
}

export default function ToastContainer() {
    const [toasts, setToasts] = useState<ToastItem[]>([])

    useEffect(() => {
        return toastEmitter.on((toast) => {
            setToasts(prev => [...prev, toast])
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== toast.id))
            }, 4000)
        })
    }, [])

    const dismiss = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))

    if (toasts.length === 0) return null

    return (
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
            {toasts.map(toast => {
                const Icon = ICONS[toast.type]
                return (
                    <div
                        key={toast.id}
                        className={cn(
                            'flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg max-w-sm w-full pointer-events-auto',
                            'animate-in slide-in-from-bottom-4 fade-in duration-300',
                            STYLES[toast.type]
                        )}
                    >
                        <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', ICON_STYLES[toast.type])} />
                        <span className="text-sm font-medium flex-1 leading-snug">{toast.message}</span>
                        <button
                            onClick={() => dismiss(toast.id)}
                            className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )
            })}
        </div>
    )
}
