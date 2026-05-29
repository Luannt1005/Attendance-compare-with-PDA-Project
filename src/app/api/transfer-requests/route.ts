import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url)
    const toLeaderId = searchParams.get('toLeaderId')

    if (!toLeaderId) return NextResponse.json({ error: 'toLeaderId required' }, { status: 400 })

    try {
        const requests = await prisma.transferRequest.findMany({
            where: { toLeaderId: parseInt(toLeaderId), status: 'Pending' },
            include: {
                employee: true,
                fromLeader: true
            }
        })
        return NextResponse.json({ data: requests })
    } catch (e) {
        console.error('GET /api/transfer-requests error:', e)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    const body = await req.json()
    const { employeeIds, fromLeaderId, toLeaderId, targetMonth } = body

    if (!employeeIds || !fromLeaderId || !toLeaderId || !targetMonth) {
        return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    try {
        const createPromises = employeeIds.map((eid: number) =>
            prisma.transferRequest.create({
                data: {
                    employeeId: eid,
                    fromLeaderId,
                    toLeaderId,
                    targetMonth,
                    status: 'Pending'
                }
            })
        )
        await Promise.all(createPromises)
        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('POST /api/transfer-requests error:', e)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
}
