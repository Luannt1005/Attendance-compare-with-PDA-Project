import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
    try {
        const h = await prisma.employeeLeaderHistory.findMany({
            include: { leader: true }
        });
        return NextResponse.json(h);
    } catch (e) {
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
