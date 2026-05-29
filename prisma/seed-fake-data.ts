import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcrypt'

async function main() {
    console.log('Clearing existing records...')

    // Clear in related order
    await prisma.overtime.deleteMany()
    await prisma.attendance.deleteMany()
    await prisma.employeeLeaderHistory.deleteMany()
    await prisma.employee.deleteMany()
    await prisma.line.deleteMany()
    await prisma.department.deleteMany()

    console.log('Seeding fake data for demonstration...')

    const passwordHash = await bcrypt.hash('123456', 10)

    // Roles
    const leaderRole = await prisma.role.upsert({ where: { name: 'Leader' }, update: {}, create: { name: 'Leader' } })
    const clerkRole = await prisma.role.upsert({ where: { name: 'Clerk' }, update: {}, create: { name: 'Clerk' } })

    // Test Users
    const leader1 = await prisma.user.upsert({
        where: { username: 'leader1' },
        update: {},
        create: { username: 'leader1', passwordHash, fullName: 'David (Leader - Assembly)', roleId: leaderRole.id }
    })
    const leader2 = await prisma.user.upsert({
        where: { username: 'leader2' },
        update: {},
        create: { username: 'leader2', passwordHash, fullName: 'Sarah (Leader - QA)', roleId: leaderRole.id }
    })

    console.log(`Created test users: ${leader1.username}, ${leader2.username} (password: 123456)`)

    // Departments & Lines
    const assemblyDept = await prisma.department.create({ data: { name: 'Assembly' } })
    const qaDept = await prisma.department.create({ data: { name: 'QA' } })

    const lineA = await prisma.line.create({ data: { name: 'Line A (Tvs)', departmentId: assemblyDept.id } })
    const lineB = await prisma.line.create({ data: { name: 'Line B (Phones)', departmentId: qaDept.id } })

    // Generate 50 fake employees
    const employeesData = Array.from({ length: 50 }).map((_, i) => ({
        employeeCode: `EMP${String(100 + i).padStart(3, '0')}`,
        fullName: `Test Operator ${i + 1}`,
        departmentId: i < 30 ? assemblyDept.id : qaDept.id,
        lineId: i < 30 ? lineA.id : lineB.id,
        joinDate: new Date('2023-01-01'),
        status: 'Active'
    }))

    await prisma.employee.createMany({ data: employeesData })
    const allEmployees = await prisma.employee.findMany()

    // Assign Top 30 to Leader 1, Next 20 to Leader 2
    const historyData = allEmployees.map((emp, i) => ({
        employeeId: emp.id,
        leaderId: i < 30 ? leader1.id : leader2.id,
        startDate: new Date('2023-01-01')
    }))
    await prisma.employeeLeaderHistory.createMany({ data: historyData })

    // Generate 30 days of past attendance and OT data
    const today = new Date()
    const attendanceRecords = []
    const otRecords = []

    const statuses = ['M_AL', 'M_AL', 'M_P', 'M_P', 'M_P', 'M_SL', 'M_OT', 'A_P']

    for (let dayOffset = 30; dayOffset >= 0; dayOffset--) {
        const date = new Date(today)
        date.setDate(date.getDate() - dayOffset)

        // Skip Sundays
        if (date.getDay() === 0) continue;

        for (const emp of allEmployees) {
            const randomStatus = statuses[Math.floor(Math.random() * statuses.length)]

            attendanceRecords.push({
                employeeId: emp.id,
                recordDate: date,
                status: randomStatus
            })

            // Generate some OT if they are present or OT status
            if (randomStatus.includes('P') || randomStatus === 'M_OT') {
                if (Math.random() > 0.7) { // 30% chance for OT
                    otRecords.push({
                        employeeId: emp.id,
                        recordDate: date,
                        hours: Math.floor(Math.random() * 3) + 1,
                        timeType: 'After Shift'
                    })
                }
            }
        }
    }

    // Insert chunks to avoid huge payload crashes
    const chunkSize = 500
    for (let i = 0; i < attendanceRecords.length; i += chunkSize) {
        await prisma.attendance.createMany({ data: attendanceRecords.slice(i, i + chunkSize) })
    }
    for (let i = 0; i < otRecords.length; i += chunkSize) {
        await prisma.overtime.createMany({ data: otRecords.slice(i, i + chunkSize) })
    }

    console.log('Advanced Seeding completed successfully! 🚀 Data is ready for charts.')
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
