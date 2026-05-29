import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startOfMonth, endOfMonth, parseISO, subMonths } from 'date-fns'

import { getAprilExcelData } from '@/lib/excel-timesheet-helper'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const monthParam = searchParams.get('month') // YYYY-MM
        const leaderId = searchParams.get('leaderId')

        if (!monthParam) {
            return NextResponse.json({ error: 'Month is required' }, { status: 400 })
        }

        /* 
        // --- EXCEL CONNECTION FOR APRIL 2026 REMOVED ---
        if (monthParam?.startsWith('2026-04')) {
            console.log(`[DEBUG Standard] Month param: "${monthParam}", LeaderId: "${leaderId}"`);
            const excelData = await getAprilExcelData(leaderId);
            console.log(`[DEBUG Standard] Returning ${excelData.length} records for April 2026`);
            return NextResponse.json({ data: excelData });
        }
        */


        const [yearStr, monthStr] = monthParam.split('-')
        const targetYear = parseInt(yearStr)
        const targetMonthIndex = parseInt(monthStr) - 1 // 0-based

        let prevYear = targetYear
        let prevMonthIndex = targetMonthIndex - 1
        if (prevMonthIndex < 0) {
            prevMonthIndex = 11
            prevYear -= 1
        }

        const start = new Date(Date.UTC(prevYear, prevMonthIndex, 21))
        const end = new Date(Date.UTC(targetYear, targetMonthIndex, 20))

        const employeeWhere: any = {
            leaderHistories: {
                some: {
                    startDate: { lte: end },
                    OR: [
                        { endDate: null },
                        { endDate: { gte: start } }
                    ]
                }
            }
        }

        if (leaderId) {
            employeeWhere.leaderHistories.some.leaderId = parseInt(leaderId)
        }

        const employees = await prisma.employee.findMany({
            where: employeeWhere,
            include: {
                attendances: {
                    where: {
                        recordDate: {
                            gte: start,
                            lte: end
                        }
                    }
                },
                overtimes: {
                    where: {
                        recordDate: {
                            gte: start,
                            lte: end
                        }
                    }
                },
                leaderHistories: {
                    where: {
                        startDate: { lte: end },
                        OR: [
                            { endDate: null },
                            { endDate: { gte: start } }
                        ]
                    },
                    include: {
                        leader: true
                    }
                }
            },
            orderBy: {
                employeeCode: 'asc'
            }
        })

        // Transform data into an easy format for the spreadsheet
        const formattedData = employees.map(emp => {
            // Find current leader for the month by mathematically evaluating which history intersects [start, end]
            // We use the same precise overlapping logic: histStart <= end AND histEnd >= start
            const activeHistory = emp.leaderHistories.find(h => {
                const hStart = h.startDate.getTime()
                const hEnd = h.endDate ? h.endDate.getTime() : Infinity
                return hStart <= end.getTime() && hEnd >= start.getTime()
            })
            const leaderName = activeHistory?.leader?.fullName || 'N/A'

            const attendanceMap: Record<string, string> = {}
            emp.attendances.forEach(att => {
                const dateKey = att.recordDate.toISOString().split('T')[0]
                attendanceMap[dateKey] = att.status
            })

            const otMap: Record<string, number> = {}
            emp.overtimes.forEach(ot => {
                const dateKey = ot.recordDate.toISOString().split('T')[0]
                otMap[dateKey] = ot.hours
            })

            return {
                id: emp.id,
                employeeCode: emp.employeeCode,
                fullName: emp.fullName,
                leaderName: leaderName,
                pic: emp.pic,
                mgt: emp.mgt,
                employeeType: emp.employeeType,
                title: (emp as any).title,
                supervisor: (emp as any).supervisor,
                gender: (emp as any).gender,
                vendor: (emp as any).vendor,
                zone: (emp as any).zone,
                mu: (emp as any).mu,
                shiftLeader: (emp as any).shiftLeader,
                attendances: attendanceMap,
                overtimes: otMap
            }
        })

        return NextResponse.json({ data: formattedData })
    } catch (error) {
        console.error('Month Attendance API Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
