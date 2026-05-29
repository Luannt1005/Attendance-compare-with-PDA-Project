'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '@/lib/AuthContext'
import { format, startOfMonth, addDays, getDaysInMonth, subMonths, addMonths, eachDayOfInterval, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, FileSpreadsheet, Download, RefreshCw, Loader2, Send, Inbox, Search, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionStorage } from '@/hooks/useSessionStorage'
import { SendTransferModal, IncomingTransfersModal } from './TransferModals'
import * as XLSX from 'xlsx'
import { TableVirtuoso } from 'react-virtuoso'

// Dynamic allowed statuses loaded from db via allowedStatuses state
const STATIC_LEAVES = ['AL', 'UP', 'UPP', 'SL', 'AL/2', 'UP/2', 'Preg', '']
const STATUS_COLORS: Record<string, string> = {
    'AL': 'bg-amber-50/50 text-amber-600 font-bold border-r border-amber-100/50',
    'UP': 'bg-slate-50 text-slate-400 font-medium',
    'UPP': 'bg-rose-50/50 text-rose-500 font-bold border-r border-rose-100/50',
    'SL': 'bg-blue-50/50 text-blue-500 font-bold border-r border-blue-100/50',
    'AL/2': 'bg-amber-50/30 text-amber-500/70',
    'UP/2': 'bg-slate-50/50 text-slate-300',
    'Preg': 'bg-pink-50/50 text-pink-500 font-bold border-r border-pink-100/50'
}

const VirtuosoComponents = {
    Table: React.forwardRef((props, ref) => <table {...props} ref={ref as any} className="w-full border-collapse whitespace-nowrap text-gray-700 select-none m-0 shadow-sm" />),
    TableHead: React.forwardRef((props, ref) => <thead {...props} ref={ref as any} className="z-50 shadow-sm" />),
    TableBody: React.forwardRef((props, ref) => <tbody {...props} ref={ref as any} className="bg-white divide-y divide-gray-100" />),
    TableRow: (props: any) => <tr {...props} className="transition-all group hover:bg-violet-50/50" />
};

const MemoCell = memo(({
    idx, dayIdx, dateStr, empId, val, isEdited, pendingVal, isError,
    activeTab, canEdit, isFillTarget, isFillOrigin, isSelectedArea, isFocused, colorClass,
    onMouseDown, onMouseEnter, onChange, onFocus, onDragStart, onContextMenu
}: any) => {
    const displayVal = isEdited ? pendingVal : (val || '');
    return (
        <td
            onMouseDown={(e) => onMouseDown(e, idx, dayIdx)}
            onMouseEnter={() => onMouseEnter(idx, dayIdx)}
            onContextMenu={(e) => onContextMenu(e, idx, dayIdx)}
            className={cn(
                "border-r border-gray-300 p-0 text-center relative h-full transition-colors",
                colorClass,
                isEdited && !isError && "bg-blue-100",
                isError && "bg-red-200 text-red-900 border-2 border-red-500 inset-0 z-10",
                isFillTarget && !isFillOrigin && "bg-blue-200/60 outline-1 outline-blue-400 z-10",
                isSelectedArea && !isFocused && "bg-blue-100/60",
                isFocused && "outline-2 outline-blue-600 z-20 bg-white"
            )}>
            {canEdit ? (
                <>
                    <input
                        id={`cell-${idx}-${dayIdx}`}
                        type="text"
                        value={displayVal}
                        onChange={(e) => onChange(empId, dateStr, e.target.value)}
                        onFocus={() => onFocus(idx, dayIdx)}
                        className={cn(
                            "w-full h-full min-h-[28px] text-center bg-transparent outline-none focus:ring-0 relative caret-black font-semibold text-gray-800",
                            isError && "text-red-900"
                        )}
                        maxLength={4}
                    />
                    {isFocused && (
                        <div
                            className="absolute -bottom-[4px] -right-[4px] w-[8px] h-[8px] bg-blue-600 border border-white cursor-crosshair z-30"
                            onMouseDown={(e) => onDragStart(e, idx, dayIdx, displayVal?.toString() || '')}
                        />
                    )}
                </>
            ) : (
                <div className="w-full h-full min-h-[28px] flex items-center justify-center font-semibold text-gray-800">
                    {displayVal}
                </div>
            )}
        </td>
    )
})

interface ExcelTimesheetProps {
    mode?: 'leader' | 'clerk'
}

export default function ExcelTimesheet({ mode = 'leader' }: ExcelTimesheetProps) {
    const { user } = useAuth()
    const canEdit = ['Leader', 'Clerk', 'clerk', 'Admin'].includes(user?.role || '')
    const [mounted, setMounted] = useState(false)
    const [currentDate, setCurrentDate] = useState(new Date('2026-02-01T00:00:00Z'))
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [employees, setEmployees] = useState<any[]>([])
    const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({})
    const [pendingOTChanges, setPendingOTChanges] = useState<Record<string, string>>({})
    const [errors, setErrors] = useState<Record<string, boolean>>({})
    const [activeTab, setActiveTab] = useState<'attendance' | 'ot'>('attendance')
    const [allowedStatuses, setAllowedStatuses] = useState<string[]>(STATIC_LEAVES)

    // Fill Handle states
    const [focusedCell, setFocusedCell] = useState<{ r: number, c: number } | null>(null)
    const [dragStart, setDragStart] = useState<{ r: number, c: number, val: string } | null>(null)
    const [dragCurrent, setDragCurrent] = useState<{ r: number, c: number } | null>(null)
    const [isDraggingFill, setIsDraggingFill] = useState(false)

    // Selection block states
    const [selectionStart, setSelectionStart] = useState<{ r: number, c: number } | null>(null)
    const [selectionEnd, setSelectionEnd] = useState<{ r: number, c: number } | null>(null)
    const [isSelecting, setIsSelecting] = useState(false)
    const [viewMode, setViewMode] = useState<'excel' | 'table'>('table')
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(50)

    // Transfer states
    const [transferMode, setTransferMode] = useState(false)
    const [selectedEmployees, setSelectedEmployees] = useState<number[]>([])
    const [showSendModal, setShowSendModal] = useState(false)
    const [showInboxModal, setShowInboxModal] = useState(false)
    const [isImporting, setIsImporting] = useState(false)
    const [searchQuery, setSearchQuery] = useSessionStorage('timesheet_search', '')
    const [selectedLeader, setSelectedLeader] = useSessionStorage('timesheet_leader', '')
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null)

    const [shifts, setShifts] = useState<{ id: number, code: string, name: string | null }[]>([])
    const [showLeaveModal, setShowLeaveModal] = useState(false)
    const [leaveBase, setLeaveBase] = useState('UP')
    const [leaveShift, setLeaveShift] = useState('')
    const [syncDates, setSyncDates] = useState<string[]>([])
    const [showSyncDropdown, setShowSyncDropdown] = useState(false)

    // Refs for stable callbacks
    const stateRef = useRef({ isDraggingFill, isSelecting })
    useEffect(() => { stateRef.current = { isDraggingFill, isSelecting } }, [isDraggingFill, isSelecting])

    const monthStr = format(currentDate, 'yyyy-MM')

    const filteredEmployees = useMemo(() => {
        return employees.filter(emp => {
            const matchesSearch = emp.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                String(emp.employeeCode).toLowerCase().includes(searchQuery.toLowerCase())
            const matchesLeader = selectedLeader ? emp.leaderName === selectedLeader : true
            return matchesSearch && matchesLeader
        })
    }, [employees, searchQuery, selectedLeader])

    const totalPages = Math.ceil(filteredEmployees.length / pageSize)
    const paginatedEmployees = useMemo(() => {
        if (viewMode === 'excel') return filteredEmployees
        const start = (currentPage - 1) * pageSize
        return filteredEmployees.slice(start, start + pageSize)
    }, [filteredEmployees, currentPage, pageSize, viewMode])

    useEffect(() => {
        setCurrentPage(1)
    }, [searchQuery, selectedLeader, pageSize])

    const uniqueLeaders = useMemo(() => {
        const leaders = new Set<string>()
        employees.forEach(e => leaders.add(e.leaderName))
        return Array.from(leaders).sort()
    }, [employees])

    const days = useMemo(() => {
        const year = currentDate.getFullYear()
        const month = currentDate.getMonth()

        const start = new Date(year, month - 1, 21)
        const end = new Date(year, month, 20)
        return eachDayOfInterval({ start, end })
    }, [currentDate])

    const fetchMonthly = async () => {
        if (!user) return
        setLoading(true)
        try {
            let url = mode === 'clerk' ? `/api/clerk-attendance/month?month=${monthStr}` : `/api/attendance/month?month=${monthStr}`
            if (user.role === 'Leader') {
                url += `&leaderId=${user.id}`
            }
            const res = await fetch(url, { cache: 'no-store' })
            const json = await res.json()
            if (res.ok) {
                setEmployees(json.data || [])
            }
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    const fetchShifts = async () => {
        try {
            const res = await fetch('/api/shifts')
            const json = await res.json()
            if (res.ok) setShifts(json.data || [])
        } catch (err) { }
    }

    useEffect(() => {
        setMounted(true)
        fetchShifts()
    }, [])

    useEffect(() => {
        fetchMonthly()
    }, [user, monthStr])

    const performCopy = async () => {
        if (!selectionStart || !selectionEnd) return;
        const minSelR = Math.min(selectionStart.r, selectionEnd.r)
        const maxSelR = Math.max(selectionStart.r, selectionEnd.r)
        const minSelC = Math.min(selectionStart.c, selectionEnd.c)
        const maxSelC = Math.max(selectionStart.c, selectionEnd.c)

        const strRows = []
        for (let r = minSelR; r <= maxSelR; r++) {
            const empId = filteredEmployees[r]?.id
            const rowVals = []
            for (let c = minSelC; c <= maxSelC; c++) {
                const dateStr = format(days[c], 'yyyy-MM-dd')
                const keyStr = `${empId}_${dateStr}`
                if (activeTab === 'ot') {
                    const otData = mode === 'clerk' ? filteredEmployees[r]?.clerkOvertimes : filteredEmployees[r]?.overtimes
                    const rawOt = otData?.[dateStr]
                    const isEdited = pendingOTChanges[keyStr] !== undefined
                    rowVals.push(isEdited ? pendingOTChanges[keyStr] : (rawOt || ''))
                } else {
                    const attData = mode === 'clerk' ? filteredEmployees[r]?.clerkAttendances : filteredEmployees[r]?.attendances
                    const rawStatus = attData?.[dateStr] || ''
                    let actualStatus = (rawStatus.startsWith('M_') || rawStatus.startsWith('A_')) ? rawStatus.split('_')[1] : rawStatus;
                    if (actualStatus === 'P') actualStatus = 'S1';
                    const isEdited = pendingChanges[keyStr] !== undefined
                    rowVals.push(isEdited ? pendingChanges[keyStr] : actualStatus)
                }
            }
            strRows.push(rowVals.join('\t'))
        }
        try { await navigator.clipboard.writeText(strRows.join('\n')) } catch (e) { }
    }

    const performClear = () => {
        if (!canEdit) return;
        if (!selectionStart || !selectionEnd) return;
        const minSelR = Math.min(selectionStart.r, selectionEnd.r)
        const maxSelR = Math.max(selectionStart.r, selectionEnd.r)
        const minSelC = Math.min(selectionStart.c, selectionEnd.c)
        const maxSelC = Math.max(selectionStart.c, selectionEnd.c)

        setErrors(prev => {
            const newErrors = { ...prev }
            for (let r = minSelR; r <= maxSelR; r++) {
                const empId = filteredEmployees[r]?.id
                for (let c = minSelC; c <= maxSelC; c++) {
                    const dateStr = format(days[c], 'yyyy-MM-dd')
                    const keyStr = `${empId}_${dateStr}`
                    if (empId) {
                        const pre = activeTab === 'ot' ? 'ot_' : 'att_'
                        delete newErrors[`${pre}${keyStr}`]
                    }
                }
            }
            return newErrors
        })

        for (let r = minSelR; r <= maxSelR; r++) {
            const empId = filteredEmployees[r]?.id
            for (let c = minSelC; c <= maxSelC; c++) {
                const dateStr = format(days[c], 'yyyy-MM-dd')
                if (empId) {
                    handleCellChange(empId, dateStr, '')
                }
            }
        }
    }

    const performCut = async () => {
        if (!canEdit) return;
        await performCopy()
        performClear()
    }

    const performDelete = async () => {
        if (!canEdit) return;
        if (!selectionStart || !selectionEnd) return;
        const minSelR = Math.min(selectionStart.r, selectionEnd.r)
        const maxSelR = Math.max(selectionStart.r, selectionEnd.r)

        const empIdsToDelete: number[] = [];
        for (let r = minSelR; r <= maxSelR; r++) {
            const empId = filteredEmployees[r]?.id;
            if (empId) empIdsToDelete.push(empId);
        }

        if (empIdsToDelete.length === 0) return;

        if (!confirm(`Bạn có chắc muốn xóa dòng của ${empIdsToDelete.length} nhân viên khỏi bảng chấm công tháng này không?\n\n(Dữ liệu điểm danh của họ trong tháng này sẽ bị xóa và họ sẽ biến mất khỏi danh sách)`)) {
            return;
        }

        try {
            const res = await fetch(mode === 'clerk' ? '/api/clerk-attendance/delete-row' : '/api/attendance/delete-row', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employeeIds: empIdsToDelete, targetMonth: monthStr })
            });

            if (res.ok) {
                // Remove from local employees state directly to reflect UI instantly
                setEmployees(prev => prev.filter(emp => !empIdsToDelete.includes(emp.id)));

                // Also remove them from memory dictionaries to prevent submitting ghosts
                setPendingChanges(prev => {
                    const next = { ...prev };
                    for (const key of Object.keys(next)) {
                        const [empId] = key.split('_');
                        if (empIdsToDelete.includes(parseInt(empId))) {
                            delete next[key];
                        }
                    }
                    return next;
                });

                setPendingOTChanges(prev => {
                    const next = { ...prev };
                    for (const key of Object.keys(next)) {
                        const [empId] = key.split('_');
                        if (empIdsToDelete.includes(parseInt(empId))) {
                            delete next[key];
                        }
                    }
                    return next;
                });

                setErrors(prev => {
                    const next = { ...prev };
                    for (const key of Object.keys(next)) {
                        const parts = key.split('_');
                        if (parts.length >= 2 && empIdsToDelete.includes(parseInt(parts[1]))) {
                            delete next[key];
                        }
                    }
                    return next;
                });

                setIsSelecting(false);
                setSelectionStart(null);
                setSelectionEnd(null);
            } else {
                alert('Có lỗi xảy ra khi xóa!');
            }
        } catch (e) {
            console.error(e);
            alert('Lỗi kết nối');
        }
    }

    useEffect(() => {
        const handleClick = () => setContextMenu(null)
        window.addEventListener('click', handleClick)

        const handleMouseUp = () => {
            if (isDraggingFill && dragStart && dragCurrent) {
                const minR = Math.min(dragStart.r, dragCurrent.r)
                const maxR = Math.max(dragStart.r, dragCurrent.r)
                const minC = Math.min(dragStart.c, dragCurrent.c)
                const maxC = Math.max(dragStart.c, dragCurrent.c)
                const dragVal = dragStart.val

                for (let r = minR; r <= maxR; r++) {
                    const empId = filteredEmployees[r]?.id
                    for (let c = minC; c <= maxC; c++) {
                        if (r === dragStart.r && c === dragStart.c) continue
                        const dateStr = format(days[c], 'yyyy-MM-dd')
                        if (empId) {
                            handleCellChange(empId, dateStr, dragVal)
                        }
                    }
                }

                setIsDraggingFill(false)
                setDragStart(null)
                setDragCurrent(null)
            }
            if (isSelecting) {
                setIsSelecting(false)
            }
        }

        const handleKeyDown = async (e: KeyboardEvent) => {
            const targetElement = e.target as HTMLElement;
            const isInputActive = targetElement.tagName === 'INPUT';

            if (focusedCell && e.key.startsWith('Arrow')) {
                const maxR = filteredEmployees.length - 1;
                const maxC = days.length - 1;

                let { r: newR, c: newC } = focusedCell;
                let preventDefault = false;

                if (e.key === 'ArrowUp') {
                    newR = e.ctrlKey || e.metaKey ? 0 : Math.max(0, newR - 1);
                    preventDefault = true;
                } else if (e.key === 'ArrowDown') {
                    newR = e.ctrlKey || e.metaKey ? maxR : Math.min(maxR, newR + 1);
                    preventDefault = true;
                } else if (e.key === 'ArrowLeft') {
                    if (e.ctrlKey || e.metaKey) {
                        newC = 0;
                        preventDefault = true;
                    } else if (!isInputActive || (targetElement as HTMLInputElement).selectionStart === 0) {
                        newC = Math.max(0, newC - 1);
                        preventDefault = true;
                    }
                } else if (e.key === 'ArrowRight') {
                    if (e.ctrlKey || e.metaKey) {
                        newC = maxC;
                        preventDefault = true;
                    } else if (!isInputActive || (targetElement as HTMLInputElement).selectionStart === (targetElement as HTMLInputElement).value.length) {
                        newC = Math.min(maxC, newC + 1);
                        preventDefault = true;
                    }
                }

                if (preventDefault || e.shiftKey) {
                    if (preventDefault) e.preventDefault();

                    if (e.shiftKey) {
                        setSelectionEnd({ r: newR, c: newC });
                    } else {
                        setSelectionStart({ r: newR, c: newC });
                        setSelectionEnd({ r: newR, c: newC });
                        setFocusedCell({ r: newR, c: newC });

                        setTimeout(() => {
                            const el = document.getElementById(`cell-${newR}-${newC}`);
                            if (el) {
                                el.focus();
                                // Optional: select all text in input to match excel behavior
                                if (el.tagName === 'INPUT') (el as HTMLInputElement).select();
                            }
                        }, 0);
                    }
                    return;
                }
            }

            const minSelR = selectionStart && selectionEnd ? Math.min(selectionStart.r, selectionEnd.r) : -1;
            const maxSelR = selectionStart && selectionEnd ? Math.max(selectionStart.r, selectionEnd.r) : -1;
            const minSelC = selectionStart && selectionEnd ? Math.min(selectionStart.c, selectionEnd.c) : -1;
            const maxSelC = selectionStart && selectionEnd ? Math.max(selectionStart.c, selectionEnd.c) : -1;

            const isMultiSelect = minSelR !== -1 && (maxSelR > minSelR || maxSelC > minSelC);

            if (isMultiSelect || !isInputActive) {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    if (isMultiSelect) e.preventDefault();
                    if (canEdit) performClear();
                } else if (e.ctrlKey || e.metaKey) {
                    if (e.key === 'c' || e.key === 'C') {
                        if (isMultiSelect) {
                            e.preventDefault();
                            await performCopy();
                        }
                    } else if (e.key === 'x' || e.key === 'X') {
                        if (isMultiSelect) {
                            e.preventDefault();
                            await performCut();
                        }
                    }
                }
            }

            // Paste handling
            if (canEdit && (e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
                try {
                    const text = await navigator.clipboard.readText()
                    if (text.includes('\t') || text.includes('\n')) {
                        e.preventDefault();
                        const pasteRows = text.split(/\r?\n/).map(row => row.split('\t'))
                        const startR = selectionStart ? minSelR : (focusedCell?.r || 0)
                        const startC = selectionStart ? minSelC : (focusedCell?.c || 0)

                        for (let i = 0; i < pasteRows.length; i++) {
                            const targetR = startR + i
                            if (targetR >= filteredEmployees.length) break
                            const empId = filteredEmployees[targetR]?.id

                            for (let j = 0; j < pasteRows[i].length; j++) {
                                const targetC = startC + j
                                if (targetC >= days.length) break

                                const dateStr = format(days[targetC], 'yyyy-MM-dd')
                                if (empId && pasteRows[i][j] !== undefined) {
                                    handleCellChange(empId, dateStr, pasteRows[i][j])
                                }
                            }
                        }
                    }
                } catch (err) { }
            }
        }

        window.addEventListener('mouseup', handleMouseUp)
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('click', handleClick)
            window.removeEventListener('mouseup', handleMouseUp)
            window.removeEventListener('keydown', handleKeyDown)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDraggingFill, dragStart, dragCurrent, filteredEmployees, days, isSelecting, selectionStart, selectionEnd, user, activeTab, pendingChanges, pendingOTChanges, focusedCell])

    const nextMonth = () => setCurrentDate(addMonths(currentDate, 1))
    const prevMonth = () => setCurrentDate(subMonths(currentDate, 1))

    const handleCellChange = useCallback((empId: number, dateStr: string, value: string) => {
        if (!canEdit) return

        if (activeTab === 'ot') {
            const val = value.trim()
            const isError = val !== '' && (isNaN(Number(val)) || Number(val) < 0 || Number(val) > 24)
            setErrors(prev => ({ ...prev, [`ot_${empId}_${dateStr}`]: isError }))

            setPendingOTChanges(prev => ({
                ...prev,
                [`${empId}_${dateStr}`]: val
            }))

            // Optimistic Update
            setEmployees(prev => prev.map(emp => {
                if (emp.id === empId) {
                    return {
                        ...emp,
                        overtimes: {
                            ...emp.overtimes,
                            [dateStr]: val === '' ? undefined : Number(val)
                        }
                    }
                }
                return emp
            }))
        } else {
            const val = value.trim().toUpperCase()
            const [baseVal] = val.split('_')

            let exactMatch = val;
            // Check if the baseVal is an allowed status
            const match = allowedStatuses.find((s: string) => s.toLowerCase() === baseVal.toLowerCase());
            if (match !== undefined) {
                // If baseVal matches an allowed status, use its canonical form and append any shift code
                exactMatch = match + (val.includes('_') ? val.substring(val.indexOf('_')) : '');
            } else {
                // If baseVal doesn't match, check if it's a valid shift code
                const shiftMatch = shifts.find(s => s.code.toLowerCase() === baseVal.toLowerCase());
                if (shiftMatch) {
                    // If it's a shift code, treat it as a regular shift (e.g., S1, S2)
                    exactMatch = shiftMatch.code;
                }
            }

            // An error occurs if the base part of the value is not an allowed status AND not a valid shift code
            const isError = exactMatch !== '' && !allowedStatuses.includes(exactMatch.split('_')[0]) && !shifts.some(s => s.code === exactMatch.split('_')[0]);

            setErrors(prev => ({ ...prev, [`att_${empId}_${dateStr}`]: isError }))

            setPendingChanges(prev => ({
                ...prev,
                [`${empId}_${dateStr}`]: exactMatch
            }))

            // Optimistic UI updates
            setEmployees(prev => prev.map(emp => {
                if (emp.id === empId) {
                    return {
                        ...emp,
                        attendances: {
                            ...emp.attendances,
                            [dateStr]: exactMatch
                        }
                    }
                }
                return emp
            }))
        }
    }, [activeTab, canEdit, allowedStatuses, shifts])

    const handleCellMouseDown = useCallback((e: React.MouseEvent, idx: number, dayIdx: number) => {
        if (e.button !== 0) return;
        setFocusedCell({ r: idx, c: dayIdx })
        setIsSelecting(true)
        setSelectionStart({ r: idx, c: dayIdx })
        setSelectionEnd({ r: idx, c: dayIdx })
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent, idx: number, dayIdx: number) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY })
        // If the right-clicked cell is not part of current selection, select it
        if (selectionStart && selectionEnd) {
            const minSelR = Math.min(selectionStart.r, selectionEnd.r)
            const maxSelR = Math.max(selectionStart.r, selectionEnd.r)
            const minSelC = Math.min(selectionStart.c, selectionEnd.c)
            const maxSelC = Math.max(selectionStart.c, selectionEnd.c)
            const isInSelection = idx >= minSelR && idx <= maxSelR && dayIdx >= minSelC && dayIdx <= maxSelC
            if (!isInSelection) {
                setSelectionStart({ r: idx, c: dayIdx })
                setSelectionEnd({ r: idx, c: dayIdx })
                setFocusedCell({ r: idx, c: dayIdx })
            }
        } else {
            setSelectionStart({ r: idx, c: dayIdx })
            setSelectionEnd({ r: idx, c: dayIdx })
            setFocusedCell({ r: idx, c: dayIdx })
        }
    }, [selectionStart, selectionEnd]);

    const handleCellMouseEnter = useCallback((idx: number, dayIdx: number) => {
        const { isDraggingFill, isSelecting } = stateRef.current;
        if (isDraggingFill) {
            setDragCurrent({ r: idx, c: dayIdx })
        } else if (isSelecting) {
            setSelectionEnd({ r: idx, c: dayIdx })
        }
    }, []);

    const handleCellFocus = useCallback((idx: number, dayIdx: number) => {
        setFocusedCell({ r: idx, c: dayIdx })
    }, []);

    const handleCellDragStart = useCallback((e: React.MouseEvent, idx: number, dayIdx: number, valToFill: string) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingFill(true)
        setDragStart({ r: idx, c: dayIdx, val: valToFill })
        setDragCurrent({ r: idx, c: dayIdx })
    }, []);

    const handleSave = async () => {
        const hasErrors = Object.values(errors).some(e => e)
        if (hasErrors) {
            if (activeTab === 'attendance') {
                alert('Có ô chứa giá trị không hợp lệ. Vui lòng sửa lại bằng đúng mã ca/nghỉ!')
            } else {
                alert('Có ô chứa thời gian tăng ca không hợp lệ (Phải là số). Vui lòng sửa lại!')
            }
            return
        }

        setSaving(true)
        const changesArray = Object.entries(pendingChanges).map(([key, status]) => {
            const [empId, recordDate] = key.split('_')
            return { employeeId: parseInt(empId), recordDate, status }
        })

        const otChangesArray = Object.entries(pendingOTChanges).map(([key, hours]) => {
            const [empId, recordDate] = key.split('_')
            return { employeeId: parseInt(empId), recordDate, hours }
        })

        try {
            const res = await fetch(mode === 'clerk' ? '/api/clerk-attendance/bulk' : '/api/attendance/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ changes: changesArray, otChanges: otChangesArray })
            })
            if (res.ok) {
                setPendingChanges({})
                setPendingOTChanges({})
                setErrors({})
                alert('Saved successfully!')
                fetchMonthly()
            }
        } catch (err) {
            console.error(err)
            alert('Failed to save changes')
        } finally {
            setSaving(false)
        }
    }

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setIsImporting(true)
        try {
            const data = await file.arrayBuffer()
            const workbook = XLSX.read(data, { type: 'array' })

            const attendanceSheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('attendance')) || workbook.SheetNames[0]
            const otSheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('ot'))

            const attSheet = workbook.Sheets[attendanceSheetName]
            const rawAttData = XLSX.utils.sheet_to_json(attSheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' }) as any[][]

            let rawOtData: any[][] = []
            if (otSheetName) {
                const otSheet = workbook.Sheets[otSheetName]
                rawOtData = XLSX.utils.sheet_to_json(otSheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' }) as any[][]
            }

            if (rawAttData.length < 2) {
                alert('File does not contain enough data.')
                return
            }

            const headers = rawAttData[0] as string[]
            
            const getColIdx = (aliases: string[]) => {
                for (const alias of aliases) {
                    const idx = headers.findIndex(h => h && String(h).trim().toLowerCase() === alias.toLowerCase())
                    if (idx !== -1) return idx;
                }
                return -1;
            }

            // Find employee info columns with prioritized aliases
            const empCodeIdx = getColIdx(['employee code', 'emp code', 'mã nhân viên'])
            const nameIdx = getColIdx(['full name', 'name in full', 'họ và tên', 'họ tên'])
            // Prioritize 'line leader' over 'contact person'
            const leaderIdx = getColIdx(['line leader', 'line leader name', 'leader', 'supervisor', 'contact person', 'người quản lý'])
            const picIdx = getColIdx(['pic'])
            const mgtIdx = getColIdx(['mgt (group)', 'mgt'])
            const typeIdx = getColIdx(['type', 'employmenttype'])
            const deptIdx = getColIdx(['dept', 'department', 'level 1'])
            const lineIdx = getColIdx(['line', 'location', 'level 4'])
            const statusIdx = getColIdx(['status', 'employee status'])
            const joinDateIdx = getColIdx(['joining date', 'start date'])
            const resignDateIdx = getColIdx(['last working date', 'end date'])
            const titleIdx = getColIdx(['title', 'chức vụ'])
            const supervisorIdx = getColIdx(['supervisor'])
            const shiftLeaderIdx = getColIdx(['shift leader'])
            const genderIdx = getColIdx(['gender', 'giới tính'])
            const vendorIdx = getColIdx(['detail vendor', 'vendor'])
            const zoneIdx = getColIdx(['zone', 'khu vực'])
            const muIdx = getColIdx(['mu'])

            if (empCodeIdx === -1 || leaderIdx === -1) {
                alert('Không tìm thấy dữ liệu hợp lệ. Vui lòng kiểm tra lại tiêu đề các cột: "Employee Code", "Full name", "Line Leader" (hoặc Supervisor/Contact person).')
                return
            }

            // Identify date columns
            const dateColumns: { index: number, dateStr: string }[] = []

            // Generate valid dates for the target month
            const yearStr = monthStr.split('-')[0]
            const monthIndex = parseInt(monthStr.split('-')[1]) - 1
            const targetYear = parseInt(yearStr)

            let prevYear = targetYear
            let prevMonthIndex = monthIndex - 1
            if (prevMonthIndex < 0) {
                prevMonthIndex = 11
                prevYear -= 1
            }
            // Timesheet cycle: 21st of prev month to 20th of target month. Use local timezone bound Dates.
            const cycleStart = new Date(prevYear, prevMonthIndex, 21, 12, 0, 0)
            const cycleEnd = new Date(targetYear, monthIndex, 20, 12, 0, 0)
            const daysInCycle = eachDayOfInterval({ start: cycleStart, end: cycleEnd })

            // Map header dates like "21-Dec" to actual Date objects
            const nonDateIndices = [empCodeIdx, nameIdx, leaderIdx, picIdx, mgtIdx, typeIdx, deptIdx, lineIdx, statusIdx, joinDateIdx, resignDateIdx, titleIdx, supervisorIdx, shiftLeaderIdx, genderIdx, vendorIdx, zoneIdx, muIdx]
            
            headers.forEach((h, idx) => {
                if (!nonDateIndices.includes(idx) && typeof h === 'string') {
                    // Try to parse "DD-MMM" (e.g., "21-Dec")
                    const match = h.trim().match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i)
                    if (match) {
                        const day = parseInt(match[1])
                        const mStr = match[2].toLowerCase()
                        const mNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
                        const mIdx = mNames.indexOf(mStr)

                        // Pick the date from the generated cycle matching day & month to ensure it is in cycle
                        const matchedDate = daysInCycle.find(d => d.getDate() === day && d.getMonth() === mIdx)
                        if (matchedDate) {
                            dateColumns.push({ index: idx, dateStr: format(matchedDate, 'yyyy-MM-dd') })
                        }
                    } else {
                        // Check if it's already a full date 'YYYY-MM-DD'
                        const dateMatch = h.trim().match(/^\d{4}-\d{2}-\d{2}$/)
                        const mdyMatch = h.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
                        
                        if (dateMatch) {
                            const d = new Date(h.trim())
                            if (!isNaN(d.getTime())) {
                                dateColumns.push({ index: idx, dateStr: h.trim() })
                            }
                        } else if (mdyMatch) {
                            const m = parseInt(mdyMatch[1]) - 1
                            const d = parseInt(mdyMatch[2])
                            const y = parseInt(mdyMatch[3])
                            const dObj = new Date(y, m, d)
                            if (!isNaN(dObj.getTime())) {
                                dateColumns.push({ index: idx, dateStr: format(dObj, 'yyyy-MM-dd') })
                            }
                        }
                    }
                }
            })

            // Check if there are any dates parsed, if not, then it might be invalid month data
            if (dateColumns.length === 0) {
                alert('Không tìm thấy cột ngày tháng hợp lệ nào cho kỳ công trong tháng này. File không đúng định dạng hoặc sai kỳ công.')
                return
            }

            // Parse OT Date columns
            const otHeaders = rawOtData.length > 0 ? (rawOtData[0] as string[]) : []
            const otDateColumns: { index: number, dateStr: string }[] = []
            if (otHeaders.length > 0) {
                otHeaders.forEach((h, idx) => {
                    if (typeof h === 'string') {
                        const match = h.trim().match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i)
                        if (match) {
                            const day = parseInt(match[1])
                            const mStr = match[2].toLowerCase()
                            const mNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
                            const mIdx = mNames.indexOf(mStr)
                            const matchedDate = daysInCycle.find(d => d.getDate() === day && d.getMonth() === mIdx)
                            if (matchedDate) {
                                otDateColumns.push({ index: idx, dateStr: format(matchedDate, 'yyyy-MM-dd') })
                            }
                        } else {
                            const dateMatch = h.trim().match(/^\d{4}-\d{2}-\d{2}$/)
                            const mdyMatch = h.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
                            
                            if (dateMatch) {
                                const d = new Date(h.trim())
                                if (!isNaN(d.getTime())) {
                                    otDateColumns.push({ index: idx, dateStr: h.trim() })
                                }
                            } else if (mdyMatch) {
                                const m = parseInt(mdyMatch[1]) - 1
                                const d = parseInt(mdyMatch[2])
                                const y = parseInt(mdyMatch[3])
                                const dObj = new Date(y, m, d)
                                if (!isNaN(dObj.getTime())) {
                                    otDateColumns.push({ index: idx, dateStr: format(dObj, 'yyyy-MM-dd') })
                                }
                            }
                        }
                    }
                })
            }

            const recordsMap = new Map<string, any>()
            for (let i = 1; i < rawAttData.length; i++) {
                const row = rawAttData[i]
                const empCode = String(row[empCodeIdx] || '').replace(/\$/g, '').trim()
                if (!empCode) continue

                const fullName = String(row[nameIdx] || '').trim()
                const lineLeaderName = String(row[leaderIdx] || '').trim()
                const pic = picIdx !== -1 ? String(row[picIdx] || '').trim() : ''
                const mgt = mgtIdx !== -1 ? String(row[mgtIdx] || '').trim() : ''
                const employeeType = typeIdx !== -1 ? String(row[typeIdx] || '').trim() : ''
                const department = deptIdx !== -1 ? String(row[deptIdx] || '').trim() : ''
                const line = lineIdx !== -1 ? String(row[lineIdx] || '').trim() : ''
                const status = statusIdx !== -1 ? String(row[statusIdx] || '').trim() : ''
                const joinDate = joinDateIdx !== -1 ? String(row[joinDateIdx] || '').trim() : ''
                const resignDate = resignDateIdx !== -1 ? String(row[resignDateIdx] || '').trim() : ''
                const title = titleIdx !== -1 ? String(row[titleIdx] || '').trim() : ''
                const supervisor = supervisorIdx !== -1 ? String(row[supervisorIdx] || '').trim() : ''
                const shiftLeader = shiftLeaderIdx !== -1 ? String(row[shiftLeaderIdx] || '').trim() : ''
                const gender = genderIdx !== -1 ? String(row[genderIdx] || '').trim() : ''
                const vendor = vendorIdx !== -1 ? String(row[vendorIdx] || '').trim() : ''
                const zone = zoneIdx !== -1 ? String(row[zoneIdx] || '').trim() : ''
                const mu = muIdx !== -1 ? String(row[muIdx] || '').trim() : ''

                const dailyData: Record<string, string> = {}
                dateColumns.forEach(dc => {
                    dailyData[dc.dateStr] = String(row[dc.index] || '').replace(/\$/g, '').trim()
                })

                recordsMap.set(empCode, {
                    employeeCode: empCode,
                    fullName,
                    lineLeaderName,
                    pic,
                    mgt,
                    employeeType,
                    department,
                    line,
                    status,
                    joinDate,
                    resignDate,
                    title,
                    supervisor,
                    shiftLeader,
                    gender,
                    vendor,
                    zone,
                    mu,
                    dailyData,
                    otData: {}
                })
            }

            if (rawOtData.length > 1) {
                const otEmpCodeIdx = otHeaders.findIndex(h => h && ['employee code', 'emp code', 'mã nhân viên'].includes(String(h).trim().toLowerCase()))
                if (otEmpCodeIdx !== -1) {
                    for (let i = 1; i < rawOtData.length; i++) {
                        const row = rawOtData[i]
                        const empCode = String(row[otEmpCodeIdx] || '').replace(/\$/g, '').trim()
                        if (empCode && recordsMap.has(empCode)) {
                            const empRecord = recordsMap.get(empCode)
                            otDateColumns.forEach(dc => {
                                empRecord.otData[dc.dateStr] = String(row[dc.index] || '').replace(/\$/g, '').trim()
                            })
                        }
                    }
                }
            }

            const records = Array.from(recordsMap.values())

            if (records.length === 0) {
                alert('No valid records found in file.')
                return
            }

            const res = await fetch(mode === 'clerk' ? '/api/clerk-attendance/import' : '/api/attendance/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetMonth: monthStr, importType: activeTab, records })
            })

            if (res.ok) {
                alert(`Imported ${records.length} records successfully for ${monthStr}!`)
                fetchMonthly()
            } else {
                const errJson = await res.json()
                alert(`Import failed: ${errJson.error}`)
            }
        } catch (err: any) {
            console.error(err)
            alert(`Error reading file: ${err.message}`)
        } finally {
            setIsImporting(false)
            // reset input
            e.target.value = ''
        }
    }

    const totalPending = Object.keys(pendingChanges).length + Object.keys(pendingOTChanges).length

    const headerTitle = (
        <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600 shadow-sm border border-orange-200">
                <FileSpreadsheet size={16} />
            </div>
            <div className="flex flex-col">
                <div>
                    <h1 className="text-lg font-bold text-gray-800 tracking-tight">Timesheet Master Registry</h1>
                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">Validated and locked attendance data</p>
                </div>
            </div>
        </div>
    )

    // Use Light theme styling built-in components to look like Excel
    return (
        <div className="-m-6 h-[calc(100vh-64px)] flex flex-col bg-white overflow-hidden rounded-none border-0 transition-colors font-sans">
            {/* Title moved to portal */}
            {mounted && document.getElementById('timesheet-header-portal')
                ? createPortal(
                    <div className="flex items-center justify-between w-full px-4 py-2 bg-white">
                        {headerTitle}
                        
                        <div className="flex-1 max-w-sm mx-8 relative hidden lg:block">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search employees..."
                                className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-xs outline-none focus:ring-1 focus:ring-orange-500/20 focus:border-orange-500 transition-all font-medium text-gray-600"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>

                        <div className="flex items-center gap-3">
                             <div className="flex items-center gap-1.5 p-1 bg-gray-50 rounded-xl border border-gray-100">
                                <button onClick={prevMonth} className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-400">
                                    <ChevronLeft size={14} />
                                </button>
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-1 min-w-[90px] text-center">{format(currentDate, 'MMM yyyy')}</span>
                                <button onClick={nextMonth} className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-400">
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                            <div className="h-6 w-px bg-gray-100 mx-1" />
                            <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100">
                                <button 
                                    onClick={() => setViewMode('excel')}
                                    className={cn("px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all uppercase tracking-widest", viewMode === 'excel' ? "bg-white text-orange-600 shadow-sm" : "text-gray-400 hover:text-gray-600")}
                                >Excel</button>
                                <button 
                                    onClick={() => setViewMode('table')}
                                    className={cn("px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all uppercase tracking-widest", viewMode === 'table' ? "bg-white text-orange-600 shadow-sm" : "text-gray-400 hover:text-gray-600")}
                                >Bảng</button>
                            </div>
                            <div className="h-6 w-px bg-gray-100 mx-1" />
                            <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors"><Inbox size={18}/></button>
                            <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white shadow-sm font-bold text-xs uppercase">
                                {user?.fullName?.[0] || 'U'}
                            </div>
                        </div>
                    </div>, 
                    document.getElementById('timesheet-header-portal')!
                )
                : null}

            {/* Sub-header Navigation Row */}
            <div className="flex items-center justify-between px-6 py-1 bg-white border-b border-gray-100 z-10 shrink-0">
                <div className="flex items-center gap-8">
                    <nav className="flex items-center gap-8">
                        <button
                            onClick={() => setActiveTab('attendance')}
                            className={cn(
                                "relative py-3 text-[13px] font-medium transition-all text-gray-600 hover:text-orange-600",
                                activeTab === 'attendance' && "text-orange-600 font-bold"
                            )}
                        >
                            Thông tin điểm danh
                            {activeTab === 'attendance' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-orange-500 rounded-full" />}
                        </button>
                        <button
                            onClick={() => setActiveTab('ot')}
                            className={cn(
                                "relative py-3 text-[13px] font-medium transition-all text-gray-600 hover:text-orange-600",
                                activeTab === 'ot' && "text-orange-600 font-bold"
                            )}
                        >
                            Sổ đăng ký OT
                            {activeTab === 'ot' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-orange-500 rounded-full" />}
                        </button>
                    </nav>

                    <div className="h-4 w-px bg-gray-100" />
                    
                    <div className="flex items-center gap-4">
                        {(user?.role === 'Clerk' || user?.role === 'clerk') && (
                            <div className="relative">
                                <select
                                    className="appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-3 pr-8 py-1.5 text-xs font-medium text-gray-500 focus:outline-none focus:ring-1 focus:ring-orange-500/20 cursor-pointer hover:bg-white transition-colors"
                                    value={selectedLeader}
                                    onChange={e => setSelectedLeader(e.target.value)}
                                >
                                    <option value="">Tất cả phòng ban</option>
                                    {uniqueLeaders.map(l => <option key={l} value={l}>{l}</option>)}
                                </select>
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                                    <ChevronRight size={12} className="rotate-90" />
                                </div>
                            </div>
                        )}
                        {/* Sync Dropdown logic is hidden here for brevity but remains functional */}
                        {mode === 'clerk' && (
                             <div className="relative">
                                 <button
                                     onClick={() => setShowSyncDropdown(!showSyncDropdown)}
                                     className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50/50 px-3 py-1.5 rounded-lg border border-amber-100/50 hover:bg-amber-100 transition-all"
                                 >
                                     <RefreshCw size={12} className={cn(loading && "animate-spin")} />
                                     Đồng bộ từ Leader
                                 </button>
                                 {showSyncDropdown && (
                                     <>
                                         <div className="fixed inset-0 z-40" onClick={() => setShowSyncDropdown(false)}></div>
                                         <div className="absolute top-full mt-2 left-0 w-64 bg-white border border-gray-100 shadow-xl rounded-xl z-50 p-3 max-h-[400px] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
                                             <div className="flex justify-between items-center px-2 pb-2 mb-2 border-b border-gray-50">
                                                 <button onClick={() => setSyncDates(days.map(d => format(d, 'yyyy-MM-dd')))} className="text-[10px] font-bold text-blue-500">CHỌN HẾT</button>
                                                 <button onClick={() => setSyncDates([])} className="text-[10px] font-bold text-gray-400">XÓA</button>
                                             </div>
                                             <div className="flex flex-col gap-0.5">
                                                 {days.map(d => {
                                                     const dateStr = format(d, 'yyyy-MM-dd')
                                                     return (
                                                         <label key={dateStr} className="flex items-center gap-3 px-3 py-1.5 hover:bg-orange-50 rounded-lg cursor-pointer transition-colors group">
                                                             <input type="checkbox" checked={syncDates.includes(dateStr)} onChange={(e) => e.target.checked ? setSyncDates([...syncDates, dateStr]) : setSyncDates(syncDates.filter(s => s !== dateStr))} className="w-3.5 h-3.5 text-orange-500 rounded border-gray-200 focus:ring-orange-500/20" />
                                                             <span className="text-[11px] font-medium text-gray-600 group-hover:text-orange-700">{format(d, 'dd MMM yyyy')}</span>
                                                         </label>
                                                     )
                                                 })}
                                             </div>
                                             <button 
                                                onClick={async () => {
                                                    if (syncDates.length === 0) return;
                                                    setShowSyncDropdown(false);
                                                    setLoading(true);
                                                    try {
                                                        const res = await fetch('/api/clerk-attendance/sync', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ targetDates: syncDates })
                                                        });
                                                        if (res.ok) alert('Synced!');
                                                        fetchMonthly();
                                                    } catch (e) { } finally { setLoading(false); }
                                                }}
                                                className="w-full mt-3 py-2 bg-orange-500 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-sm hover:bg-orange-600 active:scale-95 transition-all"
                                             >
                                                 Xác nhận đồng bộ ({syncDates.length})
                                             </button>
                                         </div>
                                     </>
                                 )}
                             </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {totalPending > 0 && (
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-2 px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-all font-bold text-[11px] uppercase tracking-wider shadow-sm disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download size={14} />}
                            Save Changes ({totalPending})
                        </button>
                    )}
                    
                    {(user?.role === 'Clerk' || user?.role === 'clerk') && (
                        <>
                            <button 
                                onClick={fetchMonthly}
                                disabled={loading}
                                className="flex items-center gap-2 px-4 py-1.5 bg-white border border-gray-200 hover:border-orange-500 hover:text-orange-600 text-gray-500 rounded-lg transition-all font-bold text-[11px] uppercase tracking-wider shadow-sm disabled:opacity-50"
                            >
                                <RefreshCw size={12} className={cn(loading && "animate-spin")} />
                                Làm mới
                            </button>
                            <input type="file" id="excel-import" className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />
                            <label htmlFor="excel-import" className={cn(
                                "flex items-center gap-2 px-4 py-1.5 bg-white border border-gray-200 hover:border-orange-500 hover:text-orange-600 text-gray-500 rounded-lg transition-all font-bold text-[11px] uppercase tracking-wider shadow-sm cursor-pointer",
                                isImporting && "opacity-50 pointer-events-none"
                            )}>
                                {isImporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileSpreadsheet size={14} />}
                                Import File
                            </label>
                        </>
                    )}

                    <button className="flex items-center gap-2 px-4 py-1.5 bg-gray-800 hover:bg-black text-white rounded-lg transition-all font-bold text-[11px] uppercase tracking-wider shadow-sm">
                        <Download size={14} />
                        Export Report
                    </button>
                </div>
            </div>

            {/* Excel Grid Container - Light mode */}
            <div className="flex-1 bg-white relative xl-scrollbar font-sans text-xs sm:text-sm flex flex-col">
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm z-50">
                        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                    </div>
                )}
                {filteredEmployees.length === 0 && !loading && (
                    <div className="p-8 text-center text-gray-500 text-sm border rounded-xl">
                        No attendance records found for this period.
                    </div>
                )}
                {filteredEmployees.length > 0 && (
                    <TableVirtuoso
                        style={{ height: '100%' }}
                        className="w-full bg-white border border-gray-100 rounded-none shadow-none scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent"
                        data={paginatedEmployees}
                        components={VirtuosoComponents as any}
                        fixedHeaderContent={() => (
                            <tr className="bg-gray-100 uppercase text-[10px] tracking-widest font-bold">
                                <th className="sticky left-0 top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-center w-[40px] min-w-[40px] max-w-[40px] text-gray-500">
                                    {transferMode ? '#' : 'STT'}
                                </th>
                                <th className="sticky left-[40px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-center w-[80px] min-w-[80px] max-w-[80px] text-gray-500">ID</th>
                                <th className="sticky left-[120px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[180px] min-w-[180px] max-w-[180px] text-gray-500 uppercase">Full Name</th>
                                        <th className="sticky left-[300px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[120px] min-w-[120px] max-w-[120px] text-gray-500 uppercase">Leader</th>
                                        <th className="sticky left-[420px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[120px] min-w-[120px] max-w-[120px] text-gray-500 uppercase">Old Leader</th>
                                        <th className="sticky left-[540px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[120px] min-w-[120px] max-w-[120px] text-gray-500 uppercase">Location</th>
                                        {mode === 'clerk' && (
                                            <>
                                                <th className="sticky left-[660px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[80px] min-w-[80px] max-w-[80px] text-gray-500">PIC</th>
                                                <th className="sticky left-[740px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[70px] min-w-[70px] max-w-[70px] text-gray-500 uppercase">Mode</th>
                                                <th className="sticky left-[810px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[80px] min-w-[80px] max-w-[80px] text-gray-500 uppercase">Type</th>
                                                <th className="sticky left-[890px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[100px] min-w-[100px] max-w-[100px] text-gray-500 uppercase">Title</th>
                                                <th className="sticky left-[990px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[120px] min-w-[120px] max-w-[120px] text-gray-500 uppercase">Supervisor</th>
                                                <th className="sticky left-[1110px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[120px] min-w-[120px] max-w-[120px] text-gray-500 uppercase">Shift Leader</th>
                                                <th className="sticky left-[1230px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[50px] min-w-[50px] max-w-[50px] text-gray-500 uppercase">Sex</th>
                                                <th className="sticky left-[1280px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[100px] min-w-[100px] max-w-[100px] text-gray-500 uppercase">Vendor</th>
                                                <th className="sticky left-[1380px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[60px] min-w-[60px] max-w-[60px] text-gray-500 uppercase">Zone</th>
                                                <th className="sticky left-[1440px] top-0 z-60 bg-gray-100 border-r border-b border-gray-200 p-1 sm:p-2 text-left w-[60px] min-w-[60px] max-w-[60px] text-gray-500 uppercase">MU</th>
                                            </>
                                        )}


                                {days.map(d => (
                                    <th key={d.toString()} className="sticky top-0 z-50 bg-gray-100 border-r border-b border-gray-200 p-1 text-center min-w-[45px] sm:min-w-[55px] text-gray-500">
                                        {format(d, 'd-MMM')}
                                    </th>
                                ))}
                                <th className="sticky top-0 z-50 bg-gray-100 border-b border-gray-200 w-full min-w-[10px]"></th>
                            </tr>
                        )}
                        itemContent={(idx, emp) => {
                            const minSelR = selectionStart && selectionEnd ? Math.min(selectionStart.r, selectionEnd.r) : -1;
                            const maxSelR = selectionStart && selectionEnd ? Math.max(selectionStart.r, selectionEnd.r) : -1;
                            const isRowInSelection = minSelR !== -1 && idx >= minSelR && idx <= maxSelR;

                            const stickySttClass = isRowInSelection ? "!bg-orange-100" : "bg-gray-50 group-hover:bg-orange-50/50";
                            const stickyDataClass = isRowInSelection ? "!bg-orange-50/50" : "bg-white group-hover:bg-orange-50/50";

                            return (
                                <React.Fragment key={emp.id}>
                                    <td
                                        className={cn("sticky left-0 z-40 border-r border-gray-300 p-1 text-center text-gray-800 font-semibold w-[40px] min-w-[40px] max-w-[40px] cursor-pointer transition-colors", stickySttClass)}
                                        onContextMenu={(e) => handleContextMenu(e, idx, 0)}
                                        onMouseDown={(e) => {
                                            if (e.button !== 0 || transferMode) return;
                                            setIsSelecting(true)
                                            setSelectionStart({ r: idx, c: 0 })
                                            setSelectionEnd({ r: idx, c: days.length - 1 })
                                        }}
                                        onMouseEnter={() => {
                                            if (!transferMode && isSelecting && selectionStart) {
                                                setSelectionEnd({ r: idx, c: days.length - 1 })
                                            }
                                        }}
                                    >
                                        {transferMode ? (
                                            <input type="checkbox" checked={selectedEmployees.includes(emp.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedEmployees(prev => [...prev, emp.id])
                                                    else setSelectedEmployees(prev => prev.filter(id => id !== emp.id))
                                                }} className="w-4 h-4 rounded text-blue-600 cursor-pointer" />
                                        ) : (idx + 1)}
                                    </td>
                                    <td className={cn("sticky left-[40px] z-40 border-r border-gray-300 p-1 text-center font-medium font-mono text-gray-700 w-[80px] min-w-[80px] max-w-[80px] transition-colors", stickyDataClass)}
                                        onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                        {emp.employeeCode}
                                    </td>
                                    <td className={cn("sticky left-[120px] z-40 border-r border-gray-300 p-1 text-left font-medium text-gray-900 truncate w-[180px] min-w-[180px] max-w-[180px] transition-colors", stickyDataClass)}
                                        onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                        {emp.fullName}
                                    </td>
                                    <td className={cn("sticky left-[300px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[120px] min-w-[120px] max-w-[120px] transition-colors", stickyDataClass)}
                                        onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                        {emp.leaderName}
                                    </td>
                                    <td className={cn("sticky left-[420px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[120px] min-w-[120px] max-w-[120px] transition-colors", stickyDataClass)}
                                        onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                        {(emp as any).oldLineLeader}
                                    </td>
                                    <td className={cn("sticky left-[540px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[120px] min-w-[120px] max-w-[120px] transition-colors", stickyDataClass)}
                                        onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                        {(emp as any).newLine}
                                    </td>
                                    {mode === 'clerk' && (
                                        <>
                                            <td className={cn("sticky left-[660px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[80px] min-w-[80px] max-w-[80px] transition-colors", stickyDataClass)}
                                                onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                                {emp.pic}
                                            </td>
                                            <td className={cn("sticky left-[740px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[70px] min-w-[70px] max-w-[70px] transition-colors", stickyDataClass)}
                                                onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                                {emp.mgt}
                                            </td>
                                            <td className={cn("sticky left-[810px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[80px] min-w-[80px] max-w-[80px] transition-colors", stickyDataClass)}
                                                onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                                {emp.employeeType}
                                            </td>
                                            <td className={cn("sticky left-[890px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[100px] min-w-[100px] max-w-[100px] transition-colors", stickyDataClass)}
                                                onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                                {emp.title}
                                            </td>
                                            <td className={cn("sticky left-[990px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[120px] min-w-[120px] max-w-[120px] transition-colors", stickyDataClass)}
                                                onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                                {emp.supervisor}
                                            </td>
                                            <td className={cn("sticky left-[1110px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[120px] min-w-[120px] max-w-[120px] transition-colors", stickyDataClass)}
                                                onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                                {emp.shiftLeader}
                                            </td>
                                            <td className={cn("sticky left-[1230px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[50px] min-w-[50px] max-w-[50px] transition-colors", stickyDataClass)}
                                                onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                                {emp.gender}
                                            </td>
                                            <td className={cn("sticky left-[1280px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[100px] min-w-[100px] max-w-[100px] transition-colors", stickyDataClass)}
                                                onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                                {emp.vendor}
                                            </td>
                                            <td className={cn("sticky left-[1380px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[60px] min-w-[60px] max-w-[60px] transition-colors", stickyDataClass)}
                                                onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                                {emp.zone}
                                            </td>
                                            <td className={cn("sticky left-[1440px] z-40 border-r border-gray-300 p-1 text-left text-gray-700 truncate w-[60px] min-w-[60px] max-w-[60px] transition-colors", stickyDataClass)}
                                                onContextMenu={(e) => handleContextMenu(e, idx, 0)}>
                                                {emp.mu}
                                            </td>
                                        </>
                                    )}


                                    {days.map((d, dayIdx) => {
                                        const dateStr = format(d, 'yyyy-MM-dd')
                                        const keyStr = `${emp.id}_${dateStr}`

                                        let isFillTarget = false
                                        let isFillOrigin = false
                                        if (isDraggingFill && dragStart && dragCurrent) {
                                            const minR = Math.min(dragStart.r, dragCurrent.r)
                                            const maxR = Math.max(dragStart.r, dragCurrent.r)
                                            const minC = Math.min(dragStart.c, dragCurrent.c)
                                            const maxC = Math.max(dragStart.c, dragCurrent.c)

                                            isFillTarget = (idx >= minR && idx <= maxR && dayIdx >= minC && dayIdx <= maxC)
                                            isFillOrigin = (idx === dragStart.r && dayIdx === dragStart.c)
                                        }

                                        const isFocused = focusedCell?.r === idx && focusedCell?.c === dayIdx

                                        let isSelectedArea = false
                                        if (selectionStart && selectionEnd) {
                                            const minSelR = Math.min(selectionStart.r, selectionEnd.r)
                                            const maxSelR = Math.max(selectionStart.r, selectionEnd.r)
                                            const minSelC = Math.min(selectionStart.c, selectionEnd.c)
                                            const maxSelC = Math.max(selectionStart.c, selectionEnd.c)
                                            isSelectedArea = (idx >= minSelR && idx <= maxSelR && dayIdx >= minSelC && dayIdx <= maxSelC)
                                        }

                                        if (activeTab === 'ot') {
                                            const otData = mode === 'clerk' ? emp.clerkOvertimes : emp.overtimes
                                            const rawOt = otData?.[dateStr]
                                            const isEdited = pendingOTChanges[keyStr] !== undefined
                                            const displayOt = isEdited ? pendingOTChanges[keyStr] : (rawOt || '')
                                            const isError = errors[`ot_${keyStr}`]

                                            return (
                                                <MemoCell
                                                    key={`ot_${dateStr}`}
                                                    idx={idx} dayIdx={dayIdx} dateStr={dateStr} empId={emp.id}
                                                    val={rawOt} isEdited={isEdited} pendingVal={pendingOTChanges[keyStr]} isError={isError}
                                                    activeTab={activeTab} canEdit={canEdit} isFillTarget={isFillTarget} isFillOrigin={isFillOrigin}
                                                    isSelectedArea={isSelectedArea} isFocused={isFocused} colorClass=""
                                                    onMouseDown={handleCellMouseDown} onMouseEnter={handleCellMouseEnter}
                                                    onChange={handleCellChange} onFocus={handleCellFocus} onDragStart={handleCellDragStart}
                                                    onContextMenu={handleContextMenu}
                                                />
                                            )
                                        }

                                        const attData = mode === 'clerk' ? emp.clerkAttendances : emp.attendances
                                        const rawStatus = attData?.[dateStr] || ''

                                        // Auto map legacy seeded statuses to proper S-codes for UI if needed, but here we just render them
                                        let actualStatus = (rawStatus.startsWith('M_') || rawStatus.startsWith('A_')) ? rawStatus.split('_')[1] : rawStatus;
                                        if (actualStatus === 'P') actualStatus = 'S1'; // Translate legacy 'P' defaults to S1 for UI

                                        const [baseStatus] = actualStatus.split('_')
                                        // Check if baseStatus is a known leave type or a known shift code for coloring
                                        const colorClass = STATUS_COLORS[baseStatus] || (shifts.some(s => s.code === baseStatus) ? 'bg-emerald-50/50 text-emerald-700' : '');
                                        const isEdited = pendingChanges[keyStr] !== undefined
                                        const isError = errors[`att_${keyStr}`]

                                        return (
                                            <MemoCell
                                                key={`att_${dateStr}`}
                                                idx={idx} dayIdx={dayIdx} dateStr={dateStr} empId={emp.id}
                                                val={actualStatus} isEdited={isEdited} pendingVal={pendingChanges[keyStr]} isError={isError}
                                                activeTab={activeTab} canEdit={canEdit} isFillTarget={isFillTarget} isFillOrigin={isFillOrigin}
                                                isSelectedArea={isSelectedArea} isFocused={isFocused} colorClass={colorClass}
                                                onMouseDown={handleCellMouseDown} onMouseEnter={handleCellMouseEnter}
                                                onChange={handleCellChange} onFocus={handleCellFocus} onDragStart={handleCellDragStart}
                                                onContextMenu={handleContextMenu}
                                            />
                                        )
                                    })}
                                    <td className="w-full border-r border-gray-300"></td>
                                </React.Fragment>
                            )
                        }}
                    />
                )}
            </div >

            <div className="px-6 py-3 border-t border-gray-100 bg-white flex items-center justify-between shrink-0 font-sans">
                <div className="flex items-center gap-6 text-[11px] text-gray-400 font-bold uppercase tracking-widest">
                    <span>Total: <span className="text-gray-800">{filteredEmployees.length}</span> employees</span>
                    {viewMode === 'table' && (
                        <>
                            <div className="h-4 w-px bg-gray-100" />
                            <div className="flex items-center gap-2">
                                <span>Page Size:</span>
                                <select 
                                    value={pageSize} 
                                    onChange={e => setPageSize(Number(e.target.value))}
                                    className="bg-gray-50 border border-gray-100 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-orange-500/20 text-gray-600 cursor-pointer"
                                >
                                    <option value={20}>20</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                    <option value={200}>200</option>
                                </select>
                            </div>
                        </>
                    )}
                </div>

                {viewMode === 'table' && (
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                            disabled={currentPage === 1}
                            className="p-2 rounded-xl border border-gray-100 hover:bg-gray-50 disabled:opacity-30 disabled:pointer-events-none transition-all text-gray-500"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        
                        <div className="flex items-center gap-1">
                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                const page = i + 1;
                                return (
                                    <button
                                        key={page}
                                        onClick={() => setCurrentPage(page)}
                                        className={cn(
                                            "w-8 h-8 rounded-xl text-[11px] font-bold transition-all",
                                            currentPage === page ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-gray-400 hover:bg-gray-50"
                                        )}
                                    >{page}</button>
                                )
                            })}
                            {totalPages > 5 && <span className="text-gray-300 px-1">...</span>}
                            {totalPages > 5 && (
                                <button
                                    onClick={() => setCurrentPage(totalPages)}
                                    className={cn(
                                        "w-8 h-8 rounded-xl text-[11px] font-bold transition-all",
                                        currentPage === totalPages ? "bg-orange-500 text-white shadow-lg" : "text-gray-400 hover:bg-gray-50"
                                    )}
                                >{totalPages}</button>
                            )}
                        </div>

                        <button 
                            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                            disabled={currentPage === totalPages}
                            className="p-2 rounded-xl border border-gray-100 hover:bg-gray-50 disabled:opacity-30 disabled:pointer-events-none transition-all text-gray-500"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}

                <div className="flex items-center gap-4 text-[10px] font-medium">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-100 border border-emerald-200" />
                        <span className="text-gray-400 uppercase tracking-widest">Ca làm việc</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-100 border border-amber-200" />
                        <span className="text-gray-400 uppercase tracking-widest">Nghỉ phép</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-rose-100 border border-rose-200" />
                        <span className="text-gray-400 uppercase tracking-widest">Vi phạm</span>
                    </div>
                </div>
            </div>

            {/* Modals */}
            <SendTransferModal
                isOpen={showSendModal}
                onClose={() => setShowSendModal(false)}
                selectedCount={selectedEmployees.length}
                currentMonth={monthStr}
                onConfirm={async (targetLeaderId: number, month: string) => {
                    const res = await fetch('/api/transfer-requests', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            employeeIds: selectedEmployees,
                            fromLeaderId: user?.id,
                            toLeaderId: targetLeaderId,
                            targetMonth: month
                        })
                    })
                    if (res.ok) {
                        alert('Requests sent successfully!')
                        setTransferMode(false)
                        setSelectedEmployees([])
                    } else alert('Failed to send requests')
                }}
            />
            <IncomingTransfersModal
                isOpen={showInboxModal}
                onClose={() => setShowInboxModal(false)}
                currentUserId={user?.id}
            />

            {
                contextMenu && (
                    <div
                        className="fixed z-10000 bg-white border border-gray-200 shadow-xl rounded-lg py-1 min-w-[150px] animate-in fade-in zoom-in-95 duration-100"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button onClick={() => { performCopy(); setContextMenu(null) }} className="w-full text-left px-4 py-2 hover:bg-gray-100 text-sm text-gray-700">Copy (Ctrl+C)</button>
                        {canEdit && <button onClick={() => { performCut(); setContextMenu(null) }} className="w-full text-left px-4 py-2 hover:bg-gray-100 text-sm text-gray-700">Cut (Ctrl+X)</button>}
                        {canEdit && <button onClick={() => { performClear(); setContextMenu(null) }} className="w-full text-left px-4 py-2 hover:bg-orange-50 text-sm text-orange-600 font-medium border-t border-gray-100">Clear cell(s) (Del)</button>}
                        {canEdit && activeTab === 'attendance' && <button onClick={() => { setShowLeaveModal(true); setContextMenu(null) }} className="w-full text-left px-4 py-2 hover:bg-blue-50 text-sm text-blue-600 font-medium border-t border-gray-100">Assign Leave (with Shift)</button>}
                        {canEdit && <button onClick={() => { performDelete(); setContextMenu(null) }} className="w-full text-left px-4 py-2 hover:bg-red-50 text-sm text-red-600 font-medium border-t border-gray-100">Delete row(s)</button>}
                    </div>
                )
            }

            {showLeaveModal && (
                <div className="fixed inset-0 bg-black/50 z-99999 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">Assign Leave & Shift</h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Leave Type</label>
                                <select value={leaveBase} onChange={e => setLeaveBase(e.target.value)} className="w-full border-gray-300 border rounded-md p-2 bg-white outline-none focus:ring-1 focus:ring-blue-500 text-sm">
                                    {STATIC_LEAVES.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Select Shift</label>
                                <select value={leaveShift} onChange={e => setLeaveShift(e.target.value)} className="w-full border-gray-300 border rounded-md p-2 bg-white outline-none focus:ring-1 focus:ring-blue-500 text-sm">
                                    <option value="">-- No Shift (Default) --</option>
                                    {shifts.map(s => <option key={s.id} value={s.code}>{s.code} {s.name ? `(${s.name})` : ''}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => setShowLeaveModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium transition-colors">Cancel</button>
                            <button onClick={() => {
                                const finalCode = leaveShift ? `${leaveBase}_${leaveShift}` : leaveBase;
                                if (selectionStart && selectionEnd) {
                                    const minSelR = Math.min(selectionStart.r, selectionEnd.r)
                                    const maxSelR = Math.max(selectionStart.r, selectionEnd.r)
                                    const minSelC = Math.min(selectionStart.c, selectionEnd.c)
                                    const maxSelC = Math.max(selectionStart.c, selectionEnd.c)

                                    for (let r = minSelR; r <= maxSelR; r++) {
                                        const empId = filteredEmployees[r]?.id
                                        for (let c = minSelC; c <= maxSelC; c++) {
                                            const dateStr = format(days[c], 'yyyy-MM-dd')
                                            if (empId) {
                                                handleCellChange(empId, dateStr, finalCode)
                                            }
                                        }
                                    }
                                }
                                setShowLeaveModal(false)
                            }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm">Apply Leave</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
