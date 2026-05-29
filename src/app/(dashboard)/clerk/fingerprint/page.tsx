'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { FileSpreadsheet, Loader2, Search, Filter, Database, ChevronLeft, ChevronRight } from 'lucide-react'
import * as xlsx from 'xlsx'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { useSessionStorage } from '@/hooks/useSessionStorage'

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

export default function FingerprintPage() {
    const [selectedDate, setSelectedDate] = useState<string>('') // Empty means all
    const [isProcessing, setIsProcessing] = useState(false)
    const [isFetching, setIsFetching] = useState(false)
    const [records, setRecords] = useState<FingerprintRecord[]>([])
    const [search, setSearch] = useState('')
    const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number } | null>(null)
    const [portalNode, setPortalNode] = useState<HTMLElement | null>(null)

    useEffect(() => {
        setPortalNode(document.getElementById('timesheet-header-portal'))
    }, [])

    const fetchFingerprints = async (dateStr: string, searchTerm: string = '') => {
        setIsFetching(true)
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
            alert('Lỗi tải dữ liệu vân tay: ' + error.message)
            setRecords([])
        } finally {
            setIsFetching(false)
        }
    }

    // Auto sync when date or search changes manually
    useEffect(() => {
        if (portalNode === null) return
        const handler = setTimeout(() => {
            fetchFingerprints(selectedDate, search)
        }, 500)
        return () => clearTimeout(handler)
    }, [selectedDate, search, portalNode])

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
                alert('Không tìm thấy dòng tiêu đề (Employee ID hoặc En No.) trong file Excel!')
                setIsProcessing(false)
                return
            }

            const headers = rawData[headerRowIdx] as string[]
            const empCodeIdx = headers.findIndex(h => h && ['Employee ID', 'En No.', 'EMP CODE'].includes(String(h).trim()))
            const recordDateIdx = headers.findIndex(h => h && String(h).trim() === 'Record Date')
            const recordTimeIdx = headers.findIndex(h => h && String(h).trim() === 'Record Time')

            if (empCodeIdx === -1 || recordDateIdx === -1 || recordTimeIdx === -1) {
                alert('Không tìm thấy cột Employee ID, Record Date hoặc Record Time!')
                setIsProcessing(false)
                return
            }

            const fingerPrintRecords: { employeeCode: string; date: string; timeString: string }[] = []

            for (let i = headerRowIdx + 1; i < rawData.length; i++) {
                const row = rawData[i]
                if (!row || !row[empCodeIdx]) continue

                const empCode = String(row[empCodeIdx]).trim()
                let recDateRaw = row[recordDateIdx]
                const cellVal = String(row[recordTimeIdx] || '').trim()

                let recDateStr = ''
                if (typeof recDateRaw === 'number') {
                    // Handle Excel serial date
                    const dateObj = xlsx.SSF.parse_date_code(recDateRaw)
                    const d = String(dateObj.d).padStart(2, '0')
                    const m = String(dateObj.m).padStart(2, '0')
                    const y = dateObj.y
                    recDateStr = `${d}/${m}/${y}`
                } else if (recDateRaw instanceof Date) {
                    const d = String(recDateRaw.getDate()).padStart(2, '0')
                    const m = String(recDateRaw.getMonth() + 1).padStart(2, '0')
                    const y = recDateRaw.getFullYear()
                    recDateStr = `${d}/${m}/${y}`
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
                if (!response.ok) throw new Error(resData.error || 'Server Error')
                totalProcessed += (resData.processed || 0)
                setUploadProgress({ current: Math.min(i + batchSize, fingerPrintRecords.length), total: fingerPrintRecords.length })
            }

            alert(`Import Thành Công! Đã cập nhật tổng cộng ${totalProcessed} dòng vân tay hợp lệ vào Database. ${totalProcessed < fingerPrintRecords.length ? '(Các dòng bị bỏ qua do rỗng hoặc mã nhân sự không tồn tại trong hệ thống)' : ''}`)
            setUploadProgress(null)
            fetchFingerprints(selectedDate, search)

        } catch (error: any) {
            alert('Lỗi khi tải file: ' + error.message)
            console.error(error)
        } finally {
            setIsProcessing(false)
            setUploadProgress(null)
            if (e.target) e.target.value = ''
        }
    }

    const filteredRecords = records

    return (
        <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
            {portalNode && createPortal(
                <div className="flex flex-col">
                    <h1 className="text-lg font-bold text-gray-800 tracking-tight flex items-center gap-2">
                        <Database className="text-orange-500" size={20} /> Dữ liệu vân tay
                    </h1>
                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">Quản lý và nhập dữ liệu vân tay thô từ máy chấm công</p>
                </div>,
                portalNode
            )}

            <div className="px-6 py-2 shrink-0 flex flex-wrap gap-6 items-center bg-white border-b border-gray-100 relative z-10 font-sans">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100 shadow-sm">
                        <button onClick={() => {
                            const d = selectedDate ? new Date(selectedDate) : new Date();
                            d.setDate(d.getDate() - 1);
                            setSelectedDate(format(d, 'yyyy-MM-dd'));
                        }} className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-400">
                            <ChevronLeft size={16} />
                        </button>
                        <div className="relative group">
                            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border-none bg-transparent px-2 py-1 outline-none text-[11px] font-bold text-gray-600 uppercase tracking-wider transition-all w-32 text-center" />
                        </div>
                        <button onClick={() => {
                            const d = selectedDate ? new Date(selectedDate) : new Date();
                            d.setDate(d.getDate() + 1);
                            setSelectedDate(format(d, 'yyyy-MM-dd'));
                        }} className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-400">
                            <ChevronRight size={16} />
                        </button>
                    </div>
                    {selectedDate && (
                        <button onClick={() => setSelectedDate('')} className="text-[10px] font-bold text-red-500 hover:text-red-700 uppercase tracking-widest">Xóa lọc</button>
                    )}
                </div>

                <div className="ml-auto">
                    <input type="file" id="fp-upload" className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />
                    <label htmlFor="fp-upload" className={cn(
                        "flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all font-bold text-[11px] shadow-sm cursor-pointer relative overflow-hidden uppercase tracking-widest active:scale-95",
                        isProcessing && "opacity-50 pointer-events-none"
                    )}>
                        {isProcessing && uploadProgress && (
                            <div className="absolute inset-y-0 left-0 bg-white/20 transition-all duration-300" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} />
                        )}
                        {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin z-10" /> : <Database className="w-3.5 h-3.5 z-10" />}
                        <span className="z-10">{isProcessing && uploadProgress ? `ĐANG LƯU ${uploadProgress.current}/${uploadProgress.total}...` : 'NHẬP FILE VÂN TAY (EXCEL)'}</span>
                    </label>
                </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col p-6">
                <div className="bg-white border border-gray-200 shadow-md rounded-xl flex-1 flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                        <div className="relative">
                            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                                type="text"
                                placeholder="Tìm kiếm theo Mã hoặc Tên nhân viên..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="pl-9 pr-4 py-1.5 border border-gray-200 rounded-lg text-xs w-72 focus:ring-2 ring-orange-100 outline-none transition-all shadow-sm"
                            />
                        </div>
                        <div className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">
                            Hiển thị {filteredRecords.length} dòng {selectedDate ? `cho ngày ${selectedDate}` : '(1000 bản ghi mới nhất)'}
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto xl-scrollbar relative">
                        {isFetching && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-white/50 backdrop-blur-sm z-20">
                                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                                <p>Loading database records...</p>
                            </div>
                        )}
                        {filteredRecords.length === 0 && !isFetching && !isProcessing && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                                <Database className="w-12 h-12 text-gray-300 mb-3" />
                                <p>No fingerprint data found matching the selected criteria.</p>
                            </div>
                        )}
                        <table className="w-full text-left border-collapse whitespace-nowrap text-sm">
                            <thead className="bg-gray-100 text-gray-500 font-bold uppercase text-[10px] tracking-widest sticky top-0 z-10 shadow-sm backdrop-blur-md">
                                <tr>
                                    <th className="px-6 py-3 border-b border-gray-200">Date Recorded</th>
                                    <th className="px-6 py-3 border-b border-gray-200 text-center">Employee Code</th>
                                    <th className="px-6 py-3 border-b border-gray-200">Full Name</th>
                                    <th className="px-6 py-3 border-b border-gray-200 text-orange-600 bg-orange-50/30">Raw Fingerprint Time String</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredRecords.map((r, i) => (
                                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-3 font-medium text-gray-700">
                                            {format(new Date(r.recordDate), 'yyyy-MM-dd')}
                                        </td>
                                        <td className="px-6 py-3 font-mono text-gray-900">
                                            {r.employee.employeeCode}
                                        </td>
                                        <td className="px-6 py-3 font-medium text-gray-700">
                                            {r.employee.fullName}
                                        </td>
                                        <td className="px-6 py-3 font-mono text-xs text-purple-700 bg-purple-50/20 font-medium tracking-wide">
                                            {r.timeString}
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
