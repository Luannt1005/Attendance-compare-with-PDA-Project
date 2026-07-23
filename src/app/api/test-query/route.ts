import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const code = url.searchParams.get('code') || '500186';
        
        const emp = await prisma.employee.findUnique({
            where: { employeeCode: code },
            include: {
                lineDatas: true,
                fingerprints: true
            }
        });

        return NextResponse.json(emp);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
