'use client'

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { Bell, UserCircle } from 'lucide-react'
import { ProfileModal } from '@/components/ProfileModal'

function NotificationPanel() {
    return (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700">Thông báo</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Hôm nay</span>
            </div>
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <Bell className="w-8 h-8 text-slate-200 mb-2" />
                <p className="text-sm font-medium text-slate-400">Không có thông báo mới</p>
            </div>
        </div>
    )
}

export default function Header() {
    const { user } = useAuth()
    const [showProfile, setShowProfile] = useState(false)
    const [showNotif, setShowNotif] = useState(false)
    const notifRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!showNotif) return
        const handler = (e: MouseEvent) => {
            if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
                setShowNotif(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [showNotif])

    if (!user) return null

    return (
        <header className="h-16 border-b border-slate-200/80 bg-white/90 backdrop-blur-md sticky top-0 z-100 flex items-center px-6 gap-4 shrink-0">
            {/* Portal target — pages inject their own title + controls here */}
            <div id="timesheet-header-portal" className="flex-1 flex items-center justify-between min-w-0" />

            {/* Right side: role badge, notifications, user */}
            <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Role</span>
                    <span className="bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight">
                        {user.role}
                    </span>
                </div>

                <div className="h-5 w-px bg-slate-200" />

                <div className="relative" ref={notifRef}>
                    <button
                        onClick={() => setShowNotif(v => !v)}
                        className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors relative"
                    >
                        <Bell className="w-4 h-4" />
                        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full ring-2 ring-white" />
                    </button>
                    {showNotif && <NotificationPanel />}
                </div>

                <div className="h-5 w-px bg-slate-200" />

                <button
                    onClick={() => setShowProfile(true)}
                    className="flex items-center gap-2.5 hover:bg-slate-50 px-2 py-1.5 rounded-xl transition-colors cursor-pointer"
                >
                    <div className="text-right">
                        <p className="text-sm font-semibold text-slate-800 leading-none">{user.fullName}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{user.username}</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-linear-to-br from-red-500 to-rose-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
                        {user.fullName?.split(' ').pop()?.[0] ?? <UserCircle className="w-5 h-5" />}
                    </div>
                </button>
            </div>

            <ProfileModal isOpen={showProfile} onClose={() => setShowProfile(false)} user={user} />
        </header>
    )
}
