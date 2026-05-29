import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
    try {
        const { targetDates } = await req.json()
        if (!targetDates || !Array.isArray(targetDates) || targetDates.length === 0) {
            return NextResponse.json({ error: 'targetDates array is required' }, { status: 400 })
        }

        const dateObjects = targetDates.map((dateStr: string) => {
            const [yearStr, monthStr, dayStr] = dateStr.split('-')
            return new Date(Date.UTC(parseInt(yearStr), parseInt(monthStr) - 1, parseInt(dayStr)))
        })

        // Transaction to overwrite clerk data with leader data JUST FOR THESE DAYS
        await prisma.$transaction(async (tx) => {
            for (const specificDate of dateObjects) {
                // Get all leader attendances and overtimes for this exact day
                const leaderAttendances = await tx.attendance.findMany({
                    where: { recordDate: specificDate }
                })

                const leaderOvertimes = await tx.overtime.findMany({
                    where: { recordDate: specificDate }
                })

                // 1. Delete all existing clerk records for this day
                await tx.clerkAttendance.deleteMany({
                    where: { recordDate: specificDate }
                })
                await tx.clerkOvertime.deleteMany({
                    where: { recordDate: specificDate }
                })

                // 2. Insert fresh copies from leader submission
                if (leaderAttendances.length > 0) {
                    await tx.clerkAttendance.createMany({
                        data: leaderAttendances.map(a => ({
                            employeeId: a.employeeId,
                            recordDate: a.recordDate,
                            status: a.status,
                            isLocked: a.isLocked
                        }))
                    })
                }

                if (leaderOvertimes.length > 0) {
                    await tx.clerkOvertime.createMany({
                        data: leaderOvertimes.map(o => ({
                            employeeId: o.employeeId,
                            recordDate: o.recordDate,
                            hours: o.hours,
                            timeType: o.timeType
                        }))
                    })
                }
            }
        })

        return NextResponse.json({ message: 'Sync completed successfully' })
    } catch (error: any) {
        console.error('Sync API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
