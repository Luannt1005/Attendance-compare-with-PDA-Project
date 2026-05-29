import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyRecord, extractInOut } from '@/lib/auditLogic'
import { getAprilExcelData } from '@/lib/excel-timesheet-helper'

const dayResults_impl = (targetDate: Date, SHIFT_CONFIG: any, employees: any, fingerprintMaps: { prev: Map<string, string>, current: Map<string, string>, next: Map<string, string> }) => {
    const reports = []
    const leaderShiftCounts: Record<string, { day: number, night: number }> = {}
    
    for (const emp of employees) {
        const att = emp.clerkAttendances.find((a: any) => a.recordDate.getTime() === targetDate.getTime()) || (employees.length === 1 ? emp.clerkAttendances[0] : null)
        if (!att || !att.status) continue
        const conf = SHIFT_CONFIG[att.status]
        if (conf?.start && conf?.end) {
            const activeHistory = emp.leaderHistories.find((h: any) => h.startDate <= targetDate && (!h.endDate || h.endDate >= targetDate))
            const leaderName = activeHistory?.leader?.fullName || 'N/A'
            if (!leaderShiftCounts[leaderName]) leaderShiftCounts[leaderName] = { day: 0, night: 0 }
            if (conf.end < conf.start || ['S3', 'S5A'].includes(att.status)) leaderShiftCounts[leaderName].night++
            else leaderShiftCounts[leaderName].day++
        }
    }

    for (const emp of employees) {
        const att = emp.clerkAttendances.find((a: any) => a.recordDate.getTime() === targetDate.getTime()) || (employees.length === 1 ? emp.clerkAttendances[0] : null)
        const ot = emp.clerkOvertimes.find((o: any) => o.recordDate.getTime() === targetDate.getTime()) || (employees.length === 1 ? emp.clerkOvertimes[0] : null)
        if (!att && !ot) continue
        const normEmpCode = String(emp.employeeCode).replace(/^0+/, '')
        const fpToday = fingerprintMaps.current.get(normEmpCode)
        const fpNext = fingerprintMaps.next.get(normEmpCode)
        const fpPrev = fingerprintMaps.prev.get(normEmpCode)

        const todayInOut = fpToday ? extractInOut(fpToday) : { inTime: null, outTime: null }
        const tomorrowInOut = fpNext ? extractInOut(fpNext) : { inTime: null, outTime: null }
        let inTime = todayInOut.inTime, outTime = todayInOut.outTime

        const activeHistory = emp.leaderHistories.find((h: any) => h.startDate <= targetDate && (!h.endDate || h.endDate >= targetDate))
        const leaderName = activeHistory?.leader?.fullName || 'N/A'
        const conf = SHIFT_CONFIG[att?.status || '']
        let isNightShift = conf ? conf.end < conf.start : (leaderShiftCounts[leaderName]?.night > leaderShiftCounts[leaderName]?.day)

        if (isNightShift && (!conf || !conf.start)) {
            const hasNightPunch = (todayInOut.inTime && todayInOut.inTime >= '14:00') || (todayInOut.outTime && todayInOut.outTime >= '14:00');
            if (!hasNightPunch) isNightShift = false
        }

        // Determine actual quet pattern first
        let isActualNight = false;
        let isActualDay = false;

        if (todayInOut.inTime && todayInOut.outTime) {
            const inH = parseInt(todayInOut.inTime.split(':')[0]);
            const outH = parseInt(todayInOut.outTime.split(':')[0]);
            if (inH >= 4 && inH < 16 && outH >= 12 && outH < 23 && outH > inH) {
                isActualDay = true;
            }
        }

        // Night pattern check: start late today, end early tomorrow
        const hasTodayLate = todayInOut.inTime && (parseInt(todayInOut.inTime.split(':')[0]) >= 16 || parseInt(todayInOut.inTime.split(':')[0]) < 4);
        const hasTomorrowEarly = (tomorrowInOut.inTime && parseInt(tomorrowInOut.inTime.split(':')[0]) < 12) || 
                                 (tomorrowInOut.outTime && parseInt(tomorrowInOut.outTime.split(':')[0]) < 12);
        if (hasTodayLate && hasTomorrowEarly) {
            isActualNight = true;
        }

        // Perform extraction based on detected pattern (or fallback to leader's shift)
        if (isActualDay) {
            inTime = todayInOut.inTime;
            outTime = todayInOut.outTime;
        } else if (isActualNight) {
            inTime = todayInOut.inTime && (parseInt(todayInOut.inTime.split(':')[0]) >= 16 || parseInt(todayInOut.inTime.split(':')[0]) < 4) 
                ? todayInOut.inTime 
                : todayInOut.outTime;
            outTime = tomorrowInOut.inTime && (parseInt(tomorrowInOut.inTime.split(':')[0]) < 12)
                ? tomorrowInOut.inTime
                : tomorrowInOut.outTime;
        } else {
            // Fallback to traditional logic using leader's shift
            if (isNightShift) {
                inTime = todayInOut.inTime;
                if (tomorrowInOut.outTime && tomorrowInOut.outTime < '15:00') outTime = tomorrowInOut.outTime
                else if (tomorrowInOut.inTime && tomorrowInOut.inTime < '15:00') outTime = tomorrowInOut.inTime
                else if (todayInOut.outTime && todayInOut.outTime >= '14:00' && todayInOut.outTime !== inTime) outTime = todayInOut.outTime
                else outTime = null
            } else {
                inTime = todayInOut.inTime
                outTime = todayInOut.outTime
                if (!inTime && outTime && outTime < '09:00') outTime = null
                if (inTime && !outTime && inTime > '15:00') inTime = null
            }
        }

        const isLeaveOrEmpty = !att?.status || !SHIFT_CONFIG[att.status]
        if (isLeaveOrEmpty && (inTime || outTime) && !(inTime && outTime) && fpPrev?.includes((inTime || outTime)!)) {
            inTime = null; outTime = null
        }

        reports.push(verifyRecord(emp.employeeCode, emp.fullName, leaderName, att?.status || '', ot?.hours || 0, inTime, outTime, targetDate, SHIFT_CONFIG, { pic: emp.pic, mgt: emp.mgt, employeeType: emp.employeeType, supervisor: emp.supervisor }))
    }
    return reports
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const date = searchParams.get('date'), month = searchParams.get('month')
        if (!date && !month) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

        const dbShifts = await prisma.shift.findMany({ where: { isActive: true } })
        const SHIFT_CONFIG: any = {}
        dbShifts.forEach(s => SHIFT_CONFIG[s.code] = { start: s.startTime, end: s.endTime, otPre: s.otPreStart ? [s.otPreStart, s.otPreEnd!] : undefined, otPost: s.otPostStart ? [s.otPostStart, s.otPostEnd!] : undefined })

        if (month) {
            const [y, m] = month.split('-').map(Number)
            // Attendance Period: 21st of prev month to 20th of current month
            // Example: m=3 (March) -> start=Feb 21, end=Mar 20
            const start = new Date(Date.UTC(y, m - 2, 21))
            const end = new Date(Date.UTC(y, m - 1, 20, 23, 59, 59))
            
            const emps = await prisma.employee.findMany({
                include: {
                    clerkAttendances: { where: { recordDate: { gte: start, lte: end } } },
                    clerkOvertimes: { where: { recordDate: { gte: start, lte: end } } },
                    leaderHistories: { where: { startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }] }, include: { leader: true } },
                    fingerprints: { where: { recordDate: { gte: new Date(start.getTime() - 86400000), lte: new Date(end.getTime() + 86400000) } } }
                }
            })

            const summaries = []
            const supervisorStats: Record<string, any> = {}
            const lineLeaderStats: Record<string, any> = {}
            const shiftStats: Record<string, any> = {}

            let current = new Date(start)
            while (current <= end) {
                const target = new Date(current)
                const fMaps = { prev: new Map(), current: new Map(), next: new Map() }
                emps.forEach(e => e.fingerprints.forEach((f: any) => {
                    const k = String(e.employeeCode).replace(/^0+/, ''), t = f.recordDate.getTime()
                    if (t === target.getTime()) fMaps.current.set(k, f.timeString)
                    else if (t === target.getTime() - 86400000) fMaps.prev.set(k, f.timeString)
                    else if (t === target.getTime() + 86400000) fMaps.next.set(k, f.timeString)
                }))
                const dayResults = dayResults_impl(target, SHIFT_CONFIG, emps, fMaps as any)
                
                const dayStats = dayResults.reduce((acc: any, r: any) => {
                    const statusKey = r.status.toLowerCase()
                    if (statusKey in acc) acc[statusKey]++

                    const exp = typeof r.expectedOt === 'number' ? r.expectedOt : (parseFloat(String(r.expectedOt)) || 0)
                    const diff = Math.abs((r.submittedOt || 0) - exp)
                    const net = (r.submittedOt || 0) - exp

                    if (r.status !== 'VALID') {
                        acc.netDiff += net
                        acc.absDiff += diff
                        if (r.status === 'ERROR') acc.absDiffError += diff
                        else if (r.status === 'WARNING') acc.absDiffWarning += diff
                    }

                    // Supervisor Aggregation
                    const supName = r.supervisor || 'N/A'
                    if (!supervisorStats[supName]) supervisorStats[supName] = { name: supName, absDiff: 0, absDiffError: 0, absDiffWarning: 0, netDiff: 0, total: 0, error: 0, warning: 0, valid: 0 }
                    supervisorStats[supName].total++
                    supervisorStats[supName][statusKey]++
                    supervisorStats[supName].absDiff += diff
                    if (r.status === 'ERROR') supervisorStats[supName].absDiffError += diff
                    if (r.status === 'WARNING') supervisorStats[supName].absDiffWarning += diff
                    supervisorStats[supName].netDiff += net

                    // Line Leader Aggregation
                    if (!lineLeaderStats[r.leaderName]) lineLeaderStats[r.leaderName] = { name: r.leaderName, absDiff: 0, absDiffError: 0, absDiffWarning: 0, netDiff: 0, total: 0, error: 0, warning: 0, valid: 0 }
                    lineLeaderStats[r.leaderName].total++
                    lineLeaderStats[r.leaderName][statusKey]++
                    lineLeaderStats[r.leaderName].absDiff += diff
                    if (r.status === 'ERROR') lineLeaderStats[r.leaderName].absDiffError += diff
                    if (r.status === 'WARNING') lineLeaderStats[r.leaderName].absDiffWarning += diff
                    lineLeaderStats[r.leaderName].netDiff += net

                    // Shift Aggregation
                    const sCode = r.submittedShift || 'N/A'
                    if (!shiftStats[sCode]) shiftStats[sCode] = { name: sCode, absDiff: 0, absDiffError: 0, absDiffWarning: 0, netDiff: 0, total: 0, error: 0, warning: 0, valid: 0 }
                    shiftStats[sCode].total++
                    shiftStats[sCode][statusKey]++
                    shiftStats[sCode].absDiff += diff
                    if (r.status === 'ERROR') shiftStats[sCode].absDiffError += diff
                    if (r.status === 'WARNING') shiftStats[sCode].absDiffWarning += diff
                    shiftStats[sCode].netDiff += net

                    return acc
                }, { valid: 0, warning: 0, error: 0, netDiff: 0, absDiff: 0, absDiffError: 0, absDiffWarning: 0 })

                summaries.push({ date: target.toISOString().split('T')[0], ...dayStats, total: dayStats.valid + dayStats.warning + dayStats.error })
                
                // Advance one day
                current.setUTCDate(current.getUTCDate() + 1)
            }
            return NextResponse.json({ 
                data: summaries, 
                supervisorStats: Object.values(supervisorStats),
                lineLeaderStats: Object.values(lineLeaderStats),
                shiftStats: Object.values(shiftStats)
            })
        }

        const base = new Date(date!), start = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()))
        const end = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59))
        const fps = await prisma.fingerprint.findMany({ where: { recordDate: { gte: new Date(start.getTime() - 86400000), lte: new Date(start.getTime() + 86400000) } }, include: { employee: true } })
        const fMaps = { prev: new Map(), current: new Map(), next: new Map() }
        fps.forEach((f: any) => {
            const k = String(f.employee.employeeCode).replace(/^0+/, ''), t = f.recordDate.getTime()
            if (t === start.getTime()) fMaps.current.set(k, f.timeString)
            else if (t === start.getTime() - 86400000) fMaps.prev.set(k, f.timeString)
            else if (t === start.getTime() + 86400000) fMaps.next.set(k, f.timeString)
        })

        let emps: any[] = [];
        emps = await prisma.employee.findMany({ include: { clerkAttendances: { where: { recordDate: { gte: start, lte: end } } }, clerkOvertimes: { where: { recordDate: { gte: start, lte: end } } }, leaderHistories: { where: { startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }] }, include: { leader: true } } } })
        
        return NextResponse.json({ data: dayResults_impl(start, SHIFT_CONFIG, emps, fMaps as any) })
    } catch (e) {
        console.error(e); return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
