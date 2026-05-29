import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startOfDay, endOfDay } from 'date-fns'

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const dateStr = searchParams.get('date') // YYYY-MM-DD
        const search = searchParams.get('search') // Option string

        let whereClause: any = {}
        if (dateStr) {
            const baseDate = new Date(dateStr)
            const targetDateStart = new Date(Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()))
            const targetDateEnd = new Date(Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59))
            whereClause.recordDate = {
                gte: targetDateStart,
                lte: targetDateEnd
            }
        }

        if (search) {
            whereClause.employee = {
                OR: [
                    { employeeCode: { contains: search } },
                    { fullName: { contains: search } }
                ]
            }
        }

        const records = await prisma.fingerprint.findMany({
            where: whereClause,
            include: {
                employee: {
                    select: {
                        employeeCode: true,
                        fullName: true,
                        department: true
                    }
                }
            },
            orderBy: [
                { recordDate: 'desc' },
                { employee: { employeeCode: 'asc' } }
            ],
            take: search || dateStr ? undefined : 1000 // Release cap when explicitly querying
        })

        return NextResponse.json({ data: records })
    } catch (error) {
        console.error('Fetch Fingerprint Data Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
