'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
    CalendarDays, 
    AlertTriangle, 
    Search, 
    RefreshCw, 
    MapPin, 
    X,
    TableProperties
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface LeaveRecord {
    id: number;
    employeeCode: string;
    employeeName: string;
    recordDate: string;
    leaveType: string;
    zone: string | null;
    shiftLeader: string | null;
    lineLeader: string | null;
}

export default function LeaveRecordsPage() {
    const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
    const [records, setRecords] = useState<LeaveRecord[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    
    // Filters
    const [search, setSearch] = useState('');
    const [selectedLeaveType, setSelectedLeaveType] = useState('');
    const [selectedDate, setSelectedDate] = useState('');

    useEffect(() => {
        setPortalNode(document.getElementById('timesheet-header-portal'));
        fetchRecords();
    }, [search, selectedLeaveType, selectedDate]);

    const fetchRecords = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (search) params.append('search', search);
            if (selectedLeaveType) params.append('leaveType', selectedLeaveType);
            if (selectedDate) params.append('date', selectedDate);

            const res = await fetch(`/api/leave?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch records');
            const data = await res.json();
            
            setRecords(data.records || []);
            setLeaveTypes(data.leaveTypes || []);
        } catch (error: any) {
            console.error('Error fetching leave records:', error);
            toast.error('Không thể tải danh sách nghỉ phép: ' + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSync = async () => {
        setIsSyncing(true);
        try {
            const res = await fetch('/api/leave', { method: 'POST' });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || 'Sync failed');
            
            toast.success(
                `Đồng bộ thành công! Đã cập nhật ${data.count} bản ghi từ file ${data.fileUsed}${
                    data.isFallback ? ' (Dùng file Level 3 làm fallback)' : ''
                }.`
            );
            fetchRecords();
        } catch (error: any) {
            console.error('Sync error:', error);
            toast.error('Lỗi khi đồng bộ file Excel: ' + error.message);
        } finally {
            setIsSyncing(false);
        }
    };

    // Reset all filters
    const handleClearFilters = () => {
        setSearch('');
        setSelectedLeaveType('');
        setSelectedDate('');
        toast.success('Đã đặt lại các bộ lọc');
    };

    // Color mapper for leave types
    const getLeaveBadgeClass = (type: string) => {
        const t = type.toUpperCase().trim();
        if (t === 'AL') return 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100/70'; // Annual Leave
        if (t === 'CL') return 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100/70'; // Casual Leave
        if (t === 'SL') return 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100/70'; // Sick Leave
        if (t === 'UL') return 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100/70'; // Unpaid Leave
        return 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100/70';
    };

    const getLeaveName = (type: string) => {
        const t = type.toUpperCase().trim();
        if (t === 'AL') return 'Phép năm (AL)';
        if (t === 'CL') return 'Việc riêng (CL)';
        if (t === 'SL') return 'Phép bệnh (SL)';
        if (t === 'UL') return 'Nghỉ không lương (UL)';
        return `Nghỉ phép (${t})`;
    };

    const hasActiveFilters = search !== '' || selectedLeaveType !== '' || selectedDate !== '';

    return (
        <div className="flex flex-col h-full bg-slate-50/35 p-6 font-sans gap-5">
            {portalNode && createPortal(
                <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex flex-col">
                        <h1 className="text-lg font-bold text-slate-800 tracking-tight flex items-center gap-2">
                            <div className="p-1 rounded-lg bg-red-50">
                                <CalendarDays className="text-[#D10000]" size={18} />
                            </div>
                            <span>Lịch Đăng Ký Nghỉ Phép</span>
                        </h1>
                    </div>
                    
                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className={cn(
                            "cursor-pointer flex items-center gap-1.5 px-4 py-1.5 bg-slate-950 hover:bg-slate-900 active:scale-98 disabled:bg-slate-300 text-white rounded-xl text-[11px] font-bold shadow-md hover:shadow-lg transition-all uppercase tracking-wider h-[32px] whitespace-nowrap",
                            isSyncing && "opacity-75"
                        )}
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5", isSyncing && "animate-spin")} />
                        {isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ từ ổ V'}
                    </button>
                </div>,
                portalNode
            )}


            {/* Filters Row */}
            <div className="bg-white border border-slate-150 shadow-xs rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Search */}
                    <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden focus-within:ring-3 focus-within:ring-slate-500/5 focus-within:border-slate-400 transition-all shadow-xs h-9">
                        <div className="px-3 h-full bg-slate-50 border-r border-slate-100 flex items-center gap-1.5 text-xs font-bold text-slate-500 select-none">
                            <Search size={13} className="text-slate-400" />
                            <span>Tìm kiếm</span>
                        </div>
                        <input
                            type="text"
                            placeholder="Mã NV, Tên, Trưởng ca..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="px-4 py-1.5 text-xs bg-transparent outline-none w-52 font-medium text-slate-700 placeholder-slate-400"
                        />
                        {search && (
                            <button 
                                onClick={() => setSearch('')}
                                className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Leave Type Dropdown */}
                    <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs h-9">
                        <div className="px-3 h-full bg-slate-50 border-r border-slate-100 flex items-center text-xs font-bold text-slate-500 select-none">
                            Loại phép
                        </div>
                        <select
                            value={selectedLeaveType}
                            onChange={e => setSelectedLeaveType(e.target.value)}
                            className="pl-3 pr-8 py-1.5 text-xs bg-transparent outline-none cursor-pointer text-slate-700 font-bold appearance-none bg-no-repeat bg-[right_8px_center] bg-[length:12px]"
                            style={{ backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>")` }}
                        >
                            <option value="">Tất cả loại phép</option>
                            {leaveTypes.map(t => (
                                <option key={t} value={t}>{getLeaveName(t)}</option>
                            ))}
                        </select>
                    </div>

                    {/* Date Input */}
                    <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs h-9">
                        <div className="px-3 h-full bg-slate-50 border-r border-slate-100 flex items-center text-xs font-bold text-slate-500 select-none">
                            Ngày nghỉ
                        </div>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={e => setSelectedDate(e.target.value)}
                            className="px-3 py-1.5 text-xs bg-transparent outline-none text-slate-700 font-bold cursor-pointer"
                        />
                        {selectedDate && (
                            <button 
                                onClick={() => setSelectedDate('')} 
                                className="px-2 text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Clear Filter Button */}
                    {hasActiveFilters && (
                        <button
                            onClick={handleClearFilters}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 hover:text-slate-800 rounded-xl text-xs font-bold transition-all shadow-xs border border-slate-200/60"
                        >
                            <X size={13} />
                            Đặt lại bộ lọc
                        </button>
                    )}
                </div>

                <div className="text-xs font-bold text-slate-400 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                    <TableProperties size={13} className="text-slate-400" />
                    <span>Tìm thấy:</span>
                    <span className="text-slate-850 font-black text-sm">{records.length}</span>
                    <span>bản ghi</span>
                </div>
            </div>

            {/* Table Container */}
            <div className="flex-1 bg-white border border-slate-150 shadow-xs rounded-3xl overflow-hidden flex flex-col min-h-0 transition-all duration-300">
                {isLoading ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-24 text-slate-400 select-none">
                        <div className="p-3 rounded-full bg-slate-50 animate-pulse">
                            <RefreshCw className="animate-spin text-slate-400" size={32} />
                        </div>
                        <span className="text-xs font-bold tracking-widest text-slate-500 uppercase">Đang truy vấn dữ liệu...</span>
                    </div>
                ) : records.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-24 text-slate-400 select-none px-6 text-center">
                        <div className="p-4 rounded-full bg-slate-50 border border-slate-100">
                            <AlertTriangle className="text-slate-300" size={40} />
                        </div>
                        <span className="text-sm font-bold text-slate-600 tracking-wide">Không tìm thấy bản ghi nghỉ phép nào</span>
                        <p className="text-xs text-slate-400 max-w-sm">
                            Vui lòng điều chỉnh lại bộ lọc tìm kiếm hoặc bấm nút <span className="font-bold text-slate-600">"Đồng bộ từ ổ V"</span> để cập nhật dữ liệu mới nhất.
                        </p>
                        {hasActiveFilters && (
                            <button
                                onClick={handleClearFilters}
                                className="mt-2 flex items-center gap-1 px-4 py-2 bg-slate-950 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-md"
                            >
                                Xóa bộ lọc tìm kiếm
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="flex-1 overflow-auto">
                        <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                            <thead className="bg-slate-50/70 sticky top-0 z-10 border-b border-slate-100 text-slate-500 text-[11px] font-bold tracking-wider uppercase">
                                <tr>
                                    <th className="px-6 py-4">Nhân viên</th>
                                    <th className="px-6 py-4">Ngày nghỉ</th>
                                    <th className="px-6 py-4">Loại phép đăng ký</th>
                                    <th className="px-6 py-4">Khu vực (Zone)</th>
                                    <th className="px-6 py-4">Trưởng ca (Shift Leader)</th>
                                    <th className="px-6 py-4">Trưởng chuyền (Line Leader)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {records.map((r) => (
                                    <tr key={r.id} className="transition-all hover:bg-slate-50/50 group">
                                        {/* Employee Code & Name */}
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold border border-slate-200/50 group-hover:bg-slate-200 transition-colors">
                                                    {r.employeeName ? r.employeeName.charAt(0) : '?'}
                                                </div>
                                                <div>
                                                    <div className="font-extrabold text-slate-900 group-hover:text-red-700 transition-colors text-xs tracking-wide">{r.employeeCode}</div>
                                                    <div className="text-[11px] font-semibold text-slate-400 group-hover:text-slate-500 truncate max-w-[200px] mt-0.5">{r.employeeName || 'Chưa rõ tên'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        
                                        {/* Record Date */}
                                        <td className="px-6 py-4 font-bold text-slate-700 text-xs">
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                                                {format(new Date(r.recordDate), 'dd/MM/yyyy')}
                                            </div>
                                        </td>
                                        
                                        {/* Leave Type Badge */}
                                        <td className="px-6 py-4">
                                            <span className={cn(
                                                "inline-flex items-center px-3 py-1 rounded-xl text-[10px] font-bold border shadow-3xs uppercase tracking-wider transition-colors duration-200",
                                                getLeaveBadgeClass(r.leaveType)
                                            )}>
                                                {getLeaveName(r.leaveType)}
                                            </span>
                                        </td>
                                        
                                        {/* Zone */}
                                        <td className="px-6 py-4">
                                            {r.zone ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-50 border border-slate-200/50 px-2.5 py-1 rounded-lg">
                                                    <MapPin size={11} className="text-slate-400" />
                                                    {r.zone}
                                                </span>
                                            ) : (
                                                <span className="text-slate-300 italic text-xs">N/A</span>
                                            )}
                                        </td>
                                        
                                        {/* Shift Leader */}
                                        <td className="px-6 py-4 text-xs font-bold text-slate-700">
                                            {r.shiftLeader ? (
                                                <span className="text-slate-700 group-hover:text-slate-900 transition-colors">{r.shiftLeader}</span>
                                            ) : (
                                                <span className="text-slate-300 italic font-normal">N/A</span>
                                            )}
                                        </td>
                                        
                                        {/* Line Leader */}
                                        <td className="px-6 py-4 text-xs font-semibold text-slate-600">
                                            {r.lineLeader ? (
                                                <span className="text-slate-600 group-hover:text-slate-800 transition-colors">{r.lineLeader}</span>
                                            ) : (
                                                <span className="text-slate-300 italic font-normal">N/A</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
