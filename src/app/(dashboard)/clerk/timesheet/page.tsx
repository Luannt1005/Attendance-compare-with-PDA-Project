'use client'

import ExcelTimesheet from '@/components/ExcelTimesheet'
import { FileSpreadsheet } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'

export default function ClerkTimesheetPage() {
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    const headerContent = (
        <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 sm:gap-3">
                <div className="p-1.5 sm:p-2 bg-orange-50 rounded-lg shrink-0">
                    <FileSpreadsheet className="w-5 h-5 sm:w-5 sm:h-5 text-orange-500" />
                </div>
                <div>
                    <h1 className="text-lg font-bold text-gray-800 tracking-tight">Bảng công tổng hợp</h1>
                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">Dữ liệu công đã chốt và xác thực</p>
                </div>
            </div>
            <div id="timesheet-header-portal" className="hidden sm:block"></div>
        </div>
    )

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            {mounted && document.getElementById('timesheet-header-portal')
                ? createPortal(headerContent, document.getElementById('timesheet-header-portal')!)
                : null}

            <div className="flex-1 overflow-hidden">
                <ExcelTimesheet mode="clerk" />
            </div>
        </div>
    )
}
