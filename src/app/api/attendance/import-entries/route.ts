
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
    try {
        const { entries, targetMonth } = await req.json()

        if (!entries || !Array.isArray(entries)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
        }

        console.log(`Importing ${entries.length} attendance entries for ${targetMonth}`);

        await prisma.$transaction(async (tx) => {
            // Caches
            const leaderRole = await tx.role.findFirst({ where: { name: 'Leader' } })
            const allLeaders = await tx.user.findMany({ where: { roleId: leaderRole?.id || 0 } })
            const deptMap = new Map((await tx.department.findMany()).map(d => [d.name, d]))
            const lineMap = new Map((await tx.line.findMany()).map(l => [`${l.departmentId}_${l.name}`, l]))

            // Pre-process unique employees in this batch to avoid redundant upserts
            const uniqueEmps = new Map<string, any>()
            entries.forEach(e => {
                if (!uniqueEmps.has(e.employeeCode)) {
                    uniqueEmps.set(e.employeeCode, {
                        fullName: e.fullName,
                        title: e.title,
                        department: e.department || 'Default Dept',
                        lineName: e.line || 'Default Line',
                        leaderName: e.leaderName
                    })
                }
            })

            const empIdMap = new Map<string, number>()

            for (const [code, meta] of Array.from(uniqueEmps.entries())) {
                // Ensure Dept
                let dept = deptMap.get(meta.department)
                if (!dept) {
                    dept = await tx.department.create({ data: { name: meta.department } })
                    deptMap.set(meta.department, dept)
                }
                // Ensure Line
                const lineKey = `${dept.id}_${meta.lineName}`
                let line = lineMap.get(lineKey)
                if (!line) {
                    line = await tx.line.create({ data: { name: meta.lineName, departmentId: dept.id } })
                    lineMap.set(lineKey, line)
                }

                // Upsert Employee
                const emp = await tx.employee.upsert({
                    where: { employeeCode: code },
                    update: {
                        fullName: meta.fullName || undefined,
                        title: meta.title || undefined,
                        departmentId: dept.id,
                        lineId: line.id
                    },
                    create: {
                        employeeCode: code,
                        fullName: meta.fullName || 'Unknown',
                        title: meta.title || '',
                        departmentId: dept.id,
                        lineId: line.id,
                        joinDate: new Date()
                    }
                })
                empIdMap.set(code, emp.id)

                // Manage Leader History if provided
                if (meta.leaderName) {
                    const leader = allLeaders.find(l => l.fullName.toLowerCase() === meta.leaderName.toLowerCase())
                    if (leader) {
                        const targetDate = new Date(entries.find(e => e.employeeCode === code).recordDate)
                        const startMonth = new Date(Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), 1))
                        const endMonth = new Date(Date.UTC(targetDate.getFullYear(), targetDate.getMonth() + 1, 0))
                        
                        await tx.employeeLeaderHistory.deleteMany({
                            where: { employeeId: emp.id, startDate: { lte: endMonth }, OR: [{ endDate: null }, { endDate: { gte: startMonth } }] }
                        })
                        await tx.employeeLeaderHistory.create({
                            data: { employeeId: emp.id, leaderId: leader.id, startDate: startMonth, endDate: null }
                        })
                    }
                }
            }

            // Batch upsert attendance entries
            for (const entry of entries) {
                const { employeeCode, recordDate, status, hours } = entry
                const empId = empIdMap.get(employeeCode)
                if (!empId) continue

                const dateObj = new Date(recordDate)

                if (status) {
                    await tx.attendance.upsert({
                        where: { employeeId_recordDate: { employeeId: empId, recordDate: dateObj } },
                        update: { status: String(status) },
                        create: { employeeId: empId, recordDate: dateObj, status: String(status) }
                    })
                }

                if (hours !== undefined && hours !== null && !isNaN(Number(hours))) {
                    const otHours = Number(hours)
                    if (otHours > 0) {
                        const existingOT = await tx.overtime.findFirst({ where: { employeeId: empId, recordDate: dateObj } })
                        if (existingOT) {
                            await tx.overtime.update({ where: { id: existingOT.id }, data: { hours: otHours } })
                        } else {
                            await tx.overtime.create({ data: { employeeId: empId, recordDate: dateObj, hours: otHours, timeType: 'Day' } })
                        }
                    } else {
                        await tx.overtime.deleteMany({ where: { employeeId: empId, recordDate: dateObj } })
                    }
                }
            }
        }, { timeout: 300000 })

        return NextResponse.json({ success: true, message: `Đã nhập thành công toàn bộ dữ liệu.` })
    } catch (error: any) {
        console.error('Import Entries API Error:', error)
        return NextResponse.json({ error: `Lỗi hệ thống: ${error.message || 'Unknown error'}` }, { status: 500 })
    }
}
