import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseISO, subMonths } from 'date-fns'

export async function POST(req: Request) {
    const body = await req.json()
    const { requestId, action } = body

    if (!requestId || !action) {
        return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    try {
        const tr = await prisma.transferRequest.findUnique({ where: { id: requestId } })
        if (!tr || tr.status !== 'Pending') {
            return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
        }

        if (action === 'Reject') {
            await prisma.transferRequest.update({
                where: { id: requestId },
                data: { status: 'Rejected' }
            })
            return NextResponse.json({ success: true, status: 'Rejected' })
        }

        if (action === 'Approve') {
            await prisma.$transaction(async (tx) => {
                await tx.transferRequest.update({
                    where: { id: requestId },
                    data: { status: 'Approved' }
                })

                const [yearStr, monthStr] = tr.targetMonth.split('-')
                const targetYear = parseInt(yearStr)
                const targetMonthIndex = parseInt(monthStr) - 1 // 0-based

                let prevYear = targetYear
                let prevMonthIndex = targetMonthIndex - 1
                if (prevMonthIndex < 0) {
                    prevMonthIndex = 11
                    prevYear -= 1
                }

                // New leader gets them starting on 21st of prev month (start of the ky cong)
                const startDate = new Date(Date.UTC(prevYear, prevMonthIndex, 21))

                // Old leader stops getting them on 20th of prev month (end of prev ky cong)
                const oldLeaderEndDate = new Date(Date.UTC(prevYear, prevMonthIndex, 20))

                // New leader's time ends on 20th of the CURRENT target month
                const newLeaderEndDate = new Date(Date.UTC(targetYear, targetMonthIndex, 20))

                // 1. Punch a hole in history explicitly for THIS single month
                // This covers everything: open-ended histories, imported 1-month bounded histories, etc.
                const existingHistories = await tx.employeeLeaderHistory.findMany({
                    where: { employeeId: tr.employeeId }
                })

                for (const hist of existingHistories) {
                    const histStart = hist.startDate.getTime()
                    const histEnd = hist.endDate ? hist.endDate.getTime() : Infinity
                    const targetStart = startDate.getTime()
                    const targetEnd = newLeaderEndDate.getTime()

                    if (histStart <= targetEnd && histEnd >= targetStart) {
                        // There is an overlap! We need to punch a hole for target month
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
                            // Hist is entirely encompassed by target month -> delete it completely
                            await tx.employeeLeaderHistory.delete({
                                where: { id: hist.id }
                            })
                        }
                    }
                }

                // 2. Insert the bounded 1-month history entry for the NEW leader
                await tx.employeeLeaderHistory.create({
                    data: {
                        employeeId: tr.employeeId,
                        leaderId: tr.toLeaderId,
                        startDate: startDate,
                        endDate: newLeaderEndDate
                    }
                })
            })

            return NextResponse.json({ success: true, status: 'Approved' })
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    } catch (e) {
        console.error('POST /api/transfer-requests/action error:', e)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
}
