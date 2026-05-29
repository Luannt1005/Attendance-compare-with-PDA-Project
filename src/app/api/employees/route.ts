import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const leaderId = searchParams.get('leaderId')
        const dateStr = searchParams.get('date')

        if (!leaderId) {
            return NextResponse.json({ error: 'leaderId is required' }, { status: 400 })
        }

        let targetDate = new Date()
        if (dateStr) {
            targetDate = new Date(dateStr)
        }

        // Logic to prevent historical data loss:
        // We get employees based on EmployeeLeaderHistory where the targetDate falls within startDate and endDate
        const histories = await prisma.employeeLeaderHistory.findMany({
            where: {
                leaderId: parseInt(leaderId),
                startDate: { lte: targetDate },
                OR: [
                    { endDate: null },
                    { endDate: { gte: targetDate } }
                ]
            },
            include: {
                employee: {
                    include: {
                        department: true,
                        line: true
                    }
                }
            }
        })

        const employees = histories.map(h => h.employee)

        return NextResponse.json({ employees }, { status: 200 })

    } catch (error) {
        console.error('Get Employees Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
