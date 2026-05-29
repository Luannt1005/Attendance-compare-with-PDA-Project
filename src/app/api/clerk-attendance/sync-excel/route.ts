import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'
import { getMonthExcelData } from '@/lib/excel-timesheet-helper'

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { targetMonth, importType } = body // importType can be 'attendance' or 'ot' or 'both'

        if (!targetMonth) {
            return NextResponse.json({ error: 'targetMonth is required' }, { status: 400 })
        }

        // 1. Fetch records from the network link
        let records: any[] = []
        try {
            records = await getMonthExcelData(targetMonth)
        } catch (err: any) {
            console.error('[sync-excel-api] Error reading network files:', err)
            return NextResponse.json({ error: `Lỗi đọc file từ network drive: ${err.message}` }, { status: 500 })
        }

        if (records.length === 0) {
            return NextResponse.json({ error: 'Không tìm thấy bản ghi nào trong file Excel trên network drive.' }, { status: 400 })
        }

        const [yearStr, monthStr] = targetMonth.split('-')
        const targetYear = parseInt(yearStr)
        const targetMonthIndex = parseInt(monthStr) - 1

        let prevYear = targetYear
        let prevMonthIndex = targetMonthIndex - 1
        if (prevMonthIndex < 0) {
            prevMonthIndex = 11
            prevYear -= 1
        }

        const startDate = new Date(Date.UTC(prevYear, prevMonthIndex, 21))
        const oldLeaderEndDate = new Date(Date.UTC(prevYear, prevMonthIndex, 20))
        const newLeaderEndDate = new Date(Date.UTC(targetYear, targetMonthIndex, 20))

        // Get default department and line just in case we need to create an employee
        let defaultDept = await prisma.department.findFirst()
        let defaultLine = await prisma.line.findFirst()

        if (!defaultDept || !defaultLine) {
            const newDept = await prisma.department.create({ data: { name: 'Default Dept' } })
            const newLine = await prisma.line.create({ data: { name: 'Default Line', departmentId: newDept.id } })
            defaultDept = newDept
            defaultLine = newLine
        }

        // Preload leader role id
        const leaderRole = await prisma.role.findFirst({ where: { name: 'Leader' } })
        if (!leaderRole) {
            return NextResponse.json({ error: 'Leader role not found in DB' }, { status: 500 })
        }

        // To minimize round trips, fetch all leaders into memory
        let allLeaders = await prisma.user.findMany({ where: { roleId: leaderRole.id } })
        const getLeaderId = async (leaderName: string, tx: any) => {
            const usernameBase = leaderName.toLowerCase()
                .replace(/đ/g, 'd')
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]/g, '')

            let existing = allLeaders.find(l => l.username === usernameBase)
            if (!existing) {
                existing = allLeaders.find(l => l.fullName === leaderName)
            }
            if (existing) {
                if (existing.fullName !== leaderName) {
                    await tx.user.update({ where: { id: existing.id }, data: { fullName: leaderName } })
                    existing.fullName = leaderName
                }
                return existing.id
            }

            let username = usernameBase
            let counter = 1
            while (allLeaders.find(l => l.username === username)) {
                username = `${usernameBase}${counter}`
                counter++
            }

            const hash = await bcrypt.hash('123456', 10)
            const newLeader = await tx.user.create({
                data: {
                    username: username,
                    passwordHash: hash,
                    fullName: leaderName,
                    roleId: leaderRole.id,
                    isActive: true
                }
            })
            allLeaders.push(newLeader)
            return newLeader.id
        }

        await prisma.$transaction(async (tx) => {
            // --- Memory Cache for Speed ---
            const allDepts = await tx.department.findMany()
            const deptMap = new Map(allDepts.map(d => [d.name, d]))

            const allLines = await tx.line.findMany()
            const lineMap = new Map(allLines.map(l => [`${l.departmentId}_${l.name}`, l]))

            const empIdMap = new Map<string, number>()
            for (const row of records) {
                const empCode = String(row.employeeCode).replace(/\$/g, '').trim()
                const empName = row.fullName?.trim() || 'Unknown'
                const leaderName = row.lineLeaderName?.trim()
                const pic = row.pic?.trim()
                const mgt = row.mgt?.trim()
                const employeeType = row.employeeType?.trim()
                const departmentName = row.department?.trim()
                const lineName = row.line?.trim()
                const status = row.status?.trim() || 'Active'
                let joinDate: Date | null = null
                if (row.joinDate && row.joinDate !== 'null' && row.joinDate !== '') {
                    const parsedJoin = new Date(row.joinDate)
                    if (!isNaN(parsedJoin.getTime())) {
                        joinDate = parsedJoin
                    }
                }
                let resignDate: Date | null = null
                if (row.resignDate && row.resignDate !== 'null' && row.resignDate !== '') {
                    const parsedResign = new Date(row.resignDate)
                    if (!isNaN(parsedResign.getTime())) {
                        resignDate = parsedResign
                    }
                }

                if (!empCode || !leaderName) continue

                let dept = departmentName ? deptMap.get(departmentName) : null
                if (departmentName && !dept) {
                    dept = await tx.department.create({ data: { name: departmentName } })
                    deptMap.set(departmentName, dept)
                }

                let line = null
                if (lineName && dept) {
                    const lineKey = `${dept.id}_${lineName}`
                    line = lineMap.get(lineKey)
                    if (!line) {
                        line = await tx.line.create({ data: { name: lineName, departmentId: dept.id } })
                        lineMap.set(lineKey, line)
                    }
                }

                // 1. Find or create employee
                let emp = await tx.employee.findUnique({ where: { employeeCode: empCode } })
                if (!emp) {
                    emp = await tx.employee.create({
                        data: {
                            employeeCode: empCode,
                            fullName: empName,
                            joinDate: joinDate || new Date(),
                            resignDate: resignDate,
                            status: status,
                            departmentId: dept?.id || defaultDept.id,
                            lineId: line?.id || defaultLine.id,
                            pic: pic,
                            mgt: mgt,
                            employeeType: employeeType,
                        }
                    })
                } else {
                    emp = await tx.employee.update({
                        where: { id: emp.id },
                        data: {
                            fullName: empName,
                            joinDate: joinDate || emp.joinDate,
                            resignDate: resignDate || emp.resignDate,
                            status: row.status ? status : emp.status,
                            departmentId: dept ? dept.id : emp.departmentId,
                            lineId: line ? line.id : emp.lineId,
                            pic: pic || emp.pic,
                            mgt: mgt || emp.mgt,
                            employeeType: employeeType || emp.employeeType,
                        }
                    })
                }

                // fallback update for new fields using raw SQL
                await tx.$executeRawUnsafe(
                    `UPDATE "Employee" SET "title" = $1, "supervisor" = $2, "gender" = $3, "vendor" = $4, "zone" = $5, "mu" = $6, "shiftLeader" = $7 WHERE id = $8`,
                    row.title || (emp as any).title || '',
                    row.supervisor || (emp as any).supervisor || '',
                    row.gender || (emp as any).gender || '',
                    row.vendor || (emp as any).vendor || '',
                    row.zone || (emp as any).zone || '',
                    row.mu || (emp as any).mu || '',
                    row.shiftLeader || (emp as any).shiftLeader || '',
                    emp.id
                )

                // 2. Resolve Leader
                const leaderId = await getLeaderId(leaderName, tx)

                // 3. Punch a hole in history explicitly for THIS single month for THIS employee
                const existingHistories = await tx.employeeLeaderHistory.findMany({
                    where: { employeeId: emp.id }
                })

                for (const hist of existingHistories) {
                    const histStart = hist.startDate.getTime()
                    const histEnd = hist.endDate ? hist.endDate.getTime() : Infinity
                    const targetStart = startDate.getTime()
                    const targetEnd = newLeaderEndDate.getTime()

                    if (histStart <= targetEnd && histEnd >= targetStart) {
                        if (histStart < targetStart && histEnd > targetEnd) {
                            await tx.employeeLeaderHistory.update({
                                where: { id: hist.id },
                                data: { endDate: oldLeaderEndDate }
                            })
                            await tx.employeeLeaderHistory.create({
                                data: {
                                    employeeId: hist.employeeId,
                                    leaderId: hist.leaderId,
                                    startDate: new Date(targetEnd + 86400000),
                                    endDate: hist.endDate
                                }
                            })
                        } else if (histStart < targetStart) {
                            await tx.employeeLeaderHistory.update({
                                where: { id: hist.id },
                                data: { endDate: oldLeaderEndDate }
                            })
                        } else if (histEnd > targetEnd) {
                            await tx.employeeLeaderHistory.update({
                                where: { id: hist.id },
                                data: { startDate: new Date(targetEnd + 86400000) }
                            })
                        } else {
                            await tx.employeeLeaderHistory.delete({
                                where: { id: hist.id }
                            })
                        }
                    }
                }

                // Finally create the bounded absolute history for THIS month
                await tx.employeeLeaderHistory.create({
                    data: {
                        employeeId: emp.id,
                        leaderId: leaderId,
                        startDate: startDate,
                        endDate: newLeaderEndDate
                    }
                })

                empIdMap.set(empCode, emp.id)
            }

            // 4. Process Daily Data in Bulk (only if targetMonth's importType matches or both)
            const allEmpIds = Array.from(empIdMap.values())
            if (allEmpIds.length === 0) return

            // PROCESS ATTENDANCE
            if (!importType || importType === 'attendance') {
                const existingAttList = await tx.clerkAttendance.findMany({
                    where: {
                        employeeId: { in: allEmpIds },
                        recordDate: { gte: startDate, lte: newLeaderEndDate }
                    },
                    select: { id: true, employeeId: true, recordDate: true }
                })
                const existingAttMap = new Map()
                existingAttList.forEach(att => existingAttMap.set(`${att.employeeId}_${att.recordDate.getTime()}`, att.id))

                const attCreates: any[] = []
                const attUpdates: any[] = []

                for (const row of records) {
                    const empCode = String(row.employeeCode).replace(/\$/g, '').trim()
                    const empId = empIdMap.get(empCode)
                    if (!empId) continue

                    const dailyData = row.dailyData || {}
                    for (const [dateStr, value] of Object.entries(dailyData)) {
                        const [yyyy, mm, dd] = dateStr.split('-').map(Number)
                        const recordDate = new Date(Date.UTC(yyyy, mm - 1, dd))
                        if (recordDate < startDate || recordDate > newLeaderEndDate) continue

                        let statusVal = (value as string).trim().toUpperCase()
                        if (!statusVal) continue
                        if (statusVal === 'P') statusVal = 'S1'

                        const key = `${empId}_${recordDate.getTime()}`
                        if (existingAttMap.has(key)) {
                            attUpdates.push(tx.clerkAttendance.update({
                                where: { id: existingAttMap.get(key) },
                                data: { status: statusVal }
                            }))
                        } else {
                            attCreates.push({
                                employeeId: empId,
                                recordDate: recordDate,
                                status: statusVal
                            })
                        }
                    }
                }

                if (attCreates.length > 0) {
                    await tx.clerkAttendance.createMany({ data: attCreates })
                }
                if (attUpdates.length > 0) {
                    await Promise.all(attUpdates)
                }
            }

            // PROCESS OVERTIME
            if (!importType || importType === 'ot') {
                const existingOtList = await tx.clerkOvertime.findMany({
                    where: {
                        employeeId: { in: allEmpIds },
                        recordDate: { gte: startDate, lte: newLeaderEndDate }
                    },
                    select: { id: true, employeeId: true, recordDate: true }
                })
                const existingOtMap = new Map()
                existingOtList.forEach(ot => existingOtMap.set(`${ot.employeeId}_${ot.recordDate.getTime()}`, ot.id))

                const otCreates: any[] = []
                const otUpdates: any[] = []

                for (const row of records) {
                    const empCode = String(row.employeeCode).replace(/\$/g, '').trim()
                    const empId = empIdMap.get(empCode)
                    if (!empId) continue

                    const otData = row.otData || {}
                    for (const [dateStr, value] of Object.entries(otData)) {
                        const [yyyy, mm, dd] = dateStr.split('-').map(Number)
                        const recordDate = new Date(Date.UTC(yyyy, mm - 1, dd))
                        if (recordDate < startDate || recordDate > newLeaderEndDate) continue

                        const hoursVal = parseFloat(String(value || 0))
                        if (isNaN(hoursVal) || hoursVal <= 0) continue

                        const key = `${empId}_${recordDate.getTime()}`
                        if (existingOtMap.has(key)) {
                            otUpdates.push(tx.clerkOvertime.update({
                                where: { id: existingOtMap.get(key) },
                                data: { hours: hoursVal }
                            }))
                        } else {
                            otCreates.push({
                                employeeId: empId,
                                recordDate: recordDate,
                                hours: hoursVal,
                                timeType: 'OT'
                            })
                        }
                    }
                }

                if (otCreates.length > 0) {
                    await tx.clerkOvertime.createMany({ data: otCreates })
                }
                if (otUpdates.length > 0) {
                    await Promise.all(otUpdates)
                }
            }
        })

        return NextResponse.json({ success: true, count: records.length })
    } catch (error: any) {
        console.error('[sync-excel-api] Sync API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
