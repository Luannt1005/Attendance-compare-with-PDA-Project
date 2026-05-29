type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastEvent {
    message: string
    type: ToastType
    id: number
}

type ToastListener = (toast: ToastEvent) => void

let listeners: ToastListener[] = []
let counter = 0

export const toastEmitter = {
    on(listener: ToastListener) {
        listeners.push(listener)
        return () => { listeners = listeners.filter(l => l !== listener) }
    },
    emit(message: string, type: ToastType = 'info') {
        const event: ToastEvent = { message, type, id: ++counter }
        listeners.forEach(l => l(event))
    }
}

export const toast = {
    success: (msg: string) => toastEmitter.emit(msg, 'success'),
    error: (msg: string) => toastEmitter.emit(msg, 'error'),
    warning: (msg: string) => toastEmitter.emit(msg, 'warning'),
    info: (msg: string) => toastEmitter.emit(msg, 'info'),
}
