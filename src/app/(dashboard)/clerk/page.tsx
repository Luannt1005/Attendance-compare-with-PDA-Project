'use client'

import SimpleAttendanceOverview from '@/components/SimpleAttendanceOverview'

export default function ClerkDashboard() {
    return (
        <div className="flex-1 flex flex-col overflow-hidden p-6 bg-slate-50">
            <SimpleAttendanceOverview mode="clerk" />
        </div>
    )
}
