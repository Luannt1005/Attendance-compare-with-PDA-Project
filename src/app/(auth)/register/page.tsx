'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
    const router = useRouter()
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        fullName: '',
        roleName: 'Leader', // Default role
    })
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [loading, setLoading] = useState(false)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value })
    }

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setSuccess('')
        setLoading(true)

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Registration failed')
            }

            setSuccess('Account created successfully! Redirecting to login...')
            setTimeout(() => {
                router.push('/login')
            }, 2000)

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

                {/* Next.js Badge removed */}
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

                {/* Centered Form Wrapper */}
                <div className="max-w-[360px] w-full mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                    >
                        <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-6">
                            Sign up
                        </h2>

                        {error && (
                            <div className="bg-red-50 border border-red-100 text-red-600 p-3 rounded-xl mb-5 text-xs text-center font-bold">
                                {error}
                            </div>
                        )}

                        {success && (
                            <div className="bg-emerald-50 border border-emerald-100 text-emerald-600 p-3 rounded-xl mb-5 text-xs flex items-center justify-center gap-2 font-bold">
                                <CheckCircle className="w-4 h-4 shrink-0" />
                                {success}
                            </div>
                        )}

                        <form onSubmit={handleRegister} className="space-y-4">
                            <div className="space-y-1">
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                                    Full Name
                                </label>
                                <input
                                    type="text"
                                    name="fullName"
                                    value={formData.fullName}
                                    onChange={handleChange}
                                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D10000]/10 focus:border-[#D10000] transition-all text-sm shadow-xs"
                                    placeholder="Enter your full name"
                                    required
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                                    Username
                                </label>
                                <input
                                    type="text"
                                    name="username"
                                    value={formData.username}
                                    onChange={handleChange}
                                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D10000]/10 focus:border-[#D10000] transition-all text-sm shadow-xs"
                                    placeholder="Choose a username"
                                    required
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                                    Password
                                </label>
                                <input
                                    type="password"
                                    name="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D10000]/10 focus:border-[#D10000] transition-all text-sm shadow-xs"
                                    placeholder="Create a password"
                                    required
                                    minLength={6}
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                                    Role
                                </label>
                                <div className="relative">
                                    <select
                                        name="roleName"
                                        value={formData.roleName}
                                        onChange={handleChange}
                                        className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#D10000]/10 focus:border-[#D10000] transition-all text-sm shadow-xs appearance-none cursor-pointer font-medium"
                                        required
                                    >
                                        <option value="Leader">Leader</option>
                                        <option value="Clerk">Clerk</option>
                                    </select>
                                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-400">
                                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                                        </svg>
                                    </div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading || !!success}
                                className={cn(
                                    "w-full bg-[#D10000] hover:bg-[#B00000] active:scale-[0.99] text-white rounded-xl py-3.5 font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 text-sm cursor-pointer mt-2",
                                    (loading || success) && "opacity-70 cursor-not-allowed"
                                )}
                            >
                                {loading ? 'Creating Account...' : (
                                    <>
                                        Sign up
                                        <span className="text-white/80 font-normal ml-0.5">›</span>
                                    </>
                                )}
                            </button>
                        </form>

                        <p className="text-center text-sm text-gray-500 mt-6">
                            Already have an account?{' '}
                            <Link href="/login" className="text-[#D10000] hover:text-[#B00000] font-semibold transition-colors">
                                Sign in
                            </Link>
                        </p>
                    </motion.div>
                </div>
            </div>
        </div>
    )
}
