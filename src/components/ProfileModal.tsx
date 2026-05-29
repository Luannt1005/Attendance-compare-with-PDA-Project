'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2 } from 'lucide-react'

interface ProfileModalProps {
    isOpen: boolean
    onClose: () => void
    user: any
}

export function ProfileModal({ isOpen, onClose, user }: ProfileModalProps) {
    const [fullName, setFullName] = useState(user?.fullName || '')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    if (!isOpen || !user || !mounted) return null

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            const res = await fetch('/api/users/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    fullName: fullName !== user.fullName ? fullName : undefined,
                    password: password ? password : undefined
                })
            })

            if (res.ok) {
                alert('Profile updated successfully! Next time you login, the new full name or password will take effect.')
                onClose()
            } else {
                const err = await res.json()
                alert(err.error || 'Failed to update')
            }
        } catch (err) {
            alert('Error updating profile')
        } finally {
            setLoading(false)
        }
    }

    const modalContent = (
        <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-300 border border-white">
                <div className="flex justify-between items-center bg-slate-50 border-b border-slate-100 px-8 py-6">
                    <h3 className="font-black text-slate-800 text-lg uppercase tracking-tight">Edit Profile</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-xl hover:bg-slate-200/50">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSave} className="p-8">
                    <div className="space-y-5">
                        <div className="space-y-1.5">
                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Username (Login ID)</label>
                            <input type="text" value={user.username} disabled className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-2xl text-slate-400 shadow-inner font-semibold" />
                        </div>
                        <div className="space-y-1.5">
                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
                            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} required className="w-full px-4 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#c92a28]/10 focus:border-[#c92a28] outline-none transition-all shadow-sm text-slate-900 font-semibold" placeholder="Enter full name" />
                        </div>
                        <div className="space-y-1.5">
                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">New Password</label>
                            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#c92a28]/10 focus:border-[#c92a28] outline-none transition-all shadow-sm text-slate-900 font-semibold" placeholder="Leave blank to keep current" />
                        </div>
                    </div>

                    <div className="flex gap-3 justify-end mt-10 pt-6 border-t border-slate-100">
                        <button type="button" onClick={onClose} className="px-6 py-3 text-sm font-black text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-2xl transition-all uppercase tracking-widest">
                            Cancel
                        </button>
                        <button type="submit" disabled={loading} className="flex items-center gap-2 px-8 py-3 text-xs font-black text-white bg-linear-to-r from-[#c92a28] to-[#9c1f1d] hover:brightness-110 rounded-2xl transition-all shadow-lg shadow-red-500/20 disabled:opacity-50 active:scale-95 uppercase tracking-widest">
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            Lưu thông tin
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )

    return createPortal(modalContent, document.body)
}
