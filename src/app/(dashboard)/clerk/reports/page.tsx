'use client'

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { format, subMonths, addMonths, parseISO } from 'date-fns'
import { 
    ChevronLeft, ChevronRight, PieChart as PieChartIcon, TrendingUp, Users, Clock, 
    Loader2, Calendar, Activity, BarChart3, Download, RefreshCw, AlertCircle
} from 'lucide-react'
import { 
    DailyAttendanceChart, 
    DailyOvertimeChart, 
    LeaveDistributionChart 
} from '@/components/reports/DashboardCharts'
import { cn } from '@/lib/utils'

const DASH_COLORS = {
    attendance: '#10b981', // emerald-500
    absent: '#f59e0b',    // amber-500
    ot: '#3b82f6',        // blue-500
    employees: '#8b5cf6'  // purple-500
}

function StatCard({ title, value, icon: Icon, color, subtitle }: any) {
    return (
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex flex-col gap-1.5 relative overflow-hidden transition-all hover:shadow-md">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{title}</span>
                <div className="p-2 rounded-lg" style={{ backgroundColor: `${color}10`, color: color }}>
                    <Icon size={16} />
                </div>
            </div>
            <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-800 tracking-tight">{value}</span>
            </div>
            {subtitle && <span className="text-[10px] text-gray-400 font-medium tracking-tight leading-tight">{subtitle}</span>}
        </div>
    )
}

export default function ClerkReportsPage() {
    const [currentDate, setCurrentDate] = useState(new Date())
    const [activeTab, setActiveTab] = useState<'hc' | 'ot'>('hc')
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

    const monthStr = format(currentDate, 'yyyy-MM')
    const displayMonth = format(currentDate, 'MMMM yyyy')

    const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
    useEffect(() => {
        setPortalRoot(document.getElementById('timesheet-header-portal'))
    }, [])

    const fetchReports = async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/clerk-attendance/reports?month=${monthStr}`)
            const json = await res.json()
            if (res.ok) {
                setData(json)
            }
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchReports()
    }, [monthStr])

    const goPrevMonth = () => setCurrentDate(prev => subMonths(prev, 1))
    const goNextMonth = () => setCurrentDate(prev => addMonths(prev, 1))

    const headerContent = (
        <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold flex items-center gap-2 text-gray-800">
                <BarChart3 className="w-5 h-5 text-orange-500" />
                <span>Báo cáo & Phân tích</span>
            </h1>
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest mt-1 hidden md:block">Phân tích hiệu suất nhân sự</p>
        </div>
    )

    return (
        <div className="flex flex-col flex-1 bg-slate-50 p-6 overflow-y-auto font-sans">
            {portalRoot ? createPortal(headerContent, portalRoot) : null}
            
            {/* Top Navigation & Date Controls */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8 w-full">
                <div className="flex items-center gap-8 border-b border-gray-100 w-full lg:w-auto overflow-x-auto">
                    <button
                        onClick={() => setActiveTab('hc')}
                        className={cn(
                            "relative py-3 px-1 text-[13px] font-medium transition-all text-gray-400 hover:text-orange-500",
                            activeTab === 'hc' && "text-orange-600 font-bold"
                        )}
                    >
                        Nhân sự & Điểm danh
                        {activeTab === 'hc' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-orange-500 rounded-full" />}
                    </button>
                    <button
                        onClick={() => setActiveTab('ot')}
                        className={cn(
                            "relative py-3 px-1 text-[13px] font-medium transition-all text-gray-400 hover:text-orange-500",
                            activeTab === 'ot' && "text-orange-600 font-bold"
                        )}
                    >
                        Phân tích tăng ca (OT)
                        {activeTab === 'ot' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-orange-500 rounded-full" />}
                    </button>
                </div>

                <div className="flex items-center gap-3 ml-auto lg:ml-0">
                    <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100 shadow-sm">
                        <button onClick={goPrevMonth} className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-400">
                            <ChevronLeft size={16} />
                        </button>
                        <div className="flex items-center gap-2 px-2 text-gray-600 select-none">
                            <span className="font-bold text-[11px] uppercase tracking-wider w-24 text-center">{displayMonth}</span>
                        </div>
                        <button onClick={goNextMonth} className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-400">
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    <button 
                        onClick={fetchReports}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:border-orange-500 hover:text-orange-600 text-gray-500 rounded-xl text-[11px] font-bold shadow-sm active:scale-95 transition-all disabled:opacity-50"
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                        {loading ? 'ĐANG TẢI...' : 'LÀM MỚI'}
                    </button>
                </div>
            </div>

            {loading && !data ? (
                <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]">
                    <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                    <p className="text-gray-400 font-black uppercase tracking-widest animate-pulse">Aggregating Monthly Analytics...</p>
                </div>
            ) : !data ? (
                <div className="flex-1 bg-white rounded-3xl border border-dashed border-gray-200 flex flex-col items-center justify-center p-12 text-center">
                    <AlertCircle size={64} className="text-gray-200 mb-4" />
                    <h3 className="text-xl font-black text-gray-400 uppercase tracking-widest">No Analysis Data Available</h3>
                    <p className="text-gray-400 mt-2 max-w-xs">There are no records for the selected period. Please ensure attendance data is imported.</p>
                </div>
            ) : (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
                    
                    {/* STATS GRID */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {activeTab === 'hc' ? (
                            <>
                                <StatCard title="Active Workforce" value={data.summary.totalEmployees} icon={Users} color={DASH_COLORS.employees} subtitle="Total registered employees" />
                                <StatCard title="Avg Attendance" value={`${data.summary.avgAttendance}%`} icon={Activity} color={DASH_COLORS.attendance} subtitle="Average daily presence" />
                                <StatCard title="Leave Distribution" value={data.leaveDistribution.length} icon={TrendingUp} color={DASH_COLORS.absent} subtitle="Active leave types this month" />
                                <StatCard title="Cycle Summary" value="21st - 20th" icon={Calendar} color={DASH_COLORS.ot} subtitle="Attendance cycle boundaries" />
                            </>
                        ) : (
                            <>
                                <StatCard title="Total OT Volume" value={`${data.summary.totalOTHours.toFixed(1)}h`} icon={Clock} color={DASH_COLORS.ot} subtitle="Total hours across all types" />
                                <StatCard title="Avg OT / Employee" value={`${(data.summary.totalOTHours / data.summary.totalEmployees).toFixed(1)}h`} icon={TrendingUp} color={DASH_COLORS.attendance} subtitle="Monthly average per person" />
                                <StatCard title="Peak OT Day" value={data.otTrend.length > 0 ? Math.max(...data.otTrend.map((d:any) => d['OT 1.5'] + d['OT 2.0'] + d['OT 2.5'] + d['OT 3.0'])).toFixed(1) + 'h' : '0h'} icon={Activity} color={DASH_COLORS.absent} subtitle="Highest single day volume" />
                                <StatCard title="OT Multipliers" value="4" icon={PieChartIcon} color={DASH_COLORS.employees} subtitle="Tracking 1.5x to 3.0x rates" />
                            </>
                        )}
                    </div>

                    {/* CHARTS SECTION */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {activeTab === 'hc' ? (
                            <>
                                <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                                    <div className="flex items-center justify-between mb-8">
                                        <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                                            <TrendingUp className="text-blue-500" size={24} /> Daily Workforce Trend
                                        </h3>
                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-emerald-500" /> <span className="text-xs font-bold text-gray-500 uppercase tracking-tighter">Present</span></div>
                                            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-amber-500" /> <span className="text-xs font-bold text-gray-500 uppercase tracking-tighter">Absent</span></div>
                                        </div>
                                    </div>
                                    <div className="flex-1 min-h-[350px]">
                                        <DailyAttendanceChart data={data.dailyTrend} />
                                    </div>
                                </div>
                                <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                                    <h3 className="text-xl font-black text-gray-800 flex items-center gap-2 mb-8">
                                        <PieChartIcon className="text-purple-500" size={24} /> Leave Distribution
                                    </h3>
                                    <div className="flex-1 min-h-[350px]">
                                        <LeaveDistributionChart data={data.leaveDistribution} />
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="lg:col-span-3 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                                <div className="flex items-center justify-between mb-8">
                                    <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                                        <Clock className="text-blue-500" size={24} /> Daily Overtime Intensity
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-4">
                                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-blue-500" /> <span className="text-xs font-bold text-gray-500 uppercase tracking-tighter">1.5x</span></div>
                                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-purple-500" /> <span className="text-xs font-bold text-gray-500 uppercase tracking-tighter">2.0x</span></div>
                                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-pink-500" /> <span className="text-xs font-bold text-gray-500 uppercase tracking-tighter">2.5x</span></div>
                                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-rose-500" /> <span className="text-xs font-bold text-gray-500 uppercase tracking-tighter">3.0x</span></div>
                                    </div>
                                </div>
                                <div className="flex-1 min-h-[400px]">
                                    <DailyOvertimeChart data={data.otTrend} />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-gray-50 p-8 rounded-2xl border border-gray-100 flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                            <div className="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 text-gray-400">
                                <Download size={24} />
                            </div>
                            <div>
                                <h4 className="text-base font-bold text-gray-800 tracking-tight">Xuất báo cáo tổng hợp</h4>
                                <p className="text-gray-400 text-xs font-medium">Tải xuống tệp Excel/PDF bản tóm tắt cho quản lý.</p>
                            </div>
                        </div>
                        <button className="px-6 py-2.5 bg-gray-800 text-white font-bold rounded-xl shadow-sm hover:bg-black transition-all text-xs tracking-wider uppercase">
                            TẢI BÁO CÁO
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
