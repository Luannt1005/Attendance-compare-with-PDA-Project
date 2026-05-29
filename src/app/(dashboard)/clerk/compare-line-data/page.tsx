'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { FileSpreadsheet, AlertTriangle, CheckCircle, Search, Clock, Activity, UploadCloud, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import * as XLSX from 'xlsx'

interface CompareResult {
    employeeCode: string;
    fullName: string;
    leader: string;
    date: string;
    shift: string;
    fpIn: string;
    fpOut: string;
    lineIn: string;
    lineOut: string;
    otFp: number;
    otLine: number;
    diff: number;
    varCheckIn: string;
    varCheckOut: string;
    reason: string;
    status: 'VALID' | 'VERIFY NEEDED' | 'REMINDER';
}

export default function CompareLineDataPage() {
    const [portalNode, setPortalNode] = useState<HTMLElement | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const [results, setResults] = useState<CompareResult[]>([])
    const [searchTerm, setSearchTerm] = useState('')
    const [filterStatus, setFilterStatus] = useState<'' | 'VALID' | 'VERIFY NEEDED' | 'REMINDER'>('')
    const [filterDate, setFilterDate] = useState<string>('')
    const [filterShift, setFilterShift] = useState<string>('')
    const [filterReason, setFilterReason] = useState<string>('')
    const [filterLeader, setFilterLeader] = useState<string>('')
    const [filterDiff, setFilterDiff] = useState<string>('')
    const [fileName, setFileName] = useState('')
    const [currentPage, setCurrentPage] = useState(1)
    const [rowsPerPage, setRowsPerPage] = useState(100)

    useEffect(() => {
        setCurrentPage(1)
    }, [searchTerm, filterStatus, filterDate, filterShift, filterReason, filterLeader, filterDiff])
    
    useEffect(() => {
        setPortalNode(document.getElementById('timesheet-header-portal'))
    }, [])

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setFileName(file.name)
        setIsUploading(true)
        setResults([])

        try {
            const formData = new FormData()
            formData.append('file', file)

            const response = await fetch('/api/clerk-attendance/compare-line-data', {
                method: 'POST',
                body: formData
            })

            const resData = await response.json()
            if (!response.ok) throw new Error(resData.error || 'Server Error')

            setResults(resData.data || [])
            if (!resData.data || resData.data.length === 0) {
                toast.error('Không có dữ liệu ca làm việc hoặc không khớp.')
            } else {
                toast.success(`Đã xử lý xong ${resData.totalRecords} dòng! Phát hiện ${resData.totalDiscrepancies} cần xác minh và ${resData.totalReminders || 0} nhắc nhở.`)
            }
        } catch (error: any) {
            console.error('Upload Error:', error)
            toast.error('Lỗi khi tính toán: ' + error.message)
        } finally {
            setIsUploading(false)
            if (e.target) e.target.value = ''
        }
    }

    const handleExport = () => {
        if (filteredResults.length === 0) {
            toast.error('Không có dữ liệu để xuất file.')
            return
        }

        try {
            const exportData = filteredResults.map(r => ({
                'Mã nhân viên': r.employeeCode,
                'Họ và tên': r.fullName,
                'Ca làm việc': r.shift,
                'Ngày': r.date,
                'Giờ vân tay IN': r.fpIn,
                'Giờ vân tay OUT': r.fpOut,
                'Giờ Line IN': r.lineIn,
                'Giờ Line OUT': r.lineOut,
                'Lệch Check-in': r.varCheckIn,
                'Lệch Checkout': r.varCheckOut,
                'OT Vân tay (h)': r.otFp,
                'OT Line (h)': r.otLine,
                'Chênh lệch OT (h)': r.diff,
                'Lý do': r.reason,
                'Trạng thái': r.status === 'VALID' ? 'Hợp lệ' : r.status === 'VERIFY NEEDED' ? 'Cần xác minh' : 'Nhắc nhở'
            }))

            const worksheet = XLSX.utils.json_to_sheet(exportData)
            const workbook = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Doi Chieu Attendance')

            const dateStr = filterDate ? `_${filterDate}` : `_All_${new Date().toISOString().slice(0, 10)}`
            XLSX.writeFile(workbook, `Doi_chieu_OT${dateStr}.xlsx`)
            toast.success('Xuất file Excel thành công!')
        } catch (error: any) {
            console.error('Export Error:', error)
            toast.error('Lỗi khi xuất file: ' + error.message)
        }
    }

    const uniqueDates = Array.from(new Set(results.map(r => r.date))).sort();
    const uniqueShifts = Array.from(new Set(results.map(r => r.shift))).sort();
    const uniqueReasons = Array.from(new Set(results.map(r => r.reason))).sort();
    const uniqueLeaders = Array.from(new Set(results.map(r => r.leader))).sort();
    const uniqueDiffs = Array.from(new Set(results.map(r => r.diff)))
        .filter(d => d !== 0)
        .sort((a, b) => a - b);

    const filteredResults = results.filter(r => {
        if (filterStatus && r.status !== filterStatus) return false;
        if (filterDate && r.date !== filterDate) return false;
        if (filterShift) {
            if (filterShift === 'EMPTY') {
                if (r.shift !== '') return false;
            } else {
                if (r.shift !== filterShift) return false;
            }
        }
        if (filterReason && r.reason !== filterReason) return false;
        if (filterLeader && r.leader !== filterLeader) return false;
        if (filterDiff && r.diff.toString() !== filterDiff) return false;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            return r.employeeCode.includes(term) || r.fullName.toLowerCase().includes(term) || r.shift.toLowerCase().includes(term) || r.leader.toLowerCase().includes(term);
        }
        return true;
    })

    const totalRows = filteredResults.length;
    const totalPages = Math.ceil(totalRows / rowsPerPage) || 1;
    
    const paginatedResults = filteredResults.slice(
        (currentPage - 1) * rowsPerPage,
        currentPage * rowsPerPage
    );

    return (
        <div className="flex flex-col h-full bg-slate-50/50 p-6 font-sans gap-4">
            {portalNode && createPortal(
                <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex flex-col">
                        <h1 className="text-lg font-bold text-gray-800 tracking-tight flex items-center gap-2">
                            <FileSpreadsheet className="text-emerald-500" size={20} /> So Sánh & Tính OT Theo Shift Template
                        </h1>
                    </div>
                    
                    {/* Header Action Controls */}
                    <div className="flex items-center gap-2">
                        <input 
                            type="file" 
                            id="shift-upload"
                            className="hidden"
                            accept=".xlsx,.xls"
                            onChange={handleFileUpload}
                        />
                        <label htmlFor="shift-upload" className="cursor-pointer flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[10px] font-bold shadow-sm active:scale-95 transition-all uppercase tracking-wider h-[28px] whitespace-nowrap">
                            {isUploading ? <Activity className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3" />}
                            {isUploading ? 'ĐANG TÍNH...' : 'CHỌN FILE'}
                        </label>
                        {fileName && !isUploading && (
                             <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-lg truncate max-w-[100px]" title={fileName}>{fileName}</span>
                        )}

                        {results.length > 0 && (
                            <button
                                onClick={handleExport}
                                className="cursor-pointer flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold shadow-sm active:scale-95 transition-all uppercase tracking-wider h-[28px] whitespace-nowrap"
                            >
                                <FileSpreadsheet className="w-3 h-3" />
                                XUẤT EXCEL
                            </button>
                        )}
                    </div>
                </div>,
                portalNode
            )}

            {/* Filter Pills Card (Matches style of user screenshot) */}
            <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Search Pill */}
                    <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-slate-500/10 focus-within:border-slate-400 transition-all shadow-sm h-8">
                        <div className="px-3 h-full bg-gray-50/50 border-r border-gray-150 flex items-center gap-1.5 text-xs font-bold text-gray-500 select-none">
                            <Search size={14} className="text-gray-400" />
                            <span>Search</span>
                        </div>
                        <input
                            type="text"
                            placeholder="Mã NV, Tên, Ca..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="px-4 py-1 text-xs bg-transparent outline-none w-48 text-gray-700 placeholder-gray-400"
                        />
                    </div>

                    {/* Shift Pill */}
                    {uniqueShifts.length > 0 && (
                        <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden transition-all shadow-sm h-8">
                            <div className="px-3 h-full bg-gray-50/50 border-r border-gray-150 flex items-center text-xs font-bold text-gray-500 select-none">
                                Ca
                            </div>
                            <select
                                value={filterShift}
                                onChange={e => setFilterShift(e.target.value)}
                                className="pl-3 pr-8 py-1 text-xs bg-transparent outline-none cursor-pointer text-gray-700 font-semibold appearance-none bg-no-repeat bg-[right_8px_center] bg-[length:12px]"
                                style={{ backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>")` }}
                            >
                                <option value="">Tất cả ca</option>
                                {uniqueShifts.map(s => (
                                    s === '' ? (
                                        <option key="EMPTY" value="EMPTY">Không có ca (Trống ca)</option>
                                    ) : (
                                        <option key={s} value={s}>{s}</option>
                                    )
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Status Pill */}
                    <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden transition-all shadow-sm h-8">
                        <div className="px-3 h-full bg-gray-50/50 border-r border-gray-150 flex items-center text-xs font-bold text-gray-500 select-none">
                            Trạng thái
                        </div>
                        <select
                            value={filterStatus}
                            onChange={e => setFilterStatus(e.target.value as any)}
                            className="pl-3 pr-8 py-1 text-xs bg-transparent outline-none cursor-pointer text-gray-700 font-semibold appearance-none bg-no-repeat bg-[right_8px_center] bg-[length:12px]"
                            style={{ backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>")` }}
                        >
                            <option value="">Tất cả</option>
                            <option value="VALID">Hợp Lệ</option>
                            <option value="VERIFY NEEDED">Cần Xác Minh</option>
                            <option value="REMINDER">Nhắc Nhở</option>
                        </select>
                    </div>

                    {/* Discrepancy (Chênh lệch) Pill */}
                    <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden transition-all shadow-sm h-8">
                        <div className="px-3 h-full bg-gray-50/50 border-r border-gray-150 flex items-center text-xs font-bold text-gray-500 select-none">
                            Chênh lệch
                        </div>
                        <select
                            value={filterDiff}
                            onChange={e => setFilterDiff(e.target.value)}
                            className="pl-3 pr-8 py-1 text-xs bg-transparent outline-none cursor-pointer text-gray-700 font-semibold appearance-none bg-no-repeat bg-[right_8px_center] bg-[length:12px]"
                            style={{ backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>")` }}
                        >
                            <option value="">Tất cả</option>
                            {uniqueDiffs.map(d => (
                                <option key={d} value={d.toString()}>
                                    {d > 0 ? `+${d}h` : `${d}h`}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Date Pill */}
                    {uniqueDates.length > 0 && (
                        <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden transition-all shadow-sm h-8">
                            <div className="px-3 h-full bg-gray-50/50 border-r border-gray-150 flex items-center text-xs font-bold text-gray-500 select-none">
                                Ngày
                            </div>
                            <select
                                value={filterDate}
                                onChange={e => setFilterDate(e.target.value)}
                                className="pl-3 pr-8 py-1 text-xs bg-transparent outline-none cursor-pointer text-gray-700 font-semibold appearance-none bg-no-repeat bg-[right_8px_center] bg-[length:12px]"
                                style={{ backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>")` }}
                            >
                                <option value="">Tất cả ngày</option>
                                {uniqueDates.map(d => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Reason Pill */}
                    {uniqueReasons.length > 0 && (
                        <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden transition-all shadow-sm h-8 max-w-xs">
                            <div className="px-3 h-full bg-gray-50/50 border-r border-gray-150 flex items-center text-xs font-bold text-gray-500 select-none whitespace-nowrap">
                                Lý do
                            </div>
                            <select
                                value={filterReason}
                                onChange={e => setFilterReason(e.target.value)}
                                className="pl-3 pr-8 py-1 text-xs bg-transparent outline-none cursor-pointer text-gray-700 font-semibold appearance-none bg-no-repeat bg-[right_8px_center] bg-[length:12px] truncate max-w-[140px]"
                                style={{ backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>")` }}
                            >
                                <option value="">Tất cả lý do</option>
                                {uniqueReasons.map(r => (
                                    <option key={r} value={r} title={r}>{r}</option>
                                ))}
                            </select>
                        </div>
                    )}


                </div>

                {/* Counter Summary (Matches "0 on this page • 0 total" style) */}
                <div className="text-xs text-gray-500 font-medium select-none flex items-center gap-1">
                    {results.length > 0 ? (
                        <>
                            <span>Hiển thị <strong>{filteredResults.length}</strong> / <strong>{results.length}</strong> dòng</span>
                            <span className="text-gray-300 mx-1.5">•</span>
                            <span className="text-rose-600 font-semibold">Cần xác minh: {results.filter(r => r.status === 'VERIFY NEEDED').length}</span>
                            <span className="text-gray-300 mx-1.5">•</span>
                            <span className="text-amber-600 font-semibold">Nhắc nhở: {results.filter(r => r.status === 'REMINDER').length}</span>
                        </>
                    ) : (
                        <span className="text-gray-400">0 dòng hiển thị • 0 tổng số</span>
                    )}
                </div>
            </div>

            {/* Table Container Card (Matches Table Card layout of user screenshot) */}
            <div className="bg-white border border-gray-200 shadow-sm rounded-2xl flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-auto">
                    {results.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4">
                            <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center border border-dashed border-gray-200">
                                <FileSpreadsheet className="w-8 h-8 text-gray-300" />
                            </div>
                            <p className="font-medium">Chưa có dữ liệu. Vui lòng tải lên file Shift Template.</p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                            <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-200 text-gray-600 text-xs font-semibold">
                                <tr>
                                    <th className="px-6 py-3.5">Trạng thái</th>
                                    <th className="px-6 py-3.5">Nhân viên</th>
                                    <th className="px-6 py-3.5 text-center">Ca</th>
                                    <th className="px-6 py-3.5">Ngày</th>
                                    <th className="px-6 py-3.5">Giờ Vân tay</th>
                                    <th className="px-6 py-3.5">Giờ Line</th>
                                    <th className="px-6 py-3.5 text-center">Lệch Check-in</th>
                                    <th className="px-6 py-3.5 text-center">Lệch Checkout</th>
                                    <th className="px-6 py-3.5 text-center">OT Vân tay</th>
                                    <th className="px-6 py-3.5 text-center">OT Line</th>
                                    <th className="px-6 py-3.5 text-center">Chênh lệch</th>
                                    <th className="px-6 py-3.5">Lý do</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {paginatedResults.map((r, i) => (
                                    <tr key={i} className={cn(
                                        "transition-colors hover:bg-gray-50/80",
                                        r.status === 'VERIFY NEEDED' ? "bg-red-50/20" : 
                                        r.status === 'REMINDER' ? "bg-amber-50/20" : ""
                                    )}>
                                        <td className="px-6 py-4">
                                            {r.status === 'VALID' && (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 font-bold text-[11px] border border-emerald-100">
                                                    <CheckCircle size={14} className="text-emerald-500" /> Hợp lệ
                                                </span>
                                            )}
                                            {r.status === 'VERIFY NEEDED' && (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 font-bold text-[11px] border border-rose-200 shadow-sm">
                                                    <AlertTriangle size={14} className="text-rose-500" /> Cần xác minh
                                                </span>
                                            )}
                                            {r.status === 'REMINDER' && (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 font-bold text-[11px] border border-amber-200 shadow-sm">
                                                    <AlertTriangle size={14} className="text-amber-500" /> Nhắc nhở
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-gray-900">{r.employeeCode}</div>
                                            <div className="text-xs text-gray-500 truncate max-w-[150px]">{r.fullName}</div>
                                        </td>

                                        <td className="px-6 py-4 text-center">
                                            {r.shift ? (
                                                <span className="px-2 py-1 rounded-lg text-[10px] font-black border bg-gray-100 text-gray-700 border-gray-200">
                                                    {r.shift}
                                                </span>
                                            ) : (
                                                <span className="inline-block px-2 py-0.5 rounded bg-amber-50 text-amber-800 text-[9px] font-bold border border-amber-200 uppercase tracking-wider">
                                                    Không có ca
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 font-semibold text-gray-600">{r.date}</td>
                                        
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 font-mono font-medium text-gray-700">
                                                <span className={cn(r.fpIn === 'N/A' && "text-gray-400 italic")}>{r.fpIn}</span>
                                                <span className="text-gray-300">→</span>
                                                <span className={cn(r.fpOut === 'N/A' && "text-gray-400 italic")}>{r.fpOut}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 font-mono font-medium text-gray-700">
                                                <span className={cn(r.lineIn === 'N/A' && "text-gray-400 italic")}>{r.lineIn}</span>
                                                <span className="text-gray-300">→</span>
                                                <span className={cn(r.lineOut === 'N/A' && "text-gray-400 italic")}>{r.lineOut}</span>
                                            </div>
                                        </td>
                                        
                                        <td className="px-6 py-4 text-center">
                                            <span className={cn(
                                                "font-semibold text-xs font-mono",
                                                r.varCheckIn.startsWith('+') && parseInt(r.varCheckIn.replace(/[+m]/g, ''), 10) > 15 
                                                    ? "text-red-600 font-bold" 
                                                    : "text-gray-500"
                                            )}>
                                                {r.varCheckIn}
                                            </span>
                                        </td>

                                        <td className="px-6 py-4 text-center">
                                            <span className="font-semibold text-xs font-mono text-gray-500">
                                                {r.varCheckOut}
                                            </span>
                                        </td>
 
                                        <td className="px-6 py-4 text-center">
                                            <span className="font-semibold text-sm text-gray-700">{r.otFp}h</span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="font-semibold text-sm text-gray-700">{r.otLine}h</span>
                                        </td>
                                        
                                        <td className="px-6 py-4 text-center">
                                            {r.diff === 0 ? (
                                                <span className="text-gray-400 font-mono">-</span>
                                            ) : (
                                                <span className={cn(
                                                    "font-black text-base font-mono",
                                                    r.diff > 0 ? "text-amber-600" : "text-red-500"
                                                )}>
                                                    {r.diff > 0 ? `+${r.diff}` : r.diff}
                                                </span>
                                            )}
                                        </td>

                                        <td className="px-6 py-4">
                                            <span className="text-xs font-medium text-gray-600">
                                                {r.reason}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Pagination Footer */}
                {results.length > 0 && (
                    <div className="px-6 py-3 border-t border-gray-150 flex items-center justify-between bg-white text-xs text-gray-500 font-medium select-none">
                        <div>
                            Hiển thị từ <strong>{Math.min(totalRows, (currentPage - 1) * rowsPerPage + 1)}</strong> đến <strong>{Math.min(totalRows, currentPage * rowsPerPage)}</strong> trong tổng số <strong>{totalRows}</strong> dòng kết quả
                        </div>
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-2">
                                <span>Số dòng mỗi trang:</span>
                                <select
                                    value={rowsPerPage}
                                    onChange={e => {
                                        setRowsPerPage(Number(e.target.value))
                                        setCurrentPage(1)
                                    }}
                                    className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold outline-none cursor-pointer text-gray-700"
                                >
                                    <option value={25}>25</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                    <option value={200}>200</option>
                                </select>
                            </div>
                            <div>
                                Trang <strong>{currentPage}</strong> / <strong>{totalPages}</strong>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={currentPage === 1}
                                    className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer"
                                >
                                    <ChevronLeft size={14} className="text-gray-600" />
                                </button>
                                <button
                                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={currentPage === totalPages}
                                    className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer"
                                >
                                    <ChevronRight size={14} className="text-gray-600" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
