import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
    try {
        const otCounts = await prisma.overtime.groupBy({
            by: ['recordDate'],
            _count: { id: true },
            orderBy: { recordDate: 'asc' }
        });

        return NextResponse.json(otCounts);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
