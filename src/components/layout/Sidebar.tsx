'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { LogOut, LayoutDashboard, Users, FileText, ClipboardCheck, Fingerprint, ChevronLeft, ChevronRight, Clock, FileSpreadsheet, Database, PieChart, UserCircle } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ProfileModal } from '@/components/ProfileModal'

export default function Sidebar() {
    const { user, logout } = useAuth()
    const pathname = usePathname()
    const [isCollapsed, setIsCollapsed] = useState(false)
    const [showProfile, setShowProfile] = useState(false)

    if (!user) return null

    const getLinks = () => {
        if (user.role === 'Leader') {
            return [
                { label: 'Chấm công', href: '/leader', icon: LayoutDashboard },
            ]
        }
        if (user.role === 'Clerk') {
            return [
                { label: 'Báo cáo', href: '/clerk/reports', icon: FileText },
                { label: 'Dữ liệu Hệ thống', href: '/clerk/data', icon: Database },
                { label: 'So sánh Line Data', href: '/clerk/compare-line-data', icon: ClipboardCheck },
            ]
        }
        return [
            { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
            { label: 'Manage Users', href: '/admin/users', icon: Users },
        ]
    }

    const links = getLinks()

    return (
        <aside className={cn(
            "bg-white border-r border-gray-200 flex flex-col h-full sticky top-0 shrink-0 transition-all duration-300 z-20 shadow-sm",
            isCollapsed ? "w-20" : "w-64"
        )}>
            {/* Collapse Toggle Button */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="absolute -right-3 top-8 bg-white border border-gray-200 rounded-full p-1.5 text-gray-400 hover:text-[#D10000] shadow-md z-50 flex items-center justify-center transition-all hover:scale-110 active:scale-95"
            >
                {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            </button>

            {/* Logo Area */}
            <div className={cn(
                "flex items-center overflow-hidden transition-all shrink-0", 
                isCollapsed ? "h-20 justify-center px-2" : "h-20 px-6 gap-3"
            )}>
                <div className="shrink-0 transition-transform duration-300 hover:scale-105">
                    <img
                        src="/milwaukee_logo.png"
                        alt="Milwaukee Tool"
                        className={cn("w-auto object-contain transition-all", isCollapsed ? "h-6 px-1" : "h-7")}
                    />
                </div>
                {!isCollapsed && (
                    <div className="flex flex-col leading-none">
                        <span className="text-[10px] font-bold text-gray-700 tracking-wider">TIMEKEEPING</span>
                        <span className="text-[9px] font-semibold text-gray-400 tracking-wider mt-0.5">SYSTEM</span>
                    </div>
                )}
            </div>

            {/* Navigation Content */}
            <div className="p-4 flex-1 overflow-y-auto xl-scrollbar overflow-x-hidden pt-6 space-y-6">
                {/* WORKSPACE SECTION */}
                <div>
                    {!isCollapsed && (
                        <div className="px-4 mb-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            WORKSPACE
                        </div>
                    )}
                    <nav className="space-y-1">
                        {links.map((link) => {
                            const Icon = link.icon
                            const isActive = pathname === link.href
                            return (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    className={cn(
                                        "flex items-center rounded-xl text-sm font-medium transition-all relative group",
                                        isCollapsed ? "justify-center p-3" : "gap-3 px-4 py-3",
                                        isActive
                                            ? "bg-gray-100 text-gray-900 font-semibold"
                                            : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                                    )}
                                >
                                    <Icon className={cn("shrink-0 transition-transform duration-300 group-hover:scale-105", 
                                        isActive ? "text-[#D10000]" : "text-gray-400 group-hover:text-gray-600",
                                        isCollapsed ? "w-5 h-5" : "w-5 h-5"
                                    )} />
                                    {!isCollapsed && <span className="truncate">{link.label}</span>}
                                    {isCollapsed && (
                                        <span className="absolute left-full ml-3 px-2.5 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 translate-x-1 group-hover:translate-x-0 z-50 shadow-lg">
                                            {link.label}
                                        </span>
                                    )}
                                </Link>
                            )
                        })}
                    </nav>
                </div>

                {/* ACCOUNT SECTION */}
                <div>
                    {!isCollapsed && (
                        <div className="px-4 mb-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            ACCOUNT
                        </div>
                    )}
                    <nav className="space-y-1">
                        {/* Profile Button */}
                        <button
                            onClick={() => setShowProfile(true)}
                            className={cn(
                                "flex items-center rounded-xl text-sm font-medium transition-all relative group w-full text-left cursor-pointer",
                                isCollapsed ? "justify-center p-3" : "gap-3 px-4 py-3",
                                "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                            )}
                        >
                            <UserCircle className="shrink-0 transition-transform duration-300 group-hover:scale-105 w-5 h-5 text-gray-400 group-hover:text-gray-600" />
                            {!isCollapsed && <span className="truncate">Thông tin cá nhân</span>}
                            {isCollapsed && (
                                <span className="absolute left-full ml-3 px-2.5 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 translate-x-1 group-hover:translate-x-0 z-50 shadow-lg">
                                    Thông tin cá nhân
                                </span>
                            )}
                        </button>

                        {/* Sign Out Button */}
                        <button
                            onClick={logout}
                            className={cn(
                                "flex items-center rounded-xl text-sm font-medium transition-all relative group w-full text-left cursor-pointer",
                                isCollapsed ? "justify-center p-3" : "gap-3 px-4 py-3",
                                "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                            )}
                        >
                            <LogOut className="shrink-0 transition-transform duration-300 group-hover:scale-105 w-5 h-5 text-gray-400 group-hover:text-gray-600" />
                            {!isCollapsed && <span className="truncate">Đăng xuất</span>}
                            {isCollapsed && (
                                <span className="absolute left-full ml-3 px-2.5 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 translate-x-1 group-hover:translate-x-0 z-50 shadow-lg">
                                    Đăng xuất
                                </span>
                            )}
                        </button>
                    </nav>
                </div>
            </div>

            <ProfileModal isOpen={showProfile} onClose={() => setShowProfile(false)} user={user} />
        </aside>
    )
}

