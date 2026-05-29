'use client'

import ExcelTimesheet from '@/components/ExcelTimesheet'
import { FileSpreadsheet } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'

export default function LeaderTimesheetPage() {
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    return (
        <div className="flex flex-col h-full p-6">
             <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <ExcelTimesheet mode="leader" />
            </div>
        </div>
    )
}
