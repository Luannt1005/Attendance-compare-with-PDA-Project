'use client'

import { useState, useEffect, useMemo } from 'react'
import { format, eachDayOfInterval, addMonths, subMonths } from 'date-fns'
import { ChevronLeft, ChevronRight, Search, RefreshCw, AlertCircle, Calendar, ClipboardList, X, Clock, FileSpreadsheet, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionStorage } from '@/hooks/useSessionStorage'
import { useAuth } from '@/lib/AuthContext'
import { createPortal } from 'react-dom'
import { toast } from '@/lib/toast'
import * as xlsx from 'xlsx'

interface Employee {
    id: number;
    employeeCode: string;
    fullName: string;
    leaderName: string;
    title: string;
    department: string;
    attendances: Record<string, string>;
    clerkAttendances?: Record<string, string>;
    overtimes: Record<string, number>;
    clerkOvertimes?: Record<string, number>;
    [key: string]: any;
}

const STATIC_STATUSES = ['X', 'AL', 'S', 'C', 'H', 'UP'];

const STATUS_META: Record<string, { label: string; cls: string }> = {
    X:  { label: 'Đi làm',     cls: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200' },
    C:  { label: 'Công tác',   cls: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200' },
    H:  { label: 'Nghỉ lễ',   cls: 'bg-sky-100     text-sky-700     hover:bg-sky-200     border-sky-200'     },
    AL: { label: 'Nghỉ phép',  cls: 'bg-amber-100  text-amber-700   hover:bg-amber-200   border-amber-200'   },
    S:  { label: 'Ốm/Bệnh',   cls: 'bg-amber-100  text-amber-700   hover:bg-amber-200   border-amber-200'   },
    UP: { label: 'Không phép', cls: 'bg-rose-100   text-rose-700    hover:bg-rose-200    border-rose-200'    },
};

const OT_QUICK_PICKS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];

export default function SimpleAttendanceOverview({ mode = 'clerk', compact = false }: { mode?: 'leader' | 'clerk', compact?: boolean }) {
    const { user } = useAuth()
    const [mounted, setMounted] = useState(false)
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
    const [currentCycleDate, setCurrentCycleDate] = useState(new Date())
    const [periodIndex, setPeriodIndex] = useState(0) // 0: Đợt 1, 1: Đợt 2
    const [loading, setLoading] = useState(false)
    const [employees, setEmployees] = useState<Employee[]>([])
    const [searchQuery, setSearchQuery] = useSessionStorage('simple_timesheet_search', '')
    const [idFilter, setIdFilter] = useSessionStorage('simple_timesheet_id_filter', '')
    const [selectedLeader, setSelectedLeader] = useSessionStorage('simple_timesheet_leader', '')
    const [selectedSupervisor, setSelectedSupervisor] = useSessionStorage('simple_timesheet_supervisor', '')
    const [shifts, setShifts] = useState<{ id: number, code: string, name: string | null }[]>([])
    
    const [viewMode, setViewMode] = useState<'attendance' | 'ot'>('attendance')
    const [currentPage, setCurrentPage] = useState(1)
    const pageSize = 50
    
    const [editingCell, setEditingCell] = useState<{ empId: number; dateStr: string; type: 'attendance' | 'ot' } | null>(null)
    const [pickerRect, setPickerRect] = useState<{ top: number; left: number } | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [errorCell, setErrorCell] = useState<string | null>(null)
    const [dragFill, setDragFill] = useState<{
        empIdx: number; dateIdx: number
        endEmpIdx: number; endDateIdx: number
        value: string | number; type: 'attendance' | 'ot'
    } | null>(null)

    // Month display (Tháng của kỳ công)
    const cycleMonth = useMemo(() => addMonths(new Date(currentCycleDate.getFullYear(), currentCycleDate.getMonth(), 1), 1), [currentCycleDate])
    const monthStr = format(cycleMonth, 'yyyy-MM')

    useEffect(() => {
        setMounted(true)
        setPortalTarget(document.getElementById('timesheet-header-portal'))
        fetchShifts()
    }, [])

    // Close picker when clicking outside
    useEffect(() => {
        if (!editingCell) return
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            if (!target.closest('[data-shift-picker]') && !target.closest('[data-cell-btn]') && !target.closest('[data-drag-handle]')) {
                setEditingCell(null)
                setPickerRect(null)
                setErrorCell(null)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [editingCell])

    // Crosshair cursor + disable text selection while dragging
    const isDragging = dragFill !== null
    useEffect(() => {
        document.body.style.userSelect = isDragging ? 'none' : ''
        document.body.style.cursor = isDragging ? 'crosshair' : ''
        return () => { document.body.style.userSelect = ''; document.body.style.cursor = '' }
    }, [isDragging])

    const fetchShifts = async () => {
        try {
            const res = await fetch('/api/shifts')
            const json = await res.json()
            if (res.ok) setShifts(json.data || [])
        } catch (err) { }
    }

    const fetchMonthly = async (syncExcel = false) => {
        setLoading(true)
        try {
            if (mode === 'clerk' && syncExcel) {
                try {
                    const syncRes = await fetch('/api/clerk-attendance/sync-excel', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ targetMonth: monthStr })
                    })
                    if (!syncRes.ok) {
                        const errData = await syncRes.json()
                        toast.error(`Đồng bộ Excel thất bại: ${errData.error}`)
                    } else {
                        toast.success('Đồng bộ dữ liệu Excel thành công!')
                    }
                } catch (syncErr) {
                    console.error('Failed to sync network excel:', syncErr)
                    toast.error('Không thể đồng bộ dữ liệu Excel. Đang hiển thị dữ liệu hiện tại.')
                }
            }

            let url = mode === 'clerk' ? `/api/clerk-attendance/month?month=${monthStr}` : `/api/attendance/month?month=${monthStr}`
            if (user?.id && user?.role === 'Leader') {
                url += `&leaderId=${user.id}`
            }
            const res = await fetch(url)
            if (res.ok) {
                const json = await res.json()
                setEmployees(json.data || [])
            }
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (mounted) fetchMonthly()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [monthStr, mode, user?.id])

    const daysInPeriod = useMemo(() => {
        const year = currentCycleDate.getFullYear()
        const month = currentCycleDate.getMonth()
        let start: Date, end: Date
        if (periodIndex === 0) {
            start = new Date(year, month, 21)
            end = new Date(year, month + 1, 5)
        } else {
            start = new Date(year, month + 1, 6)
            end = new Date(year, month + 1, 20)
        }
        return eachDayOfInterval({ start, end })
    }, [currentCycleDate, periodIndex])

    const uniqueLeaders = useMemo(() => {
        const leaders = new Set<string>()
        employees.forEach(e => {
            if (e.leaderName && e.leaderName !== 'N/A') leaders.add(e.leaderName)
        })
        return Array.from(leaders).sort()
    }, [employees])

    const uniqueSupervisors = useMemo(() => {
        const supervisors = new Set<string>()
        employees.forEach(e => {
            if (e.supervisor && e.supervisor !== 'N/A') supervisors.add(e.supervisor)
        })
        return Array.from(supervisors).sort()
    }, [employees])

    const filteredEmployees = useMemo(() => {
        return employees.filter(emp => {
            const matchesSearch = emp.fullName.toLowerCase().includes(searchQuery.toLowerCase())
            const matchesId = idFilter ? String(emp.employeeCode).toLowerCase().includes(idFilter.toLowerCase()) : true
            const matchesLeader = selectedLeader ? emp.leaderName === selectedLeader : true
            const matchesSupervisor = selectedSupervisor ? emp.supervisor === selectedSupervisor : true
            return matchesSearch && matchesId && matchesLeader && matchesSupervisor
        })
    }, [employees, searchQuery, idFilter, selectedLeader, selectedSupervisor])

    const totalPages = Math.ceil(filteredEmployees.length / pageSize)
    const paginatedEmployees = useMemo(() => {
        const start = (currentPage - 1) * pageSize
        return filteredEmployees.slice(start, start + pageSize)
    }, [filteredEmployees, currentPage, pageSize])

    useEffect(() => {
        setCurrentPage(1)
    }, [searchQuery, idFilter, selectedLeader, selectedSupervisor, viewMode, periodIndex])

    // Complete drag-fill on mouseup — placed after paginatedEmployees & daysInPeriod declarations
    useEffect(() => {
        if (!dragFill) return
        const handleMouseUp = async () => {
            const { empIdx, dateIdx, endEmpIdx, endDateIdx, value, type } = dragFill
            setDragFill(null)
            if (empIdx === endEmpIdx && dateIdx === endDateIdx) return

            const minEmp = Math.min(empIdx, endEmpIdx)
            const maxEmp = Math.max(empIdx, endEmpIdx)
            const minDate = Math.min(dateIdx, endDateIdx)
            const maxDate = Math.max(dateIdx, endDateIdx)

            const changes: { employeeId: number; recordDate: string; status: string }[] = []
            const otChanges: { employeeId: number; recordDate: string; hours: number }[] = []

            for (let ei = minEmp; ei <= maxEmp; ei++) {
                const emp = paginatedEmployees[ei]
                if (!emp) continue
                for (let di = minDate; di <= maxDate; di++) {
                    if (ei === empIdx && di === dateIdx) continue
                    const d = daysInPeriod[di]
                    if (!d) continue
                    const ds = format(d, 'yyyy-MM-dd')
                    if (type === 'attendance') {
                        changes.push({ employeeId: emp.id, recordDate: ds, status: String(value) })
                    } else {
                        otChanges.push({ employeeId: emp.id, recordDate: ds, hours: Number(value) })
                    }
                }
            }

            if (changes.length === 0 && otChanges.length === 0) return
            setIsSaving(true)
            try {
                const res = await fetch(mode === 'clerk' ? '/api/clerk-attendance/bulk' : '/api/attendance/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ changes, otChanges })
                })
                if (res.ok) {
                    setEmployees(prev => prev.map(emp => {
                        const ei = paginatedEmployees.findIndex(e => e.id === emp.id)
                        if (ei === -1 || ei < minEmp || ei > maxEmp) return emp
                        const newEmp = { ...emp }
                        for (let di = minDate; di <= maxDate; di++) {
                            if (ei === empIdx && di === dateIdx) continue
                            const d = daysInPeriod[di]
                            if (!d) continue
                            const ds = format(d, 'yyyy-MM-dd')
                            if (type === 'attendance') {
                                if (mode === 'clerk') newEmp.clerkAttendances = { ...(newEmp.clerkAttendances || {}), [ds]: String(value) }
                                else newEmp.attendances = { ...(newEmp.attendances || {}), [ds]: String(value) }
                            } else {
                                if (mode === 'clerk') newEmp.clerkOvertimes = { ...(newEmp.clerkOvertimes || {}), [ds]: Number(value) }
                                else newEmp.overtimes = { ...(newEmp.overtimes || {}), [ds]: Number(value) }
                            }
                        }
                        return newEmp
                    }))
                    toast.success(`Đã điền ${changes.length + otChanges.length} ô`)
                } else {
                    toast.error('Lỗi lưu dữ liệu')
                }
            } catch {
                toast.error('Lỗi kết nối')
            } finally {
                setIsSaving(false)
            }
        }
        document.addEventListener('mouseup', handleMouseUp)
        return () => document.removeEventListener('mouseup', handleMouseUp)
    }, [dragFill, paginatedEmployees, daysInPeriod])

    const getWeekday = (d: Date) => {
        const weekdays = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
        return weekdays[d.getDay()]
    }

    const handleInlineSave = async (empId: number, dateStr: string, value: string | number, type: 'attendance' | 'ot') => {
        if (type === 'attendance') {
            const val = String(value).toUpperCase().trim();
            const validCodes = [...STATIC_STATUSES, ...shifts.map(s => s.code)];
            if (val !== '' && !validCodes.includes(val)) {
                setErrorCell(`${empId}-${dateStr}`);
                return;
            }
        } else {
            const val = Number(value);
            if (isNaN(val) || val < 0 || val > 24) {
                setErrorCell(`${empId}-${dateStr}`);
                return;
            }
        }

        setErrorCell(null);
        setIsSaving(true)
        try {
            const body = { 
                changes: type === 'attendance' ? [{ employeeId: empId, recordDate: dateStr, status: value }] : [],
                otChanges: type === 'ot' ? [{ employeeId: empId, recordDate: dateStr, hours: Number(value) }] : []
            }
            
            const res = await fetch(mode === 'clerk' ? '/api/clerk-attendance/bulk' : '/api/attendance/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
            if (res.ok) {
                setEmployees(prev => prev.map(emp => {
                    if (emp.id === empId) {
                        const newEmp = { ...emp }
                        if (type === 'attendance') {
                            if (mode === 'clerk') newEmp.clerkAttendances = { ...((newEmp.clerkAttendances as any) || {}), [dateStr]: String(value).toUpperCase() }
                            else newEmp.attendances = { ...((newEmp.attendances as any) || {}), [dateStr]: String(value).toUpperCase() }
                        } else {
                            if (mode === 'clerk') newEmp.clerkOvertimes = { ...((newEmp.clerkOvertimes as any) || {}), [dateStr]: Number(value) }
                            else newEmp.overtimes = { ...((newEmp.overtimes as any) || {}), [dateStr]: Number(value) }
                        }
                        return newEmp
                    }
                    return emp
                }))
            } else {
                toast.error('Lỗi lưu dữ liệu')
            }
        } catch (err) {
            console.error(err)
            toast.error('Lỗi kết nối')
        } finally {
            setIsSaving(false)
            setEditingCell(null)
        }
    }

    const getStatusText = (status: string) => {
        if (!status) return '-'
        let actual = (status.startsWith('M_') || status.startsWith('A_')) ? status.split('_')[1] : status
        return actual.toUpperCase()
    }

    const getStatusColor = (status: string) => {
        if (!status) return 'text-slate-300 bg-white border-slate-100'
        let actual = (status.startsWith('M_') || status.startsWith('A_')) ? status.split('_')[1] : status
        if (actual.startsWith('AL') || actual.startsWith('S') || actual.startsWith('UP')) return 'text-amber-600 bg-amber-50 border-amber-200'
        if (actual.startsWith('X') || actual.startsWith('C') || actual.startsWith('H')) return 'text-emerald-600 bg-emerald-50 border-emerald-200'
        return 'text-slate-600 bg-slate-50 border-slate-200'
    }

    const getOtColor = (hours: number) => {
        if (!hours || hours === 0) return 'text-slate-300 bg-white border-slate-100'
        if (hours < 2) return 'text-orange-500 bg-orange-50 border-orange-200'
        if (hours < 4) return 'text-rose-500 bg-rose-50 border-rose-200'
        return 'text-purple-600 bg-purple-50 border-purple-200'
    }

    const isInDragRange = (empIdx: number, dateIdx: number) => {
        if (!dragFill) return false
        const minEmp = Math.min(dragFill.empIdx, dragFill.endEmpIdx)
        const maxEmp = Math.max(dragFill.empIdx, dragFill.endEmpIdx)
        const minDate = Math.min(dragFill.dateIdx, dragFill.endDateIdx)
        const maxDate = Math.max(dragFill.dateIdx, dragFill.endDateIdx)
        return empIdx >= minEmp && empIdx <= maxEmp && dateIdx >= minDate && dateIdx <= maxDate
    }

    return (
        <div className={cn(
            "flex flex-col overflow-hidden transition-all",
            compact ? "p-0 bg-transparent" : "flex-1"
        )}>
            {/* Portal: title only — same pattern as clerk/reports */}
            {mounted && portalTarget && createPortal(
                <div className="flex items-center gap-3">
                    <h1 className="text-xl font-black text-slate-800 tracking-tight">Chấm công & Tăng ca</h1>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest hidden lg:block">
                        Quản lý điểm danh và tăng ca nhân sự
                    </p>
                </div>,
                portalTarget
            )}

            {/* Controls bar — mirrors clerk/reports tab + date controls layout */}
            {!compact && (
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4 shrink-0">
                    <div className="flex items-center gap-6 border-b border-slate-200 w-full lg:w-auto">
                        <button
                            onClick={() => setViewMode('attendance')}
                            className={cn(
                                "relative py-3 px-1 text-[13px] font-medium transition-all text-slate-400 hover:text-blue-600",
                                viewMode === 'attendance' && "text-blue-600 font-bold"
                            )}
                        >
                            Điểm danh
                            {viewMode === 'attendance' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />}
                        </button>
                        <button
                            onClick={() => setViewMode('ot')}
                            className={cn(
                                "relative py-3 px-1 text-[13px] font-medium transition-all text-slate-400 hover:text-orange-500",
                                viewMode === 'ot' && "text-orange-600 font-bold"
                            )}
                        >
                            Tăng ca
                            {viewMode === 'ot' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-full" />}
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 ml-auto">
                        <div className="flex items-center gap-1 bg-white border border-slate-200/80 rounded-2xl p-1 shadow-sm">
                            <button onClick={() => setCurrentCycleDate(subMonths(currentCycleDate, 1))} className="p-1.5 hover:bg-slate-50 hover:text-blue-600 rounded-xl transition-all text-slate-400">
                                <ChevronLeft size={16} />
                            </button>
                            <div className="flex items-center gap-2 px-2 min-w-25 justify-center">
                                <Calendar size={14} className="text-blue-500" />
                                <span className="text-xs font-black text-slate-700 whitespace-nowrap">
                                    Công tháng {format(cycleMonth, 'M')}
                                </span>
                            </div>
                            <button onClick={() => setCurrentCycleDate(addMonths(currentCycleDate, 1))} className="p-1.5 hover:bg-slate-50 hover:text-blue-600 rounded-xl transition-all text-slate-400">
                                <ChevronRight size={16} />
                            </button>
                        </div>

                        <div className="flex items-center bg-slate-100/50 p-1 rounded-2xl border border-slate-200/60 shadow-inner">
                            <button
                                onClick={() => setPeriodIndex(0)}
                                className={cn(
                                    "px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                                    periodIndex === 0 ? "bg-white text-blue-600 shadow-sm border border-slate-200/40" : "text-slate-400 hover:text-slate-600"
                                )}
                            >
                                Đợt 1 (21–05)
                            </button>
                            <button
                                onClick={() => setPeriodIndex(1)}
                                className={cn(
                                    "px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                                    periodIndex === 1 ? "bg-white text-blue-600 shadow-sm border border-slate-200/40" : "text-slate-400 hover:text-slate-600"
                                )}
                            >
                                Đợt 2 (06–20)
                            </button>
                        </div>

                        <div className="relative">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Tên nhân viên..."
                                className="pl-9 pr-4 py-2 bg-white border border-slate-200/80 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold text-slate-600 shadow-sm w-36"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>

                        <div className="relative">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Mã NV (ID)..."
                                className="pl-9 pr-4 py-2 bg-white border border-slate-200/80 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold text-slate-600 shadow-sm w-32"
                                value={idFilter}
                                onChange={e => setIdFilter(e.target.value)}
                            />
                        </div>

                        <select
                            value={selectedLeader}
                            onChange={e => setSelectedLeader(e.target.value)}
                            className="px-3 py-2 bg-white border border-slate-200/80 rounded-xl text-sm font-semibold text-slate-600 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                            <option value="">Tất cả Leader</option>
                            {uniqueLeaders.map(l => (
                                <option key={l} value={l}>{l}</option>
                            ))}
                        </select>

                        <select
                            value={selectedSupervisor}
                            onChange={e => setSelectedSupervisor(e.target.value)}
                            className="px-3 py-2 bg-white border border-slate-200/80 rounded-xl text-sm font-semibold text-slate-600 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                            <option value="">Tất cả Supervisor</option>
                            {uniqueSupervisors.map(s => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>

                        <div className="flex items-center justify-center px-4 py-2 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-black text-slate-500 shadow-inner min-w-[80px]">
                            {filteredEmployees.length} NV
                        </div>

                        <button
                            onClick={() => fetchMonthly(true)}
                            disabled={loading}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200/80 rounded-xl text-xs font-bold text-slate-600 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-200 transition-all shadow-sm disabled:opacity-50"
                        >
                            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                            Làm mới
                        </button>
                    </div>
                </div>
            )}

            <div className={cn(
                "bg-white shadow-sm border border-slate-100 flex-1 flex flex-col overflow-hidden relative",
                compact ? "rounded-2xl" : "rounded-3xl"
            )}>
                <div className={cn("flex items-center justify-between border-b border-slate-100 bg-slate-50/30", compact ? "p-3 px-5" : "p-4 px-6")}>
                    <div className="flex items-center gap-4">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            {paginatedEmployees.length} nhân viên
                        </span>
                        {errorCell && (
                            <div className="flex items-center gap-1.5 text-rose-500 animate-pulse bg-rose-50 px-3 py-1 rounded-full border border-rose-100">
                                <AlertCircle size={14} />
                                <span className="text-[10px] font-black uppercase">Nhập sai mã!</span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} className="p-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-30 text-slate-400 hover:text-blue-500 transition-all">
                            <ChevronLeft size={16} />
                        </button>
                        <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest min-w-[70px] text-center">
                            Trang {currentPage}/{totalPages || 1}
                        </span>
                        <button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages || totalPages === 0} className="p-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-30 text-slate-400 hover:text-blue-500 transition-all">
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full text-left whitespace-nowrap table-fixed border-collapse">
                        <thead className="sticky top-0 z-20 bg-slate-50/80 backdrop-blur-md">
                            <tr>
                                <th className="py-4 px-6 font-black text-[10px] text-slate-400 uppercase tracking-widest border-b border-slate-100 w-[200px]">Nhân viên</th>
                                <th className="py-4 px-4 font-black text-[10px] text-slate-400 uppercase tracking-widest border-b border-slate-100 w-[110px]">Chức danh</th>
                                <th className="py-4 px-4 font-black text-[10px] text-slate-400 uppercase tracking-widest border-b border-slate-100 w-[110px]">Leader</th>
                                {daysInPeriod.map((d) => {
                                    const isWeekend = d.getDay() === 0 || d.getDay() === 6
                                    const isToday = format(d, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
                                    return (
                                        <th key={d.toString()} className="text-center py-4 px-1 border-b border-slate-100 min-w-[65px]">
                                            <div className="flex flex-col items-center justify-center gap-0.5">
                                                <span className={cn("text-[8px] font-black uppercase tracking-widest", isToday ? "text-blue-600" : (isWeekend ? "text-rose-400" : "text-slate-400"))}>{getWeekday(d)}</span>
                                                <span className={cn("text-xs font-black", isToday ? "text-blue-600" : (isWeekend ? "text-rose-500" : "text-slate-700"))}>{format(d, 'dd')}</span>
                                            </div>
                                        </th>
                                    )
                                })}
                                <th className="py-4 px-4 font-black text-[10px] text-slate-400 uppercase tracking-widest border-b border-slate-100 w-[70px] text-center">Tổng</th>
                            </tr>
                        </thead>
                        <tbody className="text-[13px] divide-y divide-slate-50">
                            {paginatedEmployees.length === 0 && (
                                <tr>
                                    <td colSpan={daysInPeriod.length + 4} className="py-20 text-center">
                                        <div className="flex flex-col items-center gap-3 text-slate-300">
                                            <ClipboardList className="w-12 h-12" />
                                            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Không có dữ liệu</p>
                                            <p className="text-xs text-slate-300">Không tìm thấy nhân viên nào cho kỳ này</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                            {paginatedEmployees.map((emp, idx) => (
                                <tr key={emp.id} className={cn("hover:bg-blue-50/30 transition-colors group", idx % 2 === 1 && "bg-slate-50/40")}>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-black text-[10px] shrink-0 border border-slate-200">
                                                {emp.fullName.split(' ').pop()?.[0]}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="font-bold text-slate-800 truncate text-[11px] leading-none mb-1">{emp.fullName}</div>
                                                <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{emp.employeeCode}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-slate-500 text-[10px] truncate">{emp.title || '-'}</td>
                                    <td className="px-4 py-4 text-slate-400 text-[10px] truncate font-medium">{emp.leaderName || '-'}</td>
                                    {daysInPeriod.map((d, dIdx) => {
                                        const dateStr = format(d, 'yyyy-MM-dd')
                                        const isEditing = editingCell?.empId === emp.id && editingCell?.dateStr === dateStr && editingCell?.type === viewMode
                                        const isError = errorCell === `${emp.id}-${dateStr}`
                                        const val = viewMode === 'attendance' 
                                            ? (mode === 'clerk' ? emp.clerkAttendances?.[dateStr] : emp.attendances?.[dateStr])
                                            : (mode === 'clerk' ? emp.clerkOvertimes?.[dateStr] : emp.overtimes?.[dateStr])
                                        return (
                                            <td
                                                key={dateStr}
                                                className={cn("p-0.5 border-r border-slate-50/50 relative group/cell", isInDragRange(idx, dIdx) && "bg-blue-50/70")}
                                                onMouseEnter={() => { if (dragFill) setDragFill(prev => prev ? { ...prev, endEmpIdx: idx, endDateIdx: dIdx } : null) }}
                                            >
                                                <div className="flex items-center justify-center h-9 relative">
                                                    {/* OT mode: inline number input (no floating picker) */}
                                                    {isEditing && viewMode === 'ot' ? (
                                                        <div data-cell-btn className="relative w-full px-0.5">
                                                            <input
                                                                autoFocus
                                                                type="number"
                                                                min={0}
                                                                max={24}
                                                                step={0.5}
                                                                placeholder="0"
                                                                className={cn("w-full h-7 text-[10px] font-black text-center border-2 outline-none rounded-md transition-all", isError ? "border-rose-500 bg-rose-50 text-rose-600" : "border-orange-400 bg-white text-orange-600")}
                                                                defaultValue={(val as number) > 0 ? val : ''}
                                                                onKeyDown={e => {
                                                                    if (e.key === 'Enter') { handleInlineSave(emp.id, dateStr, parseFloat((e.target as HTMLInputElement).value) || 0, 'ot'); setEditingCell(null); }
                                                                    if (e.key === 'Escape') { setEditingCell(null); setErrorCell(null); }
                                                                }}
                                                                onBlur={e => { handleInlineSave(emp.id, dateStr, parseFloat(e.target.value) || 0, 'ot'); setEditingCell(null); }}
                                                            />
                                                        </div>
                                                    ) : (
                                                        /* Attendance & OT (non-editing): show value badge, click opens picker */
                                                        <div
                                                            data-cell-btn
                                                            className={cn(
                                                                "w-9 h-7 flex items-center justify-center text-[10px] font-black rounded-md cursor-pointer transition-all border shadow-sm",
                                                                isEditing && "ring-2 ring-blue-400 ring-offset-1 scale-110",
                                                                viewMode === 'attendance' ? getStatusColor(val as string) : getOtColor(val as number)
                                                            )}
                                                            onClick={(e) => {
                                                                if (viewMode === 'ot') {
                                                                    setEditingCell({ empId: emp.id, dateStr, type: 'ot' })
                                                                } else {
                                                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                                                    setEditingCell({ empId: emp.id, dateStr, type: 'attendance' })
                                                                    setPickerRect({ top: rect.bottom + 6, left: rect.left + rect.width / 2 })
                                                                }
                                                            }}
                                                        >
                                                            {viewMode === 'attendance' ? getStatusText(val as string) : (val ? `${val}` : '0')}
                                                        </div>
                                                    )}
                                                    {!isEditing && (
                                                        <div
                                                            data-drag-handle
                                                            className="absolute bottom-0 right-0 w-2 h-2 bg-blue-500 border border-white z-10 opacity-0 group-hover/cell:opacity-100 transition-all cursor-crosshair"
                                                            style={{ borderRadius: '1px' }}
                                                            onMouseDown={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                setDragFill({ empIdx: idx, dateIdx: dIdx, endEmpIdx: idx, endDateIdx: dIdx, value: val !== undefined && val !== null ? val : '', type: viewMode })
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                            </td>
                                        )
                                    })}
                                    <td className="px-2 text-center font-black text-slate-700 bg-slate-50/30 text-[11px]">
                                        {viewMode === 'attendance' 
                                            ? Object.values((mode === 'clerk' ? emp.clerkAttendances : emp.attendances) || {}).filter(s => s === 'X' || s.includes('X')).length 
                                            : Object.values((mode === 'clerk' ? emp.clerkOvertimes : emp.overtimes) || {}).reduce((a, b) => a + (b as number), 0)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Floating option picker ── */}
            {mounted && editingCell && pickerRect && createPortal(
                <div
                    data-shift-picker
                    className="fixed z-9999 animate-in fade-in zoom-in-95 duration-150"
                    style={{
                        top: Math.min(pickerRect.top, window.innerHeight - 200),
                        left: Math.max(8, Math.min(pickerRect.left - 160, window.innerWidth - 340)),
                    }}
                >
                    <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-3 w-80">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2.5">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                {editingCell.type === 'attendance' ? 'Chọn trạng thái / ca' : 'Chọn giờ tăng ca'}
                            </span>
                            <button
                                onMouseDown={(e) => { e.preventDefault(); setEditingCell(null); setPickerRect(null); }}
                                className="text-slate-300 hover:text-slate-600 transition-colors p-0.5 rounded"
                            >
                                <X size={13} />
                            </button>
                        </div>

                        {editingCell.type === 'attendance' ? (
                            <>
                                {/* Clear */}
                                <div className="flex flex-wrap gap-1.5 mb-3">
                                    <button
                                        onMouseDown={(e) => { e.preventDefault(); handleInlineSave(editingCell.empId, editingCell.dateStr, '', 'attendance'); setEditingCell(null); setPickerRect(null); }}
                                        className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-dashed border-slate-200 text-slate-400 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-all"
                                    >
                                        — Xóa
                                    </button>
                                </div>

                                {/* Static statuses */}
                                <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-1.5">Trạng thái</p>
                                <div className="flex flex-wrap gap-1.5 mb-3">
                                    {STATIC_STATUSES.map(s => {
                                        const meta = STATUS_META[s]
                                        return (
                                            <button
                                                key={s}
                                                onMouseDown={(e) => { e.preventDefault(); handleInlineSave(editingCell.empId, editingCell.dateStr, s, 'attendance'); setEditingCell(null); setPickerRect(null); }}
                                                className={cn("flex flex-col items-center px-2.5 py-1.5 rounded-lg border text-[10px] font-black transition-all active:scale-95", meta?.cls ?? 'bg-slate-100 text-slate-600 hover:bg-slate-200 border-slate-200')}
                                            >
                                                <span>{s}</span>
                                                {meta && <span className="text-[8px] font-medium opacity-70 leading-tight">{meta.label}</span>}
                                            </button>
                                        )
                                    })}
                                </div>

                                {/* Shift codes */}
                                {shifts.length > 0 && (
                                    <>
                                        <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-1.5">Ca làm việc</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {shifts.map(s => (
                                                <button
                                                    key={s.code}
                                                    onMouseDown={(e) => { e.preventDefault(); handleInlineSave(editingCell.empId, editingCell.dateStr, s.code, 'attendance'); setEditingCell(null); setPickerRect(null); }}
                                                    className="flex flex-col items-center px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-[10px] font-black transition-all active:scale-95"
                                                >
                                                    <span>{s.code}</span>
                                                    {s.name && <span className="text-[8px] font-medium opacity-70 leading-tight">{s.name}</span>}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </>
                        ) : (
                            <>
                                {/* OT quick-picks */}
                                <div className="flex flex-wrap gap-1.5 mb-3">
                                    <button
                                        onMouseDown={(e) => { e.preventDefault(); handleInlineSave(editingCell.empId, editingCell.dateStr, 0, 'ot'); setEditingCell(null); setPickerRect(null); }}
                                        className="px-2.5 py-1.5 text-[10px] font-bold rounded-lg border border-dashed border-slate-200 text-slate-400 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-all"
                                    >
                                        — Xóa
                                    </button>
                                    {OT_QUICK_PICKS.map(h => (
                                        <button
                                            key={h}
                                            onMouseDown={(e) => { e.preventDefault(); handleInlineSave(editingCell.empId, editingCell.dateStr, h, 'ot'); setEditingCell(null); setPickerRect(null); }}
                                            className="px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 text-[10px] font-black transition-all active:scale-95 flex items-center gap-1"
                                        >
                                            <Clock size={9} />
                                            {h}h
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-1.5">Hoặc nhập tay</p>
                                <input
                                    autoFocus
                                    type="number"
                                    min={0}
                                    max={24}
                                    step={0.5}
                                    placeholder="VD: 2.5"
                                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 transition-all"
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') { handleInlineSave(editingCell.empId, editingCell.dateStr, parseFloat((e.target as HTMLInputElement).value) || 0, 'ot'); setEditingCell(null); setPickerRect(null); }
                                        if (e.key === 'Escape') { setEditingCell(null); setPickerRect(null); }
                                    }}
                                />
                            </>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
