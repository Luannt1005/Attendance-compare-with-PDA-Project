'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { 
    Loader2, Search, CheckCircle2, AlertCircle, XCircle, RefreshCw, 
    LayoutDashboard, Table as TableIcon, Calendar, TrendingUp, TrendingDown,
    Activity, AlertTriangle, CheckCircle, Info, Filter, PieChart as PieChartIcon,
    ChevronLeft, ChevronRight, UserCheck, Upload, Download
} from 'lucide-react'
import { format, subMonths, addMonths, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { 
    ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, 
    Legend, PieChart, Pie, Cell, BarChart, Bar, LabelList
} from 'recharts'
import * as XLSX from 'xlsx'

interface AuditResult {
    employeeCode: string
    fullName: string
    leaderName: string
    submittedShift: string
    realIn: string
    realOut: string
    submittedOt: number
    expectedOt: number | string
    status: 'VALID' | 'WARNING' | 'ERROR'
    reason: string
    pic?: string | null
    mgt?: string | null
    employeeType?: string | null
    supervisor?: string | null
    date?: string
    varValue?: number
}

function FilterDropdown({
    value,
    onChange,
    options,
    placeholder = "All",
    inputClass = "border-blue-200 focus:border-blue-500"
}: {
    value: string;
    onChange: (val: string) => void;
    options: (string | number)[];
    placeholder?: string;
    inputClass?: string;
}) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')

    useEffect(() => {
        if (!open) {
            if (value === 'VALID') setSearch('Valid')
            else if (value === 'ERROR') setSearch('Error')
            else if (value === 'WARNING') setSearch('Warning')
            else setSearch(value === '_BLANK_' ? '(Blank)' : String(value))
        }
    }, [value, open])

    const getDisplayText = (val: string | number) => {
        if (val === '_BLANK_') return '(Blank)'
        if (val === 'VALID') return 'Valid'
        if (val === 'ERROR') return 'Error'
        if (val === 'WARNING') return 'Warning'
        return String(val)
    }

    const filtered = options.filter(opt => getDisplayText(opt).toLowerCase().includes(search.toLowerCase()))

    return (
        <div className="relative w-full font-normal">
            <input
                type="text"
                placeholder={placeholder}
                value={open ? search : (value ? getDisplayText(value) : '')}
                onClick={() => setOpen(true)}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 200)}
                onChange={e => {
                    setSearch(e.target.value)
                    if (!open) setOpen(true)
                }}
                className={cn("border rounded-md px-2 py-1 text-xs w-full outline-none bg-white", inputClass)}
            />
            {open && (
                <div className="absolute top-full left-0 w-full min-w-[120px] mt-1 bg-white border border-gray-200 shadow-xl rounded-md max-h-48 overflow-y-auto z-50 py-1 text-left text-gray-800">
                    <div className="px-3 py-1.5 hover:bg-gray-100 cursor-pointer text-xs" onMouseDown={(e) => { e.preventDefault(); onChange(''); setOpen(false); }}>
                        {placeholder}
                    </div>
                    {filtered.length === 0 ? (
                        <div className="px-3 py-1.5 text-gray-400 italic text-xs">No matches</div>
                    ) : (
                        filtered.map((opt, idx) => (
                            <div key={idx} className="px-3 py-1.5 hover:bg-gray-100 cursor-pointer truncate text-xs" onMouseDown={(e) => { e.preventDefault(); onChange(String(opt)); setOpen(false); }}>
                                {getDisplayText(opt)}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    )
}




// Main Component
export default function AuditingPage() {
    const viewMode = 'table'
    const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
    const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'))
    const [isFetching, setIsFetching] = useState(false)
    const [results, setResults] = useState<AuditResult[]>([])
    const [summaryData, setSummaryData] = useState<any[]>([])
    const [supervisorStats, setSupervisorStats] = useState<any[]>([])
    const [lineLeaderStats, setLineLeaderStats] = useState<any[]>([])
    const [shiftStats, setShiftStats] = useState<any[]>([])
    const [search, setSearch] = useState('')
    
    const [excelResults, setExcelResults] = useState<AuditResult[]>([])
    const [isExcelMode, setIsExcelMode] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Column Filters
    const [filterStatus, setFilterStatus] = useState('')
    const [filterEmployee, setFilterEmployee] = useState('')
    const [filterLeader, setFilterLeader] = useState('')
    const [filterPic, setFilterPic] = useState('')
    const [filterMgt, setFilterMgt] = useState('')
    const [filterType, setFilterType] = useState('')
    const [filterShift, setFilterShift] = useState('')
    const [filterSupervisor, setFilterSupervisor] = useState('')
    const [filterOt, setFilterOt] = useState('')
    const [filterIn, setFilterIn] = useState('')
    const [filterOut, setFilterOut] = useState('')
    const [filterExpectedOt, setFilterExpectedOt] = useState('')
    const [filterReason, setFilterReason] = useState('')
    const [filterVar, setFilterVar] = useState('')

    const [portalNode, setPortalNode] = useState<HTMLElement | null>(null)

    useEffect(() => {
        setPortalNode(document.getElementById('timesheet-header-portal'))
    }, [])

    // Load from sessionStorage on mount (client-side only to prevent hydration mismatch)
    useEffect(() => {
        try {
            const savedExcelMode = sessionStorage.getItem('audit_isExcelMode');
            if (savedExcelMode === 'true') {
                const savedExcelResults = sessionStorage.getItem('audit_excelResults');
                const savedSummaryData = sessionStorage.getItem('audit_summaryData');
                const savedSupervisorStats = sessionStorage.getItem('audit_supervisorStats');
                const savedLineLeaderStats = sessionStorage.getItem('audit_lineLeaderStats');
                const savedShiftStats = sessionStorage.getItem('audit_shiftStats');
                const savedSelectedMonth = sessionStorage.getItem('audit_selectedMonth');
                const savedSelectedDate = sessionStorage.getItem('audit_selectedDate');

                if (savedExcelResults) setExcelResults(JSON.parse(savedExcelResults));
                if (savedSummaryData) setSummaryData(JSON.parse(savedSummaryData));
                if (savedSupervisorStats) setSupervisorStats(JSON.parse(savedSupervisorStats));
                if (savedLineLeaderStats) setLineLeaderStats(JSON.parse(savedLineLeaderStats));
                if (savedShiftStats) setShiftStats(JSON.parse(savedShiftStats));
                if (savedSelectedMonth) setSelectedMonth(savedSelectedMonth);
                if (savedSelectedDate) setSelectedDate(savedSelectedDate);
                setIsExcelMode(true);
            }
        } catch (e) {
            console.error('Failed to load audit state from sessionStorage:', e);
        }
    }, []);

    // Save to sessionStorage when state changes
    useEffect(() => {
        if (isExcelMode) {
            sessionStorage.setItem('audit_isExcelMode', 'true');
            sessionStorage.setItem('audit_excelResults', JSON.stringify(excelResults));
            sessionStorage.setItem('audit_summaryData', JSON.stringify(summaryData));
            sessionStorage.setItem('audit_supervisorStats', JSON.stringify(supervisorStats));
            sessionStorage.setItem('audit_lineLeaderStats', JSON.stringify(lineLeaderStats));
            sessionStorage.setItem('audit_shiftStats', JSON.stringify(shiftStats));
            sessionStorage.setItem('audit_selectedMonth', selectedMonth);
            sessionStorage.setItem('audit_selectedDate', selectedDate);
        } else {
            sessionStorage.removeItem('audit_isExcelMode');
            sessionStorage.removeItem('audit_excelResults');
            sessionStorage.removeItem('audit_summaryData');
            sessionStorage.removeItem('audit_supervisorStats');
            sessionStorage.removeItem('audit_lineLeaderStats');
            sessionStorage.removeItem('audit_shiftStats');
            sessionStorage.removeItem('audit_selectedMonth');
            sessionStorage.removeItem('audit_selectedDate');
        }
    }, [isExcelMode, excelResults, summaryData, supervisorStats, lineLeaderStats, shiftStats, selectedMonth, selectedDate]);

    const fetchAuditData = async (dateStr: string) => {
        setIsFetching(true)
        try {
            const response = await fetch(`/api/attendance/audit/clerk?date=${dateStr}`)
            const resData = await response.json()
            if (!response.ok) throw new Error(resData.error || 'Server Error')
            const processed = (resData.data || []).map((r: any) => {
                const sub = Number(r.submittedOt) || 0
                const exp = typeof r.expectedOt === 'number' ? r.expectedOt : (parseFloat(String(r.expectedOt)) || 0)
                return { ...r, varValue: Math.abs(sub - exp) }
            })
            setResults(processed)
        } catch (error: any) {
            console.error(error)
            toast.error('Lỗi tải dữ liệu audit: ' + error.message)
            setResults([])
        } finally {
            setIsFetching(false)
        }
    }

    const fetchSummaryData = async (monthStr: string) => {
        setIsFetching(true)
        try {
            const response = await fetch(`/api/attendance/audit/clerk?month=${monthStr}`)
            const resData = await response.json()
            if (!response.ok) throw new Error(resData.error || 'Server Error')
            setSummaryData(resData.data || [])
            setSupervisorStats(resData.supervisorStats || [])
            setLineLeaderStats(resData.lineLeaderStats || [])
            setShiftStats(resData.shiftStats || [])
        } catch (error: any) {
            console.error(error)
            toast.error('Lỗi tải dữ liệu tổng hợp: ' + error.message)
            setSummaryData([])
        } finally {
            setIsFetching(false)
        }
    }

    useEffect(() => {
        const savedExcelMode = typeof window !== 'undefined' ? sessionStorage.getItem('audit_isExcelMode') : null;
        if (!isExcelMode && savedExcelMode !== 'true') {
            fetchAuditData(selectedDate)
            fetchSummaryData(selectedMonth)
        }
    }, [selectedDate, selectedMonth, isExcelMode])

    useEffect(() => {
        if (isExcelMode) {
            setResults(excelResults.filter(r => r.date === selectedDate))
        }
    }, [selectedDate, selectedMonth, isExcelMode, excelResults])

    // Load Clerk Audit history automatically instead of waiting for file upload.


    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setIsFetching(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            const response = await fetch('/api/attendance/audit/excel', {
                method: 'POST',
                body: formData
            })
            const resData = await response.json()
            if (!response.ok) throw new Error(resData.error || 'Server Error')
            
            const processed = (resData.allResults || []).map((r: any) => {
                const sub = Number(r.submittedOt) || 0
                const exp = typeof r.expectedOt === 'number' ? r.expectedOt : (parseFloat(String(r.expectedOt)) || 0)
                return { ...r, varValue: Math.abs(sub - exp) }
            })
            setExcelResults(processed)
            setIsExcelMode(true)
            setSummaryData(resData.data || [])
            setSupervisorStats(resData.supervisorStats || [])
            setLineLeaderStats(resData.lineLeaderStats || [])
            setShiftStats(resData.shiftStats || [])
            if (resData.data && resData.data.length > 0) {
                setSelectedMonth(resData.data[0].date.substring(0, 7))
                setSelectedDate(resData.data[0].date)
            }
            toast.success('Đã import dữ liệu Excel thành công!')
        } catch (error: any) {
            console.error(error)
            toast.error('Lỗi import file Excel: ' + error.message)
        } finally {
            setIsFetching(false)
            if (e.target) e.target.value = ''
        }
    }

    const handleSyncValid = async () => {
        const validCases = excelResults.filter(r => r.status === 'VALID');
        if (validCases.length === 0) {
            toast.info('Không có case VALID nào để sync!');
            return;
        }

        const confirmSync = window.confirm(`Bạn có chắc muốn đồng bộ ${validCases.length} case VALID vào bảng chấm công không?`);
        if (!confirmSync) return;

        setIsFetching(true);
        try {
            const response = await fetch('/api/attendance/audit/excel/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ validCases })
            });
            const resData = await response.json();
            if (!response.ok) throw new Error(resData.error || 'Server Error');
            
            toast.success(`Đã đồng bộ thành công ${resData.count} bản ghi vào bảng chấm công!`);
        } catch (error: any) {
            console.error(error);
            toast.error('Lỗi khi đồng bộ: ' + error.message);
        } finally {
            setIsFetching(false);
        }
    }

    const getFilteredSourceData = (allData: AuditResult[]) => {
        return allData.filter(r => {
            if (search && !r.employeeCode.includes(search) && !r.fullName.toLowerCase().includes(search.toLowerCase())) return false
            if (!checkMatch(r.status, filterStatus)) return false
            if (!checkMatch(r.employeeCode, filterEmployee)) return false
            if (!checkMatch(r.leaderName, filterLeader)) return false
            if (!checkMatch(r.pic, filterPic)) return false
            if (!checkMatch(r.mgt, filterMgt)) return false
            if (!checkMatch(r.employeeType, filterType)) return false
            if (!checkMatch(r.submittedShift, filterShift)) return false
            if (!checkMatch(r.supervisor, filterSupervisor)) return false
            if (!checkMatch(r.submittedOt, filterOt)) return false
            if (!checkMatch(r.realIn, filterIn)) return false
            if (!checkMatch(r.realOut, filterOut)) return false
            if (!checkMatch(r.expectedOt, filterExpectedOt)) return false
            if (!checkMatch(r.reason, filterReason)) return false
            if (!checkMatch(r.varValue !== undefined ? r.varValue.toFixed(2) : '_BLANK_', filterVar)) return false
            return true
        })
    }

    const exportErrorWarningExcel = () => {
        const source = isExcelMode ? getFilteredSourceData(excelResults) : filteredResults;
        const errorWarningCases = source.filter(r => r.status === 'WARNING' || r.status === 'ERROR');
        if (errorWarningCases.length === 0) {
            toast.info('Không có dữ liệu lỗi/cảnh báo để xuất!');
            return;
        }

        const exportData = errorWarningCases.map(r => ({
            'Date': r.date,
            'Employee Code': r.employeeCode,
            'Full Name': r.fullName,
            'Leader Name': r.leaderName,
            'Supervisor': r.supervisor,
            'Status': r.status,
            'Submitted Shift': r.submittedShift,
            'Real In': r.realIn,
            'Real Out': r.realOut,
            'Submitted OT': r.submittedOt,
            'Expected OT': r.expectedOt,
            'Variance': r.varValue,
            'Reason': r.reason
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Discrepancies");
        XLSX.writeFile(wb, `Discrepancies_${selectedMonth}.xlsx`);
    };

    const exportAllExcel = () => {
        const source = isExcelMode ? getFilteredSourceData(excelResults) : filteredResults;
        if (source.length === 0) {
            toast.info('Không có dữ liệu để xuất!');
            return;
        }

        const exportData = source.map(r => ({
            'Date': r.date,
            'Employee Code': r.employeeCode,
            'Full Name': r.fullName,
            'Leader Name': r.leaderName,
            'Supervisor': r.supervisor,
            'Status': r.status,
            'Submitted Shift': r.submittedShift,
            'Real In': r.realIn,
            'Real Out': r.realOut,
            'Submitted OT': r.submittedOt,
            'Expected OT': r.expectedOt,
            'Variance': r.varValue,
            'Reason': r.reason
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "All Results");
        XLSX.writeFile(wb, `Audit_Results_${selectedMonth}.xlsx`);
    };

    const checkMatch = (val: any, filterVal: string) => {
        if (!filterVal) return true;
        const normalizedVal = (val === null || val === undefined || val === '') ? '_BLANK_' : String(val);
        return normalizedVal === filterVal;
    }

    const uniqueStatuses = useMemo(() => Array.from(new Set(results.map(r => r.status))).sort(), [results])
    
    // Base results for unique value calculation
    const baseForUniques = useMemo(() => {
        return results;
    }, [results]);

    const getUniqueForField = (field: keyof AuditResult, currentFilters: any) => {
        return Array.from(new Set(
            baseForUniques
                .filter(r => {
                    // Filter by all fields EXCEPT the field we are getting uniques for
                    if (field !== 'status' && !checkMatch(r.status, currentFilters.status)) return false;
                    if (field !== 'employeeCode' && !checkMatch(r.employeeCode, currentFilters.employeeCode)) return false;
                    if (field !== 'leaderName' && !checkMatch(r.leaderName, currentFilters.leaderName)) return false;
                    if (field !== 'supervisor' && !checkMatch(r.supervisor, currentFilters.supervisor)) return false;
                    if (field !== 'pic' && !checkMatch(r.pic, currentFilters.pic)) return false;
                    if (field !== 'mgt' && !checkMatch(r.mgt, currentFilters.mgt)) return false;
                    if (field !== 'employeeType' && !checkMatch(r.employeeType, currentFilters.employeeType)) return false;
                    if (field !== 'submittedShift' && !checkMatch(r.submittedShift, currentFilters.submittedShift)) return false;
                    if (field !== 'submittedOt' && !checkMatch(r.submittedOt, currentFilters.submittedOt)) return false;
                    if (field !== 'realIn' && !checkMatch(r.realIn, currentFilters.realIn)) return false;
                    if (field !== 'realOut' && !checkMatch(r.realOut, currentFilters.realOut)) return false;
                    if (field !== 'expectedOt' && !checkMatch(r.expectedOt, currentFilters.expectedOt)) return false;
                    if (field !== 'reason' && !checkMatch(r.reason, currentFilters.reason)) return false;
                    if (field !== 'varValue' && !checkMatch(r.varValue !== undefined ? r.varValue.toFixed(2) : '_BLANK_', currentFilters.varValue)) return false;
                    if (search && !r.employeeCode.includes(search) && !r.fullName.toLowerCase().includes(search.toLowerCase())) return false;
                    return true;
                })
                .map(r => {
                    if (field === 'varValue') return (r.varValue === null || r.varValue === undefined) ? '_BLANK_' : r.varValue.toFixed(2);
                    if (field === 'submittedOt' || field === 'expectedOt') return (r[field] === null || r[field] === undefined) ? '_BLANK_' : String(r[field]);
                    return (r[field] as string) || '_BLANK_';
                })
        )).sort((a: any, b: any) => {
            if (field === 'varValue' || field === 'submittedOt' || field === 'expectedOt') {
                return a === '_BLANK_' ? -1 : b === '_BLANK_' ? 1 : Number(a) - Number(b);
            }
            return String(a).localeCompare(String(b));
        });
    };

    const currentFilters = {
        status: filterStatus,
        employeeCode: filterEmployee,
        leaderName: filterLeader,
        supervisor: filterSupervisor,
        pic: filterPic,
        mgt: filterMgt,
        employeeType: filterType,
        submittedShift: filterShift,
        submittedOt: filterOt,
        realIn: filterIn,
        realOut: filterOut,
        expectedOt: filterExpectedOt,
        reason: filterReason,
        varValue: filterVar
    };

    const uniqueEmployees = useMemo(() => getUniqueForField('employeeCode', currentFilters), [baseForUniques, currentFilters, search]);
    const uniqueLeaders = useMemo(() => getUniqueForField('leaderName', currentFilters), [baseForUniques, currentFilters, search]);
    const uniqueSupervisors = useMemo(() => getUniqueForField('supervisor', currentFilters), [baseForUniques, currentFilters, search]);
    const uniquePics = useMemo(() => getUniqueForField('pic', currentFilters), [baseForUniques, currentFilters, search]);
    const uniqueMgts = useMemo(() => getUniqueForField('mgt', currentFilters), [baseForUniques, currentFilters, search]);
    const uniqueTypes = useMemo(() => getUniqueForField('employeeType', currentFilters), [baseForUniques, currentFilters, search]);
    const uniqueShifts = useMemo(() => getUniqueForField('submittedShift', currentFilters), [baseForUniques, currentFilters, search]);
    const uniqueOts = useMemo(() => getUniqueForField('submittedOt', currentFilters), [baseForUniques, currentFilters, search]);
    const uniqueIns = useMemo(() => getUniqueForField('realIn', currentFilters), [baseForUniques, currentFilters, search]);
    const uniqueOuts = useMemo(() => getUniqueForField('realOut', currentFilters), [baseForUniques, currentFilters, search]);
    const uniqueExpectedOts = useMemo(() => getUniqueForField('expectedOt', currentFilters), [baseForUniques, currentFilters, search]);
    const uniqueReasons = useMemo(() => getUniqueForField('reason', currentFilters), [baseForUniques, currentFilters, search]);
    const uniqueVars = useMemo(() => getUniqueForField('varValue', currentFilters), [baseForUniques, currentFilters, search]);

    const filteredResults = results.filter(r => {
        if (search && !r.employeeCode.includes(search) && !r.fullName.toLowerCase().includes(search.toLowerCase())) return false
        if (!checkMatch(r.status, filterStatus)) return false
        if (!checkMatch(r.employeeCode, filterEmployee)) return false
        if (!checkMatch(r.leaderName, filterLeader)) return false
        if (!checkMatch(r.pic, filterPic)) return false
        if (!checkMatch(r.mgt, filterMgt)) return false
        if (!checkMatch(r.employeeType, filterType)) return false
        if (!checkMatch(r.submittedShift, filterShift)) return false
        if (!checkMatch(r.supervisor, filterSupervisor)) return false
        if (!checkMatch(r.submittedOt, filterOt)) return false
        if (!checkMatch(r.realIn, filterIn)) return false
        if (!checkMatch(r.realOut, filterOut)) return false
        if (!checkMatch(r.expectedOt, filterExpectedOt)) return false
        if (!checkMatch(r.reason, filterReason)) return false
        if (!checkMatch(r.varValue !== undefined ? r.varValue.toFixed(2) : '_BLANK_', filterVar)) return false
        return true
    })

    const { warningAbsDiff, warningNetDiff } = useMemo(() => {
        return filteredResults
            .filter(r => r.status === 'WARNING' || r.status === 'ERROR')
            .reduce((acc, r) => {
                const sub = Number(r.submittedOt) || 0
                const exp = typeof r.expectedOt === 'number' ? r.expectedOt : (parseFloat(String(r.expectedOt)) || 0)
                acc.warningAbsDiff += Math.abs(sub - exp)
                acc.warningNetDiff += (sub - exp)
                return acc
            }, { warningAbsDiff: 0, warningNetDiff: 0 })
    }, [filteredResults])

    return (
        <div className="flex flex-col flex-1 bg-slate-50 overflow-hidden">
            {portalNode && createPortal(
                <div className="flex flex-col">
                    <h1 className="text-lg font-bold text-gray-800 tracking-tight flex items-center gap-2">
                        <Upload className="text-emerald-500" size={20} /> Excel Audit
                    </h1>
                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">Xác minh dữ liệu Chấm công từ file Excel</p>
                </div>,
                portalNode
            )}

            <div className="px-6 py-1 shrink-0 flex flex-wrap gap-8 items-center bg-white border-b border-gray-100 relative z-10 font-sans">
                <div className="flex items-center gap-8 border-b border-gray-100 lg:w-auto">
                    <div className="py-3 px-1 text-[13px] font-bold text-orange-600 relative">
                        Chi tiết bảng biểu Excel
                        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-orange-500 rounded-full" />
                    </div>
                    {isExcelMode ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm uppercase tracking-wider animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            File Excel Đã Tải Lên
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200 shadow-sm uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            Dữ liệu Hệ thống
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-4 ml-2">
                    <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100 shadow-sm">
                        <button onClick={() => {
                            const d = new Date(selectedDate);
                            d.setDate(d.getDate() - 1);
                            setSelectedDate(format(d, 'yyyy-MM-dd'));
                        }} className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-400">
                            <ChevronLeft size={16} />
                        </button>
                        <div className="relative group">
                            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border-none bg-transparent px-2 py-1 outline-none text-[11px] font-bold text-gray-600 uppercase tracking-wider transition-all w-32 text-center" />
                        </div>
                        <button onClick={() => {
                            const d = new Date(selectedDate);
                            d.setDate(d.getDate() + 1);
                            setSelectedDate(format(d, 'yyyy-MM-dd'));
                        }} className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-400">
                            <ChevronRight size={16} />
                        </button>
                    </div>
                    {summaryData.length > 0 && (
                        <div className="bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100 flex flex-col items-center">
                            <span className="text-[10px] font-bold text-orange-400 uppercase leading-none">Kỳ công</span>
                            <span className="text-[11px] font-bold text-orange-700">
                                {format(new Date(summaryData[0].date), 'dd/MM')} - {format(new Date(summaryData[summaryData.length - 1].date), 'dd/MM')}
                            </span>
                        </div>
                    )}
                </div>

                <div className="ml-auto flex items-center gap-3">
                    <button onClick={() => fileInputRef.current?.click()} disabled={isFetching} className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[11px] font-bold shadow-sm active:scale-95 transition-all disabled:opacity-50 uppercase tracking-wider">
                        <Upload className={cn("w-3.5 h-3.5", isFetching && "animate-bounce")} />
                        Import Excel
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls" className="hidden" />

                    {/* Export functions are always visible so that clerks can export standard fingerprint audit and excel imported audit results seamlessly */}
                    <button onClick={exportErrorWarningExcel} disabled={isFetching} className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[11px] font-bold shadow-sm active:scale-95 transition-all disabled:opacity-50 uppercase tracking-wider">
                        <Download className="w-3.5 h-3.5" />
                        Export Errors
                    </button>
                    <button onClick={exportAllExcel} disabled={isFetching} className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-[11px] font-bold shadow-sm active:scale-95 transition-all disabled:opacity-50 uppercase tracking-wider">
                        <Download className="w-3.5 h-3.5" />
                        Export All
                    </button>

                    {isExcelMode && (
                        <>
                            <button onClick={handleSyncValid} disabled={isFetching} className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-[11px] font-bold shadow-sm active:scale-95 transition-all disabled:opacity-50 uppercase tracking-wider">
                                <Upload className={cn("w-3.5 h-3.5", isFetching && "animate-bounce")} />
                                Sync Valid Data
                            </button>
                            <button onClick={() => { setExcelResults([]); setIsExcelMode(false); setSummaryData([]); setResults([]); }} disabled={isFetching} className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-[11px] font-bold shadow-sm active:scale-95 transition-all disabled:opacity-50 uppercase tracking-wider">
                                <XCircle className="w-3.5 h-3.5" />
                                Clear Data
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col p-6">
                <div className="bg-white border border-gray-200 shadow-md rounded-xl flex-1 flex flex-col overflow-hidden">
                        {/* Toolbar (Main Table) */}
                        <div className="p-4 border-b border-gray-100 flex flex-col gap-4 bg-gray-50/50">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="relative">
                                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            type="text"
                                            placeholder="Search Name/Code..."
                                            value={search}
                                            onChange={e => setSearch(e.target.value)}
                                            className="pl-9 pr-4 py-1.5 border border-gray-300 rounded-lg text-sm w-64 focus:ring-2 outline-none"
                                        />
                                    </div>
                                    <div className="text-sm text-gray-500 bg-white px-3 py-1.5 rounded-lg border border-gray-200 flex items-center gap-4 shadow-sm">
                                        <div className="flex items-center gap-2">
                                            <Info size={14} className="text-blue-500" />
                                            Rows: <span className="font-bold text-gray-800">{filteredResults.length}</span> / {results.length}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex bg-gray-100 p-1 rounded-lg">
                                    {(['', 'ERROR', 'WARNING', 'VALID']).map(f => (
                                        <button
                                            key={f}
                                            onClick={() => setFilterStatus(f)}
                                            className={cn(
                                                "px-4 py-1 text-sm font-bold rounded-md transition-all",
                                                filterStatus === f ? "bg-white text-blue-600 shadow-sm ring-1 ring-black/5" : "text-gray-500 hover:text-gray-700"
                                            )}
                                        >
                                            {f === '' && "All"}
                                            {f === 'ERROR' && "Errors"}
                                            {f === 'WARNING' && "Warnings"}
                                            {f === 'VALID' && "Valid"}
                                        </button>
                                    ))}
                                    <button onClick={() => { setFilterEmployee(''); setFilterLeader(''); setFilterSupervisor(''); setFilterPic(''); setFilterMgt(''); setFilterType(''); setFilterShift(''); setFilterOt(''); setFilterIn(''); setFilterOut(''); setFilterExpectedOt(''); setFilterReason(''); setFilterStatus(''); setFilterVar('') }} className="ml-2 px-3 py-1 text-sm bg-white shadow-sm hover:bg-gray-50 rounded-md transition-colors text-red-500 font-bold border border-gray-200">Reset</button>
                                </div>
                            </div>
                        </div>

                        {/* Table */}
                        <div className="flex-1 overflow-auto xl-scrollbar relative">
                            {results.length === 0 && !isFetching && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                                    <CheckCircle2 className="w-12 h-12 text-gray-300 mb-3" />
                                    <p className="font-bold">No Audit Data for this date.</p>
                                    <p className="text-xs text-gray-400">Ensure fingerprint files are uploaded for {selectedDate}.</p>
                                </div>
                            )}
                            {isFetching && results.length === 0 && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-white/50 backdrop-blur-sm z-20">
                                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                                    <p className="font-black uppercase tracking-widest text-sm">Synchronizing Records...</p>
                                </div>
                            )}
                            <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                                <thead className="bg-gray-50 text-gray-500 sticky top-0 z-10 shadow-sm backdrop-blur-md">
                                    <tr>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top">
                                            <div className="font-bold mb-2 uppercase tracking-tighter">Status</div>
                                            <FilterDropdown value={filterStatus} onChange={setFilterStatus} options={uniqueStatuses} inputClass="sm:w-28" />
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top">
                                            <div className="font-bold mb-2 uppercase tracking-tighter">Employee</div>
                                            <FilterDropdown value={filterEmployee} onChange={setFilterEmployee} options={uniqueEmployees} inputClass="sm:w-28" />
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top">
                                            <div className="font-bold mb-2 uppercase tracking-tighter">Leader</div>
                                            <FilterDropdown value={filterLeader} onChange={setFilterLeader} options={uniqueLeaders} inputClass="sm:w-32" />
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top">
                                            <div className="font-bold mb-2 uppercase tracking-tighter">Supervisor</div>
                                            <FilterDropdown value={filterSupervisor} onChange={setFilterSupervisor} options={uniqueSupervisors} inputClass="sm:w-32" />
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top">
                                            <div className="font-bold mb-2 uppercase tracking-tighter">PIC</div>
                                            <FilterDropdown value={filterPic} onChange={setFilterPic} options={uniquePics} inputClass="sm:w-24" />
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top">
                                            <div className="font-bold mb-2 uppercase tracking-tighter">MGT</div>
                                            <FilterDropdown value={filterMgt} onChange={setFilterMgt} options={uniqueMgts} inputClass="sm:w-20" />
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top">
                                            <div className="font-bold mb-2 uppercase tracking-tighter">Type</div>
                                            <FilterDropdown value={filterType} onChange={setFilterType} options={uniqueTypes} inputClass="sm:w-24" />
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top">
                                            <div className="font-bold mb-2 uppercase tracking-tighter">Shift</div>
                                            <FilterDropdown value={filterShift} onChange={setFilterShift} options={uniqueShifts} inputClass="sm:w-24" />
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top font-bold uppercase tracking-tighter bg-blue-50/30">
                                            <div className="mb-2">Submit OT</div>
                                            <FilterDropdown value={filterOt} onChange={setFilterOt} options={uniqueOts} inputClass="sm:w-20" />
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top font-bold uppercase tracking-tighter bg-emerald-50/30">
                                            <div className="mb-2">Fingerprint</div>
                                            <div className="flex flex-col gap-1">
                                                <FilterDropdown value={filterIn} onChange={setFilterIn} options={uniqueIns} placeholder="IN" inputClass="w-full" />
                                                <FilterDropdown value={filterOut} onChange={setFilterOut} options={uniqueOuts} placeholder="OUT" inputClass="w-full" />
                                            </div>
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top font-bold uppercase tracking-tighter bg-emerald-50/30">
                                            <div className="mb-2">Expect OT</div>
                                            <FilterDropdown value={filterExpectedOt} onChange={setFilterExpectedOt} options={uniqueExpectedOts} inputClass="sm:w-20" />
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top font-bold uppercase tracking-tighter bg-amber-50/30 text-amber-700">
                                            <div className="mb-2">Var</div>
                                            <FilterDropdown value={filterVar} onChange={setFilterVar} options={uniqueVars} inputClass="sm:w-20" />
                                        </th>
                                        <th className="px-4 py-3 border-b border-gray-100 align-top font-bold uppercase tracking-tighter text-red-600">
                                            <div className="mb-2">Discrepancy Detail</div>
                                            <FilterDropdown value={filterReason} onChange={setFilterReason} options={uniqueReasons} inputClass="sm:w-32" />
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {filteredResults.map((r, i) => (
                                        <tr key={i} className={cn("hover:bg-gray-50 transition-colors", r.status === 'ERROR' && "bg-red-50/50 hover:bg-red-50", r.status === 'WARNING' && "bg-yellow-50/50 hover:bg-yellow-50")}>
                                            <td className="px-4 py-3">
                                                {r.status === 'VALID' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-[10px]"><CheckCircle size={12} /> VALID</span>}
                                                {r.status === 'ERROR' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold text-[10px]"><XCircle size={12} /> ERROR</span>}
                                                {r.status === 'WARNING' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-bold text-[10px]"><AlertTriangle size={12} /> WARNING</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-black text-gray-900">{r.employeeCode}</div>
                                                <div className="text-gray-400 font-medium truncate max-w-[120px]">{r.fullName}</div>
                                            </td>
                                            <td className="px-4 py-3 text-gray-700 font-medium">{r.leaderName}</td>
                                            <td className="px-4 py-3 text-gray-500 font-medium italic">{r.supervisor || 'N/A'}</td>
                                            <td className="px-4 py-3 text-gray-500">{r.pic || '-'}</td>
                                            <td className="px-4 py-3 text-[10px] font-bold text-blue-600 uppercase">{r.mgt || 'N/A'}</td>
                                            <td className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase">{r.employeeType || 'N/A'}</td>
                                            <td className="px-4 py-3 font-black text-gray-800">{r.submittedShift}</td>
                                            <td className="px-4 py-3 font-mono font-black text-blue-700 bg-blue-50/10 text-center">{r.submittedOt || '0'}</td>
                                            <td className="px-4 py-3 font-mono text-emerald-800 bg-emerald-50/10">
                                                <div className="flex flex-col">
                                                    <span className="font-bold">IN: {r.realIn || '--:--'}</span>
                                                    <span className="font-bold">OUT: {r.realOut || '--:--'}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-emerald-800 bg-emerald-50/10 font-black text-center">{r.expectedOt || '0'}</td>
                                            <td className="px-4 py-3 font-mono text-amber-700 bg-amber-50/10 font-black text-center">
                                                {r.varValue !== undefined ? r.varValue.toFixed(2) : '0.00'}
                                            </td>
                                            <td className={cn("px-4 py-3 font-bold text-[11px] whitespace-normal min-w-[200px]", r.status === 'ERROR' ? "text-red-600" : "text-gray-500")}>
                                                {r.reason || 'Data matches perfectly'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
            </div>
        </div>
    )
}
