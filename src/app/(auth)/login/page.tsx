'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '@/lib/AuthContext'
import { cn } from '@/lib/utils'
import Link from 'next/link'

export default function LoginPage() {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const { login } = useAuth()

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Login failed')
            }

            login(data.token, data.user)
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen grid grid-cols-12 font-sans bg-white">
            {/* Left Column - Branding (Milwaukee image & highlights) */}
            <div className="hidden md:flex md:col-span-7 lg:col-span-8 relative flex-col justify-between p-12 lg:p-16 text-white overflow-hidden select-none bg-slate-950">
                {/* Background image with hover zoom effect */}
                <div 
                    className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-10000 hover:scale-105"
                    style={{ backgroundImage: `url('/milwaukee_building.png')` }}
                />
                {/* Semi-transparent dark overlays */}
                <div className="absolute inset-0 bg-slate-950/40 mix-blend-multiply" />
                <div className="absolute inset-0 bg-linear-to-t from-slate-950/90 via-slate-950/20 to-slate-950/50" />

                {/* Top Header Logo */}
                <div className="relative z-10 flex items-center gap-3">
                    <img
                        src="/milwaukee_logo.png"
                        alt="Milwaukee Logo"
                        className="h-6 w-auto object-contain brightness-0 invert"
                    />
                    <span className="text-[11px] font-bold text-white tracking-[0.2em] uppercase">
                        TIMEKEEPING SYSTEM
                    </span>
                </div>

                {/* Bottom Content Area */}
                <div className="relative z-10 mt-auto max-w-2xl">
                    <div className="inline-flex items-center gap-2 px-3.5 py-1 bg-[#D10000] text-white text-xs font-semibold rounded-full mb-6 shadow-md">
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                        Timekeeping & Attendance Program
                    </div>
                    <h1 className="text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight mb-4 drop-shadow-sm">
                        Streamline and verify attendance with ease
                    </h1>
                    <p className="text-sm lg:text-base text-gray-200 leading-relaxed font-normal max-w-xl">
                        A dedicated workspace to manage shifts, track employee attendance, and verify OT data accurately.
                    </p>
                </div>

                {/* Next.js Badge in the bottom left */}
                <div className="relative z-10 mt-8">
                    <div className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center border border-white/10 shadow-sm">
                        <svg className="w-4 h-4 text-white" viewBox="0 0 180 180" fill="none">
                            <circle cx="90" cy="90" r="90" fill="black" />
                            <path d="M140 140L80 60V140H60V40H80L140 120V40H160V140H140Z" fill="white" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Right Column - Form Area */}
            <div className="col-span-12 md:col-span-5 lg:col-span-4 flex flex-col justify-center p-8 sm:p-12 lg:p-16 bg-white min-h-screen">
                {/* Mobile-only Top Logo */}
                <div className="flex md:hidden justify-center mb-8">
                    <img
                        src="/milwaukee_logo.png"
                        alt="Milwaukee Logo"
                        className="h-10 w-auto object-contain"
                    />
                </div>

                {/* Centered Login Form Wrapper */}
                <div className="max-w-[360px] w-full mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                    >
                        <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-8">
                            Sign in
                        </h2>

                        {error && (
                            <div className="bg-red-50 border border-red-100 text-red-600 p-3 rounded-xl mb-6 text-xs text-center font-bold">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleLogin} className="space-y-5">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                                    Email
                                </label>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D10000]/10 focus:border-[#D10000] transition-all text-sm shadow-xs"
                                    placeholder="Enter your email"
                                    required
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                                    Password
                                </label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D10000]/10 focus:border-[#D10000] transition-all text-sm shadow-xs"
                                    placeholder="Enter your password"
                                    required
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className={cn(
                                    "w-full bg-[#D10000] hover:bg-[#B00000] active:scale-[0.99] text-white rounded-xl py-3.5 font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 text-sm cursor-pointer",
                                    loading && "opacity-70 cursor-not-allowed"
                                )}
                            >
                                {loading ? 'Sign in...' : (
                                    <>
                                        Sign in
                                        <span className="text-white/80 font-normal ml-0.5">›</span>
                                    </>
                                )}
                            </button>
                        </form>

                        <p className="text-center text-sm text-gray-500 mt-6">
                            Don't have an account?{' '}
                            <Link href="/register" className="text-[#D10000] hover:text-[#B00000] font-semibold transition-colors">
                                Sign up
                            </Link>
                        </p>
                    </motion.div>
                </div>
            </div>
        </div>
    )
}
