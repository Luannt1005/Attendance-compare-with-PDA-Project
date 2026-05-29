import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
    try {
        const body = await req.json()
        // Payload expected: { date: 'YYYY-MM-DD', records: [{ employeeId: number, status: string }] }
        const { date, records } = body

        if (!date || !records || !Array.isArray(records)) {
            return NextResponse.json({ error: 'Invalid input data' }, { status: 400 })
        }

        const recordDate = new Date(date)

        // Using transaction to save all attendance rows at once
        const results = await prisma.$transaction(
            records.map((record: any) =>
                prisma.attendance.upsert({
                    where: {
                        employeeId_recordDate: {
                            employeeId: record.employeeId,
                            recordDate: recordDate
                        }
                    },
                    update: {
                        status: record.status // if already exists, update status
                    },
                    create: {
                        employeeId: record.employeeId,
                        recordDate: recordDate,
                        status: record.status
                    }
                })
            )
        )

        return NextResponse.json({ message: 'Attendance saved successfully', count: results.length }, { status: 200 })

    } catch (error) {
        console.error('Submit Attendance Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
