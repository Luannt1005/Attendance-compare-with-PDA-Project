import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyRecord, extractInOut } from '@/lib/auditLogic'
import * as XLSX from 'xlsx'
import { format } from 'date-fns'
import { POST as runImport } from '@/app/api/clerk-attendance/import/route'

export async function POST(req: Request) {
    try {
        const formData = await req.formData()
        const file = formData.get('file') as File
        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
        }

        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, dateNF: 'yyyy-MM-dd' })

        const tsSheet = workbook.Sheets['Attendance'] || workbook.Sheets['TS'] || workbook.Sheets[workbook.SheetNames[0]]
        const otSheet = workbook.Sheets['OT']

        if (!tsSheet) throw new Error('Attendance sheet not found')

        const rawData = XLSX.utils.sheet_to_json(tsSheet, { header: 1, raw: false, dateNF: 'yyyy-MM-dd' }) as any[][]
        if (!rawData || rawData.length < 1) throw new Error('Attendance sheet is empty')

        // find header row
        let headerRowIndex = 0
        let empCodeIdx = -1
        for (let i = 0; i < Math.min(rawData.length, 30); i++) {
            const row = rawData[i]
            if (!row) continue
            const idx = row.findIndex(cell => {
                const s = String(cell || '').toLowerCase().trim()
                return s === 'employee code' || s === 'mã nv' || s === 'emp code' || s === 'employee id'
            })
            if (idx !== -1) {
                empCodeIdx = idx
                headerRowIndex = i
                break
            }
        }

        if (empCodeIdx === -1) {
            empCodeIdx = 0 // fallback
        }

        const headers = rawData[headerRowIndex].map(h => String(h || '').trim())
        const getColIdx = (aliases: string[]) => {
            const lowerAliases = aliases.map(a => a.toLowerCase())
            return headers.findIndex(h => h && lowerAliases.includes(h.toLowerCase()))
        }

        const fullNameIdx = getColIdx(['name in full', 'full name', 'họ và tên', 'họ tên', 'name'])
        const leaderIdx = getColIdx(['leader', 'line leader', 'contact person', 'supervisor', 'new leader'])
        
        const dateCols: { idx: number, dateStr: string, date: Date }[] = []
        headers.forEach((h, idx) => {
            const match = h.match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i)
            const isoMatch = h.match(/^\d{4}-\d{2}-\d{2}$/)
            if (match) {
                const d = parseInt(match[1])
                const mStr = match[2].toLowerCase()
                const mNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
                const mIdx = mNames.indexOf(mStr)
                // We use current year as base if not provided. Or 2026.
                const year = new Date().getFullYear() > 2026 ? new Date().getFullYear() : 2026
                const dateObj = new Date(Date.UTC(year, mIdx, d))
                dateCols.push({ idx, dateStr: format(dateObj, 'yyyy-MM-dd'), date: dateObj })
            } else if (isoMatch) {
                const dateObj = new Date(h)
                dateCols.push({ idx, dateStr: h, date: dateObj })
            }
        })

        const otMap: Record<string, Record<string, number>> = {}
        if (otSheet) {
            const rawOt = XLSX.utils.sheet_to_json(otSheet, { header: 1, raw: false, dateNF: 'yyyy-MM-dd' }) as any[][]
            let otHeadIdx = 0
            let otEmpIdx = -1
            for (let i = 0; i < Math.min(rawOt.length, 15); i++) {
                if(!rawOt[i]) continue
                const idx = rawOt[i].findIndex(c => {
                    const s = String(c || '').toLowerCase().trim()
                    return s.includes('employee code') || s === 'emp code' || s === 'employee id'
                })
                if (idx !== -1) { otEmpIdx = idx; otHeadIdx = i; break; }
            }
            if (otEmpIdx !== -1) {
                const otHeaders = rawOt[otHeadIdx].map(h => String(h || '').trim())
                const otDateCols: { idx: number, dateStr: string }[] = []
                otHeaders.forEach((h, idx) => {
                    const match = h.match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i)
                    const isoMatch = h.match(/^\d{4}-\d{2}-\d{2}$/)
                    if (match) {
                        const d = parseInt(match[1])
                        const mStr = match[2].toLowerCase()
                        const mNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
                        const mIdx = mNames.indexOf(mStr)
                        const year = new Date().getFullYear() > 2026 ? new Date().getFullYear() : 2026
                        const dateObj = new Date(Date.UTC(year, mIdx, d))
                        otDateCols.push({ idx, dateStr: format(dateObj, 'yyyy-MM-dd') })
                    } else if (isoMatch) {
                        otDateCols.push({ idx, dateStr: h })
                    }
                })
                for (let i = otHeadIdx + 1; i < rawOt.length; i++) {
                    const row = rawOt[i]
                    if(!row) continue
                    const code = String(row[otEmpIdx] || '').replace(/\$/g, '').trim()
                    if (!code || isNaN(parseInt(code))) continue
                    if (!otMap[code]) otMap[code] = {}
                    otDateCols.forEach(dc => {
                        const vStr = String(row[dc.idx] || '0').replace(/\$/g, '').trim()
                        const v = parseFloat(vStr)
                        if (!isNaN(v) && v > 0) otMap[code][dc.dateStr] = v
                    })
                }
            }
        }

        const parsedEmployees: any[] = []
        for (let i = headerRowIndex + 1; i < rawData.length; i++) {
            const row = rawData[i]
            if (!row || !row[empCodeIdx]) continue
            const rawCode = String(row[empCodeIdx]).replace(/\$/g, '').trim()
            if (!rawCode || isNaN(parseInt(rawCode))) continue

            const attMap: Record<string, string> = {}
            dateCols.forEach(col => {
                const val = (row[col.idx] || '').toString().trim().toUpperCase()
                if (val) attMap[col.dateStr] = val === 'P' ? 'S1' : val
            })
            
            parsedEmployees.push({
                employeeCode: rawCode,
                fullName: fullNameIdx !== -1 ? String(row[fullNameIdx] || '').trim() : 'Unknown',
                leaderName: leaderIdx !== -1 ? String(row[leaderIdx] || '').trim() : 'N/A',
                attendances: attMap,
                overtimes: otMap[rawCode] || {}
            })
        }

        if (dateCols.length === 0) {
            return NextResponse.json({ error: 'No date columns found in Excel file' }, { status: 400 })
        }

        // Fetch fingerprints and employee extra info from DB
        const allEmpCodes = parsedEmployees.map(e => e.employeeCode)
        const minDate = new Date(Math.min(...dateCols.map(d => d.date.getTime())))
        const maxDate = new Date(Math.max(...dateCols.map(d => d.date.getTime())))
        const fpStart = new Date(minDate.getTime() - 86400000)
        const fpEnd = new Date(maxDate.getTime() + 86400000)

        const dbEmps = await prisma.employee.findMany({
            where: { employeeCode: { in: allEmpCodes } },
            include: {
                fingerprints: {
                    where: { recordDate: { gte: fpStart, lte: fpEnd } }
                }
            }
        })
        const dbEmpMap = new Map(dbEmps.map(e => [e.employeeCode, e]))

        // --- SAVE DATA TO DB ---
        // Automatically persist ALL imported Excel records (attendance/overtime) to DB so that they are stored
        // and can be analyzed and viewed in the monthly discrepancy dashboard.
        await prisma.$transaction(async (tx) => {
            for (const emp of parsedEmployees) {
                const dbEmp = dbEmpMap.get(emp.employeeCode)
                if (!dbEmp) continue

                for (const dateCol of dateCols) {
                    const recordDate = new Date(dateCol.dateStr)
                    const shiftCode = emp.attendances[dateCol.dateStr]
                    const otHours = emp.overtimes[dateCol.dateStr] || 0

                    if (shiftCode) {
                        await tx.clerkAttendance.upsert({
                            where: {
                                employeeId_recordDate: {
                                    employeeId: dbEmp.id,
                                    recordDate: recordDate
                                }
                            },
                            create: {
                                employeeId: dbEmp.id,
                                recordDate: recordDate,
                                status: shiftCode
                            },
                            update: {
                                status: shiftCode
                            }
                        })
                    }

                    if (otHours > 0) {
                        const existingOt = await tx.clerkOvertime.findFirst({
                            where: { employeeId: dbEmp.id, recordDate: recordDate }
                        })
                        if (existingOt) {
                            await tx.clerkOvertime.update({
                                where: { id: existingOt.id },
                                data: { hours: otHours }
                            })
                        } else {
                            await tx.clerkOvertime.create({
                                data: {
                                    employeeId: dbEmp.id,
                                    recordDate: recordDate,
                                    hours: otHours,
                                    timeType: 'Day'
                                }
                            })
                        }
                    } else {
                        await tx.clerkOvertime.deleteMany({
                            where: {
                                employeeId: dbEmp.id,
                                recordDate: recordDate
                            }
                        })
                    }
                }
            }
        }, {
            timeout: 60000 // 60 seconds timeout for large files
        })
        // --- END SAVE DATA ---

        const dbShifts = await prisma.shift.findMany({ where: { isActive: true } })
        const SHIFT_CONFIG: any = {}
        dbShifts.forEach(s => SHIFT_CONFIG[s.code] = { start: s.startTime, end: s.endTime, otPre: s.otPreStart ? [s.otPreStart, s.otPreEnd!] : undefined, otPost: s.otPostStart ? [s.otPostStart, s.otPostEnd!] : undefined })

        const results: any[] = []
        const supervisorStats: Record<string, any> = {}
        const lineLeaderStats: Record<string, any> = {}
        const shiftStats: Record<string, any> = {}
        const summaries: any[] = []

        for (const dateCol of dateCols) {
            const targetDate = dateCol.date
            const dateStr = dateCol.dateStr
            
            const fMaps = { prev: new Map(), current: new Map(), next: new Map() }
            dbEmps.forEach(e => {
                e.fingerprints.forEach(f => {
                    const t = f.recordDate.getTime()
                    if (t === targetDate.getTime()) fMaps.current.set(e.employeeCode, f.timeString)
                    else if (t === targetDate.getTime() - 86400000) fMaps.prev.set(e.employeeCode, f.timeString)
                    else if (t === targetDate.getTime() + 86400000) fMaps.next.set(e.employeeCode, f.timeString)
                })
            })

            const leaderShiftCounts: Record<string, { day: number, night: number }> = {}
            for (const emp of parsedEmployees) {
                const shiftCode = emp.attendances[dateStr]
                if (!shiftCode) continue
                const conf = SHIFT_CONFIG[shiftCode]
                if (conf?.start && conf?.end) {
                    const ln = emp.leaderName || 'N/A'
                    if (!leaderShiftCounts[ln]) leaderShiftCounts[ln] = { day: 0, night: 0 }
                    if (conf.end < conf.start || ['S3', 'S5A'].includes(shiftCode)) leaderShiftCounts[ln].night++
                    else leaderShiftCounts[ln].day++
                }
            }

            const dayResults = []

            for (const emp of parsedEmployees) {
                const shiftCode = emp.attendances[dateStr]
                const otHours = emp.overtimes[dateStr] || 0
                if (!shiftCode && !otHours) continue

                const normEmpCode = emp.employeeCode
                const dbEmp = dbEmpMap.get(normEmpCode)

                const fpToday = fMaps.current.get(normEmpCode)
                const fpNext = fMaps.next.get(normEmpCode)
                const fpPrev = fMaps.prev.get(normEmpCode)

                const todayInOut = fpToday ? extractInOut(fpToday) : { inTime: null, outTime: null }
                const tomorrowInOut = fpNext ? extractInOut(fpNext) : { inTime: null, outTime: null }
                let inTime = todayInOut.inTime, outTime = todayInOut.outTime

                const conf = SHIFT_CONFIG[shiftCode || '']
                const ln = emp.leaderName || 'N/A'
                let isNightShift = conf ? conf.end < conf.start : (leaderShiftCounts[ln]?.night > leaderShiftCounts[ln]?.day)

                if (isNightShift && (!conf || !conf.start)) {
                    const hasNightPunch = (todayInOut.inTime && todayInOut.inTime >= '14:00') || (todayInOut.outTime && todayInOut.outTime >= '14:00')
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
                        if (tomorrowInOut.inTime && tomorrowInOut.inTime < '14:00') outTime = tomorrowInOut.inTime
                        else if (tomorrowInOut.outTime && tomorrowInOut.outTime < '14:00') outTime = tomorrowInOut.outTime
                        else if (todayInOut.outTime && todayInOut.outTime >= '14:00') outTime = todayInOut.outTime
                        else outTime = null
                        if (inTime && inTime < '14:00') inTime = null
                    } else {
                        if (!inTime && outTime && outTime < '09:00') outTime = null
                        if (inTime && !outTime && inTime > '15:00') inTime = null
                    }
                }

                const isLeaveOrEmpty = !shiftCode || !SHIFT_CONFIG[shiftCode]
                if (isLeaveOrEmpty && (inTime || outTime) && !(inTime && outTime) && fpPrev?.includes((inTime || outTime)!)) {
                    inTime = null; outTime = null
                }

                const rec = verifyRecord(
                    emp.employeeCode, 
                    emp.fullName, 
                    ln, 
                    shiftCode || '', 
                    otHours, 
                    inTime, 
                    outTime, 
                    targetDate, 
                    SHIFT_CONFIG, 
                    { 
                        pic: dbEmp?.pic, 
                        mgt: dbEmp?.mgt, 
                        employeeType: dbEmp?.employeeType, 
                        supervisor: dbEmp?.supervisor 
                    }
                )
                dayResults.push(rec)
                results.push(rec)
            }

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

                const supName = r.supervisor || 'N/A'
                if (!supervisorStats[supName]) supervisorStats[supName] = { name: supName, absDiff: 0, absDiffError: 0, absDiffWarning: 0, netDiff: 0, total: 0, error: 0, warning: 0, valid: 0 }
                supervisorStats[supName].total++
                supervisorStats[supName][statusKey]++
                supervisorStats[supName].absDiff += diff
                if (r.status === 'ERROR') supervisorStats[supName].absDiffError += diff
                if (r.status === 'WARNING') supervisorStats[supName].absDiffWarning += diff
                supervisorStats[supName].netDiff += net

                if (!lineLeaderStats[r.leaderName]) lineLeaderStats[r.leaderName] = { name: r.leaderName, absDiff: 0, absDiffError: 0, absDiffWarning: 0, netDiff: 0, total: 0, error: 0, warning: 0, valid: 0 }
                lineLeaderStats[r.leaderName].total++
                lineLeaderStats[r.leaderName][statusKey]++
                lineLeaderStats[r.leaderName].absDiff += diff
                if (r.status === 'ERROR') lineLeaderStats[r.leaderName].absDiffError += diff
                if (r.status === 'WARNING') lineLeaderStats[r.leaderName].absDiffWarning += diff
                lineLeaderStats[r.leaderName].netDiff += net

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

            summaries.push({ date: dateStr, ...dayStats, total: dayStats.valid + dayStats.warning + dayStats.error })
        }

        return NextResponse.json({ 
            data: summaries, 
            supervisorStats: Object.values(supervisorStats),
            lineLeaderStats: Object.values(lineLeaderStats),
            shiftStats: Object.values(shiftStats),
            allResults: results
        })

    } catch (e: any) {
        console.error(e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
