// Clerk attendance import API
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { targetMonth, importType, records } = body

        if (!targetMonth || !records || !Array.isArray(records)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
        }

        // --- Dedup records to prevent processing identical items ---
        const dedupMap = new Map()
        for (const row of records) {
            const empCode = String(row.employeeCode || row['MÃ NV'] || row['Emp Code']).replace(/\$/g, '').trim()
            if (empCode) {
                dedupMap.set(empCode, row)
            }
        }
        const uniqueRecords = Array.from(dedupMap.values())

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
        const getLeaderId = async (leaderName: string) => {
            const usernameBase = leaderName.toLowerCase()
                .replace(/đ/g, 'd')
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]/g, '')

            // Try to find by exactly mapped username first (this ensures consistency)
            let existing = allLeaders.find(l => l.username === usernameBase)
            if (!existing) {
                // Try exact full name fallback
                existing = allLeaders.find(l => l.fullName === leaderName)
            }
            if (existing) {
                // Update full name if it was somehow changed
                if (existing.fullName !== leaderName) {
                    await prisma.user.update({ where: { id: existing.id }, data: { fullName: leaderName } })
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
            const newLeader = await prisma.user.create({
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
            for (const row of uniqueRecords) {
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
                const dailyData = row.dailyData || {}
                const otData = row.otData || {}

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

                // fallback update for new fields using raw SQL to bypass client metadata issues
                await tx.$executeRawUnsafe(
                    `UPDATE "Employee" SET "title" = $1, "supervisor" = $2, "gender" = $3, "vendor" = $4, "zone" = $5, "mu" = $6, "shiftLeader" = $7 WHERE id = $8`,
                    row.title || (emp as any).title,
                    row.supervisor || (emp as any).supervisor,
                    row.gender || (emp as any).gender,
                    row.vendor || (emp as any).vendor,
                    row.zone || (emp as any).zone,
                    row.mu || (emp as any).mu,
                    row.shiftLeader || (emp as any).shiftLeader,
                    emp.id
                )

                // 2. Resolve Leader
                const leaderId = await getLeaderId(leaderName)

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
                        // There is an overlap!
                        if (histStart < targetStart && histEnd > targetEnd) {
                            // Hist completely envelopes the target month. Split it into two!
                            await tx.employeeLeaderHistory.update({
                                where: { id: hist.id },
                                data: { endDate: oldLeaderEndDate }
                            })
                            await tx.employeeLeaderHistory.create({
                                data: {
                                    employeeId: hist.employeeId,
                                    leaderId: hist.leaderId,
                                    startDate: new Date(targetEnd + 86400000), // 21st of current target month
                                    endDate: hist.endDate
                                }
                            })
                        } else if (histStart < targetStart) {
                            // Hist starts before but ends during target month -> truncate end
                            await tx.employeeLeaderHistory.update({
                                where: { id: hist.id },
                                data: { endDate: oldLeaderEndDate }
                            })
                        } else if (histEnd > targetEnd) {
                            // Hist starts during but ends after target month -> truncate start
                            await tx.employeeLeaderHistory.update({
                                where: { id: hist.id },
                                data: { startDate: new Date(targetEnd + 86400000) }
                            })
                        } else {
                            // Hist is entirely encompassed by target month -> delete it
                            await tx.employeeLeaderHistory.delete({
                                where: { id: hist.id }
                            })
                        }
                    }
                }

                // Finally create the bounded absolute history for THIS month!
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

            // 4. Process Daily Data in Bulk
            const allEmpIds = Array.from(empIdMap.values())
            if (allEmpIds.length === 0) return

            // --- PROCESS ATTENDANCE ---
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

            for (const row of uniqueRecords) {
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
                            status: statusVal,
                            isLocked: false
                        })
                    }
                }
            }

            if (attCreates.length > 0) {
                await tx.clerkAttendance.createMany({ data: attCreates, skipDuplicates: true })
            }
            if (attUpdates.length > 0) {
                for (let i = 0; i < attUpdates.length; i += 500) {
                    await Promise.all(attUpdates.slice(i, i + 500))
                }
            }

            // --- PROCESS OT ---
            const existingOTList = await tx.clerkOvertime.findMany({
                where: {
                    employeeId: { in: allEmpIds },
                    recordDate: { gte: startDate, lte: newLeaderEndDate }
                },
                select: { id: true, employeeId: true, recordDate: true }
            })
            const existingOTMap = new Map()
            existingOTList.forEach(ot => existingOTMap.set(`${ot.employeeId}_${ot.recordDate.getTime()}`, ot.id))

            const otCreates: any[] = []
            const otUpdates: any[] = []

            for (const row of uniqueRecords) {
                const empCode = String(row.employeeCode).replace(/\$/g, '').trim()
                const empId = empIdMap.get(empCode)
                if (!empId) continue

                const otData = row.otData || {}
                for (const [dateStr, value] of Object.entries(otData)) {
                    const [yyyy, mm, dd] = dateStr.split('-').map(Number)
                    const recordDate = new Date(Date.UTC(yyyy, mm - 1, dd))
                    if (recordDate < startDate || recordDate > newLeaderEndDate) continue

                    let otVal = (value as string).replace('$', '').trim()
                    let hours = parseFloat(otVal)
                    if (isNaN(hours)) continue

                    const key = `${empId}_${recordDate.getTime()}`
                    if (existingOTMap.has(key)) {
                        otUpdates.push(tx.clerkOvertime.update({
                            where: { id: existingOTMap.get(key) },
                            data: { hours: hours }
                        }))
                    } else {
                        otCreates.push({
                            employeeId: empId,
                            recordDate: recordDate,
                            hours: hours,
                            timeType: "After Shift"
                        })
                    }
                }
            }

            if (otCreates.length > 0) {
                await tx.clerkOvertime.createMany({ data: otCreates, skipDuplicates: true })
            }
            if (otUpdates.length > 0) {
                for (let i = 0; i < otUpdates.length; i += 500) {
                    await Promise.all(otUpdates.slice(i, i + 500))
                }
            }

        }, { timeout: 300000 })

        return NextResponse.json({ success: true })

    } catch (e: any) {
        console.error('Import API Error:', e)
        return NextResponse.json({ error: e.message || 'Import failed' }, { status: 500 })
    }
}
