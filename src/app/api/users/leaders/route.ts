import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
    try {
        const leaders = await prisma.user.findMany({
            where: { role: { name: 'Leader' } },
            select: { id: true, fullName: true, username: true }
        })
        return NextResponse.json({ data: leaders })
    } catch (e) {
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
}
