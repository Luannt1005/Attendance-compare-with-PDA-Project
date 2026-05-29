import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startOfMonth, endOfMonth, eachDayOfInterval, format, parse, differenceInMinutes, addDays, isAfter } from 'date-fns'
import { verifyRecord, extractInOut } from '@/lib/auditLogic'

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

        const employees = await prisma.employee.findMany({
            select: { 
                id: true, 
                employeeCode: true, 
                fullName: true, 
                department: { select: { name: true } }, 
                line: { select: { name: true } },
                shiftLeader: true,
                supervisor: true,
                mgt: true,
                pic: true,
                employeeType: true
            }
        })

        const shifts = await prisma.shift.findMany()
        const SHIFT_CONFIG: Record<string, { start: string, end: string, otPre?: [string, string], otPost?: [string, string] }> = {}
        const shiftMap = new Map()
        shifts.forEach(s => {
            const config = {
                start: s.startTime ?? '',
                end: s.endTime ?? '',
                otPre: s.otPreStart && s.otPreEnd ? [s.otPreStart, s.otPreEnd] as [string, string] : undefined,
                otPost: s.otPostStart && s.otPostEnd ? [s.otPostStart, s.otPostEnd] as [string, string] : undefined
            }
            shiftMap.set(s.code, config)
            SHIFT_CONFIG[s.code] = config
        })

        const overtimes = await prisma.clerkOvertime.findMany({
            where: { recordDate: { gte: startDate, lte: endDate } }
        })

        const attendances = await prisma.clerkAttendance.findMany({
            where: { recordDate: { gte: startDate, lte: endDate } }
        })

        const fingerprints = await prisma.fingerprint.findMany({
            where: { 
                recordDate: { 
                    gte: addDays(startDate, -1), 
                    lte: addDays(endDate, 1) 
                } 
            }
        })

        const otMap = new Map() 
        overtimes.forEach(ot => {
            const key = `${ot.employeeId}_${format(ot.recordDate, 'yyyy-MM-dd')}`
            otMap.set(key, (otMap.get(key) || 0) + ot.hours)
        })

        const attMap = new Map()
        attendances.forEach(att => {
            const key = `${att.employeeId}_${format(att.recordDate, 'yyyy-MM-dd')}`
            attMap.set(key, att.status)
        })

        const fpMap = new Map()
        fingerprints.forEach(fp => {
            const normCode = String(fp.employeeId).replace(/^0+/, '') // Handle potential ID string format
            const key = `${normCode}_${format(fp.recordDate, 'yyyy-MM-dd')}`
            fpMap.set(key, fp.timeString)
        })

        const comparisonData: any[] = []
        const dailyAggMap = new Map() 
        const inconsistencyAggMap = new Map()
        
        const daysInCycle = eachDayOfInterval({ start: startDate, end: endDate })
        daysInCycle.forEach(d => {
            const dStr = format(d, 'yyyy-MM-dd')
            dailyAggMap.set(dStr, { date: format(d, 'd-MMM'), dateFull: dStr, submittedOT: 0, calculatedOT: 0 })
            inconsistencyAggMap.set(dStr, 0)
        })

        for (const emp of employees) {
            let empTotalSubmitted = 0
            let empTotalCalculated = 0
            const dailyDetails: any = {}

            // Check if employee is Staff or Clerk (Auto-valid logic from auditLogic.ts)
            const isAutoValid = emp.employeeType?.toLowerCase() === 'staff' || 
                              emp.mgt?.toLowerCase() === 'clerk';

            daysInCycle.forEach(d => {
                const dateStr = format(d, 'yyyy-MM-dd')
                const normEmpId = String(emp.id).replace(/^0+/, '')
                const key = `${emp.id}_${dateStr}`
                const fpKey = `${normEmpId}_${dateStr}`
                const fpNextKey = `${normEmpId}_${format(addDays(d, 1), 'yyyy-MM-dd')}`
                const fpPrevKey = `${normEmpId}_${format(addDays(d, -1), 'yyyy-MM-dd')}`
                
                const submittedOt = otMap.get(key) || 0
                let calculatedOt = 0
                let isInvalidFP = false

                const attStatus = attMap.get(key)
                const fpStr = fpMap.get(fpKey)
                const fpNextStr = fpMap.get(fpNextKey)
                const fpPrevStr = fpMap.get(fpPrevKey)
                
                let actualShiftCode = attStatus
                if (actualShiftCode) {
                    if (actualShiftCode.startsWith('M_') || actualShiftCode.startsWith('A_')) {
                        actualShiftCode = actualShiftCode.split('_')[1]
                    }
                    if (actualShiftCode === 'P') actualShiftCode = 'S1'
                }

                const conf = shiftMap.get(actualShiftCode)
                
                // Advanced Selection Logic from audit/route.ts
                const todayInOut = fpStr ? extractInOut(fpStr) : { inTime: null, outTime: null }
                const tomorrowInOut = fpNextStr ? extractInOut(fpNextStr) : { inTime: null, outTime: null }
                
                let inTime = todayInOut.inTime
                let outTime = null

                let isNightShift = false
                if (conf && conf.start && conf.end) {
                    if (conf.end < conf.start) isNightShift = true
                }

                if (isNightShift) {
                    // Resolve outTime: normally happens next morning (tomorrow < 15:00)
                    if (tomorrowInOut.outTime && tomorrowInOut.outTime < '15:00') {
                        outTime = tomorrowInOut.outTime
                    } else if (tomorrowInOut.inTime && tomorrowInOut.inTime < '15:00') {
                        outTime = tomorrowInOut.inTime
                    } else if (todayInOut.outTime && todayInOut.outTime >= '14:00' && todayInOut.outTime !== inTime) {
                        outTime = todayInOut.outTime
                    } else {
                        outTime = null
                    }
                } else {
                    outTime = todayInOut.outTime
                    if (conf) {
                        // Day Shift: Ignore trailing or early night shift punches
                        if (!inTime && outTime && outTime < '09:00') outTime = null
                        if (inTime && !outTime && inTime > '15:00') inTime = null
                    }
                }

                // GHOST PUNCH DETECTION
                const isLeaveOrEmpty = !actualShiftCode || !SHIFT_CONFIG[actualShiftCode]
                if (isLeaveOrEmpty && (inTime || outTime) && !(inTime && outTime)) {
                    if (fpPrevStr) {
                        const solitaryPunch = (inTime || outTime) as string
                        if (fpPrevStr.includes(solitaryPunch)) {
                            // It's a duplicate of yesterday's punch. Clean it up.
                            inTime = null
                            outTime = null
                        }
                    }
                }

                const result = verifyRecord(
                    emp.employeeCode,
                    emp.fullName,
                    emp.shiftLeader ? String(emp.shiftLeader) : 'N/A', // fallback
                    actualShiftCode || '',
                    submittedOt,
                    inTime,
                    outTime,
                    d,
                    SHIFT_CONFIG,
                    { pic: emp.pic, mgt: emp.mgt, employeeType: emp.employeeType }
                )

                calculatedOt = typeof result.expectedOt === 'number' ? result.expectedOt : (parseFloat(String(result.expectedOt)) || 0)
                isInvalidFP = result.status === 'ERROR' && result.reason.includes('vân tay')

                if (result.status === 'ERROR' || result.status === 'WARNING') {
                    inconsistencyAggMap.set(dateStr, (inconsistencyAggMap.get(dateStr) || 0) + 1)
                }

                dailyDetails[dateStr] = {
                    submittedOT: submittedOt,
                    calculatedOT: calculatedOt,
                    isInvalidFP: isInvalidFP,
                    log: result.realIn && result.realOut ? `IN: ${result.realIn} OUT: ${result.realOut}` : (fpStr || ''),
                    isAutoValid: isAutoValid,
                    shiftCode: actualShiftCode || '-',
                    status: result.status,
                    reason: result.reason
                }

                // Always add to totals to ensure consistency with Audit logic
                // Even if invalid (Missing Log), calculatedOt is 0, which creates a variance.
                empTotalSubmitted += submittedOt
                empTotalCalculated += calculatedOt
                const agg = dailyAggMap.get(dateStr)
                if (agg) {
                    agg.submittedOT += submittedOt
                    agg.calculatedOT += calculatedOt
                }
            })

            if (empTotalSubmitted > 0 || empTotalCalculated > 0 || Object.values(dailyDetails).some((d: any) => d.isInvalidFP)) {
                comparisonData.push({
                    id: emp.id,
                    employeeCode: emp.employeeCode,
                    fullName: emp.fullName,
                    department: (emp as any).department?.name || '',
                    line: (emp as any).line?.name || '',
                    shiftLeader: (emp as any).shiftLeader || '',
                    supervisor: (emp as any).supervisor || '',
                    mgt: emp.mgt || '',
                    employeeType: emp.employeeType || '',
                    submittedOT: empTotalSubmitted,
                    calculatedOT: empTotalCalculated,
                    diff: empTotalSubmitted - empTotalCalculated,
                    dailyDetails: dailyDetails,
                    isAutoValid: isAutoValid
                })
            }
        }

        const dailyAgg = Array.from(dailyAggMap.values())
        const inconsistencyTrend = Array.from(inconsistencyAggMap.entries()).map(([date, count]) => ({
            date: format(parse(date, 'yyyy-MM-dd', new Date()), 'd-MMM'),
            fullDate: date,
            count
        }))

        return NextResponse.json({
            comparisonData,
            dailyAgg,
            inconsistencyTrend
        })

    } catch (error: any) {
        console.error('OT Comparison API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
