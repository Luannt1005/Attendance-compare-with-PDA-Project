import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcrypt'
import fs from 'fs'
import path from 'path'

async function main() {
    console.log('Seeding Database...')

    // Roles
    const roles = await Promise.all([
        prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } }),
        prisma.role.upsert({ where: { name: 'Leader' }, update: {}, create: { name: 'Leader' } }),
        prisma.role.upsert({ where: { name: 'Clerk' }, update: {}, create: { name: 'Clerk' } }),
    ])

    const adminRole = roles[0]
    const leaderRole = roles[1]
    const clerkRole = roles[2]

    const passwordHash = await bcrypt.hash('123456', 10)

    // Users
    const leaderUser = await prisma.user.upsert({
        where: { username: 'leader1' },
        update: {},
        create: {
            username: 'leader1',
            passwordHash,
            fullName: 'John Leader',
            roleId: leaderRole.id,
        }
    })

    const clerkUser = await prisma.user.upsert({
        where: { username: 'clerk1' },
        update: {},
        create: {
            username: 'clerk1',
            passwordHash,
            fullName: 'Sarah Clerk',
            roleId: clerkRole!.id,
        }
    })

    // Departments & Lines
    const dept = await prisma.department.upsert({
        where: { name: 'Assembly' },
        update: {},
        create: { name: 'Assembly' }
    })

    const line1 = await prisma.line.create({
        data: { name: 'Line A', departmentId: dept.id }
    })

    // Employee
    const emp1 = await prisma.employee.upsert({
        where: { employeeCode: 'EMP001' },
        update: {},
        create: {
            employeeCode: 'EMP001',
            fullName: 'Alice Operator',
            departmentId: dept.id,
            lineId: line1.id,
            joinDate: new Date('2024-01-01'),
        }
    })

    const emp2 = await prisma.employee.upsert({
        where: { employeeCode: 'EMP002' },
        update: {},
        create: {
            employeeCode: 'EMP002',
            fullName: 'Bob Worker',
            departmentId: dept.id,
            lineId: line1.id,
            joinDate: new Date('2024-05-15'),
        }
    })

    // EmployeeLeaderHistory for Leader 1
    await prisma.employeeLeaderHistory.createMany({
        data: [
            { employeeId: emp1.id, leaderId: leaderUser.id, startDate: new Date('2024-01-01') },
            { employeeId: emp2.id, leaderId: leaderUser.id, startDate: new Date('2024-05-15') }
        ],
        skipDuplicates: true
    })

    // Shifts
    console.log('Seeding Shifts...')
    try {
        const shiftsPath = path.join(process.cwd(), 'shifts.json')
        if (fs.existsSync(shiftsPath)) {
            let content = fs.readFileSync(shiftsPath, 'utf8')
            if (content.charCodeAt(0) === 0xFEFF) {
                content = content.slice(1)
            }
            const shiftsData = JSON.parse(content)
            if (shiftsData && Array.isArray(shiftsData.data)) {
                for (const shift of shiftsData.data) {
                    await prisma.shift.upsert({
                        where: { code: shift.code },
                        update: {
                            name: shift.name,
                            startTime: shift.startTime,
                            endTime: shift.endTime,
                            otPreStart: shift.otPreStart,
                            otPreEnd: shift.otPreEnd,
                            otPostStart: shift.otPostStart,
                            otPostEnd: shift.otPostEnd,
                            isActive: shift.isActive
                        },
                        create: {
                            code: shift.code,
                            name: shift.name,
                            startTime: shift.startTime,
                            endTime: shift.endTime,
                            otPreStart: shift.otPreStart,
                            otPreEnd: shift.otPreEnd,
                            otPostStart: shift.otPostStart,
                            otPostEnd: shift.otPostEnd,
                            isActive: shift.isActive
                        }
                    })
                }
                console.log('Shifts seeded successfully.')
            }
        }
    } catch (e) {
        console.error('Failed to seed shifts:', e)
    }

    console.log('Seed completed successfully.')
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
