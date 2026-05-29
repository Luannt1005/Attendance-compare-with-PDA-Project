import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parse, startOfMonth, endOfMonth, addDays, subDays } from 'date-fns'

export async function POST(request: Request) {
    try {
        const { employeeIds, targetMonth } = await request.json()

        if (!employeeIds || !targetMonth || !Array.isArray(employeeIds)) {
            return NextResponse.json({ error: 'Missing employeeIds or targetMonth' }, { status: 400 })
        }

        const [yearStr, monthString] = targetMonth.split('-')
        const targetYear = parseInt(yearStr)
        const targetMonthIndex = parseInt(monthString) - 1 // 0-based

        let prevYear = targetYear
        let prevMonthIndex = targetMonthIndex - 1
        if (prevMonthIndex < 0) {
            prevMonthIndex = 11
            prevYear -= 1
        }

        const periodStart = new Date(Date.UTC(prevYear, prevMonthIndex, 21))
        const periodEnd = new Date(Date.UTC(targetYear, targetMonthIndex, 20))
        const oldLeaderEndDate = new Date(Date.UTC(prevYear, prevMonthIndex, 20))

        await prisma.$transaction(async (tx: any) => {
            await tx.attendance.deleteMany({
                where: {
                    employeeId: { in: employeeIds },
                    recordDate: {
                        gte: periodStart,
                        lte: periodEnd
                    }
                }
            })

            await tx.overtime.deleteMany({
                where: {
                    employeeId: { in: employeeIds },
                    recordDate: {
                        gte: periodStart,
                        lte: periodEnd
                    }
                }
            })

            // Punch holes in EmployeeLeaderHistory so they no longer show up in this month
            for (const empId of employeeIds) {
                const existingHistories = await tx.employeeLeaderHistory.findMany({
                    where: { employeeId: empId }
                })

                for (const hist of existingHistories) {
                    const histStart = hist.startDate.getTime()
                    const histEnd = hist.endDate ? hist.endDate.getTime() : Infinity
                    const targetStart = periodStart.getTime()
                    const targetEnd = periodEnd.getTime()

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
            }
        })

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('Delete row error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
