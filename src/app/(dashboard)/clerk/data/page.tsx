'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { 
    FileSpreadsheet, Loader2, Search, Filter, Database, 
    ChevronLeft, ChevronRight, Clock, Plus, Edit2, 
    Trash2, Check, Settings, Fingerprint
} from 'lucide-react'
import * as xlsx from 'xlsx'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'

// Fingerprint Interface
interface FingerprintRecord {
    id: string
    employeeId: string
    recordDate: string
    timeString: string
    employee: {
        employeeCode: string
        fullName: string
        department: string | null
    }
}

// Shift Interface
interface Shift {
    id: number
    code: string
    name: string | null
    startTime: string | null
    endTime: string | null
    otPreStart: string | null
    otPreEnd: string | null
    otPostStart: string | null
    otPostEnd: string | null
    isActive: boolean
    isLeave: boolean
}

export default function DataManagementPage() {
    const [activeTab, setActiveTab] = useState<'fingerprint' | 'shifts' | 'line-data'>('fingerprint')
    const [portalNode, setPortalNode] = useState<HTMLElement | null>(null)

    // --- Fingerprint States ---
    const [selectedDate, setSelectedDate] = useState<string>('') 
    const [isProcessing, setIsProcessing] = useState(false)
    const [isFetchingFingerprints, setIsFetchingFingerprints] = useState(false)
    const [records, setRecords] = useState<FingerprintRecord[]>([])
    const [fpSearch, setFpSearch] = useState('')
    const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number } | null>(null)

    // --- Shift States ---
    const [shifts, setShifts] = useState<Shift[]>([])
    const [isLoadingShifts, setIsLoadingShifts] = useState(true)
    const [editingShift, setEditingShift] = useState<Partial<Shift> | null>(null)
    const [isSavingShift, setIsSavingShift] = useState(false)

    // --- Line Data States ---
    const [lineDataRecords, setLineDataRecords] = useState<any[]>([])
    const [isFetchingLineData, setIsFetchingLineData] = useState(false)

    useEffect(() => {
        setPortalNode(document.getElementById('timesheet-header-portal'))
        fetchShifts()
    }, [])

    useEffect(() => {
        if (activeTab === 'fingerprint') {
            const handler = setTimeout(() => {
                fetchFingerprints(selectedDate, fpSearch)
            }, 500)
            return () => clearTimeout(handler)
        } else if (activeTab === 'line-data') {
            const handler = setTimeout(() => {
                fetchLineData(selectedDate, fpSearch)
            }, 500)
            return () => clearTimeout(handler)
        }
    }, [selectedDate, fpSearch, activeTab])

    // --- Fingerprint Logic ---
    const fetchFingerprints = async (dateStr: string, searchTerm: string = '') => {
        setIsFetchingFingerprints(true)
        try {
            const params = new URLSearchParams()
            if (dateStr) params.append('date', dateStr)
            if (searchTerm) params.append('search', searchTerm)
            const url = `/api/fingerprint?${params.toString()}`
            const response = await fetch(url)
            const resData = await response.json()
            if (!response.ok) throw new Error(resData.error || 'Server Error')
            setRecords(resData.data || [])
        } catch (error: any) {
            console.error(error)
            setRecords([])
        } finally {
            setIsFetchingFingerprints(false)
        }
    }

    const fetchLineData = async (dateStr: string, searchTerm: string = '') => {
        if (!dateStr) {
            setLineDataRecords([]);
            return;
        }
        setIsFetchingLineData(true)
        try {
            const params = new URLSearchParams()
            if (dateStr) params.append('date', dateStr)
            const response = await fetch(`/api/clerk-attendance/compare-line-data?${params.toString()}`)
            const resData = await response.json()
            if (!response.ok) throw new Error(resData.error || 'Server Error')
            
            // Reusing compare API's data structure which already has all we need
            let data = resData.data || [];
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                data = data.filter((r: any) => r.employeeCode.includes(term) || r.fullName.toLowerCase().includes(term));
            }
            setLineDataRecords(data)
        } catch (error: any) {
            console.error(error)
            setLineDataRecords([])
        } finally {
            setIsFetchingLineData(false)
        }
    }

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setIsProcessing(true)

        try {
            const data = await file.arrayBuffer()
            const wb = xlsx.read(data)
            const sheet = wb.Sheets[wb.SheetNames[0]]
            const rawData = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: true })

            let headerRowIdx = -1
            for (let i = 0; i < Math.min(rawData.length, 20); i++) {
                const row = rawData[i]
                if (row && row.some((cell: any) => String(cell).trim() === 'Employee ID' || String(cell).trim() === 'En No.')) {
                    headerRowIdx = i
                    break
                }
            }

            if (headerRowIdx === -1) {
                toast.error('Không tìm thấy dòng tiêu đề (Employee ID hoặc En No.) trong file Excel!')
                return
            }

            const headers = rawData[headerRowIdx] as string[]
            const empCodeIdx = headers.findIndex(h => h && ['Employee ID', 'En No.', 'EMP CODE'].includes(String(h).trim()))
            const recordDateIdx = headers.findIndex(h => h && String(h).trim() === 'Record Date')
            const recordTimeIdx = headers.findIndex(h => h && String(h).trim() === 'Record Time')

            const fingerPrintRecords: { employeeCode: string; date: string; timeString: string }[] = []
            for (let i = headerRowIdx + 1; i < rawData.length; i++) {
                const row = rawData[i]
                if (!row || !row[empCodeIdx]) continue
                const empCode = String(row[empCodeIdx]).trim()
                let recDateRaw = row[recordDateIdx]
                const cellVal = String(row[recordTimeIdx] || '').trim()

                let recDateStr = ''
                if (typeof recDateRaw === 'number') {
                    const dateObj = xlsx.SSF.parse_date_code(recDateRaw)
                    recDateStr = `${String(dateObj.d).padStart(2, '0')}/${String(dateObj.m).padStart(2, '0')}/${dateObj.y}`
                } else if (recDateRaw instanceof Date) {
                    recDateStr = `${String(recDateRaw.getDate()).padStart(2, '0')}/${String(recDateRaw.getMonth() + 1).padStart(2, '0')}/${recDateRaw.getFullYear()}`
                } else {
                    recDateStr = String(recDateRaw || '').trim()
                }

                if (recDateStr && (cellVal.includes('IN:') || cellVal.includes('OUT:'))) {
                    fingerPrintRecords.push({ employeeCode: empCode, date: recDateStr, timeString: cellVal })
                }
            }

            setUploadProgress({ current: 0, total: fingerPrintRecords.length })
            let totalProcessed = 0
            const batchSize = 5000

            for (let i = 0; i < fingerPrintRecords.length; i += batchSize) {
                const chunk = fingerPrintRecords.slice(i, i + batchSize)
                const response = await fetch('/api/fingerprint/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fingerprints: chunk })
                })
                const resData = await response.json()
                totalProcessed += (resData.processed || 0)
                setUploadProgress({ current: Math.min(i + batchSize, fingerPrintRecords.length), total: fingerPrintRecords.length })
            }

            toast.success(`Import thành công! Đã cập nhật ${totalProcessed} dòng vân tay.`)
            fetchFingerprints(selectedDate, fpSearch)
        } catch (error: any) {
            toast.error('Lỗi khi tải file: ' + error.message)
        } finally {
            setIsProcessing(false)
            setUploadProgress(null)
            if (e.target) e.target.value = ''
        }
    }

    const handleLineDataUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        if (!selectedDate) {
            toast.error('Vui lòng chọn ngày trước khi import Line Data!')
            if (e.target) e.target.value = ''
            return
        }

        setIsProcessing(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('filterDate', selectedDate)

            const response = await fetch('/api/data/import/line-data', {
                method: 'POST',
                body: formData
            })

            const resData = await response.json()
            if (!response.ok) throw new Error(resData.error || 'Server Error')

            toast.success(`Import Line Data thành công! Đã cập nhật ${resData.processed} dòng.`)
            fetchLineData(selectedDate, fpSearch)
        } catch (error: any) {
            console.error('Line Data Upload Error:', error)
            toast.error('Lỗi khi tải file: ' + error.message)
        } finally {
            setIsProcessing(false)
            if (e.target) e.target.value = ''
        }
    }

    const handleLineDataExport = () => {
        if (lineDataRecords.length === 0) {
            toast.error('Không có dữ liệu Line để xuất file.')
            return
        }

        try {
            const exportData = lineDataRecords.map(r => ({
                'Ngày': r.date || selectedDate,
                'Mã nhân viên': r.employeeCode,
                'Họ và Tên': r.fullName,
                'Line': r.line,
                'Ca': r.shift,
                'IN Line': r.lineIn,
                'OUT Line': r.lineOut
            }))

            const worksheet = xlsx.utils.json_to_sheet(exportData)
            const workbook = xlsx.utils.book_new()
            xlsx.utils.book_append_sheet(workbook, worksheet, 'Line Data')

            const dateStr = selectedDate ? `_${selectedDate}` : `_All_${new Date().toISOString().slice(0, 10)}`
            xlsx.writeFile(workbook, `Line_Data${dateStr}.xlsx`)
            toast.success('Xuất file Excel thành công!')
        } catch (error: any) {
            console.error('Export Line Data Error:', error)
            toast.error('Lỗi khi xuất file: ' + error.message)
        }
    }

    // --- Shift Logic ---
    const fetchShifts = async () => {
        setIsLoadingShifts(true)
        try {
            const res = await fetch('/api/shifts')
            const { data } = await res.json()
            setShifts(data)
        } catch (e) {
            console.error(e)
        } finally {
            setIsLoadingShifts(false)
        }
    }

    const handleSaveShift = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingShift?.code) return
        if (!editingShift.isLeave && (!editingShift.startTime || !editingShift.endTime)) return
        setIsSavingShift(true)

        try {
            const isEditing = !!editingShift.id
            const url = isEditing ? `/api/shifts/${editingShift.id}` : '/api/shifts'
            const method = isEditing ? 'PUT' : 'POST'

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editingShift)
            })

            if (!res.ok) throw new Error('Action failed')
            toast.success('Lưu ca làm việc thành công')
            setEditingShift(null)
            fetchShifts()
        } catch (err: any) {
            toast.error('Lỗi khi lưu: ' + err.message)
        } finally {
            setIsSavingShift(false)
        }
    }

    const handleDeleteShift = async (id: number) => {
        if (!window.confirm('Bạn có chắc chắn muốn xóa Ca này?')) return
        try {
            await fetch(`/api/shifts/${id}`, { method: 'DELETE' })
            toast.success('Đã xóa ca làm việc')
            fetchShifts()
        } catch (e) {
            toast.error('Lỗi khi xoá ca làm việc')
        }
    }

    return (
        <div className="flex flex-col flex-1 bg-slate-50 overflow-hidden">
            {portalNode && createPortal(
                <div className="flex flex-col">
                    <h1 className="text-lg font-bold text-gray-800 tracking-tight flex items-center gap-2">
                        <Database className="text-orange-500" size={20} /> Quản lý Dữ liệu
                    </h1>
                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">Tập trung quản lý Ca làm việc và Dữ liệu vân tay</p>
                </div>,
                portalNode
            )}

            {/* Sub-header with Tabs */}
            <div className="px-6 bg-white border-b border-gray-100 flex items-center justify-between z-10">
                <div className="flex items-center gap-8">
                    <button
                        onClick={() => setActiveTab('fingerprint')}
                        className={cn(
                            "relative py-4 px-1 text-[13px] font-bold transition-all flex items-center gap-2",
                            activeTab === 'fingerprint' ? "text-orange-600" : "text-gray-400 hover:text-gray-600"
                        )}
                    >
                        <Fingerprint size={16} />
                        Dữ liệu Vân tay
                        {activeTab === 'fingerprint' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-orange-500 rounded-full" />}
                    </button>
                    <button
                        onClick={() => setActiveTab('shifts')}
                        className={cn(
                            "relative py-4 px-1 text-[13px] font-bold transition-all flex items-center gap-2",
                            activeTab === 'shifts' ? "text-orange-600" : "text-gray-400 hover:text-gray-600"
                        )}
                    >
                        <Clock size={16} />
                        Quản lý Ca làm việc
                        {activeTab === 'shifts' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-orange-500 rounded-full" />}
                    </button>
                    <button
                        onClick={() => setActiveTab('line-data')}
                        className={cn(
                            "relative py-4 px-1 text-[13px] font-bold transition-all flex items-center gap-2",
                            activeTab === 'line-data' ? "text-orange-600" : "text-gray-400 hover:text-gray-600"
                        )}
                    >
                        <FileSpreadsheet size={16} />
                        Dữ liệu Line
                        {activeTab === 'line-data' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-orange-500 rounded-full" />}
                    </button>
                </div>

                {/* Context Actions */}
                <div className="flex items-center gap-4 py-2">
                    {activeTab === 'fingerprint' ? (
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100 shadow-sm">
                                <button onClick={() => {
                                    const d = selectedDate ? new Date(selectedDate) : new Date();
                                    d.setDate(d.getDate() - 1);
                                    setSelectedDate(format(d, 'yyyy-MM-dd'));
                                }} className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-400">
                                    <ChevronLeft size={16} />
                                </button>
                                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border-none bg-transparent px-2 py-1 outline-none text-[11px] font-bold text-gray-600 uppercase tracking-wider w-32 text-center" />
                                <button onClick={() => {
                                    const d = selectedDate ? new Date(selectedDate) : new Date();
                                    d.setDate(d.getDate() + 1);
                                    setSelectedDate(format(d, 'yyyy-MM-dd'));
                                }} className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-400">
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                            <input type="file" id="fp-upload" className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />
                            <label htmlFor="fp-upload" className={cn(
                                "flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all font-bold text-[10px] shadow-sm cursor-pointer relative overflow-hidden uppercase tracking-widest active:scale-95 whitespace-nowrap",
                                isProcessing && "opacity-50 pointer-events-none"
                            )}>
                                {isProcessing && uploadProgress && (
                                    <div className="absolute inset-y-0 left-0 bg-white/20 transition-all duration-300" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} />
                                )}
                                {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                                <span>{isProcessing ? 'ĐANG LƯU...' : 'NHẬP VÂN TAY (EXCEL)'}</span>
                            </label>
                        </div>
                    ) : activeTab === 'line-data' ? (
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100 shadow-sm">
                                <button onClick={() => {
                                    const d = selectedDate ? new Date(selectedDate) : new Date();
                                    d.setDate(d.getDate() - 1);
                                    setSelectedDate(format(d, 'yyyy-MM-dd'));
                                }} className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-400">
                                    <ChevronLeft size={16} />
                                </button>
                                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border-none bg-transparent px-2 py-1 outline-none text-[11px] font-bold text-gray-600 uppercase tracking-wider w-32 text-center" />
                                <button onClick={() => {
                                    const d = selectedDate ? new Date(selectedDate) : new Date();
                                    d.setDate(d.getDate() + 1);
                                    setSelectedDate(format(d, 'yyyy-MM-dd'));
                                }} className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-400">
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                            <input type="file" id="linedata-upload" className="hidden" accept=".xlsx,.xls" onChange={handleLineDataUpload} />
                            <label htmlFor="linedata-upload" className={cn(
                                "flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl transition-all font-bold text-[10px] shadow-sm cursor-pointer relative overflow-hidden uppercase tracking-widest active:scale-95 whitespace-nowrap",
                                isProcessing && "opacity-50 pointer-events-none"
                            )}>
                                {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
                                <span>{isProcessing ? 'ĐANG XỬ LÝ...' : 'NHẬP LINE DATA (EXCEL)'}</span>
                            </label>

                            {lineDataRecords.length > 0 && (
                                <button
                                    onClick={handleLineDataExport}
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition-all font-bold text-[10px] shadow-sm cursor-pointer uppercase tracking-widest active:scale-95 whitespace-nowrap"
                                >
                                    <FileSpreadsheet className="w-3.5 h-3.5" />
                                    <span>XUẤT LINE DATA (EXCEL)</span>
                                </button>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={() => setEditingShift({ isActive: true, isLeave: false })}
                            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition-all font-bold text-[10px] shadow-sm uppercase tracking-widest active:scale-95"
                        >
                            <Plus className="w-3.5 h-3.5" /> Thêm ca mới
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col p-6">
                {activeTab === 'fingerprint' ? (
                    <div className="bg-white border border-gray-200 shadow-md rounded-xl flex-1 flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    placeholder="Tìm kiếm theo Mã hoặc Tên nhân viên..."
                                    value={fpSearch}
                                    onChange={e => setFpSearch(e.target.value)}
                                    className="pl-9 pr-4 py-1.5 border border-gray-200 rounded-lg text-xs w-72 focus:ring-2 ring-orange-100 outline-none transition-all shadow-sm"
                                />
                            </div>
                            <div className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">
                                Hiển thị {records.length} dòng {selectedDate ? `cho ngày ${selectedDate}` : '(1000 bản ghi mới nhất)'}
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto xl-scrollbar relative">
                            {isFetchingFingerprints && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-white/50 backdrop-blur-sm z-20">
                                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                                    <p className="font-bold text-sm">Đang tải dữ liệu...</p>
                                </div>
                            )}
                            <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                                <thead className="bg-gray-100 text-gray-500 font-bold uppercase text-[10px] tracking-widest sticky top-0 z-10 shadow-sm backdrop-blur-md">
                                    <tr>
                                        <th className="px-6 py-4">Ngày</th>
                                        <th className="px-6 py-4">Mã NV</th>
                                        <th className="px-6 py-4">Họ và Tên</th>
                                        <th className="px-6 py-4 text-orange-600 bg-orange-50/30">Dữ liệu thô từ máy chấm công</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {records.map((r, i) => (
                                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-3 font-medium text-gray-700">{format(new Date(r.recordDate), 'yyyy-MM-dd')}</td>
                                            <td className="px-6 py-3 font-mono font-bold text-gray-900">{r.employee.employeeCode}</td>
                                            <td className="px-6 py-3 font-medium text-gray-700">{r.employee.fullName}</td>
                                            <td className="px-6 py-3 font-mono text-[11px] text-purple-700 bg-purple-50/20 font-medium tracking-wide">{r.timeString}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : activeTab === 'line-data' ? (
                    <div className="bg-white border border-gray-200 shadow-md rounded-xl flex-1 flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    placeholder="Tìm kiếm theo Mã hoặc Tên nhân viên..."
                                    value={fpSearch}
                                    onChange={e => setFpSearch(e.target.value)}
                                    className="pl-9 pr-4 py-1.5 border border-gray-200 rounded-lg text-xs w-72 focus:ring-2 ring-emerald-100 outline-none transition-all shadow-sm"
                                />
                            </div>
                            <div className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">
                                Hiển thị {lineDataRecords.length} dòng {selectedDate ? `cho ngày ${selectedDate}` : ''}
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto xl-scrollbar relative">
                            {isFetchingLineData && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-white/50 backdrop-blur-sm z-20">
                                    <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-3" />
                                    <p className="font-bold text-sm">Đang tải dữ liệu...</p>
                                </div>
                            )}
                            <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                                <thead className="bg-gray-100 text-gray-500 font-bold uppercase text-[10px] tracking-widest sticky top-0 z-10 shadow-sm backdrop-blur-md">
                                    <tr>
                                        <th className="px-6 py-4">Ngày</th>
                                        <th className="px-6 py-4">Mã NV</th>
                                        <th className="px-6 py-4">Họ và Tên</th>
                                        <th className="px-6 py-4 text-center">Line</th>
                                        <th className="px-6 py-4">Ca</th>
                                        <th className="px-6 py-4 text-emerald-600 bg-emerald-50/30">IN Line</th>
                                        <th className="px-6 py-4 text-emerald-600 bg-emerald-50/30">OUT Line</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {lineDataRecords.map((r, i) => (
                                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-3 font-medium text-gray-700">{r.date}</td>
                                            <td className="px-6 py-3 font-mono font-bold text-gray-900">{r.employeeCode}</td>
                                            <td className="px-6 py-3 font-medium text-gray-700">{r.fullName}</td>
                                            <td className="px-6 py-3 font-bold text-center text-gray-600">{r.line}</td>
                                            <td className="px-6 py-3 font-bold text-gray-700">{r.shift}</td>
                                            <td className="px-6 py-3 font-mono font-medium">{r.lineIn}</td>
                                            <td className="px-6 py-3 font-mono font-medium">{r.lineOut}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col gap-6 overflow-hidden">
                        <div className="bg-white border border-gray-200 shadow-md rounded-xl flex-1 flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                                <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest">Danh sách Ca làm việc</h3>
                                <div className="text-[10px] text-gray-400 font-medium">Hệ thống sử dụng Mã Ca để tự động tính toán Audit</div>
                            </div>
                            <div className="flex-1 overflow-auto xl-scrollbar relative">
                                {isLoadingShifts && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-white/50 backdrop-blur-sm z-20">
                                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                                    </div>
                                )}
                                <table className="w-full text-left text-xs whitespace-nowrap">
                                    <thead className="bg-gray-100 border-b border-gray-200 text-gray-500 font-bold uppercase text-[10px] tracking-widest sticky top-0 z-10">
                                        <tr>
                                            <th className="px-6 py-4">Mã Ca</th>
                                            <th className="px-6 py-4">Giờ làm việc</th>
                                            <th className="px-6 py-4">OT Đầu Ca</th>
                                            <th className="px-6 py-4">OT Cuối Ca</th>
                                            <th className="px-6 py-4">Tên Ca</th>
                                            <th className="px-6 py-4">Trạng thái</th>
                                            <th className="px-6 py-4 text-right pr-10">Thao tác</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {shifts.map(s => (
                                            <tr key={s.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 font-black text-gray-900">{s.code}</td>
                                                <td className="px-6 py-4">
                                                    {s.isLeave ? (
                                                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 uppercase">Ca nghỉ / Phép</span>
                                                    ) : (
                                                        <div className="flex items-center gap-1.5 border border-blue-100 px-2 py-0.5 rounded-md text-blue-700 font-bold bg-blue-50 inline-flex">
                                                            <Clock size={14} /> {s.startTime} - {s.endTime}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 font-mono text-[11px]">
                                                    {s.isLeave ? (
                                                        <span className="text-gray-400 font-medium">-</span>
                                                    ) : (
                                                        <span className="text-purple-600 font-semibold">{s.otPreStart || '--:--'} - {s.otPreEnd || '--:--'}</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 font-mono text-[11px]">
                                                    {s.isLeave ? (
                                                        <span className="text-gray-400 font-medium">-</span>
                                                    ) : (
                                                        <span className="text-orange-600 font-semibold">{s.otPostStart || '--:--'} - {s.otPostEnd || '--:--'}</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-gray-500">{s.name || '-'}</td>
                                                <td className="px-6 py-4">
                                                    {s.isActive ? (
                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 border border-green-200 uppercase">Active</span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200 uppercase">Inactive</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right pr-6">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button onClick={() => setEditingShift(s)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit2 size={14} /></button>
                                                        <button onClick={() => handleDeleteShift(s.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={14} /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Shift Modal */}
            {editingShift && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
                        <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center shrink-0">
                            <h3 className="font-bold text-slate-800 uppercase tracking-widest text-sm flex items-center gap-2">
                                <Settings size={18} className="text-slate-500" />
                                {editingShift.id ? 'Hiệu chỉnh Ca làm việc' : 'Tạo mới Ca làm việc'}
                            </h3>
                            <button onClick={() => setEditingShift(null)} className="text-gray-400 hover:text-gray-600 text-2xl font-light">&times;</button>
                        </div>
                        <form onSubmit={handleSaveShift} className="p-8 flex-1 overflow-y-auto space-y-6 xl-scrollbar">
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Mã Ca *</label>
                                    <input required placeholder="VD: S6" value={editingShift.code || ''} onChange={e => setEditingShift({ ...editingShift, code: e.target.value })} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-4 focus:ring-slate-100 focus:border-slate-800 outline-none transition-all shadow-sm" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Tên Ca</label>
                                    <input placeholder="VD: Ca sáng" value={editingShift.name || ''} onChange={e => setEditingShift({ ...editingShift, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-4 focus:ring-slate-100 focus:border-slate-800 outline-none transition-all shadow-sm" />
                                </div>
                            </div>

                            <div>
                                <label className="flex items-center gap-3 cursor-pointer group mt-2">
                                    <div className="relative">
                                        <input type="checkbox" checked={editingShift.isLeave ?? false} onChange={e => setEditingShift({ ...editingShift, isLeave: e.target.checked })} className="sr-only p-2" />
                                        <div className={cn("w-10 h-6 rounded-full transition-colors", (editingShift.isLeave ?? false) ? "bg-slate-800" : "bg-gray-300")} />
                                        <div className={cn("absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform", (editingShift.isLeave ?? false) && "translate-x-4")} />
                                    </div>
                                    <span className="text-xs font-bold text-gray-700">Là ca nghỉ / phép nghỉ (ML, AL, CO...)</span>
                                </label>
                            </div>

                            {!editingShift.isLeave && (
                                <>
                                    <div className="space-y-4">
                                        <h4 className="text-[11px] font-bold text-slate-850 uppercase tracking-widest flex items-center gap-2">
                                            <Clock size={14} className="text-slate-500" /> Thời gian làm việc chính thức
                                        </h4>
                                        <div className="grid grid-cols-2 gap-6">
                                            <div>
                                                <label className="block text-[10px] font-medium text-gray-500 mb-1">Giờ Bắt đầu</label>
                                                <input required={!editingShift.isLeave} type="time" value={editingShift.startTime || ''} onChange={e => setEditingShift({ ...editingShift, startTime: e.target.value })} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:ring-4 focus:ring-slate-100 focus:border-slate-800 outline-none shadow-sm transition-all" />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-medium text-gray-500 mb-1">Giờ Kết thúc</label>
                                                <input required={!editingShift.isLeave} type="time" value={editingShift.endTime || ''} onChange={e => setEditingShift({ ...editingShift, endTime: e.target.value })} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:ring-4 focus:ring-slate-100 focus:border-slate-800 outline-none shadow-sm transition-all" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-slate-50 rounded-2xl space-y-4 border border-slate-150 shadow-xs">
                                        <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Ràng buộc Tăng ca ĐẦU CA</h4>
                                        <div className="grid grid-cols-2 gap-4">
                                            <input type="time" value={editingShift.otPreStart || ''} onChange={e => setEditingShift({ ...editingShift, otPreStart: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-slate-500/10 focus:border-slate-500 outline-none transition-all" />
                                            <input type="time" value={editingShift.otPreEnd || ''} onChange={e => setEditingShift({ ...editingShift, otPreEnd: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-slate-500/10 focus:border-slate-500 outline-none transition-all" />
                                        </div>
                                    </div>

                                    <div className="p-4 bg-slate-50 rounded-2xl space-y-4 border border-slate-150 shadow-xs">
                                        <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Ràng buộc Tăng ca CUỐI CA</h4>
                                        <div className="grid grid-cols-2 gap-4">
                                            <input type="time" value={editingShift.otPostStart || ''} onChange={e => setEditingShift({ ...editingShift, otPostStart: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-slate-500/10 focus:border-slate-500 outline-none transition-all" />
                                            <input type="time" value={editingShift.otPostEnd || ''} onChange={e => setEditingShift({ ...editingShift, otPostEnd: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-slate-500/10 focus:border-slate-500 outline-none transition-all" />
                                        </div>
                                    </div>
                                </>
                            )}

                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className="relative">
                                    <input type="checkbox" checked={editingShift.isActive ?? true} onChange={e => setEditingShift({ ...editingShift, isActive: e.target.checked })} className="sr-only p-2" />
                                    <div className={cn("w-10 h-6 rounded-full transition-colors", (editingShift.isActive ?? true) ? "bg-[#D10000]" : "bg-gray-300")} />
                                    <div className={cn("absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform", (editingShift.isActive ?? true) && "translate-x-4")} />
                                </div>
                                <span className="text-xs font-bold text-gray-700">Kích hoạt Ca làm việc này</span>
                             </label>

                            <div className="pt-6 flex justify-end gap-3">
                                <button type="button" onClick={() => setEditingShift(null)} className="px-6 py-2.5 text-[11px] font-black text-gray-500 uppercase tracking-widest bg-white border border-gray-200 rounded-xl hover:bg-gray-50 shadow-sm transition-all cursor-pointer">Hủy</button>
                                <button type="submit" disabled={isSavingShift} className="px-6 py-2.5 text-[11px] font-black text-white uppercase tracking-widest bg-[#D10000] hover:bg-[#B00000] rounded-xl shadow-sm flex items-center gap-2 active:scale-95 disabled:opacity-50 transition-all cursor-pointer">
                                    {isSavingShift ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                    Lưu cấu hình
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
