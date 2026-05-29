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
        <div className="relative w-full font-normal text-left">
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

function TotalWorkDashboard({ 
    data, 
    isFetching,
    supervisorStats = [],
    lineLeaderStats = [],
    shiftStats = [],
    selectedDate,
    setSelectedDate,
    results = []
}: { 
    data: any[], 
    isFetching: boolean,
    supervisorStats?: any[],
    lineLeaderStats?: any[],
    shiftStats?: any[],
    selectedDate: string,
    setSelectedDate: (d: string) => void,
    results: any[]
}) {
    const [dashDate, setDashDate] = useState<string>('ALL');

    const handleDateSelect = (date: string) => {
        setDashDate(date);
        if (date !== 'ALL') setSelectedDate(date);
    }

    const { activeSupStats, activeLeaderStats, activeShiftStats, trendData } = useMemo(() => {
        let sup = [...supervisorStats];
        let ldr = [...lineLeaderStats];
        let shf = [...shiftStats];
        let trd = data.map(d => ({ ...d, absDiff: d.absDiffWarning })); // Focus on Warnings

        if (dashDate !== 'ALL') {
            trd = trd.filter(d => d.date === dashDate);

            const tSup: Record<string, any> = {};
            const tLdr: Record<string, any> = {};
            const tShf: Record<string, any> = {};
            
            results.filter(r => r.status === 'WARNING').forEach(r => {
                const sn = r.supervisor || 'N/A';
                const ln = r.leaderName || 'N/A';
                const sc = r.submittedShift || 'N/A';
                const eo = typeof r.expectedOt === 'number' ? r.expectedOt : (parseFloat(String(r.expectedOt)) || 0);
                const diff = Math.abs((r.submittedOt || 0) - eo);
                
                if (diff > 0) {
                    if (!tSup[sn]) tSup[sn] = { name: sn, absDiff: 0 };
                    tSup[sn].absDiff += diff;

                    if (!tLdr[ln]) tLdr[ln] = { name: ln, absDiff: 0 };
                    tLdr[ln].absDiff += diff;

                    if (!tShf[sc]) tShf[sc] = { name: sc, absDiff: 0 };
                    tShf[sc].absDiff += diff;
                }
            });
            sup = Object.values(tSup);
            ldr = Object.values(tLdr);
            shf = Object.values(tShf);
        } else {
            // Mapping for ALL mode
            sup = sup.map(s => ({ ...s, absDiff: s.absDiffWarning }));
            ldr = ldr.map(l => ({ ...l, absDiff: l.absDiffWarning }));
            shf = shf.map(s => ({ ...s, absDiff: s.absDiffWarning }));
        }

        const finalize = (arr: any[]) => arr.filter(i => i.absDiff > 0).sort((a,b) => b.absDiff - a.absDiff);

        return {
            activeSupStats: finalize(sup),
            activeLeaderStats: finalize(ldr),
            activeShiftStats: finalize(shf),
            trendData: trd
        }

    }, [dashDate, data, supervisorStats, lineLeaderStats, shiftStats, results]);

    if (isFetching && data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center bg-white rounded-xl shadow-sm border border-gray-50 py-12 shrink-0">
                <Loader2 className="w-8 h-8 text-orange-500 animate-spin mb-3" />
                <p className="text-gray-400 font-bold text-sm animate-pulse uppercase tracking-widest">Đang tải dữ liệu tổng hợp...</p>
            </div>
        )
    }

    if (data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center bg-white rounded-xl shadow-sm border border-gray-50 py-16 text-gray-400">
                <LayoutDashboard className="w-12 h-12 text-gray-300 mb-3" />
                <p className="font-bold">Không có dữ liệu cảnh báo trong kỳ này.</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-6 font-sans shrink-0 text-left">
            {/* Simple Dropdown Header */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between sticky top-0 z-20 mx-[2px]">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="text-yellow-500 w-5 h-5" />
                    <h2 className="text-sm font-black text-gray-800 uppercase tracking-widest">Cảnh báo Case (Warning Only)</h2>
                </div>
                
                <div className="flex items-center gap-3">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Chọn thời điểm:</span>
                    <select 
                        value={dashDate} 
                        onChange={e => handleDateSelect(e.target.value)}
                        className="bg-gray-50 border border-gray-200 text-gray-700 text-[12px] font-bold rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-orange-500 outline-none transition-all cursor-pointer"
                    >
                        <option value="ALL">Tất cả các ngày trong kỳ</option>
                        {data.map(d => (
                            <option key={d.date} value={d.date}>
                                Ngày {format(new Date(d.date), 'dd/MM')} {d.absDiffWarning > 0 ? `(${d.absDiffWarning.toFixed(1)}h ⚠️)` : '(OK)'}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Main Trend Chart */}
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-4">
                <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">
                    <Activity className="text-orange-500" size={20} /> Biểu đồ Xu hướng Cảnh báo (Warning Hours)
                </h3>
                <div className="h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                            <XAxis dataKey="date" tickFormatter={(str) => format(new Date(str), 'dd')} tick={{fontSize: 12, fontWeight: 'bold'}} axisLine={false} tickLine={false} />
                            <YAxis tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                            <Tooltip cursor={{fill: '#fcfcfc'}} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                            <Bar dataKey="absDiff" name="Warning Work (h)" fill="#f59e0b" radius={[4, 4, 0, 0]}>
                                <LabelList dataKey="absDiff" position="top" style={{ fontSize: '10px', fontWeight: 'bold' }} formatter={(v: any) => v > 0 ? Number(v).toFixed(1) : ''} />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {/* Line Leader Work Chart - Column Chart */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-4">
                    <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">
                        <UserCheck className="text-purple-500" size={20} /> Tổng giờ lệch theo Line Leader
                    </h3>
                    <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={activeLeaderStats.slice(0, 15)}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                <XAxis dataKey="name" tick={{fontSize: 10, fontWeight: 'bold'}} axisLine={false} tickLine={false} />
                                <YAxis tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                                <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '12px', border: 'none' }} />
                                <Bar dataKey="absDiff" name="Warning Hours" fill="#a855f7" radius={[4, 4, 0, 0]}>
                                    <LabelList dataKey="absDiff" position="top" style={{ fontSize: '10px', fontWeight: 'bold' }} formatter={(v: any) => Number(v).toFixed(1)} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Supervisor Work Chart */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-4 lg:col-span-2">
                    <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
                        <TrendingUp className="text-blue-500" size={18} /> Theo Supervisor
                    </h3>
                    <div className="h-[300px] w-full text-xs">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={activeSupStats.slice(0, 15)} layout="vertical" margin={{ right: 40 }}>
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" tick={{fontSize: 9, fontWeight: 'bold'}} width={120} axisLine={false} tickLine={false} />
                                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
                                <Bar dataKey="absDiff" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={15}>
                                    <LabelList dataKey="absDiff" position="right" style={{ fontSize: '10px', fontWeight: 'bold' }} formatter={(v: any) => Number(v).toFixed(1)} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Shift Work Chart */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-4 lg:col-span-1">
                    <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
                        <Calendar className="text-emerald-500" size={18} /> Theo Ca làm việc
                    </h3>
                    <div className="h-[300px] w-full text-xs">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={activeShiftStats} margin={{ top: 30 }}>
                                <XAxis dataKey="name" tick={{fontSize: 10, fontWeight: 'bold'}} axisLine={false} tickLine={false} />
                                <YAxis hide />
                                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
                                <Bar dataKey="absDiff" fill="#10b981" radius={[4, 4, 0, 0]}>
                                    <LabelList dataKey="absDiff" position="top" style={{ fontSize: '10px', fontWeight: 'bold' }} formatter={(v: any) => Number(v).toFixed(1)} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default function ExcelDashboardPage() {
    const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
    const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'))
    const [isFetching, setIsFetching] = useState(false)
    const [results, setResults] = useState<AuditResult[]>([])
    const [summaryData, setSummaryData] = useState<any[]>([])
    const [supervisorStats, setSupervisorStats] = useState<any[]>([])
    const [lineLeaderStats, setLineLeaderStats] = useState<any[]>([])
    const [shiftStats, setShiftStats] = useState<any[]>([])
    const [search, setSearch] = useState('')
    const [isExcelMode, setIsExcelMode] = useState(false)

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
            setSupervisorStats([])
            setLineLeaderStats([])
            setShiftStats([])
        } finally {
            setIsFetching(false)
        }
    }

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
            setResults([])
        } finally {
            setIsFetching(false)
        }
    }

    // Load from sessionStorage on mount (if available)
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

                if (savedExcelResults) {
                    const parsed = JSON.parse(savedExcelResults);
                    setResults(parsed);
                }
                if (savedSummaryData) setSummaryData(JSON.parse(savedSummaryData));
                if (savedSupervisorStats) setSupervisorStats(JSON.parse(savedSupervisorStats));
                if (savedLineLeaderStats) setLineLeaderStats(JSON.parse(savedLineLeaderStats));
                if (savedShiftStats) setShiftStats(JSON.parse(savedShiftStats));
                if (savedSelectedMonth) setSelectedMonth(savedSelectedMonth);
                if (savedSelectedDate) setSelectedDate(savedSelectedDate);
                setIsExcelMode(true);
            } else {
                // If not in Excel mode, load standard month audit data from DB
                fetchSummaryData(selectedMonth)
                fetchAuditData(selectedDate)
            }
        } catch (e) {
            console.error('Failed to load audit state in dashboard:', e);
            fetchSummaryData(selectedMonth)
            fetchAuditData(selectedDate)
        }
    }, []);

    // If not in Excel mode, sync state when date/month changes
    useEffect(() => {
        const savedExcelMode = typeof window !== 'undefined' ? sessionStorage.getItem('audit_isExcelMode') : null;
        if (!isExcelMode && savedExcelMode !== 'true') {
            fetchSummaryData(selectedMonth)
        }
    }, [selectedMonth, isExcelMode])

    useEffect(() => {
        const savedExcelMode = typeof window !== 'undefined' ? sessionStorage.getItem('audit_isExcelMode') : null;
        if (!isExcelMode && savedExcelMode !== 'true') {
            fetchAuditData(selectedDate)
        } else if (isExcelMode) {
            // In excel mode, filter results for the selected date
            try {
                const savedExcelResults = sessionStorage.getItem('audit_excelResults');
                if (savedExcelResults) {
                    const parsed = JSON.parse(savedExcelResults) as AuditResult[];
                    setResults(parsed.filter(r => r.date === selectedDate));
                }
            } catch (e) {
                console.error(e);
            }
        }
    }, [selectedDate, isExcelMode])

    const checkMatch = (val: any, filterVal: string) => {
        if (!filterVal) return true;
        const normalizedVal = (val === null || val === undefined || val === '') ? '_BLANK_' : String(val);
        return normalizedVal === filterVal;
    }

    const uniqueStatuses = useMemo(() => Array.from(new Set(results.map(r => r.status))).sort(), [results])
    
    // Base results for unique value calculation, focusing only on Errors & Warnings in Dashboard mode
    const baseForUniques = useMemo(() => {
        return results.filter(r => r.status === 'WARNING' || r.status === 'ERROR');
    }, [results]);

    const getUniqueForField = (field: keyof AuditResult, currentFilters: any) => {
        return Array.from(new Set(
            baseForUniques
                .filter(r => {
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

    return (
        <div className="flex flex-col flex-1 bg-slate-50 overflow-hidden">
            {portalNode && createPortal(
                <div className="flex flex-col">
                    <h1 className="text-lg font-bold text-gray-800 tracking-tight flex items-center gap-2">
                        <LayoutDashboard className="text-orange-500" size={20} /> Excel Dashboard
                    </h1>
                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">
                        {isExcelMode ? 'Báo cáo tổng hợp từ dữ liệu Excel' : 'Báo cáo tổng hợp từ dữ liệu Hệ thống'}
                    </p>
                </div>,
                portalNode
            )}

            <div className="px-6 py-1 shrink-0 flex flex-wrap gap-8 items-center bg-white border-b border-gray-100 relative z-10 font-sans">
                <div className="flex items-center gap-8 border-b border-gray-100 lg:w-auto">
                    <div className="py-3 px-1 text-[13px] font-bold text-orange-600 relative">
                        Bảng điều khiển & Phân tích
                        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-orange-500 rounded-full" />
                    </div>
                </div>

                <div className="flex items-center gap-4 ml-2">
                    <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100 shadow-sm">
                        <button onClick={() => {
                            const d = parseISO(selectedMonth + '-01');
                            setSelectedMonth(format(subMonths(d, 1), 'yyyy-MM'));
                        }} className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-400">
                            <ChevronLeft size={16} />
                        </button>
                        <div className="relative group">
                            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="border-none bg-transparent px-2 py-1 outline-none text-[11px] font-bold text-gray-600 uppercase tracking-wider transition-all w-32 text-center" />
                        </div>
                        <button onClick={() => {
                            const d = parseISO(selectedMonth + '-01');
                            setSelectedMonth(format(addMonths(d, 1), 'yyyy-MM'));
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
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-6 p-6 xl-scrollbar">
                <TotalWorkDashboard 
                    data={summaryData} 
                    isFetching={isFetching} 
                    supervisorStats={supervisorStats}
                    lineLeaderStats={lineLeaderStats}
                    shiftStats={shiftStats}
                    selectedDate={selectedDate}
                    setSelectedDate={setSelectedDate}
                    results={results}
                />

                {/* Table Section inside Dashboard */}
                <div className="bg-white border border-gray-200 shadow-md rounded-xl flex flex-col overflow-hidden min-h-[500px] shrink-0 text-left">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                        <h3 className="text-sm font-black text-gray-800 flex items-center gap-2">
                            <TableIcon size={18} className="text-gray-500" /> Bảng chi tiết ngày {format(parseISO(selectedDate), 'dd/MM/yyyy')}
                        </h3>
                    </div>
                    {/* Toolbar */}
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
                                        Rows: <span className="font-bold text-gray-800">{filteredResults.filter(r => r.status === 'WARNING' || r.status === 'ERROR').length}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="text-xs font-black text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-200 shadow-sm flex items-center gap-2 uppercase tracking-widest">
                                <AlertTriangle size={14} /> Only Warning / Error Cases
                            </div>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="flex-1 overflow-auto xl-scrollbar relative">
                        {results.length === 0 && !isFetching && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 py-12">
                                <CheckCircle2 className="w-12 h-12 text-gray-300 mb-3" />
                                <p className="font-bold">No Audit Data for this date.</p>
                                <p className="text-xs text-gray-400">Ensure fingerprint files are uploaded for {selectedDate}.</p>
                            </div>
                        )}
                        {isFetching && results.length === 0 && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-white/50 backdrop-blur-sm z-20 py-12">
                                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                                <p className="font-black uppercase tracking-widest text-sm">Synchronizing Records...</p>
                            </div>
                        )}
                        <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                            <thead className="bg-gray-50 text-gray-500 sticky top-0 z-10 shadow-sm backdrop-blur-md">
                                <tr>
                                    <th className="px-4 py-3 border-b border-gray-100 align-top font-bold uppercase tracking-tighter">Ngày</th>
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
                                    <th className="px-4 py-3 border-b border-gray-100 align-top font-bold uppercase tracking-tighter text-orange-600">
                                        <div className="mb-2">Discrepancy (Warning/Error)</div>
                                        <FilterDropdown value={filterReason} onChange={setFilterReason} options={uniqueReasons} inputClass="sm:w-32" />
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredResults.filter(r => r.status === 'WARNING' || r.status === 'ERROR').map((r, i) => (
                                    <tr key={i} className={cn("hover:bg-slate-100 transition-colors", r.status === 'ERROR' ? "bg-red-50/30 hover:bg-red-50/50" : "bg-yellow-50/30 hover:bg-yellow-50/50")}>
                                        <td className="px-4 py-3 text-gray-500 font-bold">{r.date ? format(new Date(r.date), 'dd/MM') : '--/--'}</td>
                                        <td className="px-4 py-3">
                                            <div className="font-black text-gray-900">{r.employeeCode}</div>
                                            <div className="text-gray-400 font-medium truncate max-w-[120px]">{r.fullName}</div>
                                        </td>
                                        <td className="px-4 py-3 text-gray-700 font-medium">{r.leaderName}</td>
                                        <td className="px-4 py-3 text-gray-500 font-medium italic">{r.supervisor || 'N/A'}</td>
                                        <td className="px-4 py-3 text-gray-500">{r.pic || '-'}</td>
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
                                        <td className={cn("px-4 py-3 font-bold text-[11px] whitespace-normal min-w-[200px]", r.status === 'ERROR' ? 'text-red-600' : 'text-gray-500')}>
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
