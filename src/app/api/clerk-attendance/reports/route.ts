import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startOfMonth, endOfMonth, eachDayOfInterval, format } from 'date-fns'

const STATIC_LEAVES = ['AL', 'UP', 'UPP', 'SL', 'AL/2', 'UP/2', 'Preg']

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const monthParam = searchParams.get('month') // Format: YYYY-MM

        if (!monthParam) {
            return NextResponse.json({ error: 'Month parameter (YYYY-MM) is required' }, { status: 400 })
        }

        const [year, month] = monthParam.split('-').map(Number)
        // Adjust for attendance cycle (21st prev month to 20th current month)
        const startDate = new Date(Date.UTC(year, month - 2, 21))
        const endDate = new Date(Date.UTC(year, month - 1, 20))
        const daysInCycle = eachDayOfInterval({ start: startDate, end: endDate })

        // Fetch Clerk data
        const attendances = await prisma.clerkAttendance.findMany({
            where: {
                recordDate: {
                    gte: startDate,
                    lte: endDate
                }
            }
        })

        const overtimes = await prisma.clerkOvertime.findMany({
            where: {
                recordDate: {
                    gte: startDate,
                    lte: endDate
                }
            }
        })

        // 1. Daily Attendance Trend
        const dailyTrendMap = new Map()
        daysInCycle.forEach(d => {
            const dateStr = format(d, 'yyyy-MM-dd')
            dailyTrendMap.set(dateStr, { fullDate: dateStr, date: format(d, 'd-MMM'), Present: 0, Absent: 0, Leave: 0 })
        })

        const leaveDistributionMap = new Map()
        STATIC_LEAVES.forEach(l => leaveDistributionMap.set(l, 0))

        attendances.forEach(att => {
            const dateStr = format(att.recordDate, 'yyyy-MM-dd')
            const dayData = dailyTrendMap.get(dateStr)
            if (dayData) {
                const status = actualStatus(att.status)
                if (status === 'S1' || status === 'S3' || status === 'S5' || status === 'OS' || status === 'P') {
                    dayData.Present += 1
                } else if (STATIC_LEAVES.includes(status)) {
                    dayData.Absent += 1
                    leaveDistributionMap.set(status, (leaveDistributionMap.get(status) || 0) + 1)
                } else if (status) {
                    dayData.Absent += 1
                }
            }
        })

        // 2. Daily Overtime Trend
        const dailyOtMap = new Map()
        daysInCycle.forEach(d => {
            const dateStr = format(d, 'yyyy-MM-dd')
            dailyOtMap.set(dateStr, { fullDate: dateStr, date: format(d, 'd-MMM'), 'OT 1.5': 0, 'OT 2.0': 0, 'OT 2.5': 0, 'OT 3.0': 0 })
        })

        let totalOTHours = 0
        overtimes.forEach(ot => {
            const dateStr = format(ot.recordDate, 'yyyy-MM-dd')
            const dayData = dailyOtMap.get(dateStr)
            if (dayData && ot.hours) {
                totalOTHours += ot.hours
                const numHours = parseFloat(ot.hours.toString())
                if (!isNaN(numHours)) {
                    // Simple bucketing based on timeType if it exists, otherwise just aggregate total
                    let category = 'OT 1.5' // Default bucket
                    if (ot.timeType === '2.0') category = 'OT 2.0'
                    else if (ot.timeType === '2.5') category = 'OT 2.5'
                    else if (ot.timeType === '3.0') category = 'OT 3.0'

                    dayData[category] += numHours
                }
            }
        })

        const dailyTrend = Array.from(dailyTrendMap.values())
        const otTrend = Array.from(dailyOtMap.values())
        const leaveDistribution = Array.from(leaveDistributionMap.entries()).map(([name, value]) => ({ name, value })).filter(item => item.value > 0)

        // Ensure some colors exist for the pie chart
        const totalEmployees = await prisma.employee.count({ where: { status: 'Active' } })

        // Calculate average attendance roughly
        let totalPresent = 0
        let totalRecords = 0
        dailyTrend.forEach(d => {
            totalPresent += d.Present
            totalRecords += (d.Present + d.Leave)
        })
        const avgAttendance = totalRecords > 0 ? ((totalPresent / totalRecords) * 100).toFixed(1) : "0.0"

        return NextResponse.json({
            summary: {
                totalEmployees,
                avgAttendance,
                totalOTHours
            },
            dailyTrend,
            otTrend,
            leaveDistribution
        })

    } catch (error: any) {
        console.error('Reports API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}

function actualStatus(val: string) {
    if (!val) return ''
    let actual = (val.startsWith('M_') || val.startsWith('A_')) ? val.split('_')[1] : val
    if (actual === 'P') actual = 'S1'
    return actual
}
